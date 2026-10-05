/**
 * SecureChat — Client-Side Cryptography Module
 * 
 * All encryption/decryption happens HERE in the browser.
 * The server NEVER sees plaintext messages.
 * 
 * Algorithms:
 *   - RSA-OAEP (2048-bit) → Key exchange
 *   - AES-256-GCM → Message encryption
 *   - PBKDF2-SHA256 → Password-based key derivation (for private key protection)
 * 
 * Uses the Web Crypto API (SubtleCrypto) — browser-native, hardware-accelerated.
 */

const SecureCrypto = (() => {
    'use strict';

    // ──────────────────────────────────────────────
    // Utility Functions
    // ──────────────────────────────────────────────

    /**
     * Convert ArrayBuffer to Base64 string.
     */
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert Base64 string to ArrayBuffer.
     */
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Encode a string to UTF-8 ArrayBuffer.
     */
    function stringToBuffer(str) {
        return new TextEncoder().encode(str);
    }

    /**
     * Decode a UTF-8 ArrayBuffer to string.
     */
    function bufferToString(buffer) {
        return new TextDecoder().decode(buffer);
    }


    // ──────────────────────────────────────────────
    // RSA Key Generation & Management
    // ──────────────────────────────────────────────

    /**
     * Generate a new RSA-OAEP 2048-bit keypair.
     * 
     * @returns {Promise<CryptoKeyPair>} The generated keypair.
     */
    async function generateRSAKeyPair() {
        return await crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),  // 65537
                hash: 'SHA-256',
            },
            true,  // extractable
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Export an RSA public key to Base64 (SPKI format).
     */
    async function exportPublicKey(publicKey) {
        const exported = await crypto.subtle.exportKey('spki', publicKey);
        return arrayBufferToBase64(exported);
    }

    /**
     * Export an RSA private key to Base64 (PKCS8 format).
     */
    async function exportPrivateKey(privateKey) {
        const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
        return arrayBufferToBase64(exported);
    }

    /**
     * Import an RSA public key from Base64 (SPKI format).
     */
    async function importPublicKey(base64Key) {
        const keyBuffer = base64ToArrayBuffer(base64Key);
        return await crypto.subtle.importKey(
            'spki',
            keyBuffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
    }

    /**
     * Import an RSA private key from Base64 (PKCS8 format).
     */
    async function importPrivateKey(base64Key) {
        const keyBuffer = base64ToArrayBuffer(base64Key);
        return await crypto.subtle.importKey(
            'pkcs8',
            keyBuffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt']
        );
    }

    /**
     * Encrypt the RSA private key with a password-derived AES key.
     * Used to safely store the private key on the server.
     * 
     * @param {CryptoKey} privateKey - The RSA private key to protect.
     * @param {string} password - The user's password.
     * @returns {Object} { encryptedKey, iv, salt } all Base64-encoded.
     */
    async function encryptPrivateKey(privateKey, password) {
        // Generate random salt and IV
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Derive AES key from password using PBKDF2
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            stringToBuffer(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        const aesKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256',
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        // Export and encrypt the private key
        const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', privateKey);
        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            privateKeyBuffer
        );

        return {
            encryptedKey: arrayBufferToBase64(encryptedBuffer),
            iv: arrayBufferToBase64(iv),
            salt: arrayBufferToBase64(salt),
        };
    }

    /**
     * Decrypt the RSA private key using the user's password.
     * 
     * @param {string} encryptedKeyBase64 - Base64 encrypted private key.
     * @param {string} ivBase64 - Base64 IV used for encryption.
     * @param {string} saltBase64 - Base64 salt used for PBKDF2.
     * @param {string} password - The user's password.
     * @returns {Promise<CryptoKey>} The decrypted RSA private key.
     */
    async function decryptPrivateKey(encryptedKeyBase64, ivBase64, saltBase64, password) {
        const encryptedBuffer = base64ToArrayBuffer(encryptedKeyBase64);
        const iv = base64ToArrayBuffer(ivBase64);
        const salt = base64ToArrayBuffer(saltBase64);

        // Re-derive the same AES key from password
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            stringToBuffer(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        const aesKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256',
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        // Decrypt the private key
        const privateKeyBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            encryptedBuffer
        );

        // Import as RSA private key
        return await crypto.subtle.importKey(
            'pkcs8',
            privateKeyBuffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt']
        );
    }


    // ──────────────────────────────────────────────
    // AES-256-GCM Message Encryption
    // ──────────────────────────────────────────────

    /**
     * Generate a random AES-256 key for message encryption.
     */
    async function generateAESKey() {
        return await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,  // extractable (needed to encrypt with RSA)
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Encrypt a message using AES-256-GCM.
     * 
     * @param {string} plaintext - The message to encrypt.
     * @param {CryptoKey} aesKey - The AES-256 key.
     * @returns {Object} { ciphertext, iv } both Base64-encoded.
     */
    async function encryptMessage(plaintext, aesKey) {
        const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV for GCM
        const encoded = stringToBuffer(plaintext);

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            encoded
        );

        return {
            ciphertext: arrayBufferToBase64(encrypted),
            iv: arrayBufferToBase64(iv),
        };
    }

    /**
     * Decrypt a message using AES-256-GCM.
     * 
     * @param {string} ciphertextBase64 - Base64 encoded ciphertext.
     * @param {string} ivBase64 - Base64 encoded IV.
     * @param {CryptoKey} aesKey - The AES-256 key.
     * @returns {Promise<string>} The decrypted plaintext message.
     */
    async function decryptMessage(ciphertextBase64, ivBase64, aesKey) {
        const ciphertext = base64ToArrayBuffer(ciphertextBase64);
        const iv = base64ToArrayBuffer(ivBase64);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            ciphertext
        );

        return bufferToString(decrypted);
    }

    /**
     * Encrypt an AES key with an RSA public key (for key exchange).
     * 
     * @param {CryptoKey} aesKey - The AES key to protect.
     * @param {CryptoKey} rsaPublicKey - The recipient's RSA public key.
     * @returns {Promise<string>} Base64-encoded encrypted AES key.
     */
    async function encryptAESKeyWithRSA(aesKey, rsaPublicKey) {
        const rawKey = await crypto.subtle.exportKey('raw', aesKey);
        const encrypted = await crypto.subtle.encrypt(
            { name: 'RSA-OAEP' },
            rsaPublicKey,
            rawKey
        );
        return arrayBufferToBase64(encrypted);
    }

    /**
     * Decrypt an AES key with an RSA private key.
     * 
     * @param {string} encryptedKeyBase64 - Base64 encrypted AES key.
     * @param {CryptoKey} rsaPrivateKey - The recipient's RSA private key.
     * @returns {Promise<CryptoKey>} The decrypted AES key.
     */
    async function decryptAESKeyWithRSA(encryptedKeyBase64, rsaPrivateKey) {
        const encryptedBuffer = base64ToArrayBuffer(encryptedKeyBase64);
        const rawKey = await crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            rsaPrivateKey,
            encryptedBuffer
        );

        return await crypto.subtle.importKey(
            'raw',
            rawKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }


    // ──────────────────────────────────────────────
    // High-Level API
    // ──────────────────────────────────────────────

    /**
     * Encrypt a message for a recipient.
     * Generates a per-message AES key, encrypts the message, 
     * then encrypts the AES key with both the recipient's and sender's RSA public keys.
     * 
     * @param {string} plaintext - Message to send.
     * @param {CryptoKey} recipientPublicKey - Recipient's RSA public key.
     * @param {CryptoKey} senderPublicKey - Sender's own RSA public key (to read own messages).
     * @returns {Object} Encrypted payload ready to send to server.
     */
    async function encryptForSending(plaintext, recipientPublicKey, senderPublicKey) {
        // Generate a fresh AES key for this message
        const aesKey = await generateAESKey();

        // Encrypt the message
        const { ciphertext, iv } = await encryptMessage(plaintext, aesKey);

        // Encrypt the AES key for both recipient and sender
        const encryptedAESKey = await encryptAESKeyWithRSA(aesKey, recipientPublicKey);
        const senderEncryptedAESKey = await encryptAESKeyWithRSA(aesKey, senderPublicKey);

        return {
            ciphertext,
            iv,
            encrypted_aes_key: encryptedAESKey,
            sender_encrypted_aes_key: senderEncryptedAESKey,
        };
    }

    /**
     * Decrypt a received message.
     * 
     * @param {Object} encryptedPayload - The encrypted message data from server.
     * @param {CryptoKey} privateKey - The user's RSA private key.
     * @param {string} currentUser - The current logged-in username.
     * @returns {Promise<string>} The decrypted plaintext message.
     */
    async function decryptReceived(encryptedPayload, privateKey, currentUser) {
        // Determine which encrypted AES key to use
        const encryptedAESKey = encryptedPayload.sender === currentUser
            ? encryptedPayload.sender_encrypted_aes_key
            : encryptedPayload.encrypted_aes_key;

        // Decrypt the AES key with our RSA private key
        const aesKey = await decryptAESKeyWithRSA(encryptedAESKey, privateKey);

        // Decrypt the message
        return await decryptMessage(encryptedPayload.ciphertext, encryptedPayload.iv, aesKey);
    }

    /**
     * Encrypt a message for a group with up to 60 members.
     * Generates a fresh AES-256 key, encrypts the plaintext, 
     * then encrypts the AES key individually with each member's RSA public key.
     * 
     * @param {string} plaintext - Message to encrypt.
     * @param {Object} memberPublicKeys - Object mapping username -> CryptoKey (RSA public key).
     * @returns {Promise<Object>} { ciphertext, iv, encrypted_keys }
     */
    async function encryptForGroup(plaintext, memberPublicKeys) {
        // Generate single fresh AES key for this message
        const aesKey = await generateAESKey();

        // Encrypt the message content
        const { ciphertext, iv } = await encryptMessage(plaintext, aesKey);

        // Encrypt the AES key for every member in the group
        const encrypted_keys = {};
        for (const [username, pubKey] of Object.entries(memberPublicKeys)) {
            if (pubKey) {
                encrypted_keys[username] = await encryptAESKeyWithRSA(aesKey, pubKey);
            }
        }

        return {
            ciphertext,
            iv,
            encrypted_keys,
        };
    }

    /**
     * Decrypt a received group message.
     * 
     * @param {Object} encryptedPayload - The group message payload from server.
     * @param {CryptoKey} privateKey - Current user's RSA private key.
     * @param {string} currentUser - Current username.
     * @returns {Promise<string>} The decrypted plaintext.
     */
    async function decryptGroupMessage(encryptedPayload, privateKey, currentUser) {
        if (!encryptedPayload.encrypted_keys || !encryptedPayload.encrypted_keys[currentUser]) {
            throw new Error(`No encrypted AES key available for user: ${currentUser}`);
        }

        const encryptedAESKey = encryptedPayload.encrypted_keys[currentUser];
        const aesKey = await decryptAESKeyWithRSA(encryptedAESKey, privateKey);
        return await decryptMessage(encryptedPayload.ciphertext, encryptedPayload.iv, aesKey);
    }


    // ──────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────

    return {
        // RSA
        generateRSAKeyPair,
        exportPublicKey,
        exportPrivateKey,
        importPublicKey,
        importPrivateKey,
        encryptPrivateKey,
        decryptPrivateKey,

        // AES
        generateAESKey,
        encryptMessage,
        decryptMessage,

        // Key Exchange
        encryptAESKeyWithRSA,
        decryptAESKeyWithRSA,

        // High-Level
        encryptForSending,
        decryptReceived,
        encryptForGroup,
        decryptGroupMessage,

        // Utilities
        arrayBufferToBase64,
        base64ToArrayBuffer,
    };
})();
