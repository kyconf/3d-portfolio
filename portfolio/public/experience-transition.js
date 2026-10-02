/* Loaded in <head> on both pages so the cover is ready before their first paint. */
(() => {
  const root = document.documentElement;
  const storageKey = 'portfolio:experience-transition';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let leaving = false;
  let navigationTimer;
  let recoveryTimer;
  let arrivalVersion = 0;

  try {
    const incoming = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    sessionStorage.removeItem(storageKey);
    if (incoming && incoming.path === location.pathname && Date.now() - incoming.at < 15000) {
      root.classList.add('experience-arriving');
    }
  } catch (_) { /* Navigation still works when storage is unavailable. */ }

  function reveal() {
    const version = ++arrivalVersion;
    // Allow restored styles to paint before releasing the opaque cover.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (version !== arrivalVersion || leaving) return;
      root.classList.remove('experience-arriving', 'experience-leaving');
    }));
  }

  function reset() {
    leaving = false;
    clearTimeout(navigationTimer);
    clearTimeout(recoveryTimer);
    reveal();
  }

  function go(path) {
    if (leaving) return;
    const destination = new URL(path, location.href);
    if (destination.origin !== location.origin) return;
    leaving = true;
    ++arrivalVersion;
    root.classList.remove('experience-arriving');
    root.classList.add('experience-leaving');

    const navigate = () => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({
          path: destination.pathname,
          at: Date.now(),
        }));
      } catch (_) {}
      window.location.assign(destination.href);
      // A cancelled navigation must not leave a non-interactive cover behind.
      recoveryTimer = setTimeout(reset, 5000);
    };
    if (reducedMotion.matches) navigate();
    else navigationTimer = setTimeout(navigate, 300);
  }

  const prefetched = new Set();
  function prefetch(path) {
    if (prefetched.has(path)) return;
    prefetched.add(path);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = path;
    document.head.appendChild(link);
  }

  window.portfolioNavigation = { go, prefetch };

  document.addEventListener('DOMContentLoaded', () => {
    // Do not wait on media; only give text a short chance to settle under cover.
    Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise(resolve => setTimeout(resolve, 300)),
    ]).then(reveal);
  }, { once: true });

  window.addEventListener('pagehide', () => {
    clearTimeout(navigationTimer);
    clearTimeout(recoveryTimer);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) reset();
  });
})();
