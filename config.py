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
