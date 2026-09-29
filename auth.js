(() => {
  'use strict';

  const DB_NAME = 'grokTradeAuth';
  const DB_VERSION = 1;
  const STORE = 'users';
  const SESSION_KEY = 'grokTradeSession';
  const PBKDF2_ITERATIONS = 210000;

  const $ = (selector) => document.querySelector(selector);

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  async function derivePasswordHash(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations
      },
      material,
      256
    );

    return bytesToBase64(new Uint8Array(bits));
  }

  function safeEqualBase64(a, b) {
    try {
      const left = base64ToBytes(a);
      const right = base64ToBytes(b);
      if (left.length !== right.length) return false;
      let diff = 0;
      for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
      return diff === 0;
    } catch (_) {
      return false;
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'email' });
          store.createIndex('email', 'email', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open database'));
    });
  }

  async function dbGet(email) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(email);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Unable to read user'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error || new Error('Database read failed'));
    });
  }

  async function dbPut(user) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(user);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const error = tx.error || new Error('Database write failed');
        db.close();
        reject(error);
      };
    });
  }

  function fallbackUsers() {
    try {
      return JSON.parse(localStorage.getItem('grokTradeUsers') || '{}');
    } catch (_) {
      return {};
    }
  }

  function fallbackUserGet(email) {
    return fallbackUsers()[email] || null;
  }

  function fallbackUserPut(user) {
    const users = fallbackUsers();
    users[user.email] = user;
    localStorage.setItem('grokTradeUsers', JSON.stringify(users));
  }

  async function getUser(email) {
    try {
      return await dbGet(email);
    } catch (_) {
      return fallbackUserGet(email);
    }
  }

  async function putUser(user) {
    try {
      await dbPut(user);
    } catch (_) {
      fallbackUserPut(user);
    }
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function passwordScore(password) {
    let score = 0;
    if (password.length >= 10) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }

  function generateRecoveryCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(16);
    let code = '';
    for (let i = 0; i < bytes.length; i++) code += alphabet[bytes[i] % alphabet.length];
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
  }

  function setMessage(message, type = 'error') {
    const box = $('#authMessage');
    if (!box) return;
    box.textContent = message;
    box.dataset.type = type;
    box.hidden = !message;
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? 'Please wait…' : (button.dataset.defaultLabel || 'Continue');
  }

  function createSession(user) {
    const session = {
      token: bytesToBase64(randomBytes(32)),
      userId: user.email,
      email: user.email,
      name: user.name,
      issuedAt: new Date().toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  window.GrokAuth = {
    getSession() {
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      } catch (_) {
        return null;
      }
    },
    signOut() {
      localStorage.removeItem(SESSION_KEY);
    }
  };

  function wirePasswordToggle() {
    document.querySelectorAll('[data-toggle-password]').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.togglePassword);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(input.type === 'text'));
      });
    });
  }

  function wireStrength() {
    const input = $('#password');
    const meter = $('#passwordStrength');
    const label = $('#passwordStrengthLabel');
    if (!input || !meter || !label) return;

    input.addEventListener('input', () => {
      const score = passwordScore(input.value);
      meter.style.setProperty('--strength', `${score * 20}%`);
      label.textContent = score < 3 ? 'Use 10+ characters with upper/lowercase, a number and a symbol.' : 'Strong password.';
      label.dataset.good = String(score >= 3);
    });
  }

  async function handleSignUp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const name = String($('#name')?.value || '').trim();
    const email = normalizeEmail($('#email')?.value);
    const password = String($('#password')?.value || '');
    const confirm = String($('#confirmPassword')?.value || '');

    setMessage('');
    if (name.length < 2) return setMessage('Enter your name.');
    if (!validEmail(email)) return setMessage('Enter a valid email address.');
    if (password.length < 10) return setMessage('Password must be at least 10 characters.');
    if (passwordScore(password) < 3) return setMessage('Use a stronger password with mixed case, numbers, or symbols.');
    if (password !== confirm) return setMessage('Passwords do not match.');

    setBusy(button, true);
    try {
      const existing = await getUser(email);
      if (existing) {
        setMessage('An account already exists for this email. Sign in instead.');
        return;
      }

      const salt = randomBytes(16);
      const hash = await derivePasswordHash(password, salt);
      const recoveryCode = generateRecoveryCode();
      const recoveryCodeCanonical = recoveryCode.replace(/[^A-Z0-9]/g, '');
      const recoverySalt = randomBytes(16);
      const recoveryHash = await derivePasswordHash(recoveryCodeCanonical, recoverySalt);
      const user = {
        email,
        name,
        password: {
          algorithm: 'PBKDF2-SHA-256',
          iterations: PBKDF2_ITERATIONS,
          salt: bytesToBase64(salt),
          hash
        },
        recovery: {
          algorithm: 'PBKDF2-SHA-256',
          iterations: PBKDF2_ITERATIONS,
          salt: bytesToBase64(recoverySalt),
          hash: recoveryHash
        },
        createdAt: new Date().toISOString()
      };

      await putUser(user);
      createSession(user);
      localStorage.setItem('grokTradeLastEmail', email);

      const recoveryCodeBox = $('#recoveryCodeBox');
      const recoveryCodeValue = $('#recoveryCodeValue');
      const recoveryContinue = $('#recoveryContinue');
      if (recoveryCodeBox && recoveryCodeValue && recoveryContinue) {
        recoveryCodeValue.textContent = recoveryCode;
        recoveryCodeBox.hidden = false;
        form.hidden = true;
        document.querySelector('.auth-switch')?.setAttribute('hidden', 'true');
        document.querySelector('.auth-footnote')?.setAttribute('hidden', 'true');
        recoveryContinue.addEventListener('click', () => {
          window.location.href = 'index.html';
        }, { once: true });
      } else {
        window.location.href = 'index.html';
      }
    } catch (error) {
      console.error(error);
      setMessage('We could not create the account on this device. Please try again.');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSignIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const email = normalizeEmail($('#email')?.value);
    const password = String($('#password')?.value || '');

    setMessage('');
    if (!validEmail(email)) return setMessage('Enter your email address.');
    if (!password) return setMessage('Enter your password.');

    setBusy(button, true);
    try {
      const user = await getUser(email);
      if (!user || !user.password) {
        setMessage('Email or password is incorrect.');
        return;
      }

      const salt = base64ToBytes(user.password.salt);
      const hash = await derivePasswordHash(password, salt, user.password.iterations);
      if (!safeEqualBase64(hash, user.password.hash)) {
        setMessage('Email or password is incorrect.');
        return;
      }

      createSession(user);
      localStorage.setItem('grokTradeLastEmail', email);
      window.location.href = 'index.html';
    } catch (error) {
      console.error(error);
      setMessage('Sign in is unavailable right now. Please try again.');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const email = normalizeEmail($('#email')?.value);
    const recoveryCode = String($('#recoveryCode')?.value || '').trim().toUpperCase();
    const recoveryCodeCanonical = recoveryCode.replace(/[^A-Z0-9]/g, '');
    const password = String($('#password')?.value || '');
    const confirm = String($('#confirmPassword')?.value || '');

    setMessage('');
    if (!validEmail(email)) return setMessage('Enter the email used for your account.');
    if (recoveryCodeCanonical.length < 16) return setMessage('Enter your recovery code.');
    if (password.length < 10) return setMessage('Password must be at least 10 characters.');
    if (passwordScore(password) < 3) return setMessage('Use a stronger password with mixed case, numbers, or symbols.');
    if (password !== confirm) return setMessage('Passwords do not match.');

    setBusy(button, true);
    try {
      const user = await getUser(email);
      if (!user || !user.recovery) {
        setMessage('This account does not have a recovery code on this device.');
        return;
      }

      const recoverySalt = base64ToBytes(user.recovery.salt);
      const recoveryHash = await derivePasswordHash(recoveryCodeCanonical, recoverySalt, user.recovery.iterations);
      if (!safeEqualBase64(recoveryHash, user.recovery.hash)) {
        setMessage('Email or recovery code is incorrect.');
        return;
      }

      const salt = randomBytes(16);
      const hash = await derivePasswordHash(password, salt);
      user.password = {
        algorithm: 'PBKDF2-SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64(salt),
        hash
      };
      user.passwordChangedAt = new Date().toISOString();
      await putUser(user);
      localStorage.removeItem(SESSION_KEY);
      localStorage.setItem('grokTradeLastEmail', email);
      setMessage('Password reset successfully. You can now sign in.', 'success');
      form.reset();
    } catch (error) {
      console.error(error);
      setMessage('Password reset is unavailable right now. Please try again.');
    } finally {
      setBusy(button, false);
    }
  }

  function prefillEmail() {
    const input = $('#email');
    if (!input || input.value) return;
    const last = localStorage.getItem('grokTradeLastEmail');
    if (last) input.value = last;
  }

  document.addEventListener('DOMContentLoaded', () => {
    wirePasswordToggle();
    wireStrength();
    prefillEmail();

    const signIn = $('#signInForm');
    const signUp = $('#signUpForm');
    const forgot = $('#forgotPasswordForm');
    if (signIn) signIn.addEventListener('submit', handleSignIn);
    if (signUp) signUp.addEventListener('submit', handleSignUp);
    if (forgot) forgot.addEventListener('submit', handleForgotPassword);
  });
})();
