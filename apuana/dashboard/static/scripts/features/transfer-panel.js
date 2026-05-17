function transferStatusIcon(type) {
  if (type === 'success') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  }
  if (type === 'error') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  }
  if (type === 'running') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-8 6 16 3-8h4"/></svg>';
}

function transferSelectedIcon(kind) {
  const isDir = kind === 'directory' || kind === 'dir';
  return isDir
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>';
}

function transferDetailText(payload = {}) {
  return [
    payload.command ? `$ ${payload.command}` : '',
    payload.auth ? `auth: ${payload.auth}` : '',
    payload.stdout || '',
    payload.stderr ? `stderr:\n${payload.stderr}` : '',
    payload.error ? `error:\n${payload.error}` : '',
  ].filter(Boolean).join('\n\n');
}

function transferSetFeedback(type, payload = {}) {
  transferFeedbackState = {
    type: type || 'idle',
    mode: payload.mode || transferFeedbackState.mode || '',
    title: payload.title || transferFeedbackState.title || 'Ready',
    message: payload.message || '',
    details: payload.details || transferDetailText(payload),
    command: payload.command || '',
    canRetry: !!payload.canRetry,
  };
  renderTransferFeedback();
}

function renderTransferFeedback() {
  const box = $('transfer-feedback');
  if (!box) return;
  const state = transferFeedbackState || {};
  const type = state.type || 'idle';
  const showFeedback = type !== 'idle';
  box.className = `transfer-feedback ${type}${showFeedback ? '' : ' hidden'}`;
  if (!showFeedback) return;
  $('transfer-feedback-icon').innerHTML = transferStatusIcon(type);
  $('transfer-feedback-title').textContent = state.title || 'Ready';
  $('transfer-feedback-message').textContent = state.message || '';
  const details = $('transfer-feedback-details');
  const detailText = state.details || '';
  if (details) {
    details.textContent = detailText;
    details.classList.toggle('hidden', !detailText);
  }
  const copy = $('transfer-feedback-copy');
  const retry = $('transfer-feedback-retry');
  if (copy) copy.disabled = !detailText;
  if (retry) retry.disabled = !state.canRetry || !state.mode;
}

function selectedRemotePath() {
  return transferState.selectedPath || '';
}

function renderTransferPanel() {
  const remotePath = selectedRemotePath();
  const selectedKind = transferState.selectedKind || '';
  const downloadTarget = downloadState.localFolder || $('download-local')?.value.trim() || '';
  const uploadRemote = getUploadRemotePath();
  const uploadFiles = uploadState.files || [];
  const selectedCard = $('transfer-selected-card');
  const downloadSourceChip = $('download-source-chip');

  if (downloadSourceChip) {
    downloadSourceChip.textContent = remotePath
      ? `Source: ${displayRemotePath(remotePath)}`
      : 'No remote item selected.';
    downloadSourceChip.classList.toggle('ready', !!remotePath);
  }

  if ($('transfer-selected-icon')) {
    $('transfer-selected-icon').innerHTML = transferSelectedIcon(selectedKind);
    $('transfer-selected-icon').classList.toggle('directory', selectedKind === 'directory');
  }
  if ($('transfer-selected-title')) {
    $('transfer-selected-title').textContent = remotePath ? basenameRemotePath(remotePath) : 'No remote item selected';
  }
  if ($('transfer-selected-path')) {
    $('transfer-selected-path').textContent = remotePath || 'Select a file or folder on the left to download.';
  }
  if (selectedCard) selectedCard.classList.toggle('is-empty', !remotePath);
  if ($('transfer-upload-target')) {
    $('transfer-upload-target').textContent = uploadRemote ? `Destination: ${uploadRemote}` : 'Destination: -';
  }

  const downloadReady = !!remotePath && !!downloadTarget;
  const uploadReady = uploadFiles.length > 0 && !!uploadRemote;
  if ($('download-run-rsync')) $('download-run-rsync').disabled = !downloadReady;
  if ($('upload-run-selected')) $('upload-run-selected').disabled = !uploadReady;
  renderTransferFeedback();
}

function copyTransferFeedbackDetails() {
  const details = transferFeedbackState?.details || '';
  if (!details.trim()) return;
  navigator.clipboard?.writeText(details);
}

function retryLastTransfer() {
  if (transferFeedbackState.mode === 'download') {
    runDownloadRsync();
    return;
  }
  if (transferFeedbackState.mode === 'upload') uploadSelectedToApuana();
}
