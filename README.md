<div align="center">

# 🔐 SecureChat

**End-to-End Encrypted Real-Time Communication Platform**

Real-time messaging where **only you and your recipient** can read the messages.  
Not the server. Not the database. Nobody else.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas)
[![WebCrypto](https://img.shields.io/badge/WebCrypto-RSA--2048%20%2B%20AES--256-orange?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

</div>

---

## 🏗️ Architecture

```
User A                                                        User B
  │                                                             │
  │  "Hello"                                                    │
  ▼                                                             │
AES-256-GCM Encryption                                         │
  │                                                             │
  │  Ciphertext + Encrypted AES Key                             │
  ▼                                                             │
┌───────────────────────────────────────────────────────────┐   │
│  Flask Server + MongoDB Atlas                             │   │
│  (stores ONLY ciphertext — zero knowledge of content)     │   │
└───────────────────────────────────────────────────────────┘   │
  │                                                             │
  │  Ciphertext + Encrypted AES Key                             │
  ▼                                                             ▼
                                                      AES-256-GCM Decryption
                                                                │
                                                                ▼
                                                             "Hello"
```

### Key Exchange (RSA-2048 & Hybrid Cryptography)

```
User A                                                      User B
  │                                                           │
  │──── RSA Public Key ──────────────────────────────────────►│
  │                                                           │
  │◄──── AES Key (encrypted with User A's public key) ────────│
  │                                                           │
  │────── Encrypted Messages (AES-256-GCM) ──────────────────►│
  │◄───── Encrypted Messages (AES-256-GCM) ───────────────────│
```

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔑 **RSA-2048 Key Exchange** | Each user generates an RSA keypair in the browser via WebCrypto API. Public keys are exchanged; private keys **never leave the client device unencrypted**. |
| 🔒 **AES-256-GCM Encryption** | Every message is encrypted with a fresh AES-256 key. The AES key itself is encrypted with the recipient's RSA public key (Hybrid Cryptography). |
| 🧠 **Zero-Knowledge Server** | The server and database only ever see ciphertext. Message plaintext is mathematically impossible to recover server-side. |
| 📧 **Email OTP Registration** | Two-step registration verification using Gmail SMTP. Protects against fake signups with 6-digit numeric codes, 10-minute automated MongoDB TTL expiration, and rate-limiting cooldowns. |
| 👥 **Encrypted Group Chats (Max 60)** | Multi-recipient end-to-end encrypted rooms supporting up to 60 participants per group. Employs per-message hybrid AES-256 + RSA multi-key distribution. |
| 💬 **Real-Time Messaging** | Instant message delivery via WebSocket (Socket.IO) with typing indicators and live online/offline presence. |
| 👤 **User Profiles** | Customizable display name, bio, and profile photo with real-time synchronization across all active chat sessions. |
| 🔍 **Privacy-First Search** | Users are never exposed in bulk directories — you must search by username to find and initiate a chat. |
| 📱 **Responsive Design** | Dark-themed, glassmorphic UI built for seamless use across desktop and mobile browsers. |
| 🛡️ **Secure Password Hashing** | Passwords hashed using PBKDF2 (100,000 iterations, SHA-256, 256-bit cryptographically secure salt). |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.10+, Flask 3.0, Flask-SocketIO |
| **Database** | MongoDB Atlas (PyMongo) with automated TTL indexes |
| **Email Service** | Python `smtplib` + TLS with Gmail SMTP / App Passwords & developer console fallback |
| **Cryptography (Client)** | WebCrypto API — RSA-OAEP 2048-bit, AES-256-GCM, PBKDF2 key derivation |
| **Cryptography (Server)** | Python `cryptography` — PBKDF2-HMAC-SHA256 password hashing |
| **Real-time Engine** | Socket.IO (WebSocket with polling fallback) |
| **Frontend** | Vanilla HTML5, modern CSS3 (glassmorphic theme), Vanilla ES6+ JavaScript |

---

## 📁 Project Structure

```
Securechat/
├── app.py                  # Flask application, REST routes, Socket.IO event handlers
├── config.py               # Application configuration (env vars, PBKDF2, SMTP, OTP settings)
├── crypto_utils.py         # Server-side password hashing and salt generation
├── email_service.py        # SMTP email dispatch, OTP generator, and dark HTML template
├── models.py               # MongoDB collections, indexes, and queries (users, messages, OTPs)
├── requirements.txt        # Python package dependencies
├── .env.example            # Environment variable configuration template
├── .gitignore              # Version control exclusions
│
├── static/
│   ├── css/
│   │   ├── base.css        # CSS design tokens, resets, typography, themes
│   │   ├── components.css  # Shared UI components (buttons, badges, inputs, modals)
│   │   ├── auth.css        # Login and two-step registration styling (OTP digit inputs)
│   │   ├── chat.css        # Chat layout, message bubbles, sidebar, user profiles
│   │   └── style.css       # Unified CSS loader
│   └── js/
│       ├── app.js          # Client-side app initialization and router
│       ├── auth.js         # Registration, OTP verification steps, and login forms
│       ├── chat.js         # Chat UI, contacts, message rendering, Socket.IO client
│       └── crypto.js       # Client WebCrypto API wrappers (RSA keygen, AES-GCM, PBKDF2)
│
└── templates/
    ├── base.html           # Base Jinja2 HTML layout
    ├── login.html          # Authentication login page
    ├── register.html       # Two-step registration page (User details + 6-digit OTP UI)
    └── chat.html           # Main end-to-end encrypted chat application
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **MongoDB Atlas** account (free cluster works great) — [Sign up](https://www.mongodb.com/atlas)
- **Gmail Account** (optional for real emails; built-in developer fallback works without it)

---

### 1. Clone the repository

```bash
git clone https://github.com/your-username/securechat.git
cd securechat
```

### 2. Create and activate a virtual environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Create your `.env` file from the provided template:

```bash
cp .env.example .env
```

Open `.env` and fill in your settings:

```env
# MongoDB Atlas
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/securechat?retryWrites=true&w=majority

# Flask Secret Key
SECRET_KEY=your-random-secret-key-change-this

# Gmail SMTP Configuration
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-16-character-app-password
MAIL_DEFAULT_SENDER="SecureChat <your-email@gmail.com>"
```

> [!TIP]
> **Setting up Gmail App Password:**
> 1. Turn on **2-Step Verification** on your [Google Account Security Page](https://myaccount.google.com/security).
> 2. Search for **App passwords** in Google Account or visit [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
> 3. Create a new App Password named `SecureChat` and copy the 16-character code into `MAIL_PASSWORD`.

> [!NOTE]
> **Developer Mode (Zero Setup):**  
> If `MAIL_USERNAME` or `MAIL_PASSWORD` are left blank, SecureChat automatically logs the 6-digit OTP code directly to your terminal console so you can test registration immediately.

### 5. Run the application

```bash
python app.py
```

The server will start on **http://127.0.0.1:5000**.

---

## 🔐 How Encryption & Verification Work

### 1. Two-Step Registration & Email Verification
1. User provides **Username**, **Email**, and **Password**.
2. Client requests an OTP via `POST /api/send-email-otp`.
3. Server generates a cryptographically secure 6-digit OTP, saves it in MongoDB with an automated **10-minute TTL expiry**, and dispatches an email via SMTP.
4. User enters the 6-digit OTP code in the registration screen.
5. Upon verification, the browser WebCrypto engine:
   - Generates an **RSA-OAEP 2048-bit keypair**.
   - Derives a key encryption key from the user's password via **PBKDF2**.
   - Encrypts the private key with **AES-256-GCM**.
6. The client sends the registration payload (Username, Email, Hashed Password, RSA Public Key, Encrypted Private Key, and OTP).
7. Server validates the OTP in the database and creates the user account. **The plaintext private key never touches the server**.

### 2. Sending an Encrypted Message
1. User initiates a chat with another user. The client fetches the recipient's **RSA Public Key** from `/api/public_key/<username>`.
2. A unique single-use **AES-256-GCM key** is generated in the sender's browser.
3. The message is encrypted with this AES key.
4. The AES key itself is encrypted with the recipient's RSA public key.
5. The ciphertext bundle is transmitted via Socket.IO to the server.
6. The server stores only the ciphertext bundle in MongoDB. It has **zero knowledge** of the plaintext.

### 3. Receiving & Decrypting a Message
1. Recipient receives the ciphertext bundle via Socket.IO.
2. The browser decrypts the AES key using the user's local RSA private key.
3. The decrypted AES key decrypts the message plaintext.
4. The message renders in the chat UI.

### 4. Encrypted Group Chats (Strict Limit: 60 Members)
1. **Creation & Limit:** Any authenticated user can create a group with up to 60 members (enforced both client-side and server-side).
2. **Hybrid Key Distribution:**
   - Sender generates a single ephemeral **AES-256-GCM key** for the message.
   - The message payload is encrypted once with this AES key.
   - The AES key is then encrypted individually for each member in the group (up to 60) using their respective **RSA-2048 public key** (`encrypted_keys: { [username]: cipherAESKey }`).
3. **Decryption:**
   - Each group recipient receives the message bundle from their room channel.
   - The recipient extracts their encrypted key from `encrypted_keys[currentUsername]`.
   - The recipient decrypts the AES key using their local RSA private key, then decrypts the message body.
4. **Zero Knowledge:** The server only receives and relays the ciphertext and key map. It can never inspect group communications.

---

## 🧪 Testing

Open **two separate browser windows** (or one normal window and one Incognito window):

1. **Window 1:** Register user `alice` with her email. Enter the OTP code and log in.
2. **Window 2:** Register user `bob` with his email. Enter the OTP code and log in.
3. Search for `bob` from `alice`'s window and send a message.
4. Messages appear instantly in real time on both screens.
5. Create a group named "Project Alpha", add members, and send encrypted group messages.
6. Check your MongoDB database: you will find only encrypted ciphertext strings and initialization vectors (IVs) — never plaintext messages!

---

## 📋 API Reference

### HTTP Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Redirect to `/chat` (or `/login` if unauthenticated) |
| `GET/POST` | `/login` | User login (session authentication) |
| `GET/POST` | `/register` | User registration (requires verified OTP) |
| `GET` | `/chat` | Main application chat interface |
| `GET` | `/logout` | Terminate session and log out |
| `POST` | `/api/send-email-otp` | Request a 6-digit verification code to user email |
| `GET` | `/api/conversations` | Retrieve current user's active direct conversations |
| `GET` | `/api/messages/<username>` | Retrieve encrypted message history with a user |
| `GET` | `/api/public_key/<username>` | Retrieve a user's RSA-2048 public key |
| `GET` | `/api/search_users?q=<query>` | Search users by username |
| `GET/POST` | `/api/profile` | Retrieve or update user display profile (name, bio, photo) |
| `GET` | `/api/groups` | Retrieve all groups the current user belongs to |
| `POST` | `/api/groups` | Create an encrypted group (strictly <= 60 members) |
| `GET` | `/api/groups/<group_id>` | Get group metadata and member profile list |
| `POST` | `/api/groups/<group_id>/members` | Add a member to a group (enforces 60-member limit) |
| `DELETE` | `/api/groups/<group_id>/members/<username>` | Leave group or remove a member (admin only) |
| `GET` | `/api/groups/<group_id>/messages` | Retrieve encrypted group chat history |

### WebSocket (Socket.IO) Events

| Event | Direction | Description |
|---|---|---|
| `send_message` | Client → Server | Dispatches an encrypted direct message bundle |
| `receive_message` | Server → Client | Delivers an encrypted message to the recipient |
| `message_sent` | Server → Client | Delivery confirmation to sender |
| `join_group_room` | Client → Server | Joins Socket.IO room for real-time group broadcasts |
| `group_send_message` | Client → Server | Dispatches encrypted group message with multi-key bundle |
| `receive_group_message` | Server → Client | Relays encrypted group message to all room members |
| `group_typing` / `group_stop_typing` | Client ↔ Server | Live typing indicator broadcast in group room |
| `user_status` | Server → Client | Broadcasts online/offline status updates |
| `user_typing` / `user_stop_typing` | Client ↔ Server | Direct chat typing indicators |
| `profile_updated` | Server → Client | Broadcasts real-time profile changes |
| `group_created` / `group_updated` / `group_left` | Server → Client | Real-time group state synchronization |

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with 🔐 cryptography and ❤️**

*Messages are encrypted before they leave your device. Your privacy is not a feature — it's the architecture.*

</div>
