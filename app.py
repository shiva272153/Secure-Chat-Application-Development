"""
SecureChat — Main Flask Application
Real-time encrypted communication with Flask-SocketIO.

Routes:
    /           → Redirect to /chat or /login
    /login      → User authentication
    /register   → User registration
    /chat       → Main chat interface (requires login)
    /logout     → End session

API:
    /api/users              → List all users
    /api/public_key/<user>  → Get user's RSA public key
    /api/messages/<user>    → Get encrypted chat history
    /api/private_key        → Get user's encrypted private key

SocketIO Events:
    connect     → Mark user online
    disconnect  → Mark user offline
    send_message → Relay encrypted message
"""

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from flask_socketio import SocketIO, emit, join_room, leave_room
from functools import wraps
from config import Config
from crypto_utils import verify_password
import models
import re
from email_service import send_otp_email, generate_otp

EMAIL_REGEX = re.compile(r"^[\w\.\+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-\.]+$")

# ──────────────────────────────────────────────
# App Initialization
# ──────────────────────────────────────────────

app = Flask(__name__)
app.config.from_object(Config)

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Map of username → socket session ID for routing messages
online_users = {}

# Initialize database indexes
models.init_db()


# ──────────────────────────────────────────────
# Auth Decorator
# ──────────────────────────────────────────────

def login_required(f):
    """Decorator to protect routes that require authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "username" not in session:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function


# ──────────────────────────────────────────────
# Page Routes
# ──────────────────────────────────────────────

@app.route("/")
def index():
    """Redirect to chat if logged in, otherwise to login."""
    if "username" in session:
        return redirect(url_for("chat"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    """User login page and authentication handler."""
    if "username" in session:
        return redirect(url_for("chat"))

    if request.method == "POST":
        is_json = request.is_json
        data = request.get_json() if is_json else request.form
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""

        if not username or not password:
            err = "Please fill in all fields."
            if is_json:
                return jsonify({"success": False, "error": err}), 400
            flash(err, "error")
            return render_template("login.html")

        user = models.get_user(username)
        if not user or not verify_password(password, user["password_hash"], user["salt"]):
            err = "Invalid username or password."
            if is_json:
                return jsonify({"success": False, "error": err}), 401
            flash(err, "error")
            return render_template("login.html")

        # Set session
        session["username"] = username
        session.permanent = True

        if is_json:
            return jsonify({"success": True, "redirect": url_for("chat")})
        return redirect(url_for("chat"))

    return render_template("login.html")


@app.route("/api/send-email-otp", methods=["POST"])
def send_email_otp_endpoint():
    """
    Generate and send a 6-digit email OTP for registration.
    Validates username and email uniqueness first.
    """
    if "username" in session:
        return jsonify({"success": False, "error": "Already logged in."}), 400

    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    username = (data.get("username") or "").strip().lower()

    if not email:
        return jsonify({"success": False, "error": "Email address is required."}), 400

    if not EMAIL_REGEX.match(email):
        return jsonify({"success": False, "error": "Please enter a valid email address."}), 400

    if not username or len(username) < 3:
        return jsonify({"success": False, "error": "Username must be at least 3 characters."}), 400

    # Check if username is already registered
    if models.get_user(username):
        return jsonify({"success": False, "error": "This username is already taken. Please choose another."}), 409

    # Check if email is already registered
    if models.get_user_by_email(email):
        return jsonify({"success": False, "error": "An account with this email already exists. Please log in."}), 409

    # Rate limiting: minimum cooldown between resends
    existing_otp = models.get_latest_email_otp(email)
    if existing_otp and existing_otp.get("created_at"):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        created = existing_otp["created_at"]
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        elapsed = (now - created).total_seconds()
        if elapsed < Config.OTP_RESEND_COOLDOWN_SECONDS:
            wait_time = int(Config.OTP_RESEND_COOLDOWN_SECONDS - elapsed)
            return jsonify({
                "success": False,
                "error": f"Please wait {wait_time}s before requesting another verification code."
            }), 429

    # Generate 6-digit OTP
    otp_code = generate_otp(6)

    # Save OTP to MongoDB with expiry
    models.save_email_otp(email, otp_code, expiry_minutes=Config.OTP_EXPIRY_MINUTES)

    # Send email
    send_otp_email(to_email=email, otp_code=otp_code, username=username)

    return jsonify({
        "success": True,
        "message": f"Verification code sent to {email}",
        "email": email,
        "expires_in_minutes": Config.OTP_EXPIRY_MINUTES
    })


@app.route("/register", methods=["GET", "POST"])
def register():
    """User registration page and handler with email OTP verification."""
    if "username" in session:
        return redirect(url_for("chat"))

    if request.method == "POST":
        is_json = request.is_json
        data = request.get_json() if is_json else request.form
        username = (data.get("username") or "").strip().lower()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        confirm_password = data.get("confirm_password") or ""
        otp = (data.get("otp") or "").strip()
        public_key = data.get("public_key") or ""
        encrypted_private_key = data.get("encrypted_private_key") or ""
        private_key_iv = data.get("private_key_iv") or ""
        private_key_salt = data.get("private_key_salt") or ""

        # Validation
        if not all([username, email, password, confirm_password, otp, public_key,
                     encrypted_private_key, private_key_iv, private_key_salt]):
            err = "All fields, including email and the 6-digit OTP, are required."
            if is_json:
                return jsonify({"success": False, "error": err}), 400
            flash(err, "error")
            return render_template("register.html")

        if len(username) < 3:
            err = "Username must be at least 3 characters."
            if is_json:
                return jsonify({"success": False, "error": err}), 400
            flash(err, "error")
            return render_template("register.html")

        if not EMAIL_REGEX.match(email):
            err = "Please enter a valid email address."
            if is_json:
                return jsonify({"success": False, "error": err}), 400
            flash(err, "error")
            return render_template("register.html")

        if len(password) < 8:
            err = "Password must be at least 8 characters."
            if is_json:
                return jsonify({"success": False, "error": err}), 400
            flash(err, "error")
            return render_template("register.html")

        if password != confirm_password:
            err = "Passwords do not match."
            if is_json:
                return jsonify({"success": False, "error": err}), 400
            flash(err, "error")
            return render_template("register.html")

        # Verify Email OTP
        is_otp_valid, otp_err = models.verify_email_otp(email, otp)
        if not is_otp_valid:
            if is_json:
                return jsonify({"success": False, "error": otp_err}), 400
            flash(otp_err, "error")
            return render_template("register.html")

        # Hash password with PBKDF2
        salt = generate_salt()
        password_hash = hash_password(password, salt)

        # Store user with encrypted keypair and verified email
        success = models.create_user(
            username=username,
            password_hash=password_hash,
            salt=salt,
            public_key=public_key,
            encrypted_private_key=encrypted_private_key,
            private_key_iv=private_key_iv,
            private_key_salt=private_key_salt,
            email=email,
        )

        if not success:
            err = "Username or email is already registered."
            if is_json:
                return jsonify({"success": False, "error": err}), 409
            flash(err, "error")
            return render_template("register.html")

        # Clean up used OTP
        models.delete_email_otp(email)

        # Automatically log user into session
        session["username"] = username
        session.permanent = True

        if is_json:
            return jsonify({"success": True, "redirect": url_for("chat")})
        flash("Account created! Welcome to SecureChat.", "success")
        return redirect(url_for("chat"))

    return render_template("register.html")


@app.route("/chat")
@login_required
def chat():
    """Main chat interface."""
    user = models.get_user(session["username"]) or {}
    return render_template("chat.html",
                           username=session["username"],
                           display_name=user.get("display_name", session["username"]),
                           bio=user.get("bio", "Hey there! I am using SecureChat."),
                           avatar=user.get("avatar", ""),
                           encrypted_private_key=user.get("encrypted_private_key", ""),
                           private_key_iv=user.get("private_key_iv", ""),
                           private_key_salt=user.get("private_key_salt", ""))


@app.route("/api/profile", methods=["GET", "POST"])
@login_required
def api_profile():
    """Get or update current user's profile (name, bio, avatar)."""
    username = session["username"]
    if request.method == "POST":
        data = request.get_json() or {}
        display_name = (data.get("display_name") or username).strip()[:50]
        bio = (data.get("bio") or "").strip()[:200]
        avatar = data.get("avatar")  # Can be base64 data URL or ""

        # Limit avatar data size to ~1.5MB max to prevent database bloat
        if avatar and len(avatar) > 1_500_000:
            return jsonify({"success": False, "error": "Image is too large (max 1MB)."}), 400

        models.update_user_profile(username, display_name, bio, avatar)

        # Notify other connected clients about the profile update
        socketio.emit("profile_updated", {
            "username": username,
            "display_name": display_name,
            "bio": bio,
            "avatar": avatar,
        })

        return jsonify({
            "success": True,
            "profile": {
                "username": username,
                "display_name": display_name,
                "bio": bio,
                "avatar": avatar,
            }
        })

    user = models.get_user(username) or {}
    return jsonify({
        "username": username,
        "display_name": user.get("display_name", username),
        "bio": user.get("bio", "Hey there! I am using SecureChat."),
        "avatar": user.get("avatar", ""),
    })


@app.route("/logout")
def logout():
    """Clear session and log out."""
    username = session.pop("username", None)
    if username:
        models.set_user_online(username, False)
        # Notify other users about the status change
        socketio.emit("user_status", {"username": username, "online": False})
    flash("You have been logged out.", "info")
    return redirect(url_for("login"))


# ──────────────────────────────────────────────
# API Routes
# ──────────────────────────────────────────────

@app.route("/api/conversations")
@login_required
def api_conversations():
    """Get list of users with whom current user has an active conversation."""
    conversations = models.get_user_conversations(session["username"])
    return jsonify(conversations)


@app.route("/api/users")
@login_required
def api_users():
    """
    Search users or get active conversation contacts.
    Never exposes all users in the database by default.
    """
    q = request.args.get("q", "").strip()
    if q:
        users = models.search_users(q, exclude_username=session["username"])
    else:
        # Default to existing conversations to protect user privacy
        users = models.get_user_conversations(session["username"])
    return jsonify(users)


@app.route("/api/search_users")
@login_required
def api_search_users():
    """Search registered users by username substring or exact match."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    results = models.search_users(q, exclude_username=session["username"])
    return jsonify(results)


@app.route("/api/public_key/<username>")
@login_required
def api_public_key(username):
    """Get a user's RSA public key for key exchange."""
    public_key = models.get_public_key(username)
    if public_key:
        return jsonify({"public_key": public_key})
    return jsonify({"error": "User not found"}), 404


@app.route("/api/messages/<username>")
@login_required
def api_messages(username):
    """Get encrypted chat history between current user and specified user."""
    current_user = session["username"]
    messages = models.get_chat_history(current_user, username)
    return jsonify(messages)


@app.route("/api/private_key")
@login_required
def api_private_key():
    """Get current user's encrypted private key for client-side decryption."""
    user = models.get_user(session["username"])
    if user:
        return jsonify({
            "encrypted_private_key": user["encrypted_private_key"],
            "private_key_iv": user["private_key_iv"],
            "private_key_salt": user["private_key_salt"],
        })
    return jsonify({"error": "User not found"}), 404


# ──────────────────────────────────────────────
# Group Chat API Endpoints (Max 60 Members)
# ──────────────────────────────────────────────

@app.route("/api/groups", methods=["GET"])
@login_required
def api_get_groups():
    """Get all groups current user is a member of."""
    username = session["username"]
    groups = models.get_user_groups(username)
    return jsonify({"success": True, "groups": groups})


@app.route("/api/groups", methods=["POST"])
@login_required
def api_create_group():
    """Create a new group (strict limit: 60 members)."""
    username = session["username"]
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    description = data.get("description", "").strip()
    avatar = data.get("avatar", "").strip()
    members = data.get("members", [])

    if not name:
        return jsonify({"success": False, "error": "Group name is required."}), 400

    if not isinstance(members, list):
        members = []

    # Member limit validation: creator + members <= 60
    members_set = set(m.strip() for m in members if m and m.strip())
    members_set.add(username)
    if len(members_set) > Config.GROUP_MAX_MEMBERS:
        return jsonify({
            "success": False,
            "error": f"Groups cannot have more than {Config.GROUP_MAX_MEMBERS} members."
        }), 400

    group = models.create_group(
        name=name,
        creator=username,
        member_usernames=list(members_set),
        description=description,
        avatar=avatar
    )
    if not group:
        return jsonify({"success": False, "error": "Failed to create group. Ensure members exist."}), 400

    # Notify all online group members via their personal socket rooms
    for member_name in group["members"]:
        socketio.emit("group_created", group, room=member_name)

    return jsonify({"success": True, "group": group})


@app.route("/api/groups/<group_id>", methods=["GET"])
@login_required
def api_get_group_details(group_id):
    """Get group metadata and member details (including public keys for encryption)."""
    username = session["username"]
    group = models.get_group(group_id)
    if not group:
        return jsonify({"success": False, "error": "Group not found."}), 404

    if username not in group.get("members", []):
        return jsonify({"success": False, "error": "You are not a member of this group."}), 403

    members = models.get_group_members(group_id)
    return jsonify({
        "success": True,
        "group": group,
        "members": members,
        "max_members": Config.GROUP_MAX_MEMBERS
    })


@app.route("/api/groups/<group_id>/members", methods=["POST"])
@login_required
def api_add_group_member(group_id):
    """Add a member to the group (enforcing 60-member limit)."""
    username = session["username"]
    data = request.get_json() or {}
    new_username = data.get("username", "").strip()

    if not new_username:
        return jsonify({"success": False, "error": "Username is required."}), 400

    success, msg = models.add_group_member(group_id, new_username, added_by=username)
    if not success:
        return jsonify({"success": False, "error": msg}), 400

    group = models.get_group(group_id)
    members = models.get_group_members(group_id)

    # Broadcast update to group room and notify the new member
    socketio.emit("group_updated", {"group": group, "members": members}, room=group_id)
    socketio.emit("group_created", group, room=new_username)

    return jsonify({"success": True, "message": msg, "group": group, "members": members})


@app.route("/api/groups/<group_id>/members/<target_user>", methods=["DELETE"])
@login_required
def api_remove_group_member(group_id, target_user):
    """Remove a member or leave group."""
    username = session["username"]
    success, msg = models.remove_group_member(group_id, target_user, requester=username)
    if not success:
        return jsonify({"success": False, "error": msg}), 400

    group = models.get_group(group_id)
    if group:
        members = models.get_group_members(group_id)
        socketio.emit("group_updated", {"group": group, "members": members}, room=group_id)
    socketio.emit("group_left", {"group_id": group_id, "username": target_user}, room=target_user)

    return jsonify({"success": True, "message": msg})


@app.route("/api/groups/<group_id>/messages", methods=["GET"])
@login_required
def api_group_messages(group_id):
    """Get encrypted chat history for a group."""
    username = session["username"]
    group = models.get_group(group_id)
    if not group or username not in group.get("members", []):
        return jsonify({"error": "Access denied"}), 403

    messages = models.get_group_chat_history(group_id)
    return jsonify(messages)


# ──────────────────────────────────────────────
# SocketIO Events
# ──────────────────────────────────────────────

@socketio.on("connect")
def handle_connect():
    """Handle user connecting to WebSocket."""
    username = session.get("username")
    if username:
        online_users[username] = request.sid
        join_room(username)  # Personal room for DMs and direct notifications
        # Also join rooms for each group the user is in
        user_groups = models.get_user_groups(username)
        for g in user_groups:
            join_room(g["group_id"])
        models.set_user_online(username, True)
        emit("user_status", {"username": username, "online": True}, broadcast=True)
        print(f"[+] {username} connected (sid: {request.sid})")


@socketio.on("disconnect")
def handle_disconnect(*args, **kwargs):
    """Handle user disconnecting from WebSocket."""
    username = session.get("username")
    if username:
        online_users.pop(username, None)
        leave_room(username)
        models.set_user_online(username, False)
        emit("user_status", {"username": username, "online": False}, broadcast=True)
        print(f"[-] {username} disconnected")


@socketio.on("join_group_room")
def handle_join_group_room(data):
    """Join a specific group room upon group creation or selection."""
    username = session.get("username")
    group_id = data.get("group_id") if isinstance(data, dict) else None
    if username and group_id:
        group = models.get_group(group_id)
        if group and username in group.get("members", []):
            join_room(group_id)


@socketio.on("group_send_message")
def handle_group_send_message(data):
    """
    Relay an encrypted group message to all group members.
    The server stores ONLY ciphertext and member-specific encrypted AES keys.
    """
    sender = session.get("username")
    if not sender:
        return

    group_id = data.get("group_id")
    ciphertext = data.get("ciphertext")
    iv = data.get("iv")
    encrypted_keys = data.get("encrypted_keys")  # { member_username: encrypted_aes_key }

    if not all([group_id, ciphertext, iv, isinstance(encrypted_keys, dict)]):
        emit("error", {"message": "Invalid group message data"})
        return

    group = models.get_group(group_id)
    if not group or sender not in group.get("members", []):
        emit("error", {"message": "You are not a member of this group."})
        return

    # Store encrypted message in database
    models.store_group_message(
        group_id=group_id,
        sender=sender,
        ciphertext=ciphertext,
        iv=iv,
        encrypted_keys=encrypted_keys
    )

    from datetime import datetime, timezone
    message_data = {
        "group_id": group_id,
        "sender": sender,
        "ciphertext": ciphertext,
        "iv": iv,
        "encrypted_keys": encrypted_keys,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Broadcast to all members in the group room
    emit("receive_group_message", message_data, room=group_id)


@socketio.on("send_message")
def handle_send_message(data):
    """
    Relay an encrypted message from sender to recipient.
    The server NEVER decrypts the message content.

    Expected data:
        recipient: str
        ciphertext: str (Base64 AES-GCM encrypted message)
        iv: str (Base64 initialization vector)
        encrypted_aes_key: str (Base64 AES key encrypted with recipient's RSA public key)
        sender_encrypted_aes_key: str (Base64 AES key encrypted with sender's RSA public key)
    """
    sender = session.get("username")
    if not sender:
        return

    recipient = data.get("recipient")
    ciphertext = data.get("ciphertext")
    iv = data.get("iv")
    encrypted_aes_key = data.get("encrypted_aes_key")
    sender_encrypted_aes_key = data.get("sender_encrypted_aes_key")

    if not all([recipient, ciphertext, iv, encrypted_aes_key, sender_encrypted_aes_key]):
        emit("error", {"message": "Invalid message data"})
        return

    # Store encrypted message in database
    models.store_message(
        sender=sender,
        recipient=recipient,
        ciphertext=ciphertext,
        iv=iv,
        encrypted_aes_key=encrypted_aes_key,
        sender_encrypted_aes_key=sender_encrypted_aes_key,
    )

    # Build message payload
    message_data = {
        "sender": sender,
        "recipient": recipient,
        "ciphertext": ciphertext,
        "iv": iv,
        "encrypted_aes_key": encrypted_aes_key,
        "sender_encrypted_aes_key": sender_encrypted_aes_key,
        "timestamp": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    }

    # Send to recipient if online (via their personal room)
    emit("receive_message", message_data, room=recipient)

    # Confirm delivery to sender
    emit("message_sent", message_data)


@socketio.on("typing")
def handle_typing(data):
    """Broadcast typing indicator to the recipient."""
    sender = session.get("username")
    recipient = data.get("recipient")
    if sender and recipient:
        emit("user_typing", {"username": sender}, room=recipient)


@socketio.on("stop_typing")
def handle_stop_typing(data):
    """Broadcast stop-typing indicator to the recipient."""
    sender = session.get("username")
    recipient = data.get("recipient")
    if sender and recipient:
        emit("user_stop_typing", {"username": sender}, room=recipient)


@socketio.on("group_typing")
def handle_group_typing(data):
    """Broadcast typing indicator to group members."""
    sender = session.get("username")
    group_id = data.get("group_id") if isinstance(data, dict) else None
    if sender and group_id:
        emit("group_user_typing", {"group_id": group_id, "username": sender}, room=group_id, include_self=False)


@socketio.on("group_stop_typing")
def handle_group_stop_typing(data):
    """Broadcast stop typing indicator to group members."""
    sender = session.get("username")
    group_id = data.get("group_id") if isinstance(data, dict) else None
    if sender and group_id:
        emit("group_user_stop_typing", {"group_id": group_id, "username": sender}, room=group_id, include_self=False)


# ──────────────────────────────────────────────
# Run
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("\n[+] SecureChat Server Starting...")
    print("    Running at: http://127.0.0.1:5000\n")
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)
