/**
 * SecureChat — Real-Time Chat Module
 * 
 * Manages Socket.IO connections, message sending/receiving,
 * contact list, and chat UI rendering.
 * 
 * All messages are encrypted/decrypted via SecureCrypto.
 */

const Chat = (() => {
    'use strict';

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    let socket = null;
    let currentUser = '';
    let currentDisplayName = '';
    let currentBio = '';
    let currentAvatar = '';
    let pendingAvatarDataUrl = null;
    let activeChat = null;         // Currently selected contact username
    let privateKey = null;         // Current user's RSA private key (CryptoKey)
    let publicKey = null;          // Current user's RSA public key (CryptoKey)
    let contactPublicKeys = {};    // Cache: { username: CryptoKey }
    let contacts = [];             // List of all contacts
    let typingTimeout = null;

    // DOM elements (populated in init)
    let elements = {};


    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    async function init(username) {
        currentUser = username;

        // Initialize user profile details from page attributes
        const chatPage = document.getElementById('chat-page');
        if (chatPage) {
            currentDisplayName = chatPage.dataset.displayName || username;
            currentBio = chatPage.dataset.bio || '';
            currentAvatar = chatPage.dataset.avatar || '';
        }

        // Cache DOM elements
        elements = {
            userList: document.getElementById('user-list'),
            messagesArea: document.getElementById('messages-area'),
            messageInput: document.getElementById('message-input'),
            sendBtn: document.getElementById('send-btn'),
            chatEmpty: document.getElementById('chat-empty'),
            chatActive: document.getElementById('chat-active'),
            headerName: document.getElementById('header-name'),
            headerAvatar: document.getElementById('header-avatar'),
            headerStatus: document.getElementById('header-status'),
            headerStatusDot: document.getElementById('header-status-dot'),
            headerUsernameBadge: document.getElementById('header-username-badge'),
            headerBioPreview: document.getElementById('header-bio-preview'),
            typingIndicator: document.getElementById('typing-indicator'),
            typingText: document.getElementById('typing-text'),
            searchInput: document.getElementById('search-input'),
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingText: document.getElementById('loading-text'),
            notification: document.getElementById('system-notification'),
            openNewChatBtn: document.getElementById('open-new-chat-btn'),
            sidebarNewChatBtn: document.getElementById('sidebar-new-chat-btn'),
            emptyStartChatBtn: document.getElementById('empty-start-chat-btn'),
            refreshContactsBtn: document.getElementById('refresh-contacts-btn'),
            newChatModal: document.getElementById('new-chat-modal'),
            closeNewChatModal: document.getElementById('close-new-chat-modal'),
            newChatSearchInput: document.getElementById('new-chat-search-input'),
            newChatUsersList: document.getElementById('new-chat-users-list'),
            unlockModal: document.getElementById('unlock-modal'),
            unlockForm: document.getElementById('unlock-form'),
            unlockPassword: document.getElementById('unlock-password'),
            unlockError: document.getElementById('unlock-error'),
            unlockBtn: document.getElementById('unlock-btn'),
            logoutBtn: document.getElementById('logout-btn'),
            // Profile & Edit Profile elements
            sidebarProfileCard: document.getElementById('sidebar-profile-card'),
            sidebarProfileAvatar: document.getElementById('sidebar-profile-avatar'),
            sidebarProfileInfo: document.getElementById('sidebar-profile-info'),
            sidebarProfileName: document.getElementById('sidebar-profile-name'),
            openEditProfileBtn: document.getElementById('open-edit-profile-btn'),
            editProfileModal: document.getElementById('edit-profile-modal'),
            closeEditProfileModal: document.getElementById('close-edit-profile-modal'),
            cancelEditProfileBtn: document.getElementById('cancel-edit-profile-btn'),
            editProfileForm: document.getElementById('edit-profile-form'),
            editDisplayName: document.getElementById('edit-display-name'),
            editBio: document.getElementById('edit-bio'),
            bioCharCount: document.getElementById('bio-char-count'),
            profileAvatarInput: document.getElementById('profile-avatar-input'),
            profilePhotoClickArea: document.getElementById('profile-photo-click-area'),
            changePhotoBtn: document.getElementById('change-photo-btn'),
            removePhotoBtn: document.getElementById('remove-photo-btn'),
            editProfileAvatarPreview: document.getElementById('edit-profile-avatar-preview'),
            editProfileError: document.getElementById('edit-profile-error'),
            editProfileSuccess: document.getElementById('edit-profile-success'),
            saveProfileBtn: document.getElementById('save-profile-btn'),
        };

        // Set up event listeners right away so buttons & UI are immediately active
        setupEventListeners();

        // Step 1: Connect to Socket.IO
        try {
            connectSocket();
        } catch (e) {
            console.error('[Chat] Socket connection failed:', e);
        }

        // Step 2: Load contacts immediately
        try {
            await loadContacts();
        } catch (e) {
            console.error('[Chat] Contacts loading failed:', e);
        }

        // Step 3: Decrypt private key (or prompt user if session password needed)
        try {
            await decryptUserPrivateKey();
        } catch (e) {
            console.warn('[Chat] Key decryption deferred or password needed:', e);
        } finally {
            hideLoading();
        }
    }

    /**
     * Decrypt the user's RSA private key using their password.
     */
    async function decryptUserPrivateKey(customPassword = null) {
        const encryptedPrivateKey = document.getElementById('encrypted-private-key')?.value;
        const privateKeyIv = document.getElementById('private-key-iv')?.value;
        const privateKeySalt = document.getElementById('private-key-salt')?.value;
        const password = customPassword || sessionStorage.getItem('_sc_pwd');

        if (!encryptedPrivateKey || !privateKeyIv || !privateKeySalt) {
            console.error('[Chat] Missing private key elements on page');
            return false;
        }

        if (!password) {
            console.log('[Chat] Password not in session storage. Showing unlock modal.');
            showUnlockModal();
            return false;
        }

        try {
            privateKey = await SecureCrypto.decryptPrivateKey(
                encryptedPrivateKey, privateKeyIv, privateKeySalt, password
            );

            // Reconstruct user's public key
            const response = await fetch(`/api/public_key/${currentUser}`);
            const data = await response.json();
            if (data.public_key) {
                publicKey = await SecureCrypto.importPublicKey(data.public_key);
            }

            // Keep password in sessionStorage for current tab session
            sessionStorage.setItem('_sc_pwd', password);
            console.log('[Chat] Private key decrypted successfully ✓');
            hideUnlockModal();
            return true;
        } catch (error) {
            console.error('[Chat] Failed to decrypt private key:', error);
            showUnlockModal('Failed to decrypt your encryption key. Please check your password.');
            return false;
        }
    }


    // ──────────────────────────────────────────────
    // Socket.IO Connection
    // ──────────────────────────────────────────────

    function connectSocket() {
        showLoading('Connecting to secure server...');

        socket = io({
            transports: ['websocket', 'polling'],
        });

        socket.on('connect', () => {
            console.log('[Socket] Connected ✓');
            showNotification('Connected securely', 'success');
            setTimeout(() => hideNotification(), 3000);
        });

        socket.on('disconnect', () => {
            console.log('[Socket] Disconnected');
            showNotification('Connection lost. Reconnecting...', 'error');
        });

        socket.on('reconnect', () => {
            showNotification('Reconnected!', 'success');
            setTimeout(() => hideNotification(), 3000);
        });

        // Receive message
        socket.on('receive_message', async (data) => {
            console.log('[Socket] Message received from:', data.sender);
            await handleIncomingMessage(data);
        });

        // Message sent confirmation
        socket.on('message_sent', async (data) => {
            console.log('[Socket] Message sent confirmation');
            // Message already rendered locally on send
        });

        // User status changes
        socket.on('user_status', (data) => {
            updateUserStatus(data.username, data.online);
        });

        // Typing indicators
        socket.on('user_typing', (data) => {
            if (data.username === activeChat) {
                showTypingIndicator(data.username);
            }
        });

        socket.on('user_stop_typing', (data) => {
            if (data.username === activeChat) {
                hideTypingIndicator();
            }
        });

        // Profile updated broadcast
        socket.on('profile_updated', (data) => {
            handleProfileUpdated(data);
        });

        socket.on('error', (data) => {
            console.error('[Socket] Error:', data.message);
            showNotification(data.message, 'error');
        });
    }


    // ──────────────────────────────────────────────
    // Contacts Management
    // ──────────────────────────────────────────────

    function escapeHtml(str) {
        return (str || '').replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    async function loadContacts() {
        try {
            const response = await fetch('/api/conversations');
            if (response.ok) {
                contacts = await response.json();
                renderContacts(contacts);
            } else {
                console.error('[Chat] Failed to load conversations, status:', response.status);
            }
        } catch (error) {
            console.error('[Chat] Failed to load conversations:', error);
            if (elements.userList && contacts.length === 0) {
                elements.userList.innerHTML = `
                    <div class="no-contacts">
                        <p style="color: var(--red-400);">Failed to load conversations.</p>
                        <button class="btn-primary-compact" style="margin-top: 0.5rem;" onclick="Chat.loadContacts()">
                            Retry 🔄
                        </button>
                    </div>
                `;
            }
        }
    }

    function renderAvatar(avatarUrl, nameOrUsername) {
        const initial = (nameOrUsername || '?').charAt(0).toUpperCase();
        if (avatarUrl) {
            return `<img src="${avatarUrl}" alt="${escapeHtml(nameOrUsername || '?')}" class="avatar-img">`;
        }
        return `<span>${escapeHtml(initial)}</span>`;
    }

    function renderContacts(contactList) {
        if (!elements.userList) return;

        if (contactList.length === 0) {
            elements.userList.innerHTML = `
                <div class="no-contacts">
                    <div class="empty-users-icon">💬</div>
                    <p>No active conversations yet.</p>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Search for a username to start an encrypted chat.</p>
                    <button class="btn-primary-compact" style="margin-top: 0.75rem;" onclick="Chat.openNewChatModal()">
                        🔍 Search User
                    </button>
                </div>
            `;
            return;
        }

        elements.userList.innerHTML = contactList.map(user => {
            const displayName = user.display_name || user.username;
            const subtitle = user.is_online ? 'Online' : (user.bio ? escapeHtml(user.bio) : 'Offline');
            return `
            <div class="user-item ${activeChat === user.username ? 'active' : ''}"
                 data-username="${user.username}"
                 onclick="Chat.selectContact('${user.username}')">
                <div class="avatar">
                    ${renderAvatar(user.avatar, displayName)}
                    <span class="status-dot ${user.is_online ? 'online' : 'offline'}"></span>
                </div>
                <div class="user-info">
                    <div class="user-name">${escapeHtml(displayName)}</div>
                    <div class="user-status-text ${user.is_online ? 'online' : ''}">
                        ${subtitle}
                    </div>
                </div>
            </div>
            `;
        }).join('');
    }

    function updateUserStatus(username, online) {
        // Update in contacts array
        const contact = contacts.find(c => c.username === username);
        if (contact) {
            contact.is_online = online;
        }

        // Update DOM
        const userItem = document.querySelector(`.user-item[data-username="${username}"]`);
        if (userItem) {
            const dot = userItem.querySelector('.status-dot');
            const statusText = userItem.querySelector('.user-status-text');
            if (dot) {
                dot.className = `status-dot ${online ? 'online' : 'offline'}`;
            }
            if (statusText) {
                statusText.className = `user-status-text ${online ? 'online' : ''}`;
                statusText.textContent = online ? 'Online' : 'Offline';
            }
        }

        // Update chat header if this is the active chat
        if (username === activeChat) {
            if (elements.headerStatusDot) {
                elements.headerStatusDot.className = `status-indicator ${online ? 'online' : ''}`;
            }
            if (elements.headerStatus) {
                elements.headerStatus.innerHTML = `
                    <span class="status-indicator ${online ? 'online' : ''}" id="header-status-dot"></span>
                    ${online ? 'Online' : 'Offline'}
                `;
            }
        }
    }

    function filterContacts(query) {
        const trimmed = (query || '').trim().toLowerCase();
        if (!trimmed) {
            renderContacts(contacts);
            return;
        }

        const filtered = contacts.filter(c =>
            c.username.toLowerCase().includes(trimmed)
        );

        if (filtered.length > 0) {
            renderContacts(filtered);
        } else {
            if (elements.userList) {
                elements.userList.innerHTML = `
                    <div class="no-contacts">
                        <p style="font-size: 0.8125rem;">No active chat with "${escapeHtml(trimmed)}"</p>
                        <button class="btn-primary-compact" style="margin-top: 0.5rem;" onclick="Chat.openNewChatWithQuery('${escapeHtml(trimmed)}')">
                            🔍 Search All Users
                        </button>
                    </div>
                `;
            }
        }
    }


    // ──────────────────────────────────────────────
    // Chat Selection & History
    // ──────────────────────────────────────────────

    async function selectContact(username) {
        if (activeChat === username) return;

        activeChat = username;

        // Update UI
        document.querySelectorAll('.user-item').forEach(el => {
            el.classList.toggle('active', el.dataset.username === username);
        });

        // Show chat panel
        if (elements.chatEmpty) elements.chatEmpty.style.display = 'none';
        if (elements.chatActive) elements.chatActive.style.display = 'flex';

        // Set header info
        const contact = contacts.find(c => c.username === username);
        const displayName = contact?.display_name || username;
        const bio = contact?.bio || '';
        const avatar = contact?.avatar || '';

        if (elements.headerName) elements.headerName.textContent = displayName;
        if (elements.headerUsernameBadge) elements.headerUsernameBadge.textContent = `@${username}`;
        if (elements.headerAvatar) elements.headerAvatar.innerHTML = renderAvatar(avatar, displayName);
        if (elements.headerBioPreview) elements.headerBioPreview.textContent = bio ? `“${bio}”` : '';
        if (elements.headerStatus) {
            const isOnline = contact?.is_online;
            elements.headerStatus.innerHTML = `
                <span class="status-indicator ${isOnline ? 'online' : ''}" id="header-status-dot"></span>
                ${isOnline ? 'Online' : 'Offline'}
            `;
        }

        // Fetch and cache recipient's public key
        if (!contactPublicKeys[username]) {
            try {
                const response = await fetch(`/api/public_key/${username}`);
                const data = await response.json();
                if (data.public_key) {
                    contactPublicKeys[username] = await SecureCrypto.importPublicKey(data.public_key);
                }
            } catch (error) {
                console.error(`[Chat] Failed to fetch public key for ${username}:`, error);
            }
        }

        // Load chat history
        await loadChatHistory(username);

        // Focus message input
        if (elements.messageInput) elements.messageInput.focus();
    }

    async function loadChatHistory(username) {
        if (!elements.messagesArea) return;
        elements.messagesArea.innerHTML = '';

        try {
            const response = await fetch(`/api/messages/${username}`);
            const messages = await response.json();

            if (messages.length === 0) {
                elements.messagesArea.innerHTML = `
                    <div class="date-separator">
                        <span>🔐 Messages are end-to-end encrypted</span>
                    </div>
                `;
                return;
            }

            // Add E2E notice
            appendDateSeparator('🔐 End-to-end encrypted');

            let lastDate = '';
            for (const msg of messages) {
                // Add date separators
                const msgDate = new Date(msg.timestamp).toLocaleDateString();
                if (msgDate !== lastDate) {
                    appendDateSeparator(msgDate);
                    lastDate = msgDate;
                }

                // Decrypt and display
                try {
                    const plaintext = await SecureCrypto.decryptReceived(msg, privateKey, currentUser);
                    appendMessage(plaintext, msg.sender === currentUser, msg.timestamp, false);
                } catch (decryptError) {
                    console.error('[Chat] Decryption failed for message:', decryptError);
                    appendMessage('[🔒 Unable to decrypt]', msg.sender === currentUser, msg.timestamp, false);
                }
            }

            scrollToBottom();
        } catch (error) {
            console.error('[Chat] Failed to load chat history:', error);
        }
    }


    // ──────────────────────────────────────────────
    // Message Sending
    // ──────────────────────────────────────────────

    async function sendMessage() {
        if (!activeChat || !elements.messageInput) return;

        const plaintext = elements.messageInput.value.trim();
        if (!plaintext) return;

        const recipientPublicKey = contactPublicKeys[activeChat];
        if (!recipientPublicKey) {
            showNotification('Cannot send: recipient\'s public key not available.', 'error');
            return;
        }

        if (!publicKey) {
            showNotification('Cannot send: your public key is not loaded.', 'error');
            return;
        }

        // Clear input immediately for UX
        elements.messageInput.value = '';
        elements.messageInput.style.height = 'auto';

        // Stop typing indicator
        socket.emit('stop_typing', { recipient: activeChat });

        try {
            // Encrypt the message
            const encrypted = await SecureCrypto.encryptForSending(
                plaintext, recipientPublicKey, publicKey
            );

            // Send via Socket.IO
            socket.emit('send_message', {
                recipient: activeChat,
                ...encrypted,
            });

            // Display locally immediately (optimistic rendering)
            appendMessage(plaintext, true, new Date().toISOString(), true);
            scrollToBottom();

            // Ensure contact is in sidebar conversations list
            if (!contacts.find(c => c.username === activeChat)) {
                await loadContacts();
            }

        } catch (error) {
            console.error('[Chat] Encryption/send error:', error);
            showNotification('Failed to encrypt message.', 'error');
        }
    }


    // ──────────────────────────────────────────────
    // Message Receiving
    // ──────────────────────────────────────────────

    async function handleIncomingMessage(data) {
        try {
            const plaintext = await SecureCrypto.decryptReceived(data, privateKey, currentUser);

            // Ensure sender is in our conversations list
            if (!contacts.find(c => c.username === data.sender)) {
                await loadContacts();
            }

            // If this message is for the currently active chat
            if (data.sender === activeChat) {
                appendMessage(plaintext, false, data.timestamp, true);
                scrollToBottom();
                hideTypingIndicator();
            } else {
                // Show notification for other chats
                showNotification(`New message from ${data.sender}`, 'info');

                // Update the contact list to show unread indicator
                const userItem = document.querySelector(`.user-item[data-username="${data.sender}"]`);
                if (userItem) {
                    userItem.style.borderLeft = '3px solid var(--purple-500)';
                }
            }
        } catch (error) {
            console.error('[Chat] Failed to decrypt incoming message:', error);
        }
    }


    // ──────────────────────────────────────────────
    // UI Rendering Helpers
    // ──────────────────────────────────────────────

    function appendMessage(text, isSent, timestamp, animate = true) {
        if (!elements.messagesArea) return;

        const time = new Date(timestamp);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const group = document.createElement('div');
        group.className = `message-group ${isSent ? 'sent' : 'received'}`;
        if (!animate) {
            group.style.animation = 'none';
            group.style.opacity = '1';
        }

        group.innerHTML = `
            <div class="message-bubble">${escapeHtml(text)}</div>
            <div class="message-meta">
                <span class="message-lock-icon">🔒</span>
                <span>${timeStr}</span>
            </div>
        `;

        elements.messagesArea.appendChild(group);
    }

    function appendDateSeparator(text) {
        if (!elements.messagesArea) return;

        const separator = document.createElement('div');
        separator.className = 'date-separator';
        separator.innerHTML = `<span>${escapeHtml(text)}</span>`;
        elements.messagesArea.appendChild(separator);
    }

    function scrollToBottom() {
        if (elements.messagesArea) {
            elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }


    // ──────────────────────────────────────────────
    // Typing Indicators
    // ──────────────────────────────────────────────

    function handleTyping() {
        if (!activeChat) return;

        socket.emit('typing', { recipient: activeChat });

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stop_typing', { recipient: activeChat });
        }, 2000);
    }

    function showTypingIndicator(username) {
        if (elements.typingIndicator) {
            elements.typingIndicator.classList.add('active');
        }
        if (elements.typingText) {
            elements.typingText.textContent = `${username} is typing...`;
        }
    }

    function hideTypingIndicator() {
        if (elements.typingIndicator) {
            elements.typingIndicator.classList.remove('active');
        }
    }


    // ──────────────────────────────────────────────
    // Notifications & Loading
    // ──────────────────────────────────────────────

    function showNotification(message, type = 'info') {
        if (elements.notification) {
            elements.notification.textContent = message;
            elements.notification.className = `system-notification active ${type}`;
        }
    }

    function hideNotification() {
        if (elements.notification) {
            elements.notification.classList.remove('active');
        }
    }

    function showLoading(text) {
        if (elements.loadingOverlay) {
            elements.loadingOverlay.classList.remove('hidden');
        }
        if (elements.loadingText) {
            elements.loadingText.textContent = text;
        }
    }

    function hideLoading() {
        if (elements.loadingOverlay) {
            elements.loadingOverlay.classList.add('hidden');
        }
    }


    // ──────────────────────────────────────────────
    // Event Listeners
    // ──────────────────────────────────────────────

    function setupEventListeners() {
        // Send button
        if (elements.sendBtn) {
            elements.sendBtn.addEventListener('click', sendMessage);
        }

        // Enter to send, Shift+Enter for new line
        if (elements.messageInput) {
            elements.messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            // Auto-resize textarea
            elements.messageInput.addEventListener('input', () => {
                elements.messageInput.style.height = 'auto';
                elements.messageInput.style.height =
                    Math.min(elements.messageInput.scrollHeight, 120) + 'px';
                handleTyping();
            });
        }

        // Search contacts
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', (e) => {
                filterContacts(e.target.value);
            });
        }

        // New Chat buttons
        if (elements.openNewChatBtn) {
            elements.openNewChatBtn.addEventListener('click', openNewChatModal);
        }
        if (elements.sidebarNewChatBtn) {
            elements.sidebarNewChatBtn.addEventListener('click', openNewChatModal);
        }
        if (elements.emptyStartChatBtn) {
            elements.emptyStartChatBtn.addEventListener('click', openNewChatModal);
        }
        if (elements.closeNewChatModal) {
            elements.closeNewChatModal.addEventListener('click', closeNewChatModal);
        }
        if (elements.newChatSearchInput) {
            elements.newChatSearchInput.addEventListener('input', (e) => {
                handleNewChatSearch(e.target.value);
            });
        }

        // Close modal on clicking backdrop
        if (elements.newChatModal) {
            elements.newChatModal.addEventListener('click', (e) => {
                if (e.target === elements.newChatModal) {
                    closeNewChatModal();
                }
            });
        }

        // Refresh contacts
        if (elements.refreshContactsBtn) {
            elements.refreshContactsBtn.addEventListener('click', async () => {
                showNotification('Refreshing contacts...', 'info');
                await loadContacts();
                setTimeout(hideNotification, 1500);
            });
        }

        // Session Unlock form
        if (elements.unlockForm) {
            elements.unlockForm.addEventListener('submit', handleUnlockSubmit);
        }

        // Clear password on logout
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', () => {
                sessionStorage.removeItem('_sc_pwd');
            });
        }

        // ── Edit Profile Event Listeners ──
        if (elements.openEditProfileBtn) {
            elements.openEditProfileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditProfileModal();
            });
        }
        if (elements.sidebarProfileAvatar) {
            elements.sidebarProfileAvatar.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditProfileModal();
            });
        }
        if (elements.sidebarProfileInfo) {
            elements.sidebarProfileInfo.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditProfileModal();
            });
        }
        if (elements.closeEditProfileModal) {
            elements.closeEditProfileModal.addEventListener('click', closeEditProfileModal);
        }
        if (elements.cancelEditProfileBtn) {
            elements.cancelEditProfileBtn.addEventListener('click', closeEditProfileModal);
        }
        if (elements.editProfileModal) {
            elements.editProfileModal.addEventListener('click', (e) => {
                if (e.target === elements.editProfileModal) {
                    closeEditProfileModal();
                }
            });
        }
        if (elements.profilePhotoClickArea) {
            elements.profilePhotoClickArea.addEventListener('click', () => {
                if (elements.profileAvatarInput) elements.profileAvatarInput.click();
            });
        }
        if (elements.changePhotoBtn) {
            elements.changePhotoBtn.addEventListener('click', () => {
                if (elements.profileAvatarInput) elements.profileAvatarInput.click();
            });
        }
        if (elements.profileAvatarInput) {
            elements.profileAvatarInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) handleAvatarFileSelected(file);
            });
        }
        if (elements.removePhotoBtn) {
            elements.removePhotoBtn.addEventListener('click', handleRemovePhoto);
        }
        if (elements.editBio) {
            elements.editBio.addEventListener('input', (e) => {
                if (elements.bioCharCount) {
                    elements.bioCharCount.textContent = `${e.target.value.length}/200`;
                }
            });
        }
        if (elements.editProfileForm) {
            elements.editProfileForm.addEventListener('submit', handleEditProfileSubmit);
        }
    }


    // ──────────────────────────────────────────────
    // New Chat & Search Management
    // ──────────────────────────────────────────────

    let searchDebounceTimer = null;
    let latestSearchResults = [];

    function openNewChatModal() {
        if (!elements.newChatModal) return;
        elements.newChatModal.style.display = 'flex';
        if (elements.newChatSearchInput) {
            elements.newChatSearchInput.value = '';
            elements.newChatSearchInput.focus();
        }

        // Do not dump all database users. Prompt user to search!
        if (elements.newChatUsersList) {
            elements.newChatUsersList.innerHTML = `
                <div class="new-chat-hint">
                    <div class="empty-users-icon">🔍</div>
                    <p style="font-weight: 600; margin-bottom: 0.25rem;">Search for someone to chat with</p>
                    <p style="font-size: 0.8125rem; color: var(--text-muted);">Type a username above to search for registered users.</p>
                </div>
            `;
        }
    }

    function openNewChatWithQuery(query) {
        openNewChatModal();
        if (elements.newChatSearchInput) {
            elements.newChatSearchInput.value = query;
            handleNewChatSearch(query);
        }
    }

    function closeNewChatModal() {
        if (elements.newChatModal) {
            elements.newChatModal.style.display = 'none';
        }
        clearTimeout(searchDebounceTimer);
    }

    function handleNewChatSearch(query) {
        clearTimeout(searchDebounceTimer);
        const trimmed = (query || '').trim();

        if (!trimmed) {
            if (elements.newChatUsersList) {
                elements.newChatUsersList.innerHTML = `
                    <div class="new-chat-hint">
                        <div class="empty-users-icon">🔍</div>
                        <p style="font-weight: 600; margin-bottom: 0.25rem;">Search for someone to chat with</p>
                        <p style="font-size: 0.8125rem; color: var(--text-muted);">Type a username above to search for registered users.</p>
                    </div>
                `;
            }
            return;
        }

        if (elements.newChatUsersList) {
            elements.newChatUsersList.innerHTML = `
                <div class="no-contacts">
                    <div class="empty-users-icon">⏳</div>
                    <p>Searching for "${escapeHtml(trimmed)}"...</p>
                </div>
            `;
        }

        searchDebounceTimer = setTimeout(async () => {
            try {
                const response = await fetch(`/api/search_users?q=${encodeURIComponent(trimmed)}`);
                if (response.ok) {
                    latestSearchResults = await response.json();
                    renderNewChatSearchResults(latestSearchResults, trimmed);
                } else {
                    throw new Error('Search request failed');
                }
            } catch (error) {
                console.error('[Chat] Failed to search users:', error);
                if (elements.newChatUsersList) {
                    elements.newChatUsersList.innerHTML = `
                        <div class="no-contacts">
                            <p style="color: var(--red-400);">Search failed. Please try again.</p>
                        </div>
                    `;
                }
            }
        }, 200);
    }

    function renderNewChatSearchResults(userList, query) {
        if (!elements.newChatUsersList) return;

        if (userList.length === 0) {
            elements.newChatUsersList.innerHTML = `
                <div class="new-chat-hint">
                    <div class="empty-users-icon">👤</div>
                    <p style="font-weight: 600; margin-bottom: 0.25rem;">No user found</p>
                    <p style="font-size: 0.8125rem; color: var(--text-muted);">No registered user matching "<b>${escapeHtml(query)}</b>" was found.</p>
                </div>
            `;
            return;
        }

        elements.newChatUsersList.innerHTML = userList.map(user => {
            const displayName = user.display_name || user.username;
            return `
            <div class="modal-user-item">
                <div class="modal-user-left">
                    <div class="modal-user-avatar">${renderAvatar(user.avatar, displayName)}</div>
                    <div>
                        <div class="modal-user-name">${escapeHtml(displayName)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">@${escapeHtml(user.username)}</div>
                        ${user.bio ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(user.bio)}</div>` : ''}
                    </div>
                </div>
                <button class="btn-start-chat-item" onclick="Chat.startChatWith('${user.username}')">
                    Chat 💬
                </button>
            </div>
            `;
        }).join('');
    }

    function startChatWith(username) {
        closeNewChatModal();

        // Add to contacts list if not present
        let contact = contacts.find(c => c.username === username);
        if (!contact) {
            const foundUser = latestSearchResults.find(u => u.username === username);
            contact = {
                username: username,
                display_name: foundUser?.display_name || username,
                bio: foundUser?.bio || '',
                avatar: foundUser?.avatar || '',
                is_online: foundUser ? foundUser.is_online : false,
                public_key: foundUser ? foundUser.public_key : null,
            };
            contacts.unshift(contact);
            renderContacts(contacts);
        }

        selectContact(username);
    }


    // ──────────────────────────────────────────────
    // Session Unlock Modal
    // ──────────────────────────────────────────────

    function showUnlockModal(errorMessage = '') {
        if (!elements.unlockModal) return;
        elements.unlockModal.style.display = 'flex';
        if (elements.unlockError) {
            if (errorMessage) {
                elements.unlockError.textContent = errorMessage;
                elements.unlockError.style.display = 'block';
            } else {
                elements.unlockError.style.display = 'none';
            }
        }
        if (elements.unlockPassword) {
            elements.unlockPassword.focus();
        }
    }

    function hideUnlockModal() {
        if (elements.unlockModal) {
            elements.unlockModal.style.display = 'none';
        }
        if (elements.unlockError) {
            elements.unlockError.style.display = 'none';
        }
        if (elements.unlockPassword) {
            elements.unlockPassword.value = '';
        }
    }

    async function handleUnlockSubmit(e) {
        e.preventDefault();
        const pwd = elements.unlockPassword ? elements.unlockPassword.value : '';
        if (!pwd) return;

        if (elements.unlockBtn) {
            elements.unlockBtn.disabled = true;
            elements.unlockBtn.classList.add('loading');
        }

        const success = await decryptUserPrivateKey(pwd);

        if (elements.unlockBtn) {
            elements.unlockBtn.disabled = false;
            elements.unlockBtn.classList.remove('loading');
        }

        if (success) {
            hideUnlockModal();
            showNotification('Session unlocked successfully', 'success');
            setTimeout(hideNotification, 3000);
            if (activeChat) {
                await loadChatHistory(activeChat);
            }
        }
    }


    // ──────────────────────────────────────────────
    // Edit Profile Modal Management
    // ──────────────────────────────────────────────

    function openEditProfileModal() {
        if (!elements.editProfileModal) return;

        pendingAvatarDataUrl = currentAvatar;

        if (elements.editDisplayName) {
            elements.editDisplayName.value = currentDisplayName || currentUser;
        }
        if (elements.editBio) {
            elements.editBio.value = currentBio || '';
        }
        if (elements.bioCharCount) {
            elements.bioCharCount.textContent = `${(elements.editBio?.value || '').length}/200`;
        }
        if (elements.editProfileAvatarPreview) {
            elements.editProfileAvatarPreview.innerHTML = renderAvatar(currentAvatar, currentDisplayName || currentUser);
        }
        if (elements.removePhotoBtn) {
            elements.removePhotoBtn.style.display = currentAvatar ? 'inline-block' : 'none';
        }
        if (elements.editProfileError) {
            elements.editProfileError.style.display = 'none';
        }
        if (elements.editProfileSuccess) {
            elements.editProfileSuccess.style.display = 'none';
        }
        if (elements.profileAvatarInput) {
            elements.profileAvatarInput.value = '';
        }

        elements.editProfileModal.style.display = 'flex';
        if (elements.editDisplayName) {
            elements.editDisplayName.focus();
        }
    }

    function closeEditProfileModal() {
        if (elements.editProfileModal) {
            elements.editProfileModal.style.display = 'none';
        }
        if (elements.editProfileError) {
            elements.editProfileError.style.display = 'none';
        }
        if (elements.editProfileSuccess) {
            elements.editProfileSuccess.style.display = 'none';
        }
        pendingAvatarDataUrl = null;
    }

    function handleAvatarFileSelected(file) {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            showEditProfileError('Please select a valid image file (PNG, JPG, WebP).');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            showEditProfileError('Image file is too large (max 5MB).');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Resize image to max 150x150 px square center crop using canvas
                const maxDim = 150;
                const canvas = document.createElement('canvas');
                canvas.width = maxDim;
                canvas.height = maxDim;
                const ctx = canvas.getContext('2d');

                const minDimension = Math.min(img.width, img.height);
                const sourceX = (img.width - minDimension) / 2;
                const sourceY = (img.height - minDimension) / 2;

                ctx.drawImage(
                    img,
                    sourceX, sourceY, minDimension, minDimension,
                    0, 0, maxDim, maxDim
                );

                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                pendingAvatarDataUrl = dataUrl;

                if (elements.editProfileAvatarPreview) {
                    elements.editProfileAvatarPreview.innerHTML = `<img src="${dataUrl}" alt="Preview" class="avatar-img">`;
                }
                if (elements.removePhotoBtn) {
                    elements.removePhotoBtn.style.display = 'inline-block';
                }
                if (elements.editProfileError) {
                    elements.editProfileError.style.display = 'none';
                }
            };
            img.onerror = () => {
                showEditProfileError('Failed to process the selected image.');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function handleRemovePhoto() {
        pendingAvatarDataUrl = '';
        if (elements.profileAvatarInput) {
            elements.profileAvatarInput.value = '';
        }
        if (elements.editProfileAvatarPreview) {
            const name = (elements.editDisplayName?.value || currentUser).trim();
            elements.editProfileAvatarPreview.innerHTML = `<span>${(name || '?').charAt(0).toUpperCase()}</span>`;
        }
        if (elements.removePhotoBtn) {
            elements.removePhotoBtn.style.display = 'none';
        }
    }

    function showEditProfileError(msg) {
        if (elements.editProfileError) {
            elements.editProfileError.textContent = msg;
            elements.editProfileError.style.display = 'block';
        }
        if (elements.editProfileSuccess) {
            elements.editProfileSuccess.style.display = 'none';
        }
    }

    function showEditProfileSuccess(msg) {
        if (elements.editProfileSuccess) {
            elements.editProfileSuccess.textContent = msg;
            elements.editProfileSuccess.style.display = 'block';
        }
        if (elements.editProfileError) {
            elements.editProfileError.style.display = 'none';
        }
    }

    async function handleEditProfileSubmit(e) {
        e.preventDefault();

        const displayName = (elements.editDisplayName ? elements.editDisplayName.value : '').trim();
        const bio = (elements.editBio ? elements.editBio.value : '').trim();
        const avatar = pendingAvatarDataUrl !== null ? pendingAvatarDataUrl : currentAvatar;

        if (!displayName) {
            showEditProfileError('Display Name cannot be empty.');
            return;
        }

        if (elements.saveProfileBtn) {
            elements.saveProfileBtn.disabled = true;
            elements.saveProfileBtn.classList.add('loading');
        }

        try {
            const response = await fetch('/api/profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    display_name: displayName,
                    bio: bio,
                    avatar: avatar,
                }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Update local profile variables
                currentDisplayName = data.profile.display_name;
                currentBio = data.profile.bio;
                currentAvatar = data.profile.avatar;

                // Update sidebar DOM
                if (elements.sidebarProfileName) {
                    elements.sidebarProfileName.textContent = currentDisplayName;
                }
                if (elements.sidebarProfileAvatar) {
                    elements.sidebarProfileAvatar.innerHTML = renderAvatar(currentAvatar, currentDisplayName);
                }

                showEditProfileSuccess('Profile updated successfully!');
                showNotification('Profile updated successfully', 'success');

                setTimeout(() => {
                    closeEditProfileModal();
                    hideNotification();
                }, 800);
            } else {
                showEditProfileError(data.error || 'Failed to update profile.');
            }
        } catch (error) {
            console.error('[Chat] Save profile error:', error);
            showEditProfileError('Network error while updating profile. Please try again.');
        } finally {
            if (elements.saveProfileBtn) {
                elements.saveProfileBtn.disabled = false;
                elements.saveProfileBtn.classList.remove('loading');
            }
        }
    }

    function handleProfileUpdated(data) {
        if (!data || !data.username) return;

        // If self updated from another window/tab
        if (data.username === currentUser) {
            currentDisplayName = data.display_name || currentUser;
            currentBio = data.bio || '';
            currentAvatar = data.avatar || '';

            if (elements.sidebarProfileName) {
                elements.sidebarProfileName.textContent = currentDisplayName;
            }
            if (elements.sidebarProfileAvatar) {
                elements.sidebarProfileAvatar.innerHTML = renderAvatar(currentAvatar, currentDisplayName);
            }
            return;
        }

        // If another contact was updated
        const contact = contacts.find(c => c.username === data.username);
        if (contact) {
            contact.display_name = data.display_name;
            contact.bio = data.bio;
            contact.avatar = data.avatar;
            renderContacts(contacts);
        }

        // If currently chatting with this user, update active chat header
        if (activeChat === data.username) {
            const displayName = data.display_name || data.username;
            if (elements.headerName) elements.headerName.textContent = displayName;
            if (elements.headerUsernameBadge) elements.headerUsernameBadge.textContent = `@${data.username}`;
            if (elements.headerAvatar) elements.headerAvatar.innerHTML = renderAvatar(data.avatar, displayName);
            if (elements.headerBioPreview) elements.headerBioPreview.textContent = data.bio ? `“${data.bio}”` : '';
        }
    }


    // ──────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────

    return {
        init,
        selectContact,
        sendMessage,
        openNewChatModal,
        openNewChatWithQuery,
        closeNewChatModal,
        startChatWith,
        loadContacts,
        openEditProfileModal,
        closeEditProfileModal,
    };
})();
