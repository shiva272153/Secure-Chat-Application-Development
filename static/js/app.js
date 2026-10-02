/**
 * SecureChat — App Initialization
 * Entry point for the chat page. Bootstraps crypto and chat modules.
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const chatPage = document.getElementById('chat-page');
    if (!chatPage) return;  // Not on chat page

    const username = chatPage.dataset.username;
    if (!username) {
        console.error('[App] No username found');
        return;
    }

    console.log(`[App] SecureChat initializing for user: ${username}`);
    console.log('[App] Crypto algorithms: RSA-OAEP-2048, AES-256-GCM, PBKDF2-SHA256');

    // Initialize chat (handles key decryption, socket connection, etc.)
    Chat.init(username);
});
