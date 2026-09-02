(function attachCodeWorkspaceCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CodeWorkspaceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCodeWorkspaceCore() {
  'use strict';

  const MONACO_LANGUAGES = new Set([
    'bat', 'c', 'cpp', 'csharp', 'css', 'dockerfile', 'go', 'html', 'ini',
    'java', 'javascript', 'json', 'kotlin', 'lua', 'markdown', 'objective-c',
    'perl', 'php', 'plaintext', 'powershell', 'python', 'r', 'ruby', 'rust',
    'shell', 'sql', 'swift', 'typescript', 'xml', 'yaml',
  ]);

  const IMAGE_EXTENSIONS = new Set([
    'apng', 'avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
  ]);

  function monacoLanguage(language) {
    const normalized = String(language || 'plaintext').trim().toLowerCase();
    const aliases = {
      bash: 'shell', cuda: 'cpp', js: 'javascript', jsx: 'javascript', md: 'markdown',
      py: 'python', sh: 'shell', text: 'plaintext', ts: 'typescript',
      tsx: 'typescript', yml: 'yaml',
    };
    const candidate = aliases[normalized] || normalized;
    return MONACO_LANGUAGES.has(candidate) ? candidate : 'plaintext';
  }

  function terminalDimensions(proposed, fallback) {
    const validProposal = Number.isInteger(proposed?.cols) && proposed.cols > 0
      && Number.isInteger(proposed?.rows) && proposed.rows > 0;
    const cols = validProposal ? proposed.cols : (Number(fallback?.cols) || 120);
    const rows = validProposal ? proposed.rows : (Number(fallback?.rows) || 28);
    return {
      cols: Math.max(40, Math.min(240, cols)),
      rows: Math.max(10, Math.min(80, rows)),
    };
  }

  function relativeEntryPath(path, rootPath) {
    const pathValue = String(path || '');
    const root = String(rootPath || '').replace(/\/$/, '');
    if (!root) return pathValue.replace(/^\//, '');
    if (pathValue === root) return '';
    return pathValue.startsWith(`${root}/`) ? pathValue.slice(root.length + 1) : pathValue;
  }

  function fileExtension(path) {
    const filename = String(path || '').split(/[\\/]/).pop().toLowerCase();
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(dot + 1) : '';
  }

  function isImagePath(path) {
    return IMAGE_EXTENSIONS.has(fileExtension(path));
  }

  function terminalCanStart(auth) {
    return !!(auth?.loggedIn && auth?.validated && auth?.token);
  }

  function clusterSnapshotReady(data) {
    return Boolean(data?.ts && data?.queue?.ok && data?.sinfo?.ok && data?.resources?.ok);
  }

  function authenticatedShellReady(data) {
    return Boolean(data?.user || data?.node || data?.transfer?.home);
  }

  return Object.freeze({
    authenticatedShellReady,
    clusterSnapshotReady,
    fileExtension,
    isImagePath,
    monacoLanguage,
    relativeEntryPath,
    terminalCanStart,
    terminalDimensions,
  });
});
