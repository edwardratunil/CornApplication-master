import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useUser } from './UserContext';
import { useFarms } from './FarmContext';
import { getUnreadAlertCount } from '../services/farmService';

const AlertContext = createContext();

export function useAlerts() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlerts must be used within an AlertProvider');
  }
  return context;
}

export function AlertProvider({ children }) {
  const { user } = useUser();
  const { farms } = useFarms();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshUnreadCount = useCallback(async () => {
    if (!user?.id) {
      setUnreadCount(0);
      return;
    }

    // Count alerts from all farms owned by the user
    setLoading(true);
    try {
      let totalCount = 0;
      if (farms && farms.length > 0) {
        // Count alerts from all farms
        const countPromises = farms.map(farm => 
          getUnreadAlertCount(user.id, farm.id).catch(() => ({ unread_count: 0 }))
        );
        const results = await Promise.all(countPromises);
        totalCount = results.reduce((sum, result) => sum + (result?.unread_count ?? 0), 0);
      }
      setUnreadCount(totalCount);
    } catch (error) {
      console.warn('Failed to fetch unread alert count:', error);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [user?.id, farms]);

  useEffect(() => {
    refreshUnreadCount();
    // Refresh every 30 seconds
    const interval = setInterval(refreshUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [refreshUnreadCount]);

  const value = {
    unreadCount,
    refreshUnreadCount,
    loading,
  };

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

