(function () {
  const key = 'rge-analytics-choice-v1';
  const lifetime = 180 * 24 * 60 * 60 * 1000;
  const panel = document.querySelector('[data-analytics-panel]');
  if (!panel) return;
  const status = document.querySelector('[data-analytics-status]');
  const opener = document.querySelector('[data-analytics-open]');
  const reject = document.querySelector('[data-analytics-reject]');
  let loaded = false;
  let openedFromFooter = false;
  const dismissedKey = 'rge-analytics-dismissed-v1';
  function closeChoices() {
    panel.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    // Dismissing is not consent. Avoid repeating the notice on every page this session.
    try { sessionStorage.setItem(dismissedKey, '1'); } catch { /* Optional storage. */ }
    if (openedFromFooter) opener.focus({ preventScroll: true });
    else {
      const main = document.getElementById('main-content');
      main?.setAttribute('tabindex', '-1');
      main?.focus({ preventScroll: true });
    }
  }

  function readChoice() {
    try {
      // Fail closed if preferences cannot be saved, including in restricted browsers.
      localStorage.setItem(`${key}-check`, '1');
      localStorage.removeItem(`${key}-check`);
      const value = JSON.parse(localStorage.getItem(key));
      return value && ['accepted', 'declined'].includes(value.choice) &&
        Number.isFinite(value.expires) && value.expires > Date.now() &&
        value.expires <= Date.now() + lifetime ? value.choice : null;
    } catch { return null; }
  }

  let choice = readChoice();
  function clearAnalyticsCookies() {
    // Leave form/security cookies alone.
    for (const part of document.cookie.split(';')) {
      const name = part.trim().split('=')[0];
      if (!/^(_ga(?:_|$)|_gid$|_gat(?:_|$)|_gac_|_gcl_)/.test(name)) continue;
      for (const domain of ['', window.location.hostname, '.carriegabaree.com']) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
      }
    }
  }

  function loadAnalytics() {
    if (loaded || choice !== 'accepted' || panel.dataset.analyticsEnabled !== 'true' ||
        window.location.hostname !== 'carriegabaree.com') return;
    loaded = true;
    window['ga-disable-G-39QGYP8FPR'] = false;
    window.dataLayer = [];
    function consent() { window.dataLayer.push(arguments); }
    consent('consent', 'default', {
      analytics_storage: 'denied', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied',
    });
    consent('consent', 'update', { analytics_storage: 'granted' });
    window.gtag = consent;
    consent('js', new Date());
    consent('config', 'G-39QGYP8FPR', { allow_google_signals: false, allow_ad_personalization_signals: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-39QGYP8FPR';
    document.head.appendChild(script);
  }

  // Never queue activity that occurred before consent, or on preview/staging hosts.
  window.siteAnalytics = {
    track(event) {
      if (choice === 'accepted' && loaded) { const { event: name, ...parameters } = event; window.gtag('event', name, parameters); }
    },
  };

  function choose(next) {
    try {
      localStorage.setItem(key, JSON.stringify({ choice: next, expires: Date.now() + lifetime }));
    } catch {
      if (next === 'accepted') {
        status.textContent = 'Your browser cannot save this choice. Analytics remain off; you can continue using the site.';
        return;
      }
      // readChoice also fails closed when storage is unavailable after a reload.
      try { localStorage.removeItem(key); } catch { /* Storage is restricted. */ }
    }
    choice = next;
    if (next === 'declined') {
      window['ga-disable-G-39QGYP8FPR'] = true;
      clearAnalyticsCookies();
      // Unload already-running tags and listeners, not just the script element.
      if (loaded) { window.location.reload(); return; }
    }
    closeChoices();
    loadAnalytics();
  }

  document.querySelector('[data-analytics-settings]').hidden = false;
  opener.addEventListener('click', function () {
    openedFromFooter = true;
    panel.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    status.textContent = choice === 'accepted' ? 'Google Analytics cookies are allowed.' : 'Google Analytics cookies are off.';
    reject.focus();
  });
  reject.addEventListener('click', () => choose('declined'));
  document.querySelector('[data-analytics-accept]').addEventListener('click', () => choose('accepted'));
  document.querySelector('[data-analytics-close]').addEventListener('click', closeChoices);
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); closeChoices(); }
  });
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== null) return;
    choice = readChoice();
    if (choice !== 'accepted' && loaded) {
      window['ga-disable-G-39QGYP8FPR'] = true;
      clearAnalyticsCookies();
      window.location.reload();
    } else {
      panel.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      loadAnalytics();
    }
  });
  // Small, non-modal notice: never steal focus or treat dismissal as consent.
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(dismissedKey) === '1'; } catch { /* Show the notice. */ }
  panel.hidden = Boolean(choice) || dismissed;
  opener.setAttribute('aria-expanded', String(!panel.hidden));
  if (choice !== 'accepted') clearAnalyticsCookies();
  loadAnalytics();
})();
