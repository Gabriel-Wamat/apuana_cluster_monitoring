function shellQuote(value) {
  const s = String(value || '').trim();
  if (!s) return "''";
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

function quoteLocalPath(value) {
  const s = String(value || '').trim();
  if (!s) return "''";
  if (s === '~') return '~';
  if (s.startsWith('~/')) {
    const parts = s.slice(2).split('/').map(part =>
      part === '' ? '' : /^[A-Za-z0-9_@%+=:,.-]+$/.test(part) ? part : shellQuote(part)
    );
    return '~/' + parts.join('/');
  }
  return shellQuote(s);
}

function trailingSlash(path) {
  const s = String(path || '').trim();
  return s && !s.endsWith('/') ? s + '/' : s;
}

function normalizeRemotePath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '') || '/';
}

function isWithinHome(path, home) {
  const p = normalizeRemotePath(path);
  const h = normalizeRemotePath(home);
  if (!h) return true;
  return p === h || p.startsWith(h + '/');
}

function parentRemotePath(path) {
  const home = normalizeRemotePath(transferState.home || '');
  const current = normalizeRemotePath(path || transferState.current || home);
  if (!current || current === '/' || (home && current === home)) return home || current || '/';
  const parent = current.split('/').slice(0, -1).join('/') || '/';
  if (home && !isWithinHome(parent, home)) return home;
  return parent;
}

function basenameRemotePath(path) {
  const clean = normalizeRemotePath(path);
  if (!clean || clean === '/') return clean || '/';
  return clean.split('/').filter(Boolean).pop() || clean;
}

function displayRemotePath(path) {
  const full = normalizeRemotePath(path);
  const home = normalizeRemotePath(transferState.home || '');
  const current = normalizeRemotePath(transferState.current || $('transfer-browse-path')?.value || home);
  if (!full) return '';
  if (current && parentRemotePath(full) === current) return basenameRemotePath(full);
  if (home && isWithinHome(full, home)) {
    if (full === home) return '~';
    return '~/' + full.slice(home.length + 1);
  }
  return full;
}

function transferSuggestionKindIcon(kind) {
  if (kind === 'file') {
    return `
      <span class="kind-pill kind-file" title="File" aria-label="File">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/>
          <path d="M8 13h8"/>
          <path d="M8 17h6"/>
        </svg>
      </span>
    `;
  }
  return `
    <span class="kind-pill kind-directory" title="Folder" aria-label="Folder">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z"/>
      </svg>
    </span>
  `;
}

function updateTransferBackButton() {
  const btn = $('transfer-browse-back');
  if (!btn) return;
  const home = normalizeRemotePath(transferState.home || '');
  const current = normalizeRemotePath(transferState.current || $('transfer-browse-path')?.value || home);
  btn.disabled = !current || current === '/' || (!!home && current === home);
}

function shouldResetRemotePath(path, home) {
  const value = String(path || '').trim();
  if (!value) return true;
  if (value === '~' || value.startsWith('~/')) return false;
  if (!value.startsWith('/')) return false;
  return !isWithinHome(value, home);
}

function isApuanaHome(path) {
  return /^\/home\/CIN\/[^/]+(?:\/.*)?$/.test(String(path || '').trim());
}

function updateTransferPathPlaceholders() {
  const home = trailingSlash(transferState.home || '');
  const remoteVisualInput = $('remote-visual-path');
  const uploadInput = $('upload-remote');
  if (remoteVisualInput) remoteVisualInput.placeholder = home || 'Apuana home path';
  if (uploadInput) uploadInput.placeholder = home || 'Remote destination';
}

function applyTransferHomeDefaults(force = false) {
  const home = String(transferState.home || '').trim().replace(/\/+$/, '');
  updateTransferPathPlaceholders();
  if (!home) return;
  const browseInput = $('transfer-browse-path');
  const uploadInput = $('upload-remote');
  const downloadInput = $('download-remote');
  const remoteVisualInput = $('remote-visual-path');

  if (browseInput && (force || shouldResetRemotePath(browseInput.value, home))) {
    browseInput.value = home;
    transferState.current = home;
    lastTransferBrowseKey = '';
  }
  if (uploadInput && (force || shouldResetRemotePath(uploadInput.value, home))) {
    uploadInput.value = trailingSlash(home);
  }
  if (downloadInput && (force || !downloadInput.value.trim() || shouldResetRemotePath(downloadInput.value, home))) {
    downloadInput.value = trailingSlash(home);
    lastDownloadRemoteSuggestKey = '';
  }
  if (remoteVisualInput && (force || shouldResetRemotePath(remoteVisualInput.value, home))) {
    remoteVisualInput.value = home;
    remoteExplorerState.path = home;
  }
  updateTransferBackButton();
}

function isUploadCustomMode() {
  return ($('upload-remote-preset')?.value || 'custom') === 'custom';
}

function syncTransferMeta(d, options = {}) {
  const t = d.transfer || {};
  const previousHome = transferState.home;
  const incomingHome = String(t.home || '').trim();
  transferState.user = t.user || normalizeLogin(sshAuth.login) || d.user || transferState.user || '';
  transferState.host = t.host || transferState.host || 'slurm-client1.cin.ufpe.br';
  if (incomingHome && (!sshAuth.loggedIn || isApuanaHome(incomingHome))) {
    transferState.home = incomingHome;
  }
  const userChip = $('transfer-user-chip');
  const hostChip = $('transfer-host-chip');
  if (userChip) userChip.textContent = transferState.user || '-';
  if (hostChip) hostChip.textContent = transferState.host || '-';
  applyTransferHomeDefaults(!!options.forceHome || (!!previousHome && previousHome !== transferState.home));
  updateTransferPathPlaceholders();
  if (transferState.home && !logState.home) logState.home = transferState.home;
  refreshTransferCommands();
}

function remoteSpec(path) {
  return `${transferState.user}@${transferState.host}:${path}`;
}

function buildDownloadCommand() {
  const remote = transferState.selectedPath || '';
  const local = downloadState.localFolder || $('download-local')?.value.trim() || '';
  if (!transferState.user || !transferState.host) return 'Waiting for user and host from /api...';
  if (!remote) return 'Select an Apuana file or directory.';
  if (!local) return 'Choose a local destination folder.';
  return `Ready to download to ${local}`;
}

function buildUploadCommand() {
  const remote = getUploadRemotePath();
  if (!transferState.user || !transferState.host) return 'Waiting for user and host from /api...';
  if (!uploadState.files.length && !uploadState.localPath) return 'Choose a local file or folder.';
  if (!remote) return 'Enter an Apuana destination path.';
  return `Ready to upload to ${remote}`;
}

function refreshTransferCommands() {
  if ($('download-command')) $('download-command').textContent = buildDownloadCommand();
  if ($('upload-command')) $('upload-command').textContent = buildUploadCommand();
  if (typeof renderTransferPanel === 'function') renderTransferPanel();
  scheduleTransferBrowserLayout();
}

function scheduleTransferBrowserLayout() {
  if (transferLayoutRaf) cancelAnimationFrame(transferLayoutRaf);
  transferLayoutRaf = requestAnimationFrame(() => {
    transferLayoutRaf = 0;
    syncTransferBrowserLayout();
  });
}

function syncTransferBrowserLayout() {
  const view = $('view-transfer');
  const card = document.querySelector('#view-transfer .transfer-browser-card');
  const ops = document.querySelector('#view-transfer .transfer-ops-col');
  const uploadCard = $('upload-run-selected')?.closest('.card');
  if (!view || !card || !ops) return;

  if (!view.classList.contains('active') || window.matchMedia('(max-width: 980px)').matches) {
    card.style.removeProperty('--transfer-browser-card-height');
    return;
  }

  const cardTop = card.getBoundingClientRect().top;
  const targetBottom = (uploadCard || ops).getBoundingClientRect().bottom;
  const height = Math.max(360, Math.round(targetBottom - cardTop));
  card.style.setProperty('--transfer-browser-card-height', `${height}px`);
}

async function runDownloadRsync() {
  const box = $('download-command');
  if (!sshAuth.loggedIn || !sshAuth.token) {
    const message = 'SSH login required. Log in first so the dashboard can use your Apuana login and password for rsync.';
    if (box) box.textContent = message;
    if (typeof setRemoteExplorerStatus === 'function') setRemoteExplorerStatus('error', message);
    transferSetFeedback?.('error', {mode:'download', title:'SSH session required', message, details:message});
    return;
  }
  const payload = {
    localPath: downloadState.localFolder || $('download-local')?.value.trim() || '',
    remotePath: transferState.selectedPath || '',
    includeContents: false,
  };
  if (!payload.remotePath) {
    const message = 'Select a remote file or folder first.';
    if (box) box.textContent = message;
    if (typeof setRemoteExplorerStatus === 'function') setRemoteExplorerStatus('error', message);
    transferSetFeedback?.('error', {mode:'download', title:'No remote item selected', message, details:message});
    return;
  }
  if (!payload.localPath) {
    const message = 'Choose a local destination folder first.';
    if (box) box.textContent = message;
    if (typeof setRemoteExplorerStatus === 'function') setRemoteExplorerStatus('error', message);
    transferSetFeedback?.('error', {mode:'download', title:'No local destination', message, details:message});
    return;
  }
  if (box) box.textContent = 'Downloading with local rsync and active SSH credentials...';
  if (typeof setRemoteExplorerStatus === 'function') {
    setRemoteExplorerStatus('ok', `Downloading ${basenameRemotePath(payload.remotePath)} to ${payload.localPath}...`);
  }
  transferSetFeedback?.('running', {
    mode: 'download',
    title: 'Downloading',
    message: `Copying ${basenameRemotePath(payload.remotePath)} to ${payload.localPath}.`,
  });
  try {
    const response = await apiFetch('/api/transfer/rsync-download', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    const details = transferDetailText?.(data) || '';
    const parts = [
      data.ok ? 'Download finished.' : 'Download failed.',
      `$ ${data.command || 'rsync download'}`,
      data.auth ? `auth: ${data.auth}` : '',
      data.stdout || '',
      data.stderr ? `stderr:\n${data.stderr}` : '',
      !data.ok ? `error:\n${data.error || 'rsync failed.'}` : '',
    ].filter(Boolean);
    if (box) box.textContent = parts.join('\n\n');
    if (typeof setRemoteExplorerStatus === 'function') {
      setRemoteExplorerStatus(
        data.ok ? 'ok' : 'error',
        data.ok
          ? `Download completed: ${basenameRemotePath(payload.remotePath)}`
          : (data.error || 'Download failed.')
      );
    }
    transferSetFeedback?.(data.ok ? 'success' : 'error', {
      mode: 'download',
      title: data.ok ? 'Download completed' : 'Download failed',
      message: data.ok
        ? `${basenameRemotePath(payload.remotePath)} was copied to ${payload.localPath}.`
        : (data.error || 'rsync failed.'),
      details,
      command: data.command || '',
      canRetry: !data.ok,
    });
  } catch (err) {
    const message = `rsync execution failed: ${err?.message || 'unknown error'}`;
    if (box) box.textContent = `${message}\n\nLog in again if the SSH session expired.`;
    if (typeof setRemoteExplorerStatus === 'function') setRemoteExplorerStatus('error', message);
    transferSetFeedback?.('error', {
      mode: 'download',
      title: 'Download failed',
      message,
      details: `${message}\n\nLog in again if the SSH session expired.`,
      canRetry: true,
    });
  }
}

function setDownloadLocalFolder(path) {
  const normalized = String(path || '').trim();
  downloadState.localFolder = normalized;
  const input = $('download-local');
  if (input) input.value = normalized;
  renderDownloadSelection();
  refreshTransferCommands();
}

function renderDownloadSelection() {
  const box = $('download-selection');
  const text = $('download-selection-text');
  const clear = $('download-clear');
  if (!box) return;
  const folder = downloadState.localFolder || $('download-local')?.value.trim() || '';
  box.classList.toggle('ready', !!folder);
  if (clear) clear.classList.toggle('hidden', !folder);
  if (text) text.textContent = folder || 'No folder selected.';
}

async function chooseDownloadFolder(options = {}) {
  const shouldRunAfterSelect = !!options.runAfterSelect;
  const box = $('download-command');
  if (box) box.textContent = 'Opening local folder picker...';
  transferSetFeedback?.('running', {mode:'download', title:'Opening folder picker', message:'Choose the local destination for this download.'});
  try {
    const response = await apiFetch('/api/local/folder-picker', {method: 'POST'});
    const data = await response.json();
    if (!response.ok || !data.ok) {
      if (box) box.textContent = data?.canceled ? buildDownloadCommand() : data?.error || 'Could not choose local folder.';
      transferSetFeedback?.('idle', {
        mode: 'download',
        title: data?.canceled ? 'Folder selection canceled' : 'Could not choose folder',
        message: data?.canceled ? 'No local destination was changed.' : (data?.error || 'Could not choose local folder.'),
      });
      return null;
    }
    setDownloadLocalFolder(data.path || '');
    if (shouldRunAfterSelect) {
      await runDownloadRsync();
    } else {
      transferSetFeedback?.('idle', {
        mode: 'download',
        title: 'Local destination selected',
        message: data.path ? `Downloads will be saved to ${data.path}.` : 'Local destination updated.',
      });
    }
    return data.path || '';
  } catch (err) {
    if (box) box.textContent = `Could not choose local folder: ${err?.message || 'unknown error'}`;
    transferSetFeedback?.('error', {
      mode: 'download',
      title: 'Could not choose folder',
      message: err?.message || 'unknown error',
      details: `Could not choose local folder: ${err?.message || 'unknown error'}`,
    });
    return null;
  }
}

function clearDownloadSelection() {
  setDownloadLocalFolder('');
}

function uploadFilesFromInput(input) {
  const files = Array.from(input?.files || []);
  uploadState.files = files;
  uploadState.localPath = '';
  uploadState.localKind = '';
  renderUploadSelection();
  refreshTransferCommands();
  if (files.length) {
    transferSetFeedback?.('idle', {
      mode: 'upload',
      title: 'Local item selected',
      message: buildUploadCommand(),
    });
  }
}

function chooseUploadInput(id) {
  const input = $(id);
  if (!input) return;
  const fresh = input.cloneNode();
  fresh.value = '';
  fresh.addEventListener('change', ev => uploadFilesFromInput(ev.target));
  input.replaceWith(fresh);
  fresh.click();
}

function chooseUploadFile() {
  chooseUploadInput('upload-picker-file');
}

async function chooseUploadFolder() {
  const box = $('upload-command');
  if (box) box.textContent = 'Opening local folder picker...';
  transferSetFeedback?.('running', {
    mode: 'upload',
    title: 'Opening folder picker',
    message: 'Choose the local folder to import to Apuana.',
  });
  try {
    const response = await apiFetch('/api/local/folder-picker', {method: 'POST'});
    const data = await response.json();
    if (!response.ok || !data.ok) {
      transferSetFeedback?.('idle', {
        mode: 'upload',
        title: data?.canceled ? 'Folder selection canceled' : 'Could not choose folder',
        message: data?.canceled ? 'No local folder was changed.' : (data?.error || 'Could not choose local folder.'),
      });
      if (box) box.textContent = buildUploadCommand();
      return null;
    }
    uploadState.files = [];
    uploadState.localPath = data.path || '';
    uploadState.localKind = 'directory';
    ['upload-picker-file'].forEach(id => {
      const input = $(id);
      if (input) input.value = '';
    });
    renderUploadSelection();
    refreshTransferCommands();
    transferSetFeedback?.('idle', {
      mode: 'upload',
      title: 'Local folder selected',
      message: buildUploadCommand(),
    });
    return uploadState.localPath;
  } catch (err) {
    const message = `Could not choose local folder: ${err?.message || 'unknown error'}`;
    if (box) box.textContent = message;
    transferSetFeedback?.('error', {
      mode: 'upload',
      title: 'Could not choose folder',
      message,
      details: message,
    });
    return null;
  }
}

function clearUploadSelection() {
  uploadState.files = [];
  uploadState.localPath = '';
  uploadState.localKind = '';
  ['upload-picker-file'].forEach(id => {
    const input = $(id);
    if (input) input.value = '';
  });
  renderUploadSelection();
  refreshTransferCommands();
  transferSetFeedback?.('idle', {
    mode: 'upload',
    title: 'Upload selection cleared',
    message: 'Choose a local file or folder when you are ready to import.',
  });
}

function getUploadRemotePath() {
  const preset = $('upload-remote-preset')?.value || 'custom';
  const input = $('upload-remote');
  const home = trailingSlash(transferState.home || '');
  let remote = '';

  if (preset === 'current') remote = trailingSlash(transferState.current || transferState.home || '');
  else if (preset === 'logs') remote = home ? `${home}logs/` : '';
  else if (preset === 'custom') remote = input?.value.trim() || '';
  else remote = home;

  if (input) {
    input.classList.toggle('hidden', preset !== 'custom');
    if (preset !== 'custom') input.value = remote;
  }
  return remote;
}

function splitUploadRemoteInput(value) {
  const raw = String(value || '').trim();
  const home = String(transferState.home || '').replace(/\/+$/, '');
  if (!raw) return {path: home || '~', query: ''};
  if (raw === '~' || raw === '~/') return {path: '~', query: ''};
  if (raw.endsWith('/')) return {path: raw, query: ''};
  if (raw.startsWith('~/')) {
    const idx = raw.lastIndexOf('/');
    return {path: raw.slice(0, idx + 1) || '~/', query: raw.slice(idx + 1)};
  }
  if (!raw.startsWith('/')) return {path: home || '~', query: raw};
  const idx = raw.lastIndexOf('/');
  return {
    path: idx <= 0 ? '/' : raw.slice(0, idx),
    query: raw.slice(idx + 1),
  };
}

function setUploadRemotePickerOpen(open) {
  const toggle = $('upload-suggestions-toggle');
  if (!toggle) return;
  toggle.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function hideUploadRemoteSuggestions() {
  const box = $('upload-remote-suggestions');
  if (uploadRemoteSuggestTimer) {
    clearTimeout(uploadRemoteSuggestTimer);
    uploadRemoteSuggestTimer = null;
  }
  lastUploadRemoteSuggestKey = '';
  if (box) {
    box.classList.add('hidden');
    box.innerHTML = '';
  }
  setUploadRemotePickerOpen(false);
}

function renderUploadRemoteSuggestions(data, typedValue) {
  const box = $('upload-remote-suggestions');
  if (!box || !isUploadCustomMode()) return;
  const home = String(data.home || transferState.home || '').replace(/\/+$/, '');
  if (!data.ok) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="upload-suggestion-empty">${esc(data.error || 'Could not list this path.')}</div>`;
    setUploadRemotePickerOpen(true);
    return;
  }

  const dirs = (data.items || [])
    .filter(item => item.is_dir && isWithinHome(item.path, home))
    .slice(0, 16);
  box.classList.remove('hidden');
  setUploadRemotePickerOpen(true);
  if (!dirs.length) {
    box.innerHTML = '<div class="upload-suggestion-empty">No folders found inside this path.</div>';
    return;
  }
  box.innerHTML = dirs.map(item => `
    <button class="upload-suggestion" type="button" data-path="${esc(trailingSlash(item.path))}">
      ${transferSuggestionKindIcon('directory')}
      <span>${esc(item.path)}</span>
    </button>
  `).join('');
  box.querySelectorAll('button[data-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path') || typedValue || '';
      $('upload-remote').value = path;
      hideUploadRemoteSuggestions();
      refreshTransferCommands();
    });
  });
}

function refreshUploadRemoteSuggestions() {
  if (!isUploadCustomMode()) {
    hideUploadRemoteSuggestions();
    return;
  }
  const input = $('upload-remote');
  const typed = input?.value.trim() || '';
  const home = String(transferState.home || '').replace(/\/+$/, '');
  if (!home) {
    hideUploadRemoteSuggestions();
    return;
  }
  if (typed && typed.startsWith('/') && !isWithinHome(typed, home) && !home.startsWith(typed.replace(/\/+$/, ''))) {
    const box = $('upload-remote-suggestions');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = '<div class="upload-suggestion-empty">Only folders inside your Apuana home are allowed.</div>';
      setUploadRemotePickerOpen(true);
    }
    return;
  }

  const {path, query} = splitUploadRemoteInput(typed || home);
  const key = `${path}|${query}`;
  const box = $('upload-remote-suggestions');
  if (key === lastUploadRemoteSuggestKey && box && !box.classList.contains('hidden')) return;
  lastUploadRemoteSuggestKey = key;
  apiFetch('/api/fs?path=' + encodeURIComponent(path || home) + '&query=' + encodeURIComponent(query || ''))
    .then(r => r.json())
    .then(data => renderUploadRemoteSuggestions(data, typed))
    .catch(() => {
      const box = $('upload-remote-suggestions');
      if (!box) return;
      box.classList.remove('hidden');
      box.innerHTML = '<div class="upload-suggestion-empty">Could not load folders.</div>';
      setUploadRemotePickerOpen(true);
    });
}

function scheduleUploadRemoteSuggestions(delayMs = 250) {
  if (uploadRemoteSuggestTimer) clearTimeout(uploadRemoteSuggestTimer);
  uploadRemoteSuggestTimer = setTimeout(() => {
    uploadRemoteSuggestTimer = null;
    refreshUploadRemoteSuggestions();
  }, delayMs);
}

function splitDownloadRemoteInput(value) {
  const raw = String(value || '').trim();
  const home = String(transferState.home || '').replace(/\/+$/, '');
  if (!raw) return {path: home || '~', query: ''};
  if (raw === '~' || raw === '~/') return {path: '~', query: ''};
  if (raw.endsWith('/')) return {path: raw, query: ''};
  if (raw.startsWith('~/')) {
    const idx = raw.lastIndexOf('/');
    return {path: raw.slice(0, idx + 1) || '~/', query: raw.slice(idx + 1)};
  }
  if (!raw.startsWith('/')) return {path: home || '~', query: raw};
  const idx = raw.lastIndexOf('/');
  return {
    path: idx <= 0 ? '/' : raw.slice(0, idx),
    query: raw.slice(idx + 1),
  };
}

function hideDownloadRemoteSuggestions() {
  const box = $('download-remote-suggestions');
  if (!box) return;
  box.classList.add('hidden');
  box.innerHTML = '';
}

function renderDownloadRemoteSuggestions(data) {
  const box = $('download-remote-suggestions');
  if (!box) return;
  const home = String(data.home || transferState.home || '').replace(/\/+$/, '');
  if (!data.ok) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="upload-suggestion-empty">${esc(data.error || 'Could not list this path.')}</div>`;
    return;
  }

  const items = (data.items || [])
    .filter(item => (item.is_dir || item.is_file) && isWithinHome(item.path, home))
    .slice(0, 18);
  box.classList.remove('hidden');
  if (!items.length) {
    box.innerHTML = '<div class="upload-suggestion-empty">No files or folders found inside this path.</div>';
    return;
  }
  box.innerHTML = items.map(item => {
    const kind = item.is_dir ? 'directory' : 'file';
    return `
      <button class="upload-suggestion" type="button" data-path="${esc(item.path)}" data-kind="${esc(kind)}">
        ${transferSuggestionKindIcon(kind)}
        <span>${esc(item.path)}</span>
      </button>
    `;
  }).join('');
  box.querySelectorAll('button[data-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path') || '';
      $('download-remote').value = path;
      transferState.selectedPath = path;
      transferState.selectedKind = btn.getAttribute('data-kind') || '';
      hideDownloadRemoteSuggestions();
      refreshTransferCommands();
    });
  });
}

function refreshDownloadRemoteSuggestions() {
  const input = $('download-remote');
  const typed = input?.value.trim() || '';
  const home = String(transferState.home || '').replace(/\/+$/, '');
  if (!home) {
    hideDownloadRemoteSuggestions();
    return;
  }
  if (typed && typed.startsWith('/') && !isWithinHome(typed, home) && !home.startsWith(typed.replace(/\/+$/, ''))) {
    const box = $('download-remote-suggestions');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = '<div class="upload-suggestion-empty">Only files and folders inside your Apuana home are allowed.</div>';
    }
    return;
  }

  const {path, query} = splitDownloadRemoteInput(typed || home);
  const key = `${path}|${query}`;
  if (key === lastDownloadRemoteSuggestKey) return;
  lastDownloadRemoteSuggestKey = key;
  apiFetch('/api/fs?path=' + encodeURIComponent(path || home) + '&query=' + encodeURIComponent(query || ''))
    .then(r => r.json())
    .then(renderDownloadRemoteSuggestions)
    .catch(() => {
      const box = $('download-remote-suggestions');
      if (!box) return;
      box.classList.remove('hidden');
      box.innerHTML = '<div class="upload-suggestion-empty">Could not load files or folders.</div>';
    });
}

function scheduleDownloadRemoteSuggestions(delayMs = 250) {
  if (downloadRemoteSuggestTimer) clearTimeout(downloadRemoteSuggestTimer);
  downloadRemoteSuggestTimer = setTimeout(() => {
    downloadRemoteSuggestTimer = null;
    refreshDownloadRemoteSuggestions();
  }, delayMs);
}

function renderUploadSelection() {
  const box = $('upload-selection');
  const text = $('upload-selection-text');
  const clear = $('upload-clear');
  if (!box) return;
  const files = uploadState.files || [];
  const localPath = String(uploadState.localPath || '').trim();
  const hasSelection = files.length > 0 || !!localPath;
  box.classList.toggle('ready', hasSelection);
  if (clear) clear.classList.toggle('hidden', !hasSelection);
  if (localPath) {
    if (text) text.textContent = `Folder - ${localPath}`;
    return;
  }
  if (!files.length) {
    if (text) text.textContent = 'No local item selected.';
    return;
  }
  const total = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const firstPath = files[0]?.webkitRelativePath || files[0]?.name || 'selection';
  const folder = firstPath.includes('/') ? firstPath.split('/')[0] : '';
  if (text) {
    text.textContent = folder
      ? `${folder} - ${files.length} file(s), ${formatBytes(total)}`
      : files.length === 1
        ? `${files[0].name} - ${formatBytes(total)}`
        : `${files.length} file(s), ${formatBytes(total)}`;
  }
}

function formatBytes(bytes) {
  let value = Number(bytes || 0);
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return unit === 'B' ? `${value} B` : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function basenameLocalPath(path) {
  return String(path || '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || 'Folder';
}

function createUploadTask(localPath, remotePath) {
  const id = `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const task = {
    id,
    localPath,
    remotePath: normalizeRemotePath(remotePath),
    name: basenameLocalPath(localPath),
    status: 'running',
    error: '',
    startedAt: Date.now(),
  };
  uploadTasks = [task, ...(uploadTasks || [])].slice(0, 8);
  if (typeof refreshRemoteUploadPlaceholders === 'function') refreshRemoteUploadPlaceholders();
  const timer = setInterval(() => {
    if (!uploadTasks.some(item => item.id === id && item.status === 'running')) {
      clearInterval(timer);
      return;
    }
    if (typeof refreshRemoteUploadPlaceholders === 'function') refreshRemoteUploadPlaceholders();
  }, 1200);
  return task;
}

function updateUploadTask(id, patch = {}) {
  uploadTasks = (uploadTasks || []).map(task => task.id === id ? {...task, ...patch} : task);
  if (typeof refreshRemoteUploadPlaceholders === 'function') refreshRemoteUploadPlaceholders();
}

function finishUploadTaskSoon(id) {
  setTimeout(() => {
    uploadTasks = (uploadTasks || []).filter(task => task.id !== id);
    if (typeof refreshRemoteUploadPlaceholders === 'function') refreshRemoteUploadPlaceholders();
  }, 4500);
}

async function pollUploadTask(localTaskId, serverTaskId, remotePath) {
  let lastPayload = {};
  for (let attempt = 0; attempt < 720; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, attempt < 4 ? 700 : 1500));
    const response = await apiFetch(`/api/transfer/task?id=${encodeURIComponent(serverTaskId)}`);
    const data = await response.json();
    lastPayload = data;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Upload status unavailable.');
    }
    updateUploadTask(localTaskId, {
      status: data.status || 'running',
      progress: Number(data.progress || 0),
      error: data.error || '',
    });
    if (data.status === 'done') {
      return data;
    }
    if (data.status === 'error') {
      throw new Error(data.error || data.result?.error || 'Upload failed.');
    }
  }
  const message = `Upload is still running for ${remotePath}.`;
  updateUploadTask(localTaskId, {status: 'running', error: ''});
  return {...lastPayload, ok: true, status: 'running', message};
}

async function uploadSelectedToApuana() {
  const box = $('upload-command');
  if (!box) return;
  if (!sshAuth.loggedIn || !sshAuth.token) {
    const message = 'SSH login required. Log in first so the dashboard can upload with your active Apuana session.';
    box.textContent = message;
    transferSetFeedback?.('error', {mode:'upload', title:'SSH session required', message, details:message});
    return;
  }
  const remote = getUploadRemotePath();
  const localPath = String(uploadState.localPath || '').trim();
  if (!uploadState.files.length && !localPath) {
    const message = 'Choose a local file or folder first.';
    box.textContent = message;
    transferSetFeedback?.('error', {mode:'upload', title:'No local item selected', message, details:message});
    return;
  }
  if (!remote) {
    const message = 'Enter an Apuana destination path.';
    box.textContent = message;
    transferSetFeedback?.('error', {mode:'upload', title:'No remote destination', message, details:message});
    return;
  }

  if (localPath) {
    const payload = {
      mode: 'upload',
      localPath,
      remotePath: remote,
      includeContents: false,
    };
    const task = createUploadTask(localPath, remote);
    uploadState.files = [];
    uploadState.localPath = '';
    uploadState.localKind = '';
    renderUploadSelection();
    refreshTransferCommands();
    closeImportModal();
    box.textContent = 'Uploading selected folder with the active SSH session...';
    if (typeof setRemoteExplorerStatus === 'function') {
      setRemoteExplorerStatus('ok', `Importing ${basenameLocalPath(localPath)} to ${remote}...`);
    }
    transferSetFeedback?.('running', {
      mode: 'upload',
      title: 'Uploading',
      message: `Sending ${localPath} to ${remote}.`,
    });
    try {
      const response = await apiFetch('/api/transfer/rsync-upload/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const start = await response.json();
      if (!response.ok || !start.ok) {
        throw new Error(start.error || 'Upload failed to start.');
      }
      updateUploadTask(task.id, {
        serverTaskId: start.task_id,
        progress: Number(start.progress || 8),
        status: start.status || 'running',
      });
      const status = await pollUploadTask(task.id, start.task_id, remote);
      const result = status.result || status;
      const details = transferDetailText?.(result) || '';
      box.textContent = [
        status.status === 'running' ? 'Upload still running.' : result.ok ? 'Upload finished.' : 'Upload failed.',
        `$ ${result.command || 'upload selected folder'}`,
        result.stdout || '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
        !result.ok ? `error:\n${result.error || 'upload failed.'}` : '',
      ].filter(Boolean).join('\n\n') || 'Upload finished.';
      transferSetFeedback?.(status.status === 'running' ? 'running' : result.ok ? 'success' : 'error', {
        mode: 'upload',
        title: status.status === 'running' ? 'Upload still running' : result.ok ? 'Upload completed' : 'Upload failed',
        message: status.status === 'running' ? `Import is still running in the background for ${remote}.` : result.ok ? `${localPath} sent to ${remote}.` : (result.error || 'upload failed.'),
        details,
        command: result.command || '',
        canRetry: !result.ok,
      });
      if (status.status === 'running') {
        updateUploadTask(task.id, {status: 'running', progress: 88, error: ''});
      } else if (result.ok) {
        updateUploadTask(task.id, {status: 'done', error: ''});
        finishUploadTaskSoon(task.id);
        if (typeof loadRemoteExplorer === 'function') {
          loadRemoteExplorer(remoteExplorerState.path || transferState.current || transferState.home, undefined, {force: true})
            .then(() => {
              if (typeof setRemoteExplorerStatus === 'function') {
                setRemoteExplorerStatus('ok', `Import completed to ${remote}.`);
              }
            })
            .catch(() => {});
        }
      } else {
        updateUploadTask(task.id, {status: 'error', error: result.error || 'Import failed'});
      }
    } catch (err) {
      const message = `Upload failed: ${err?.message || 'unknown error'}`;
      updateUploadTask(task.id, {status: 'error', error: message});
      box.textContent = `${message}\n\nLog in again if the SSH session expired.`;
      transferSetFeedback?.('error', {
        mode: 'upload',
        title: 'Upload failed',
        message,
        details: `${message}\n\nLog in again if the SSH session expired.`,
        canRetry: true,
      });
    }
    return;
  }

  const data = new FormData();
  data.append('remotePath', remote);
  uploadState.files.forEach(file => {
    data.append('files', file, file.webkitRelativePath || file.name);
  });
  box.textContent = 'Uploading selected files with the active SSH session...';
  transferSetFeedback?.('running', {
    mode: 'upload',
    title: 'Uploading',
    message: `Sending ${uploadState.files.length} file(s) to ${remote}.`,
  });
  try {
    const response = await apiFetch('/api/transfer/upload-selected', {
      method: 'POST',
      body: data,
    });
    const result = await response.json();
    const details = transferDetailText?.(result) || '';
    const parts = [
      result.ok ? 'Upload finished.' : 'Upload failed.',
      `$ ${result.command || 'upload selected files'}`,
      result.stdout || '',
      result.stderr ? `stderr:\n${result.stderr}` : '',
      !result.ok ? `error:\n${result.error || 'upload failed.'}` : '',
    ].filter(Boolean);
    box.textContent = parts.join('\n\n') || 'Upload finished.';
    transferSetFeedback?.(result.ok ? 'success' : 'error', {
      mode: 'upload',
      title: result.ok ? 'Upload completed' : 'Upload failed',
      message: result.ok
        ? `${uploadState.files.length} file(s) sent to ${remote}.`
        : (result.error || 'upload failed.'),
      details,
      command: result.command || '',
      canRetry: !result.ok,
    });
    if (result.ok) {
      closeImportModal();
      if (typeof loadRemoteExplorer === 'function') {
        loadRemoteExplorer(remoteExplorerState.path || transferState.current || transferState.home, undefined, {force: true})
          .then(() => {
            if (typeof setRemoteExplorerStatus === 'function') {
              setRemoteExplorerStatus('ok', `Import completed to ${remote}.`);
            }
          })
          .catch(() => {});
      }
    }
  } catch (err) {
    const message = `Upload failed: ${err?.message || 'unknown error'}`;
    box.textContent = `${message}\n\nLog in again if the SSH session expired.`;
    transferSetFeedback?.('error', {
      mode: 'upload',
      title: 'Upload failed',
      message,
      details: `${message}\n\nLog in again if the SSH session expired.`,
      canRetry: true,
    });
  }
}

function copyTextFrom(id) {
  const text = $(id).textContent || '';
  if (!text.trim()) return;
  navigator.clipboard?.writeText(text);
}

function transferEntryIcon(kind, isDir) {
  const label = isDir ? 'Directory' : 'File';
  const cls = isDir ? 'directory' : (kind === 'file' ? 'file' : 'other');
  const svg = isDir
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>';
  return `<span class="transfer-kind-icon ${cls}" role="img" aria-label="${label}" title="${label}">${svg}</span>`;
}

function transferActionIcon(action, path, label, svg, kind = '') {
  const kindAttr = kind ? ` data-kind="${esc(kind)}"` : '';
  return `<button class="mini-btn transfer-action icon-only" data-action="${esc(action)}" data-path="${esc(path)}"${kindAttr} aria-label="${esc(label)}" title="${esc(label)}">${svg}</button>`;
}

function renderTransferBrowser(data) {
  if (data.home && data.home !== transferState.home) {
    transferState.home = data.home;
    applyTransferHomeDefaults(false);
  }
  transferState.current = data.path || transferState.current || transferState.home || '';
  if (data.path) $('transfer-browse-path').value = data.path;
  const uploadInput = $('upload-remote');
  if (uploadInput) uploadInput.value = trailingSlash(transferState.current || transferState.home || '');
  refreshTransferCommands();
  updateTransferBackButton();
  if (!data.ok) {
    applyTransferHomeDefaults(false);
    $('transfer-browser').innerHTML = `<div class="alert a-danger">${esc(data.error || 'Path lookup failed.')}</div>`;
    updateTransferBackButton();
    return;
  }
  const items = data.items || [];
  if (!items.length) {
    const message = data.query
      ? `No files or folders matched "${data.query}".`
      : 'No files in this folder.';
    $('transfer-browser').innerHTML = `<p class="empty">${esc(message)}</p>`;
    return;
  }
  $('transfer-browser').innerHTML = items.map(item => {
    const kind = item.kind || 'other';
    const isDir = !!item.is_dir;
    const displayPath = displayRemotePath(item.path);
    const downloadSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';
    return `<div class="transfer-row-item ${isDir ? 'is-dir' : 'is-file'}" data-open-path="${isDir ? esc(item.path) : ''}">
      ${transferEntryIcon(kind, isDir)}
      <span class="path-cell" title="${esc(item.path)}">${esc(displayPath)}</span>
      <span class="transfer-size">${esc(item.size_human || '')}</span>
      <span class="mtime">${esc(item.mtime || '')}</span>
      <span class="row-actions">
        ${transferActionIcon('download', item.path, 'Download', downloadSvg, kind)}
      </span>
    </div>`;
  }).join('');

  document.querySelectorAll('#transfer-browser button[data-action]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const action = btn.getAttribute('data-action');
      const path = btn.getAttribute('data-path') || '';
      const kind = btn.getAttribute('data-kind') || '';
      if (action === 'download') downloadRemoteItemFromBrowser(path, kind);
    });
  });
  document.querySelectorAll('#transfer-browser .transfer-row-item[data-open-path]').forEach(row => {
    row.addEventListener('click', () => {
      const path = row.getAttribute('data-open-path') || '';
      if (path) browseTransfer(path, '');
    });
  });
  scheduleTransferBrowserLayout();
}

function browseTransferParent() {
  const input = $('transfer-browse-path');
  const parent = parentRemotePath(input?.value || transferState.current || transferState.home);
  if (input) input.value = parent;
  lastTransferBrowseKey = '';
  browseTransfer(parent, '');
}

function browseTransfer(path, query) {
  let base = path ?? $('transfer-browse-path').value.trim() ?? transferState.home;
  if (transferState.home && shouldResetRemotePath(base, transferState.home)) {
    base = transferState.home;
    $('transfer-browse-path').value = transferState.home;
  }
  const q = query ?? $('transfer-search').value.trim();
  const key = `${base || '~'}|${q || ''}`;
  if (key === lastTransferBrowseKey) return;
  lastTransferBrowseKey = key;
  $('transfer-browser').innerHTML = '<p class="empty">Loading remote path...</p>';
  apiFetch('/api/fs?path=' + encodeURIComponent(base || '~') + '&query=' + encodeURIComponent(q || ''))
    .then(r => r.json())
    .then(renderTransferBrowser)
    .catch((err) => {
      const msg = String(err?.message || '');
      const text = msg.includes('SSH login required')
        ? 'SSH login required. Please sign in again.'
        : 'Could not reach /api/fs.';
      $('transfer-browser').innerHTML = `<div class="alert a-danger">${esc(text)}</div>`;
    });
}

function scheduleBrowseTransfer(delayMs = 300) {
  if (transferBrowseTimer) clearTimeout(transferBrowseTimer);
  transferBrowseTimer = setTimeout(() => {
    transferBrowseTimer = null;
    browseTransfer();
  }, delayMs);
}

function selectDownloadPath(path, kind) {
  const input = $('download-remote');
  if (input) input.value = path;
  transferState.selectedPath = path;
  transferState.selectedKind = kind || '';
  hideDownloadRemoteSuggestions();
  refreshTransferCommands();
  transferSetFeedback?.('idle', {
    mode: 'download',
    title: 'Remote item selected',
    message: buildDownloadCommand(),
  });
}

async function downloadRemoteItemFromBrowser(path, kind) {
  selectDownloadPath(path, kind);
  await chooseDownloadFolder({runAfterSelect: true});
}

function selectUploadTarget(path) {
  const input = $('upload-remote');
  if (input) input.value = trailingSlash(path);
  const preset = $('upload-remote-preset');
  if (preset) preset.value = 'custom';
  refreshCustomSelect('upload-remote-preset');
  getUploadRemotePath();
  hideUploadRemoteSuggestions();
  refreshTransferCommands();
  transferSetFeedback?.('idle', {
    mode: 'upload',
    title: 'Upload destination selected',
    message: `Uploads will go to ${trailingSlash(path)}.`,
  });
}

function openImportModal(destinationPath) {
  const modal = $('remote-import-modal');
  if (!modal) return;
  const home = String(transferState.home || '').replace(/\/+$/, '');
  let target = trailingSlash(destinationPath || remoteExplorerState.path || transferState.current || home || '');
  if (home && shouldResetRemotePath(target, home)) target = trailingSlash(home);
  updateTransferPathPlaceholders();
  if ($('upload-remote')) $('upload-remote').value = target;
  const preset = $('upload-remote-preset');
  if (preset) preset.value = 'custom';
  hideUploadRemoteSuggestions();
  renderUploadSelection();
  refreshTransferCommands();
  transferSetFeedback?.('idle', {
    mode: 'upload',
    title: 'Ready to import',
    message: 'Choose a local file or folder and confirm the remote destination.',
  });
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  hideUploadRemoteSuggestions();
}

function closeImportModal() {
  const modal = $('remote-import-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  hideUploadRemoteSuggestions();
}

function ensureTransferReady() {
  syncTransferMeta(_last || {});
  if ($('transfer-browser') && !$('transfer-browser').innerHTML.trim()) browseTransfer();
  if (typeof ensureRemoteExplorerReady === 'function') ensureRemoteExplorerReady();
  scheduleTransferBrowserLayout();
}
