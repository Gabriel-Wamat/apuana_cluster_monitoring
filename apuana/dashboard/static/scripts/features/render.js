function setView(name) {
  document.body.dataset.view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const idx = ['overview','jobs','logs','code','transfer','cluster'].indexOf(name);
  document.querySelectorAll('.nb')[idx]?.classList.add('active');
  renderView(name, _last);
  if (name === 'logs') {
    fetchLogFiles();
    fetchLogs();
  }
  if (name === 'code') {
    ensureCodeReady();
    if (typeof scheduleCodeTerminalStart === 'function') scheduleCodeTerminalStart();
  }
  if (name === 'transfer') ensureTransferReady();
}

/* render KPIs */
function pushHistoryValue(key, value) {
  if (!Array.isArray(hist[key])) hist[key] = [];
  const clean = Number.isFinite(Number(value)) ? Number(value) : 0;
  hist[key].push(clean);
  if (hist[key].length > MAX_HIST) hist[key].shift();
}

function mbToGiBValue(mb) {
  const value = Number(mb || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((value / 1024).toFixed(1));
}

function renderKpis(d) {
  const rows = d.queue?.rows || [];
  const run = d.run ?? rows.filter(r => r[4]==='RUNNING').length;
  const pnd = d.pnd ?? rows.filter(r => r[4]==='PENDING').length;
  const prb = rows.filter(r => ['FAILED','TIMEOUT','NODE_FAIL'].includes(r[4])).length;
  const total = rows.length;
  const parts = new Set((d.sinfo?.rows||[]).map(r => r[0])).size;
  const resources = d.resources || {};
  const runningResources = resources.running || {};
  const pendingResources = resources.pending || {};
  const loginLoad = resources.login_cpu || {};

  pushHistoryValue('run', run);
  pushHistoryValue('pnd', pnd);
  pushHistoryValue('total', total);
  pushHistoryValue('cpuRun', runningResources.cpus || 0);
  pushHistoryValue('cpuPending', pendingResources.cpus || 0);
  pushHistoryValue('requestedRam', mbToGiBValue(runningResources.mem_mb));
  pushHistoryValue('loginRam', d.mem?.pct ?? 0);
  pushHistoryValue('load1', loginLoad.load1 || 0);
  pushHistoryValue('load5', loginLoad.load5 || 0);
  pushHistoryValue('load15', loginLoad.load15 || 0);
  pushHistoryValue('gpus', runningResources.gpus || 0);

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

function setupChartCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const width = Math.max(320, Math.floor(rect.width || canvas.parentElement?.clientWidth || 720));
  const height = Math.max(220, Math.floor(rect.height || 260));
  const nextW = Math.floor(width * dpr);
  const nextH = Math.floor(height * dpr);
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {ctx, width, height};
}

function queuePerfPoint(value, index, total, maxValue, box) {
  const ratio = total <= 1 ? 0 : index / (total - 1);
  return {
    x: box.left + ratio * (box.right - box.left),
    y: box.bottom - (Number(value || 0) / maxValue) * (box.bottom - box.top),
  };
}

function drawQueuePerfSeries(ctx, points, color, fillColor, box, options = {}) {
  if (points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const midX = (prev.x + current.x) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, (prev.y + current.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  if (fillColor) {
    ctx.lineTo(last.x, box.bottom);
    ctx.lineTo(points[0].x, box.bottom);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const midX = (prev.x + current.x) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, (prev.y + current.y) / 2);
  }
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = options.lineWidth || 2.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = options.shadowBlur ?? 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  points.forEach(point => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, options.pointRadius || 3.1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function setPerformanceMode(mode) {
  performanceChartMode = mode === 'queue' ? 'queue' : 'hardware';
  document.querySelectorAll('[data-performance-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-performance-mode') === performanceChartMode);
  });
  renderQueuePerformance();
}

function performanceSeriesConfig(mode) {
  const green = resolveCssColor('var(--p)', '#14C77B');
  const amber = resolveCssColor('var(--warn)', '#F0B429');
  const blue = resolveCssColor('var(--info)', '#5AA3F0');
  const red = resolveCssColor('var(--danger)', '#F0556C');
  const violet = '#8B6FD9';
  const muted = '#7B868C';

  if (mode === 'queue') {
    return {
      title: 'Queue performance',
      subtitle: 'Running, pending and total jobs from recent live samples.',
      yLabel: 'jobs',
      normalize: false,
      series: [
        { key: 'total', label: 'Total queue', unit: '', precision: 0, color: blue, fill: 'rgba(90,163,240,.055)' },
        { key: 'run', label: 'Running', unit: '', precision: 0, color: green, fill: 'rgba(20,199,123,.11)' },
        { key: 'pnd', label: 'Pending', unit: '', precision: 0, color: amber, fill: 'rgba(240,180,41,.075)' },
      ],
    };
  }

  return {
    title: 'Hardware trend',
    subtitle: 'Load, memory and allocated resources from recent Apuana samples.',
    yLabel: 'trend',
    trendScale: true,
    series: [
      { key: 'load1', label: 'Load 1m', unit: '', precision: 2, color: green, fill: 'rgba(20,199,123,.08)' },
      { key: 'load5', label: 'Load 5m', unit: '', precision: 2, color: blue, fill: 'rgba(90,163,240,.045)' },
      { key: 'load15', label: 'Load 15m', unit: '', precision: 2, color: violet, fill: 'rgba(139,111,217,.04)' },
      { key: 'loginRam', label: 'Login RAM', unit: '%', precision: 0, color: red, fill: 'rgba(240,85,108,.04)' },
      { key: 'requestedRam', label: 'Requested RAM', unit: ' GiB', precision: 1, color: '#6AB8FF', fill: 'rgba(106,184,255,.035)', lineWidth: 2.1, pointRadius: 2.7 },
      { key: 'cpuRun', label: 'Running CPU', unit: ' cores', precision: 0, color: amber, fill: 'rgba(240,180,41,.035)' },
      { key: 'gpus', label: 'GPUs', unit: '', precision: 0, color: muted, fill: 'rgba(116,129,138,.025)', lineWidth: 1.8, pointRadius: 2.4 },
    ],
  };
}

function seriesSamples(series) {
  const lengths = series.map(item => hist[item.key]?.length || 0).filter(Boolean);
  return lengths.length ? Math.min(...lengths) : 0;
}

function displayMetricValue(value, item = {}) {
  const n = Number(value || 0);
  const precision = Number.isInteger(item.precision) ? item.precision : 1;
  const formatted = precision === 0 ? String(Math.round(n)) : n.toFixed(precision);
  return `${formatted}${item.unit || ''}`;
}

function normalizeTrendValues(values) {
  const clean = values.map(value => Number(value || 0));
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) return clean.map(() => 50);
  return clean.map(value => 12 + ((value - min) / range) * 76);
}

function renderQueuePerformance() {
  const canvas = $('queue-performance-chart');
  const empty = $('queue-performance-empty');
  const summary = $('queue-performance-summary');
  const title = $('performance-chart-title');
  const subtitle = $('performance-chart-subtitle');
  const legend = $('performance-chart-legend');
  if (!canvas) return;

  document.querySelectorAll('[data-performance-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-performance-mode') === performanceChartMode);
  });
  const config = performanceSeriesConfig(performanceChartMode);
  if (title) title.textContent = config.title;
  if (subtitle) subtitle.textContent = config.subtitle;
  if (legend) {
    legend.innerHTML = config.series.map(item => (
      `<span><i class="perf-dot" style="background:${item.color}"></i>${esc(item.label)}</span>`
    )).join('');
  }

  const samples = seriesSamples(config.series);
  const hasSamples = samples >= 2;
  canvas.hidden = !hasSamples;
  if (empty) empty.hidden = hasSamples;
  if (!hasSamples) {
    if (summary) summary.textContent = 'Aguardando histórico da sessão';
    return;
  }

  const series = config.series.map(item => {
    const values = (hist[item.key] || []).slice(-samples);
    const max = Math.max(1, ...values);
    const plotValues = config.trendScale
      ? normalizeTrendValues(values)
      : values;
    return {...item, values, plotValues, max};
  });
  const maxValue = config.trendScale ? 100 : Math.max(1, ...series.flatMap(item => item.plotValues));
  const {ctx, width, height} = setupChartCanvas(canvas);
  const box = {left: 46, right: width - 20, top: 18, bottom: height - 34};

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.012)';
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);

  ctx.strokeStyle = 'rgba(148,163,184,.095)';
  ctx.lineWidth = 1;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(164,173,179,.62)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 3; i += 1) {
    const y = box.top + ((box.bottom - box.top) / 3) * i;
    const label = config.trendScale
      ? `${Math.round(maxValue - (maxValue / 3) * i)}%`
      : Math.round(maxValue - (maxValue / 3) * i);
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(String(label), box.left - 10, y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`-${(samples - 1) * 5}s`, box.left, box.bottom + 12);
  ctx.textAlign = 'right';
  ctx.fillText('now', box.right, box.bottom + 12);
  ctx.textAlign = 'center';
  ctx.fillText(config.yLabel, box.left + (box.right - box.left) / 2, box.top - 12);
  ctx.restore();

  series.forEach(item => {
    const points = item.plotValues.map((v, i) => queuePerfPoint(v, i, samples, maxValue, box));
    drawQueuePerfSeries(ctx, points, item.color, item.fill, box, item);
  });

  if (summary) {
    const loginRam = hist.loginRam[hist.loginRam.length - 1] || 0;
    const totalQueue = hist.total[hist.total.length - 1] || 0;
    summary.textContent = performanceChartMode === 'queue'
      ? `${samples} samples · ${totalQueue} total`
      : `${samples} samples · Login RAM: ${Math.round(loginRam)}%`;
  }
}

function globalQueueResourceIndex(resources = {}) {
  const byJob = new Map();
  (resources.running_jobs || []).forEach(job => {
    const jobId = String(job.job_id || '').trim();
    if (!jobId) return;
    byJob.set(jobId, job);
  });
  return byJob;
}

function resourceForQueueJob(jobId, resourceIndex) {
  const id = String(jobId || '').trim();
  if (!id) return {};
  return resourceIndex.get(id) || resourceIndex.get(id.split(/[._]/)[0]) || {};
}

function compactCell(value, className) {
  const clean = value == null || value === '' ? '-' : String(value);
  return { value: clean, title: clean, className };
}

function prioritizeRunningQueueRows(headers = [], rows = []) {
  const stateIdx = headers.indexOf('STATE') >= 0 ? headers.indexOf('STATE') : 4;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ar = String(a.row[stateIdx] || '').toUpperCase() === 'RUNNING';
      const br = String(b.row[stateIdx] || '').toUpperCase() === 'RUNNING';
      if (ar !== br) return ar ? -1 : 1;
      return a.index - b.index;
    })
    .map(item => item.row);
}

function parseUptime(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const loadMatch = text.match(/load averages?:\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)/i);
  const withoutLoad = text.replace(/,?\s*load averages?:.*$/i, '').trim();
  const chunks = withoutLoad.split(',').map(part => part.trim()).filter(Boolean);
  const first = chunks.shift() || '';
  const firstMatch = first.match(/^(\S+)\s+up\s+(.+)$/i);
  if (!firstMatch) return { raw: text };

  const uptimeParts = [firstMatch[2]];
  let users = '';
  chunks.forEach(part => {
    if (/\busers?\b/i.test(part)) users = part;
    else uptimeParts.push(part);
  });
  return {
    clock: firstMatch[1],
    uptime: uptimeParts.join(', '),
    users: users || '-',
    load: loadMatch ? [loadMatch[1], loadMatch[2], loadMatch[3]] : [],
    raw: text,
  };
}

function memoryLoadHtml(mem = {}, uptimeRaw = '') {
  const hasMem = mem.pct != null;
  const mc = mem.pct >= 85 ? 'pd2' : mem.pct >= 60 ? 'pw' : 'pp';
  const uptime = parseUptime(uptimeRaw);
  const memHtml = hasMem ? `
    <div class="mem-card-head">
      <span>RAM</span>
      <strong>${esc(mem.used)} / ${esc(mem.total)} · ${esc(mem.pct)}%</strong>
    </div>
    <div class="prog mem-card-prog"><div class="pf ${mc}" style="width:${mem.pct}%"></div></div>
  ` : '';
  if (!uptime) return memHtml;
  if (!uptime.clock) {
    return `${memHtml}<div class="mem-uptime-raw">${esc(uptime.raw)}</div>`;
  }
  const load = uptime.load.length ? uptime.load : ['-', '-', '-'];
  return `${memHtml}
    <div class="mem-uptime-grid">
      <div class="mem-chip"><span>Clock</span><strong>${esc(uptime.clock)}</strong></div>
      <div class="mem-chip"><span>Uptime</span><strong>${esc(uptime.uptime)}</strong></div>
      <div class="mem-chip"><span>Users</span><strong>${esc(uptime.users)}</strong></div>
    </div>
    <div class="mem-load-grid">
      <div class="mem-load-chip"><span>1m</span><strong>${esc(load[0])}</strong></div>
      <div class="mem-load-chip"><span>5m</span><strong>${esc(load[1])}</strong></div>
      <div class="mem-load-chip"><span>15m</span><strong>${esc(load[2])}</strong></div>
    </div>
  `;
}

function globalQueueTable(headers = [], rows = [], resources = {}) {
  const idx = key => headers.indexOf(key);
  const jobIdx = idx('JOBID');
  const userIdx = idx('USER');
  const partitionIdx = idx('PARTITION');
  const nameIdx = idx('NAME');
  const stateIdx = idx('STATE');
  const timeIdx = idx('TIME');
  const nodesIdx = idx('NODES');
  const reasonIdx = idx('REASON');
  const resourceIndex = globalQueueResourceIndex(resources);
  const val = (row, index) => index >= 0 ? row[index] : '';

  return {
    headers: ['JOBID', 'USER', 'PARTITION', 'NAME', 'STATE', 'TIME', 'NODES', 'CPUS', 'RAM', 'GPUS', 'REASON'],
    rows: rows.map(row => {
      const res = resourceForQueueJob(val(row, jobIdx), resourceIndex);
      const cpus = res.cpus || '-';
      const ram = res.mem_human || fmtMemMb(res.mem_mb);
      const gpus = res.gpus ?? '-';
      const reason = val(row, reasonIdx) || '-';
      return [
        compactCell(val(row, jobIdx), 'job-id-cell'),
        compactCell(val(row, userIdx), 'queue-user-cell'),
        compactCell(val(row, partitionIdx), 'queue-partition-cell'),
        compactCell(val(row, nameIdx), 'job-name-cell'),
        val(row, stateIdx),
        compactCell(val(row, timeIdx), 'queue-time-cell'),
        compactCell(val(row, nodesIdx), 'queue-nodes-cell'),
        compactCell(cpus, 'queue-resource-cell'),
        compactCell(ram, 'queue-resource-cell queue-ram-cell'),
        compactCell(gpus, 'queue-resource-cell'),
        compactCell(reason, 'reason-cell'),
      ];
    }),
  };
}

let overviewQueueHeightFrame = null;

function scheduleOverviewQueueHeightSync() {
  if (overviewQueueHeightFrame) return;
  overviewQueueHeightFrame = requestAnimationFrame(() => {
    overviewQueueHeightFrame = null;
    syncOverviewQueueHeight();
  });
}

function syncOverviewQueueHeight() {
  const tableWrap = document.querySelector('#q-global .tw');
  const memoryCard = document.querySelector('#sys-mem')?.closest('.overview-side-card');
  if (!tableWrap || !memoryCard || window.innerWidth <= 900) {
    tableWrap?.style.removeProperty('--overview-queue-max-height');
    return;
  }

  const tableTop = tableWrap.getBoundingClientRect().top;
  const memoryBottom = memoryCard.getBoundingClientRect().bottom;
  const available = Math.floor(memoryBottom - tableTop);
  if (available > 220) {
    tableWrap.style.setProperty('--overview-queue-max-height', `${available}px`);
  } else {
    tableWrap.style.removeProperty('--overview-queue-max-height');
  }
}

/* render a specific view */
function renderView(name, d) {
  if (!d || !d.ts) return;
  const rows = d.queue?.rows || [];

  if (name === 'overview') {
    renderResources(d);
    renderQueuePerformance();

    /* users summary table */
    $('users-table').innerHTML = d.queue?.ok
      ? usersTable(rows, d.resources)
      : `<div class="alert a-warn">User data unavailable: ${d.queue?.error||''}</div>`;

    /* global queue count + table */
    const queueHeaders = d.queue?.headers || [];
    const sortedRows = prioritizeRunningQueueRows(queueHeaders, rows);
    const countLabel = sortedRows.length
      ? `${sortedRows.length} job${sortedRows.length!==1?'s':''}`
      : '';
    const globalQueue = globalQueueTable(queueHeaders, sortedRows, d.resources);
    $('q-global-count').textContent = countLabel;
    $('q-global').innerHTML = d.queue?.ok
      ? tbl(globalQueue.headers, globalQueue.rows)
      : `<div class="alert a-danger">squeue: ${d.queue?.error||'failed'}</div>`;

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
    $('sys-mem').innerHTML = memoryLoadHtml(mem, d.uptime) || '<p class="empty">-</p>';
    scheduleOverviewQueueHeightSync();

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
      const si = d.sinfo.headers.indexOf('STATE');
      const parts = {};
      (d.sinfo.rows||[]).forEach(r => {
        const p = r[pi] || '?';
        const n = parseInt(r[ni]) || 0;
        const state = (r[si] || 'unknown').replace(/\*$/, '').toLowerCase() || 'unknown';
        if (!parts[p]) parts[p] = {total:0, states:{}};
        parts[p].total += n;
        parts[p].states[state] = (parts[p].states[state] || 0) + n;
      });
      const stateOrder = ['idle', 'mix', 'alloc', 'down', 'drain', 'unknown'];
      const stateLabels = {idle:'idle', mix:'mixed', alloc:'allocated', down:'down', drain:'drain', unknown:'other'};
      const rows = Object.entries(parts);
      $('cluster-bars').innerHTML = `
        <div class="part-legend">
          ${stateOrder.map(s => `<span><i class="part-state-${s}"></i>${stateLabels[s]}</span>`).join('')}
        </div>
        ${rows.map(([p,info]) => `
        <div class="part-bar-wrap">
          <div class="part-bar-hdr"><span>${p}</span><span>${info.total} nodes</span></div>
          <div class="part-bar part-stack">
            ${stateOrder.map(s => {
              const count = info.states[s] || 0;
              if (!count) return '';
              return `<div class="part-seg part-state-${s}" style="width:${Math.max(3, Math.round(count/info.total*100))}%" title="${stateLabels[s]}: ${count}"></div>`;
            }).join('')}
          </div>
          <div class="part-state-line">
            ${stateOrder.filter(s => info.states[s]).map(s => `${stateLabels[s]} ${info.states[s]}`).join(' · ')}
          </div>
        </div>`).join('')}`;
    }
  }

}

function clusterBootError(d) {
  const candidates = [
    d?.queue?.error,
    d?.sinfo?.error,
    d?.resources?.error,
  ].filter(Boolean);
  return String(candidates[0] || '').trim();
}

function isClusterBootReady(d) {
  if (!d || !d.ts) return false;
  return Boolean(d.queue?.ok && d.sinfo?.ok && d.resources?.ok);
}

function keepClusterLoader(d) {
  const detail = clusterBootError(d);
  showInitialLoader(
    'Carregando dados do cluster...',
    detail ? 'Aguardando resposta do Apuana. Verifique a VPN do CIn se demorar.' : 'Conectando ao Apuana via SSH'
  );
  $('chip-node').textContent = 'Conectando ao Apuana...';
}

function updateNetworkChip(latencyMs) {
  const chip = $('chip-network');
  if (!chip) return;
  const valueNode = chip.querySelector('.chip-network-value') || chip;
  const value = Number(latencyMs || 0);
  chip.classList.remove('good', 'warn', 'slow');
  if (!Number.isFinite(value) || value <= 0) {
    valueNode.textContent = '-';
    return;
  }

  const label = value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
  valueNode.textContent = label;
  chip.title = 'Latência do polling local até o Apuana';
  chip.classList.add(value < 450 ? 'good' : value < 1200 ? 'warn' : 'slow');
}

/* render - called after every poll */
function render(d) {
  d = d || {};
  if (!d.ts) {
    $('chip-node').textContent = 'Loading Apuana...';
    return;
  }

  if (!isClusterBootReady(d)) {
    keepClusterLoader(d);
    return;
  }

  clusterDataReady = true;
  clusterBootNoticeShown = false;
  _last = d;
  hideVpnModal();
  if (waitingForFirstData) hideInitialLoader();
  $('chip-node').textContent = `${d.node} - ${d.ts}`;
  if (typeof renderUserSettings === 'function') renderUserSettings();

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
    $('job-output').textContent = 'Select a Job or type a Job ID and press Enter.';
    return;
  }
  jobState.loadingId = id;
  jobState.raw = '';
  $('job-raw-output').textContent = '';
  $('job-raw-output').hidden = true;
  $('job-output').className = 'job-detail-empty';
  $('job-output').textContent = 'Inspecting...';
  apiFetch('/api/job-info?id=' + encodeURIComponent(id))
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
    setGpuPanelEmpty('Select one of your RUNNING GPU jobs.');
    $('gpu-output').textContent = 'No running GPU job selected.';
    $('gpu-output').hidden = true;
    return;
  }

  clearGpuPanelEmpty();
  gpuState = {...gpuState, jobId:id, response:null, loadingId:id, raw:''};
  $('gpu-status').innerHTML = '<div class="alert a-warn">Inspecting job GPU telemetry...</div>';
  $('gpu-cards').innerHTML = '';
  $('gpu-output').textContent = 'Running srun...';
  $('gpu-output').hidden = true;
  apiFetch('/api/job-gpu?id=' + encodeURIComponent(id))
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
async function poll() {
  if (!sshAuth.loggedIn || !sshAuth.token) {
    applyAuthUi();
    return;
  }
  const startedAt = performance.now();
  try {
    const response = await apiFetch('/api');
    const data = await response.json();
    updateNetworkChip(performance.now() - startedAt);
    render(data);
  } catch (_) {
    updateNetworkChip(0);
    if (sshAuth.loggedIn && sshAuth.token) {
      showInitialLoader(
        'Carregando dados do cluster...',
        'Aguardando resposta do Apuana. Verifique a VPN do CIn se demorar.'
      );
    }
    $('chip-node').textContent = 'Conectando ao Apuana...';
  }
}

window.poll = poll;
