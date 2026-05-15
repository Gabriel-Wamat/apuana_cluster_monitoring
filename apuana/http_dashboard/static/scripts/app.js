const $ = id => document.getElementById(id);
const hist = {run:[], pnd:[], total:[]};
const MAX_HIST = 30;
let _last = {};
let transferState = {user:'', host:'slurm-client1.cin.ufpe.br', home:'', current:'', selectedKind:''};

/* sparkline */
function sparkline(canvas, data, color) {
  if (!canvas || data.length < 2) return;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const mn = Math.min(...data), mx = Math.max(...data);
  const rng = mx - mn || 1;
  const pts = data.map((v, i) => [i / (data.length - 1) * W, H - ((v - mn) / rng) * (H - 4) - 2]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
      <td style="font-weight:600;color:var(--t)">${name}</td>
      <td ${runC}>${s.run  || '-'}</td>
      <td ${pndC}>${s.pnd  || '-'}</td>
      <td ${othC}>${s.other|| '-'}</td>
      <td style="font-weight:600">${tot}</td>
      <td style="color:var(--t3);font-size:12px">${[...s.parts].join(', ')}</td>
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
      return `<td${cls}>${c}</td>`;
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

/* setView */
function setView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const idx = ['overview','jobs','gpu','logs','transfer','cluster'].indexOf(name);
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
    if (k.hist.length > 1) sparkline($('sp'+i), k.hist, k.col);
  });
}

/* render a specific view */
function renderView(name, d) {
  if (!d || !d.ts) return;
  const rows = d.queue?.rows || [];

  if (name === 'overview') {
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
    const qOk = d.queue?.ok, sOk = d.sinfo?.ok, gpuN = d.gpus?.length || 0;
    const checks = [
      { name:'Login',      s:'ok',                      sum:`${d.node} responds` },
      { name:'Queue',      s:qOk?'ok':'degraded',       sum:qOk?'squeue OK':(d.queue?.error||'failed').slice(0,50) },
      { name:'Partitions', s:sOk?'ok':'degraded',       sum:sOk?'sinfo OK':(d.sinfo?.error||'failed').slice(0,50) },
      { name:'Accounting', s:d.acct_ok?'ok':'degraded', sum:d.acct_ok?'sacct OK':'slurmdbd offline' },
      { name:'GPU login',  s:gpuN?'ok':'degraded',      sum:gpuN?`${gpuN} GPU(s)`:'No GPU on login' },
    ];
    $('health-list').innerHTML = checks.map(c => `
      <div class="health-item">
        <span class="health-name">${c.name}</span>
        ${badge(c.s)}
        <span class="health-sum">${c.sum}</span>
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
    /* populate queue select */
    const sel = $('job-queue-sel');
    const prev = sel.value;
    sel.innerHTML = '<option value="">From queue</option>' +
      rows.map(r => `<option value="${r[0]}">${r[0]} - ${r[3]} (${r[4]})</option>`).join('');
    if (prev) sel.value = prev;
  }

  if (name === 'gpu') {
    const gpus = d.gpus || [];
    if (gpus.length) {
      $('gpu-empty').style.display = 'none';
      $('gpu-cards').innerHTML = gpus.map(g => {
        const mPct = Math.round(g.mem_used / g.mem_total * 100);
        const tCol = g.temp > 80 ? 'var(--danger)' : g.temp > 65 ? 'var(--warn)' : 'var(--t2)';
        return `<div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:13px;font-weight:600">GPU ${g.index}</span>
            <span style="font-size:14px;font-weight:600;color:${tCol}">${g.temp}&deg;C</span>
          </div>
          <div style="font:11px/1.5 'JetBrains Mono',monospace;color:var(--t3);margin-bottom:6px">${g.name}</div>
          ${prog(g.util,'pp','Utilization',`${g.util}%`)}
          ${prog(mPct,'pi','VRAM',`${g.mem_used} / ${g.mem_total} MiB`)}
        </div>`;
      }).join('');
    } else {
      $('gpu-empty').style.display = '';
      $('gpu-cards').innerHTML = '';
    }
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
function fetchJob() {
  const id = $('job-id-in').value.trim() || $('job-queue-sel').value;
  if (!id) { $('job-output').textContent = 'Enter a Job ID.'; return; }
  $('job-output').textContent = 'Inspecting...';
  fetch('/api/job?id=' + encodeURIComponent(id))
    .then(r => r.text())
    .then(t => { $('job-output').textContent = t; })
    .catch(() => { $('job-output').textContent = 'Endpoint /api/job nao implementado.'; });
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
