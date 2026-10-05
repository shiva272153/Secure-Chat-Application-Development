"""
SecureChat Configuration
Loads environment variables and defines application settings.
"""

import os
import secrets
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Application configuration loaded from environment variables."""

    SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/securechat")
    SESSION_TYPE = "filesystem"
    SESSION_PERMANENT = False
    PERMANENT_SESSION_LIFETIME = 3600  # 1 hour

    # PBKDF2 settings for password hashing
    PBKDF2_ITERATIONS = 100_000
    PBKDF2_HASH_ALGO = "sha256"
    SALT_LENGTH = 32  # 256-bit salt
    HASH_LENGTH = 32  # 256-bit derived key

    # Email / SMTP Settings (Gmail)
    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.getenv("MAIL_PORT", 587))
    MAIL_USE_TLS = os.getenv("MAIL_USE_TLS", "true").lower() in ("true", "1", "yes")
    MAIL_USERNAME = os.getenv("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.getenv("MAIL_DEFAULT_SENDER", "") or os.getenv("MAIL_USERNAME", "") or "SecureChat <noreply@securechat.io>"

    # OTP Settings
    OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", 10))
    OTP_RESEND_COOLDOWN_SECONDS = int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", 60))

    # Group Chat Settings
    GROUP_MAX_MEMBERS = int(os.getenv("GROUP_MAX_MEMBERS", 60))



