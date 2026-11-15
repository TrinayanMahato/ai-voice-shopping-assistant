// Convert a hex (#rgb / #rrggbb) or rgb() color into an rgba() string.
export function toRgba(color, alpha = 1) {
  if (!color) return `rgba(99,102,241,${alpha})`;
  let h = String(color).trim();
  if (h.startsWith('rgb')) return h;
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return `rgba(99,102,241,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
