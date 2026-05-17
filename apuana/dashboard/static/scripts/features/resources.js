function resourceMetric(label, value, sub, tone) {
  return `<div class="resource-metric">
    <span>${esc(label)}</span>
    <strong class="${tone || ''}">${esc(value)}</strong>
    <small>${esc(sub || '')}</small>
  </div>`;
}

function renderResources(d) {
  const res = d.resources || {};
  if (!res.ok) {
    $('resource-summary').innerHTML = `<div class="alert a-warn">${esc(res.error || 'Resource data unavailable.')}</div>`;
    return;
  }

  const running = res.running || {};
  const pending = res.pending || {};
  const current = res.current_user || {};
  const load = res.login_cpu || {};
  const mem = d.mem || {};
  const loadText = `${Number(load.load1 || 0).toFixed(2)} / ${Number(load.cpus || 0)} cores`;
  const memText = mem.pct != null ? `${mem.used} / ${mem.total}` : '-';

  $('resource-summary').innerHTML = `<div class="resource-metrics">
    ${resourceMetric('Running CPUs', running.cpus || 0, `${running.jobs || 0} running job(s)`, 'metric-ok')}
    ${resourceMetric('Requested RAM', running.mem_human || fmtMemMb(running.mem_mb), 'RUNNING jobs', 'metric-info')}
    ${resourceMetric('Pending CPUs', pending.cpus || 0, `${pending.jobs || 0} pending job(s)`, 'metric-warn')}
    ${resourceMetric('Your CPUs', current.cpus || 0, `${current.mem_human || fmtMemMb(current.mem_mb)} RAM`, 'metric-ok')}
    ${resourceMetric('Login RAM', memText, `${mem.pct ?? '-'}% used`, mem.pct >= 85 ? 'metric-danger' : '')}
    ${resourceMetric('Login load', loadText, '1 minute average', load.load_pct >= 85 ? 'metric-danger' : '')}
  </div>`;

}

function cleanValue(value) {
  const s = String(value ?? '').trim();
  return s && s !== '(null)' && s !== 'N/A' ? s : '-';
}

function jobMetric(label, value, sub, tone, options = {}) {
  const extraClass = options.className ? ` ${options.className}` : '';
  const subClass = options.subClass ? ` ${options.subClass}` : '';
  const detail = options.subHtml != null ? options.subHtml : esc(cleanValue(sub));
  return `<div class="job-metric${extraClass}">
    <span>${esc(label)}</span>
    <strong class="${tone || ''}">${esc(cleanValue(value))}</strong>
    <small class="job-metric-detail${subClass}">${detail}</small>
  </div>`;
}

function tresMetricChips(value) {
  const parts = cleanValue(value)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  const items = parts.length ? parts : ['-'];
  return items.map(part => `<span class="job-metric-chip">${esc(part)}</span>`).join('');
}

function jobField(label, value, mono) {
  return `<div class="job-field">
    <span>${esc(label)}</span>
    <strong class="${mono ? 'job-mono' : ''}" title="${esc(cleanValue(value))}">${esc(cleanValue(value))}</strong>
  </div>`;
}

function jobSection(title, rows) {
  return `<div class="job-section">
    <div class="job-section-title">${esc(title)}</div>
    ${rows.join('')}
  </div>`;
}

function renderJobInfo(data) {
  jobState.loadingId = '';
  jobState.inspectedId = data?.summary?.job_id || data?.job_id || jobState.inspectedId;
  jobState.raw = data?.raw || '';
  const rawEl = $('job-raw-output');
  rawEl.textContent = jobState.raw || '';
  rawEl.hidden = !jobState.rawVisible || !jobState.raw;

  if (!data?.ok) {
    $('job-output').className = '';
    $('job-output').innerHTML = `<div class="alert a-danger">${esc(data?.error || 'Job lookup failed.')}</div>`;
    return;
  }

  const s = data.summary || {};
  const r = data.resources || {};
  const state = cleanValue(s.state);
  const stateClass = scCls(state);
  const gpuTone = Number(r.gpus || 0) ? 'metric-info' : '';

  $('job-output').className = '';
  $('job-output').innerHTML = `
    <div class="job-hero">
      <div>
        <div class="job-id">Job ${esc(s.job_id || data.job_id)}</div>
        <div class="job-title">${esc(cleanValue(s.name))}</div>
        <div class="job-sub">${esc(cleanValue(s.user))} · ${esc(cleanValue(s.account))} · ${esc(cleanValue(s.qos))}</div>
      </div>
      <span class="job-state ${stateClass}">${esc(state)}</span>
    </div>

    <div class="job-metrics">
      ${jobMetric('Runtime', s.runtime, `limit ${cleanValue(s.time_limit)}`, 'metric-ok')}
      ${jobMetric('CPUs', r.cpus || '-', `${r.tasks || '-'} task(s), ${r.cpus_per_task || '-'} per task`, 'metric-ok')}
      ${jobMetric('Memory', r.memory || '-', `${r.nodes || '-'} node(s)`, 'metric-info')}
      ${jobMetric('GPUs', r.gpus || 0, r.tres_per_node || r.tres || '-', gpuTone, {
        className: 'job-metric--gpu',
        subClass: 'job-metric-detail--chips',
        subHtml: tresMetricChips(r.tres_per_node || r.tres || '-'),
      })}
    </div>

    <div class="job-sections">
      ${jobSection('Scheduling', [
        jobField('Partition', s.partition),
        jobField('Reason', s.reason),
        jobField('Scheduler', s.scheduler),
        jobField('Exit code', s.exit_code),
      ])}
      ${jobSection('Timeline', [
        jobField('Submitted', s.submit_time, true),
        jobField('Started', s.start_time, true),
        jobField('Ends', s.end_time, true),
      ])}
      ${jobSection('Placement', [
        jobField('Nodes', s.node_list, true),
        jobField('Batch host', s.batch_host, true),
      ])}
      ${jobSection('Files', [
        jobField('Work dir', s.work_dir, true),
        jobField('Command', s.command, true),
        jobField('Stdout', s.stdout, true),
        jobField('Stderr', s.stderr, true),
      ])}
    </div>`;
}

function toggleJobRaw() {
  jobState.rawVisible = !jobState.rawVisible;
  const rawEl = $('job-raw-output');
  rawEl.hidden = !jobState.rawVisible || !jobState.raw;
}
