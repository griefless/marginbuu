'use strict';

const FUNCTION_URL = '/.netlify/functions/search-prices';

/* ── Step fragment loader ───────────────────────────────────────────── */
async function loadStep(stageId, fragmentPath) {
  const resp = await fetch(fragmentPath);
  if (!resp.ok) throw new Error(`Failed to load ${fragmentPath}: HTTP ${resp.status}`);
  const html = await resp.text();
  // Guard against redirect loops returning the full page instead of the fragment
  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    throw new Error(`Fragment ${fragmentPath} returned a full HTML page — check redirect rules in netlify.toml`);
  }
  document.getElementById(stageId).innerHTML = html;
}

/* ── Boot ───────────────────────────────────────────────────────────── */
async function init() {
  try {
    // Inject all four step fragments into their stage wrappers
    await Promise.all([
      loadStep('stage-upload',     'steps/step-intake.html'),
      loadStep('stage-review',     'steps/step-review.html'),
      loadStep('stage-processing', 'steps/step-processing.html'),
      loadStep('stage-report',     'steps/step-report.html'),
    ]);
  } catch (err) {
    console.error('[app] Failed to load step fragments:', err.message);
    document.querySelector('.shell').innerHTML = `
      <div style="padding:40px;text-align:center;color:#8b1a1a;font-family:sans-serif">
        <h2>Failed to load application</h2>
        <p style="margin:12px 0;color:#444">${err.message}</p>
        <button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;cursor:pointer">
          Retry
        </button>
      </div>`;
    return;
  }

  // Wire up intake drag-and-drop (requires drop-zone to exist in the DOM)
  const dz = document.getElementById('drop-zone');
  if (dz) {
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  }

  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]); };
  }
}

document.addEventListener('DOMContentLoaded', init);
