function setInitialLoaderText(message, sub) {
  const msgEl = document.querySelector('#initial-loader .loader-msg');
  const subEl = document.querySelector('#initial-loader .loader-sub');
  if (msgEl && message) msgEl.textContent = message;
  if (subEl && sub) subEl.textContent = sub;
}

function showInitialLoader(message, sub) {
  waitingForFirstData = true;
  _loaderShownAt = Date.now();
  if (_loaderHideTimer) {
    clearTimeout(_loaderHideTimer);
    _loaderHideTimer = null;
  }
  setInitialLoaderText(
    message || 'Carregando dados do cluster...',
    sub || 'Conectando ao Apuana via SSH'
  );
  const el = $('initial-loader');
  if (el) el.classList.remove('initial-loader-hidden');
}

function hideInitialLoader() {
  if (!waitingForFirstData) return;
  const delay = Math.max(0, LOADER_MIN_MS - (Date.now() - _loaderShownAt)) + 1000;
  if (_loaderHideTimer) clearTimeout(_loaderHideTimer);
  _loaderHideTimer = setTimeout(() => {
    waitingForFirstData = false;
    _loaderHideTimer = null;
    const el = $('initial-loader');
    if (el) el.classList.add('initial-loader-hidden');
  }, delay);
}

function normalizeLogin(login) {
  const raw = String(login || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.split('@')[0] || '';
}

function maskLogin(login) {
  const raw = normalizeLogin(login);
  if (!raw) return '-';
  const left = raw.length <= 2 ? raw[0] || '*' : raw.slice(0, 2);
  return `${left}${'*'.repeat(Math.max(1, raw.length - left.length))}`;
}

function loadAuthState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
    sshAuth.login = normalizeLogin(parsed.login || '');
    sshAuth.token = String(parsed.token || '');
    sshAuth.remember = !!parsed.remember;
    sshAuth.loggedIn = !!sshAuth.login && !!sshAuth.token;
  } catch (_) {
    sshAuth = {login:'', token:'', remember:false, loggedIn:false};
  }
}

function persistAuthState() {
  const payload = {
    login: sshAuth.login,
    token: sshAuth.remember ? sshAuth.token : '',
    remember: sshAuth.remember,
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
}

function applyAuthUi() {
  document.body.classList.toggle('auth-required', !sshAuth.loggedIn);
  const authChip = $('chip-auth');
  if (authChip) authChip.textContent = `SSH: ${sshAuth.loggedIn ? maskLogin(sshAuth.login) : '-'}`;
  if (typeof renderUserSettings === 'function') renderUserSettings();
}

function forceAuthRequired() {
  sshAuth.token = '';
  sshAuth.loggedIn = false;
  clusterDataReady = false;
  clusterBootNoticeShown = false;
  if (_loaderHideTimer) {
    clearTimeout(_loaderHideTimer);
    _loaderHideTimer = null;
  }
  waitingForFirstData = false;
  const loader = $('initial-loader');
  if (loader) loader.classList.add('initial-loader-hidden');
  persistAuthState();
  applyAuthUi();
}

function setAuthenticatedSession(body, options = {}) {
  const login = normalizeLogin(body.login || body.username || options.login || sshAuth.login || '');
  sshAuth = {
    login,
    token: _e3(body.token || ''),
    remember: options.remember !== undefined ? !!options.remember : true,
    loggedIn: !!login && !!body.token,
  };
  persistAuthState();
  applyAuthUi();
  syncTransferMeta({
    user: sshAuth.login,
    transfer: {
      user: sshAuth.login,
      host: body.transfer_host || body.host || transferState.host,
      home: body.home || '',
    },
  }, {forceHome: true});
}

function isVpnFailure(code, detail) {
  void detail;
  return code === 'vpn_unreachable';
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (sshAuth.token) headers['X-SSH-Token'] = _d3(sshAuth.token);
  const response = await fetch(path, Object.assign({}, options, {headers}));
  if (response.status === 401) {
    forceAuthRequired();
    throw new Error('SSH login required');
  }
  return response;
}

async function validateAuthSession() {
  if (!sshAuth.loggedIn || !sshAuth.token) return false;
  try {
    const response = await apiFetch('/api/auth/status');
    const data = await response.json();
    if (!response.ok || !data.ok) {
      forceAuthRequired();
      return false;
    }
    sshAuth.login = normalizeLogin(data.login || data.username || sshAuth.login);
    persistAuthState();
    syncTransferMeta({
      user: sshAuth.login,
      transfer: {
        user: sshAuth.login,
        host: data.transfer_host || data.host || transferState.host,
        home: data.home || '',
      },
    }, {forceHome: true});
    return true;
  } catch (_) {
    forceAuthRequired();
    return false;
  }
}

async function submitSshLogin() {
  const login = normalizeLogin($('ssh-login')?.value || '');
  const password = $('ssh-password')?.value || '';
  const remember = !!$('ssh-remember')?.checked;
  const errorEl = $('ssh-login-error');
  const loginBtn = $('ssh-login-btn');

  if (!login) {
    if (errorEl) errorEl.textContent = 'Informe seu login SSH.';
    return;
  }
  if (!password) {
    if (errorEl) errorEl.textContent = 'Informe sua senha SSH.';
    return;
  }

  if (loginBtn) loginBtn.disabled = true;
  if (errorEl) errorEl.textContent = 'Autenticando no Apuana...';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({login, password}),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      const e = new Error(body.error || 'Falha no login SSH.');
      e.code = body.code || '';
      e.detail = body.detail || '';
      throw e;
    }
    setAuthenticatedSession(body, {login, remember});
    showInitialLoader();
    if (errorEl) errorEl.textContent = '';
    await poll();
  } catch (err) {
    forceAuthRequired();
    if (isVpnFailure(err?.code, err?.detail || err?.message)) showVpnModal();
    if (errorEl) errorEl.textContent = err?.message || 'Falha ao conectar no Apuana.';
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

async function tryAutoSshLogin() {
  const errorEl = $('ssh-login-error');
  const loginHint = normalizeLogin($('ssh-login')?.value || sshAuth.login || '');
  if (errorEl) errorEl.textContent = 'Tentando conexão SSH automática...';
  try {
    const response = await fetch('/api/auth/auto', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({login: loginHint}),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      const e = new Error(body.error || 'Não foi possível autenticar automaticamente.');
      e.code = body.code || '';
      e.detail = body.detail || '';
      throw e;
    }
    setAuthenticatedSession(body, {login: loginHint, remember: true});
    if (errorEl) errorEl.textContent = '';
    showInitialLoader();
    await poll();
    return true;
  } catch (err) {
    forceAuthRequired();
    if (isVpnFailure(err?.code, err?.detail || err?.message)) showVpnModal();
    if (errorEl) {
      errorEl.textContent = err?.message || 'Login automático indisponível. Use o login manual se necessário.';
    }
    return false;
  }
}

async function bootstrapSshAuth() {
  if (sshAuth.loggedIn && sshAuth.token) {
    showInitialLoader();
    const ok = await validateAuthSession();
    if (ok) {
      await poll();
      return;
    }
  }
  await tryAutoSshLogin();
}

function showVpnModal() {
  const modal = $('vpn-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function hideVpnModal() {
  const modal = $('vpn-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function initSshLogin() {
  loadAuthState();
  const loginInput = $('ssh-login');
  const passwordInput = $('ssh-password');
  const rememberInput = $('ssh-remember');
  const toggle = $('ssh-password-toggle');
  if (loginInput) loginInput.value = sshAuth.login || '';
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.type = 'password';
  }
  if (rememberInput) rememberInput.checked = sshAuth.remember;
  if (toggle) {
    toggle.classList.remove('showing');
    toggle.setAttribute('aria-label', 'Mostrar senha');
    toggle.setAttribute('title', 'Mostrar senha');
  }
  if (sshAuth.loggedIn && sshAuth.token) showInitialLoader();
  applyAuthUi();
  ['ssh-login', 'ssh-password'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') submitSshLogin();
    });
  });
  $('vpn-modal')?.addEventListener('click', ev => {
    if (ev.target?.id === 'vpn-modal') hideVpnModal();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') hideVpnModal();
  });
}

function togglePasswordVisibility() {
  const input = $('ssh-password');
  const toggle = $('ssh-password-toggle');
  if (!input || !toggle) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  toggle.classList.toggle('showing', !showing);
  const label = showing ? 'Mostrar senha' : 'Ocultar senha';
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);
}
