const $ = id => document.getElementById(id);
const hist = {run:[], pnd:[], total:[]};
const MAX_HIST = 30;
const SPARKLINE_COLOR = 'var(--spark)';
const sparkRegistry = new Map();
let sparkFrame = null;
let _last = {};
let transferState = {user:'', host:'slurm-client1.cin.ufpe.br', home:'', current:'', selectedKind:''};
let gpuState = {jobId:'', response:null, raw:'', rawVisible:false, loadingId:''};
let jobState = {raw:'', rawVisible:false, inspectedId:'', loadingId:''};

function resolveCssColor(color, fallback = '#28E98F') {
  const value = String(color || '').trim();
  const match = value.match(/^var\((--[^,)]+)(?:,[^)]+)?\)$/);
  if (!match) return value || fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || fallback;
}

/* sparkline */
function sparkline(canvas, data, color) {
  if (!canvas || data.length < 2) return;
  sparkRegistry.set(canvas.id, {
    canvas,
    data: data.slice(),
    color: resolveCssColor(color),
    phase: (canvas.id.charCodeAt(canvas.id.length - 1) || 0) / 20,
  });
  if (!sparkFrame) sparkFrame = requestAnimationFrame(drawSparklines);
}

function drawSparklines(ts) {
  sparkRegistry.forEach((cfg, id) => {
    if (!cfg.canvas.isConnected) {
      sparkRegistry.delete(id);
      return;
    }
    drawSparkline(cfg, ts);
  });
  sparkFrame = sparkRegistry.size ? requestAnimationFrame(drawSparklines) : null;
}

function drawSparkline(cfg, ts) {
  const {canvas, data, color, phase} = cfg;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const mn = Math.min(...data), mx = Math.max(...data);
  const flat = mx === mn;
  const rng = mx - mn || 1;
  const pts = data.map((v, i) => [
    i / (data.length - 1) * W,
    flat ? H / 2 : H - ((v - mn) / rng) * (H - 6) - 3,
  ]);

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.shadowColor = color;
  ctx.shadowBlur = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const progress = ((ts / 1700) + phase) % 1;
  const span = pts.length - 1;
  const raw = progress * span;
  const left = Math.floor(raw);
  const right = Math.min(left + 1, span);
  const mix = raw - left;
  const x = pts[left][0] + (pts[right][0] - pts[left][0]) * mix;
  const y = pts[left][1] + (pts[right][1] - pts[left][1]) * mix;

  const glow = ctx.createRadialGradient(x, y, 0, x, y, 7);
  glow.addColorStop(0, color);
  glow.addColorStop(0.45, color);
  glow.addColorStop(1, 'rgba(40,233,143,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2.4, 0, Math.PI * 2);
  ctx.fill();
}

/* delta badge */
function deltaBadge(n) {
  if (n == null) return '';
  if (n > 0) return `<span class="delta delta-up">+${n}</span>`;
  if (n < 0) return `<span class="delta delta-dn">${n}</span>`;
  return `<span class="delta delta-z">0</span>`;
}

/* badge */
function badge(s) {
  const cls = s === 'ok' ? 'ok' : s === 'degraded' ? 'deg' : 'unav';
  const lbl = s === 'ok' ? 'OK' : s === 'degraded' ? 'DEGRADED' : 'UNAVAIL';
  return `<span class="badge ${cls}">${lbl}</span>`;
}

/* state color class */
function scCls(s) {
  if (s === 'RUNNING') return 'sc-R';
  if (s === 'PENDING') return 'sc-PD';
  if (s === 'FAILED' || s === 'TIMEOUT' || s === 'NODE_FAIL') return 'sc-F';
  if (s === 'COMPLETED') return 'sc-C';
  return '';
}

/* users summary table */
function usersTable(rows) {
  if (!rows.length) return '<p class="empty">Queue is empty. No active jobs.</p>';
  const u = {};
  rows.forEach(r => {
    if (r.length < 6) return;
    const [,user,part,,state] = r;
    if (!u[user]) u[user] = {run:0, pnd:0, other:0, parts:new Set()};
    if (state === 'RUNNING') u[user].run++;
    else if (state === 'PENDING') u[user].pnd++;
    else u[user].other++;
    u[user].parts.add(part);
  });
  const sorted = Object.entries(u).sort((a,b) => b[1].run - a[1].run || b[1].pnd - a[1].pnd);
  const th = ['USER','RUNNING','PENDING','OTHER','TOTAL','PARTITIONS'].map(h=>`<th>${h}</th>`).join('');
  const tb = sorted.map(([name,s]) => {
    const tot = s.run + s.pnd + s.other;
    const runC = s.run  ? `style="color:var(--p);font-weight:600"` : `style="color:var(--t3)"`;
    const pndC = s.pnd  ? `style="color:var(--warn)"` : `style="color:var(--t3)"`;
    const othC = s.other? `` : `style="color:var(--t3)"`;
    return `<tr>
      <td style="font-weight:600;color:var(--t)">${esc(name)}</td>
      <td ${runC}>${s.run  || '-'}</td>
      <td ${pndC}>${s.pnd  || '-'}</td>
      <td ${othC}>${s.other|| '-'}</td>
      <td style="font-weight:600">${tot}</td>
      <td style="color:var(--t3);font-size:12px">${esc([...s.parts].join(', '))}</td>
    </tr>`;
  }).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

/* table */
function tbl(hdr, rows) {
  if (!rows.length) return '<p class="empty">No jobs.</p>';
  const si = hdr.indexOf('STATE');
  const th = hdr.map(h => `<th>${h}</th>`).join('');
  const tb = rows.map(r => {
    const cells = r.map((c, i) => {
      const cls = i === si ? ` class="${scCls(c)}"` : '';
      return `<td${cls}>${esc(c)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

/* prog bar */
function prog(pct, cls, lbl, sub) {
  return `<div class="prog-wrap">
    <div class="prog-row"><span>${lbl}</span><span>${sub}</span></div>
    <div class="prog"><div class="pf ${cls}" style="width:${Math.min(100,pct)}%"></div></div>
  </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function fmtMemMb(mb) {
  const n = Number(mb || 0);
  if (!n) return '-';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} TiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GiB`;
  return `${Math.round(n)} MiB`;
}

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
    $('resource-running').innerHTML = '<p class="empty">No resource data.</p>';
    $('resource-users').innerHTML = '<p class="empty">No resource data.</p>';
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

  const runningJobs = res.running_jobs || [];
  $('resource-running').innerHTML = runningJobs.length ? `
    <div class="tw"><table>
      <thead><tr><th>JOBID</th><th>USER</th><th>PARTITION</th><th>NAME</th><th>CPUS</th><th>RAM</th><th>GPUS</th><th>NODES</th><th>TIME</th></tr></thead>
      <tbody>${runningJobs.map(job => `<tr>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--t)">${esc(job.job_id)}</td>
        <td style="font-weight:600;color:var(--t)">${esc(job.user)}</td>
        <td>${esc(job.partition)}</td>
        <td class="job-name-cell" title="${esc(job.name)}">${esc(job.name)}</td>
        <td style="color:var(--p);font-weight:600">${esc(job.cpus)}</td>
        <td>${esc(job.mem_human || fmtMemMb(job.mem_total_mb))}</td>
        <td>${esc(job.gpus || 0)}</td>
        <td>${esc(job.nodes || 1)}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--t3)">${esc(job.time)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">No RUNNING jobs with CPU/RAM allocations.</p>';

  const users = res.by_user || [];
	  $('resource-users').innerHTML = users.length ? `
    <div class="tw"><table>
      <thead><tr><th>USER</th><th>JOBS</th><th>CPUS</th><th>RAM</th><th>GPUS</th></tr></thead>
      <tbody>${users.map(user => `<tr>
        <td style="font-weight:600;color:var(--t)">${esc(user.user)}</td>
        <td>${esc(user.jobs)}</td>
        <td style="color:var(--p);font-weight:600">${esc(user.cpus)}</td>
        <td>${esc(user.mem_human || fmtMemMb(user.mem_mb))}</td>
        <td>${esc(user.gpus || 0)}</td>
      </tr>`).join('')}</tbody>
	    </table></div>` : '<p class="empty">No users with RUNNING CPU/RAM allocations.</p>';
}

function cleanValue(value) {
  const s = String(value ?? '').trim();
  return s && s !== '(null)' && s !== 'N/A' ? s : '-';
}

function jobMetric(label, value, sub, tone) {
  return `<div class="job-metric">
    <span>${esc(label)}</span>
    <strong class="${tone || ''}">${esc(cleanValue(value))}</strong>
    <small>${esc(cleanValue(sub))}</small>
  </div>`;
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
      ${jobMetric('GPUs', r.gpus || 0, r.tres_per_node || r.tres || '-', gpuTone)}
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

function shellQuote(value) {
  const s = String(value || '').trim();
  if (!s) return "''";
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

function quoteLocalPath(value) {
  const s = String(value || '').trim();
  if (!s) return "''";
  if (s === '~') return '~';
  if (s.startsWith('~/')) {
    const parts = s.slice(2).split('/').map(part =>
      part === '' ? '' : /^[A-Za-z0-9_@%+=:,.-]+$/.test(part) ? part : shellQuote(part)
    );
    return '~/' + parts.join('/');
  }
  return shellQuote(s);
}

function trailingSlash(path) {
  const s = String(path || '').trim();
  return s && !s.endsWith('/') ? s + '/' : s;
}

function syncTransferMeta(d) {
  const t = d.transfer || {};
  transferState.user = t.user || d.user || transferState.user || '';
  transferState.host = t.host || transferState.host || 'slurm-client1.cin.ufpe.br';
  transferState.home = t.home || transferState.home || '';
  $('transfer-user-chip').textContent = transferState.user || '-';
  $('transfer-host-chip').textContent = transferState.host || '-';
  if (!$('transfer-browse-path').value && transferState.home) $('transfer-browse-path').value = transferState.home;
  if (!$('download-local').value) $('download-local').value = '~/Downloads/';
  if (!$('upload-remote').value && transferState.home) $('upload-remote').value = trailingSlash(transferState.home);
  refreshTransferCommands();
}

function remoteSpec(path) {
  return `${transferState.user}@${transferState.host}:${path}`;
}

function buildDownloadCommand() {
  let remote = $('download-remote').value.trim();
  const local = $('download-local').value.trim();
  if ($('download-contents').checked) remote = trailingSlash(remote);
  if (!transferState.user || !transferState.host) return 'Waiting for user and host from /api...';
  if (!remote) return 'Select or enter an Apuana file or directory.';
  if (!local) return 'Enter a local destination path.';
  return `rsync -avzP ${shellQuote(remoteSpec(remote))} ${quoteLocalPath(local)}`;
}

function buildUploadCommand() {
  let local = $('upload-local').value.trim();
  const remote = $('upload-remote').value.trim();
  if ($('upload-contents').checked) local = trailingSlash(local);
  if (!transferState.user || !transferState.host) return 'Waiting for user and host from /api...';
  if (!local) return 'Enter a local file or directory path.';
  if (!remote) return 'Enter an Apuana destination path.';
  return `rsync -avzP ${quoteLocalPath(local)} ${shellQuote(remoteSpec(remote))}`;
}

function refreshTransferCommands() {
  if (!$('download-command')) return;
  $('download-command').textContent = buildDownloadCommand();
  $('upload-command').textContent = buildUploadCommand();
}

function copyTextFrom(id) {
  const text = $(id).textContent || '';
  if (!text.trim()) return;
  navigator.clipboard?.writeText(text);
}

function renderTransferBrowser(data) {
  transferState.current = data.path || transferState.current || transferState.home || '';
  if (data.path) $('transfer-browse-path').value = data.path;
  if (!data.ok) {
    $('transfer-browser').innerHTML = `<div class="alert a-danger">${esc(data.error || 'Path lookup failed.')}</div>`;
    return;
  }
  const items = data.items || [];
  if (!items.length) {
    $('transfer-browser').innerHTML = '<p class="empty">No files matched this path or search.</p>';
    return;
  }
  $('transfer-browser').innerHTML = items.map(item => {
    const kind = item.kind || 'other';
    const isDir = !!item.is_dir;
    const openBtn = isDir ? `<button class="mini-btn" data-action="open" data-path="${esc(item.path)}">Open</button>` : '';
    const uploadBtn = isDir ? `<button class="mini-btn" data-action="upload" data-path="${esc(item.path)}">Upload here</button>` : '';
    return `<div class="transfer-row-item">
      <span class="kind-pill kind-${esc(kind)}">${esc(kind)}</span>
      <span class="path-cell" title="${esc(item.path)}">${esc(item.path)}</span>
      <span>${esc(item.size_human || '')}</span>
      <span class="mtime">${esc(item.mtime || '')}</span>
      <span class="row-actions">
        ${openBtn}
        <button class="mini-btn" data-action="download" data-path="${esc(item.path)}" data-kind="${esc(kind)}">Download</button>
        ${uploadBtn}
      </span>
    </div>`;
  }).join('');

  document.querySelectorAll('#transfer-browser button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const path = btn.getAttribute('data-path') || '';
      const kind = btn.getAttribute('data-kind') || '';
      if (action === 'open') browseTransfer(path, '');
      if (action === 'download') selectDownloadPath(path, kind);
      if (action === 'upload') selectUploadTarget(path);
    });
  });
}

function browseTransfer(path, query) {
  const base = path ?? $('transfer-browse-path').value.trim() ?? transferState.home;
  const q = query ?? $('transfer-search').value.trim();
  $('transfer-browser').innerHTML = '<p class="empty">Loading remote path...</p>';
  fetch('/api/fs?path=' + encodeURIComponent(base || '~') + '&query=' + encodeURIComponent(q || ''))
    .then(r => r.json())
    .then(renderTransferBrowser)
    .catch(() => {
      $('transfer-browser').innerHTML = '<div class="alert a-danger">Could not reach /api/fs.</div>';
    });
}

function browseTransferHome() {
  browseTransfer(transferState.home || '~', '');
}

function browseTransferParent() {
  const current = $('transfer-browse-path').value.trim() || transferState.current || transferState.home || '~';
  const parent = current.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
  browseTransfer(parent, '');
}

function useBrowsePathForDownload() {
  const path = $('transfer-browse-path').value.trim();
  if (!path) return;
  selectDownloadPath(path, '');
}

function selectDownloadPath(path, kind) {
  $('download-remote').value = path;
  transferState.selectedKind = kind || '';
  $('download-contents').checked = kind === 'directory';
  refreshTransferCommands();
}

function selectUploadTarget(path) {
  $('upload-remote').value = trailingSlash(path);
  refreshTransferCommands();
}

function ensureTransferReady() {
  syncTransferMeta(_last || {});
  if (!$('transfer-browser').innerHTML.trim()) browseTransfer();
}

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
      return `<option value="${esc(row[0])}">${mine}${esc(row[0])} - ${esc(row[3])} (${esc(row[4])})</option>`;
    }).join('');

  if (previous && rows.some(row => row[0] === previous)) {
    sel.value = previous;
  } else if (preferred) {
    sel.value = preferred;
  }
  return sel.value;
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
    running.map(job => `<option value="${esc(job.job_id)}">${esc(job.job_id)} - ${esc(job.name)} - ${esc(job.partition)}</option>`).join('');
  if (previous && running.some(job => job.job_id === previous)) {
    sel.value = previous;
  } else if (!selectedGpuJobId() && running.length) {
    sel.value = running[0].job_id;
  }
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

/* setView */
function setView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const idx = ['overview','jobs','logs','transfer','cluster'].indexOf(name);
  document.querySelectorAll('.nb')[idx]?.classList.add('active');
  renderView(name, _last);
  if (name === 'logs') fetchLogs();
  if (name === 'transfer') ensureTransferReady();
}

/* render KPIs */
function renderKpis(d) {
  const rows = d.queue?.rows || [];
  const run = d.run ?? rows.filter(r => r[4]==='RUNNING').length;
  const pnd = d.pnd ?? rows.filter(r => r[4]==='PENDING').length;
  const prb = rows.filter(r => ['FAILED','TIMEOUT','NODE_FAIL'].includes(r[4])).length;
  const total = rows.length;
  const parts = new Set((d.sinfo?.rows||[]).map(r => r[0])).size;

  hist.run.push(run);   if (hist.run.length > MAX_HIST)   hist.run.shift();
  hist.pnd.push(pnd);   if (hist.pnd.length > MAX_HIST)   hist.pnd.shift();
  hist.total.push(total); if (hist.total.length > MAX_HIST) hist.total.shift();

  const kpis = [
    { icon:'&Sigma;', lbl:'Running',   val:run,   delta:d.delta_run, hist:hist.run,   col:'var(--p)',       desc:'jobs executing' },
    { icon:'&#9201;', lbl:'Pending',   val:pnd,   delta:d.delta_pnd, hist:hist.pnd,   col:'var(--warn)',    desc:'waiting for resources' },
    { icon:'&#9888;', lbl:'Problems',  val:prb,   delta:null,        hist:[],         col:'var(--danger)',  desc:'FAILED / TIMEOUT' },
    { icon:'#',       lbl:'Queue',     val:total, delta:null,        hist:hist.total, col:'var(--t)',       desc:'jobs in global queue' },
    { icon:'&#8862;', lbl:'Partitions',val:parts, delta:null,        hist:[],         col:'var(--info)',    desc:'cluster partitions' },
  ];

  $('kpis').innerHTML = kpis.map((k, i) => `
    <div class="kpi-card">
      <div class="kpi-top">
        <div class="kpi-icon">${k.icon}</div>
        <div class="kpi-label">${k.lbl}</div>
        ${k.delta != null ? deltaBadge(k.delta) : ''}
      </div>
      <div class="kpi-mid">
        <div class="kpi-val" style="color:${k.col}">${k.val}</div>
        ${k.hist.length > 1 ? `<canvas id="sp${i}" width="60" height="24"></canvas>` : ''}
      </div>
      <div class="kpi-desc">${k.desc}</div>
    </div>`).join('');

  kpis.forEach((k, i) => {
    if (k.hist.length > 1) sparkline($('sp'+i), k.hist, SPARKLINE_COLOR);
  });
}

/* render a specific view */
function renderView(name, d) {
  if (!d || !d.ts) return;
  const rows = d.queue?.rows || [];

  if (name === 'overview') {
    renderResources(d);

    /* users summary table */
    $('users-table').innerHTML = d.queue?.ok
      ? usersTable(rows)
      : `<div class="alert a-warn">User data unavailable: ${d.queue?.error||''}</div>`;

    /* global queue count + table */
    const countLabel = rows.length ? `${rows.length} job${rows.length!==1?'s':''}` : '';
    $('q-global-count').textContent = countLabel;
    $('q-global').innerHTML = d.queue?.ok
      ? tbl(d.queue.headers, rows)
      : `<div class="alert a-danger">squeue: ${d.queue?.error||'failed'}</div>`;

    /* user queue */
    const user = $('user-in').value.trim() || d.user || '';
    $('user-lbl').textContent = user;
    const uRows = rows.filter(r => r[1] === user);
    $('q-user').innerHTML = uRows.length
      ? tbl(d.queue.headers, uRows)
      : '<p class="empty">No queued jobs for this user.</p>';

    /* health list */
    const qOk = d.queue?.ok, sOk = d.sinfo?.ok, runningJobs = rows.filter(r => r[4] === 'RUNNING').length;
    const checks = [
      { name:'Login',      s:'ok',                      sum:`${d.node} responds` },
      { name:'Queue',      s:qOk?'ok':'degraded',       sum:qOk?'squeue OK':(d.queue?.error||'failed').slice(0,50) },
      { name:'Partitions', s:sOk?'ok':'degraded',       sum:sOk?'sinfo OK':(d.sinfo?.error||'failed').slice(0,50) },
      { name:'Resources',  s:d.resources?.ok?'ok':'degraded', sum:d.resources?.ok?'CPU/RAM OK':(d.resources?.error||'failed').slice(0,50) },
      { name:'GPU jobs',   s:runningJobs?'ok':'degraded', sum:runningJobs?`${runningJobs} running job(s)`:'No running jobs' },
    ];
    $('health-list').innerHTML = checks.map(c => `
      <div class="health-item">
        <span class="health-name">${esc(c.name)}</span>
        ${badge(c.s)}
        <span class="health-sum">${esc(c.sum)}</span>
      </div>`).join('');

    /* disk usage */
    const disks = (d.disks||[]).filter(dk =>
      !['/run','/dev','/sys','/proc'].some(p => dk.mount.startsWith(p))
    );
    $('disks').innerHTML = disks.length ? disks.map(dk => {
      const cl = dk.pct >= 90 ? 'pd2' : dk.pct >= 75 ? 'pw' : 'pi';
      const vc = dk.pct >= 90 ? 'var(--danger)' : dk.pct >= 75 ? 'var(--warn)' : 'var(--t3)';
      return `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:var(--t2);font-family:'JetBrains Mono',monospace;font-size:11px">${dk.mount}</span>
          <span style="color:${vc};font-weight:600">${dk.used}/${dk.size} ${dk.pct}%</span>
        </div>
        <div class="prog"><div class="pf ${cl}" style="width:${dk.pct}%"></div></div>
      </div>`;
    }).join('') : '<p class="empty">-</p>';

    /* memory + uptime */
    const mem = d.mem || {};
    const mHtml = mem.pct != null ? (() => {
      const mc = mem.pct >= 85 ? 'pd2' : mem.pct >= 60 ? 'pw' : 'pp';
      return `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--t2)">RAM</span>
        <span style="color:var(--t3)">${mem.used} / ${mem.total} - ${mem.pct}%</span>
      </div>
      <div class="prog" style="margin-bottom:10px"><div class="pf ${mc}" style="width:${mem.pct}%"></div></div>`;
    })() : '';
    const upHtml = d.uptime
      ? `<div style="font-size:11px;color:var(--t3);font-family:'JetBrains Mono',monospace;line-height:1.6">${d.uptime}</div>`
      : '';
    $('sys-mem').innerHTML = mHtml + upHtml || '<p class="empty">-</p>';

    /* who (logged-in users) */
    const logins = d.logins || [];
    $('logins-list').innerHTML = logins.length ? `
      <div class="tw"><table>
        <thead><tr><th>USER</th><th>TTY</th><th>SINCE</th><th>FROM</th></tr></thead>
        <tbody>${logins.map(l => `<tr>
          <td style="font-weight:600;color:var(--t)">${l.user}</td>
          <td style="color:var(--t3);font-size:12px">${l.tty}</td>
          <td style="color:var(--t3);font-size:12px;font-family:'JetBrains Mono',monospace">${l.since}</td>
          <td style="color:var(--t3);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${l.from}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>` : '<p class="empty">No active sessions.</p>';
  }

  if (name === 'jobs') {
    populateJobSelect(d);
    maybeAutoInspectJob();
    populateGpuJobs(d);
    const gpuJobId = selectedGpuJobId();
    if (gpuState.response && gpuState.jobId === gpuJobId) renderGpuResult(gpuState.response);
    else if (gpuJobId && gpuState.loadingId !== gpuJobId) fetchJobGpu(gpuJobId);
    else ensureGpuReady();
  }

  if (name === 'cluster') {
    $('cluster-table').innerHTML = d.sinfo?.ok
      ? tbl(d.sinfo.headers, d.sinfo.rows)
      : `<div class="alert a-danger">sinfo failed: ${d.sinfo?.error||''}</div>`;

    if (d.sinfo?.ok) {
      const ni = d.sinfo.headers.indexOf('NODES');
      const pi = d.sinfo.headers.indexOf('PARTITION');
      const parts = {};
      (d.sinfo.rows||[]).forEach(r => {
        const p = r[pi]||'?', n = parseInt(r[ni])||0;
        parts[p] = (parts[p]||0) + n;
      });
      const maxN = Math.max(...Object.values(parts), 1);
      $('cluster-bars').innerHTML = Object.entries(parts).map(([p,n]) => `
        <div class="part-bar-wrap">
          <div class="part-bar-hdr"><span>${p}</span><span>${n} nodes</span></div>
          <div class="part-bar"><div class="part-fill" style="width:${Math.round(n/maxN*100)}%"></div></div>
        </div>`).join('');
    }
  }
}

/* render - called after every poll */
function render(d) {
  _last = d;
  $('chip-node').textContent = `${d.node} - ${d.ts}`;
  $('sb-avatar').textContent = (d.user||'?').slice(0,2).toUpperCase();

  renderKpis(d);
  syncTransferMeta(d);

  /* render the currently active view */
  const active = document.querySelector('.view.active');
  if (active) renderView(active.id.replace('view-',''), d);
}

/* job lookup */
function fetchJob(forcedId) {
  const id = String(forcedId || $('job-id-in').value.trim() || $('job-queue-sel').value || '').trim();
  if (!id) {
    $('job-output').className = 'job-detail-empty';
    $('job-output').textContent = 'Enter a Job ID.';
    return;
  }
  jobState.loadingId = id;
  jobState.raw = '';
  $('job-raw-output').textContent = '';
  $('job-raw-output').hidden = true;
  $('job-output').className = 'job-detail-empty';
  $('job-output').textContent = 'Inspecting...';
  fetch('/api/job-info?id=' + encodeURIComponent(id))
    .then(r => r.json())
    .then(renderJobInfo)
    .catch(() => {
      jobState.loadingId = '';
      $('job-output').className = '';
      $('job-output').innerHTML = '<div class="alert a-danger">Endpoint /api/job-info is unavailable.</div>';
    });
}

function fetchJobGpu(forcedId) {
  const id = String(forcedId || selectedGpuJobId() || '').trim();
  if (!id) {
    $('gpu-status').innerHTML = '<div class="alert a-warn">Select one of your RUNNING GPU jobs.</div>';
    $('gpu-cards').innerHTML = '';
    $('gpu-output').textContent = 'No running GPU job selected.';
    $('gpu-output').hidden = true;
    return;
  }

  gpuState = {...gpuState, jobId:id, response:null, loadingId:id, raw:''};
  $('gpu-status').innerHTML = '<div class="alert a-warn">Inspecting job GPU telemetry...</div>';
  $('gpu-cards').innerHTML = '';
  $('gpu-output').textContent = 'Running srun...';
  $('gpu-output').hidden = true;
  fetch('/api/job-gpu?id=' + encodeURIComponent(id))
    .then(r => r.json())
    .then(renderGpuResult)
    .catch(() => {
      gpuState.loadingId = '';
      $('gpu-status').innerHTML = '<div class="alert a-danger">Could not reach /api/job-gpu.</div>';
      $('gpu-output').textContent = 'Request failed.';
      $('gpu-output').hidden = true;
    });
}

/* poll */
function poll() {
  fetch('/api')
    .then(r => r.json())
    .then(render)
    .catch(() => { $('chip-node').textContent = 'Disconnected...'; });
}

/* log fetch */
function fetchLogs() {
  const out = $('log-out-path').value.trim();
  const err = $('log-err-path').value.trim();
  if (!out && !err) return;
  fetch('/api/logs?out=' + encodeURIComponent(out) + '&err=' + encodeURIComponent(err))
    .then(r => r.json())
    .then(d => {
      $('log-out-content').textContent = d.out || '-- empty or inaccessible --';
      $('log-err-content').textContent = d.err || '-- empty or inaccessible --';
    }).catch(() => {});
}

poll();
setInterval(poll, 5000);
$('user-in').addEventListener('input', () => renderView('overview', _last));
$('job-queue-sel').addEventListener('change', () => {
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
['download-remote','download-local','upload-local','upload-remote'].forEach(id => {
  $(id).addEventListener('input', refreshTransferCommands);
});
['download-contents','upload-contents'].forEach(id => {
  $(id).addEventListener('change', refreshTransferCommands);
});
['transfer-browse-path','transfer-search'].forEach(id => {
  $(id).addEventListener('keydown', ev => {
    if (ev.key === 'Enter') browseTransfer();
  });
});
['gpu-job-id'].forEach(id => {
  $(id).addEventListener('keydown', ev => {
    if (ev.key === 'Enter') fetchJobGpu();
  });
});
$('gpu-job-sel').addEventListener('change', () => {
  $('gpu-job-id').value = '';
  gpuState = {...gpuState, jobId:'', response:null, raw:'', loadingId:''};
  fetchJobGpu();
});
