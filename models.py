"""
SecureChat — MongoDB Document Models & Database Helpers
Manages users and encrypted messages collections.
"""

import secrets
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
email_verifications = db.email_verifications
groups_collection = db.groups
group_messages_collection = db.group_messages


def init_db():
    """Initialize database indexes for performance and uniqueness."""
    users_collection.create_index("username", unique=True)
    users_collection.create_index("email", unique=True, sparse=True)
    messages_collection.create_index([("sender", ASCENDING), ("recipient", ASCENDING)])
    messages_collection.create_index([("timestamp", ASCENDING)])
    # Auto-expire OTPs via MongoDB TTL index
    email_verifications.create_index("expires_at", expireAfterSeconds=0)
    email_verifications.create_index("email")
    # Group indexes
    groups_collection.create_index("group_id", unique=True)
    groups_collection.create_index("members")
    group_messages_collection.create_index([("group_id", ASCENDING), ("timestamp", ASCENDING)])


# ──────────────────────────────────────────────
# User Operations
# ──────────────────────────────────────────────

def create_user(username: str, password_hash: str, salt: str,
                public_key: str, encrypted_private_key: str,
                private_key_iv: str, private_key_salt: str,
                email: str = None) -> bool:
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
        email: Optional email address.

    Returns:
        True if user was created, False if username or email already exists.
    """
    try:
        doc = {
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
        }
        if email:
            doc["email"] = email.strip().lower()
        users_collection.insert_one(doc)
        return True
    except DuplicateKeyError:
        return False


def get_user(username: str) -> dict | None:
    """Get a user document by username."""
    return users_collection.find_one({"username": username})


def get_user_by_email(email: str) -> dict | None:
    """Get a user document by email address."""
    if not email:
        return None
    return users_collection.find_one({"email": email.strip().lower()})


# ──────────────────────────────────────────────
# Email OTP Verification Operations
# ──────────────────────────────────────────────

def save_email_otp(email: str, otp_code: str, expiry_minutes: int = 10) -> bool:
    """
    Store or update an OTP code for an email address with an expiration timestamp.
    """
    from datetime import timedelta
    email_clean = email.strip().lower()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=expiry_minutes)

    email_verifications.update_one(
        {"email": email_clean},
        {
            "$set": {
                "otp": otp_code,
                "created_at": now,
                "expires_at": expires_at,
                "attempts": 0,
                "verified": False,
            }
        },
        upsert=True
    )
    return True


def get_latest_email_otp(email: str) -> dict | None:
    """Get the active OTP record for an email address."""
    if not email:
        return None
    return email_verifications.find_one({"email": email.strip().lower()})


def verify_email_otp(email: str, otp_code: str) -> tuple[bool, str]:
    """
    Verify an entered OTP code against the database.
    Returns (success: bool, message: str).
    """
    email_clean = email.strip().lower()
    record = email_verifications.find_one({"email": email_clean})

    if not record:
        return False, "No verification code was sent to this email or it has expired."

    now = datetime.now(timezone.utc)
    record_expires = record.get("expires_at")
    if record_expires and record_expires.tzinfo is None:
        record_expires = record_expires.replace(tzinfo=timezone.utc)

    if record_expires and now > record_expires:
        email_verifications.delete_one({"email": email_clean})
        return False, "Verification code has expired. Please request a new one."

    # Check attempt count (max 5)
    attempts = record.get("attempts", 0)
    if attempts >= 5:
        email_verifications.delete_one({"email": email_clean})
        return False, "Too many incorrect attempts. Please request a new code."

    # Verify code
    if record.get("otp") != otp_code.strip():
        email_verifications.update_one(
            {"email": email_clean},
            {"$inc": {"attempts": 1}}
        )
        remaining = 4 - attempts
        return False, f"Incorrect verification code. {remaining} attempt(s) remaining."

    # Code is valid - mark verified
    email_verifications.update_one(
        {"email": email_clean},
        {"$set": {"verified": True}}
    )
    return True, "Email verified successfully."


def delete_email_otp(email: str):
    """Remove OTP record after successful registration."""
    if email:
        email_verifications.delete_one({"email": email.strip().lower()})



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


# ──────────────────────────────────────────────
# Group Chat Operations (Max 60 Members)
# ──────────────────────────────────────────────

def create_group(name: str, creator: str, member_usernames: list,
                 description: str = "", avatar: str = "") -> dict | None:
    """
    Create a new group with a maximum member limit of 60.

    Args:
        name: Name of the group (1-60 chars).
        creator: Username of the group creator.
        member_usernames: Initial list of member usernames.
        description: Optional group bio/topic.
        avatar: Optional base64 or URL avatar.

    Returns:
        The created group document (dict) or None if validation fails.
    """
    clean_name = (name or "").strip()
    if not clean_name:
        return None

    # De-duplicate members and always include creator
    members_set = set(m.strip() for m in member_usernames if m and m.strip())
    members_set.add(creator)
    members_list = list(members_set)

    # Validate member limit (max 60)
    if len(members_list) > Config.GROUP_MAX_MEMBERS:
        return None

    # Verify that all members actually exist in users_collection
    existing_users = users_collection.distinct("username", {"username": {"$in": members_list}})
    if creator not in existing_users:
        return None
    valid_members = [u for u in members_list if u in existing_users]

    group_id = f"grp_{secrets.token_hex(10)}"
    now = datetime.now(timezone.utc)

    doc = {
        "group_id": group_id,
        "name": clean_name[:60],
        "description": (description or "").strip()[:200],
        "avatar": avatar or "",
        "creator": creator,
        "admins": [creator],
        "members": valid_members,
        "created_at": now,
        "updated_at": now,
    }

    groups_collection.insert_one(doc)
    doc_copy = dict(doc)
    doc_copy.pop("_id", None)
    doc_copy["created_at"] = doc_copy["created_at"].isoformat()
    doc_copy["updated_at"] = doc_copy["updated_at"].isoformat()
    return doc_copy


def get_group(group_id: str) -> dict | None:
    """Get group details by group_id."""
    group = groups_collection.find_one({"group_id": group_id}, {"_id": 0})
    if group:
        if isinstance(group.get("created_at"), datetime):
            group["created_at"] = group["created_at"].isoformat()
        if isinstance(group.get("updated_at"), datetime):
            group["updated_at"] = group["updated_at"].isoformat()
    return group


def get_user_groups(username: str) -> list:
    """Get all groups that a user is a member of (excludes all other groups)."""
    clean_username = (username or "").strip()
    if not clean_username:
        return []

    groups = list(groups_collection.find(
        {"members": clean_username},
        {"_id": 0}
    ).sort("updated_at", DESCENDING))

    valid_groups = []
    for g in groups:
        members = g.get("members", [])
        if not isinstance(members, list) or clean_username not in members:
            continue
        if isinstance(g.get("created_at"), datetime):
            g["created_at"] = g["created_at"].isoformat()
        if isinstance(g.get("updated_at"), datetime):
            g["updated_at"] = g["updated_at"].isoformat()
        g["member_count"] = len(members)
        valid_groups.append(g)
    return valid_groups


def get_group_members(group_id: str) -> list:
    """
    Get full profile and public keys for all members of a group.
    Needed by the client to encrypt messages for all group participants.
    """
    group = groups_collection.find_one({"group_id": group_id}, {"members": 1})
    if not group or "members" not in group:
        return []

    return list(users_collection.find(
        {"username": {"$in": group["members"]}},
        {"_id": 0, "username": 1, "display_name": 1, "avatar": 1, "is_online": 1, "public_key": 1}
    ))


def add_group_member(group_id: str, new_username: str, added_by: str) -> tuple[bool, str]:
    """
    Add a new member to an existing group, strictly enforcing the 60-member limit.
    """
    group = groups_collection.find_one({"group_id": group_id})
    if not group:
        return False, "Group not found."

    if added_by not in group.get("members", []):
        return False, "Only existing group members can add new participants."

    members = group.get("members", [])
    if len(members) >= Config.GROUP_MAX_MEMBERS:
        return False, f"Group member limit reached (maximum {Config.GROUP_MAX_MEMBERS} members)."

    clean_user = new_username.strip()
    if clean_user in members:
        return False, f"@{clean_user} is already in this group."

    user_exists = users_collection.find_one({"username": clean_user})
    if not user_exists:
        return False, f"User @{clean_user} does not exist."

    now = datetime.now(timezone.utc)
    groups_collection.update_one(
        {"group_id": group_id},
        {
            "$addToSet": {"members": clean_user},
            "$set": {"updated_at": now}
        }
    )
    return True, f"@{clean_user} added to group."


def remove_group_member(group_id: str, target_username: str, requester: str) -> tuple[bool, str]:
    """
    Remove a member from a group or leave the group.
    Admins can remove other members; any member can leave.
    """
    group = groups_collection.find_one({"group_id": group_id})
    if not group:
        return False, "Group not found."

    members = group.get("members", [])
    admins = group.get("admins", [])

    if target_username not in members:
        return False, "User is not in this group."

    # Permission check: user can leave themselves, or an admin can remove others
    if requester != target_username and requester not in admins:
        return False, "Only group admins can remove other members."

    now = datetime.now(timezone.utc)
    new_members = [m for m in members if m != target_username]
    new_admins = [a for a in admins if a != target_username]

    if not new_members:
        # Group is empty: delete group and its messages
        groups_collection.delete_one({"group_id": group_id})
        group_messages_collection.delete_many({"group_id": group_id})
        return True, "Group dissolved as all members left."

    # If all admins left, promote the first remaining member to admin
    if not new_admins and new_members:
        new_admins = [new_members[0]]

    groups_collection.update_one(
        {"group_id": group_id},
        {
            "$set": {
                "members": new_members,
                "admins": new_admins,
                "updated_at": now
            }
        }
    )
    return True, "Member removed from group."


def store_group_message(group_id: str, sender: str, ciphertext: str,
                        iv: str, encrypted_keys: dict) -> str:
    """
    Store an encrypted group message.
    encrypted_keys maps username -> AES key encrypted with that member's RSA public key.
    The server stores only ciphertext and encrypted keys — zero plaintext is ever visible.
    """
    now = datetime.now(timezone.utc)
    result = group_messages_collection.insert_one({
        "group_id": group_id,
        "sender": sender,
        "ciphertext": ciphertext,
        "iv": iv,
        "encrypted_keys": encrypted_keys,
        "timestamp": now,
    })
    # Update group's updated_at timestamp
    groups_collection.update_one(
        {"group_id": group_id},
        {"$set": {"updated_at": now}}
    )
    return str(result.inserted_id)


def get_group_chat_history(group_id: str, limit: int = 100) -> list:
    """
    Retrieve encrypted chat history for a group, sorted by timestamp ascending.
    """
    messages = list(group_messages_collection.find(
        {"group_id": group_id},
        {"_id": 0}
    ).sort("timestamp", ASCENDING).limit(limit))

    for msg in messages:
        if isinstance(msg.get("timestamp"), datetime):
            msg["timestamp"] = msg["timestamp"].isoformat()

    return messages

