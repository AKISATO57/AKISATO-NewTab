(function () {
  try {
    var bg = localStorage.getItem('bg_image') || '';
    var blur = parseInt(localStorage.getItem('bg_blur') || '0', 10) || 0;
    var theme = localStorage.getItem('theme') || 'light';
    var simpleBg = theme === 'dark'
      ? 'linear-gradient(135deg, #020617 0%, #0f172a 48%, #111827 100%)'
      : 'linear-gradient(135deg, #dbeafe 0%, #fce7f3 100%)';

    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.setProperty('--boot-bg-blur', blur + 'px');
    document.documentElement.style.setProperty(
      '--boot-bg-overlay',
      bg ? (theme === 'dark' ? 'rgba(0,0,0,0.70)' : 'rgba(0,0,0,0.20)') : 'rgba(0,0,0,0)'
    );
    document.documentElement.style.setProperty('--boot-simple-bg', simpleBg);

    if (bg) {
      var safeBg = bg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var imageValue = 'url("' + safeBg + '")';
      document.documentElement.classList.add('has-boot-bg');
      document.documentElement.style.setProperty('--boot-bg-image', imageValue);
      document.documentElement.style.setProperty('--page-bg-image', imageValue);
    } else {
      document.documentElement.classList.remove('has-boot-bg');
      document.documentElement.style.setProperty('--page-bg-image', simpleBg);
    }
  } catch (error) {
    console.warn('AKISATO boot preferences could not be restored.', error);
  }

  window.__AKI_APP_MARK_READY__ = function () {
    document.documentElement.dataset.appReady = 'true';
  };

  document.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });
})();
