# -*- coding: utf-8 -*-
"""本地验证：安全模块 + 配置迁移"""
import asyncio
import sys

sys.path.insert(0, r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto")


async def main():
    from app.core import config
    s = config.settings
    print("SECRET_KEY 已配置:", bool(s.SECRET_KEY))
    print("DORM_PASSWORD_ENCRYPT_KEY 已配置:", bool(s.DORM_PASSWORD_ENCRYPT_KEY))
    print("DORM_TASK_ID:", s.DORM_TASK_ID or "(空)")
    print("DATABASE_URL:", s.DATABASE_URL)
    print("SCHEDULER_ENABLED:", s.SCHEDULER_ENABLED)

    import json
    from pathlib import Path
    legacy = json.loads((Path(r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\legacy\config.json")).read_text(encoding="utf-8"))
    print("密钥与 legacy 一致:",
          s.SECRET_KEY == legacy["security"]["secret_key"] and
          s.DORM_PASSWORD_ENCRYPT_KEY == legacy["security"]["dorm_password_encrypt_key"])

    from app.core import security
    # 1) 密码哈希 + 验证（Argon2 新格式）
    h = await security.hash_password("test-pass-123")
    print("Argon2 哈希前缀:", h[:10], "验证通过:", await security.verify_password("test-pass-123", h))
    print("错误密码被拒:", not await security.verify_password("wrong", h))
    # 2) 旧 werkzeug pbkdf2 哈希兼容
    from werkzeug.security import generate_password_hash
    old = generate_password_hash("legacy-pass-456")
    print("旧 pbkdf2 兼容验证:", await security.verify_password("legacy-pass-456", old))
    print("旧 pbkdf2 错误密码被拒:", not await security.verify_password("no", old))
    # 3) JWT 签发/校验
    t = security.create_token({"sub": "7"})
    print("JWT 校验:", security.verify_token(t)["sub"] == "7")
    print("JWT 用户 id:", security.extract_user_id(t))
    # 4) AES 加解密（密钥来自 legacy 迁移）
    enc = security.encrypt_password("dorm-pass-789")
    print("AES 解密一致:", security.decrypt_password(enc) == "dorm-pass-789")
    # 5) 学号脱敏
    print("脱敏:", security.mask_student_id("2021012345"), security.mask_student_id("123456"))
    # 6) 与旧 crypto 的互操作（旧库密文可被新模块解密）
    sys.path.insert(0, r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\legacy")
    import crypto as legacy_crypto
    old_enc = legacy_crypto.encrypt(s.DORM_PASSWORD_ENCRYPT_KEY, "interop-check")
    print("旧密文新模块解密:", security.decrypt_password(old_enc) == "interop-check")
    new_enc = security.encrypt_password("interop-check")
    print("新密文旧模块解密:", legacy_crypto.decrypt(s.DORM_PASSWORD_ENCRYPT_KEY, new_enc) == "interop-check")


asyncio.run(main())
print("SECURITY_VERIFY_DONE")
