const CODE_TERMINAL_INPUT_FLUSH_MS = 16;
let codeTerminalInputBuffer = '';
let codeTerminalInputTimer = null;
let codeTerminalInputInFlight = false;
let codeTerminalResizeTimer = null;

function codeTerminalDimensions() {
  const screen = $('code-terminal-screen');
  const width = screen?.clientWidth || 960;
  const height = screen?.clientHeight || 240;
  const cellWidth = 8.6;
  const cellHeight = 20.5;
  return {
    cols: Math.max(80, Math.min(240, Math.floor(width / cellWidth))),
    rows: Math.max(8, Math.min(80, Math.floor(height / cellHeight))),
  };
}

function codeTerminalConnectionLabel() {
  const prefix = codeTerminalState.backend === 'local-openssh' ? 'Local SSH' : 'SSH';
  const target = codeTerminalState.host ? `${codeTerminalState.login}@${codeTerminalState.host}` : 'Connected';
  return `${prefix}: ${target}`;
}

function setCodeTerminalStatus(status, label) {
  codeTerminalState.status = status;
  const el = $('code-terminal-status');
  if (!el) return;
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

function ensureCodeTerminalRenderer() {
  if (codeTerminalState.term) return codeTerminalState.term;
  const screen = $('code-terminal-screen');
  if (!screen || !window.Terminal) return null;
  screen.textContent = '';
  const dims = codeTerminalDimensions();
  const term = new window.Terminal({
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
  term.open(screen);
  term.onData(sendCodeTerminalInput);
  codeTerminalState.term = term;
  requestAnimationFrame(resizeCodeTerminal);
  return term;
}

function writeCodeTerminal(data) {
  const term = ensureCodeTerminalRenderer();
  if (!term) return;
  term.write(String(data || ''), () => codeTerminalScrollToPrompt());
}

function codeTerminalScrollToPrompt() {
  const term = codeTerminalState.term;
  if (!term) return;
  try {
    term.scrollToBottom();
  } catch (_) {}
  requestAnimationFrame(() => {
    try {
      term.scrollToBottom();
    } catch (_) {}
  });
}

function clearCodeTerminalOutput() {
  ensureCodeTerminalRenderer()?.clear();
  focusCodeTerminal();
}

function stopCodeTerminalStream() {
  if (codeTerminalState.eventSource) {
    codeTerminalState.eventSource.close();
    codeTerminalState.eventSource = null;
  }
  codeTerminalState.streaming = false;
}

function startCodeTerminalStream() {
  if (!codeTerminalState.id || codeTerminalState.eventSource || !window.EventSource) return;
  const url = `/api/terminal/events?id=${encodeURIComponent(codeTerminalState.id)}&since=${encodeURIComponent(codeTerminalState.seq || 0)}`;
  const source = new EventSource(url);
  codeTerminalState.eventSource = source;
  codeTerminalState.streaming = true;

  source.addEventListener('terminal', ev => {
    try {
      const data = JSON.parse(ev.data || '{}');
      if (!data.ok) throw new Error(data.error || 'Terminal stream ended.');
      codeTerminalState.seq = Number(data.seq || codeTerminalState.seq || 0);
      codeTerminalState.backend = data.backend || codeTerminalState.backend;
      codeTerminalState.host = data.host || codeTerminalState.host;
      codeTerminalState.login = data.login || codeTerminalState.login;
      if (data.output) writeCodeTerminal(data.output);
      setCodeTerminalStatus('connected', codeTerminalConnectionLabel());
      if (data.alive === false) stopCodeTerminalStream();
    } catch (err) {
      setCodeTerminalStatus('error', err?.message || 'Terminal stream error');
      stopCodeTerminalStream();
    }
  });

  source.addEventListener('error', ev => {
    void ev;
    if (!codeTerminalState.id) return;
    setCodeTerminalStatus('connecting', 'Reconnecting terminal...');
  });
}

async function pollCodeTerminalFallback() {
  if (!codeTerminalState.open || !codeTerminalState.id || codeTerminalState.polling || codeTerminalState.eventSource) return;
  codeTerminalState.polling = true;
  try {
    const response = await apiFetch('/api/terminal/read?id=' + encodeURIComponent(codeTerminalState.id));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Terminal session ended.');
    if (data.output) writeCodeTerminal(data.output);
    setCodeTerminalStatus('connected', codeTerminalConnectionLabel());
  } catch (err) {
    setCodeTerminalStatus('error', err?.message || 'Terminal error');
    return;
  } finally {
    codeTerminalState.polling = false;
  }
  codeTerminalState.pollTimer = setTimeout(pollCodeTerminalFallback, 500);
}

async function ensureCodeTerminalSession() {
  ensureCodeTerminalRenderer();
  if (codeTerminalState.id) {
    startCodeTerminalStream();
    if (!window.EventSource) pollCodeTerminalFallback();
    return true;
  }
  if (codeTerminalState.startPromise) return codeTerminalState.startPromise;

  setCodeTerminalStatus('connecting', 'Starting local SSH...');
  codeTerminalState.starting = true;
  codeTerminalState.startPromise = (async () => {
    try {
      const dims = codeTerminalDimensions();
      const cwd = codeState.path || codeState.project || transferState.home || '';
      const response = await apiFetch('/api/terminal/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({cols: dims.cols, rows: dims.rows, cwd}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not start terminal.');
      codeTerminalState.id = data.id || '';
      codeTerminalState.host = data.host || '';
      codeTerminalState.login = data.login || '';
      codeTerminalState.backend = data.backend || '';
      codeTerminalState.seq = Number(data.seq || 0);
      if (data.output) writeCodeTerminal(data.output);
      setCodeTerminalStatus('connected', codeTerminalConnectionLabel());
      startCodeTerminalStream();
      if (!window.EventSource) pollCodeTerminalFallback();
      if (codeTerminalState.pendingInput) {
        const pending = codeTerminalState.pendingInput;
        codeTerminalState.pendingInput = '';
        sendCodeTerminalInput(pending);
      }
      return true;
    } catch (err) {
      setCodeTerminalStatus('error', err?.message || 'Terminal error');
      writeCodeTerminal(`\r\n${err?.message || 'Could not start terminal.'}\r\n`);
      return false;
    } finally {
      codeTerminalState.starting = false;
      codeTerminalState.startPromise = null;
    }
  })();
  return codeTerminalState.startPromise;
}

function warmCodeTerminalSession() {
  ensureCodeTerminalSession();
}

function scheduleCodeTerminalStart() {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmCodeTerminalSession, {timeout: 80});
  } else {
    setTimeout(warmCodeTerminalSession, 0);
  }
}

function focusCodeTerminal() {
  ensureCodeTerminalRenderer()?.focus();
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
  ensureCodeTerminalRenderer();
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
}

function toggleCodeTerminalPanel() {
  if (codeTerminalState.open) closeCodeTerminalPanel();
  else openCodeTerminalPanel();
}

function queueCodeTerminalInput(data) {
  codeTerminalState.pendingInput = (codeTerminalState.pendingInput + data).slice(-8192);
  setCodeTerminalStatus('connecting', 'Starting local SSH...');
  warmCodeTerminalSession();
}

function sendCodeTerminalInput(data) {
  if (!data) return Promise.resolve(false);
  if (!codeTerminalState.id) {
    queueCodeTerminalInput(data);
    return Promise.resolve(false);
  }
  codeTerminalInputBuffer += data;
  if (!codeTerminalInputTimer) {
    codeTerminalInputTimer = setTimeout(flushCodeTerminalInput, CODE_TERMINAL_INPUT_FLUSH_MS);
  }
  return Promise.resolve(true);
}

async function flushCodeTerminalInput() {
  codeTerminalInputTimer = null;
  if (codeTerminalInputInFlight || !codeTerminalState.id || !codeTerminalInputBuffer) return;
  const data = codeTerminalInputBuffer;
  codeTerminalInputBuffer = '';
  codeTerminalInputInFlight = true;
  try {
    const response = await apiFetch('/api/terminal/input', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: codeTerminalState.id, data}),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || 'Could not write to terminal.');
    setCodeTerminalStatus('connected', codeTerminalConnectionLabel());
  } catch (err) {
    setCodeTerminalStatus('error', err?.message || 'Terminal error');
  } finally {
    codeTerminalInputInFlight = false;
    if (codeTerminalInputBuffer) flushCodeTerminalInput();
  }
}

function resizeCodeTerminal() {
  const term = codeTerminalState.term;
  if (!term || !codeTerminalState.id) return;
  const dims = codeTerminalDimensions();
  if (dims.cols === codeTerminalState.cols && dims.rows === codeTerminalState.rows) return;
  codeTerminalState.cols = dims.cols;
  codeTerminalState.rows = dims.rows;
  term.resize(dims.cols, dims.rows);
  codeTerminalScrollToPrompt();
  apiFetch('/api/terminal/resize', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id: codeTerminalState.id, cols: dims.cols, rows: dims.rows}),
  }).catch(() => {});
}

function scheduleCodeTerminalResize() {
  if (codeTerminalResizeTimer) clearTimeout(codeTerminalResizeTimer);
  codeTerminalResizeTimer = setTimeout(resizeCodeTerminal, 80);
}

function interruptCodeTerminal() {
  sendCodeTerminalInput('\x03');
  focusCodeTerminal();
}

function handleCodeTerminalKeydown() {}
function pasteCodeTerminalText() {}

window.addEventListener('resize', scheduleCodeTerminalResize);
