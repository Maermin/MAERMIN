// Loading-screen status line (was an inline <script> in index.html).
window.updateStatus = function (msg) {
  var el = document.getElementById('module-status');
  if (el) el.textContent = msg;
};
