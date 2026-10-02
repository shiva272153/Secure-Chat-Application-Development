"""
SecureChat — Server-Side Cryptography Utilities
Handles password hashing with PBKDF2-HMAC-SHA256 and salt generation.
All message encryption/decryption happens CLIENT-SIDE (Web Crypto API).
"""

import os
import hashlib
import base64
from config import Config


def generate_salt() -> str:
    """Generate a cryptographically secure random salt."""
    salt = os.urandom(Config.SALT_LENGTH)
    return base64.b64encode(salt).decode("utf-8")


def hash_password(password: str, salt: str) -> str:
    """
    Hash a password using PBKDF2-HMAC-SHA256.

    Args:
        password: The plaintext password.
        salt: Base64-encoded salt string.

    Returns:
        Base64-encoded password hash.
    """
    salt_bytes = base64.b64decode(salt.encode("utf-8"))
    dk = hashlib.pbkdf2_hmac(
        Config.PBKDF2_HASH_ALGO,
        password.encode("utf-8"),
        salt_bytes,
        Config.PBKDF2_ITERATIONS,
        dklen=Config.HASH_LENGTH,
    )
    return base64.b64encode(dk).decode("utf-8")


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """
    Verify a password against a stored PBKDF2 hash.

    Args:
        password: The plaintext password to verify.
        stored_hash: The stored Base64-encoded password hash.
        salt: The stored Base64-encoded salt.

    Returns:
        True if the password matches, False otherwise.
    """
    computed_hash = hash_password(password, salt)
    # Constant-time comparison to prevent timing attacks
    return hmac_compare(computed_hash, stored_hash)


def hmac_compare(a: str, b: str) -> bool:
    """Constant-time string comparison to prevent timing attacks."""
    import hmac
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
