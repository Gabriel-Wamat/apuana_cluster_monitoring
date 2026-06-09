initSshLogin();
bootstrapSshAuth();
initSidebarToggle();
initUserSettings();
initCustomSelect('job-queue-sel', {
  pickerId: 'job-queue-picker',
  labelId: 'job-queue-label',
  menuId: 'job-queue-menu',
  placeholder: 'From queue',
  emptyText: 'No jobs in queue.',
  size: 'inline',
});
initCustomSelect('gpu-job-sel', {
  pickerId: 'gpu-job-picker',
  labelId: 'gpu-job-label',
  menuId: 'gpu-job-menu',
  placeholder: 'Your running GPU job',
  emptyText: 'No running GPU jobs.',
  size: 'inline',
});
initCustomSelect('remote-period', {
  placeholder: 'Period',
  emptyText: 'No periods.',
});
setInterval(() => {
  if (typeof window.poll === 'function') window.poll();
}, 5000);

document.querySelectorAll('[data-performance-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (typeof setPerformanceMode === 'function') {
      setPerformanceMode(btn.getAttribute('data-performance-mode') || 'hardware');
    }
  });
});
$('job-queue-sel').addEventListener('change', () => {
  updateJobQueueLabel();
  $('job-id-in').value = '';
  jobState.inspectedId = '';
  if ($('job-queue-sel').value) fetchJob();
});
$('job-id-in').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') {
    jobState.inspectedId = '';
    fetchJob();
  }
});
['log-out-path','log-err-path'].forEach(id => {
  $(id).addEventListener('change', fetchLogs);
});
$('log-folder-path')?.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    openLogFolderFromInput();
  }
});
['download-remote','download-local','upload-remote'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', refreshTransferCommands);
});
$('download-remote')?.addEventListener('input', () => scheduleDownloadRemoteSuggestions(250));
$('download-remote')?.addEventListener('focus', () => scheduleDownloadRemoteSuggestions(0));
$('download-remote')?.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') hideDownloadRemoteSuggestions();
});
$('upload-remote')?.addEventListener('input', () => scheduleUploadRemoteSuggestions(250));
$('upload-remote')?.addEventListener('focus', () => scheduleUploadRemoteSuggestions(0));
$('upload-remote')?.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') hideUploadRemoteSuggestions();
  if (ev.key === 'Enter') hideUploadRemoteSuggestions();
});
$('upload-suggestions-toggle')?.addEventListener('click', ev => {
  ev.preventDefault();
  ev.stopPropagation();
  hideUploadRemoteSuggestions();
});
document.addEventListener('pointerdown', ev => {
  const target = ev.target;
  if (!target?.closest) return;
  if (!target.closest('#download-remote') && !target.closest('#download-remote-suggestions')) {
    hideDownloadRemoteSuggestions();
  }
  if (!target.closest('#upload-remote') && !target.closest('#upload-remote-suggestions') && !target.closest('#upload-suggestions-toggle')) {
    hideUploadRemoteSuggestions();
  }
  if (!target.closest('.remote-tile-actions') && typeof closeRemoteTileMenus === 'function') {
    closeRemoteTileMenus();
  }
  if (!target.closest('#code-folder-select') && !target.closest('#code-folder-menu')) {
    closeCodeFolderMenu();
  }
  closeCustomSelectsOutside(target);
});
window.addEventListener('resize', scheduleTransferBrowserLayout);
window.addEventListener('resize', scheduleOverviewQueueHeightSync);
$('remote-import-open')?.addEventListener('click', () => openImportModal());
$('remote-import-close')?.addEventListener('click', closeImportModal);
$('remote-import-cancel')?.addEventListener('click', closeImportModal);
$('upload-picker-file')?.addEventListener('change', ev => uploadFilesFromInput(ev.target));
$('download-run-rsync')?.addEventListener('click', runDownloadRsync);
$('download-choose-folder')?.addEventListener('click', chooseDownloadFolder);
$('download-clear')?.addEventListener('click', clearDownloadSelection);
$('upload-choose-file')?.addEventListener('click', chooseUploadFile);
$('upload-choose-folder')?.addEventListener('click', chooseUploadFolder);
$('upload-clear')?.addEventListener('click', clearUploadSelection);
$('upload-run-selected')?.addEventListener('click', uploadSelectedToApuana);
$('transfer-feedback-copy')?.addEventListener('click', copyTransferFeedbackDetails);
$('transfer-feedback-retry')?.addEventListener('click', retryLastTransfer);
$('transfer-browse-back')?.addEventListener('click', browseTransferParent);
$('upload-remote-preset')?.addEventListener('change', () => {
  refreshTransferCommands();
  scheduleUploadRemoteSuggestions(0);
});
$('remote-visual-path')?.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') loadRemoteExplorer(undefined, undefined, {pushHistory: true, force: true});
});
$('remote-period')?.addEventListener('change', () => loadRemoteExplorer(undefined, undefined, {force: true}));
$('remote-view-toggle')?.addEventListener('click', toggleRemoteViewMode);
$('remote-back')?.addEventListener('click', remoteExplorerBack);
$('remote-forward')?.addEventListener('click', remoteExplorerForward);
$('remote-home')?.addEventListener('click', remoteExplorerHome);
$('remote-refresh')?.addEventListener('click', () => loadRemoteExplorer(undefined, undefined, {force: true}));
$('remote-delete-cancel')?.addEventListener('click', closeRemoteDelete);
$('remote-delete-confirm')?.addEventListener('click', confirmRemoteDelete);
$('remote-edit-cancel')?.addEventListener('click', closeRemoteEdit);
$('remote-edit-close')?.addEventListener('click', closeRemoteEdit);
$('remote-edit-save')?.addEventListener('click', saveRemoteEdit);
$('code-project-select')?.addEventListener('change', ev => {
  codeState.project = ev.target.value || '';
  codeState.path = codeState.project;
  codeState.query = '';
  if ($('code-search')) $('code-search').value = '';
  loadCodeList({path: codeState.path, query: '', force: true});
});
$('code-search')?.addEventListener('input', scheduleCodeSearch);
$('code-search')?.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') loadCodeList({query: $('code-search')?.value.trim() || ''});
  if (ev.key === 'Escape') closeCodeFolderMenu();
});
$('code-folder-select')?.addEventListener('click', toggleCodeFolderMenu);
$('code-up')?.addEventListener('click', codeUpFolder);
$('code-refresh')?.addEventListener('click', () => {
  codeListCache.clear();
  codeTreeCache.clear();
  codeFolderCache.clear();
  loadCodeProjects(true).then(() => {
    if (codeTreeActivated) loadCodeList({force: true});
    else renderCodeTreeView();
  });
});
$('code-new-file')?.addEventListener('click', () => openCodeCreateModal('file'));
$('code-new-folder')?.addEventListener('click', () => openCodeCreateModal('folder'));
$('code-create-cancel')?.addEventListener('click', closeCodeCreateModal);
$('code-create-confirm')?.addEventListener('click', confirmCodeCreate);
$('code-create-name')?.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') confirmCodeCreate();
  if (ev.key === 'Escape') closeCodeCreateModal();
});
$('code-delete-cancel')?.addEventListener('click', closeCodeDeleteModal);
$('code-delete-confirm')?.addEventListener('click', confirmCodeDelete);
$('code-terminal-toggle')?.addEventListener('click', toggleCodeTerminalPanel);
$('code-terminal-toggle')?.addEventListener('pointerenter', () => {
  if (typeof scheduleCodeTerminalStart === 'function') scheduleCodeTerminalStart();
});
$('code-terminal-close')?.addEventListener('click', closeCodeTerminalPanel);
$('code-terminal-clear')?.addEventListener('click', clearCodeTerminalOutput);
$('code-terminal-interrupt')?.addEventListener('click', interruptCodeTerminal);
$('code-terminal-screen')?.addEventListener('keydown', handleCodeTerminalKeydown);
$('code-terminal-screen')?.addEventListener('paste', pasteCodeTerminalText);
$('remote-delete-modal')?.addEventListener('click', ev => {
  if (ev.target === $('remote-delete-modal')) closeRemoteDelete();
});
$('remote-import-modal')?.addEventListener('click', ev => {
  if (ev.target === $('remote-import-modal')) closeImportModal();
});
$('remote-edit-modal')?.addEventListener('click', ev => {
  if (ev.target === $('remote-edit-modal')) closeRemoteEdit();
});
$('code-create-modal')?.addEventListener('click', ev => {
  if (ev.target === $('code-create-modal')) closeCodeCreateModal();
});
$('code-delete-modal')?.addEventListener('click', ev => {
  if (ev.target === $('code-delete-modal')) closeCodeDeleteModal();
});
['transfer-browse-path','transfer-search'].forEach(id => {
  $(id)?.addEventListener('input', () => {
    if (id === 'transfer-browse-path') updateTransferBackButton();
    if (id === 'transfer-search') lastTransferBrowseKey = '';
    scheduleBrowseTransfer(id === 'transfer-search' ? 180 : 350);
  });
  $(id)?.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      lastTransferBrowseKey = '';
      browseTransfer();
    }
  });
});
['gpu-job-id'].forEach(id => {
  $(id).addEventListener('keydown', ev => {
    if (ev.key === 'Enter') fetchJobGpu();
  });
});
$('gpu-job-sel').addEventListener('change', () => {
  updateGpuJobLabel();
  $('gpu-job-id').value = '';
  gpuState = {...gpuState, jobId:'', response:null, raw:'', loadingId:''};
  fetchJobGpu();
});
if (typeof initResearch === 'function') initResearch();
