/* =====================================================================
   SETTINGS

   Site-wide preferences, persisted to localStorage (CONFIG.STORAGE.SETTINGS),
   self-mounting a gear icon into #header-actions wherever it exists
   (every page now has the slot) plus a slide-in side panel. Other
   scripts read the current value via Settings.get(key) — list.js/
   detail.js do, see their own comments — rather than this file reaching
   into their DOM directly.

   Accent color (ACCENT_PRESETS below) works the same way as
   reduce-motion: applyEffects() writes --primary/--primary-dark/
   --primary-on onto :root as inline styles, which beats the
   stylesheet's own :root{--primary:...} by specificity — every existing
   var(--primary) reference across css/*.css picks it up unchanged, no
   per-component theming needed. --primary-on exists because dark text
   only reads well on the *default* orange (bright/warm hue); the other
   presets pair with white instead — see ACCENT_PRESETS' own `on` field.

   Reduce-motion is also applied by a tiny inline <script> in every
   page's <head> (before this file, before first paint) — this file's
   own applyEffects() call below is what keeps it applied after a
   change, the inline one is only there so the *first* paint already
   matches a returning visitor's choice. Keep both in sync if the logic
   here changes. (A theme/light-mode setting lived here briefly — cut,
   it didn't look good; see git history if it's ever worth revisiting.)

   No "remove cooldown" toggle here — the per-level refresh cooldown
   (worker/src/index.js) is a single global rate limit shared by every
   visitor, enforced server-side in Cloudflare KV specifically so no
   one visitor can trigger the expensive discover workflow more than
   once per window; a client-side toggle can't honestly bypass that
   (the server would just reject the request the same as ever), and
   the whole point of it being server-enforced was to survive exactly
   that kind of local tampering. See README's "One-click refresh
   trigger" section for the reasoning it was built with.
   ===================================================================== */

const Settings = (() => {
  // Every hue here sits in roughly the same lightness/saturation band as
  // the default orange so it stays legible as a border/glow/badge color
  // wherever --primary is used decoratively — only the on-primary *text*
  // pairing (buttons, active chips) needs to change per hue, hence `on`.
  // Declared in R-O-Y-G-B-Pink order — Object.entries() below preserves
  // insertion order, so this is also the order the swatches render in.
  const ACCENT_PRESETS = {
    red:    { label: 'Red',    primary: '#ef4444', dark: '#dc2626', on: '#ffffff' },
    orange: { label: 'Orange', primary: '#ff6e00', dark: '#e66300', on: '#1a0d00' }, // default
    yellow: { label: 'Yellow', primary: '#eab308', dark: '#ca8a04', on: '#1a1300' },
    green:  { label: 'Green',  primary: '#22c55e', dark: '#16a34a', on: '#ffffff' },
    blue:   { label: 'Blue',   primary: '#3b82f6', dark: '#2563eb', on: '#ffffff' },
    pink:   { label: 'Pink',   primary: '#ec4899', dark: '#db2777', on: '#ffffff' },
  };

  const DEFAULTS = {
    defaultList: 'main', // 'main' | 'extended' — which list list.html opens to with no page in the URL
    displayMode: 'cards', // 'cards' | 'list' — how each level renders in the Main/Extended grid
    accentColor: 'orange', // key into ACCENT_PRESETS above
    openInNewTab: false, // card links / Previous-Next open in a new tab
    autoplayVideos: false, // detail-page video embeds autoplay, muted (browsers block unmuted autoplay outright)
    reduceMotion: false, // same effect as prefers-reduced-motion, opted into manually
  };

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG.STORAGE.SETTINGS) || '{}');
      return { ...DEFAULTS, ...stored };
    } catch {
      return { ...DEFAULTS };
    }
  }

  let state = load();
  const listeners = new Set();

  function persist() {
    try { localStorage.setItem(CONFIG.STORAGE.SETTINGS, JSON.stringify(state)); }
    catch { /* storage full/unavailable — setting still works for this page load, just won't stick */ }
  }

  function applyEffects() {
    document.documentElement.dataset.reduceMotion = state.reduceMotion ? 'true' : 'false';
    const accent = ACCENT_PRESETS[state.accentColor] || ACCENT_PRESETS.orange;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--primary', accent.primary);
    rootStyle.setProperty('--primary-dark', accent.dark);
    rootStyle.setProperty('--primary-on', accent.on);
    const favicon = document.getElementById('dynamic-favicon');
    if (favicon) favicon.href = mascotFaviconDataUri(accent.primary);
  }

  function get(key) { return state[key]; }
  function set(key, value) {
    state[key] = value;
    persist();
    applyEffects();
    listeners.forEach(fn => fn(state));
  }
  /** Called by list.js/detail.js when a setting that changes how they render (openInNewTab, autoplay) changes, so an already-open page updates without a reload. */
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  applyEffects();

  // --- panel UI ---

  const SCHEMA = [
    {
      key: 'accentColor', type: 'swatch', label: 'Accent color',
      desc: 'Retints the whole site — buttons, tier glows, the brand mark.',
      options: Object.entries(ACCENT_PRESETS).map(([key, p]) => [key, p.label, p.primary]),
    },
    {
      key: 'defaultList', type: 'choice', label: 'Default list on open',
      desc: 'Which list list.html opens to when the URL has no page in it.',
      options: [['main', 'Main'], ['extended', 'Extended']],
    },
    {
      key: 'displayMode', type: 'choice', label: 'Level display',
      desc: 'How each level renders in the Main/Extended list — full thumbnail cards, or a denser AREDL-style row list.',
      options: [['cards', 'Cards'], ['list', 'List']],
    },
    {
      key: 'openInNewTab', type: 'toggle', label: 'Open levels in a new tab',
      desc: 'Card links and Previous/Next open in a new tab instead of navigating away.',
    },
    {
      key: 'autoplayVideos', type: 'toggle', label: 'Autoplay videos (muted)',
      desc: 'The verifier and showcase embeds start playing, muted, as soon as a level page loads.',
    },
    {
      key: 'reduceMotion', type: 'toggle', label: 'Reduce motion',
      desc: 'Turns off hover/entrance animations, independent of your OS setting.',
    },
  ];

  const GEAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

  function rowHtml(item) {
    const label = `
      <span class="settings-row-label">
        <span class="settings-title">${escapeHtml(item.label)}</span>
        ${item.desc ? `<span class="settings-desc">${escapeHtml(item.desc)}</span>` : ''}
      </span>
    `;
    if (item.type === 'toggle') {
      return `
        <div class="settings-row">
          ${label}
          <button type="button" class="settings-switch${state[item.key] ? ' on' : ''}" data-key="${item.key}" role="switch" aria-checked="${state[item.key]}" aria-label="${escapeHtml(item.label)}">
            <span class="knob"></span>
          </button>
        </div>
      `;
    }
    if (item.type === 'swatch') {
      return `
        <div class="settings-row settings-row-stack">
          ${label}
          <div class="settings-swatch-group" data-key="${item.key}" role="group" aria-label="${escapeHtml(item.label)}">
            ${item.options.map(([value, text, color]) => `
              <button type="button" class="settings-swatch${state[item.key] === value ? ' active' : ''}" data-value="${value}" style="--swatch-color:${color}" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}"></button>
            `).join('')}
          </div>
        </div>
      `;
    }
    return `
      <div class="settings-row">
        ${label}
        <div class="settings-btn-group" data-key="${item.key}" role="group" aria-label="${escapeHtml(item.label)}">
          ${item.options.map(([value, text]) => `<button type="button" class="settings-btn-opt${state[item.key] === value ? ' active' : ''}" data-value="${value}">${escapeHtml(text)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'icon-btn';
  fab.setAttribute('aria-label', 'Settings');
  fab.title = 'Settings';
  fab.innerHTML = GEAR;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="settings-panel-head">
        <h2>Settings</h2>
        <button type="button" class="settings-close icon-btn" aria-label="Close">&times;</button>
      </div>
      <div class="settings-body">
        ${SCHEMA.map(rowHtml).join('')}
      </div>
    </div>
  `;

  function mount() {
    const headerActions = document.getElementById('header-actions');
    if (!headerActions) return;
    headerActions.appendChild(fab);
    document.body.appendChild(overlay);

    function openPanel() { overlay.classList.add('open'); }
    function closePanel() { overlay.classList.remove('open'); }

    fab.addEventListener('click', openPanel);
    overlay.querySelector('.settings-close').addEventListener('click', closePanel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closePanel(); });

    overlay.querySelectorAll('.settings-switch').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const next = !state[key];
        set(key, next);
        btn.classList.toggle('on', next);
        btn.setAttribute('aria-checked', String(next));
      });
    });
    overlay.querySelectorAll('.settings-btn-group').forEach(group => {
      group.querySelectorAll('.settings-btn-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = group.dataset.key;
          set(key, btn.dataset.value);
          group.querySelectorAll('.settings-btn-opt').forEach(b => b.classList.toggle('active', b === btn));
        });
      });
    });
    overlay.querySelectorAll('.settings-swatch-group').forEach(group => {
      group.querySelectorAll('.settings-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = group.dataset.key;
          set(key, btn.dataset.value);
          group.querySelectorAll('.settings-swatch').forEach(b => b.classList.toggle('active', b === btn));
        });
      });
    });
  }

  mount();

  return { get, set, subscribe, DEFAULTS };
})();
