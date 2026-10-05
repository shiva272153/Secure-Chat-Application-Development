/**
 * SecureChat — Authentication Module
 * 
 * Handles registration with Email OTP verification & client-side RSA-2048 keypair generation,
 * and login with client-side private key decryption.
 */

const Auth = (() => {
    'use strict';

    let resendTimerInterval = null;

    // ══════════════════════════════════════════════
    // OTP Digit Inputs (6 boxes with auto-advance & paste)
    // ══════════════════════════════════════════════

    function setupOTPInputs(groupId) {
        const group = document.getElementById(groupId);
        if (!group) return;

        const inputs = group.querySelectorAll('.otp-digit');

        inputs.forEach((input, index) => {
            // Auto-advance to next input on typing
            input.addEventListener('input', (e) => {
                const val = e.target.value.replace(/\D/g, '');
                e.target.value = val;
                if (val && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            });

            // Handle backspace navigation
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && index > 0) {
                    inputs[index - 1].focus();
                }
            });

            // Handle paste of full 6-digit code
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '');
                for (let i = 0; i < inputs.length && i < pasted.length; i++) {
                    inputs[i].value = pasted[i];
                }
                const focusIdx = Math.min(pasted.length, inputs.length - 1);
                inputs[focusIdx].focus();
            });
        });
    }

    function getOTPValue(groupId) {
        const group = document.getElementById(groupId);
        if (!group) return '';
        const inputs = group.querySelectorAll('.otp-digit');
        return Array.from(inputs).map(i => i.value).join('');
    }

    function clearOTPInputs(groupId) {
        const group = document.getElementById(groupId);
        if (!group) return;
        group.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; });
    }

    // ══════════════════════════════════════════════
    // Resend Countdown Timer
    // ══════════════════════════════════════════════

    function startResendTimer(seconds = 60) {
        const timerEl = document.getElementById('otp-timer');
        const resendBtn = document.getElementById('resend-otp-btn');
        if (!timerEl || !resendBtn) return;

        if (resendTimerInterval) clearInterval(resendTimerInterval);

        let remaining = seconds;
        timerEl.style.display = 'inline';
        resendBtn.style.display = 'none';
        timerEl.innerHTML = `Resend code in <strong>${remaining}s</strong>`;

        resendTimerInterval = setInterval(() => {
            remaining--;
            timerEl.innerHTML = `Resend code in <strong>${remaining}s</strong>`;

            if (remaining <= 0) {
                clearInterval(resendTimerInterval);
                resendTimerInterval = null;
                timerEl.style.display = 'none';
                resendBtn.style.display = 'inline-block';
            }
        }, 1000);
    }

    // ══════════════════════════════════════════════
    // Step 1: Send Email OTP
    // ══════════════════════════════════════════════

    async function handleSendEmailOTP() {
        const form = document.getElementById('register-form');
        const username = form.querySelector('#reg-username').value.trim().toLowerCase();
        const email = form.querySelector('#reg-email').value.trim().toLowerCase();
        const password = form.querySelector('#reg-password').value;
        const confirmPassword = form.querySelector('#reg-confirm-password').value;
        const nextBtn = document.getElementById('reg-next-btn');

        // Validation
        if (!username || !email || !password || !confirmPassword) {
            showFlash('Please fill in all fields.', 'error');
            return;
        }

        if (username.length < 3) {
            showFlash('Username must be at least 3 characters.', 'error');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showFlash('Please enter a valid email address.', 'error');
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

        nextBtn.disabled = true;
        nextBtn.classList.add('loading');

        try {
            const response = await fetch('/api/send-email-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, username }),
            });

            const data = await response.json();

            if (data.success) {
                document.getElementById('display-reg-email').textContent = email;
                
                // Transition to Step 2
                document.getElementById('reg-step-1').classList.remove('active');
                document.getElementById('reg-step-2').classList.add('active');

                // Start cooldown timer
                startResendTimer(60);

                // Focus first OTP digit
                setTimeout(() => {
                    const firstOtp = document.querySelector('#reg-otp-input-group .otp-digit');
                    if (firstOtp) firstOtp.focus();
                }, 100);

                showFlash('Verification code sent to your email!', 'success');
            } else {
                showFlash(data.error || 'Failed to send verification code. Please try again.', 'error');
            }
        } catch (error) {
            console.error('[Auth] Send OTP error:', error);
            showFlash('Network error. Could not send verification code.', 'error');
        } finally {
            nextBtn.disabled = false;
            nextBtn.classList.remove('loading');
        }
    }

    // ══════════════════════════════════════════════
    // Step 2: Verify OTP & Create Account
    // ══════════════════════════════════════════════

    async function handleRegister(event) {
        event.preventDefault();

        const form = event.target;
        const username = form.querySelector('#reg-username').value.trim().toLowerCase();
        const email = form.querySelector('#reg-email').value.trim().toLowerCase();
        const password = form.querySelector('#reg-password').value;
        const confirmPassword = form.querySelector('#reg-confirm-password').value;
        const otp = getOTPValue('reg-otp-input-group');
        const submitBtn = document.getElementById('register-submit-btn');
        const keygenStatus = document.getElementById('keygen-status');

        if (!otp || otp.length !== 6) {
            showFlash('Please enter the complete 6-digit verification code.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        if (keygenStatus) {
            keygenStatus.classList.add('active');
            keygenStatus.textContent = '🔑 Generating RSA-2048 keypair...';
        }

        try {
            // Step 1: Generate RSA keypair in browser
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
                keygenStatus.textContent = '📤 Verifying code & creating account...';
            }

            // Step 4: Save password in sessionStorage for session-long decryption
            sessionStorage.setItem('_sc_pwd', password);

            // Step 5: Submit account & crypto payload
            const response = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    email: email,
                    password: password,
                    confirm_password: confirmPassword,
                    otp: otp,
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
                clearOTPInputs('reg-otp-input-group');
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

    // ══════════════════════════════════════════════
    // Login (Username + Password)
    // ══════════════════════════════════════════════

    async function handleLogin(event) {
        event.preventDefault();

        const form = event.target;
        const username = form.querySelector('#login-username').value.trim().toLowerCase();
        const password = form.querySelector('#login-password').value;
        const submitBtn = form.querySelector('#login-submit-btn') || form.querySelector('.btn-primary');

        if (!username || !password) {
            showFlash('Please enter both username and password.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
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

    // ══════════════════════════════════════════════
    // Utilities
    // ══════════════════════════════════════════════

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

    function showFlash(message, type = 'error') {
        const icons = {
            error: '⚠️',
            success: '✅',
            warning: '⚠️',
            info: 'ℹ️',
        };

        document.querySelectorAll('.flash-message').forEach(el => el.remove());

        const flash = document.createElement('div');
        flash.className = `flash-message ${type}`;
        flash.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;

        const activeStep = document.querySelector('.auth-step.active') || document.querySelector('form');
        const card = document.querySelector('.auth-card');
        if (activeStep) {
            activeStep.insertBefore(flash, activeStep.firstChild);
        } else if (card) {
            card.insertBefore(flash, card.querySelector('form'));
        }

        setTimeout(() => flash.remove(), 6000);
    }

    // ══════════════════════════════════════════════
    // Initialization
    // ══════════════════════════════════════════════

    function init() {
        const registerForm = document.getElementById('register-form');
        const loginForm = document.getElementById('login-form');

        if (registerForm) {
            registerForm.addEventListener('submit', handleRegister);

            const nextBtn = document.getElementById('reg-next-btn');
            if (nextBtn) {
                nextBtn.addEventListener('click', handleSendEmailOTP);
            }

            const changeEmailBtn = document.getElementById('change-email-btn');
            if (changeEmailBtn) {
                changeEmailBtn.addEventListener('click', () => {
                    document.getElementById('reg-step-2').classList.remove('active');
                    document.getElementById('reg-step-1').classList.add('active');
                    clearOTPInputs('reg-otp-input-group');
                });
            }

            const resendBtn = document.getElementById('resend-otp-btn');
            if (resendBtn) {
                resendBtn.addEventListener('click', handleSendEmailOTP);
            }

            setupOTPInputs('reg-otp-input-group');

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
