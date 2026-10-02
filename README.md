<div align="center">

# 🔐 SecureChat

**End-to-End Encrypted Communication Platform**

Real-time messaging where **only you and your recipient** can read the messages.  
Not the server. Not the database. Nobody else.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

</div>

---

## 🏗️ Architecture

```
User A                                          User B
  │                                               │
  │  "Hello"                                      │
  ▼                                               │
AES-256-GCM Encryption                           │
  │                                               │
  │  Ciphertext + Encrypted AES Key               │
  ▼                                               │
┌─────────────────────────────────┐               │
│  Flask Server + MongoDB Atlas   │               │
│  (stores ONLY ciphertext —      │               │
│   zero knowledge of content)    │               │
└─────────────────────────────────┘               │
  │                                               │
  │  Ciphertext + Encrypted AES Key               │
  ▼                                               ▼
                                        AES-256-GCM Decryption
                                                  │
                                                  ▼
                                               "Hello"
```

### Key Exchange (RSA-2048)

```
User A                              User B
  │                                   │
  │──── RSA Public Key ──────────────►│
  │                                   │
  │◄──── AES Key (encrypted with ─────│
  │       User A's public key)        │
  │                                   │
  │────── Encrypted Messages ────────►│
  │◄───── Encrypted Messages ─────────│
```

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔑 **RSA-2048 Key Exchange** | Each user generates an RSA keypair in the browser via WebCrypto API. Public keys are exchanged; private keys **never leave the device**. |
| 🔒 **AES-256-GCM Encryption** | Every message is encrypted with a fresh AES-256 key. The AES key itself is encrypted with the recipient's RSA public key. |
| 🧠 **Zero-Knowledge Server** | The server and database only ever see ciphertext. Message plaintext is impossible to recover server-side. |
| 💬 **Real-Time Messaging** | Instant message delivery via WebSocket (Socket.IO) with typing indicators and online status. |
| 👤 **User Profiles** | Customizable display name, bio, and profile photo with real-time sync across all connected clients. |
| 🔍 **Privacy-First Search** | Users are never leaked in bulk — you must search by username to find someone. |
| 📱 **Responsive Design** | Dark-themed, glassmorphic UI built for desktop and mobile. |
| 🔐 **Secure Password Storage** | Passwords are hashed with PBKDF2 (100,000 iterations, SHA-256, 256-bit salt). |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.10+, Flask 3.0, Flask-SocketIO |
| **Database** | MongoDB Atlas (PyMongo) |
| **Cryptography (server)** | PBKDF2 password hashing via Python `cryptography` |
| **Cryptography (client)** | WebCrypto API — RSA-OAEP 2048-bit, AES-256-GCM |
| **Real-time** | Socket.IO (WebSocket with polling fallback) |
| **Frontend** | Vanilla HTML/CSS/JS, modular CSS architecture |

---

## 📁 Project Structure

```
Securechat/
├── app.py                  # Flask application, routes, Socket.IO events
├── config.py               # Configuration (env vars, PBKDF2 settings)
├── crypto_utils.py         # Server-side password hashing utilities
├── models.py               # MongoDB data access layer
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variable template
│
├── static/
│   ├── css/
│   │   ├── base.css        # CSS variables, resets, typography
│   │   ├── components.css  # Reusable component styles (buttons, inputs)
│   │   ├── auth.css        # Login / Register page styles
│   │   ├── chat.css        # Chat interface, sidebar, modals, profiles
│   │   └── style.css       # CSS module imports
│   └── js/
│       ├── app.js          # App entrypoint & initialization
│       ├── auth.js         # Registration & login form handling
│       ├── chat.js         # Chat UI, contacts, profile, Socket.IO client
│       └── crypto.js       # WebCrypto wrappers (RSA, AES, key management)
│
└── templates/
    ├── base.html           # Base Jinja2 layout
    ├── login.html          # Login page
    ├── register.html       # Registration page
    └── chat.html           # Main chat interface
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **MongoDB Atlas** account (free tier works) — [Get started](https://www.mongodb.com/atlas)
- **pip** (Python package manager)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/securechat.git
cd securechat
```

### 2. Create a virtual environment

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your MongoDB Atlas connection string and a secret key:

```env
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/securechat?retryWrites=true&w=majority
SECRET_KEY=your-random-secret-key-here
```

> **Tip:** Generate a secure secret key with `python -c "import secrets; print(secrets.token_hex(32))"`

### 5. Run the application

```bash
python app.py
```

The app will start on **http://localhost:5000**.

---

## 🔐 How Encryption Works

### Registration

1. User submits a username and password.
2. The **browser** generates an **RSA-2048 keypair** using the WebCrypto API.
3. The private key is **encrypted with the user's password** (AES-GCM derived via PBKDF2) and sent to the server.
4. The server stores: hashed password (PBKDF2), encrypted private key, and the public key.
5. The **plaintext private key never touches the server**.

### Sending a Message

1. A fresh **AES-256 key** is generated in the browser.
2. The message plaintext is **encrypted with AES-256-GCM**.
3. The AES key is **encrypted with the recipient's RSA-2048 public key**.
4. Both ciphertexts are sent to the server via Socket.IO.
5. The server stores the ciphertext bundle — it **cannot decrypt any of it**.

### Receiving a Message

1. The recipient receives the ciphertext bundle via Socket.IO.
2. Their browser **decrypts the AES key** using their RSA private key.
3. The AES key **decrypts the message** back to plaintext.
4. Only the two participants can ever read the message.

---

## 🧪 Testing

You can test the encryption flow by opening **two browser windows** (or an incognito window):

1. Register two different user accounts.
2. Search for the other user and start a chat.
3. Send messages — they'll be encrypted in transit and at rest.
4. Inspect the MongoDB database: you'll only see ciphertext, never plaintext.

---

## 📋 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Redirect to login |
| `GET/POST` | `/login` | User login |
| `GET/POST` | `/register` | User registration |
| `GET` | `/chat` | Main chat interface (auth required) |
| `GET` | `/logout` | Clear session and log out |
| `GET` | `/api/conversations` | List active conversations |
| `GET` | `/api/messages/<username>` | Get encrypted message history |
| `GET` | `/api/public_key/<username>` | Get a user's RSA public key |
| `GET` | `/api/search_users?q=<query>` | Search for users by username |
| `GET/POST` | `/api/profile` | Get or update user profile |

### Socket.IO Events

| Event | Direction | Description |
|---|---|---|
| `send_message` | Client → Server | Send an encrypted message |
| `receive_message` | Server → Client | Receive an encrypted message |
| `message_sent` | Server → Client | Send confirmation |
| `user_status` | Server → Client | Online/offline status change |
| `user_typing` | Client ↔ Server | Typing indicator start |
| `user_stop_typing` | Client ↔ Server | Typing indicator stop |
| `profile_updated` | Server → Client | Real-time profile change broadcast |

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with 🔐 cryptography and ❤️**

*Messages are encrypted before they leave your device. Your privacy is not a feature — it's the architecture.*

</div>
