function remoteIcon(kind) {
  if (kind === 'directory') {
    return '<svg class="remote-folder-svg" viewBox="0 0 64 48"><path class="folder-tab" d="M5 13.5c0-3 2.4-5.5 5.5-5.5h13.2c1.7 0 3.4.8 4.4 2.2l3.2 4.3H55c2.2 0 4 1.8 4 4v2H5z"/><path class="folder-body" d="M5 18h54v20.5c0 3-2.4 5.5-5.5 5.5h-43C7.4 44 5 41.6 5 38.5z"/><path class="folder-shine" d="M9 22h46"/></svg>';
  }
  if (kind === 'file') {
    return '<svg viewBox="0 0 48 56"><path d="M10 3h19l9 9v41H10z"/><path d="M29 3v10h9"/><path d="M17 27h14"/><path d="M17 35h14"/></svg>';
  }
  return '<svg viewBox="0 0 48 56"><path d="M10 3h28v50H10z"/><path d="M18 26h12"/><path d="M18 34h12"/></svg>';
}

function actionIcon(name) {
  if (name === 'menu') {
    return '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
  }
  if (name === 'download') {
    return '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';
  }
  if (name === 'import') {
    return '<svg viewBox="0 0 24 24"><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 4h16"/></svg>';
  }
  if (name === 'edit') {
    return '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
}

function remotePeriodLabel(key) {
  return {
    today: 'Today',
    week: 'Last 7 days',
    month: 'Last 30 days',
    older: 'Older',
    unknown: 'No date',
  }[key] || key;
}

function remotePeriodKey(epoch) {
  const value = Number(epoch || 0);
  if (!value) return 'unknown';
  const now = Date.now() / 1000;
  const age = now - value;
  const current = new Date();
  const modified = new Date(value * 1000);
  if (
    current.getFullYear() === modified.getFullYear() &&
    current.getMonth() === modified.getMonth() &&
    current.getDate() === modified.getDate()
  ) return 'today';
  if (age <= 7 * 24 * 60 * 60) return 'week';
  if (age <= 30 * 24 * 60 * 60) return 'month';
  return 'older';
}

function remoteItemSubtitle(item) {
  if (item.is_dir) {
    if (item.child_count == null) return 'Folder';
    return item.child_count === 1 ? '1 item' : `${item.child_count} items`;
  }
  return item.size_human || 'file';
}

function remoteItemTypeLabel(item) {
  if (item.is_dir) return 'Folder';
  const name = String(item.name || item.path || '').toLowerCase();
  if (name.endsWith('.out')) return 'STDOUT';
  if (name.endsWith('.err')) return 'STDERR';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return ext && ext.length <= 8 ? ext.toUpperCase() : 'File';
}

function remoteDisplayPath(item) {
  const path = String(item.path || '');
  const home = String(remoteExplorerState.home || transferState.home || '').replace(/\/+$/, '');
  if (home && (path === home || path.startsWith(`${home}/`))) {
    const rel = path.slice(home.length).replace(/^\/+/, '');
    return rel ? `~/${rel}` : '~';
  }
  return path;
}

function remoteModifiedLabel(item) {
  return item.mtime || item.mtime_human || item.modified || '--';
}

function remoteViewMode() {
  return remoteExplorerState.viewMode === 'list' ? 'list' : 'grid';
}

function loadRemoteViewModePreference() {
  if (remoteExplorerState.viewPreferenceLoaded) return;
  try {
    const saved = localStorage.getItem('apuana.remoteViewMode');
    if (saved === 'list' || saved === 'grid') remoteExplorerState.viewMode = saved;
  } catch (_) {
    // localStorage can be unavailable in hardened browser contexts.
  }
  remoteExplorerState.viewPreferenceLoaded = true;
}

function remoteViewToggleIcon(mode) {
  if (mode === 'list') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>';
}

function updateRemoteViewToggle() {
  const btn = $('remote-view-toggle');
  if (!btn) return;
  const mode = remoteViewMode();
  const label = mode === 'list' ? 'View as grid' : 'View as list';
  btn.innerHTML = remoteViewToggleIcon(mode);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.classList.toggle('active', mode === 'list');
}

function toggleRemoteViewMode() {
  loadRemoteViewModePreference();
  const next = remoteViewMode() === 'list' ? 'grid' : 'list';
  remoteExplorerState = {...remoteExplorerState, viewMode: next};
  try {
    localStorage.setItem('apuana.remoteViewMode', next);
  } catch (_) {
    // Preference persistence is best-effort only.
  }
  updateRemoteViewToggle();
  if (remoteExplorerState.loaded) {
    renderRemoteExplorer({
      ok: true,
      error: '',
      path: remoteExplorerState.path,
      home: remoteExplorerState.home || transferState.home,
      period: remoteExplorerState.period,
      items: remoteExplorerState.items,
    });
  }
}

function remoteExplorerKey(path, period) {
  return `${path || '~'}|${period || 'all'}`;
}

function setRemoteExplorerStatus(kind, message) {
  const status = $('remote-visual-status');
  if (!status) return;
  status.className = `remote-explorer-status ${kind || ''}`.trim();
  status.textContent = message || '';
}

function sameRemotePath(a, b) {
  return String(a || '').replace(/\/+$/, '') === String(b || '').replace(/\/+$/, '');
}

function removeRemoteItemOptimistically(path) {
  const target = String(path || '').replace(/\/+$/, '');
  if (!target) return;
  remoteExplorerState.items = (remoteExplorerState.items || []).filter(item => !sameRemotePath(item.path, target));
  remoteExplorerCache.forEach((data, key) => {
    if (!data || !Array.isArray(data.items)) return;
    const items = data.items.filter(item => !sameRemotePath(item.path, target));
    if (items.length !== data.items.length) {
      remoteExplorerCache.set(key, {...data, items});
    }
  });
  renderRemoteExplorer({
    ok: true,
    error: '',
    path: remoteExplorerState.path,
    home: remoteExplorerState.home || transferState.home,
    period: remoteExplorerState.period,
    items: remoteExplorerState.items,
  });
}

function updateRemoteBackState() {
  const back = $('remote-back');
  const forward = $('remote-forward');
  if (back) {
    back.disabled = !remoteExplorerState.history.length;
    back.classList.toggle('disabled', !remoteExplorerState.history.length);
  }
  if (forward) {
    forward.disabled = !remoteExplorerState.future.length;
    forward.classList.toggle('disabled', !remoteExplorerState.future.length);
  }
}

function renderRemoteExplorer(data) {
  const status = $('remote-visual-status');
  const grid = $('remote-visual-grid');
  if (!grid) return;
  loadRemoteViewModePreference();
  updateRemoteViewToggle();
  grid.classList.toggle('is-list', remoteViewMode() === 'list');

  if (!data.ok) {
    remoteExplorerState.items = [];
    if (status) {
      status.className = 'remote-explorer-status error';
      status.textContent = data.error || 'Could not load this folder.';
    }
    grid.innerHTML = '';
    return;
  }

  remoteExplorerState = {
    ...remoteExplorerState,
    path: data.path || remoteExplorerState.path,
    home: data.home || remoteExplorerState.home || transferState.home,
    period: data.period || remoteExplorerState.period,
    items: data.items || [],
    loaded: true,
  };
  remoteExplorerCache.set(remoteExplorerKey(remoteExplorerState.path, remoteExplorerState.period), data);
  updateRemoteBackState();
  transferState.current = remoteExplorerState.path || transferState.current;
  if ($('remote-visual-path')) $('remote-visual-path').value = remoteExplorerState.path || '';
  if (status) {
    status.className = 'remote-explorer-status ok';
    status.textContent = remoteExplorerState.items.length
      ? `${remoteExplorerState.items.length} item(s) in ${remoteExplorerState.path}`
      : `No items found in ${remoteExplorerState.path}`;
  }

  const hasUploadTasks = remoteUploadTasksForCurrentPath().length > 0;
  if (!remoteExplorerState.items.length && !hasUploadTasks) {
    grid.innerHTML = '<div class="remote-explorer-empty">No files or folders matched this period.</div>';
    return;
  }

  const groups = {today: [], week: [], month: [], older: [], unknown: []};
  remoteExplorerState.items.forEach(item => {
    groups[remotePeriodKey(item.mtime_epoch)].push(item);
  });

  grid.innerHTML = renderRemoteExplorerGroups(groups);
  bindRemoteExplorerInteractions(grid);
}

function renderRemoteExplorerGroups(groups) {
  const renderer = remoteViewMode() === 'list' ? remoteListGroupTemplate : remoteGridGroupTemplate;
  const uploads = remoteUploadGroupTemplate();
  const files = Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([key, items]) => renderer(key, items))
    .join('');
  return uploads + files;
}

function remoteUploadTasksForCurrentPath() {
  const current = normalizeRemotePath(remoteExplorerState.path || transferState.current || transferState.home || '');
  return (uploadTasks || []).filter(task => {
    const destination = normalizeRemotePath(task.remotePath || '');
    return destination && current && destination === current && task.status !== 'cleared';
  });
}

function remoteUploadGroupTemplate() {
  const tasks = remoteUploadTasksForCurrentPath();
  if (!tasks.length) return '';
  const listMode = remoteViewMode() === 'list';
  return `
    <section class="remote-period-group remote-upload-group">
      <div class="remote-period-title">Importing</div>
      ${listMode
        ? `<div class="remote-list-table remote-upload-table">${tasks.map(remoteUploadListRowTemplate).join('')}</div>`
        : `<div class="remote-tile-grid">${tasks.map(remoteUploadTileTemplate).join('')}</div>`}
    </section>
  `;
}

function remoteUploadPercent(task) {
  if (task.status === 'done') return 100;
  if (task.status === 'error') return 100;
  const reported = Number(task.progress || 0);
  if (reported > 0) return Math.max(5, Math.min(95, Math.round(reported)));
  const elapsed = Math.max(0, Date.now() - Number(task.startedAt || Date.now()));
  return Math.max(12, Math.min(88, Math.round(18 + elapsed / 900)));
}

function remoteUploadStatusText(task) {
  if (task.status === 'done') return 'Import completed';
  if (task.status === 'error') return task.error || 'Import failed';
  return 'Uploading...';
}

function remoteUploadListRowTemplate(task) {
  const pct = remoteUploadPercent(task);
  return `
    <div class="remote-list-row remote-tile remote-upload-placeholder ${esc(task.status || 'running')}">
      <span class="remote-list-name">
        <span class="remote-list-icon">${remoteIcon('directory')}</span>
        <span class="remote-list-copy">
          <span class="remote-list-title" title="${esc(task.localPath || task.name)}">${esc(task.name || 'Folder')}</span>
          <span class="remote-list-path">${esc(remoteUploadStatusText(task))}</span>
        </span>
      </span>
      <span class="remote-list-cell">${esc(task.status === 'done' ? 'Ready' : 'Pending')}</span>
      <span class="remote-list-cell">Folder</span>
      <span class="remote-list-cell">${pct}%</span>
      <span></span>
      <i class="remote-upload-progress" style="--upload-progress:${pct}%"></i>
    </div>
  `;
}

function remoteUploadTileTemplate(task) {
  const pct = remoteUploadPercent(task);
  return `
    <div class="remote-tile directory remote-upload-placeholder ${esc(task.status || 'running')}">
      <span class="remote-tile-icon">${remoteIcon('directory')}</span>
      <span class="remote-tile-name" title="${esc(task.localPath || task.name)}">${esc(task.name || 'Folder')}</span>
      <span class="remote-tile-meta">${esc(remoteUploadStatusText(task))}</span>
      <i class="remote-upload-progress" style="--upload-progress:${pct}%"></i>
    </div>
  `;
}

function refreshRemoteUploadPlaceholders() {
  if (!remoteExplorerState.loaded) return;
  renderRemoteExplorer({
    ok: true,
    error: '',
    path: remoteExplorerState.path,
    home: remoteExplorerState.home || transferState.home,
    period: remoteExplorerState.period,
    items: remoteExplorerState.items || [],
  });
}

function bindRemoteExplorerInteractions(grid) {
  grid.querySelectorAll('.remote-tile').forEach(tile => {
    if (tile.classList.contains('remote-upload-placeholder')) return;
    tile.addEventListener('click', () => {
      const path = tile.getAttribute('data-path') || '';
      const kind = tile.getAttribute('data-kind') || '';
      selectDownloadPath(path, kind);
      renderRemoteExplorer({
        ok: true,
        error: '',
        path: remoteExplorerState.path,
        home: remoteExplorerState.home || transferState.home,
        period: remoteExplorerState.period,
        items: remoteExplorerState.items,
      });
    });
    tile.addEventListener('dblclick', ev => {
      const path = tile.getAttribute('data-path') || '';
      const kind = tile.getAttribute('data-kind') || '';
      if (kind === 'directory' && path) {
        ev.preventDefault();
        closeRemoteTileMenus();
        loadRemoteExplorer(path, undefined, {pushHistory: true});
      } else if (path) {
        ev.preventDefault();
        closeRemoteTileMenus();
        openRemoteEdit(path);
      }
    });
    tile.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') tile.click();
    });
  });
  grid.querySelectorAll('[data-remote-menu]').forEach(btn => {
    const toggle = ev => {
      ev.stopPropagation();
      const tile = btn.closest('.remote-tile');
      const open = tile?.classList.contains('menu-open');
      closeRemoteTileMenus();
      if (tile && !open) tile.classList.add('menu-open');
    };
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') toggle(ev);
      if (ev.key === 'Escape') closeRemoteTileMenus();
    });
  });
  grid.querySelectorAll('[data-remote-action]').forEach(btn => {
    const run = ev => {
      ev.stopPropagation();
      const path = btn.getAttribute('data-path') || '';
      const name = btn.getAttribute('data-name') || path;
      const kind = btn.getAttribute('data-kind') || '';
      const action = btn.getAttribute('data-remote-action');
      closeRemoteTileMenus();
      if (action === 'download') downloadRemoteItemFromBrowser(path, kind);
      if (action === 'import') openImportModal(path);
      if (action === 'edit') openRemoteEdit(path);
      if (action === 'delete') openRemoteDelete(path, name);
    };
    btn.addEventListener('click', run);
    btn.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') run(ev);
    });
  });
}

function remoteGridGroupTemplate(key, items) {
  return `
    <section class="remote-period-group">
      <div class="remote-period-title">${esc(remotePeriodLabel(key))}</div>
      <div class="remote-tile-grid">
        ${items.map(item => remoteTileTemplate(item)).join('')}
      </div>
    </section>
  `;
}

function remoteListGroupTemplate(key, items) {
  return `
    <section class="remote-period-group">
      <div class="remote-period-title">${esc(remotePeriodLabel(key))}</div>
      <div class="remote-list-table">
        <div class="remote-list-head" aria-hidden="true">
          <span>Name</span>
          <span>Size</span>
          <span>Type</span>
          <span>Modified</span>
          <span></span>
        </div>
        ${items.map(item => remoteListRowTemplate(item)).join('')}
      </div>
    </section>
  `;
}

function remoteListRowTemplate(item) {
  const kind = item.kind || 'other';
  const selected = sameRemotePath(item.path, transferState.selectedPath);
  return `
    <div class="remote-list-row remote-tile ${esc(kind)} ${selected ? 'selected' : ''}" role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}" data-path="${esc(item.path)}" data-kind="${esc(kind)}">
      <span class="remote-list-name">
        <span class="remote-list-icon">${remoteIcon(kind)}</span>
        <span class="remote-list-copy">
          <span class="remote-list-title" title="${esc(item.name || item.path)}">${esc(item.name || item.path)}</span>
          <span class="remote-list-path">${esc(remoteDisplayPath(item))}</span>
        </span>
      </span>
      <span class="remote-list-cell">${esc(remoteItemSubtitle(item))}</span>
      <span class="remote-list-cell">${esc(remoteItemTypeLabel(item))}</span>
      <span class="remote-list-cell">${esc(remoteModifiedLabel(item))}</span>
      <span class="remote-list-actions remote-tile-actions">${remoteTileActionsTemplate(item)}</span>
    </div>
  `;
}

function remoteTileActionsTemplate(item) {
  const kind = item.kind || 'other';
  const isDir = !!item.is_dir;
  return `
    <button class="remote-tile-action remote-tile-menu-trigger" type="button" data-remote-menu data-path="${esc(item.path)}" aria-label="Open actions for ${esc(item.name || item.path)}" title="Actions">${actionIcon('menu')}</button>
    <span class="remote-tile-menu" role="menu" aria-label="Actions for ${esc(item.name || item.path)}">
      <button type="button" role="menuitem" data-remote-action="download" data-path="${esc(item.path)}" data-kind="${esc(kind)}" data-name="${esc(item.name)}">${actionIcon('download')}<span>Download</span></button>
      ${isDir ? `<button type="button" role="menuitem" data-remote-action="import" data-path="${esc(item.path)}" data-kind="${esc(kind)}" data-name="${esc(item.name)}">${actionIcon('import')}<span>Importar</span></button>` : ''}
      ${!isDir ? `<button type="button" role="menuitem" data-remote-action="edit" data-path="${esc(item.path)}" data-kind="${esc(kind)}" data-name="${esc(item.name)}">${actionIcon('edit')}<span>Edit</span></button>` : ''}
      <button type="button" role="menuitem" class="danger" data-remote-action="delete" data-path="${esc(item.path)}" data-kind="${esc(kind)}" data-name="${esc(item.name)}">${actionIcon('delete')}<span>Delete</span></button>
    </span>
  `;
}

function remoteTileTemplate(item) {
  const kind = item.kind || 'other';
  const selected = sameRemotePath(item.path, transferState.selectedPath);
  return `
    <div class="remote-tile ${esc(kind)} ${selected ? 'selected' : ''}" role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}" data-path="${esc(item.path)}" data-kind="${esc(kind)}">
      <span class="remote-tile-icon">${remoteIcon(kind)}</span>
      <span class="remote-tile-name" title="${esc(item.name || item.path)}">${esc(item.name || item.path)}</span>
      <span class="remote-tile-meta">${esc(remoteItemSubtitle(item))}</span>
      <span class="remote-tile-actions">${remoteTileActionsTemplate(item)}</span>
    </div>
  `;
}

function closeRemoteTileMenus() {
  document.querySelectorAll('.remote-tile.menu-open').forEach(tile => tile.classList.remove('menu-open'));
}

function loadRemoteExplorer(path, period, options = {}) {
  const target = path ?? $('remote-visual-path')?.value.trim() ?? transferState.home ?? '~';
  const selectedPeriod = period ?? $('remote-period')?.value ?? remoteExplorerState.period ?? 'all';
  const status = $('remote-visual-status');
  const key = remoteExplorerKey(target, selectedPeriod);
  if (options.pushHistory && remoteExplorerState.path && remoteExplorerState.path !== target) {
    remoteExplorerState.history = [...remoteExplorerState.history, remoteExplorerState.path].slice(-30);
    if (!options.keepFuture) remoteExplorerState.future = [];
    updateRemoteBackState();
  }
  if (!options.force && remoteExplorerCache.has(key)) {
    renderRemoteExplorer(remoteExplorerCache.get(key));
    return Promise.resolve(remoteExplorerCache.get(key));
  }
  if (status) {
    status.className = 'remote-explorer-status';
    status.textContent = 'Loading remote folder...';
  }
  return apiFetch('/api/remote/explorer?path=' + encodeURIComponent(target || '~') + '&period=' + encodeURIComponent(selectedPeriod))
    .then(response => response.json())
    .then(data => {
      renderRemoteExplorer(data);
      return data;
    })
    .catch(err => {
      if (status) {
        status.className = 'remote-explorer-status error';
        status.textContent = err?.message || 'Could not reach remote explorer.';
      }
      throw err;
    });
}

function remoteExplorerBack() {
  const previous = remoteExplorerState.history.pop();
  if (previous && remoteExplorerState.path) {
    remoteExplorerState.future = [...remoteExplorerState.future, remoteExplorerState.path].slice(-30);
  }
  updateRemoteBackState();
  if (previous) loadRemoteExplorer(previous, $('remote-period')?.value || 'all', {force: false, keepFuture: true});
}

function remoteExplorerForward() {
  const next = remoteExplorerState.future.pop();
  if (next && remoteExplorerState.path) {
    remoteExplorerState.history = [...remoteExplorerState.history, remoteExplorerState.path].slice(-30);
  }
  updateRemoteBackState();
  if (next) loadRemoteExplorer(next, $('remote-period')?.value || 'all', {force: false, keepFuture: true});
}

function remoteExplorerHome() {
  loadRemoteExplorer(transferState.home || remoteExplorerState.home || '~', $('remote-period')?.value || 'all', {pushHistory: true});
}

function ensureRemoteExplorerReady(force = false) {
  const home = String(transferState.home || '').trim().replace(/\/+$/, '');
  if (!home || !$('remote-visual-grid')) return;
  if ($('remote-visual-path') && (!$('remote-visual-path').value.trim() || force)) {
    $('remote-visual-path').value = home;
  }
  updateRemoteBackState();
  if (!remoteExplorerState.loaded || force) loadRemoteExplorer($('remote-visual-path').value || home, undefined, {force});
}

function openRemoteDelete(path, name) {
  remoteExplorerState.deletePath = path;
  const copy = $('remote-delete-copy');
  if (copy) copy.textContent = `Delete "${name || path}" from Apuana? This action cannot be undone.`;
  const modal = $('remote-delete-modal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeRemoteDelete() {
  remoteExplorerState.deletePath = '';
  const modal = $('remote-delete-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function confirmRemoteDelete() {
  const path = remoteExplorerState.deletePath;
  if (!path) return;
  const confirm = $('remote-delete-confirm');
  if (confirm) confirm.disabled = true;
  const currentPath = remoteExplorerState.path || transferState.home;
  const currentPeriod = remoteExplorerState.period || $('remote-period')?.value || 'all';
  closeRemoteDelete();
  removeRemoteItemOptimistically(path);
  setRemoteExplorerStatus('', 'Deleting remote item...');
  try {
    const response = await apiFetch('/api/remote/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Delete failed.');
    remoteExplorerCache.clear();
    setRemoteExplorerStatus('ok', 'Remote item deleted.');
    loadRemoteExplorer(currentPath, currentPeriod, {force: true});
  } catch (err) {
    remoteExplorerCache.clear();
    try {
      await loadRemoteExplorer(currentPath, currentPeriod, {force: true});
    } catch (_) {
      // Keep the delete error below as the most useful feedback.
    }
    setRemoteExplorerStatus('error', err?.message || 'Could not delete this item.');
  } finally {
    if (confirm) confirm.disabled = false;
  }
}

async function openRemoteEdit(path) {
  remoteExplorerState.editPath = path;
  const modal = $('remote-edit-modal');
  const status = $('remote-edit-status');
  const title = $('remote-edit-path');
  const editor = $('remote-edit-content');
  if (title) title.textContent = path;
  if (editor) editor.value = '';
  if (status) {
    status.className = 'remote-edit-status';
    status.textContent = 'Loading file...';
  }
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
  try {
    const response = await apiFetch('/api/remote/file?path=' + encodeURIComponent(path));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not read file.');
    if (editor) {
      editor.value = data.content || '';
      editor.focus();
    }
    if (status) {
      status.className = 'remote-edit-status';
      status.textContent = '';
    }
  } catch (err) {
    if (status) {
      status.className = 'remote-edit-status error';
      status.textContent = err?.message || 'Could not load file.';
    }
  }
}

function closeRemoteEdit() {
  remoteExplorerState.editPath = '';
  const modal = $('remote-edit-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function saveRemoteEdit() {
  const path = remoteExplorerState.editPath;
  const status = $('remote-edit-status');
  const save = $('remote-edit-save');
  if (!path) return;
  if (status) {
    status.className = 'remote-edit-status';
    status.textContent = 'Saving file...';
  }
  if (save) save.disabled = true;
  try {
    const response = await apiFetch('/api/remote/file', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path, content: $('remote-edit-content')?.value || ''}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not save file.');
    if (status) {
      status.className = 'remote-edit-status ok';
      status.textContent = `${data.bytes || 0} byte(s) saved.`;
    }
    remoteExplorerCache.clear();
    loadRemoteExplorer(remoteExplorerState.path || transferState.home, undefined, {force: true});
  } catch (err) {
    if (status) {
      status.className = 'remote-edit-status error';
      status.textContent = err?.message || 'Could not save file.';
    }
  } finally {
    if (save) save.disabled = false;
  }
}
