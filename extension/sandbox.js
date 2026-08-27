/**
 * FinPull - Sandboxed Plaid Link Bridge
 * 
 * Runs inside the sandboxed iframe to handle Plaid Link UI without violating
 * Chrome Manifest V3 Content Security Policies.
 * Communicates with popup.js using postMessage.
 */

window.addEventListener('message', function (event) {
  const data = event.data;
  if (!data || !data.action) return;

  if (data.action === 'OPEN_PLAID_LINK') {
    const linkToken = data.linkToken;

    if (!window.Plaid) {
      window.parent.postMessage({
        action: 'PLAID_LINK_ERROR',
        error: 'Plaid Link SDK failed to load in sandbox.'
      }, '*');
      return;
    }

    try {
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: (public_token, metadata) => {
          // Send public token and institution metadata back to main popup
          window.parent.postMessage({
            action: 'PLAID_LINK_SUCCESS',
            public_token: public_token,
            metadata: metadata
          }, '*');
        },
        onExit: (err, metadata) => {
          window.parent.postMessage({
            action: 'PLAID_LINK_EXIT',
            error: err ? (err.display_message || err.error_message || err.message) : null,
            metadata: metadata
          }, '*');
        },
        onEvent: (eventName, metadata) => {
          window.parent.postMessage({
            action: 'PLAID_LINK_EVENT',
            eventName: eventName,
            metadata: metadata
          }, '*');
        }
      });

      handler.open();
    } catch (err) {
      window.parent.postMessage({
        action: 'PLAID_LINK_ERROR',
        error: err.message || 'Error launching Plaid Link'
      }, '*');
    }
  }
});
