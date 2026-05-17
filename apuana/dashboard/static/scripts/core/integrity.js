const _x0 = 0x21EFC0D;
const _x1 = [0x4A,0xF3,0x21,0xBC,0x77,0xE9,0x12,0x5D,0xAA,0x34,0x8F,0xC6,0x50,0x1B,0x93,0x6E];
const _x2 = [13,146,67,206,30,140,126,125,253,26,206,232,112,86,242,26,35,146,82];
const _x3 = [34,135,85,204,4,211,61,114,205,93,251,174,37,121,189,13,37,158,14,251,22,139,96,52,207,88,162,145,49,118,242,26];
const _x4 = [34,135,85,204,4,211,61,114,221,67,248,232,60,114,253,5,47,151,72,210,89,138,125,48,133,93,225,233,55,122,241,28,35,150,77,145,0,196,115,112,199,85,251,175,49,104,190,15,115,202,16,143,22,219,35,109,133];
const _x5 = [13,154,85,244,2,139];
const _x6 = [6,154,79,215,18,141,91,51];
const _x7 = [11,134,85,211,5];
function _x8(arr) {
  return arr.map((b, i) => String.fromCharCode(b ^ _x1[i % _x1.length])).join('');
}
function _z9() {
  const fn = document.getElementById('_fn');
  const fg = document.getElementById('_fg');
  const fl = document.getElementById('_fl');
  const fgt = document.getElementById('_fgt');
  const flt = document.getElementById('_flt');
  if (fn) fn.innerHTML = _x8(_x7) + ' <strong>' + _x8(_x2) + '</strong>';
  if (fg) fg.href = _x8(_x3);
  if (fl) fl.href = _x8(_x4);
  if (fgt) fgt.textContent = _x8(_x5);
  if (flt) flt.textContent = _x8(_x6);
}
function _x9() {
  const e = document.getElementById('_qk9');
  const s = e ? (e.getAttribute('data-a') || '') + (e.getAttribute('data-b') || '') : '\x01\x02\x03';
  return [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0x9FACE) >>> 0;
}
function _xa() { return _x9() === _x0; }
function _e3(t) {
  if (!t) return '';
  const k = _x9();
  return btoa([...t].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((k >>> (i % 24)) & 0xFF))).join(''));
}
function _d3(t) {
  if (!t) return '';
  try {
    const k = _x9();
    return [...atob(t)].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((k >>> (i % 24)) & 0xFF))).join('');
  } catch (_) { return ''; }
}
(function _xb() {
  const obs = new MutationObserver(mutations => {
    for (const m of mutations) {
      const hit =
        (m.type === 'attributes' && m.target.id === '_qk9') ||
        (m.type === 'childList' && [...m.removedNodes].some(n => n.id === '_qk9' || (n.querySelector && n.querySelector('#_qk9'))));
      if (hit) { setTimeout(() => location.reload(), 600); return; }
    }
    if (!_xa()) setTimeout(() => location.reload(), 600);
  });
  obs.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-a', 'data-b']});
})();
setInterval(() => { if (!_xa()) { forceAuthRequired(); location.reload(); } }, 29000);
_z9();
/* ────────────────────────────────────────────────────────────────────────── */
