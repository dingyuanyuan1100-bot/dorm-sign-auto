# 为本地库灌入与设计稿一致的可视化数据（仅本地 qa_vis 账号）
import sqlite3, os
from datetime import datetime, timedelta

DB = r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\data\dorm_sign.db"
assert os.path.exists(DB), DB
db = sqlite3.connect(DB)
c = db.cursor()

now0 = "2026-11-01 20:00:00"
uid = c.execute("select id from users where username='qa_vis'").fetchone()[0]
print("uid", uid)

# 清空该账号旧数据
for t in ("sign_logs", "schedules", "locations", "dorm_accounts"):
    c.execute(f"delete from {t} where user_id=?", (uid,))

# 晚寝账号
c.execute(
    "insert into dorm_accounts(user_id,student_id,enc_password,nickname,created_at) values(?,?,?,?,?)",
    (uid, "2023001", "x", "samsad", now0),
)
acc_id = c.lastrowid

# 位置
locs = [
    ("3 号公寓 · 502", "31.7061", "118.5070", "秀山校区 3 号公寓", 1),
    ("图书馆 2F · 自习区", "31.7052", "118.5098", "秀山校区图书馆", 0),
]
loc_ids = []
for name, lat, lng, addr, d in locs:
    c.execute(
        "insert into locations(user_id,name,lat,lng,address,is_default,created_at) values(?,?,?,?,?,?,?)",
        (uid, name, lat, lng, addr, d, now0),
    )
    loc_ids.append(c.lastrowid)

now = datetime.now()
today = now.strftime("%Y-%m-%d")

# 任务：23:30 每天(启用) / 23:45 每天(停用) / 22:30 一次
sched = [
    ("daily", "23:30", None, 1, "晚寝签到", loc_ids[0], "success"),
    ("daily", "23:45", None, 0, "备选", loc_ids[0], None),
    ("once", "22:30", "2026-11-04", 1, "图书馆自习", loc_ids[1], None),
]
sid = []
for mode, tm, sd, en, rk, lid, st in sched:
    hh, mm = tm.split(":")
    nxt = (now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0))
    if nxt < now:
        nxt += timedelta(days=1)
    c.execute(
        "insert into schedules(user_id,dorm_account_id,mode,sign_time,sign_date,enabled,remark,location_id,last_status,next_run_at,created_at) values(?,?,?,?,?,?,?,?,?,?,?)",
        (uid, acc_id, mode, tm, sd, en, rk, lid, st, nxt.strftime("%Y-%m-%d %H:%M:%S"), now0),
    )
    sid.append(c.lastrowid)

# 日志：10 成功 2 失败，跨两天
rows = []
for i in range(12):
    ok = i not in (3, 8)
    back = timedelta(hours=i * 6 + 1)
    t = now - back
    s = sid[0] if i % 3 else sid[2]
    rows.append(
        (
            uid,
            s,
            t.strftime("%Y-%m-%d %H:%M:%S"),
            1 if ok else 0,
            "签到成功" if ok else "签到失败：定位不在范围内",
            "坐标 31.7061,118.5070" if ok else "距离目标位置 218m，超出 100m 允许范围",
        )
    )
c.executemany("insert into sign_logs(user_id,schedule_id,run_at,success,msg,detail) values(?,?,?,?,?,?)", rows)
db.commit()

print("locations", c.execute("select id,name,is_default from locations where user_id=?", (uid,)).fetchall())
print("schedules", c.execute("select id,sign_time,mode,enabled from schedules where user_id=?", (uid,)).fetchall())
print("logs", c.execute("select count(*),sum(success) from sign_logs where user_id=?", (uid,)).fetchone())
