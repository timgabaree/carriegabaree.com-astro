(function () {
  const form = document.querySelector('.contact-form');

  if (!form) {
    return;
  }

  const tokenField = form.querySelector('#csrf_token');
  const submitButton = form.querySelector('button[type="submit"]');
  const statusMessages = {
    missing: 'Please complete all required fields.',
    invalid: 'Please review the form and try again.',
    'invalid-email': 'Please enter a valid email address.',
    'security-error': 'Your form session could not be verified. Please reload this page and try again.',
    'rate-limited': 'Please wait a few minutes before submitting another message.',
    'send-error': 'The message could not be sent. Please email carrie@carriegabaree.com directly.',
    'test-success': 'Staging test passed. Your message was validated, but no email was sent or saved.',
  };

  function showStatus(message) {
    let status = document.querySelector('#contact-form-status');

    if (!status) {
      status = document.createElement('div');
      status.id = 'contact-form-status';
      status.className = 'contact-form-status';
      status.setAttribute('role', 'alert');
      form.parentElement?.insertBefore(status, form);
    }

    status.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.className = 'contact-form-status-message';
    paragraph.textContent = message;
    status.appendChild(paragraph);
    form.setAttribute('aria-describedby', 'contact-form-status contact-required-fields');
  }

  const requestedStatus = new URLSearchParams(window.location.search).get('status');

  if (requestedStatus && Object.hasOwn(statusMessages, requestedStatus)) {
    showStatus(statusMessages[requestedStatus]);
  }

  if (!tokenField || !submitButton) {
    return;
  }

  submitButton.disabled = true;
  form.setAttribute('aria-busy', 'true');

  fetch('/contact-token', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Unable to initialize form security.');
      }

      return response.json();
    })
    .then((payload) => {
      if (typeof payload.csrf_token !== 'string' || !/^[a-f0-9]{64}$/.test(payload.csrf_token)) {
        throw new Error('Missing form security token.');
      }

      tokenField.value = payload.csrf_token;
      if (payload.test_mode === true && !requestedStatus) {
        showStatus('Staging test mode: submissions are validated, but no email is sent or saved.');
      }
      submitButton.disabled = false;
      form.removeAttribute('aria-busy');
    })
    .catch(() => {
      form.removeAttribute('aria-busy');
      showStatus(
        'The secure form is temporarily unavailable. Please email carrie@carriegabaree.com directly.',
      );
    });
})();
