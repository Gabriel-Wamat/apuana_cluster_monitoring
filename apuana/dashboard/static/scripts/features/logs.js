function logPairCandidates(path) {
  const p = String(path || '');
  const pairs = [];
  [
    [/\.out$/i, '.err'],
    [/\.stdout$/i, '.stderr'],
    [/\.err$/i, '.out'],
    [/\.stderr$/i, '.stdout'],
  ].forEach(([re, replacement]) => {
    if (re.test(p)) pairs.push(p.replace(re, replacement));
  });
  return pairs;
}

function logFolderInputValue() {
  return ($('log-folder-path')?.value || '').trim() || logState.folder || logState.home || transferState.home || '~';
}

function applyLogFolderDefault(force = false) {
  const input = $('log-folder-path');
  const home = logState.home || transferState.home || '';
  if (!input || !home) return;
  const current = input.value.trim();
  if (force || !current || shouldResetRemotePath(current, home)) {
    input.value = home;
    logState.folder = home;
  }
}

function updateLogFolderNav() {
  const back = $('log-folder-back');
  if (!back) return;
  back.disabled = !(logState.history || []).length;
}

function logEntryName(entry) {
  return String(entry?.name || entry?.path || '').split('/').filter(Boolean).pop() || '';
}

function dotEntriesLast(entries) {
  const visible = [];
  const dotPrefixed = [];
  (entries || []).forEach(entry => {
    if (logEntryName(entry).startsWith('.')) dotPrefixed.push(entry);
    else visible.push(entry);
  });
  return visible.concat(dotPrefixed);
}

function logEmptyState(title, detail, icon = 'file') {
  const folderIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6.8A2.8 2.8 0 0 1 5.8 4h4.4l2 2H18a3 3 0 0 1 3 3v8.2a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2Z"/>
    </svg>
  `;
  const fileIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/>
      <path d="M14 3.5V8h4"/>
      <path d="M8 13h8"/>
      <path d="M8 16h6"/>
    </svg>
  `;
  return `
    <div class="log-empty-state">
      <span class="log-empty-icon">${icon === 'folder' ? folderIcon : fileIcon}</span>
      <strong>${esc(title)}</strong>
      <span>${esc(detail)}</span>
    </div>
  `;
}

function logTypeIcon(kind) {
  if (kind === 'folder') {
    return `
      <span class="log-type-icon log-type-folder" title="Folder" aria-label="Folder">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6.8A2.8 2.8 0 0 1 5.8 4h4.4l2 2H18a3 3 0 0 1 3 3v8.2a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2Z"/>
        </svg>
      </span>
    `;
  }
  const fileKind = kind === 'stderr' ? 'stderr' : kind === 'stdout' ? 'stdout' : 'file';
  const label = fileKind === 'stderr' ? 'Error log file' : fileKind === 'stdout' ? 'Output log file' : 'File';
  return `
    <span class="log-type-icon log-type-${esc(fileKind)}" title="${esc(label)}" aria-label="${esc(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/>
        <path d="M14 3.5V8h4"/>
        <path d="M8 13h8"/>
        <path d="M8 16h6"/>
      </svg>
    </span>
  `;
}

function renderLogFiles() {
  const list = $('log-file-list');
  if (!list) return;
  updateLogFolderNav();

  if (!logState.loaded) {
    list.innerHTML = logEmptyState('Loading folder', 'Checking this Apuana path for log files.', 'folder');
    return;
  }

  const folders = logState.folders || [];
  const items = logState.items || [];
  const selectingFolder = logState.mode === 'folders';
  const visibleFolders = selectingFolder ? dotEntriesLast(folders) : [];
  const visibleItems = selectingFolder ? [] : items;

  if (logState.error) {
    list.innerHTML = `<div class="alert a-danger">${esc(logState.error)}</div>`;
    return;
  }

  if (selectingFolder && !visibleFolders.length) {
    list.innerHTML = logEmptyState('No folders found', 'Try another path inside your Apuana home.', 'folder');
    return;
  }

  if (!selectingFolder && !visibleItems.length) {
    list.innerHTML = logEmptyState('No logs in this folder', 'Choose another folder with .out or .err files.', 'file');
    return;
  }

  const folderRows = visibleFolders.slice(0, 160).map(folder => `
    <button class="log-file-row log-folder-row" type="button" data-folder="${esc(folder.path)}">
      ${logTypeIcon('folder')}
      <span class="log-path" title="${esc(folder.path)}">${esc(folder.name || folder.path)}</span>
      <span class="log-mtime">${esc(folder.mtime || '')}</span>
    </button>
  `).join('');

  const fileRows = visibleItems.slice(0, 200).map(item => `
    <button class="log-file-row" type="button" data-path="${esc(item.path)}">
      ${logTypeIcon(item.kind)}
      <span class="log-path" title="${esc(item.path)}">${esc(item.name || item.path)}</span>
      <span class="log-size">${esc(item.size_human || '')}</span>
      <span class="log-mtime">${esc(item.mtime || '')}</span>
    </button>
  `).join('');

  list.innerHTML = folderRows + fileRows;

  list.querySelectorAll('button[data-path]').forEach(btn => {
    btn.addEventListener('click', () => selectLogFile(btn.getAttribute('data-path') || ''));
  });
  list.querySelectorAll('button[data-folder]').forEach(btn => {
    btn.addEventListener('click', () => openLogFolder(btn.getAttribute('data-folder') || ''));
  });
}

function selectLogFile(path) {
  const item = logState.items.find(entry => entry.path === path);
  if (!item) return;
  const pair = logPairCandidates(path)
    .map(candidate => logState.items.find(entry => entry.path === candidate))
    .find(Boolean);

  if (item.kind === 'stderr') {
    $('log-err-path').value = item.path;
    $('log-out-path').value = pair?.path || '';
  } else {
    $('log-out-path').value = item.path;
    $('log-err-path').value = pair?.path || '';
  }
  fetchLogs();
}

function pushLogFolderHistory(nextFolder, nextMode) {
  const currentFolder = logState.folder || logFolderInputValue();
  const currentMode = logState.mode || 'folders';
  if (!currentFolder || currentFolder === nextFolder && currentMode === nextMode) return;
  logState.history = [...(logState.history || []), {folder: currentFolder, mode: currentMode}].slice(-30);
  updateLogFolderNav();
}

function openLogFolder(path, mode = 'logs', options = {}) {
  const input = $('log-folder-path');
  if (input && path) input.value = path;
  const nextFolder = path || logFolderInputValue();
  const nextMode = mode === 'folders' ? 'folders' : 'logs';
  if (options.pushHistory !== false) pushLogFolderHistory(nextFolder, nextMode);
  logState.folder = nextFolder;
  logState.mode = nextMode;
  logState.error = '';
  logState.loaded = false;
  fetchLogFiles(true);
}

function isLogHomePath(path) {
  const normalizedPath = String(path || '').replace(/\/+$/, '');
  const candidates = [
    logState.home,
    transferState.home,
    transferState.user ? `/home/CIN/${transferState.user}` : '',
  ].filter(Boolean);
  return candidates.some(home => normalizedPath === String(home).replace(/\/+$/, ''));
}

function openLogFolderFromInput() {
  const folder = logFolderInputValue();
  openLogFolder(folder, isLogHomePath(folder) ? 'folders' : 'logs');
}

function openLogHome() {
  openLogFolder(logState.home || transferState.home || '~', 'folders');
}

function openLogParent() {
  const parent = logState.parent || logState.home || transferState.home || '~';
  const home = (logState.home || transferState.home || '').replace(/\/+$/, '');
  const mode = parent.replace(/\/+$/, '') === home ? 'folders' : 'logs';
  openLogFolder(parent, mode);
}

function openLogBack() {
  const previous = (logState.history || []).pop();
  if (!previous) {
    updateLogFolderNav();
    return;
  }
  openLogFolder(previous.folder, previous.mode || 'folders', {pushHistory: false});
}

function fetchLogFiles(force = false) {
  if (!sshAuth.loggedIn || !sshAuth.token) return;
  applyLogFolderDefault(false);
  if (logState.loaded && !force) {
    renderLogFiles();
    return;
  }

  logState.loaded = false;
  logState.error = '';
  renderLogFiles();
  const folder = logFolderInputValue();
  const mode = logState.mode || 'folders';
  apiFetch('/api/log-files?folder=' + encodeURIComponent(folder) + '&mode=' + encodeURIComponent(mode))
    .then(r => r.json())
    .then(data => {
      logState.items = data.ok ? (data.items || []) : [];
      logState.folders = data.ok ? (data.folders || []) : [];
      logState.error = data.ok ? '' : (data.error || 'Could not list this folder.');
      logState.home = data.home || logState.home || transferState.home || '';
      logState.folder = data.folder || folder;
      logState.parent = data.parent || logState.home;
      logState.mode = data.mode || mode;
      if ($('log-folder-path') && logState.folder) $('log-folder-path').value = logState.folder;
      logState.loaded = true;
      renderLogFiles();
    })
    .catch(err => {
      logState.items = [];
      logState.folders = [];
      logState.error = err?.message || 'Could not load available logs.';
      logState.loaded = true;
      renderLogFiles();
    });
}

function renderLogPane(kind, text) {
  const targetId = kind === 'out' ? 'log-out-content' : 'log-err-content';
  const pane = $(targetId);
  if (!pane) return;
  pane.textContent = text || 'No output for this file.';
}

function fetchLogs() {
  const out = $('log-out-path').value.trim();
  const err = $('log-err-path').value.trim();
  if (!out && !err) return;
  apiFetch('/api/logs?out=' + encodeURIComponent(out) + '&err=' + encodeURIComponent(err))
    .then(r => r.json())
    .then(d => {
      logViewState.raw.out = d.out || '';
      logViewState.raw.err = d.err || '';
      renderLogPane('out', logViewState.raw.out);
      renderLogPane('err', logViewState.raw.err);
    }).catch(() => {});
}
