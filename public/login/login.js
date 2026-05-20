  const loginCooldownByUsername = new Map();
  const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
  const BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
  let loginCooldownTimer = null;
  let lastRateLimitedUsername = '';
  let loginBusinessEntities = [];
  let registerVerificationEmail = '';
  let forgotCooldownTimer = null;
  let forgotCooldownUntil = 0;
  let loginSuccessMessageTimer = null;
  let selectedLoginEntity = {
    id: '1',
    code: 'KVSK',
    name: 'KVSK CCTV & IT Solution',
    theme: 'kvsk'
  };

  function normalizeLoginUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  function clearLoginCooldownTimer() {
    if (loginCooldownTimer) {
      clearInterval(loginCooldownTimer);
      loginCooldownTimer = null;
    }
  }

  function cleanupLoginCooldowns() {
    const now = Date.now();
    for (const [username, until] of loginCooldownByUsername.entries()) {
      if (!until || until <= now) {
        loginCooldownByUsername.delete(username);
      }
    }
    if (!loginCooldownByUsername.size) {
      clearLoginCooldownTimer();
    }
  }

  function getLoginCooldownRemaining(username) {
    const key = normalizeLoginUsername(username);
    if (!key) return 0;

    const until = Number(loginCooldownByUsername.get(key) || 0);
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (remaining <= 0 && until) {
      loginCooldownByUsername.delete(key);
    }
    return remaining;
  }

  function updateLoginCooldownUi(username) {
    const key = normalizeLoginUsername(username);
    const btn = document.getElementById('login-btn');
    const errDiv = document.getElementById('login-err');
    if (!btn || !errDiv) return;

    const remaining = getLoginCooldownRemaining(key);
    if (remaining > 0) {
      btn.classList.remove('loading');
      btn.disabled = true;
      btn.textContent = `Try again in ${remaining}s`;
      errDiv.className = 'err-msg';
      errDiv.textContent = `Too many login attempts for ${key}. Try again in ${remaining} seconds.`;
      return;
    }

    if (!btn.classList.contains('loading')) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Sign In';
    }

    if (errDiv.textContent.startsWith('Too many login attempts')) {
      errDiv.textContent = '';
    }
  }

  function ensureLoginCooldownTimer() {
    if (loginCooldownTimer) return;

    loginCooldownTimer = setInterval(() => {
      cleanupLoginCooldowns();
      const currentUsername = normalizeLoginUsername(document.getElementById('uname')?.value || '');
      updateLoginCooldownUi(currentUsername || lastRateLimitedUsername);
    }, 1000);
  }

  function startLoginCooldown(username, seconds) {
    const key = normalizeLoginUsername(username);
    if (!key) return;

    const safeSeconds = Math.max(1, Number(seconds || 0));
    loginCooldownByUsername.set(key, Date.now() + (safeSeconds * 1000));
    lastRateLimitedUsername = key;
    ensureLoginCooldownTimer();
    updateLoginCooldownUi(key);
  }

  function setupPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach((btn) => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';

      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const willShow = input.type === 'password';
        input.type = willShow ? 'text' : 'password';
        btn.classList.toggle('is-visible', willShow);
        const nextLabel = willShow ? 'Hide password' : 'Show password';
        btn.setAttribute('aria-label', nextLabel);
        btn.setAttribute('title', nextLabel);
      });
    });
  }

  function setLoading(buttonId, loading, loadingText) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    const original = btn.dataset.originalText || btn.textContent;
    btn.dataset.originalText = original;

    if (loading) {
      btn.classList.add('loading');
      btn.disabled = true;
      btn.textContent = loadingText || 'Please wait...';
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function getForgotCooldownRemaining() {
    const remaining = Math.max(0, Math.ceil((Number(forgotCooldownUntil || 0) - Date.now()) / 1000));
    if (remaining <= 0) forgotCooldownUntil = 0;
    return remaining;
  }

  function clearForgotCooldownTimer() {
    if (forgotCooldownTimer) {
      clearInterval(forgotCooldownTimer);
      forgotCooldownTimer = null;
    }
  }

  function updateForgotCooldownUi() {
    const btn = document.getElementById('forgot-btn');
    if (!btn) return;
    const remaining = getForgotCooldownRemaining();
    if (remaining > 0) {
      btn.classList.remove('loading');
      btn.disabled = true;
      btn.textContent = `Resend in ${remaining}s`;
      return;
    }
    clearForgotCooldownTimer();
    if (!btn.classList.contains('loading')) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Send Reset Link';
    }
  }

  function startForgotCooldown(seconds = 60) {
    const safeSeconds = Math.max(1, Number(seconds || 60));
    forgotCooldownUntil = Date.now() + (safeSeconds * 1000);
    updateForgotCooldownUi();
    clearForgotCooldownTimer();
    forgotCooldownTimer = setInterval(updateForgotCooldownUi, 1000);
  }

  function clearLoginMessage() {
    const errDiv = document.getElementById('login-err');
    if (!errDiv) return;
    errDiv.className = 'err-msg';
    errDiv.textContent = '';
    if (loginSuccessMessageTimer) {
      clearTimeout(loginSuccessMessageTimer);
      loginSuccessMessageTimer = null;
    }
  }

  function showTemporaryLoginMessage(message, type = 'success', durationMs = 8000) {
    const errDiv = document.getElementById('login-err');
    if (!errDiv) return;
    errDiv.className = type === 'success' ? 'err-msg success-msg' : 'err-msg';
    errDiv.textContent = message || '';
    if (loginSuccessMessageTimer) clearTimeout(loginSuccessMessageTimer);
    if (durationMs > 0) {
      loginSuccessMessageTimer = setTimeout(() => {
        clearLoginMessage();
      }, durationMs);
    }
  }

  function getThemeProfile(theme, name) {
    const safeTheme = String(theme || '').toLowerCase() === 'kitsi' || /kitsi|kinaadman/i.test(String(name || ''))
      ? 'kitsi'
      : 'kvsk';
    if (safeTheme === 'kitsi') {
      return {
        theme: 'kitsi',
        logo: '/assets/img/kitsi-logo.png',
        alt: 'KITSI logo',
        primary: '#0898c7',
        primaryLight: '#22c7e8',
        primaryDark: '#005b96',
        accent: '#07a6d6',
        accent2: '#005b96'
      };
    }
    return {
      theme: 'kvsk',
      logo: '/assets/img/kvsk-logo-switch.png',
      alt: 'KVSK logo',
      primary: '#b42318',
      primaryLight: '#ef5b4f',
      primaryDark: '#4b1210',
      accent: '#d92d20',
      accent2: '#201313'
    };
  }

  function persistSelectedLoginEntity() {
    const profile = getThemeProfile(selectedLoginEntity.theme, selectedLoginEntity.name);
    document.documentElement.dataset.loginWorkspace = profile.theme === 'kitsi' ? 'kitsi' : 'kvsk';
    localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, String(selectedLoginEntity.id || ''));
    localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify({
      company_name: selectedLoginEntity.name || '',
      theme: profile.theme,
      logo: profile.logo,
      alt: profile.alt,
      primary: profile.primary,
      primaryLight: profile.primaryLight,
      primaryDark: profile.primaryDark,
      accent: profile.accent,
      accent2: profile.accent2
    }));
  }

  function findLoginEntityForPanel(panel) {
    const code = String(panel.dataset.entityCode || '').trim().toLowerCase();
    const fallbackId = String(panel.dataset.entityFallbackId || '').trim();
    const fallbackName = String(panel.dataset.entityName || code || '').trim();
    const fallbackTheme = String(panel.dataset.entityTheme || '').trim();
    const match = loginBusinessEntities.find((row) => {
      const rowCode = String(row.entity_code || '').trim().toLowerCase();
      const rowName = String(row.company_name || '').trim().toLowerCase();
      return rowCode === code || rowName.includes(code);
    });
    return {
      id: String(match?.id || fallbackId || ''),
      code: String(match?.entity_code || code || '').toUpperCase(),
      name: String(match?.company_name || fallbackName || '').trim(),
      theme: fallbackTheme || (String(match?.company_name || '').toLowerCase().includes('kitsi') ? 'kitsi' : 'kvsk')
    };
  }

  function playBrandPanelAnimation(panel) {
    panel.classList.remove('is-playing');
    void panel.offsetWidth;
    panel.classList.add('is-playing');
    window.setTimeout(() => {
      panel.classList.remove('is-playing');
    }, 1250);
  }

  function selectLoginEntity(panel, shouldAnimate = true) {
    if (!panel) return;
    selectedLoginEntity = findLoginEntityForPanel(panel);
    document.querySelectorAll('.login-brand-column').forEach((item) => {
      const active = item === panel;
      item.classList.toggle('is-selected', active);
      item.setAttribute('aria-pressed', String(active));
    });
    const copy = document.getElementById('login-workspace-copy');
    if (copy) {
      const label = selectedLoginEntity.theme === 'kitsi' ? 'KITSI' : 'KVSK';
      copy.textContent = `Sign in to the ${label} workspace for projects, AP, AR, and reports.`;
    }
    if (document.body) {
      document.body.dataset.loginWorkspace = selectedLoginEntity.theme === 'kitsi' ? 'kitsi' : 'kvsk';
    }
    persistSelectedLoginEntity();
    if (shouldAnimate) playBrandPanelAnimation(panel);
  }

  async function loadLoginBusinessEntities() {
    try {
      const res = await fetch('/api/public-business-entities', { cache: 'no-store' });
      const data = await res.json().catch(() => []);
      if (res.ok && Array.isArray(data)) {
        loginBusinessEntities = data;
      }
    } catch (_) {}
    let storedTheme = '';
    try {
      const stored = JSON.parse(localStorage.getItem(BUSINESS_ENTITY_THEME_KEY) || 'null');
      storedTheme = String(stored && stored.theme ? stored.theme : '').toLowerCase();
    } catch (_) {}
    const storedPanel = storedTheme
      ? document.querySelector(`.login-brand-column[data-entity-theme="${storedTheme}"]`)
      : null;
    const selectedPanel = storedPanel || document.querySelector('.login-brand-column.is-selected') || document.querySelector('.login-brand-column');
    selectLoginEntity(selectedPanel, false);
  }

  function doLogin() {
    const username = normalizeLoginUsername(document.getElementById('uname').value);
    const password = document.getElementById('upass').value;
    const errDiv = document.getElementById('login-err');
    const remainingCooldown = getLoginCooldownRemaining(username);

    errDiv.textContent = '';
    errDiv.className = 'err-msg';

    if (remainingCooldown > 0) {
      updateLoginCooldownUi(username);
      return;
    }

    if (!username || !password) {
      errDiv.textContent = 'Please enter both email and password.';
      return;
    }

    setLoading('login-btn', true, 'Signing In...');

    fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return { res, data };
    })
    .then(({ res, data }) => {
      setLoading('login-btn', false);

      if (res.status === 429) {
        const retryAfterHeader = Number(res.headers.get('Retry-After') || 0);
        const retryAfterBody = Number(data.retryAfter || 0);
        const retrySeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader
          : (Number.isFinite(retryAfterBody) && retryAfterBody > 0 ? retryAfterBody : 60);
        startLoginCooldown(username, retrySeconds);
        errDiv.textContent = data.message || `Too many login attempts. Try again in ${retrySeconds} seconds.`;
        return;
      }

      if (res.status === 403) {
        errDiv.className = 'err-msg';
        errDiv.textContent = data.message || 'Disabled account. Please contact the administrator.';
        return;
      }

      if (res.ok && data.status === 'success') {
        localStorage.removeItem('kinaadman_activeTab');
        localStorage.removeItem('kinaadman_dashboardPanel');
        persistSelectedLoginEntity();

        // Show success message briefly
        errDiv.className = 'err-msg success-msg';
        errDiv.textContent = 'Login successful! Redirecting...';

        setTimeout(() => {
          if (data.role === 'super_admin' || data.role === 'admin' || data.role === 'staff') {
            window.location.href = '/admin';
          } else {
            window.location.href = '/status';
          }
        }, 1000);
      } else {
        errDiv.textContent = data.message || 'Invalid email or password.';
      }
    })
    .catch(() => {
      setLoading('login-btn', false);
      errDiv.textContent = 'Cannot connect to server. Please check your connection and try again.';
    });
  }

  function openForgotForm(e) {
    if (e) e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'block';
    document.getElementById('login-err').textContent = '';
    document.getElementById('register-err').textContent = '';
    document.getElementById('forgot-err').textContent = '';
    setTimeout(() => document.getElementById('forgot-email').focus(), 100);
  }

  function openRegisterForm(e) {
    if (e) e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('login-err').textContent = '';
    document.getElementById('forgot-err').textContent = '';
    document.getElementById('register-err').textContent = '';
    setTimeout(() => document.getElementById('reg-name').focus(), 100);
  }

  function showLoginForm() {
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('forgot-err').textContent = '';
    document.getElementById('register-err').textContent = '';
    setTimeout(() => document.getElementById('uname').focus(), 100);
  }

  function getRegisterFormPayload() {
    return {
      name: String(document.getElementById('reg-name')?.value || '').trim(),
      email: String(document.getElementById('reg-email')?.value || '').trim().toLowerCase(),
      password: String(document.getElementById('reg-pass')?.value || ''),
      verificationCode: String(document.getElementById('reg-code')?.value || '').replace(/\D/g, '').slice(0, 6)
    };
  }

  function setRegisterMessage(message, type = '') {
    const errDiv = document.getElementById('register-err');
    if (!errDiv) return;
    errDiv.className = type === 'success' ? 'err-msg success-msg' : 'err-msg';
    errDiv.textContent = message || '';
  }

  function resetRegisterVerificationState() {
    registerVerificationEmail = '';
    const codeInput = document.getElementById('reg-code');
    if (codeInput) codeInput.value = '';
  }

  async function sendRegisterVerificationCode() {
    const { name, email } = getRegisterFormPayload();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    setRegisterMessage('');

    if (!name || !email) {
      setRegisterMessage('Complete name and email before sending a code.');
      return;
    }
    if (!emailRegex.test(email)) {
      setRegisterMessage('Please enter a valid email address.');
      return;
    }

    setLoading('register-code-btn', true, 'Sending...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('/api/register/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
        signal: controller.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        setRegisterMessage(data.message || 'Unable to send verification code.');
        return;
      }

      registerVerificationEmail = email;
      const codeInput = document.getElementById('reg-code');
      if (codeInput) {
        codeInput.value = data.verificationCode || '';
        codeInput.focus();
      }
      setRegisterMessage(data.message || 'Verification code sent. Please check your email.', 'success');
    } catch (err) {
      setRegisterMessage(err && err.name === 'AbortError'
        ? 'Email sending timed out. Please check SMTP settings and try again.'
        : 'Cannot connect to server. Please try again.');
    } finally {
      clearTimeout(timeoutId);
      setLoading('register-code-btn', false);
    }
  }

  async function submitRegister() {
    const { name, email, password, verificationCode } = getRegisterFormPayload();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    setRegisterMessage('');

    if (!name || !email || !password) {
      setRegisterMessage('Please complete all fields.');
      return;
    }
    if (!emailRegex.test(email)) {
      setRegisterMessage('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setRegisterMessage('Password must be at least 8 characters.');
      return;
    }
    if (!verificationCode || verificationCode.length !== 6) {
      setRegisterMessage('Send and enter the 6-digit email verification code.');
      return;
    }
    if (registerVerificationEmail && registerVerificationEmail !== email) {
      setRegisterMessage('Email changed after sending the code. Please send a new verification code.');
      return;
    }

    setLoading('register-btn', true, 'Submitting...');
    try {
      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, verificationCode })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        setRegisterMessage(data.message || 'Unable to submit registration.');
        return;
      }

      setRegisterMessage(data.message || 'Registration submitted. Please wait for admin approval.', 'success');
      ['reg-name', 'reg-email', 'reg-pass', 'reg-code'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
      registerVerificationEmail = '';
      setTimeout(() => {
        showLoginForm();
        showTemporaryLoginMessage(data.message || 'Registration submitted. Please wait for admin approval before signing in.');
      }, 1200);
    } catch (_) {
      setRegisterMessage('Cannot connect to server. Please try again.');
    } finally {
      setLoading('register-btn', false);
    }
  }

  async function submitForgotPassword() {
    const forgotErr = document.getElementById('forgot-err');
    const resetLinkWrap = document.getElementById('reset-link-wrap');
    const emailInput = document.getElementById('forgot-email');
    const email = String(emailInput.value || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cooldownRemaining = getForgotCooldownRemaining();

    forgotErr.className = 'err-msg';
    forgotErr.textContent = '';
    if (resetLinkWrap) resetLinkWrap.innerHTML = '';

    if (cooldownRemaining > 0) {
      forgotErr.textContent = `Please wait ${cooldownRemaining} seconds before requesting another reset link.`;
      updateForgotCooldownUi();
      return;
    }

    if (!email) {
      forgotErr.textContent = 'Email is required.';
      return;
    }
    if (!emailRegex.test(email)) {
      forgotErr.textContent = 'Please enter a valid email address.';
      return;
    }

    setLoading('forgot-btn', true, 'Sending...');

    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        if (res.status === 429) {
          const retryAfterHeader = Number(res.headers.get('Retry-After') || 0);
          const retryAfterBody = Number(data.retryAfter || 0);
          const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader
            : (Number.isFinite(retryAfterBody) && retryAfterBody > 0 ? retryAfterBody : 60);
          startForgotCooldown(retryAfter);
        }
        forgotErr.textContent = data.message || 'Unable to send reset link.';
        return;
      }

      forgotErr.className = 'err-msg success-msg';
      forgotErr.textContent = data.message || 'Reset link sent! Paki-check ang email mo.';
      startForgotCooldown(Number(data.retryAfter || 60));

      if (data.resetLink) {
        if (resetLinkWrap) {
          const link = document.createElement('a');
          link.href = data.resetLink;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Open reset link';
          link.className = 'inline-link';

          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'btn-secondary';
          copyBtn.style.marginTop = '10px';
          copyBtn.textContent = 'Copy reset link';
          copyBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText(data.resetLink);
              copyBtn.textContent = 'Copied!';
              setTimeout(() => { copyBtn.textContent = 'Copy reset link'; }, 1500);
            } catch (_) {
              copyBtn.textContent = 'Copy failed';
            }
          };

          resetLinkWrap.appendChild(document.createElement('br'));
          resetLinkWrap.appendChild(link);
          resetLinkWrap.appendChild(document.createElement('br'));
          resetLinkWrap.appendChild(copyBtn);
        }
      }
    } catch (_) {
      forgotErr.textContent = 'Error connecting to server.';
    } finally {
      setLoading('forgot-btn', false);
      updateForgotCooldownUi();
    }
  }

  // Backward compatible alias for old inline onclick handlers
  function doForgotPassword(e) {
    openForgotForm(e);
  }

  function setupBrandPanelAnimations() {
    const panels = document.querySelectorAll('.login-brand-column');
    panels.forEach((panel) => {
      if (panel.dataset.loginBrandAnimationBound === '1') return;
      panel.dataset.loginBrandAnimationBound = '1';
      panel.addEventListener('click', (event) => {
        event.preventDefault();
        selectLoginEntity(panel, true);
      });
    });
  }

  // Enter key support
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    const forgotOpen = document.getElementById('forgot-form').style.display !== 'none';
    const registerOpen = document.getElementById('register-form').style.display !== 'none';
    if (forgotOpen) {
      submitForgotPassword();
      return;
    }
    if (registerOpen) {
      submitRegister();
      return;
    }
    doLogin();
  });

  // Auto-focus username on load
  window.onload = () => {
    // Clear fields on refresh to ensure security
    document.getElementById('uname').value = '';
    document.getElementById('upass').value = '';
    document.getElementById('forgot-email').value = '';
    ['reg-name', 'reg-email', 'reg-pass', 'reg-code'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    resetRegisterVerificationState();
    ['reg-name', 'reg-email'].forEach((id) => {
      const input = document.getElementById(id);
      if (input && input.dataset.registerVerificationBound !== '1') {
        input.dataset.registerVerificationBound = '1';
        input.addEventListener('input', resetRegisterVerificationState);
      }
    });
    const registerCodeInput = document.getElementById('reg-code');
    if (registerCodeInput && registerCodeInput.dataset.digitMaskBound !== '1') {
      registerCodeInput.dataset.digitMaskBound = '1';
      registerCodeInput.addEventListener('input', () => {
        registerCodeInput.value = String(registerCodeInput.value || '').replace(/\D/g, '').slice(0, 6);
      });
    }
    const usernameInput = document.getElementById('uname');
    const passwordInput = document.getElementById('upass');
    if (usernameInput) {
      usernameInput.addEventListener('input', () => {
        clearLoginMessage();
        updateLoginCooldownUi(usernameInput.value);
      });
      usernameInput.addEventListener('focus', () => {
        updateLoginCooldownUi(usernameInput.value);
      });
    }
    if (passwordInput) {
      passwordInput.addEventListener('input', clearLoginMessage);
      passwordInput.addEventListener('focus', clearLoginMessage);
    }

    setupPasswordToggles();
    setupBrandPanelAnimations();
    loadLoginBusinessEntities();
    showLoginForm();
    setTimeout(() => document.getElementById('uname').focus(), 100);
  };

