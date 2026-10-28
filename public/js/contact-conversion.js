(async function () {
  try {
    // The server consumes a one-time session flag after successful mail delivery.
    const response = await fetch('/contact-conversion', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.converted !== true) return;
    window.siteAnalytics?.track({
      event: 'contact_form_submission',
      form_name: 'Continue the Conversation',
      form_location: '/contact',
    });
  } catch {
    // Analytics must not interrupt the thank-you page.
  }
})();
