// Polling mechanism for checking post_states
const pollInterval = 3000; // 3 seconds

async function pollStatus() {
  try {
    const response = await fetch('/oid4vp/states');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const requestId = data.requestId;

    // Check if already committed (Option B+C)
    if (requestId) {
      const committedKey = `committed_${requestId}`;
      if (sessionStorage.getItem(committedKey) === 'true') {
        console.log('Already committed, stopping polling');
        return;
      }
    }

    if (data.value === 'committed') {
      // Mark as committed to prevent future error redirects
      if (requestId) {
        sessionStorage.setItem(`committed_${requestId}`, 'true');
      }

      // Success - redirect to credential info page with requestId as fallback
      window.location.href = requestId ? `/credential-info?request_id=${requestId}` : '/credential-info';
    } else if (data.value === 'expired' || data.value === 'invalid_submission') {
      // Only redirect to error if not yet committed
      if (requestId) {
        const committedKey = `committed_${requestId}`;
        if (sessionStorage.getItem(committedKey) === 'true') {
          console.log('Already committed, ignoring error state');
          return;
        }
      }

      // Error - redirect to error page
      window.location.href = `/error?type=${data.value}`;
    } else {
      // Continue polling
      setTimeout(pollStatus, pollInterval);
    }
  } catch (error) {
    console.error('Polling error:', error);
    // Continue polling even on error
    setTimeout(pollStatus, pollInterval);
  }
}

// Start polling when page loads
window.addEventListener('DOMContentLoaded', () => {
  pollStatus();
});
