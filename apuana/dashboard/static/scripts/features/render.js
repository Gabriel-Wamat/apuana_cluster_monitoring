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
  try {
    const response = await apiFetch('/api');
    const data = await response.json();
    render(data);
  } catch (_) {
    if (sshAuth.loggedIn && sshAuth.token) {
      showInitialLoader(
        'Carregando dados do cluster...',
        'Aguardando resposta do Apuana. Verifique a VPN do CIn se demorar.'
      );
    }
    $('chip-node').textContent = 'Conectando ao Apuana...';
  }
}
