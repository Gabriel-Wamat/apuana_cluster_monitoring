const CODE_TERMINAL_MAX_BUFFER = 60000;
const CODE_TERMINAL_POLL_MS = 220;
let codeTerminalRenderFrame = 0;
let codeTerminalLastDisplay = null;

function codeTerminalDimensions() {
  const screen = $('code-terminal-screen');
  const width = screen?.clientWidth || 960;
  const height = screen?.clientHeight || 220;
  return {
    cols: Math.max(80, Math.min(220, Math.floor(width / 7.2))),
    rows: Math.max(10, Math.min(70, Math.floor(height / 16))),
  };
}

function cleanTerminalOutput(value) {
  return normalizeTerminalControls(String(value || '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, ''));
}

function normalizeTerminalControls(value) {
  const chars = [];
  for (const char of String(value || '')) {
    const code = char.charCodeAt(0);
    if (char === '\b' || code === 127) {
      const last = chars[chars.length - 1];
      if (last && last !== '\n') chars.pop();
      continue;
    }
    if (char === '\n' || char === '\t' || code >= 32) {
      chars.push(char);
    }
  }
  return chars.join('');
}

function setCodeTerminalStatus(status, label) {
  codeTerminalState.status = status;
  const el = $('code-terminal-status');
  if (!el) return;
  el.className = `code-terminal-status ${status}`;
  el.textContent = label || status;
}

function trimCodeTerminalBuffer(value) {
  const text = String(value || '');
  if (text.length <= CODE_TERMINAL_MAX_BUFFER) return text;
  const cut = text.length - CODE_TERMINAL_MAX_BUFFER;
  const nextLine = text.indexOf('\n', cut);
  return text.slice(nextLine >= 0 ? nextLine + 1 : cut);
}

function codeTerminalDisplayOutput() {
  return String(codeTerminalState.output || '').replace(/^[\n\t ]+/, '');
}

function flushCodeTerminalOutput() {
  codeTerminalRenderFrame = 0;
  const output = $('code-terminal-output');
  const screen = $('code-terminal-screen');
  if (!output || !screen) return;
  const nearBottom = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 48;
  const display = codeTerminalDisplayOutput();
  if (display !== codeTerminalLastDisplay) {
    output.textContent = display;
    codeTerminalLastDisplay = display;
  }
  if (nearBottom) screen.scrollTop = screen.scrollHeight;
}

function renderCodeTerminalOutput(options = {}) {
  if (options.immediate) {
    if (codeTerminalRenderFrame) {
      cancelAnimationFrame(codeTerminalRenderFrame);
      codeTerminalRenderFrame = 0;
    }
    flushCodeTerminalOutput();
    return;
  }
  if (codeTerminalRenderFrame) return;
  codeTerminalRenderFrame = requestAnimationFrame(flushCodeTerminalOutput);
}

function appendCodeTerminalOutput(value) {
  const next = cleanTerminalOutput(value);
  if (!next) return;
  codeTerminalState.output = trimCodeTerminalBuffer(codeTerminalState.output + next);
  renderCodeTerminalOutput();
}

function stopCodeTerminalPolling() {
  if (codeTerminalState.pollTimer) {
    clearTimeout(codeTerminalState.pollTimer);
    codeTerminalState.pollTimer = null;
  }
  codeTerminalState.polling = false;
}

async function pollCodeTerminal() {
  if (!codeTerminalState.open || !codeTerminalState.id || codeTerminalState.polling) return;
  codeTerminalState.polling = true;
  try {
    const response = await apiFetch('/api/terminal/read?id=' + encodeURIComponent(codeTerminalState.id));
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Terminal session ended.');
    appendCodeTerminalOutput(data.output || '');
    setCodeTerminalStatus('connected', codeTerminalState.host ? `${codeTerminalState.login}@${codeTerminalState.host}` : 'Connected');
  } catch (err) {
    setCodeTerminalStatus('error', err?.message || 'Terminal error');
    stopCodeTerminalPolling();
    return;
  } finally {
    codeTerminalState.polling = false;
  }
  codeTerminalState.pollTimer = setTimeout(pollCodeTerminal, CODE_TERMINAL_POLL_MS);
}

async function ensureCodeTerminalSession() {
  if (codeTerminalState.id) {
    pollCodeTerminal();
    return true;
  }
  if (codeTerminalState.startPromise) return codeTerminalState.startPromise;
  setCodeTerminalStatus('connecting', 'Starting SSH...');
  const dims = codeTerminalDimensions();
  const cwd = codeState.path || codeState.project || transferState.home || '';
  codeTerminalState.starting = true;
  codeTerminalState.startPromise = (async () => {
    try {
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
      appendCodeTerminalOutput(data.output || '');
      setCodeTerminalStatus('connected', codeTerminalState.host ? `${codeTerminalState.login}@${codeTerminalState.host}` : 'Connected');
      pollCodeTerminal();
      if (codeTerminalState.pendingInput) {
        const pending = codeTerminalState.pendingInput;
        codeTerminalState.pendingInput = '';
        sendCodeTerminalInput(pending);
      }
      return true;
    } catch (err) {
      setCodeTerminalStatus('error', err?.message || 'Terminal error');
      appendCodeTerminalOutput(`\n${err?.message || 'Could not start terminal.'}\n`);
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

function queueCodeTerminalInput(data) {
  codeTerminalState.pendingInput = (codeTerminalState.pendingInput + data).slice(-CODE_TERMINAL_MAX_BUFFER);
  setCodeTerminalStatus('connecting', 'Starting SSH...');
  renderCodeTerminalOutput();
  warmCodeTerminalSession();
}

function scheduleCodeTerminalStart() {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmCodeTerminalSession, {timeout: 80});
  } else {
    setTimeout(warmCodeTerminalSession, 0);
  }
}

function focusCodeTerminal() {
  const screen = $('code-terminal-screen');
  if (screen) screen.focus({preventScroll: true});
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
  renderCodeTerminalOutput({immediate: true});
  focusCodeTerminal();
  scheduleCodeTerminalStart();
}

function closeCodeTerminalPanel() {
  const view = $('view-code');
  const panel = $('code-terminal-panel');
  const toggle = $('code-terminal-toggle');
  codeTerminalState.open = false;
  stopCodeTerminalPolling();
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

async function sendCodeTerminalInput(data) {
  if (!data) return;
  if (!codeTerminalState.id) {
    queueCodeTerminalInput(data);
    return;
  }
  try {
    const response = await apiFetch('/api/terminal/input', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: codeTerminalState.id, data}),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || 'Could not write to terminal.');
    appendCodeTerminalOutput(body.output || '');
    setCodeTerminalStatus('connected', codeTerminalState.host ? `${codeTerminalState.login}@${codeTerminalState.host}` : 'Connected');
  } catch (err) {
    setCodeTerminalStatus('error', err?.message || 'Terminal error');
  }
}

function handleCodeTerminalKeydown(ev) {
  if (!codeTerminalState.open) return;
  let data = '';
  if (ev.ctrlKey && !ev.metaKey && String(ev.key || '').toLowerCase() === 'c') data = '\x03';
  else if (ev.key === 'Enter') data = '\n';
  else if (ev.key === 'Backspace') data = '\x7f';
  else if (ev.key === 'Tab') data = '\t';
  else if (ev.key === 'ArrowUp') data = '\x1b[A';
  else if (ev.key === 'ArrowDown') data = '\x1b[B';
  else if (ev.key === 'ArrowRight') data = '\x1b[C';
  else if (ev.key === 'ArrowLeft') data = '\x1b[D';
  else if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && String(ev.key || '').length === 1) data = ev.key;
  if (!data) return;
  ev.preventDefault();
  ev.stopPropagation();
  sendCodeTerminalInput(data);
}

function clearCodeTerminalOutput() {
  codeTerminalState.output = '';
  codeTerminalLastDisplay = null;
  renderCodeTerminalOutput({immediate: true});
  focusCodeTerminal();
}

function interruptCodeTerminal() {
  sendCodeTerminalInput('\x03');
  focusCodeTerminal();
}

function pasteCodeTerminalText(ev) {
  const text = ev.clipboardData?.getData('text/plain') || '';
  if (!text) return;
  ev.preventDefault();
  sendCodeTerminalInput(text);
}
