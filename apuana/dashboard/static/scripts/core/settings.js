function settingsText(value, fallback = '-') {
  const text = String(value || '').trim();
  return text || fallback;
}

function settingsBool(value) {
  return value ? 'Enabled' : 'Disabled';
}

function getUserSettingsData() {
  const login = normalizeLogin(sshAuth.login || transferState.user || _last.user || '');
  const home = transferState.home || _last.home || _last.transfer?.home || (login ? `/home/CIN/${login}` : '');
  return {
    login,
    host: transferState.host || _last.transfer?.host || _last.node || '',
    home,
    remember: !!sshAuth.remember,
    loggedIn: !!sshAuth.loggedIn,
    node: _last.node || '',
    updated: _last.ts || '',
  };
}

function setSettingsText(id, value, fallback = '-') {
  const el = $(id);
  if (el) el.textContent = settingsText(value, fallback);
}

function renderUserSettings() {
  const data = getUserSettingsData();
  const login = data.login || 'Not signed in';
  const initials = data.login ? data.login.slice(0, 2).toUpperCase() : '?';

  setSettingsText('sb-settings-user', data.login, 'Not signed in');
  setSettingsText('settings-login', login, 'Not signed in');
  setSettingsText('settings-status', data.loggedIn ? 'Active SSH session' : 'SSH session unavailable');
  setSettingsText('settings-field-login', data.login);
  setSettingsText('settings-field-host', data.host);
  setSettingsText('settings-field-home', data.home);
  setSettingsText('settings-field-remember', settingsBool(data.remember));
  setSettingsText('settings-field-node', data.node);
  setSettingsText('settings-field-updated', data.updated);

  const avatar = $('settings-avatar');
  if (avatar) avatar.textContent = initials;
}

function openUserSettings() {
  renderUserSettings();
  const modal = $('user-settings-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeUserSettings() {
  const modal = $('user-settings-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function logoutFromUserSettings() {
  const button = $('user-settings-logout');
  if (button) button.disabled = true;
  try {
    await fetch('/api/auth/logout', {method: 'POST'});
  } catch (_) {
    // Local state is still cleared so the UI returns to the login screen.
  } finally {
    closeUserSettings();
    forceAuthRequired();
    if (button) button.disabled = false;
  }
}

function initUserSettings() {
  renderUserSettings();
  $('sidebar-settings-btn')?.addEventListener('click', openUserSettings);
  $('user-settings-close')?.addEventListener('click', closeUserSettings);
  $('user-settings-dismiss')?.addEventListener('click', closeUserSettings);
  $('user-settings-logout')?.addEventListener('click', logoutFromUserSettings);
  $('user-settings-modal')?.addEventListener('click', ev => {
    if (ev.target === $('user-settings-modal')) closeUserSettings();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') closeUserSettings();
  });
}
