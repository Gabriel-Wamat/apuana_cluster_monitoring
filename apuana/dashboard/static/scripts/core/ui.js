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
  const lbl = s === 'ok' ? 'OK' : s === 'degraded' ? 'Degraded' : 'Unavailable';
  const icon = s === 'ok'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
    : s === 'degraded'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  return `<span class="badge status-badge ${cls}" aria-label="${lbl}" title="${lbl}">${icon}</span>`;
}

/* state color class */
function scCls(s) {
  if (s === 'RUNNING') return 'sc-R';
  if (s === 'PENDING') return 'sc-PD';
  if (s === 'FAILED' || s === 'TIMEOUT' || s === 'NODE_FAIL') return 'sc-F';
  if (s === 'COMPLETED') return 'sc-C';
  return '';
}

function stateIconMarkup(state) {
  const value = String(state || '').toUpperCase();
  const kind = value === 'RUNNING'
    ? 'running'
    : value === 'PENDING'
      ? 'pending'
      : ['FAILED', 'TIMEOUT', 'NODE_FAIL', 'CANCELLED'].includes(value)
        ? 'error'
        : value ? 'done' : '';
  if (!kind) return '';
  const svg = kind === 'running'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-8 6 16 3-8h4"/></svg>'
    : kind === 'pending'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>'
      : kind === 'error'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  return `<span class="queue-state-pill ${esc(kind)}" aria-label="${esc(value)}" title="${esc(value)}"><span class="queue-state-icon">${svg}</span><span>${esc(value || '-')}</span></span>`;
}

/* users summary table */
function usersTable(rows, resources = {}) {
  if (!rows.length) return '<p class="empty">Queue is empty. No active jobs.</p>';
  const resourceByUser = new Map((resources?.by_user || []).map(item => [String(item.user || ''), item]));
  const u = {};
  rows.forEach(r => {
    if (r.length < 6) return;
    const [,user,part,,state] = r;
    if (!u[user]) u[user] = {run:0, pnd:0, other:0, parts:new Set(), cpus:0, ram:'-', gpus:0};
    if (state === 'RUNNING') u[user].run++;
    else if (state === 'PENDING') u[user].pnd++;
    else u[user].other++;
    u[user].parts.add(part);
  });

  resourceByUser.forEach((res, user) => {
    if (!u[user]) u[user] = {run:0, pnd:0, other:0, parts:new Set(), cpus:0, ram:'-', gpus:0};
    u[user].cpus = Number(res.cpus || 0);
    u[user].ram = res.mem_human || fmtMemMb(res.mem_mb);
    u[user].gpus = Number(res.gpus || 0);
  });

  const sorted = Object.entries(u).sort((a,b) => {
    const ar = resourceByUser.get(a[0])?.jobs || a[1].run;
    const br = resourceByUser.get(b[0])?.jobs || b[1].run;
    return br - ar || b[1].pnd - a[1].pnd || a[0].localeCompare(b[0]);
  });
  const th = ['USER','RUNNING','PENDING','TOTAL','CPUS','RAM','GPUS','PARTITIONS'].map(h=>`<th>${h}</th>`).join('');
  const tb = sorted.map(([name,s]) => {
    const tot = s.run + s.pnd + s.other;
    const runC = s.run  ? `style="color:var(--p);font-weight:600"` : `style="color:var(--t3)"`;
    const pndC = s.pnd  ? `style="color:var(--warn)"` : `style="color:var(--t3)"`;
    return `<tr>
      <td style="font-weight:600;color:var(--t)">${esc(name)}</td>
      <td ${runC}>${s.run  || '-'}</td>
      <td ${pndC}>${s.pnd  || '-'}</td>
      <td style="font-weight:600">${tot}</td>
      <td style="color:var(--p);font-weight:600">${s.cpus || '-'}</td>
      <td>${esc(s.ram || '-')}</td>
      <td>${s.gpus || '-'}</td>
      <td style="color:var(--t3);font-size:12px">${esc([...s.parts].join(', '))}</td>
    </tr>`;
  }).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

/* table */
function tableCellMarkup(cell, colIndex, stateIndex, header) {
  if (colIndex === stateIndex) {
    const state = typeof cell === 'object' && cell !== null ? cell.value : cell;
    return `<td class="queue-state-cell ${scCls(state)}">${stateIconMarkup(state) || esc(state)}</td>`;
  }

  if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
    const value = cell.value ?? '';
    const className = String(cell.className || '').replace(/[^a-zA-Z0-9_ -]/g, '').trim();
    const cls = className ? ` class="${esc(className)}"` : '';
    const title = cell.title != null ? ` title="${esc(cell.title)}"` : '';
    return `<td${cls}${title}>${esc(value)}</td>`;
  }

  if (header === 'REASON') {
    return `<td class="reason-cell" title="${esc(cell)}">${esc(cell)}</td>`;
  }

  return `<td>${esc(cell)}</td>`;
}

function tbl(hdr, rows) {
  const si = hdr.indexOf('STATE');
  const th = hdr.map(h => `<th>${h}</th>`).join('');
  const tb = rows.length
    ? rows.map(r => {
      const cells = r.map((c, i) => tableCellMarkup(c, i, si, hdr[i])).join('');
      return `<tr>${cells}</tr>`;
    }).join('')
    : `<tr><td class="table-empty-row" colspan="${hdr.length || 1}">No jobs in queue.</td></tr>`;
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
