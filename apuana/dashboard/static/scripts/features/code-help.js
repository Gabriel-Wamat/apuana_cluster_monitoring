const CODE_HELP_STORAGE_KEY = 'apuana.code.help.markdown.v1';
const CODE_HELP_DEFAULT_URL = '/static/content/apuana-guide.md';
let codeHelpDefaultMarkdownCache = '';

function codeHelpEl(id) {
  return document.getElementById(id);
}

function codeHelpEscape(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

async function loadCodeHelpDefaultMarkdown() {
  if (codeHelpDefaultMarkdownCache) return codeHelpDefaultMarkdownCache;
  try {
    const response = await fetch(CODE_HELP_DEFAULT_URL, { cache: 'no-store' });
    if (response.ok) {
      codeHelpDefaultMarkdownCache = await response.text();
      return codeHelpDefaultMarkdownCache;
    }
  } catch (error) {
    console.warn('Could not load Apuana help markdown', error);
  }
  codeHelpDefaultMarkdownCache = '# Guia Pratico - Uso do Cluster Apuana\n\nConteudo de ajuda indisponivel.';
  return codeHelpDefaultMarkdownCache;
}

function readStoredCodeHelpMarkdown() {
  try {
    return localStorage.getItem(CODE_HELP_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function storeCodeHelpMarkdown(value) {
  try {
    localStorage.setItem(CODE_HELP_STORAGE_KEY, value);
  } catch (error) {
    console.warn('Could not save Apuana help markdown', error);
  }
}

function clearStoredCodeHelpMarkdown() {
  try {
    localStorage.removeItem(CODE_HELP_STORAGE_KEY);
  } catch (error) {
    // localStorage may be unavailable in locked-down browser contexts.
  }
}

async function getCodeHelpMarkdown() {
  return readStoredCodeHelpMarkdown() || await loadCodeHelpDefaultMarkdown();
}

function renderCodeHelpPreview(markdown) {
  const pane = codeHelpEl('code-help-preview-pane');
  if (!pane) return;
  if (typeof renderMarkdownPreview === 'function') {
    pane.innerHTML = renderMarkdownPreview(markdown);
    return;
  }
  pane.innerHTML = `<article class="markdown-preview"><pre>${codeHelpEscape(markdown)}</pre></article>`;
}

function setCodeHelpMode(mode) {
  const preview = codeHelpEl('code-help-preview-pane');
  const editor = codeHelpEl('code-help-editor');
  const previewBtn = codeHelpEl('code-help-preview-mode');
  const editBtn = codeHelpEl('code-help-edit-mode');
  const isEdit = mode === 'edit';
  if (preview) preview.classList.toggle('hidden', isEdit);
  if (editor) editor.classList.toggle('hidden', !isEdit);
  if (previewBtn) previewBtn.classList.toggle('active', !isEdit);
  if (editBtn) editBtn.classList.toggle('active', isEdit);
  if (isEdit && editor) setTimeout(() => editor.focus(), 0);
}

async function openCodeHelp() {
  const modal = codeHelpEl('code-help-modal');
  const editor = codeHelpEl('code-help-editor');
  if (!modal || !editor) return;
  const markdown = await getCodeHelpMarkdown();
  editor.value = markdown;
  renderCodeHelpPreview(markdown);
  setCodeHelpMode('preview');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCodeHelp() {
  const modal = codeHelpEl('code-help-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function resetCodeHelp() {
  const editor = codeHelpEl('code-help-editor');
  clearStoredCodeHelpMarkdown();
  const markdown = await loadCodeHelpDefaultMarkdown();
  if (editor) editor.value = markdown;
  renderCodeHelpPreview(markdown);
  setCodeHelpMode('preview');
}

function saveCodeHelp() {
  const editor = codeHelpEl('code-help-editor');
  const saveButton = codeHelpEl('code-help-save');
  if (!editor) return;
  storeCodeHelpMarkdown(editor.value);
  renderCodeHelpPreview(editor.value);
  setCodeHelpMode('preview');
  if (saveButton) {
    const previous = saveButton.textContent;
    saveButton.textContent = 'Saved';
    setTimeout(() => { saveButton.textContent = previous || 'Save'; }, 1200);
  }
}

function initCodeHelp() {
  const modal = codeHelpEl('code-help-modal');
  codeHelpEl('code-help-open')?.addEventListener('click', openCodeHelp);
  codeHelpEl('code-help-close')?.addEventListener('click', closeCodeHelp);
  codeHelpEl('code-help-cancel')?.addEventListener('click', closeCodeHelp);
  codeHelpEl('code-help-preview-mode')?.addEventListener('click', () => {
    const editor = codeHelpEl('code-help-editor');
    renderCodeHelpPreview(editor ? editor.value : '');
    setCodeHelpMode('preview');
  });
  codeHelpEl('code-help-edit-mode')?.addEventListener('click', () => setCodeHelpMode('edit'));
  codeHelpEl('code-help-save')?.addEventListener('click', saveCodeHelp);
  codeHelpEl('code-help-reset')?.addEventListener('click', resetCodeHelp);
  modal?.addEventListener('click', event => {
    if (event.target === modal) closeCodeHelp();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal?.classList.contains('open')) closeCodeHelp();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCodeHelp);
} else {
  initCodeHelp();
}

window.openCodeHelp = openCodeHelp;
