/**
 * Heartbeat service to keep user activity status updated
 * Sends periodic pings to the server while the app is active
 */

const HOSTINGER_AUTH_URL = '';

// Send heartbeat every 30 seconds while app is active
// More frequent heartbeat = faster detection of disconnection
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

// Track consecutive failures - if we fail 2 times in a row, stop heartbeat
// With 30-second interval, 2 failures = 1 minute, matching cron job frequency
const MAX_CONSECUTIVE_FAILURES = 2;

let heartbeatInterval = null;
let currentUserId = null;
let consecutiveFailures = 0;

/**
 * Start sending heartbeat pings to the server
 * @param {number} userId - The user ID to send heartbeat for
 */
export function startHeartbeat(userId) {
  if (!userId) {
    console.warn('[Heartbeat] Cannot start heartbeat: no user ID');
    return;
  }

  // Stop any existing heartbeat
  stopHeartbeat();

  currentUserId = userId;
  consecutiveFailures = 0; // Reset failure counter
  
  // Send initial heartbeat immediately
  sendHeartbeat(userId);

  // Then send heartbeat at regular intervals
  heartbeatInterval = setInterval(() => {
    sendHeartbeat(userId);
  }, HEARTBEAT_INTERVAL_MS);

  console.log(`[Heartbeat] Started heartbeat for user ${userId}`);
}

/**
 * Stop sending heartbeat pings
 */
export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log(`[Heartbeat] Stopped heartbeat for user ${currentUserId}`);
  }
  
  consecutiveFailures = 0; // Reset failure counter
  currentUserId = null; // Clear user ID when stopping
}

/**
 * Send a single heartbeat ping to the server
 * @param {number} userId - The user ID
 */
async function sendHeartbeat(userId) {
  if (!userId) {
    return;
  }

  try {
    // Create timeout promise - reduced to 5 seconds for faster failure detection
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 5000); // 5 second timeout
    });
    
    // Race between fetch and timeout
    const response = await Promise.race([
      fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'heartbeat',
          user_id: userId,
        }),
      }),
      timeoutPromise,
    ]);

    const data = await response.json().catch(() => null);
    
    if (response.ok && data?.success) {
      // Heartbeat successful - reset failure counter
      consecutiveFailures = 0;
      // Optionally log for debugging (remove in production)
      // console.log('[Heartbeat] Heartbeat sent successfully');
    } else {
      // Heartbeat failed - increment failure counter
      consecutiveFailures++;
      // If we've failed multiple times, likely offline - stop heartbeat
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log('[Heartbeat] Multiple consecutive failures, stopping heartbeat (likely offline)');
        stopHeartbeat();
      }
    }
  } catch (error) {
    // Network error or timeout - increment failure counter
    consecutiveFailures++;
    
    // If we've failed multiple times, likely offline - stop heartbeat
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log('[Heartbeat] Multiple consecutive network failures, stopping heartbeat (likely offline)');
      stopHeartbeat();
    }
  }
}

/**
 * Get the current user ID being tracked
 * @returns {number|null} The current user ID or null
 */
export function getCurrentUserId() {
  return currentUserId;
}

