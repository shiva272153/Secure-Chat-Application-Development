"""
SecureChat — MongoDB Document Models & Database Helpers
Manages users and encrypted messages collections.
"""

from datetime import datetime, timezone
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError
from config import Config

# MongoDB client and database
client = MongoClient(Config.MONGO_URI)
db = client.securechat

# Collections
users_collection = db.users
messages_collection = db.messages


def init_db():
    """Initialize database indexes for performance and uniqueness."""
    users_collection.create_index("username", unique=True)
    messages_collection.create_index([("sender", ASCENDING), ("recipient", ASCENDING)])
    messages_collection.create_index([("timestamp", ASCENDING)])


# ──────────────────────────────────────────────
# User Operations
# ──────────────────────────────────────────────

def create_user(username: str, password_hash: str, salt: str,
                public_key: str, encrypted_private_key: str,
                private_key_iv: str, private_key_salt: str) -> bool:
    """
    Create a new user in the database.

    Args:
        username: Unique username.
        password_hash: PBKDF2-hashed password (Base64).
        salt: Password salt (Base64).
        public_key: RSA public key (Base64 SPKI).
        encrypted_private_key: RSA private key encrypted with password-derived key (Base64).
        private_key_iv: IV used for private key encryption (Base64).
        private_key_salt: Salt used for PBKDF2 key derivation for private key encryption (Base64).

    Returns:
        True if user was created, False if username already exists.
    """
    try:
        users_collection.insert_one({
            "username": username,
            "display_name": username,
            "bio": "Hey there! I am using SecureChat.",
            "avatar": "",
            "password_hash": password_hash,
            "salt": salt,
            "public_key": public_key,
            "encrypted_private_key": encrypted_private_key,
            "private_key_iv": private_key_iv,
            "private_key_salt": private_key_salt,
            "is_online": False,
            "created_at": datetime.now(timezone.utc),
        })
        return True
    except DuplicateKeyError:
        return False


def get_user(username: str) -> dict | None:
    """Get a user document by username."""
    return users_collection.find_one({"username": username})


def update_user_profile(username: str, display_name: str, bio: str, avatar: str = None) -> bool:
    """
    Update a user's display name, bio, and profile photo avatar.
    """
    update_data = {
        "display_name": display_name.strip() if display_name else username,
        "bio": (bio or "").strip(),
    }
    if avatar is not None:
        update_data["avatar"] = avatar

    result = users_collection.update_one(
        {"username": username},
        {"$set": update_data}
    )
    return result.modified_count > 0 or result.matched_count > 0


def get_all_users(exclude_username: str = None) -> list:
    """Get all users, optionally excluding one (the current user)."""
    query = {}
    if exclude_username:
        query = {"username": {"$ne": exclude_username}}
    return list(users_collection.find(
        query,
        {"_id": 0, "username": 1, "display_name": 1, "bio": 1, "avatar": 1, "is_online": 1, "public_key": 1}
    ))


def get_user_conversations(username: str) -> list:
    """
    Get users with whom this user has an existing conversation (sent or received messages).
    Never exposes all database users — only existing chat contacts.
    """
    recipients = messages_collection.distinct("recipient", {"sender": username})
    senders = messages_collection.distinct("sender", {"recipient": username})
    partner_names = list((set(recipients) | set(senders)) - {username})

    if not partner_names:
        return []

    return list(users_collection.find(
        {"username": {"$in": partner_names}},
        {"_id": 0, "username": 1, "display_name": 1, "bio": 1, "avatar": 1, "is_online": 1, "public_key": 1}
    ))


def search_users(query: str, exclude_username: str = None, limit: int = 20) -> list:
    """
    Search for users matching a specific query string.
    Returns only users matching the search term, preserving database privacy.
    """
    import re
    if not query or not query.strip():
        return []

    clean_query = query.strip()
    regex_pattern = re.escape(clean_query)
    filter_query = {
        "username": {
            "$regex": regex_pattern,
            "$options": "i"
        }
    }
    if exclude_username:
        filter_query["username"]["$ne"] = exclude_username

    return list(users_collection.find(
        filter_query,
        {"_id": 0, "username": 1, "display_name": 1, "bio": 1, "avatar": 1, "is_online": 1, "public_key": 1}
    ).limit(limit))


def set_user_online(username: str, online: bool):
    """Update user's online status."""
    users_collection.update_one(
        {"username": username},
        {"$set": {"is_online": online}}
    )


def get_public_key(username: str) -> str | None:
    """Get a user's RSA public key."""
    user = users_collection.find_one(
        {"username": username},
        {"_id": 0, "public_key": 1}
    )
    return user["public_key"] if user else None


# ──────────────────────────────────────────────
# Message Operations
# ──────────────────────────────────────────────

def store_message(sender: str, recipient: str, ciphertext: str,
                  iv: str, encrypted_aes_key: str,
                  sender_encrypted_aes_key: str) -> str:
    """
    Store an encrypted message.
    The server NEVER sees the plaintext — only ciphertext.

    Args:
        sender: Sender's username.
        recipient: Recipient's username.
        ciphertext: AES-GCM encrypted message content (Base64).
        iv: Initialization vector for AES-GCM (Base64).
        encrypted_aes_key: AES key encrypted with recipient's RSA public key (Base64).
        sender_encrypted_aes_key: AES key encrypted with sender's RSA public key (Base64).

    Returns:
        String ID of the stored message.
    """
    result = messages_collection.insert_one({
        "sender": sender,
        "recipient": recipient,
        "ciphertext": ciphertext,
        "iv": iv,
        "encrypted_aes_key": encrypted_aes_key,
        "sender_encrypted_aes_key": sender_encrypted_aes_key,
        "timestamp": datetime.now(timezone.utc),
    })
    return str(result.inserted_id)


def get_chat_history(user1: str, user2: str, limit: int = 100) -> list:
    """
    Retrieve encrypted chat history between two users.

    Returns messages where either user is sender/recipient,
    sorted by timestamp ascending (oldest first).
    """
    messages = list(messages_collection.find(
        {
            "$or": [
                {"sender": user1, "recipient": user2},
                {"sender": user2, "recipient": user1},
            ]
        },
        {"_id": 0}
    ).sort("timestamp", ASCENDING).limit(limit))

    # Convert datetime to ISO string for JSON serialization
    for msg in messages:
        msg["timestamp"] = msg["timestamp"].isoformat()

    return messages
