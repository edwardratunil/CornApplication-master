import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useUser } from '../contexts/UserContext';
import { startHeartbeat, stopHeartbeat } from '../services/heartbeatService';

/**
 * Component that manages heartbeat based on user authentication and app state
 * Should be placed inside UserProvider
 */
export default function HeartbeatManager({ isAuthenticated }) {
  const { user } = useUser();

  // Handle heartbeat based on authentication and user ID
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      // Start heartbeat when user is authenticated
      startHeartbeat(user.id);
    } else {
      // Stop heartbeat when user logs out
      stopHeartbeat();
    }

    // Cleanup on unmount
    return () => {
      stopHeartbeat();
    };
  }, [isAuthenticated, user?.id]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background - stop heartbeat
        // The server-side cron job will mark user as offline after inactivity threshold
        stopHeartbeat();
      } else if (nextAppState === 'active' && isAuthenticated && user?.id) {
        // App came to foreground - restart heartbeat
        startHeartbeat(user.id);
      }
    });

    return () => {
      subscription?.remove();
    };
  }, [isAuthenticated, user?.id]);

  // This component doesn't render anything
  return null;
}

