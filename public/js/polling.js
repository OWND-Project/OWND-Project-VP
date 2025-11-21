// Polling mechanism for checking post_states
const pollInterval = 3000; // 3 seconds

async function pollStatus() {
  try {
    const response = await fetch('/oid4vp/states');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.value === 'committed') {
      // Success - redirect to credential info page with requestId as fallback
      const requestId = data.requestId;
      window.location.href = requestId ? `/credential-info?request_id=${requestId}` : '/credential-info';
    } else if (data.value === 'expired' || data.value === 'invalid_submission') {
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
