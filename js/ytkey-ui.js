/* =====================================================================
   YOUTUBE KEY MODAL (shared between index.html and level.html)
   ===================================================================== */

const YtKeyUI = (() => {

  function openModal(onSaved) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="yt-modal-title">
        <h3 id="yt-modal-title">Add a YouTube API key</h3>
        <p>
          View counts and showcase videos come straight from YouTube's Data API,
          so you'll need your own free key to enable them. Get one from the
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a>
          (enable the "YouTube Data API v3"). It's stored only in this browser.
        </p>
        <input type="text" id="yt-key-input" placeholder="AIzaSy..." autocomplete="off" spellcheck="false" value="${escapeHtml(YouTube.getKey())}" />
        <div class="modal-actions">
          <button class="btn-ghost" id="yt-key-cancel">Cancel</button>
          <button class="btn-primary" id="yt-key-save">Save key</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#yt-key-cancel').addEventListener('click', close);
    backdrop.querySelector('#yt-key-save').addEventListener('click', () => {
      const val = backdrop.querySelector('#yt-key-input').value;
      YouTube.setKey(val);
      close();
      if (onSaved) onSaved();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    backdrop.querySelector('#yt-key-input').focus();
  }

  function mountKeyButton(container, onSaved) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.title = YouTube.hasKey() ? 'Update YouTube API key' : 'Add YouTube API key (enables view counts)';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12c0 1-1 3-1 3s-.4 1.4-.9 2c-.7.8-1.4.8-1.8.9C15.9 18 12 18 12 18s-3.9 0-6.3-.1c-.4-.1-1.1-.1-1.8-.9-.5-.6-.9-2-.9-2S2 13 2 12s1-3 1-3 .4-1.4.9-2c.7-.8 1.4-.8 1.8-.9C8.1 6 12 6 12 6s3.9 0 6.3.1c.4.1 1.1.1 1.8.9.5.6.9 2 .9 2s1 2 1 3Z"/><path d="M10 9.5v5l4.5-2.5-4.5-2.5Z" fill="currentColor" stroke="none"/></svg>`;
    btn.addEventListener('click', () => openModal(onSaved));
    container.appendChild(btn);
    return btn;
  }

  return { openModal, mountKeyButton };
})();
