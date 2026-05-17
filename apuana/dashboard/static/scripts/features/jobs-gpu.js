function runningJobRows(d) {
  return (d?.queue?.rows || []).filter(row => row[4] === 'RUNNING');
}

function jobPriority(row, currentUser) {
  const isMine = row[1] === currentUser ? 0 : 1;
  const stateRank = row[4] === 'RUNNING' ? 0 : row[4] === 'PENDING' ? 1 : 2;
  return `${isMine}-${stateRank}-${row[0]}`;
}

function orderedJobRows(d) {
  const user = d?.user || '';
  return [...(d?.queue?.rows || [])].sort((a, b) =>
    jobPriority(a, user).localeCompare(jobPriority(b, user), undefined, {numeric:true})
  );
}

function preferredJobId(d) {
  const user = d?.user || '';
  const rows = orderedJobRows(d);
  const mine = rows.find(row => row[1] === user && row[4] === 'RUNNING')
    || rows.find(row => row[1] === user)
    || rows[0];
  return mine?.[0] || '';
}

function populateJobSelect(d) {
  const sel = $('job-queue-sel');
  if (!sel) return '';
  const rows = orderedJobRows(d);
  const preferred = preferredJobId(d);
  const previous = sel.value || jobState.inspectedId || preferred;
  sel.innerHTML = '<option value="">From queue</option>' +
    rows.map(row => {
      const mine = row[1] === d?.user ? 'Mine - ' : '';
      const state = row[4] || '';
      const label = `${mine}${row[0]} - ${row[3]}`;
      const title = state ? `${label} · ${state}` : label;
      return `<option value="${esc(row[0])}" title="${esc(title)}" data-state="${esc(state)}" data-user="${esc(row[1] || '')}">${esc(label)}</option>`;
    }).join('');

  if (previous && rows.some(row => row[0] === previous)) {
    sel.value = previous;
  } else if (preferred) {
    sel.value = preferred;
  }
  updateJobQueueLabel();
  return sel.value;
}

function updateJobQueueLabel() {
  refreshCustomSelect('job-queue-sel');
}

function openJobQueueMenu() {
  openCustomSelect('job-queue-sel');
}

function closeJobQueueMenu() {
  closeCustomSelect('job-queue-sel');
}

function toggleJobQueueMenu() {
  toggleCustomSelect('job-queue-sel');
}

function selectJobQueueValue(value) {
  setCustomSelectValue('job-queue-sel', value);
}

function updateGpuJobLabel() {
  refreshCustomSelect('gpu-job-sel');
}

function openGpuJobMenu() {
  openCustomSelect('gpu-job-sel');
}

function closeGpuJobMenu() {
  closeCustomSelect('gpu-job-sel');
}

function toggleGpuJobMenu() {
  toggleCustomSelect('gpu-job-sel');
}

function selectGpuJobValue(value) {
  setCustomSelectValue('gpu-job-sel', value);
}

function maybeAutoInspectJob() {
  const input = $('job-id-in');
  if (input?.value.trim() && document.activeElement === input) return;
  const id = input?.value.trim() || $('job-queue-sel')?.value || '';
  if (!id || jobState.inspectedId === id || jobState.loadingId === id) return;
  fetchJob(id);
}

function ownRunningGpuJobs(d) {
  const user = d?.user || '';
  return (d?.resources?.running_jobs || [])
    .filter(job => job.user === user && Number(job.gpus || 0) > 0);
}

function selectedGpuJobId() {
  return ($('gpu-job-id')?.value || '').trim() || ($('gpu-job-sel')?.value || '').trim();
}

function renderGpuResult(data) {
  if (!data) return;
  const gpus = data.gpus || [];
  const raw = [
    `$ ${data.command || `srun --immediate=1 --jobid=${data.base_job_id || data.job_id || ''} nvidia-smi`}`,
    data.stdout || data.stderr || data.error || ''
  ].filter(Boolean).join('\n\n');
  gpuState = {
    ...gpuState,
    jobId:data.job_id || selectedGpuJobId(),
    response:data,
    raw,
    loadingId:'',
  };
  $('gpu-output').textContent = raw;
  $('gpu-output').hidden = !gpuState.rawVisible || !raw;

  if (!data.ok) {
    $('gpu-status').innerHTML = `<div class="alert a-warn">${esc(data.error || 'GPU telemetry unavailable for this job.')}</div>`;
    $('gpu-cards').innerHTML = '';
    return;
  }

  $('gpu-status').innerHTML = `<div class="gpu-live">
    <span class="gpu-live-dot"></span>
    <span>Live telemetry for job <strong>${esc(data.base_job_id || data.job_id)}</strong></span>
  </div>`;
  $('gpu-cards').innerHTML = gpus.map(g => {
    const mPct = Math.round(g.mem_used / g.mem_total * 100);
    const utilTone = g.util >= 80 ? 'metric-ok' : g.util >= 30 ? 'metric-info' : '';
    const tempTone = g.temp > 80 ? 'metric-danger' : g.temp > 65 ? 'metric-warn' : '';
    return `<div class="gpu-detail-card">
      <div class="job-hero gpu-hero">
        <div>
          <div class="job-id">GPU ${esc(g.index)}</div>
          <div class="job-title">${esc(g.name)}</div>
          <div class="job-sub">Job ${esc(data.base_job_id || data.job_id)} · nvidia-smi via srun</div>
        </div>
        <span class="job-state ${tempTone}">${esc(g.temp)}&deg;C</span>
      </div>

      <div class="job-metrics gpu-job-metrics">
        ${jobMetric('Utilization', `${g.util}%`, 'compute load', utilTone)}
        ${jobMetric('VRAM used', `${g.mem_used} MiB`, `${mPct}% of device memory`, 'metric-info')}
        ${jobMetric('VRAM total', `${g.mem_total} MiB`, 'available on device', '')}
        ${jobMetric('Temperature', `${g.temp}°C`, 'current reading', tempTone)}
      </div>

      <div class="gpu-bar-section">
        ${prog(g.util,'pp','Utilization',`${g.util}%`)}
        ${prog(mPct,'pi','VRAM',`${g.mem_used} / ${g.mem_total} MiB`)}
      </div>
    </div>`;
  }).join('');
}

function toggleGpuRaw() {
  gpuState.rawVisible = !gpuState.rawVisible;
  const rawEl = $('gpu-output');
  rawEl.hidden = !gpuState.rawVisible || !gpuState.raw;
}

function populateGpuJobs(d) {
  const sel = $('gpu-job-sel');
  if (!sel) return [];
  const running = ownRunningGpuJobs(d);
  const previous = sel.value || gpuState.jobId;
  sel.innerHTML = '<option value="">Your running GPU job</option>' +
    running.map(job => {
      const label = `${job.job_id} - ${job.name || 'gpu job'}`;
      const title = job.partition ? `${label} · ${job.partition}` : label;
      return `<option value="${esc(job.job_id)}" title="${esc(title)}" data-state="RUNNING">${esc(label)}</option>`;
    }).join('');
  if (previous && running.some(job => job.job_id === previous)) {
    sel.value = previous;
  } else if (!selectedGpuJobId() && running.length) {
    sel.value = running[0].job_id;
  }
  updateGpuJobLabel();
  return running;
}

function ensureGpuReady() {
  const running = populateGpuJobs(_last);
  const jobId = selectedGpuJobId();
  if (!running.length && !jobId) {
    $('gpu-status').innerHTML = '<div class="alert a-warn">No RUNNING GPU jobs for this user.</div>';
    $('gpu-cards').innerHTML = '';
    $('gpu-output').textContent = 'No running GPU job selected.';
  }
}
