export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const pct = (x, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`);
export const int = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));

export function when(iso) {
  const d = new Date(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
