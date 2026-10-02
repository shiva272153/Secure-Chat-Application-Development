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
from crypto_utils import generate_salt, hash_password, verify_password
import models

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


@app.route("/register", methods=["GET", "POST"])
def register():
    """User registration page and handler."""
    if "username" in session:
        return redirect(url_for("chat"))

    if request.method == "POST":
        is_json = request.is_json
        data = request.get_json() if is_json else request.form
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        confirm_password = data.get("confirm_password") or ""
        public_key = data.get("public_key") or ""
        encrypted_private_key = data.get("encrypted_private_key") or ""
        private_key_iv = data.get("private_key_iv") or ""
        private_key_salt = data.get("private_key_salt") or ""

        # Validation
        if not all([username, password, confirm_password, public_key,
                     encrypted_private_key, private_key_iv, private_key_salt]):
            err = "All fields are required."
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

        # Hash password with PBKDF2
        salt = generate_salt()
        password_hash = hash_password(password, salt)

        # Store user with encrypted keypair
        success = models.create_user(
            username=username,
            password_hash=password_hash,
            salt=salt,
            public_key=public_key,
            encrypted_private_key=encrypted_private_key,
            private_key_iv=private_key_iv,
            private_key_salt=private_key_salt,
        )

        if not success:
            err = "Username already exists."
            if is_json:
                return jsonify({"success": False, "error": err}), 409
            flash(err, "error")
            return render_template("register.html")

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
# SocketIO Events
# ──────────────────────────────────────────────

@socketio.on("connect")
def handle_connect():
    """Handle user connecting to WebSocket."""
    username = session.get("username")
    if username:
        online_users[username] = request.sid
        join_room(username)  # Each user joins their own room for DMs
        models.set_user_online(username, True)
        emit("user_status", {"username": username, "online": True}, broadcast=True)
        print(f"[+] {username} connected (sid: {request.sid})")


@socketio.on("disconnect")
def handle_disconnect():
    """Handle user disconnecting from WebSocket."""
    username = session.get("username")
    if username:
        online_users.pop(username, None)
        leave_room(username)
        models.set_user_online(username, False)
        emit("user_status", {"username": username, "online": False}, broadcast=True)
        print(f"[-] {username} disconnected")


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
