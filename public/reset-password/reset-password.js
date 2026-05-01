  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const btnReset = document.getElementById('btn-reset');
  const msg = document.getElementById('msg');

  function setLoading(loading) {
    if (loading) {
      btnReset.classList.add('loading');
      btnReset.disabled = true;
      btnReset.textContent = 'Updating...';
    } else {
      btnReset.classList.remove('loading');
      btnReset.disabled = false;
      btnReset.textContent = 'Update Password';
    }
  }

  function showMessage(text, type) {
    msg.className = type === 'success' ? 'err-msg success-msg' : 'err-msg';
    msg.textContent = text;
  }

  if (!token) {
    btnReset.disabled = true;
    showMessage('Invalid reset link. Humingi ulit ng bagong reset link.', 'error');
  }

  async function submitReset() {
    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;

    msg.className = 'err-msg';
    msg.textContent = '';

    if (!password || password.length < 8) {
      showMessage('Password must be at least 8 characters.', 'error');
      return;
    }

    if (password !== confirm) {
      showMessage('Passwords do not match.', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      });

      const data = await res.json();
      if (data.status === 'success') {
        showMessage('Success! Redirecting to login...', 'success');
        setTimeout(() => { window.location.href = '/'; }, 2000);
      } else {
        showMessage(data.message || 'Unable to reset password.', 'error');
      }
    } catch (_) {
      showMessage('Cannot connect to server. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  btnReset.addEventListener('click', submitReset);
  document.querySelectorAll('.password-toggle').forEach((btn) => {
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnReset.disabled) {
      submitReset();
    }
  });

