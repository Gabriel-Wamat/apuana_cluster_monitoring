function codeTreeKey(root) {
  return String(root || '');
}

const CODE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'apuana.codeSidebar.collapsed';

function codeWorkspaceElement() {
  return document.querySelector('#view-code .code-workspace');
}

function applyCodeSidebarCollapsed(collapsed, persist = true) {
  const isCollapsed = !!collapsed;
  const workspace = codeWorkspaceElement();
  const button = $('code-sidebar-collapse');
  if (workspace) workspace.classList.toggle('code-sidebar-collapsed', isCollapsed);
  if (button) {
    button.setAttribute('aria-pressed', isCollapsed ? 'true' : 'false');
    button.setAttribute('aria-label', isCollapsed ? 'Expand code sidebar' : 'Collapse code sidebar');
    button.setAttribute('title', isCollapsed ? 'Expand code sidebar' : 'Collapse code sidebar');
  }
  if (persist) {
    try {
      localStorage.setItem(CODE_SIDEBAR_COLLAPSED_STORAGE_KEY, isCollapsed ? '1' : '0');
    } catch (_) {
      // Preference persistence is best-effort only.
    }
  }
  requestAnimationFrame(() => {
    codeMonacoEditor?.layout?.();
    if (typeof scheduleCodeTerminalResize === 'function') scheduleCodeTerminalResize();
  });
}

function initCodeSidebarCollapse() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(CODE_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch (_) {
    collapsed = false;
  }
  applyCodeSidebarCollapsed(collapsed, false);
}

function toggleCodeSidebarCollapse() {
  const workspace = codeWorkspaceElement();
  applyCodeSidebarCollapsed(!workspace?.classList.contains('code-sidebar-collapsed'));
}

function codeShortPath(path) {
  const value = String(path || '').replace(/\/+$/, '') || '/';
  const home = String(codeState.project || transferState.home || '').replace(/\/+$/, '');
  if (home && value === home) return '~';
  if (home && value.startsWith(home + '/')) return '~/' + value.slice(home.length + 1);
  return value;
}

function normalizeCodeBrowserItem(item) {
  const kind = normalizeCodeKind(item);
  const absPath = item.abs_path || item.absPath || item.path || '';
  return {
    ...item,
    kind,
    absPath,
    language: item.language || '',
    sizeHuman: item.size_human || item.sizeHuman || '',
  };
}

function codeIcon(kind, language) {
  if (kind === 'directory' || kind === 'dir') {
    return '<svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
  }
  if (language === 'image') {
    return '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="m5 17 4.5-5 3.5 4 2-2.5L20 18"/><circle cx="9" cy="8" r="1.5"/></svg>';
  }
  if (language === 'python') {
    return '<svg viewBox="0 0 24 24"><path d="M8 8h8v4H9a3 3 0 0 0-3 3v1"/><path d="M16 16H8v-4h7a3 3 0 0 0 3-3V8"/><circle cx="9" cy="6" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

const CODE_LANGUAGE_BADGES = {
  bash: { symbol: '$', label: 'Bash', tone: 'shell' },
  c: { symbol: 'C', label: 'C', tone: 'code' },
  code: { symbol: '</>', label: 'Code', tone: 'code' },
  cpp: { symbol: 'C++', label: 'C++', tone: 'code' },
  css: { symbol: '#', label: 'CSS', tone: 'css' },
  html: { symbol: '<>', label: 'HTML', tone: 'html' },
  image: { symbol: 'IMG', label: 'Image', tone: 'image' },
  java: { symbol: 'Jv', label: 'Java', tone: 'code' },
  javascript: { symbol: 'JS', label: 'JavaScript', tone: 'js' },
  js: { symbol: 'JS', label: 'JavaScript', tone: 'js' },
  json: { symbol: '{}', label: 'JSON', tone: 'json' },
  jsx: { symbol: '<>', label: 'JSX', tone: 'tsx' },
  latex: { symbol: 'TeX', label: 'LaTeX', tone: 'latex' },
  markdown: { symbol: 'MD', label: 'Markdown', tone: 'markdown' },
  md: { symbol: 'MD', label: 'Markdown', tone: 'markdown' },
  py: { symbol: 'Py', label: 'Python', tone: 'python' },
  python: { symbol: 'Py', label: 'Python', tone: 'python' },
  r: { symbol: 'R', label: 'R', tone: 'code' },
  sh: { symbol: '$', label: 'Shell', tone: 'shell' },
  shell: { symbol: '$', label: 'Shell', tone: 'shell' },
  sql: { symbol: 'DB', label: 'SQL', tone: 'sql' },
  text: { symbol: 'T', label: 'Text', tone: 'text' },
  tex: { symbol: 'TeX', label: 'LaTeX', tone: 'latex' },
  ts: { symbol: 'TS', label: 'TypeScript', tone: 'ts' },
  tsx: { symbol: '<>', label: 'TSX', tone: 'tsx' },
  typescript: { symbol: 'TS', label: 'TypeScript', tone: 'ts' },
  yaml: { symbol: 'Y', label: 'YAML', tone: 'yaml' },
  yml: { symbol: 'Y', label: 'YAML', tone: 'yaml' },
};

function codeLanguageBadge(language, path = '') {
  const languageKey = String(language || '').toLowerCase();
  const filename = String(path || '').toLowerCase();
  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  return CODE_LANGUAGE_BADGES[languageKey] || CODE_LANGUAGE_BADGES[ext] || CODE_LANGUAGE_BADGES.text;
}

function setCodeLanguagePill(language, path = '') {
  const pill = $('code-language-pill');
  if (!pill) return;
  const badge = codeLanguageBadge(language, path);
  const symbol = document.createElement('span');
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = badge.symbol;
  pill.className = `code-language-pill is-${badge.tone}`;
  pill.title = badge.label;
  pill.setAttribute('aria-label', badge.label);
  pill.replaceChildren(symbol);
}

function codeChevron(node, expanded) {
  if (node.kind !== 'dir') return '<span class="code-tree-chevron spacer"></span>';
  return `<span class="code-tree-chevron ${expanded ? 'expanded' : ''}">
    <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
  </span>`;
}

const CODE_TREE_INDENT_STEP = 10;
const CODE_TREE_MAX_INDENT_DEPTH = 7;

function codeRowHtml(node, filtered = false, depth = 0) {
  const expanded = filtered || codeExpandedPaths.has(node.absPath);
  const sub = filtered
    ? node.path
    : node.kind === 'dir' ? 'Folder' : `${node.language || 'text'} · ${node.sizeHuman || ''}`;
  const visualDepth = Math.min(Math.max(Number(depth) || 0, 0), CODE_TREE_MAX_INDENT_DEPTH);
  const indent = visualDepth * CODE_TREE_INDENT_STEP;
  return `
    <div class="code-tree-row ${node.kind === 'dir' ? 'folder' : 'file'} ${expanded ? 'expanded' : ''} ${node.absPath === codeState.activePath ? 'active' : ''}"
      role="button"
      tabindex="0"
      style="--tree-indent:${indent}px"
      data-depth="${esc(String(depth))}"
      data-path="${esc(node.absPath)}"
      data-kind="${esc(node.kind)}">
      ${codeChevron(node, expanded)}
      <span class="code-tree-icon ${esc(node.language || node.kind)}">${codeIcon(node.kind, node.language)}</span>
      <span class="code-tree-main">
        <span class="code-tree-name" title="${esc(node.absPath)}">${esc(node.name)}</span>
        <span class="code-tree-sub">${esc(sub)}</span>
      </span>
      <span class="code-tree-actions">
        <button class="code-tree-action code-tree-delete" type="button" aria-label="Delete ${esc(node.name)}" title="Delete" data-path="${esc(node.absPath)}" data-kind="${esc(node.kind)}" data-name="${esc(node.name)}">
          <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </span>
    </div>
  `;
}

function codeRowsHtml(nodes, depth = 0, filtered = false) {
  const nestedClass = depth > 0 ? ' nested' : '';
  return `<ul class="code-tree-list${nestedClass}" data-depth="${esc(String(depth))}">` + (nodes || []).map(node => {
    const expanded = filtered || codeExpandedPaths.has(node.absPath);
    const children = node.kind === 'dir' && expanded && node.children?.length
      ? codeRowsHtml(node.children, depth + 1, filtered)
      : '';
    return `<li>${codeRowHtml(node, filtered, depth)}${children}</li>`;
  }).join('') + '</ul>';
}

function visibleCodeTree() {
  return filterCodeTree(codeState.tree || [], codeState.query || '');
}

function bindCodeTreeRows() {
  const tree = $('code-file-tree');
  if (!tree) return;
  tree.querySelectorAll('.code-tree-delete').forEach(button => {
    button.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      openCodeDeleteModal(
        button.getAttribute('data-path') || '',
        button.getAttribute('data-kind') || '',
        button.getAttribute('data-name') || ''
      );
    });
  });
  tree.querySelectorAll('.code-tree-row').forEach(row => {
    const activate = () => {
      const path = row.getAttribute('data-path') || '';
      const kind = row.getAttribute('data-kind') || '';
      if (kind === 'dir') toggleCodeFolder(path);
      else openCodeFile(path);
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', ev => {
      if (ev.target?.closest?.('.code-tree-action')) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
  });
}

function renderCodeTreeView() {
  const tree = $('code-file-tree');
  if (!tree) return;
  if (!codeTreeActivated) {
    renderCodeFolderSelect();
    tree.innerHTML = '';
    return;
  }
  const nodes = visibleCodeTree();
  renderCodeFolderSelect();
  if (!nodes.length) {
    tree.innerHTML = `<div class="code-tree-empty">${esc(codeState.query ? 'No code files or folders matched this search.' : 'No code files in this folder.')}</div>`;
    return;
  }
  tree.innerHTML = codeRowsHtml(nodes, 0, !!codeState.query);
  bindCodeTreeRows();
}

function setCodeTreePayload(data) {
  const root = data.root || codeState.path || data.home || codeState.project || transferState.home || '';
  codeState = {
    ...codeState,
    project: data.home || codeState.project || root,
    path: root,
    parent: root && data.home && root !== data.home ? root.split('/').slice(0, -1).join('/') : data.home || codeState.project,
    entries: data.entries || [],
    tree: buildCodeTree(data.entries || [], root),
    loaded: true,
    loading: false,
  };
  codeTreeCache.set(codeTreeKey(root), data);
  codeLoadedFolderPaths.add(root);
  renderCodeTreeView();
}

function codeFolderItemsAsEntries(items, root) {
  const base = String(root || '').replace(/\/+$/, '');
  return (items || []).map(item => {
    const absPath = item.abs_path || item.path || '';
    return {
      ...item,
      abs_path: absPath,
      path: absPath === base ? '' : absPath.slice(base.length + 1),
      kind: item.is_dir || item.kind === 'directory' || item.kind === 'dir' ? 'dir' : 'file',
    };
  }).filter(item => item.path);
}

async function loadCodeTree(options = {}) {
  const root = options.root || codeState.path || codeState.project || transferState.home || '';
  const key = codeTreeKey(root);
  const seq = ++codeRequestSeq;
  if (!options.force && codeTreeCache.has(key)) {
    setCodeTreePayload(codeTreeCache.get(key));
    return;
  }
  const tree = $('code-file-tree');
  if (tree) tree.innerHTML = '<div class="code-tree-empty">Loading code tree...</div>';
  try {
    const response = await apiFetch('/api/code/folders?path=' + encodeURIComponent(root));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load code tree.');
    if (seq !== codeRequestSeq) return;
    setCodeTreePayload({...data, root, entries: codeFolderItemsAsEntries(data.items, root), truncated: false});
  } catch (err) {
    if (seq !== codeRequestSeq) return;
    if (tree) tree.innerHTML = `<div class="alert a-danger">${esc(err?.message || 'Could not load code tree.')}</div>`;
  }
}

function setCodeFolderPayload(data) {
  codeFolderState = {
    path: data.path || codeState.path || codeState.project || transferState.home || '',
    items: (data.items || []).map(normalizeCodeBrowserItem),
    loading: false,
    error: '',
  };
  codeFolderCache.set(codeTreeKey(codeFolderState.path), data);
  renderCodeFolderMenu();
}

async function loadCodeFolderMenuItems(path, force = false) {
  const target = path || codeState.path || codeState.project || transferState.home || '';
  const key = codeTreeKey(target);
  const seq = ++codeFolderRequestSeq;
  if (!force && codeFolderCache.has(key)) {
    setCodeFolderPayload(codeFolderCache.get(key));
    return;
  }
  codeFolderState = {path: target, items: [], loading: true, error: ''};
  renderCodeFolderMenu();
  try {
    const response = await apiFetch('/api/code/folders?path=' + encodeURIComponent(target));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not list folders.');
    if (seq !== codeFolderRequestSeq) return;
    setCodeFolderPayload(data);
  } catch (err) {
    if (seq !== codeFolderRequestSeq) return;
    codeFolderState = {
      path: target,
      items: [],
      loading: false,
      error: err?.message || 'Could not list folders.',
    };
    renderCodeFolderMenu();
  }
}

async function loadCodeProjects(force = false) {
  if (codeState.projects.length && !force) return true;
  const tree = $('code-file-tree');
  if (tree && codeTreeActivated) tree.innerHTML = '<div class="code-tree-empty">Loading workspace...</div>';
  try {
    const response = await apiFetch('/api/code/projects');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load workspace.');
    codeState.projects = data.projects || [];
    codeState.project = codeState.project || data.home || codeState.projects[0]?.path || transferState.home || '';
    codeState.path = codeState.path || codeState.project;
    renderCodeFolderSelect();
    renderCodeTreeView();
    return true;
  } catch (err) {
    if (tree) tree.innerHTML = `<div class="alert a-danger">${esc(err?.message || 'Could not load workspace.')}</div>`;
    return false;
  }
}

async function loadCodeList(options = {}) {
  if (options.query !== undefined) {
    codeState.query = String(options.query || '').trim();
    renderCodeTreeView();
    return;
  }
  if (!codeTreeActivated) {
    renderCodeTreeView();
    return;
  }
  await loadCodeTree({root: options.path || options.root || codeState.path || codeState.project, force: !!options.force});
}

async function ensureCodeReady() {
  const ok = await loadCodeProjects(false);
  if (ok && codeTreeActivated && !codeState.loaded) await loadCodeTree({root: codeState.path || codeState.project, force: false});
  renderCodeTreeView();
  renderCodeTabs();
}

function openCodeFolder(path, options = {}) {
  if (!path) return;
  codeTreeActivated = true;
  codeState.path = path;
  codeState.query = '';
  if ($('code-search')) $('code-search').value = '';
  codeExpandedPaths.clear();
  codeLoadedFolderPaths.clear();
  closeCodeFolderMenu();
  loadCodeTree({root: path, force: false});
}

async function toggleCodeFolder(path) {
  if (!path) return;
  if (codeExpandedPaths.has(path)) {
    codeExpandedPaths.delete(path);
    renderCodeTreeView();
    return;
  }
  codeExpandedPaths.add(path);
  renderCodeTreeView();
  if (codeLoadedFolderPaths.has(path)) return;
  try {
    const response = await apiFetch('/api/code/folders?path=' + encodeURIComponent(path));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load folder.');
    const root = codeState.path || codeState.project || transferState.home || '';
    const incoming = codeFolderItemsAsEntries(data.items, root);
    const known = new Set((codeState.entries || []).map(entry => entry.abs_path || entry.absPath));
    syncCodeTreeFromEntries(root, [...(codeState.entries || []), ...incoming.filter(entry => !known.has(entry.abs_path))]);
    codeLoadedFolderPaths.add(path);
  } catch (err) {
    codeExpandedPaths.delete(path);
    const tree = $('code-file-tree');
    if (tree) tree.insertAdjacentHTML('afterbegin', `<div class="alert a-danger">${esc(err?.message || 'Could not load folder.')}</div>`);
  }
}

function codeUpFolder() {
  if (!codeTreeActivated) return;
  const home = (codeState.project || transferState.home || '').replace(/\/+$/, '');
  const current = (codeState.path || home).replace(/\/+$/, '');
  if (!home || current === home) {
    openCodeFolder(home);
    return;
  }
  const parent = current.split('/').slice(0, -1).join('/') || home;
  openCodeFolder(parent.startsWith(home) ? parent : home);
}

function currentCodeFolderNodes() {
  const current = codeState.path || codeState.project || transferState.home || '';
  const source = codeFolderState.path === current ? codeFolderState.items : [];
  return source.slice().sort((a, b) => {
    const rank = codeSortRank(a) - codeSortRank(b);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, 'pt-BR', {sensitivity: 'base'});
  });
}

function renderCodeFolderSelect() {
  const label = $('code-folder-select-label');
  if (label) label.textContent = codeShortPath(codeState.path || codeState.project || transferState.home || '-');
  const button = $('code-folder-select');
  if (button) button.setAttribute('aria-expanded', codeFolderMenuOpen ? 'true' : 'false');
  renderCodeFolderMenu();
}

function renderCodeFolderMenu() {
  const menu = $('code-folder-menu');
  if (!menu) return;
  menu.classList.toggle('open', codeFolderMenuOpen);
  menu.setAttribute('aria-hidden', codeFolderMenuOpen ? 'false' : 'true');
  if (!codeFolderMenuOpen) return;

  const items = currentCodeFolderNodes();
  const current = codeState.path || codeState.project || '';
  const home = codeState.project || transferState.home || '';
  const atHome = current.replace(/\/+$/, '') === home.replace(/\/+$/, '');
  let rows = '';
  if (codeFolderState.loading) {
    rows = '<div class="code-picker-empty">Loading folders...</div>';
  } else if (codeFolderState.error) {
    rows = `<div class="code-picker-empty">${esc(codeFolderState.error)}</div>`;
  } else {
    rows = items.length ? items.map(node => `
    <button class="code-picker-row ${node.kind === 'dir' ? 'folder' : 'file'}" type="button" data-path="${esc(node.absPath)}" data-kind="${esc(node.kind)}">
      <span class="code-tree-icon ${esc(node.language || node.kind)}">${codeIcon(node.kind, node.language)}</span>
      <span class="code-picker-main">
        <span class="code-picker-name">${esc(node.name)}</span>
        <span class="code-picker-sub">${esc(node.kind === 'dir' ? 'Folder' : `${node.language || 'text'} · ${node.sizeHuman || ''}`)}</span>
      </span>
    </button>
  `).join('') : '<div class="code-picker-empty">No folders or code files here.</div>';
  }

  menu.innerHTML = `
    <div class="code-picker-head">
      <button class="icon-btn" id="code-picker-up" type="button" title="Up folder" aria-label="Up folder" ${atHome ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
      </button>
      <span title="${esc(current)}">${esc(codeShortPath(current))}</span>
    </div>
    <div class="code-picker-list">${rows}</div>
  `;

  $('code-picker-up')?.addEventListener('click', ev => {
    ev.stopPropagation();
    codeUpFolder();
  });
  menu.querySelectorAll('.code-picker-row').forEach(row => {
    row.addEventListener('click', ev => {
      ev.stopPropagation();
      const path = row.getAttribute('data-path') || '';
      const kind = row.getAttribute('data-kind') || '';
      if (kind === 'dir') openCodeFolder(path);
      else {
        closeCodeFolderMenu();
        openCodeFile(path);
      }
    });
  });
}

function openCodeFolderMenu() {
  codeFolderMenuOpen = true;
  renderCodeFolderSelect();
  loadCodeFolderMenuItems(codeState.path || codeState.project || transferState.home || '');
}

function closeCodeFolderMenu() {
  if (!codeFolderMenuOpen) return;
  codeFolderMenuOpen = false;
  renderCodeFolderSelect();
}

function toggleCodeFolderMenu() {
  codeFolderMenuOpen ? closeCodeFolderMenu() : openCodeFolderMenu();
}

function scheduleCodeSearch() {
  if (codeSearchTimer) clearTimeout(codeSearchTimer);
  codeSearchTimer = setTimeout(() => {
    codeSearchTimer = null;
    codeState.query = $('code-search')?.value.trim() || '';
    renderCodeTreeView();
  }, 120);
}

function clearCodeBrowserCaches() {
  codeListCache.clear();
  codeTreeCache.clear();
  codeFolderCache.clear();
}

function codeCurrentFolder() {
  return codeState.path || codeState.project || transferState.home || '';
}

function codeLanguageFromName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.tex')) return 'latex';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (/\.(c|cc|cpp|h|hpp|cu)$/.test(lower)) return 'cpp';
  if (lower === 'makefile') return 'makefile';
  if (lower === 'dockerfile') return 'dockerfile';
  return 'text';
}

function createdCodeEntry(item, root) {
  const absPath = String(item?.path || '').replace(/\/+$/, '');
  const rootPath = String(root || '').replace(/\/+$/, '');
  if (!absPath || !rootPath || (absPath !== rootPath && !absPath.startsWith(rootPath + '/'))) return null;
  const relative = absPath === rootPath ? '' : absPath.slice(rootPath.length + 1);
  if (!relative) return null;
  const isDir = item.kind === 'dir' || item.kind === 'directory' || item.kind === 'folder';
  const name = String(item.name || relative.split('/').pop() || '');
  return {
    name,
    path: relative,
    abs_path: absPath,
    kind: isDir ? 'dir' : 'file',
    is_dir: isDir,
    is_file: !isDir,
    language: isDir ? '' : codeLanguageFromName(name),
    size: 0,
    size_human: isDir ? '' : '0 B',
    mtime_epoch: Math.floor(Date.now() / 1000),
  };
}

function updateCodeTreeCache(root, entries) {
  if (!root) return;
  codeTreeCache.set(codeTreeKey(root), {
    ok: true,
    root,
    home: codeState.project || transferState.home || root,
    entries,
  });
}

function syncCodeTreeFromEntries(root, entries) {
  const nextEntries = entries || [];
  codeState = {
    ...codeState,
    entries: nextEntries,
    tree: buildCodeTree(nextEntries, root),
    loaded: true,
    loading: false,
  };
  updateCodeTreeCache(root, nextEntries);
  renderCodeTreeView();
}

function ensureCreatedCodeItemVisible(item, root) {
  const entry = createdCodeEntry(item, root);
  if (!entry) return false;
  const entryPath = entry.abs_path;
  const existing = (codeState.entries || []).some(current => {
    const currentPath = current.abs_path || current.absPath || '';
    return currentPath === entryPath;
  });
  if (existing) return false;
  const entries = [...(codeState.entries || []), entry];
  syncCodeTreeFromEntries(root, entries);
  return true;
}

function removeDeletedCodeItem(path, root) {
  const deletedRoot = String(path || '').replace(/\/+$/, '');
  if (!deletedRoot) return false;
  const entries = (codeState.entries || []).filter(entry => {
    const currentPath = String(entry.abs_path || entry.absPath || '').replace(/\/+$/, '');
    return currentPath !== deletedRoot && !currentPath.startsWith(deletedRoot + '/');
  });
  if (entries.length === (codeState.entries || []).length) return false;
  syncCodeTreeFromEntries(root, entries);
  return true;
}

function syncCodeFolderItemCreate(item, folder) {
  const target = String(folder || '').replace(/\/+$/, '');
  if (!target || String(codeFolderState.path || '').replace(/\/+$/, '') !== target) return;
  const normalized = normalizeCodeBrowserItem({
    ...item,
    abs_path: item.path,
    is_dir: item.kind === 'dir',
    is_file: item.kind !== 'dir',
    size_human: item.kind === 'dir' ? '' : '0 B',
    language: item.kind === 'dir' ? '' : codeLanguageFromName(item.name),
  });
  if (codeFolderState.items.some(current => String(current.absPath || '').replace(/\/+$/, '') === String(normalized.absPath || '').replace(/\/+$/, ''))) return;
  codeFolderState = {
    ...codeFolderState,
    items: [...codeFolderState.items, normalized],
  };
  codeFolderCache.delete(codeTreeKey(target));
  if (codeFolderMenuOpen) renderCodeFolderMenu();
}

function syncCodeFolderItemDelete(path, folder) {
  const target = String(folder || '').replace(/\/+$/, '');
  const deletedRoot = String(path || '').replace(/\/+$/, '');
  if (!target || !deletedRoot || String(codeFolderState.path || '').replace(/\/+$/, '') !== target) return;
  const nextItems = codeFolderState.items.filter(item => {
    const currentPath = String(item.absPath || '').replace(/\/+$/, '');
    return currentPath !== deletedRoot && !currentPath.startsWith(deletedRoot + '/');
  });
  if (nextItems.length === codeFolderState.items.length) return;
  codeFolderState = {
    ...codeFolderState,
    items: nextItems,
  };
  codeFolderCache.delete(codeTreeKey(target));
  if (codeFolderMenuOpen) renderCodeFolderMenu();
}

function closeCodeCreateModal() {
  const modal = $('code-create-modal');
  const error = $('code-create-error');
  const confirm = $('code-create-confirm');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  codeState.createKind = '';
  if (error) error.textContent = '';
  if (confirm) confirm.disabled = false;
}

function openCodeCreateModal(kind) {
  const modal = $('code-create-modal');
  const title = $('code-create-title');
  const copy = $('code-create-copy');
  const input = $('code-create-name');
  const error = $('code-create-error');
  const confirm = $('code-create-confirm');
  if (!modal || !input) return;
  const isFolder = kind === 'folder' || kind === 'dir' || kind === 'directory';
  const root = codeCurrentFolder();
  codeState.createKind = isFolder ? 'folder' : 'file';
  if (title) title.textContent = isFolder ? 'New folder' : 'New file';
  if (copy) copy.textContent = `Create inside ${codeShortPath(root)}.`;
  if (error) error.textContent = '';
  if (confirm) confirm.disabled = false;
  input.value = '';
  input.placeholder = isFolder ? 'experiments' : 'main.py';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => input.focus(), 30);
}

async function confirmCodeCreate() {
  const input = $('code-create-name');
  const error = $('code-create-error');
  const confirm = $('code-create-confirm');
  const name = input?.value.trim() || '';
  const kind = codeState.createKind || 'file';
  const parent = codeCurrentFolder();
  if (error) error.textContent = '';
  if (!name) {
    if (error) error.textContent = 'Type a name first.';
    input?.focus();
    return;
  }
  try {
    if (confirm) confirm.disabled = true;
    const response = await apiFetch('/api/code/create', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({parent, name, kind}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not create item.');
    closeCodeCreateModal();
    codeTreeActivated = true;
    codeState.path = parent;
    if (data.kind === 'dir') codeExpandedPaths.add(data.path);
    ensureCreatedCodeItemVisible(data, parent);
    syncCodeFolderItemCreate(data, parent);
    if (data.kind !== 'dir') openCodeFile(data.path);
  } catch (err) {
    if (error) error.textContent = err?.message || 'Could not create item.';
    if (input) {
      input.setCustomValidity(err?.message || 'Could not create item.');
      input.reportValidity();
      setTimeout(() => input.setCustomValidity(''), 250);
    }
  } finally {
    if (confirm) confirm.disabled = false;
  }
}

function closeCodeDeleteModal() {
  const modal = $('code-delete-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  codeState.deletePath = '';
  codeState.deleteKind = '';
}

function closeCodeConflictModal() {
  const modal = $('code-conflict-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
  codeConflictState = null;
}

function openCodeConflictModal(conflict) {
  codeConflictState = conflict;
  const modal = $('code-conflict-modal');
  const copy = $('code-conflict-copy');
  if (copy) copy.textContent = `"${codeFileNameFromPath(conflict.path)}" changed on Apuana after it was opened. Reload the remote version or overwrite it explicitly.`;
  modal?.classList.add('open');
  modal?.setAttribute('aria-hidden', 'false');
}

async function reloadConflictedCodeFile() {
  const path = codeConflictState?.path || '';
  if (!path) return;
  try {
    const response = await apiFetch('/api/code/file?path=' + encodeURIComponent(path));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not reload file.');
    codeFileCache.set(path, data);
    codeDraftCache.set(path, data.content || '');
    codeDirtyPaths.delete(path);
    const model = codeMonacoModels.get(path);
    if (model && model.getValue() !== String(data.content || '')) model.setValue(String(data.content || ''));
    closeCodeConflictModal();
    if (codeState.activePath === path) renderCodeFile(data);
    renderCodeTabs();
  } catch (err) {
    const copy = $('code-conflict-copy');
    if (copy) copy.textContent = err?.message || 'Could not reload file.';
  }
}

function overwriteConflictedCodeFile() {
  const path = codeConflictState?.path || '';
  closeCodeConflictModal();
  if (path && codeState.activePath === path) saveActiveCodeFile({force: true});
}

function openCodeDeleteModal(path, kind, name) {
  if (!path) return;
  const modal = $('code-delete-modal');
  const copy = $('code-delete-copy');
  if (!modal) return;
  codeState.deletePath = path;
  codeState.deleteKind = kind || '';
  if (copy) copy.textContent = `Delete "${name || path}" from Apuana? This action cannot be undone.`;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

async function confirmCodeDelete() {
  const path = codeState.deletePath || '';
  if (!path) return;
  const parent = codeCurrentFolder();
  closeCodeDeleteModal();
  try {
    const response = await apiFetch('/api/code/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not delete item.');
    const deletedRoot = path.replace(/\/+$/, '');
    codeFileCache.delete(path);
    if (typeof clearRemoteImageCache === 'function') clearRemoteImageCache(path);
    codeDraftCache.delete(path);
    codeDirtyPaths.delete(path);
    [...codeMonacoModels.keys()].filter(modelPath => modelPath === deletedRoot || modelPath.startsWith(deletedRoot + '/')).forEach(disposeCodeModel);
    codeState.openFiles = codeState.openFiles.filter(file => file.path !== path && !file.path.startsWith(deletedRoot + '/'));
    if (codeState.activePath === path || codeState.activePath.startsWith(deletedRoot + '/')) {
      codeState.activePath = codeState.openFiles[codeState.openFiles.length - 1]?.path || '';
      renderCodeTabs();
      if (codeState.activePath && codeFileCache.has(codeState.activePath)) renderCodeFile(codeFileCache.get(codeState.activePath));
      else if ($('code-editor')) {
        $('code-file-title').textContent = 'Select a code file';
        $('code-file-meta').textContent = 'Choose a project folder and open a file from the left panel.';
        setCodeLanguagePill('code');
        document.querySelector('.code-editor-actions')?.remove();
        $('code-editor').innerHTML = '<div class="code-empty">No file selected.</div>';
      }
    } else {
      renderCodeTabs();
    }
    removeDeletedCodeItem(path, parent);
    syncCodeFolderItemDelete(path, parent);
  } catch (err) {
    const tree = $('code-file-tree');
    if (tree) tree.insertAdjacentHTML('afterbegin', `<div class="alert a-danger">${esc(err?.message || 'Could not delete item.')}</div>`);
  }
}

function codeFileNameFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'Code file';
}

function findCodeTreeNode(path, nodes = codeState.tree || []) {
  for (const node of nodes || []) {
    if (node.absPath === path) return node;
    const child = node.children?.length ? findCodeTreeNode(path, node.children) : null;
    if (child) return child;
  }
  return null;
}

function codeOpenFileSummary(path, data = null) {
  const cached = data || codeFileCache.get(path) || null;
  const node = findCodeTreeNode(path);
  return {
    name: cached?.name || node?.name || codeFileNameFromPath(path),
    path: cached?.path || node?.absPath || path,
    language: cached?.language || node?.language || 'text',
    size_human: cached?.size_human || node?.sizeHuman || '',
    lines: cached?.lines || 0,
  };
}

function upsertOpenCodeFile(path, data = null) {
  const summary = codeOpenFileSummary(path, data);
  const openFiles = codeState.openFiles.filter(file => file.path !== summary.path);
  codeState.openFiles = [...openFiles, summary].slice(-8);
}

function renderPendingCodeFile(path) {
  const editor = $('code-editor');
  if (!editor) return;
  const summary = codeOpenFileSummary(path);
  $('code-file-title').textContent = summary.name || 'Code file';
  $('code-file-meta').textContent = `${summary.path}${summary.size_human ? ` · ${summary.size_human}` : ''}`;
  setCodeLanguagePill(summary.language || 'text', summary.path || path);
  document.querySelector('.code-editor-actions')?.remove();
  editor.innerHTML = '<div class="code-empty code-empty-silent" aria-hidden="true"></div>';
}

async function openCodeFile(path) {
  if (!path) return;
  const seq = ++codeRequestSeq;
  const cached = codeFileCache.get(path);
  codeState.activePath = path;
  upsertOpenCodeFile(path, cached);
  renderCodeTabs();
  renderCodeTreeView();
  if (cached) {
    renderCodeFile(cached);
    return;
  }
  renderPendingCodeFile(path);
  try {
    const response = await apiFetch('/api/code/file?path=' + encodeURIComponent(path));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load file.');
    codeFileCache.set(path, data);
    upsertOpenCodeFile(path, data);
    if (seq !== codeRequestSeq || codeState.activePath !== path) {
      renderCodeTabs();
      return;
    }
    renderCodeTabs();
    renderCodeFile(data);
    renderCodeTreeView();
  } catch (err) {
    if (seq !== codeRequestSeq || codeState.activePath !== path) return;
    const editor = $('code-editor');
    if (editor) editor.innerHTML = `<div class="alert a-danger">${esc(err?.message || 'Could not load file.')}</div>`;
  }
}

function closeCodeTab(path) {
  if (codeDirtyPaths.has(path) && !window.confirm(`Discard unsaved changes in "${codeFileNameFromPath(path)}"?`)) return;
  if (codeMonacoActivePath === path) disposeCodeEditorView();
  codeState.openFiles = codeState.openFiles.filter(file => file.path !== path);
  codeViewModeByPath.delete(path);
  codeDraftCache.delete(path);
  codeDirtyPaths.delete(path);
  codeSavingPaths.delete(path);
  disposeCodeModel(path);
  if (codeState.activePath === path) {
    codeState.activePath = codeState.openFiles[codeState.openFiles.length - 1]?.path || '';
  }
  renderCodeTabs();
  if (codeState.activePath && codeFileCache.has(codeState.activePath)) {
    renderCodeFile(codeFileCache.get(codeState.activePath));
  } else if ($('code-editor')) {
    $('code-file-title').textContent = 'Select a code file';
    $('code-file-meta').textContent = 'Choose a project folder and open a file from the left panel.';
    setCodeLanguagePill('code');
    document.querySelector('.code-editor-actions')?.remove();
    $('code-editor').innerHTML = '<div class="code-empty">No file selected.</div>';
  }
  renderCodeTreeView();
}

function renderCodeTabs() {
  const tabs = $('code-tabs');
  if (!tabs) return;
  if (!codeState.openFiles.length) {
    tabs.innerHTML = '<span class="code-tab-placeholder">Open files appear here</span>';
    return;
  }
  tabs.innerHTML = codeState.openFiles.map(file => `
    <button class="code-tab ${file.path === codeState.activePath ? 'active' : ''} ${codeDirtyPaths.has(file.path) ? 'dirty' : ''}" type="button" data-path="${esc(file.path)}">
      <span>${esc(file.name)}${codeDirtyPaths.has(file.path) ? ' •' : ''}</span>
      <span class="code-tab-close" data-close-path="${esc(file.path)}">×</span>
    </button>
  `).join('');
  tabs.querySelectorAll('.code-tab').forEach(tab => {
    tab.addEventListener('click', ev => {
      const closePath = ev.target?.getAttribute?.('data-close-path');
      if (closePath) {
        ev.stopPropagation();
        closeCodeTab(closePath);
        return;
      }
      const path = tab.getAttribute('data-path') || '';
      if (codeFileCache.has(path)) {
        codeState.activePath = path;
        renderCodeTabs();
        renderCodeFile(codeFileCache.get(path));
        renderCodeTreeView();
      } else {
        openCodeFile(path);
      }
    });
  });
}

function normalizedCodeLanguage(language) {
  const value = String(language || 'text').toLowerCase();
  if (['py', 'python'].includes(value)) return 'python';
  if (['sh', 'shell', 'bash', 'zsh'].includes(value)) return 'shell';
  if (['md', 'markdown'].includes(value)) return 'markdown';
  if (['yaml', 'yml'].includes(value)) return 'yaml';
  if (['js', 'javascript', 'jsx', 'ts', 'tsx', 'typescript'].includes(value)) return 'javascript';
  return value || 'text';
}

function prismCodeLanguage(language) {
  const lang = normalizedCodeLanguage(language);
  const aliases = {
    shell: 'bash',
    sh: 'bash',
    zsh: 'bash',
    bash: 'bash',
    markdown: 'markdown',
    md: 'markdown',
    python: 'python',
    py: 'python',
    javascript: 'javascript',
    js: 'javascript',
    jsx: 'javascript',
    typescript: 'typescript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    txt: 'plaintext',
    text: 'plaintext',
    plaintext: 'plaintext',
  };
  return aliases[lang] || lang || 'plaintext';
}

function highlightWithPrism(content, language) {
  const source = String(content || '');
  const Prism = window.Prism;
  if (!Prism || !Prism.languages) return null;
  const lang = prismCodeLanguage(language);
  if (lang === 'plaintext') return esc(source);
  try {
    const grammar = Prism.languages[lang];
    if (!grammar) return esc(source);
    return Prism.highlight(source, grammar, lang);
  } catch (_) {
    return null;
  }
}

function highlightEditableCode(content, language) {
  const source = String(content || '');
  const highlighted = highlightWithPrism(source, language);
  if (highlighted !== null) return highlighted;
  return esc(source);
}

function highlightDisplayLine(raw, language) {
  const highlighted = highlightWithPrism(raw, language);
  if (highlighted !== null) return highlighted;
  return esc(raw);
}

function isMarkdownCodeFile(data) {
  const name = String(data?.name || data?.path || '').toLowerCase();
  return data?.language === 'markdown' || name.endsWith('.md') || name.endsWith('.markdown');
}

function isImageCodeFile(data) {
  return data?.kind === 'image' || data?.language === 'image' || isRemoteImagePath(data?.path || data?.name || '');
}

function defaultCodeViewMode(data) {
  if (isImageCodeFile(data)) return 'preview';
  return isMarkdownCodeFile(data) ? 'preview' : 'edit';
}

function currentCodeViewMode(data) {
  const path = data?.path || codeState.activePath || '';
  if (isImageCodeFile(data)) return 'preview';
  if (!isMarkdownCodeFile(data)) return 'edit';
  const mode = codeViewModeByPath.get(path) || defaultCodeViewMode(data);
  return mode === 'edit' ? 'edit' : 'preview';
}

function codeFileDraft(data) {
  const path = data?.path || '';
  if (!path) return String(data?.content || '');
  if (!codeDraftCache.has(path)) codeDraftCache.set(path, String(data?.content || ''));
  return codeDraftCache.get(path);
}

function monacoLanguage(language) {
  return window.CodeWorkspaceCore.monacoLanguage(language);
}

function monacoUriForPath(path) {
  const authority = String(codeTerminalState.host || 'apuana').replace(/[^a-z0-9.-]/gi, '-');
  return window.monaco.Uri.from({scheme: 'apuana-ssh', authority, path: String(path || '/')});
}

function disposeCodeEditorView() {
  if (!codeMonacoEditor) return;
  if (codeMonacoActivePath) {
    codeMonacoViewStates.set(codeMonacoActivePath, codeMonacoEditor.saveViewState());
  }
  codeMonacoEditor.dispose();
  codeMonacoEditor = null;
  codeMonacoActivePath = '';
}

function disposeCodeModel(path) {
  codeMonacoDisposables.get(path)?.dispose?.();
  codeMonacoDisposables.delete(path);
  codeMonacoModels.get(path)?.dispose?.();
  codeMonacoModels.delete(path);
  codeMonacoViewStates.delete(path);
}

function ensureCodeModel(data) {
  const monaco = window.monaco;
  if (!monaco || !data?.path) return null;
  let model = codeMonacoModels.get(data.path);
  if (!model) {
    model = monaco.editor.createModel(codeFileDraft(data), monacoLanguage(data.language), monacoUriForPath(data.path));
    codeMonacoModels.set(data.path, model);
    codeMonacoDisposables.set(data.path, model.onDidChangeContent(() => {
      const next = model.getValue();
      codeDraftCache.set(data.path, next);
      if (next === String((codeFileCache.get(data.path) || data).content || '')) codeDirtyPaths.delete(data.path);
      else codeDirtyPaths.add(data.path);
      updateCodeSaveUi(codeFileCache.get(data.path) || data);
    }));
  } else {
    monaco.editor.setModelLanguage(model, monacoLanguage(data.language));
  }
  return model;
}

function mountCodeEditor(data) {
  const container = $('code-monaco-editor');
  const monaco = window.monaco;
  if (!container || !monaco) {
    if (container) container.innerHTML = '<div class="alert a-danger">Monaco Editor could not be loaded.</div>';
    return;
  }
  disposeCodeEditorView();
  const model = ensureCodeModel(data);
  if (!model) return;
  codeMonacoEditor = monaco.editor.create(container, {
    model,
    theme: 'vs-dark',
    automaticLayout: true,
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12.5,
    lineHeight: 21,
    minimap: {enabled: false},
    padding: {top: 10, bottom: 10},
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    renderWhitespace: 'selection',
    bracketPairColorization: {enabled: true},
    guides: {bracketPairs: true, indentation: true},
    overviewRulerBorder: false,
  });
  codeMonacoActivePath = data.path;
  const viewState = codeMonacoViewStates.get(data.path);
  if (viewState) codeMonacoEditor.restoreViewState(viewState);
  codeMonacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveActiveCodeFile());
  codeMonacoEditor.focus();
}

function setActiveCodeMode(mode) {
  const path = codeState.activePath || '';
  const data = codeFileCache.get(path);
  if (!path || !data) return;
  if (isImageCodeFile(data)) {
    codeViewModeByPath.set(path, 'preview');
    renderCodeFile(data);
    return;
  }
  if (!isMarkdownCodeFile(data)) {
    codeViewModeByPath.set(path, 'edit');
    renderCodeFile(data);
    return;
  }
  codeViewModeByPath.set(path, mode === 'edit' ? 'edit' : 'preview');
  renderCodeFile(data);
}

function codeModeButton(mode, label, active, disabled = false) {
  const icons = {
    preview: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  };
  return `<button class="code-mode-btn ${active ? 'active' : ''}" type="button" data-code-mode="${esc(mode)}" title="${esc(label)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>
    ${icons[mode] || ''}
  </button>`;
}

function renderCodeActions(data, mode) {
  if (isImageCodeFile(data)) {
    return `
      <div class="code-editor-actions">
        <button class="mini-btn btn-with-icon" id="code-preview-image-modal" type="button" title="Open image preview" aria-label="Open image preview">
          <svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>Preview</span>
        </button>
      </div>
    `;
  }
  const dirty = codeDirtyPaths.has(data.path);
  const saving = codeSavingPaths.has(data.path);
  const statusKind = saving ? 'saving' : dirty ? 'dirty' : 'saved';
  const statusLabel = saving ? 'Saving' : dirty ? 'Unsaved changes' : 'Saved';
  const modeSwitch = isMarkdownCodeFile(data)
    ? `<div class="code-mode-switch">
        ${codeModeButton('preview', 'Preview', mode === 'preview')}
        ${codeModeButton('edit', 'Edit', mode === 'edit')}
      </div>`
    : '';
  return `
    <div class="code-editor-actions">
      ${modeSwitch}
      <button class="mini-btn primary code-save-btn" id="code-save-file" type="button" title="Save with Ctrl+S or Command+S" aria-label="Save file" ${(!dirty || saving) ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
      </button>
      <span class="code-save-status ${esc(statusKind)}" id="code-save-status" title="${esc(statusLabel)}" aria-label="${esc(statusLabel)}">
        ${codeSaveStatusIcon(statusKind)}
      </span>
    </div>
  `;
}

function codeSaveStatusIcon(kind) {
  if (kind === 'saving') {
    return '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-9 9"/><path d="M3 12a9 9 0 0 1 9-9"/></svg>';
  }
  if (kind === 'dirty') {
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>';
  }
  if (kind === 'error') {
    return '<svg viewBox="0 0 24 24"><path d="M12 8v5"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
}

function isCodeSaveShortcut(ev) {
  return (ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key || '').toLowerCase() === 's';
}

function handleCodeSaveShortcut(ev) {
  if (!isCodeSaveShortcut(ev)) return;
  const path = codeState.activePath || '';
  const data = codeFileCache.get(path);
  if (!path || !data || isImageCodeFile(data) || currentCodeViewMode(data) !== 'edit') return;
  ev.preventDefault();
  ev.stopPropagation();
  if (!codeDirtyPaths.has(path) || codeSavingPaths.has(path)) {
    updateCodeSaveUi(data);
    return;
  }
  saveActiveCodeFile();
}

function updateCodeSaveUi(data) {
  const path = data?.path || codeState.activePath || '';
  const dirty = codeDirtyPaths.has(path);
  const saving = codeSavingPaths.has(path);
  const save = $('code-save-file');
  const status = $('code-save-status');
  if (save) {
    save.disabled = !dirty || saving;
    save.title = 'Save with Ctrl+S or Command+S';
    save.setAttribute('aria-label', 'Save file');
    save.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>';
  }
  if (status) {
    const statusKind = saving ? 'saving' : dirty ? 'dirty' : 'saved';
    const statusLabel = saving ? 'Saving' : dirty ? 'Unsaved changes' : 'Saved';
    status.className = `code-save-status ${statusKind}`;
    status.title = statusLabel;
    status.setAttribute('aria-label', statusLabel);
    status.innerHTML = codeSaveStatusIcon(statusKind);
  }
  renderCodeTabs();
}

function bindCodeEditorControls(data) {
  document.querySelectorAll('[data-code-mode]').forEach(button => {
    button.addEventListener('click', () => setActiveCodeMode(button.getAttribute('data-code-mode') || 'preview'));
  });
  $('code-save-file')?.addEventListener('click', saveActiveCodeFile);
  $('code-preview-image-modal')?.addEventListener('click', () => openRemoteImagePreview(data.path, data));

  document.querySelectorAll('[data-code-image-preview]').forEach(image => {
    const status = image.closest('.code-image-preview')?.querySelector('.remote-image-status') || null;
    loadRemoteImageElement(image, data.path, status, data);
    image.addEventListener('click', () => openRemoteImagePreview(data.path, data));
  });

  const textarea = $('code-edit-content');
  if (textarea) {
    const highlight = $('code-edit-highlight');
    const syncHighlight = () => {
      if (!highlight) return;
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    };
    const paintHighlight = () => {
      if (!highlight) return;
      highlight.innerHTML = `<code>${highlightEditableCode(textarea.value, data.language || 'text')}</code>`;
      syncHighlight();
    };
    textarea.addEventListener('keydown', handleCodeSaveShortcut);
    textarea.addEventListener('scroll', syncHighlight, {passive: true});
    textarea.addEventListener('input', () => {
      const next = textarea.value;
      codeDraftCache.set(data.path, next);
      if (next === String(data.content || '')) codeDirtyPaths.delete(data.path);
      else codeDirtyPaths.add(data.path);
      paintHighlight();
      updateCodeSaveUi(data);
    });
    paintHighlight();
  }
}

function renderSourceCode(data) {
  const lines = String(data.content || '').split('\n');
  return `<div class="code-lines">${lines.map((line, index) => `
    <div class="code-line-row">
      <span class="code-line-no">${index + 1}</span>
      <code class="code-line">${highlightDisplayLine(line, data.language || 'text')}</code>
    </div>
  `).join('')}</div>`;
}

function safeMarkdownHref(raw) {
  const href = String(raw || '').trim();
  if (/^(https?:|mailto:|#|\/)/i.test(href)) return href;
  return '#';
}

function markdownInline(raw) {
  let text = esc(raw);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\\s+&quot;.*?&quot;)?\)/g, (_, label, href) => {
    return `<a href="${esc(safeMarkdownHref(href))}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return text;
}

function renderMarkdownTable(rows) {
  if (!rows.length) return '';
  const cells = row => row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(row => cells(row));
  return `<div class="md-table-wrap"><table><thead><tr>${head.map(cell => `<th>${markdownInline(cell)}</th>`).join('')}</tr></thead>
    <tbody>${body.map(row => `<tr>${row.map(cell => `<td>${markdownInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderMarkdownPreview(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let paragraph = [];
  let list = null;
  let table = [];
  let inFence = false;
  let fenceLang = '';
  let fenceLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html += `<p>${markdownInline(paragraph.join(' '))}</p>`;
    paragraph = [];
  }
  function flushList() {
    if (!list) return;
    html += `<${list.type}>${list.items.map(item => `<li>${markdownInline(item)}</li>`).join('')}</${list.type}>`;
    list = null;
  }
  function flushTable() {
    if (!table.length) return;
    html += renderMarkdownTable(table);
    table = [];
  }
  function flushBlocks() {
    flushParagraph();
    flushList();
    flushTable();
  }
  function flushFence() {
    const language = fenceLang ? `<span>${esc(fenceLang)}</span>` : '';
    html += `<pre class="md-code-block">${language}<code>${esc(fenceLines.join('\n'))}</code></pre>`;
    inFence = false;
    fenceLang = '';
    fenceLines = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inFence) {
        flushFence();
      } else {
        flushBlocks();
        inFence = true;
        fenceLang = trimmed.slice(3).trim();
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }
    if (!trimmed) {
      flushBlocks();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html += `<h${level}>${markdownInline(heading[2])}</h${level}>`;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushBlocks();
      html += '<hr>';
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushBlocks();
      html += `<blockquote>${markdownInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`;
      continue;
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      flushTable();
      const type = unordered ? 'ul' : 'ol';
      if (!list || list.type !== type) flushList();
      if (!list) list = {type, items: []};
      list.items.push((unordered || ordered)[1]);
      continue;
    }
    const next = lines[i + 1]?.trim() || '';
    const isTableStart = trimmed.includes('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
    const isTableLine = table.length && trimmed.includes('|');
    if (isTableStart || isTableLine) {
      flushParagraph();
      flushList();
      table.push(trimmed);
      if (isTableStart) {
        table.push(next);
        i += 1;
      }
      continue;
    }
    flushTable();
    paragraph.push(trimmed);
  }
  if (inFence) flushFence();
  flushBlocks();
  return `<article class="markdown-preview">${html || '<p>No markdown content.</p>'}</article>`;
}

function renderEditMode(data) {
  void data;
  return '<div id="code-monaco-editor" class="code-monaco-editor" role="textbox" aria-label="Code editor"></div>';
}

function renderCodeImagePreview(data) {
  return `
    <div class="code-image-preview">
      <div class="code-image-preview-toolbar">
        <div>
          <strong>${esc(data.name || 'Image')}</strong>
          <span>${esc(data.path || '')}${data.size_human ? ` · ${esc(data.size_human)}` : ''}</span>
        </div>
        <button class="mini-btn btn-with-icon" id="code-preview-image-inline" type="button">
          <svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>Open larger</span>
        </button>
      </div>
      <div class="code-image-preview-stage">
        <img data-code-image-preview alt="${esc(data.name || 'Remote image preview')}" hidden>
        <div class="remote-image-status loading">Loading image from Apuana...</div>
      </div>
    </div>
  `;
}

async function saveActiveCodeFile(options = {}) {
  const path = codeState.activePath || '';
  const cached = codeFileCache.get(path);
  if (!path || !cached || isImageCodeFile(cached) || codeSavingPaths.has(path)) return;
  const content = codeMonacoModels.get(path)?.getValue() ?? (codeDraftCache.has(path) ? codeDraftCache.get(path) : String(cached.content || ''));
  codeSavingPaths.add(path);
  updateCodeSaveUi(cached);
  try {
    const response = await apiFetch('/api/code/file', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path, content, expected_revision: cached.revision || '', force: !!options.force}),
    });
    const data = await response.json();
    if (response.status === 409 && data.code === 'revision_conflict') {
      openCodeConflictModal({path, content, currentRevision: data.current_revision || ''});
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not save file.');
    codeFileCache.set(path, data);
    codeDraftCache.set(path, data.content || '');
    codeDirtyPaths.delete(path);
    codeState.openFiles = codeState.openFiles.map(file => file.path === path ? {
      ...file,
      name: data.name,
      language: data.language,
      size_human: data.size_human,
      lines: data.lines,
    } : file);
    codeTreeCache.clear();
    codeFolderCache.clear();
    codeListCache.clear();
    renderCodeTabs();
    renderCodeFile(data);
  } catch (err) {
    const status = $('code-save-status');
    if (status) {
      status.className = 'code-save-status error';
      const message = err?.message || 'Could not save file.';
      status.title = message;
      status.setAttribute('aria-label', message);
      status.innerHTML = codeSaveStatusIcon('error');
    }
  } finally {
    codeSavingPaths.delete(path);
    const current = codeFileCache.get(path) || cached;
    updateCodeSaveUi(current);
  }
}

function renderCodeFile(data) {
  const editor = $('code-editor');
  if (!editor) return;
  const mode = currentCodeViewMode(data);
  disposeCodeEditorView();
  if (!codeViewModeByPath.has(data.path)) codeViewModeByPath.set(data.path, mode);
  if (!isImageCodeFile(data) && !codeDraftCache.has(data.path)) codeDraftCache.set(data.path, String(data.content || ''));
  $('code-file-title').textContent = data.name || 'Code file';
  $('code-file-meta').textContent = isImageCodeFile(data)
    ? `${data.path} · Image · ${data.size_human || ''}`
    : `${data.path} · ${data.lines || 0} line(s) · ${data.size_human || ''}`;
  setCodeLanguagePill(data.language || 'text', data.path || data.name || '');
  const head = document.querySelector('.code-editor-head');
  if (head) {
    let actions = head.querySelector('.code-editor-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'code-editor-actions';
      head.appendChild(actions);
    }
    actions.outerHTML = renderCodeActions(data, mode);
  }
  if (isImageCodeFile(data)) {
    editor.innerHTML = renderCodeImagePreview(data);
  } else if (mode === 'preview' && isMarkdownCodeFile(data)) {
    editor.innerHTML = renderMarkdownPreview(codeFileDraft(data));
  } else if (mode === 'edit') {
    editor.innerHTML = renderEditMode(data);
  } else {
    editor.innerHTML = renderSourceCode({...data, content: codeFileDraft(data)});
  }
  bindCodeEditorControls(data);
  $('code-preview-image-inline')?.addEventListener('click', () => openRemoteImagePreview(data.path, data));
  if (mode === 'edit') requestAnimationFrame(() => mountCodeEditor(data));
}
