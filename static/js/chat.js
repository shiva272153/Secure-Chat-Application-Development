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
    let activeChat = null;         // Currently selected contact username or group_id
    let activeChatType = 'direct'; // 'direct' or 'group'
    let activeGroup = null;        // Active group object if group chat
    let activeTab = 'all';         // 'all' | 'direct' | 'groups'
    let selectedGroupMembers = []; // Usernames selected for group creation (max 60)
    let groupMemberPublicKeys = {};// Cache: { [groupId]: { [username]: CryptoKey } }
    let groups = [];               // List of user groups
    let privateKey = null;         // Current user's RSA private key (CryptoKey)
    let publicKey = null;          // Current user's RSA public key (CryptoKey)
    let contactPublicKeys = {};    // Cache: { username: CryptoKey }
    let contacts = [];             // List of all contacts
    let typingTimeout = null;
    let groupSearchDebounceTimer = null;

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
            // Group Chat elements
            sidebarNewGroupBtn: document.getElementById('sidebar-new-group-btn'),
            openNewGroupBtn: document.getElementById('open-new-group-btn'),
            createGroupModal: document.getElementById('create-group-modal'),
            closeCreateGroupModal: document.getElementById('close-create-group-modal'),
            cancelCreateGroupBtn: document.getElementById('cancel-create-group-btn'),
            createGroupForm: document.getElementById('create-group-form'),
            groupNameInput: document.getElementById('group-name-input'),
            groupDescInput: document.getElementById('group-desc-input'),
            groupUserSearchInput: document.getElementById('group-user-search-input'),
            groupUserSearchResults: document.getElementById('group-user-search-results'),
            createGroupSelectedChips: document.getElementById('create-group-selected-chips'),
            createGroupMemberCount: document.getElementById('create-group-member-count'),
            createGroupError: document.getElementById('create-group-error'),
            submitCreateGroupBtn: document.getElementById('submit-create-group-btn'),
            headerGroupInfoBtn: document.getElementById('header-group-info-btn'),
            groupInfoModal: document.getElementById('group-info-modal'),
            closeGroupInfoModal: document.getElementById('close-group-info-modal'),
            closeGroupInfoFooterBtn: document.getElementById('close-group-info-footer-btn'),
            groupInfoTitle: document.getElementById('group-info-title'),
            groupInfoAvatar: document.getElementById('group-info-avatar'),
            groupInfoName: document.getElementById('group-info-name'),
            groupInfoDesc: document.getElementById('group-info-desc'),
            groupInfoLimitBadge: document.getElementById('group-info-limit-badge'),
            groupInfoMemberCount: document.getElementById('group-info-member-count'),
            groupInfoMembersList: document.getElementById('group-info-members-list'),
            groupAddMemberInput: document.getElementById('group-add-member-input'),
            groupAddMemberBtn: document.getElementById('group-add-member-btn'),
            groupAddMemberMsg: document.getElementById('group-add-member-msg'),
            leaveGroupBtn: document.getElementById('leave-group-btn'),
            tabAll: document.getElementById('tab-all'),
            tabDirect: document.getElementById('tab-direct'),
            tabGroups: document.getElementById('tab-groups'),
            groupsCountBadge: document.getElementById('groups-count-badge'),
            mobileBackBtn: document.getElementById('mobile-back-btn'),
        };

        // Set up event listeners right away so buttons & UI are immediately active
        setupEventListeners();

        // Step 1: Connect to Socket.IO
        try {
            connectSocket();
        } catch (e) {
            console.error('[Chat] Socket connection failed:', e);
        }

        // Step 2: Load contacts and groups simultaneously
        try {
            await Promise.all([loadContacts(), loadGroups()]);
        } catch (e) {
            console.error('[Chat] Contacts/groups loading failed:', e);
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

        // ── Group Chat Socket Events ──
        socket.on('receive_group_message', async (data) => {
            await handleIncomingGroupMessage(data);
        });

        socket.on('group_created', (data) => {
            handleGroupCreated(data);
        });

        socket.on('group_updated', (data) => {
            handleGroupUpdated(data);
        });

        socket.on('group_left', (data) => {
            handleGroupLeft(data);
        });

        socket.on('group_user_typing', (data) => {
            if (activeChatType === 'group' && data.group_id === activeChat && data.username !== currentUser) {
                showTypingIndicator(`@${data.username}`);
            }
        });

        socket.on('group_user_stop_typing', (data) => {
            if (activeChatType === 'group' && data.group_id === activeChat) {
                hideTypingIndicator();
            }
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
                renderSidebarList();
            } else {
                console.error('[Chat] Failed to load conversations, status:', response.status);
            }
        } catch (error) {
            console.error('[Chat] Failed to load conversations:', error);
            if (elements.userList && contacts.length === 0 && groups.length === 0) {
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

    async function loadGroups() {
        try {
            const response = await fetch('/api/groups');
            if (response.ok) {
                const data = await response.json();
                const fetchedGroups = data.groups || [];
                // STRICT CHECK: show ONLY groups where currentUser is an explicit member
                groups = fetchedGroups.filter(g => Array.isArray(g.members) && g.members.includes(currentUser));
                updateGroupsCountBadge();
                renderSidebarList();
            }
        } catch (error) {
            console.error('[Chat] Failed to load groups:', error);
        }
    }

    function updateGroupsCountBadge() {
        if (!elements.groupsCountBadge) return;
        const myCount = groups.filter(g => Array.isArray(g.members) && g.members.includes(currentUser)).length;
        if (myCount > 0) {
            elements.groupsCountBadge.textContent = myCount;
            elements.groupsCountBadge.style.display = 'inline-block';
        } else {
            elements.groupsCountBadge.style.display = 'none';
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
        renderSidebarList();
    }

    function renderSidebarList() {
        if (!elements.userList) return;

        const showGroups = (activeTab === 'all' || activeTab === 'groups');
        const showDirect = (activeTab === 'all' || activeTab === 'direct');

        // Strictly filter only groups where current user is an active member
        const myGroups = groups.filter(g => Array.isArray(g.members) && g.members.includes(currentUser));

        const hasGroups = myGroups.length > 0;
        const hasDirect = contacts.length > 0;

        if (!hasGroups && !hasDirect) {
            elements.userList.innerHTML = `
                <div class="no-contacts">
                    <div class="empty-users-icon">💬</div>
                    <p>No active conversations or groups yet.</p>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Start a chat or create a group (up to 60 members).</p>
                    <div style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.75rem;">
                        <button class="btn-primary-compact" onclick="Chat.openNewChatModal()">🔍 New Chat</button>
                        <button class="btn-primary-compact" style="background: rgba(139, 92, 246, 0.2); border: 1px solid var(--purple-500);" onclick="Chat.openCreateGroupModal()">👥 New Group</button>
                    </div>
                </div>
            `;
            return;
        }

        let html = '';

        // 1. Render Encrypted Groups (only groups currentUser belongs to)
        if (showGroups && hasGroups) {
            if (activeTab === 'all') {
                html += `<div style="font-size: 0.6875rem; font-weight: 700; color: var(--purple-400); text-transform: uppercase; letter-spacing: 0.5px; padding: 0.5rem 0.75rem 0.25rem;">Encrypted Groups</div>`;
            }
            html += myGroups.map(group => {
                const isActive = activeChatType === 'group' && activeChat === group.group_id;
                const mCount = group.member_count || (group.members ? group.members.length : 1);
                return `
                <div class="user-item group-chat-item ${isActive ? 'active' : ''}"
                     data-group-id="${group.group_id}"
                     onclick="Chat.selectGroup('${group.group_id}')">
                    <div class="avatar" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(6, 182, 212, 0.3)); border: 1px solid rgba(139, 92, 246, 0.5); color: #c084fc; display: flex; align-items: center; justify-content: center; font-size: 1.15rem;">
                        👥
                    </div>
                    <div class="user-info">
                        <div class="user-name" style="display: flex; align-items: center; justify-content: space-between;">
                            <span>${escapeHtml(group.name)}</span>
                            <span class="group-badge-tag">${mCount}/60</span>
                        </div>
                        <div class="user-status-text">
                            ${group.description ? escapeHtml(group.description) : `${mCount} members • Encrypted`}
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        } else if (activeTab === 'groups' && !hasGroups) {
            html += `
                <div class="no-contacts">
                    <div class="empty-users-icon">👥</div>
                    <p>No groups joined yet.</p>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Create a private encrypted group or get invited by a member.</p>
                    <button class="btn-primary-compact" style="margin-top: 0.75rem;" onclick="Chat.openCreateGroupModal()">
                        👥 Create Group
                    </button>
                </div>
            `;
        }

        // 2. Render Direct Contacts
        if (showDirect && hasDirect) {
            if (activeTab === 'all' && hasGroups) {
                html += `<div style="font-size: 0.6875rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; padding: 0.75rem 0.75rem 0.25rem;">Direct Messages</div>`;
            }
            html += contacts.map(user => {
                const displayName = user.display_name || user.username;
                const subtitle = user.is_online ? 'Online' : (user.bio ? escapeHtml(user.bio) : 'Offline');
                const isActive = activeChatType === 'direct' && activeChat === user.username;
                return `
                <div class="user-item ${isActive ? 'active' : ''}"
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
        } else if (activeTab === 'direct' && !hasDirect) {
            html += `
                <div class="no-contacts">
                    <div class="empty-users-icon">💬</div>
                    <p>No direct conversations yet.</p>
                    <button class="btn-primary-compact" style="margin-top: 0.75rem;" onclick="Chat.openNewChatModal()">
                        🔍 Search User
                    </button>
                </div>
            `;
        }

        elements.userList.innerHTML = html;
    }

    function updateUserStatus(username, online) {
        const contact = contacts.find(c => c.username === username);
        if (contact) {
            contact.is_online = online;
        }

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

        if (activeChatType === 'direct' && username === activeChat) {
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
            renderSidebarList();
            return;
        }

        const filteredContacts = contacts.filter(c =>
            c.username.toLowerCase().includes(trimmed) || (c.display_name && c.display_name.toLowerCase().includes(trimmed))
        );
        const filteredGroups = groups.filter(g =>
            Array.isArray(g.members) && g.members.includes(currentUser) && g.name.toLowerCase().includes(trimmed)
        );

        if (filteredContacts.length > 0 || filteredGroups.length > 0) {
            let html = '';
            if (filteredGroups.length > 0) {
                html += `<div style="font-size: 0.6875rem; font-weight: 700; color: var(--purple-400); padding: 0.5rem 0.75rem 0.25rem;">Groups</div>`;
                html += filteredGroups.map(group => `
                    <div class="user-item group-chat-item ${activeChat === group.group_id ? 'active' : ''}"
                         data-group-id="${group.group_id}"
                         onclick="Chat.selectGroup('${group.group_id}')">
                        <div class="avatar" style="background: rgba(139, 92, 246, 0.2); display: flex; align-items: center; justify-content: center;">👥</div>
                        <div class="user-info">
                            <div class="user-name">${escapeHtml(group.name)}</div>
                            <div class="user-status-text">${group.member_count || group.members.length}/60 members</div>
                        </div>
                    </div>
                `).join('');
            }
            if (filteredContacts.length > 0) {
                html += `<div style="font-size: 0.6875rem; font-weight: 700; color: var(--text-muted); padding: 0.5rem 0.75rem 0.25rem;">Contacts</div>`;
                html += filteredContacts.map(user => `
                    <div class="user-item ${activeChat === user.username ? 'active' : ''}"
                         data-username="${user.username}"
                         onclick="Chat.selectContact('${user.username}')">
                        <div class="avatar">${renderAvatar(user.avatar, user.display_name || user.username)}</div>
                        <div class="user-info">
                            <div class="user-name">${escapeHtml(user.display_name || user.username)}</div>
                            <div class="user-status-text">@${escapeHtml(user.username)}</div>
                        </div>
                    </div>
                `).join('');
            }
            elements.userList.innerHTML = html;
        } else {
            elements.userList.innerHTML = `
                <div class="no-contacts">
                    <p style="font-size: 0.8125rem;">No results for "${escapeHtml(trimmed)}"</p>
                    <button class="btn-primary-compact" style="margin-top: 0.5rem;" onclick="Chat.openNewChatWithQuery('${escapeHtml(trimmed)}')">
                        🔍 Search All Users
                    </button>
                </div>
            `;
        }
    }


    // ──────────────────────────────────────────────
    // Chat Selection & History
    // ──────────────────────────────────────────────

    async function selectContact(username) {
        if (activeChat === username && activeChatType === 'direct') return;

        activeChat = username;
        activeChatType = 'direct';
        activeGroup = null;

        if (elements.headerGroupInfoBtn) elements.headerGroupInfoBtn.style.display = 'none';

        document.querySelector('.chat-container')?.classList.add('mobile-chat-open');

        document.querySelectorAll('.user-item').forEach(el => {
            el.classList.toggle('active', el.dataset.username === username);
        });

        if (elements.chatEmpty) elements.chatEmpty.style.display = 'none';
        if (elements.chatActive) elements.chatActive.style.display = 'flex';

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

        await loadChatHistory(username);

        if (elements.messageInput) elements.messageInput.focus();
    }

    async function selectGroup(groupId) {
        if (activeChat === groupId && activeChatType === 'group') return;

        activeChat = groupId;
        activeChatType = 'group';

        if (elements.headerGroupInfoBtn) elements.headerGroupInfoBtn.style.display = 'inline-flex';

        document.querySelector('.chat-container')?.classList.add('mobile-chat-open');

        document.querySelectorAll('.user-item').forEach(el => {
            el.classList.toggle('active', el.dataset.groupId === groupId);
        });

        if (elements.chatEmpty) elements.chatEmpty.style.display = 'none';
        if (elements.chatActive) elements.chatActive.style.display = 'flex';

        try {
            const res = await fetch(`/api/groups/${groupId}`);
            const data = await res.json();
            if (!res.ok || !data.success || !data.group) {
                showNotification(data.error || 'Access denied: You are not a member of this group.', 'error');
                activeChat = null;
                activeChatType = 'direct';
                activeGroup = null;
                if (elements.chatActive) elements.chatActive.style.display = 'none';
                if (elements.chatEmpty) elements.chatEmpty.style.display = 'flex';
                return;
            }

            activeGroup = data.group;
            const members = data.members || [];

            // STRICT MEMBERSHIP CHECK: User must be in group's members
            if (!Array.isArray(activeGroup.members) || !activeGroup.members.includes(currentUser)) {
                showNotification('You are not a member of this group.', 'error');
                activeChat = null;
                activeChatType = 'direct';
                activeGroup = null;
                if (elements.chatActive) elements.chatActive.style.display = 'none';
                if (elements.chatEmpty) elements.chatEmpty.style.display = 'flex';
                return;
            }

                if (elements.headerName) elements.headerName.textContent = activeGroup.name;
                if (elements.headerUsernameBadge) elements.headerUsernameBadge.textContent = `👥 Group (${members.length}/60)`;
                if (elements.headerAvatar) elements.headerAvatar.innerHTML = `<span style="font-size: 1.25rem;">👥</span>`;
                if (elements.headerBioPreview) elements.headerBioPreview.textContent = activeGroup.description ? `“${activeGroup.description}”` : '';
                if (elements.headerStatus) {
                    elements.headerStatus.innerHTML = `
                        <span class="status-indicator online" id="header-status-dot"></span>
                        ${members.length} members • Encrypted Group
                    `;
                }

                // Cache all members' public keys
                if (!groupMemberPublicKeys[groupId]) groupMemberPublicKeys[groupId] = {};
                for (const m of members) {
                    if (m.public_key && !groupMemberPublicKeys[groupId][m.username]) {
                        try {
                            groupMemberPublicKeys[groupId][m.username] = await SecureCrypto.importPublicKey(m.public_key);
                        } catch (err) {
                            console.error(`Failed to import key for group member ${m.username}:`, err);
                        }
                    }
                }

                if (socket) {
                    socket.emit('join_group_room', { group_id: groupId });
                }

                await loadGroupChatHistory(groupId);
        } catch (e) {
            console.error('[Chat] Failed to load group details:', e);
            showNotification('Failed to open group', 'error');
        }

        if (elements.messageInput) elements.messageInput.focus();
    }

    async function loadGroupChatHistory(groupId) {
        if (!elements.messagesArea) return;
        elements.messagesArea.innerHTML = '';

        try {
            const response = await fetch(`/api/groups/${groupId}/messages`);
            const messages = await response.json();

            if (messages.length === 0) {
                elements.messagesArea.innerHTML = `
                    <div class="date-separator">
                        <span>👥 Group created. Messages are end-to-end encrypted (max 60 members).</span>
                    </div>
                `;
                return;
            }

            appendDateSeparator('🔐 End-to-end encrypted group');

            let lastDate = '';
            for (const msg of messages) {
                const msgDate = new Date(msg.timestamp).toLocaleDateString();
                if (msgDate !== lastDate) {
                    appendDateSeparator(msgDate);
                    lastDate = msgDate;
                }

                try {
                    const plaintext = await SecureCrypto.decryptGroupMessage(msg, privateKey, currentUser);
                    appendGroupMessage({
                        sender: msg.sender,
                        plaintext: plaintext,
                        timestamp: msg.timestamp,
                        isSent: msg.sender === currentUser,
                        animate: false
                    });
                } catch (err) {
                    console.error('[Chat] Group message decryption failed:', err);
                    appendGroupMessage({
                        sender: msg.sender,
                        plaintext: '[🔒 Unable to decrypt]',
                        timestamp: msg.timestamp,
                        isSent: msg.sender === currentUser,
                        animate: false
                    });
                }
            }

            scrollToBottom();
        } catch (e) {
            console.error('[Chat] Failed to load group messages:', e);
        }
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
    // Message Sending & Receiving (Direct & Group)
    // ──────────────────────────────────────────────

    async function sendMessage() {
        if (!activeChat || !elements.messageInput) return;

        const plaintext = elements.messageInput.value.trim();
        if (!plaintext) return;

        if (activeChatType === 'group') {
            await sendGroupMessage(plaintext);
            return;
        }

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

    async function sendGroupMessage(plaintext) {
        const groupId = activeChat;
        if (!elements.messageInput) return;

        elements.messageInput.value = '';
        elements.messageInput.style.height = 'auto';

        socket.emit('group_stop_typing', { group_id: groupId });

        try {
            let memberKeys = groupMemberPublicKeys[groupId];
            if (!memberKeys || Object.keys(memberKeys).length === 0) {
                const res = await fetch(`/api/groups/${groupId}`);
                const data = await res.json();
                if (data.success && data.members) {
                    groupMemberPublicKeys[groupId] = {};
                    for (const m of data.members) {
                        if (m.public_key) {
                            groupMemberPublicKeys[groupId][m.username] = await SecureCrypto.importPublicKey(m.public_key);
                        }
                    }
                    memberKeys = groupMemberPublicKeys[groupId];
                }
            }

            if (!memberKeys || Object.keys(memberKeys).length === 0) {
                showNotification('Cannot send: group keys not loaded.', 'error');
                return;
            }

            if (publicKey && !memberKeys[currentUser]) {
                memberKeys[currentUser] = publicKey;
            }

            const encrypted = await SecureCrypto.encryptForGroup(plaintext, memberKeys);

            socket.emit('group_send_message', {
                group_id: groupId,
                ciphertext: encrypted.ciphertext,
                iv: encrypted.iv,
                encrypted_keys: encrypted.encrypted_keys,
            });

            appendGroupMessage({
                sender: currentUser,
                plaintext: plaintext,
                timestamp: new Date().toISOString(),
                isSent: true,
                animate: true
            });
            scrollToBottom();

        } catch (err) {
            console.error('[Chat] Group send error:', err);
            showNotification('Failed to send group message.', 'error');
        }
    }

    async function handleIncomingMessage(data) {
        try {
            const plaintext = await SecureCrypto.decryptReceived(data, privateKey, currentUser);

            if (!contacts.find(c => c.username === data.sender)) {
                await loadContacts();
            }

            if (activeChatType === 'direct' && data.sender === activeChat) {
                appendMessage(plaintext, false, data.timestamp, true);
                scrollToBottom();
                hideTypingIndicator();
            } else {
                showNotification(`New message from ${data.sender}`, 'info');
                const userItem = document.querySelector(`.user-item[data-username="${data.sender}"]`);
                if (userItem) {
                    userItem.style.borderLeft = '3px solid var(--purple-500)';
                }
            }
        } catch (error) {
            console.error('[Chat] Failed to decrypt incoming message:', error);
        }
    }

    async function handleIncomingGroupMessage(data) {
        try {
            if (data.sender === currentUser) return;

            const plaintext = await SecureCrypto.decryptGroupMessage(data, privateKey, currentUser);

            if (activeChatType === 'group' && activeChat === data.group_id) {
                appendGroupMessage({
                    sender: data.sender,
                    plaintext: plaintext,
                    timestamp: data.timestamp,
                    isSent: false,
                    animate: true
                });
                scrollToBottom();
                hideTypingIndicator();
            } else {
                const group = groups.find(g => g.group_id === data.group_id);
                const gName = group ? group.name : 'Group';
                showNotification(`👥 ${gName} — @${data.sender}: ${plaintext.slice(0, 30)}`, 'info');

                const gItem = document.querySelector(`.user-item[data-group-id="${data.group_id}"]`);
                if (gItem) {
                    gItem.style.borderLeft = '3px solid var(--purple-500)';
                }
            }
        } catch (err) {
            console.error('[Chat] Failed to decrypt group message:', err);
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

    function appendGroupMessage({ sender, plaintext, timestamp, isSent, animate = true }) {
        if (!elements.messagesArea) return;

        const time = new Date(timestamp);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const group = document.createElement('div');
        group.className = `message-group ${isSent ? 'sent' : 'received'}`;
        if (!animate) {
            group.style.animation = 'none';
            group.style.opacity = '1';
        }

        const senderHeader = (!isSent) 
            ? `<div class="group-sender-header"><span class="sender-name">${escapeHtml(sender)}</span></div>`
            : '';

        group.innerHTML = `
            <div class="message-bubble">
                ${senderHeader}
                <div class="message-content">${escapeHtml(plaintext)}</div>
            </div>
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

    // ──────────────────────────────────────────────
    // Typing Indicators
    // ──────────────────────────────────────────────

    function handleTyping() {
        if (!activeChat) return;

        clearTimeout(typingTimeout);

        if (activeChatType === 'group') {
            socket.emit('group_typing', { group_id: activeChat });
            typingTimeout = setTimeout(() => {
                socket.emit('group_stop_typing', { group_id: activeChat });
            }, 2000);
        } else {
            socket.emit('typing', { recipient: activeChat });
            typingTimeout = setTimeout(() => {
                socket.emit('stop_typing', { recipient: activeChat });
            }, 2000);
        }
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

        // ── Sidebar Tabs (All / Direct / Groups) ──
        if (elements.tabAll) {
            elements.tabAll.addEventListener('click', () => handleTabClick('all'));
        }
        if (elements.tabDirect) {
            elements.tabDirect.addEventListener('click', () => handleTabClick('direct'));
        }
        if (elements.tabGroups) {
            elements.tabGroups.addEventListener('click', () => handleTabClick('groups'));
        }

        // ── Create Group Event Listeners ──
        if (elements.sidebarNewGroupBtn) {
            elements.sidebarNewGroupBtn.addEventListener('click', openCreateGroupModal);
        }
        if (elements.openNewGroupBtn) {
            elements.openNewGroupBtn.addEventListener('click', openCreateGroupModal);
        }
        if (elements.closeCreateGroupModal) {
            elements.closeCreateGroupModal.addEventListener('click', closeCreateGroupModal);
        }
        if (elements.cancelCreateGroupBtn) {
            elements.cancelCreateGroupBtn.addEventListener('click', closeCreateGroupModal);
        }
        if (elements.createGroupModal) {
            elements.createGroupModal.addEventListener('click', (e) => {
                if (e.target === elements.createGroupModal) closeCreateGroupModal();
            });
        }
        if (elements.groupUserSearchInput) {
            elements.groupUserSearchInput.addEventListener('input', (e) => {
                handleGroupUserSearch(e.target.value);
            });
        }
        if (elements.createGroupForm) {
            elements.createGroupForm.addEventListener('submit', handleCreateGroupSubmit);
        }

        // ── Group Info Modal Event Listeners ──
        if (elements.headerGroupInfoBtn) {
            elements.headerGroupInfoBtn.addEventListener('click', openGroupInfoModal);
        }
        if (elements.closeGroupInfoModal) {
            elements.closeGroupInfoModal.addEventListener('click', closeGroupInfoModal);
        }
        if (elements.closeGroupInfoFooterBtn) {
            elements.closeGroupInfoFooterBtn.addEventListener('click', closeGroupInfoModal);
        }
        if (elements.groupInfoModal) {
            elements.groupInfoModal.addEventListener('click', (e) => {
                if (e.target === elements.groupInfoModal) closeGroupInfoModal();
            });
        }
        if (elements.groupAddMemberBtn) {
            elements.groupAddMemberBtn.addEventListener('click', handleAddMemberToGroup);
        }
        if (elements.groupAddMemberInput) {
            elements.groupAddMemberInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMemberToGroup();
                }
            });
        }
        if (elements.leaveGroupBtn) {
            elements.leaveGroupBtn.addEventListener('click', handleLeaveGroup);
        }

        // ── Mobile Back Button ──
        if (elements.mobileBackBtn) {
            elements.mobileBackBtn.addEventListener('click', () => {
                document.querySelector('.chat-container')?.classList.remove('mobile-chat-open');
                activeChat = null;
                activeChatType = 'direct';
                activeGroup = null;
                if (elements.chatActive) elements.chatActive.style.display = 'none';
                if (elements.chatEmpty) elements.chatEmpty.style.display = 'flex';
                renderSidebarList();
            });
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
    // Group Chat & Tabs Management (Max 60 Members)
    // ──────────────────────────────────────────────

    function handleTabClick(tab) {
        activeTab = tab;
        [elements.tabAll, elements.tabDirect, elements.tabGroups].forEach(btn => {
            if (btn) btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderSidebarList();
    }

    function openCreateGroupModal() {
        if (!elements.createGroupModal) return;
        selectedGroupMembers = [];
        if (elements.groupNameInput) elements.groupNameInput.value = '';
        if (elements.groupDescInput) elements.groupDescInput.value = '';
        if (elements.groupUserSearchInput) elements.groupUserSearchInput.value = '';
        if (elements.groupUserSearchResults) elements.groupUserSearchResults.innerHTML = '';
        if (elements.createGroupError) elements.createGroupError.style.display = 'none';
        renderSelectedGroupMemberChips();
        elements.createGroupModal.style.display = 'flex';
        if (elements.groupNameInput) elements.groupNameInput.focus();
    }

    function closeCreateGroupModal() {
        if (elements.createGroupModal) elements.createGroupModal.style.display = 'none';
        clearTimeout(groupSearchDebounceTimer);
    }

    function renderSelectedGroupMemberChips() {
        const totalCount = selectedGroupMembers.length + 1; // +1 for current user / admin
        if (elements.createGroupMemberCount) {
            elements.createGroupMemberCount.textContent = `${totalCount} / 60 members (including you)`;
            if (totalCount >= 60) {
                elements.createGroupMemberCount.style.background = 'rgba(239, 68, 68, 0.2)';
                elements.createGroupMemberCount.style.color = 'var(--red-400)';
            } else {
                elements.createGroupMemberCount.style.background = 'rgba(139, 92, 246, 0.15)';
                elements.createGroupMemberCount.style.color = 'var(--purple-400)';
            }
        }

        if (!elements.createGroupSelectedChips) return;
        let html = `
            <div class="member-chip you">
                <span>${escapeHtml(currentUser)} (You - Admin)</span>
            </div>
        `;
        html += selectedGroupMembers.map(u => `
            <div class="member-chip">
                <span>@${escapeHtml(u)}</span>
                <button type="button" class="remove-chip-btn" onclick="Chat.removeMemberFromGroupSelection('${escapeHtml(u)}')">&times;</button>
            </div>
        `).join('');
        elements.createGroupSelectedChips.innerHTML = html;
    }

    function addMemberToGroupSelection(username) {
        if (username === currentUser) return;
        if (selectedGroupMembers.includes(username)) return;

        if (selectedGroupMembers.length + 1 >= 60) {
            if (elements.createGroupError) {
                elements.createGroupError.textContent = 'Maximum group limit of 60 members reached!';
                elements.createGroupError.style.display = 'block';
            }
            return;
        }

        selectedGroupMembers.push(username);
        if (elements.createGroupError) elements.createGroupError.style.display = 'none';
        renderSelectedGroupMemberChips();

        // Refresh search results to show added state
        const query = elements.groupUserSearchInput ? elements.groupUserSearchInput.value : '';
        if (query) handleGroupUserSearch(query);
    }

    function removeMemberFromGroupSelection(username) {
        selectedGroupMembers = selectedGroupMembers.filter(u => u !== username);
        if (elements.createGroupError) elements.createGroupError.style.display = 'none';
        renderSelectedGroupMemberChips();

        const query = elements.groupUserSearchInput ? elements.groupUserSearchInput.value : '';
        if (query) handleGroupUserSearch(query);
    }

    function handleGroupUserSearch(query) {
        clearTimeout(groupSearchDebounceTimer);
        const trimmed = (query || '').trim();

        if (!trimmed) {
            if (elements.groupUserSearchResults) elements.groupUserSearchResults.innerHTML = '';
            return;
        }

        groupSearchDebounceTimer = setTimeout(async () => {
            try {
                const response = await fetch(`/api/search_users?q=${encodeURIComponent(trimmed)}`);
                if (response.ok) {
                    const userList = await response.json();
                    renderGroupUserSearchResults(userList.filter(u => u.username !== currentUser));
                }
            } catch (err) {
                console.error('[Chat] Group user search error:', err);
            }
        }, 200);
    }

    function renderGroupUserSearchResults(userList) {
        if (!elements.groupUserSearchResults) return;
        if (userList.length === 0) {
            elements.groupUserSearchResults.innerHTML = `
                <div style="padding: 0.5rem; text-align: center; color: var(--text-muted); font-size: 0.8125rem;">
                    No users found
                </div>
            `;
            return;
        }

        elements.groupUserSearchResults.innerHTML = userList.map(u => {
            const isAdded = selectedGroupMembers.includes(u.username);
            const isFull = (selectedGroupMembers.length + 1 >= 60);
            return `
                <div class="group-member-row" style="padding: 0.4rem 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <div class="avatar" style="width: 28px; height: 28px; font-size: 0.75rem;">
                            ${renderAvatar(u.avatar, u.display_name || u.username)}
                        </div>
                        <div>
                            <div style="font-size: 0.8125rem; font-weight: 600;">${escapeHtml(u.display_name || u.username)}</div>
                            <div style="font-size: 0.6875rem; color: var(--text-muted);">@${escapeHtml(u.username)}</div>
                        </div>
                    </div>
                    ${isAdded ? `
                        <button type="button" class="btn-subtle" style="font-size: 0.75rem; padding: 2px 8px; color: var(--accent-cyan);" onclick="Chat.removeMemberFromGroupSelection('${escapeHtml(u.username)}')">
                            ✓ Added
                        </button>
                    ` : `
                        <button type="button" class="btn-primary-compact" style="font-size: 0.75rem; padding: 2px 8px;" ${isFull ? 'disabled' : ''} onclick="Chat.addMemberToGroupSelection('${escapeHtml(u.username)}')">
                            + Add
                        </button>
                    `}
                </div>
            `;
        }).join('');
    }

    async function handleCreateGroupSubmit(e) {
        e.preventDefault();
        const name = (elements.groupNameInput?.value || '').trim();
        const description = (elements.groupDescInput?.value || '').trim();

        if (!name) {
            if (elements.createGroupError) {
                elements.createGroupError.textContent = 'Group name is required.';
                elements.createGroupError.style.display = 'block';
            }
            return;
        }

        if (selectedGroupMembers.length + 1 > 60) {
            if (elements.createGroupError) {
                elements.createGroupError.textContent = 'A group cannot exceed 60 members.';
                elements.createGroupError.style.display = 'block';
            }
            return;
        }

        if (elements.submitCreateGroupBtn) {
            elements.submitCreateGroupBtn.disabled = true;
            elements.submitCreateGroupBtn.classList.add('loading');
        }

        try {
            const res = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    description: description,
                    members: selectedGroupMembers,
                }),
            });

            const data = await res.json();
            if (res.ok && data.success) {
                closeCreateGroupModal();
                showNotification(`Group "${name}" created!`, 'success');

                // Add to local groups list and select
                groups.unshift(data.group);
                if (elements.groupsCountBadge) {
                    elements.groupsCountBadge.textContent = groups.length;
                    elements.groupsCountBadge.style.display = 'inline-block';
                }
                renderSidebarList();
                await selectGroup(data.group.group_id);
            } else {
                if (elements.createGroupError) {
                    elements.createGroupError.textContent = data.error || 'Failed to create group.';
                    elements.createGroupError.style.display = 'block';
                }
            }
        } catch (err) {
            console.error('[Chat] Create group error:', err);
            if (elements.createGroupError) {
                elements.createGroupError.textContent = 'Network error while creating group.';
                elements.createGroupError.style.display = 'block';
            }
        } finally {
            if (elements.submitCreateGroupBtn) {
                elements.submitCreateGroupBtn.disabled = false;
                elements.submitCreateGroupBtn.classList.remove('loading');
            }
        }
    }

    async function openGroupInfoModal() {
        if (!activeGroup || activeChatType !== 'group' || !elements.groupInfoModal) return;

        try {
            const res = await fetch(`/api/groups/${activeGroup.group_id}`);
            const data = await res.json();
            if (res.ok && data.success) {
                activeGroup = data.group;
                const members = data.members || [];
                const memberCount = members.length;

                if (elements.groupInfoTitle) elements.groupInfoTitle.textContent = activeGroup.name;
                if (elements.groupInfoName) elements.groupInfoName.textContent = activeGroup.name;
                if (elements.groupInfoDesc) elements.groupInfoDesc.textContent = activeGroup.description || 'No description set';
                if (elements.groupInfoLimitBadge) elements.groupInfoLimitBadge.textContent = `${memberCount} / 60 Members`;
                if (elements.groupInfoMemberCount) elements.groupInfoMemberCount.textContent = `${memberCount} members (max 60)`;

                // Render member list
                if (elements.groupInfoMembersList) {
                    elements.groupInfoMembersList.innerHTML = members.map(m => {
                        const isSelf = m.username === currentUser;
                        const isAdmin = m.username === activeGroup.created_by;
                        return `
                            <div class="group-member-row">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <div class="avatar" style="width: 32px; height: 32px; font-size: 0.8125rem;">
                                        ${renderAvatar(m.avatar, m.display_name || m.username)}
                                    </div>
                                    <div>
                                        <div style="font-size: 0.875rem; font-weight: 600;">
                                            ${escapeHtml(m.display_name || m.username)} ${isSelf ? '<small style="color: var(--text-muted);">(You)</small>' : ''}
                                        </div>
                                        <div style="font-size: 0.75rem; color: var(--text-muted);">@${escapeHtml(m.username)}</div>
                                    </div>
                                </div>
                                <div>
                                    ${isAdmin ? '<span class="admin-badge">Admin</span>' : ''}
                                </div>
                            </div>
                        `;
                    }).join('');
                }

                if (elements.groupAddMemberInput) elements.groupAddMemberInput.value = '';
                if (elements.groupAddMemberMsg) elements.groupAddMemberMsg.style.display = 'none';

                // Disable add section if limit 60 is reached
                if (elements.groupAddMemberBtn) {
                    elements.groupAddMemberBtn.disabled = (memberCount >= 60);
                }
                if (elements.groupAddMemberInput) {
                    elements.groupAddMemberInput.disabled = (memberCount >= 60);
                    if (memberCount >= 60) {
                        elements.groupAddMemberInput.placeholder = 'Group is full (60/60 members reached)';
                    } else {
                        elements.groupAddMemberInput.placeholder = 'Enter username to add...';
                    }
                }

                elements.groupInfoModal.style.display = 'flex';
            }
        } catch (err) {
            console.error('[Chat] Open group info error:', err);
            showNotification('Failed to load group details', 'error');
        }
    }

    function closeGroupInfoModal() {
        if (elements.groupInfoModal) elements.groupInfoModal.style.display = 'none';
    }

    async function handleAddMemberToGroup() {
        if (!activeGroup) return;
        const input = elements.groupAddMemberInput;
        const msg = elements.groupAddMemberMsg;
        const username = (input ? input.value : '').trim();

        if (!username) return;

        if (activeGroup.members && activeGroup.members.length >= 60) {
            if (msg) {
                msg.textContent = 'Cannot add member: maximum group limit of 60 members reached.';
                msg.className = 'flash-message error';
                msg.style.display = 'block';
            }
            return;
        }

        try {
            const res = await fetch(`/api/groups/${activeGroup.group_id}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                if (msg) {
                    msg.textContent = `@${username} added to group!`;
                    msg.className = 'flash-message success';
                    msg.style.display = 'block';
                }
                if (input) input.value = '';
                // Refresh modal & keys
                await openGroupInfoModal();
                await loadGroups();
            } else {
                if (msg) {
                    msg.textContent = data.error || 'Failed to add member.';
                    msg.className = 'flash-message error';
                    msg.style.display = 'block';
                }
            }
        } catch (err) {
            console.error('[Chat] Add member error:', err);
            if (msg) {
                msg.textContent = 'Network error while adding member.';
                msg.className = 'flash-message error';
                msg.style.display = 'block';
            }
        }
    }

    async function handleLeaveGroup() {
        if (!activeGroup) return;
        if (!confirm(`Are you sure you want to leave "${activeGroup.name}"?`)) return;

        const groupId = activeGroup.group_id;
        try {
            const res = await fetch(`/api/groups/${groupId}/members/${currentUser}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (res.ok && data.success) {
                closeGroupInfoModal();
                showNotification(`Left "${activeGroup.name}"`, 'info');
                // Remove from local list
                groups = groups.filter(g => g.group_id !== groupId);
                if (elements.groupsCountBadge) {
                    elements.groupsCountBadge.textContent = groups.length;
                    elements.groupsCountBadge.style.display = groups.length > 0 ? 'inline-block' : 'none';
                }
                activeChat = null;
                activeChatType = 'direct';
                activeGroup = null;
                document.querySelector('.chat-container')?.classList.remove('mobile-chat-open');
                if (elements.chatActive) elements.chatActive.style.display = 'none';
                if (elements.chatEmpty) elements.chatEmpty.style.display = 'flex';
                renderSidebarList();
            } else {
                showNotification(data.error || 'Failed to leave group', 'error');
            }
        } catch (err) {
            console.error('[Chat] Leave group error:', err);
            showNotification('Network error while leaving group', 'error');
        }
    }

    function handleGroupCreated(data) {
        if (!data) return;
        const group = data.group || data;
        if (!group || !group.group_id) return;

        // PRIVACY ENFORCEMENT: Only process if currentUser is an explicit member
        if (!Array.isArray(group.members) || !group.members.includes(currentUser)) {
            return;
        }

        if (!groups.find(g => g.group_id === group.group_id)) {
            groups.unshift(group);
            updateGroupsCountBadge();
            renderSidebarList();
        }
    }

    function handleGroupUpdated(data) {
        if (!data) return;
        const group = data.group || data;
        const groupId = group.group_id || data.group_id;
        if (!groupId) return;

        // Extract member usernames
        let memberUsernames = [];
        if (Array.isArray(data.members)) {
            memberUsernames = data.members.map(m => (typeof m === 'object' && m ? m.username : m));
        } else if (Array.isArray(group.members)) {
            memberUsernames = group.members.map(m => (typeof m === 'object' && m ? m.username : m));
        }

        // If current user is NO LONGER a member of this group, remove it immediately!
        if (memberUsernames.length > 0 && !memberUsernames.includes(currentUser)) {
            groups = groups.filter(item => item.group_id !== groupId);
            if (activeChatType === 'group' && activeChat === groupId) {
                activeChat = null;
                activeGroup = null;
                if (elements.chatActive) elements.chatActive.style.display = 'none';
                if (elements.chatEmpty) elements.chatEmpty.style.display = 'flex';
                showNotification('You are no longer a member of this group.', 'info');
            }
            updateGroupsCountBadge();
            renderSidebarList();
            return;
        }

        const g = groups.find(item => item.group_id === groupId);
        if (g) {
            if (group.name) g.name = group.name;
            if (group.description !== undefined) g.description = group.description;
            if (memberUsernames.length > 0) {
                g.members = memberUsernames;
                g.member_count = memberUsernames.length;
            }
            updateGroupsCountBadge();
            renderSidebarList();
        } else if (memberUsernames.includes(currentUser)) {
            // User was newly added to this group!
            groups.unshift(group);
            updateGroupsCountBadge();
            renderSidebarList();
        }

        if (activeChatType === 'group' && activeChat === groupId) {
            if (elements.headerUsernameBadge && memberUsernames.length > 0) {
                elements.headerUsernameBadge.textContent = `👥 Group (${memberUsernames.length}/60)`;
            }
        }
    }

    function handleGroupLeft(data) {
        if (!data || !data.group_id) return;
        if (data.username === currentUser) {
            groups = groups.filter(g => g.group_id !== data.group_id);
            if (activeChat === data.group_id) {
                activeChat = null;
                activeGroup = null;
                if (elements.chatActive) elements.chatActive.style.display = 'none';
                if (elements.chatEmpty) elements.chatEmpty.style.display = 'flex';
            }
            updateGroupsCountBadge();
            renderSidebarList();
        } else if (activeChatType === 'group' && activeChat === data.group_id) {
            // Another member left
            if (activeGroup && Array.isArray(activeGroup.members)) {
                activeGroup.members = activeGroup.members.filter(m => m !== data.username);
                if (elements.headerUsernameBadge) {
                    elements.headerUsernameBadge.textContent = `👥 Group (${activeGroup.members.length}/60)`;
                }
            }
            const g = groups.find(item => item.group_id === data.group_id);
            if (g && Array.isArray(g.members)) {
                g.members = g.members.filter(m => m !== data.username);
                g.member_count = g.members.length;
            }
            renderSidebarList();
        }
    }


    // ──────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────

    return {
        init,
        selectContact,
        selectGroup,
        sendMessage,
        openNewChatModal,
        openNewChatWithQuery,
        closeNewChatModal,
        startChatWith,
        loadContacts,
        loadGroups,
        openEditProfileModal,
        closeEditProfileModal,
        openCreateGroupModal,
        closeCreateGroupModal,
        openGroupInfoModal,
        closeGroupInfoModal,
        addMemberToGroupSelection,
        removeMemberFromGroupSelection,
        handleTabClick,
    };
})();
