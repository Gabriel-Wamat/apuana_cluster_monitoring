const CODE_TERMINAL_INPUT_FLUSH_MS = 16;
const CODE_TERMINAL_MAX_TABS = 4;
let codeTerminalResizeTimer = null;

function createCodeTerminalTab() {
  const number = codeTerminalState.nextTabNumber++;
  return {
    clientId: `terminal-${Date.now().toString(36)}-${number}`,
    title: `Terminal ${number}`,
    id: '',
    status: 'idle',
    statusLabel: 'Idle',
    host: '',
    login: '',
    backend: '',
    seq: 0,
    polling: false,
    pollTimer: null,
    eventSource: null,
    streaming: false,
    starting: false,
    startPromise: null,
    pendingInput: '',
    inputBuffer: '',
    inputTimer: null,
    inputInFlight: false,
    term: null,
    fitAddon: null,
    resizeObserver: null,
    cols: 0,
    rows: 0,
    lastError: '',
    container: null,
  };
}

function codeTerminalTabs() {
  if (!Array.isArray(codeTerminalState.tabs)) codeTerminalState.tabs = [];
  return codeTerminalState.tabs;
}

function activeCodeTerminalTab(options = {}) {
  const tabs = codeTerminalTabs();
  let tab = tabs.find(item => item.clientId === codeTerminalState.activeId);
  if (!tab && tabs.length) {
    tab = tabs[0];
    codeTerminalState.activeId = tab.clientId;
  }
  if (!tab && options.create !== false) {
    tab = createCodeTerminalTab();
    tabs.push(tab);
    codeTerminalState.activeId = tab.clientId;
  }
  syncCodeTerminalState(tab || null);
  return tab || null;
}

function syncCodeTerminalState(tab) {
  codeTerminalState.id = tab?.id || '';
  codeTerminalState.status = tab?.status || 'idle';
  codeTerminalState.host = tab?.host || '';
  codeTerminalState.login = tab?.login || '';
  codeTerminalState.backend = tab?.backend || '';
  codeTerminalState.seq = tab?.seq || 0;
  codeTerminalState.polling = !!tab?.polling;
  codeTerminalState.pollTimer = tab?.pollTimer || null;
  codeTerminalState.eventSource = tab?.eventSource || null;
  codeTerminalState.streaming = !!tab?.streaming;
  codeTerminalState.starting = !!tab?.starting;
  codeTerminalState.startPromise = tab?.startPromise || null;
  codeTerminalState.pendingInput = tab?.pendingInput || '';
  codeTerminalState.term = tab?.term || null;
  codeTerminalState.fitAddon = tab?.fitAddon || null;
  codeTerminalState.resizeObserver = tab?.resizeObserver || null;
  codeTerminalState.cols = tab?.cols || 0;
  codeTerminalState.rows = tab?.rows || 0;
  codeTerminalState.lastError = tab?.lastError || '';
}

function codeTerminalDimensions(tab = activeCodeTerminalTab()) {
  return window.CodeWorkspaceCore.terminalDimensions(
    tab?.fitAddon?.proposeDimensions?.(),
    {cols: tab?.term?.cols, rows: tab?.term?.rows},
  );
}

function codeTerminalConnectionLabel(tab = activeCodeTerminalTab()) {
  const prefix = tab?.backend === 'local-openssh' ? 'Local SSH' : 'SSH';
  const target = tab?.host ? `${tab.login}@${tab.host}` : 'Connected';
  return `${prefix}: ${target}`;
}

function setCodeTerminalStatus(status, label, tab = activeCodeTerminalTab()) {
  if (tab) {
    tab.status = status;
    tab.statusLabel = label || status;
  }
  syncCodeTerminalState(tab || null);
  renderCodeTerminalTabs();
  const active = activeCodeTerminalTab({create: false});
  const el = $('code-terminal-status');
  if (!el || !active || active !== tab) return;
  el.className = `code-terminal-status ${status}`;
  el.textContent = label || status;
}

function codeTerminalTheme() {
  return {
    background: '#090C0D',
    foreground: '#D6DEE3',
    cursor: '#24D18D',
    cursorAccent: '#07100D',
    selectionBackground: '#1D3B55',
    black: '#090C0D',
    red: '#F0556C',
    green: '#20C77B',
    yellow: '#F0B429',
    blue: '#5AA3F0',
    magenta: '#A779E9',
    cyan: '#2DD4BF',
    white: '#D6DEE3',
    brightBlack: '#6E7B83',
    brightRed: '#FF6B81',
    brightGreen: '#29E095',
    brightYellow: '#FFD166',
    brightBlue: '#76B8FF',
    brightMagenta: '#B995FF',
    brightCyan: '#5EEAD4',
    brightWhite: '#F2F6F8',
  };
}

function codeTerminalRoot() {
  const screen = $('code-terminal-screen');
  if (!screen) return null;
  let root = screen.querySelector('.code-terminal-root');
  if (!root) {
    screen.textContent = '';
    root = document.createElement('div');
    root.className = 'code-terminal-root';
    screen.appendChild(root);
  }
  return root;
}

function activateCodeTerminalContainer(tab = activeCodeTerminalTab()) {
  const root = codeTerminalRoot();
  if (!root || !tab) return;
  [...root.querySelectorAll('.code-terminal-instance')].forEach(node => {
    node.classList.toggle('active', node.dataset.terminalClientId === tab.clientId);
  });
}

function ensureCodeTerminalRenderer(tab = activeCodeTerminalTab()) {
  if (!tab) return null;
  if (tab.term) {
    activateCodeTerminalContainer(tab);
    return tab.term;
  }
  const root = codeTerminalRoot();
  if (!root || !window.ApuanaTerminal) return null;
  const container = document.createElement('div');
  container.className = 'code-terminal-instance';
  container.dataset.terminalClientId = tab.clientId;
  root.appendChild(container);
  tab.container = container;
  const dims = codeTerminalDimensions(tab);
  const term = new window.ApuanaTerminal.Terminal({
    cols: dims.cols,
    rows: dims.rows,
    cursorBlink: true,
    convertEol: false,
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.32,
    scrollback: 5000,
    tabStopWidth: 2,
    theme: codeTerminalTheme(),
    allowProposedApi: false,
  });
  const fitAddon = new window.ApuanaTerminal.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  term.onData(data => sendCodeTerminalInput(data, tab.clientId));
  tab.term = term;
  tab.fitAddon = fitAddon;
  if (window.ResizeObserver) {
    tab.resizeObserver = new ResizeObserver(() => scheduleCodeTerminalResize(tab.clientId));
    tab.resizeObserver.observe(container);
  }
  activateCodeTerminalContainer(tab);
  requestAnimationFrame(() => resizeCodeTerminal(tab.clientId));
  syncCodeTerminalState(tab);
  return term;
}

function writeCodeTerminal(data, tab = activeCodeTerminalTab()) {
  const term = ensureCodeTerminalRenderer(tab);
  if (!term) return;
  term.write(String(data || ''));
}

function clearCodeTerminalOutput() {
  const tab = activeCodeTerminalTab();
  ensureCodeTerminalRenderer(tab)?.clear();
  focusCodeTerminal();
}

function stopCodeTerminalStream(tab) {
  if (!tab) return;
  if (tab.eventSource) {
    tab.eventSource.close();
    tab.eventSource = null;
  }
  tab.streaming = false;
  if (tab.pollTimer) {
    clearTimeout(tab.pollTimer);
    tab.pollTimer = null;
  }
  syncCodeTerminalState(activeCodeTerminalTab({create: false}));
}

function startCodeTerminalStream(tab = activeCodeTerminalTab()) {
  if (!tab?.id || tab.eventSource || !window.EventSource) return;
  const url = `/api/terminal/events?id=${encodeURIComponent(tab.id)}&since=${encodeURIComponent(tab.seq || 0)}`;
  const source = new EventSource(url);
  tab.eventSource = source;
  tab.streaming = true;
  syncCodeTerminalState(tab);

  source.addEventListener('terminal', ev => {
    try {
      const data = JSON.parse(ev.data || '{}');
      if (!data.ok) throw new Error(data.error || 'Terminal stream ended.');
      tab.seq = Number(data.seq || tab.seq || 0);
      tab.backend = data.backend || tab.backend;
      tab.host = data.host || tab.host;
      tab.login = data.login || tab.login;
      if (data.output) writeCodeTerminal(data.output, tab);
      setCodeTerminalStatus('connected', codeTerminalConnectionLabel(tab), tab);
      if (data.alive === false) stopCodeTerminalStream(tab);
    } catch (err) {
      setCodeTerminalStatus('error', err?.message || 'Terminal stream error', tab);
      stopCodeTerminalStream(tab);
    }
  });

  source.addEventListener('error', ev => {
    if (!tab.id) return;
    if (ev?.data) {
      try {
        const data = JSON.parse(ev.data);
        setCodeTerminalStatus('error', data.error || 'Terminal session ended.', tab);
        stopCodeTerminalStream(tab);
        tab.id = '';
        tab.seq = 0;
        return;
      } catch (_) {}
    }
    setCodeTerminalStatus('connecting', 'Reconnecting terminal...', tab);
  });
}

async function pollCodeTerminalFallback(tab = activeCodeTerminalTab()) {
  if (!codeTerminalState.open || !tab?.id || tab.polling || tab.eventSource) return;
  tab.polling = true;
  try {
    const response = await apiFetch('/api/terminal/read?id=' + encodeURIComponent(tab.id));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Terminal session ended.');
    if (data.output) writeCodeTerminal(data.output, tab);
    setCodeTerminalStatus('connected', codeTerminalConnectionLabel(tab), tab);
  } catch (err) {
    setCodeTerminalStatus('error', err?.message || 'Terminal error', tab);
    return;
  } finally {
    tab.polling = false;
  }
  tab.pollTimer = setTimeout(() => pollCodeTerminalFallback(tab), 500);
}

async function ensureCodeTerminalSession(tab = activeCodeTerminalTab()) {
  if (!tab) return false;
  ensureCodeTerminalRenderer(tab);
  if (!window.CodeWorkspaceCore.terminalCanStart(sshAuth)) {
    setCodeTerminalStatus('idle', 'Waiting for SSH login', tab);
    return false;
  }
  if (tab.id) {
    startCodeTerminalStream(tab);
    if (!window.EventSource) pollCodeTerminalFallback(tab);
    return true;
  }
  if (tab.startPromise) return tab.startPromise;

  setCodeTerminalStatus('connecting', 'Starting local SSH...', tab);
  tab.starting = true;
  tab.startPromise = (async () => {
    try {
      const dims = codeTerminalDimensions(tab);
      const cwd = codeState.path || codeState.project || transferState.home || '';
      const response = await apiFetch('/api/terminal/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({cols: dims.cols, rows: dims.rows, cwd}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not start terminal.');
      tab.id = data.id || '';
      tab.host = data.host || '';
      tab.login = data.login || '';
      tab.backend = data.backend || '';
      tab.seq = Number(data.seq || 0);
      tab.lastError = '';
      if (data.output) writeCodeTerminal(data.output, tab);
      setCodeTerminalStatus('connected', codeTerminalConnectionLabel(tab), tab);
      requestAnimationFrame(() => resizeCodeTerminal(tab.clientId));
      startCodeTerminalStream(tab);
      if (!window.EventSource) pollCodeTerminalFallback(tab);
      if (tab.pendingInput) {
        const pending = tab.pendingInput;
        tab.pendingInput = '';
        sendCodeTerminalInput(pending, tab.clientId);
      }
      return true;
    } catch (err) {
      const message = err?.message || 'Could not start terminal.';
      setCodeTerminalStatus('error', message, tab);
      if (!message.toLowerCase().includes('ssh login required') && tab.lastError !== message) {
        writeCodeTerminal(`\r\n[Apuana Monitor] ${message}\r\n`, tab);
      }
      tab.lastError = message;
      return false;
    } finally {
      tab.starting = false;
      tab.startPromise = null;
      syncCodeTerminalState(activeCodeTerminalTab({create: false}));
    }
  })();
  return tab.startPromise;
}

function warmCodeTerminalSession() {
  ensureCodeTerminalSession(activeCodeTerminalTab());
}

function scheduleCodeTerminalStart() {
  if (!window.CodeWorkspaceCore.terminalCanStart(sshAuth)) return;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmCodeTerminalSession, {timeout: 80});
  } else {
    setTimeout(warmCodeTerminalSession, 0);
  }
}

function focusCodeTerminal() {
  ensureCodeTerminalRenderer(activeCodeTerminalTab())?.focus();
}

function scheduleCodeWorkspaceRelayout() {
  requestAnimationFrame(() => {
    try {
      if (typeof codeMonacoEditor !== 'undefined') codeMonacoEditor?.layout?.();
    } catch (_) {}
    scheduleCodeTerminalResize();
    requestAnimationFrame(() => {
      try {
        if (typeof codeMonacoEditor !== 'undefined') codeMonacoEditor?.layout?.();
      } catch (_) {}
      scheduleCodeTerminalResize();
    });
  });
}

function renderCodeTerminalTabs() {
  const wrap = $('code-terminal-tabs');
  if (!wrap) return;
  if (!codeTerminalTabs().length) activeCodeTerminalTab();
  const active = activeCodeTerminalTab({create: false});
  wrap.innerHTML = codeTerminalTabs().map(tab => `
    <button class="code-terminal-tab ${tab.clientId === active?.clientId ? 'active' : ''} ${tab.status || 'idle'}" type="button" data-code-terminal-tab="${esc(tab.clientId)}" title="${esc(tab.statusLabel || tab.title)}">
      <svg viewBox="0 0 24 24"><path d="m4 17 6-5-6-5"/><path d="M12 19h8"/></svg>
      <span>${esc(tab.title)}</span>
      ${codeTerminalTabs().length > 1 ? `<span class="code-terminal-tab-close" role="button" aria-label="Close ${esc(tab.title)}" data-code-terminal-close="${esc(tab.clientId)}">×</span>` : ''}
    </button>
  `).join('');
  const add = $('code-terminal-new');
  if (add) {
    add.disabled = codeTerminalTabs().length >= CODE_TERMINAL_MAX_TABS;
    add.title = add.disabled ? `Maximum of ${CODE_TERMINAL_MAX_TABS} terminal tabs` : 'New terminal tab';
  }
}

async function openCodeTerminalPanel() {
  const view = $('view-code');
  const panel = $('code-terminal-panel');
  const toggle = $('code-terminal-toggle');
  if (!view || !panel) return;
  codeTerminalState.open = true;
  view.classList.add('terminal-open');
  panel.setAttribute('aria-hidden', 'false');
  if (toggle) {
    toggle.classList.add('active');
    toggle.setAttribute('aria-pressed', 'true');
    toggle.setAttribute('aria-label', 'Close Apuana terminal');
    toggle.setAttribute('title', 'Close Apuana terminal');
  }
  const tab = activeCodeTerminalTab();
  renderCodeTerminalTabs();
  ensureCodeTerminalRenderer(tab);
  scheduleCodeWorkspaceRelayout();
  focusCodeTerminal();
  scheduleCodeTerminalStart();
}

function closeCodeTerminalPanel() {
  const view = $('view-code');
  const panel = $('code-terminal-panel');
  const toggle = $('code-terminal-toggle');
  codeTerminalState.open = false;
  view?.classList.remove('terminal-open');
  panel?.setAttribute('aria-hidden', 'true');
  if (toggle) {
    toggle.classList.remove('active');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', 'Open Apuana terminal');
    toggle.setAttribute('title', 'Open Apuana terminal');
  }
  scheduleCodeWorkspaceRelayout();
}

function toggleCodeTerminalPanel() {
  if (codeTerminalState.open) closeCodeTerminalPanel();
  else openCodeTerminalPanel();
}

function selectCodeTerminalTab(clientId) {
  const tab = codeTerminalTabs().find(item => item.clientId === clientId);
  if (!tab) return;
  codeTerminalState.activeId = tab.clientId;
  syncCodeTerminalState(tab);
  renderCodeTerminalTabs();
  activateCodeTerminalContainer(tab);
  const status = $('code-terminal-status');
  if (status) {
    status.className = `code-terminal-status ${tab.status || 'idle'}`;
    status.textContent = tab.statusLabel || (tab.id ? codeTerminalConnectionLabel(tab) : 'Idle');
  }
  scheduleCodeWorkspaceRelayout();
  focusCodeTerminal();
  ensureCodeTerminalSession(tab);
}

function newCodeTerminalTab() {
  if (codeTerminalTabs().length >= CODE_TERMINAL_MAX_TABS) {
    const tab = activeCodeTerminalTab();
    setCodeTerminalStatus('error', `Terminal limit reached (${CODE_TERMINAL_MAX_TABS} max)`, tab);
    return;
  }
  const tab = createCodeTerminalTab();
  codeTerminalTabs().push(tab);
  codeTerminalState.activeId = tab.clientId;
  renderCodeTerminalTabs();
  if (!codeTerminalState.open) openCodeTerminalPanel();
  else {
    ensureCodeTerminalRenderer(tab);
    selectCodeTerminalTab(tab.clientId);
  }
}

function disposeCodeTerminalTab(tab) {
  stopCodeTerminalStream(tab);
  if (tab.inputTimer) clearTimeout(tab.inputTimer);
  if (tab.resizeObserver) tab.resizeObserver.disconnect();
  try {
    tab.term?.dispose?.();
  } catch (_) {}
  tab.container?.remove?.();
  if (tab.id) {
    apiFetch('/api/terminal/stop', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: tab.id}),
    }).catch(() => {});
  }
}

function closeCodeTerminalTab(clientId) {
  const tabs = codeTerminalTabs();
  const index = tabs.findIndex(tab => tab.clientId === clientId);
  if (index < 0) return;
  const [tab] = tabs.splice(index, 1);
  disposeCodeTerminalTab(tab);
  if (!tabs.length) tabs.push(createCodeTerminalTab());
  const next = tabs[Math.min(index, tabs.length - 1)];
  codeTerminalState.activeId = next.clientId;
  syncCodeTerminalState(next);
  renderCodeTerminalTabs();
  activateCodeTerminalContainer(next);
  scheduleCodeWorkspaceRelayout();
}

function queueCodeTerminalInput(data, clientId = codeTerminalState.activeId) {
  const tab = codeTerminalTabs().find(item => item.clientId === clientId) || activeCodeTerminalTab();
  if (!tab) return;
  tab.pendingInput = (tab.pendingInput + data).slice(-8192);
  setCodeTerminalStatus('connecting', 'Starting local SSH...', tab);
  ensureCodeTerminalSession(tab);
}

function sendCodeTerminalInput(data, clientId = codeTerminalState.activeId) {
  if (!data) return Promise.resolve(false);
  const tab = codeTerminalTabs().find(item => item.clientId === clientId) || activeCodeTerminalTab();
  if (!tab?.id) {
    queueCodeTerminalInput(data, clientId);
    return Promise.resolve(false);
  }
  tab.inputBuffer += data;
  if (!tab.inputTimer) {
    tab.inputTimer = setTimeout(() => flushCodeTerminalInput(tab), CODE_TERMINAL_INPUT_FLUSH_MS);
  }
  return Promise.resolve(true);
}

async function flushCodeTerminalInput(tab = activeCodeTerminalTab()) {
  if (!tab) return;
  tab.inputTimer = null;
  if (tab.inputInFlight || !tab.id || !tab.inputBuffer) return;
  const data = tab.inputBuffer;
  tab.inputBuffer = '';
  tab.inputInFlight = true;
  try {
    const response = await apiFetch('/api/terminal/input', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: tab.id, data}),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || 'Could not write to terminal.');
    setCodeTerminalStatus('connected', codeTerminalConnectionLabel(tab), tab);
  } catch (err) {
    setCodeTerminalStatus('error', err?.message || 'Terminal error', tab);
  } finally {
    tab.inputInFlight = false;
    if (tab.inputBuffer) flushCodeTerminalInput(tab);
  }
}

function resizeCodeTerminal(clientId = codeTerminalState.activeId) {
  const tab = codeTerminalTabs().find(item => item.clientId === clientId) || activeCodeTerminalTab({create: false});
  const term = tab?.term;
  if (!tab || !term || !tab.id) return;
  try {
    tab.fitAddon?.fit?.();
  } catch (_) {}
  const dims = codeTerminalDimensions(tab);
  if (dims.cols === tab.cols && dims.rows === tab.rows) return;
  tab.cols = dims.cols;
  tab.rows = dims.rows;
  if (term.cols !== dims.cols || term.rows !== dims.rows) term.resize(dims.cols, dims.rows);
  apiFetch('/api/terminal/resize', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id: tab.id, cols: dims.cols, rows: dims.rows}),
  }).catch(() => {});
  syncCodeTerminalState(activeCodeTerminalTab({create: false}));
}

function scheduleCodeTerminalResize(clientId = codeTerminalState.activeId) {
  if (codeTerminalResizeTimer) clearTimeout(codeTerminalResizeTimer);
  codeTerminalResizeTimer = setTimeout(() => resizeCodeTerminal(clientId), 80);
}

function interruptCodeTerminal() {
  sendCodeTerminalInput('\x03');
  focusCodeTerminal();
}

document.addEventListener('click', ev => {
  const close = ev.target.closest?.('[data-code-terminal-close]');
  if (close) {
    ev.preventDefault();
    ev.stopPropagation();
    closeCodeTerminalTab(close.getAttribute('data-code-terminal-close') || '');
    return;
  }
  const tab = ev.target.closest?.('[data-code-terminal-tab]');
  if (tab) {
    selectCodeTerminalTab(tab.getAttribute('data-code-terminal-tab') || '');
  }
});

window.addEventListener('resize', () => scheduleCodeTerminalResize());
