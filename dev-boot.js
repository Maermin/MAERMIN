// ============================================================================
// MAERMIN - dev boot helper (loading-screen teardown).
// Moved out of an inline <script> in index.html so the page runs under a CSP
// WITHOUT 'unsafe-inline' for scripts. The production build ships its own
// boot.js and skips this file.
// ============================================================================
// No artificial delay: the splash fades as soon as the page has loaded (it
// used to wait an extra ~0.8 s here and ~1.1 s in the production boot.js).
window.addEventListener('load', () => {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 500);
  }
});

