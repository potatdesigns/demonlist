/* =====================================================================
   UTILS
   ===================================================================== */

function qs(param) {
  return new URLSearchParams(window.location.search).get(param);
}

function formatCount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function youTubeThumbnail(videoUrl) {
  const id = extractYouTubeId(videoUrl);
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Difficulty tier (1-6) from a requirement percentage, hardest = 6. */
function tierFromRequirement(requirement) {
  if (requirement === null || requirement === undefined) return 3;
  if (requirement >= 100) return 6;
  if (requirement >= 95) return 5;
  if (requirement >= 90) return 4;
  if (requirement >= 80) return 3;
  if (requirement >= 60) return 2;
  return 1;
}

function tierColorVar(tier) {
  return `var(--tier-${tier})`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Join a list of {name} / string creators into a display string. */
function joinNames(list, max = 3) {
  if (!list || list.length === 0) return 'Unknown';
  const names = list.map(c => (typeof c === 'string' ? c : c.name));
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}
