/**
 * SecureChat — Authentication Module
 * 
 * Handles registration with client-side RSA keypair generation
 * and login with client-side private key decryption.
 */

const Auth = (() => {
    'use strict';

    /**
     * Handle registration form submission.
     * 1. Generate RSA-2048 keypair
     * 2. Encrypt private key with user's password
     * 3. Submit everything to the server
     */
    async function handleRegister(event) {
        event.preventDefault();

        const form = event.target;
        const username = form.querySelector('#reg-username').value.trim().toLowerCase();
        const password = form.querySelector('#reg-password').value;
        const confirmPassword = form.querySelector('#reg-confirm-password').value;
        const submitBtn = form.querySelector('.btn-primary');
        const keygenStatus = document.getElementById('keygen-status');

        // Client-side validation
        if (!username || !password || !confirmPassword) {
            showFlash('Please fill in all fields.', 'error');
            return;
        }

        if (username.length < 3) {
            showFlash('Username must be at least 3 characters.', 'error');
            return;
        }

        if (password.length < 8) {
            showFlash('Password must be at least 8 characters.', 'error');
            return;
        }

        if (password !== confirmPassword) {
            showFlash('Passwords do not match.', 'error');
            return;
        }

        // Disable button and show keygen status
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        if (keygenStatus) {
            keygenStatus.classList.add('active');
            keygenStatus.textContent = '🔑 Generating RSA-2048 keypair...';
        }

        try {
            // Step 1: Generate RSA keypair
            console.log('[Auth] Generating RSA-2048 keypair...');
            const keyPair = await SecureCrypto.generateRSAKeyPair();

            if (keygenStatus) {
                keygenStatus.textContent = '🔒 Encrypting private key with your password...';
            }

            // Step 2: Export public key
            const publicKeyBase64 = await SecureCrypto.exportPublicKey(keyPair.publicKey);

            // Step 3: Encrypt private key with password
            const { encryptedKey, iv, salt } = await SecureCrypto.encryptPrivateKey(
                keyPair.privateKey,
                password
            );

            if (keygenStatus) {
                keygenStatus.textContent = '📤 Creating your account...';
            }

            // Step 4: Submit with crypto data
            sessionStorage.setItem('_sc_pwd', password);

            const response = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    password: password,
                    confirm_password: confirmPassword,
                    public_key: publicKeyBase64,
                    encrypted_private_key: encryptedKey,
                    private_key_iv: iv,
                    private_key_salt: salt,
                }),
            });

            const data = await response.json();
            if (data.success && data.redirect) {
                window.location.href = data.redirect;
            } else {
                showFlash(data.error || 'Registration failed. Please try again.', 'error');
            }

        } catch (error) {
            console.error('[Auth] Registration error:', error);
            showFlash('An error occurred during registration. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            if (keygenStatus) {
                keygenStatus.classList.remove('active');
            }
        }
    }

    /**
     * Handle login — store password in sessionStorage for client-side key decryption,
     * then navigate to /chat.
     */
    async function handleLogin(event) {
        event.preventDefault();

        const form = event.target;
        const username = form.querySelector('#login-username').value.trim().toLowerCase();
        const password = form.querySelector('#login-password').value;
        const submitBtn = form.querySelector('.btn-primary');

        if (!username || !password) {
            showFlash('Please enter both username and password.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            // Save password temporarily in sessionStorage for RSA key decryption
            sessionStorage.setItem('_sc_pwd', password);

            const response = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();
            if (data.success && data.redirect) {
                window.location.href = data.redirect;
            } else {
                showFlash(data.error || 'Invalid username or password.', 'error');
            }
        } catch (error) {
            console.error('[Auth] Login error:', error);
            showFlash('An error occurred during login. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    }

    /**
     * Password strength indicator.
     */
    function updatePasswordStrength(password) {
        const bar = document.querySelector('.password-strength-bar');
        const text = document.querySelector('.password-strength-text');
        if (!bar || !text) return;

        let strength = 0;
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^A-Za-z0-9]/.test(password)) strength++;

        const levels = [
            { width: '0%', color: 'transparent', text: '' },
            { width: '20%', color: '#ef4444', text: 'Very weak' },
            { width: '40%', color: '#f97316', text: 'Weak' },
            { width: '60%', color: '#eab308', text: 'Fair' },
            { width: '80%', color: '#22c55e', text: 'Strong' },
            { width: '100%', color: '#06b6d4', text: 'Very strong' },
        ];

        const level = levels[strength];
        bar.style.width = level.width;
        bar.style.background = level.color;
        text.textContent = level.text;
        text.style.color = level.color;
    }

    /**
     * Show a flash message.
     */
    function showFlash(message, type = 'error') {
        const icons = {
            error: '⚠️',
            success: '✅',
            warning: '⚠️',
            info: 'ℹ️',
        };

        // Remove existing flash messages
        document.querySelectorAll('.flash-message').forEach(el => el.remove());

        const flash = document.createElement('div');
        flash.className = `flash-message ${type}`;
        flash.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;

        const form = document.querySelector('form');
        if (form) {
            form.insertBefore(flash, form.firstChild);
        }

        // Auto-remove after 5 seconds
        setTimeout(() => flash.remove(), 5000);
    }

    /**
     * Initialize auth page event listeners.
     */
    function init() {
        const registerForm = document.getElementById('register-form');
        const loginForm = document.getElementById('login-form');

        if (registerForm) {
            registerForm.addEventListener('submit', handleRegister);

            // Password strength indicator
            const passwordInput = registerForm.querySelector('#reg-password');
            if (passwordInput) {
                passwordInput.addEventListener('input', (e) => {
                    updatePasswordStrength(e.target.value);
                });
            }
        }

        if (loginForm) {
            loginForm.addEventListener('submit', handleLogin);
        }
    }

    return { init, showFlash };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', Auth.init);
