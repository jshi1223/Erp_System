  const loginCooldownByUsername = new Map();
  let loginCooldownTimer = null;
  let lastRateLimitedUsername = '';

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
      errDiv.textContent = 'Please enter both username and password.';
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

        // Show success message briefly
        errDiv.className = 'err-msg success-msg';
        errDiv.textContent = 'Login successful! Redirecting...';

        setTimeout(() => {
          if (data.role === 'admin' || data.role === 'staff') {
            window.location.href = '/admin';
          } else {
            window.location.href = '/status';
          }
        }, 1000);
      } else {
        errDiv.textContent = data.message || 'Invalid username or password.';
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
    document.getElementById('forgot-form').style.display = 'block';
    document.getElementById('login-err').textContent = '';
    document.getElementById('forgot-err').textContent = '';
    setTimeout(() => document.getElementById('forgot-email').focus(), 100);
  }

  function showLoginForm() {
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('forgot-err').textContent = '';
    setTimeout(() => document.getElementById('uname').focus(), 100);
  }

  async function submitForgotPassword() {
    const forgotErr = document.getElementById('forgot-err');
    const resetLinkWrap = document.getElementById('reset-link-wrap');
    const emailInput = document.getElementById('forgot-email');
    const email = String(emailInput.value || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    forgotErr.className = 'err-msg';
    forgotErr.textContent = '';
    if (resetLinkWrap) resetLinkWrap.innerHTML = '';

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
        forgotErr.textContent = data.message || 'Unable to send reset link.';
        return;
      }

      forgotErr.className = 'err-msg success-msg';
      forgotErr.textContent = data.message || 'Reset link sent! Paki-check ang email mo.';

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
    }
  }

  // Backward compatible alias for old inline onclick handlers
  function doForgotPassword(e) {
    openForgotForm(e);
  }

  // Enter key support
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    const forgotOpen = document.getElementById('forgot-form').style.display !== 'none';
    if (forgotOpen) {
      submitForgotPassword();
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
    const usernameInput = document.getElementById('uname');
    if (usernameInput) {
      usernameInput.addEventListener('input', () => {
        updateLoginCooldownUi(usernameInput.value);
      });
      usernameInput.addEventListener('focus', () => {
        updateLoginCooldownUi(usernameInput.value);
      });
    }

    setupPasswordToggles();
    showLoginForm();
    setTimeout(() => document.getElementById('uname').focus(), 100);
  };

