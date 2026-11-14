# -*- coding: utf-8 -*-
"""
services/dorm_client.py — 安徽工业大学晚寝签到系统（xskq.ahut.edu.cn）协议客户端

协议逻辑保持与旧版（legacy/dorm_client.py）完全一致（经过线上验证），
仅做类型标注与配置注入优化。requests 为同步库，调用方应通过
asyncio.to_thread / 线程池调用，避免阻塞事件循环。

流程：
  1. 登录   : POST /api/flySource-auth/oauth/token（Basic + 表单，password 为 MD5）
  2. 签名   : 每个请求带 FlySource-Auth / FlySource-sign 头 + 微信 UA + 随机公网 IP
  3. 签到   : 取任务信息 → (发 API 日志,失败忽略) → 取微信签名配置(失败中止) → POST stuSign
"""
import base64
import hashlib
import json
import logging
import random
import time
import urllib.parse
from datetime import datetime
from urllib.parse import urlsplit

import requests

from app.core.config import settings
from app.core.security import TZ

logger = logging.getLogger("app.dorm_client")

# ---------- 常量（对应 campus-backend internal/dorm 的 Go 常量） ----------

DORM_BASE_URL = "https://xskq.ahut.edu.cn"
DORM_LOGIN_URL = DORM_BASE_URL + "/api/flySource-auth/oauth/token"
DORM_BASIC_AUTH = "Basic Zmx5c291cmNlX3dpc2VfYXBwOkRBNzg4YXNkVURqbmFzZF9mbHlzb3VyY2VfZHNkYWREQUlVaXV3cWU="
DORM_API_LOG_URL = DORM_BASE_URL + "/api/flySource-base/apiLog/save?menuTitle=%E6%99%9A%E5%AE%BF%E7%AD%BE%E5%88%B0"
DORM_WECHAT_CONFIG_PATH = "/api/flySource-base/wechat/getWechatMpConfig"
DORM_TASK_INFO_PATH = "/api/flySource-yxgl/dormSignTask/getTaskByIdForApp"
DORM_SIGN_PATH = "/api/flySource-yxgl/dormSignRecord/stuSign"
DORM_SIGN_STATUS_PATH = "/api/flySource-yxgl/dormSignRecord/getOne"

UA = ("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/114.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.38.2401(0x28002658) "
      "ProcessChannel/tools WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64")


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


# ---------- 纯函数工具（对应 Go 端，签名算法保持原样） ----------

def is_special_or_private(a: int, b: int, c: int) -> bool:
    """对应 Go httputil.isSpecialOrPrivateIPv4。"""
    if a == 0 or a == 10 or a == 127:
        return True
    if a == 100 and 64 <= b <= 127:
        return True
    if a == 169 and b == 254:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    if a == 192 and b == 0 and c == 2:
        return True
    if a == 192 and b == 88 and c == 99:
        return True
    if a == 192 and b == 168:
        return True
    if a == 198 and 18 <= b <= 19:
        return True
    if a == 198 and b == 51 and c == 100:
        return True
    if a == 203 and b == 0 and c == 113:
        return True
    return a >= 224


def random_public_ip() -> str:
    """生成随机公网 IPv4，避开私网/特殊网段。"""
    while True:
        a, b, c = (random.randint(0, 255) for _ in range(3))
        d = random.randint(0, 255)
        if not is_special_or_private(a, b, c):
            return f"{a}.{b}.{c}.{d}"


def generate_sign(api_path: str, token: str) -> str:
    """对应 Go GenerateDormSign：MD5(apiPath + ?sign= + MD5(ts + token)) + "1." + base64(ts)。"""
    ts = int(time.time() * 1000)
    inner = md5(f"{ts}{token}")
    final = md5(api_path + "?sign=" + inner)
    return final + "1." + base64.b64encode(str(ts).encode("ascii")).decode("ascii")


def generate_stu_task_id(lat: str, lng: str, accuracy_str: str, sign_date: str, task_id: str) -> str:
    """stuTaskId = MD5(JSON.stringify({latitude,longitude,locationAccuracy,signDate,taskId,fileId}))"""
    payload = '{"latitude":"%s","longitude":"%s","locationAccuracy":"%s","signDate":"%s","taskId":"%s","fileId":""}' % (
        lat, lng, accuracy_str, sign_date, task_id)
    return md5(payload)


def js_date_tostring(t: datetime) -> str:
    """对应 Go 中 JS Date.toString() 格式：'Tue Jul 14 2026 02:24:42 GMT+0800 (中国标准时间)'。"""
    return "%s %s %d %d %s GMT%s (%s)" % (
        t.strftime("%a"), t.strftime("%b"), t.day, t.year,
        t.strftime("%H:%M:%S"), t.strftime("%z"), "中国标准时间")


def sign_code_md5(t: datetime) -> str:
    return md5(js_date_tostring(t))


RATE_LIMIT_HINTS = ("频繁", "操作过快", "请求过于", "稍后再试")
ALREADY_SIGNED_HINTS = ("已完成签到", "已签到", "已经签到")


SIGNED_STATUS_NAMES = ("正常", "迟到", "补签")


def is_signed_status(status: dict, today: str = "") -> bool:
    """上游 getOne 的 signStatusName 已签时为「正常」，未签为「未签」；
    同时用 signTime / signDate 兜底，避免文案变化导致漏判。"""
    st = status or {}
    name = str(st.get("name") or "")
    sign_date = str(st.get("sign_date") or "")
    if today and sign_date and sign_date != today:
        return False
    if "未签" in name:
        return False
    if "已签" in name or name in SIGNED_STATUS_NAMES:
        return True
    return bool(st.get("sign_time"))


def is_rate_limited(msg: str) -> bool:
    return any(h in (msg or "") for h in RATE_LIMIT_HINTS)


def is_already_signed_msg(msg: str) -> bool:
    return any(h in (msg or "") for h in ALREADY_SIGNED_HINTS)


# ---------- 异常与客户端 ----------

class DormError(Exception):
    """上游调用失败（含登录失败 / 接口失败）。"""


class DormClient:
    """晚寝系统客户端。base_url / task_id 可注入（默认取配置），便于本地 mock 验证。"""

    def __init__(
        self,
        base_url: str = "",
        task_id: str = "",
        timeout: int = 30,
        enable_api_log: bool | None = None,
    ):
        self.base_url = (base_url or settings.DORM_BASE_URL).rstrip("/")
        self.task_id = task_id or settings.DORM_TASK_ID
        self.timeout = timeout
        self.enable_api_log = settings.DORM_ENABLE_API_LOG if enable_api_log is None else enable_api_log

    # ---------- 基础设施 ----------

    @staticmethod
    def _new_session() -> requests.Session:
        s = requests.Session()
        s.headers["User-Agent"] = UA
        return s

    @staticmethod
    def _inject_forged_ip(headers: dict) -> None:
        ip = random_public_ip()
        headers["X-Forwarded-For"] = ip
        headers["X-Real-IP"] = ip
        headers["Remote-Addr"] = ip

    def _signed_request(
        self, sess: requests.Session, token: str, method: str,
        url: str, params: dict | None = None, json_body: dict | None = None,
    ) -> requests.Response:
        api_path = urlsplit(url).path  # 签名只用 path，不带 query
        headers = {
            "FlySource-Auth": "bearer " + token,
            "FlySource-sign": generate_sign(api_path, token),
        }
        self._inject_forged_ip(headers)
        return sess.request(method, url, params=params, json=json_body,
                            headers=headers, timeout=self.timeout)

    def _request_with_retry(
        self, sess: requests.Session, token: str, method: str, url: str,
        params: dict | None = None, json_body: dict | None = None,
        student_id: str = "", password: str = "",
    ) -> requests.Response:
        """签名请求；401 时重新登录重试一次。"""
        resp = self._signed_request(sess, token, method, url, params, json_body)
        if resp.status_code == 401:
            token = self.login(sess, student_id, password)
            resp = self._signed_request(sess, token, method, url, params, json_body)
        return resp

    # ---------- 1. 登录 ----------

    def login(self, sess: requests.Session, student_id: str, password: str) -> str:
        """登录晚寝系统，返回 refresh_token。"""
        headers = {
            "Authorization": DORM_BASIC_AUTH,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        self._inject_forged_ip(headers)
        data = {
            "tenantId": "000000",
            "username": student_id,
            "password": md5(password),
            "type": "account",
            "grant_type": "password",
            "scope": "all",
        }
        resp = sess.post(self.base_url + "/api/flySource-auth/oauth/token",
                         headers=headers, data=data, timeout=self.timeout)
        if resp.status_code != 200:
            raise DormError(f"登录失败 HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            payload = resp.json()
        except ValueError:
            raise DormError(f"登录响应非 JSON: {resp.text[:200]}")
        if payload.get("msg"):
            raise DormError(f"登录失败: {payload['msg']}")
        token = payload.get("refresh_token") or payload.get("access_token")
        if not token:
            raise DormError(f"登录失败，未获取到 token: {json.dumps(payload, ensure_ascii=False)[:200]}")
        return token

    # ---------- 2. 签到流程步骤 ----------

    def get_task_info(
        self, sess: requests.Session, token: str, sign_date: str,
        student_id: str = "", password: str = "",
    ) -> dict:
        url = self.base_url + DORM_TASK_INFO_PATH
        resp = self._request_with_retry(
            sess, token, "GET", url,
            params={"taskId": self.task_id, "signDate": sign_date},
            student_id=student_id, password=password)
        if resp.status_code != 200:
            raise DormError(f"获取任务信息失败 HTTP {resp.status_code}: {resp.text[:200]}")
        payload = resp.json()
        vo = (payload.get("data") or {}).get("dormitoryRegisterVO") or {}
        if not vo:
            raise DormError(
                f"获取任务信息失败，未取到 dormitoryRegisterVO: "
                f"{json.dumps(payload, ensure_ascii=False)[:300]}")
        return vo

    def send_api_log(self, sess: requests.Session, token: str,
                     student_id: str = "", password: str = "") -> None:
        """发送 API 日志（失败不阻断签到）。"""
        try:
            self._request_with_retry(sess, token, "POST", self.base_url + DORM_API_LOG_URL,
                                     student_id=student_id, password=password)
        except Exception:
            logger.debug("发送 API 日志失败（可忽略）", exc_info=True)

    def get_wechat_config(self, sess: requests.Session, token: str,
                          student_id: str, password: str = "") -> None:
        """获取微信签名配置（失败则中止签到）。"""
        page_url = (f"{self.base_url}/wise/pages/ssgl/dormsign?taskId={self.task_id}"
                    f"&autoSign=1&scanSign=0&userId={student_id}")
        config_url = urllib.parse.quote(urllib.parse.quote(page_url, safe=""), safe="")
        url = f"{self.base_url}{DORM_WECHAT_CONFIG_PATH}?configUrl={config_url}"
        resp = self._request_with_retry(sess, token, "GET", url,
                                        student_id=student_id, password=password)
        if resp.status_code != 200:
            raise DormError(f"获取微信签名配置失败 HTTP {resp.status_code}: {resp.text[:200]}")

    def do_sign(
        self, sess: requests.Session, token: str, task_info: dict, sign_date: str,
        student_id: str = "", password: str = "",
        override_lat: str | None = None, override_lng: str | None = None,
    ) -> dict:
        """构造并提交签到。位置默认取任务信息；传入 override_* 时用已记录位置替换。"""
        lat = str(override_lat) if override_lat is not None else str(task_info.get("locationLat") or "")
        lng = str(override_lng) if override_lng is not None else str(task_info.get("locationLng") or "")
        room_id = str(task_info.get("roomId") or "")
        accuracy = round(random.uniform(20, 200), 1)
        accuracy_str = f"{accuracy:.1f}"
        stu_task_id = generate_stu_task_id(lat, lng, accuracy_str, sign_date, self.task_id)
        now = datetime.now(TZ)
        sign_data = {
            "signType": 0,
            "taskId": self.task_id,
            "signLat": lat,
            "signLng": lng,
            "locationAccuracy": accuracy_str,
            "stuTaskId": stu_task_id,
            "scanCode": "",
            "scanType": "",
            "roomId": room_id,
            "signCode": sign_code_md5(now),
            "signKey": room_id,
        }
        url = self.base_url + DORM_SIGN_PATH
        resp = self._request_with_retry(sess, token, "POST", url, json_body=sign_data,
                                        student_id=student_id, password=password)
        if resp.status_code != 200:
            raise DormError(f"签到请求失败 HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            return resp.json()
        except ValueError:
            return {"code": -1, "success": False, "msg": f"非 JSON 响应: {resp.text[:200]}"}

    def get_sign_status(self, sess: requests.Session, token: str,
                        student_id: str = "", password: str = "") -> dict:
        """查询当日签到记录（signStatusName / signTime / signDate）。上游失败抛 DormError。"""
        url = self.base_url + DORM_SIGN_STATUS_PATH
        resp = self._request_with_retry(sess, token, "GET", url,
                                        student_id=student_id, password=password)
        if resp.status_code != 200:
            raise DormError(f"获取签到状态失败 HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            payload = resp.json()
        except ValueError:
            raise DormError(f"签到状态响应非 JSON: {resp.text[:200]}")
        data = payload.get("data") or {}
        return {
            "name": str(data.get("signStatusName") or ""),
            "sign_time": str(data.get("signTime") or ""),
            "sign_date": str(data.get("signDate") or ""),
        }

    # ---------- 3. 一键完整签到 ----------

    def _query_status_with_retry(self, sess: requests.Session, token: str,
                                 student_id: str, password: str,
                                 attempts: int = 3, delay: float = 3.0) -> dict:
        """限流时等几秒重查；其它失败不阻断签到，按未签处理。"""
        for i in range(attempts):
            try:
                status = self.get_sign_status(sess, token, student_id, password)
                logger.info("签到状态查询结果：%s", status)
                return status
            except Exception as e:
                if is_rate_limited(str(e)) and i < attempts - 1:
                    time.sleep(delay)
                    continue
                logger.warning("查询签到状态失败，按未签继续：%s", e)
                return {}
        return {}

    def sign_once(self, student_id: str, password: str,
                  location: dict | None = None, check_status: bool = True) -> dict:
        """完整签到流程。check_status=True 时先查当日状态，已签直接返回成功。"""
        if not self.task_id:
            raise DormError("未配置 task_id（.env 中 DORM_TASK_ID）")
        sess = self._new_session()
        token = self.login(sess, student_id, password)
        sign_date = datetime.now(TZ).strftime("%Y-%m-%d")

        status: dict = {}
        if check_status:
            status = self._query_status_with_retry(sess, token, student_id, password)
            if is_signed_status(status, sign_date):
                return {"code": 0, "success": True, "msg": "签到成功",
                        "already": True, "status": str(status.get("name") or "")}
        try:
            task_info = self.get_task_info(sess, token, sign_date, student_id, password)
            if self.enable_api_log:
                self.send_api_log(sess, token, student_id, password)
            self.get_wechat_config(sess, token, student_id, password)
            ov_lat = ov_lng = None
            if location:
                ov_lat = str(location.get("lat") or "")
                ov_lng = str(location.get("lng") or "")
            result = self.do_sign(sess, token, task_info, sign_date, student_id, password,
                                  override_lat=ov_lat, override_lng=ov_lng)
        except DormError:
            raise
        except Exception as e:  # 网络异常等
            raise DormError(f"签到流程异常: {e}")
        return {
            "code": result.get("code"),
            "success": bool(result.get("success")),
            "msg": str(result.get("msg") or ""),
            "already": False,
            "status": str(status.get("name") or ""),
        }
