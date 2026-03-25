import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useFarms } from '../contexts/FarmContext';
import { useAlerts } from '../contexts/AlertContext';
import { fetchAlerts, acknowledgeAlert } from '../services/farmService';

export default function AlertsScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { user } = useUser();
  const { selectedFarm, farms } = useFarms();
  const { refreshUnreadCount } = useAlerts();
  const styles = useMemo(() => createStyles(theme), [theme]);
  
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const loadAlerts = useCallback(async () => {
    if (!user?.id) {
      console.log('[AlertsScreen] Missing user:', { userId: user?.id });
      setAlerts([]);
      setLoading(false);
      return;
    }

    try {
      console.log('[AlertsScreen] Fetching alerts for all farms of user:', user.id);
      // Fetch alerts from all farms owned by the user
      const response = await fetchAlerts(user.id, null, { 
        fetch_all_farms: true,
        status: 'all', 
        limit: 200 // Increased limit to show more alerts from all farms
      });
      console.log('[AlertsScreen] Full response:', JSON.stringify(response, null, 2));
      console.log('[AlertsScreen] Alerts array:', response?.alerts);
      console.log('[AlertsScreen] Alerts count:', response?.alerts?.length ?? 0);
      
      if (response && response.alerts && Array.isArray(response.alerts)) {
        console.log('[AlertsScreen] Setting alerts:', response.alerts.length);
        setAlerts(response.alerts);
      } else {
        console.warn('[AlertsScreen] Invalid response format:', response);
        setAlerts([]);
      }
    } catch (error) {
      console.error('[AlertsScreen] Failed to load alerts:', error);
      console.error('[AlertsScreen] Error details:', {
        message: error.message,
        stack: error.stack,
      });
      Alert.alert('Error', `Failed to load alerts: ${error.message}`);
      setAlerts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAlerts();
    }, [loadAlerts])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadAlerts();
    refreshUnreadCount();
  }, [loadAlerts, refreshUnreadCount]);

  const handleAcknowledge = useCallback(async (alertId) => {
    if (!user?.id) return;

    try {
      await acknowledgeAlert(user.id, alertId);
      // Update local state
      setAlerts(prevAlerts =>
        prevAlerts.map(alert =>
          alert.id === alertId
            ? { ...alert, status: 'acknowledged', acknowledged_at: new Date().toISOString() }
            : alert
        )
      );
      refreshUnreadCount();
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
      Alert.alert('Error', 'Failed to acknowledge alert. Please try again.');
    }
  }, [user?.id, refreshUnreadCount]);

  const getIconName = (alertType, severity) => {
    switch (alertType) {
      case 'water_low':
      case 'water_critical':
        return 'water-outline';
      case 'pesticide_low':
      case 'pesticide_critical':
        return 'flask-outline';
      case 'temperature_high':
      case 'temperature_low':
        return 'thermometer-outline';
      case 'humidity_high':
      case 'humidity_low':
        return 'water';
      case 'wind_high':
        return 'leaf-outline';
      case 'device_offline':
      case 'device_reconnected':
        return 'wifi-outline';
      case 'schedule_started':
      case 'schedule_completed':
      case 'schedule_failed':
        return 'time-outline';
      default:
        return 'alert-circle-outline';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return theme.colors.danger || '#FF3B30';
      case 'warning':
        return '#FF9500';
      case 'info':
        return theme.colors.accent;
      default:
        return theme.colors.mutedText;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    
    // Parse the date string (backend now returns ISO 8601 format in Philippine timezone)
    const date = new Date(dateString);
    const now = new Date();
    
    // Calculate time difference
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    // Format date in Philippines timezone (already in Philippine time from backend)
    return date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Manila'
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Alerts</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const activeAlerts = alerts.filter(a => a && a.status === 'active');
  
  // Limit acknowledged alerts to recent ones (last 10 or last 7 days)
  const allAcknowledgedAlerts = alerts.filter(a => a && a.status === 'acknowledged');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const recentAcknowledgedAlerts = allAcknowledgedAlerts
    .filter(alert => {
      const acknowledgedDate = alert.acknowledged_at ? new Date(alert.acknowledged_at) : new Date(alert.created_at);
      return acknowledgedDate >= sevenDaysAgo;
    })
    .slice(0, 10); // Limit to 10 most recent
  
  const acknowledgedAlerts = showAcknowledged ? allAcknowledgedAlerts : recentAcknowledgedAlerts;
  
  // Get farm names for display
  const getFarmName = (farmId) => {
    const farm = farms.find(f => f.id === farmId);
    return farm ? farm.name : `Farm #${farmId}`;
  };
  
  console.log('[AlertsScreen] Render - Total alerts:', alerts.length, 'Active:', activeAlerts.length, 'Acknowledged (all):', allAcknowledgedAlerts.length, 'Acknowledged (showing):', acknowledgedAlerts.length);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Alerts</Text>
          <View style={styles.headerSpacer} />
        </View>

        {!loading && alerts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={moderateScale(64)} color={theme.colors.mutedText} />
            <Text style={styles.emptyText}>No alerts</Text>
            <Text style={styles.emptySubtext}>You're all caught up!</Text>
          </View>
        ) : !loading ? (
          <>
            {activeAlerts.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Active ({activeAlerts.length})</Text>
                {activeAlerts.map((alert) => {
                  const isCritical = alert.severity === 'critical';
                  const severityColor = getSeverityColor(alert.severity);
                  const farmName = getFarmName(alert.farm_id);
                  return (
                    <TouchableOpacity
                      key={alert.id}
                      style={[
                        styles.alertCard,
                        isCritical && styles.alertCardCritical,
                      ]}
                      onPress={() => handleAcknowledge(alert.id)}
                    >
                      <View
                        style={[
                          styles.iconContainer,
                          isCritical && styles.iconContainerCritical,
                          { backgroundColor: isCritical ? 'rgba(255, 255, 255, 0.2)' : theme.colors.subtleCard },
                        ]}
                      >
                        <Ionicons
                          name={getIconName(alert.alert_type, alert.severity)}
                          size={moderateScale(24)}
                          color={isCritical ? theme.colors.surface : severityColor}
                        />
                      </View>
                      <View style={styles.alertContent}>
                        <View style={styles.alertHeader}>
                          <View style={styles.alertTitleContainer}>
                          <Text style={[styles.alertTitle, isCritical && styles.alertTitleCritical]}>
                            {alert.title}
                          </Text>
                            {farms.length > 1 && (
                              <Text style={[styles.farmLabel, isCritical && styles.farmLabelCritical]}>
                                {farmName}
                              </Text>
                            )}
                          </View>
                          <Text style={styles.alertTime}>{formatDate(alert.created_at)}</Text>
                        </View>
                        <Text style={[styles.alertDescription, isCritical && styles.alertDescriptionCritical]}>
                          {alert.message}
                        </Text>
                      </View>
                      {alert.status === 'active' && (
                        <TouchableOpacity
                          onPress={() => handleAcknowledge(alert.id)}
                          style={styles.acknowledgeButton}
                        >
                          <Ionicons name="checkmark-circle-outline" size={moderateScale(24)} color={isCritical ? theme.colors.surface : theme.colors.accent} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {acknowledgedAlerts.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { marginTop: moderateScale(24) }]}>
                    Acknowledged ({acknowledgedAlerts.length}{allAcknowledgedAlerts.length > acknowledgedAlerts.length ? ` of ${allAcknowledgedAlerts.length}` : ''})
                  </Text>
                  {allAcknowledgedAlerts.length > recentAcknowledgedAlerts.length && (
                    <TouchableOpacity
                      onPress={() => setShowAcknowledged(!showAcknowledged)}
                      style={styles.toggleButton}
                    >
                      <Text style={styles.toggleButtonText}>
                        {showAcknowledged ? 'Show Less' : 'Show All'}
                </Text>
                      <Ionicons 
                        name={showAcknowledged ? 'chevron-up' : 'chevron-down'} 
                        size={moderateScale(16)} 
                        color={theme.colors.accent} 
                      />
                    </TouchableOpacity>
                  )}
                </View>
                {acknowledgedAlerts.map((alert) => {
                  const severityColor = getSeverityColor(alert.severity);
                  const farmName = getFarmName(alert.farm_id);
                  return (
                    <TouchableOpacity
                      key={alert.id}
                      style={[styles.alertCard, styles.alertCardAcknowledged]}
                    >
                      <View style={[styles.iconContainer, { backgroundColor: theme.colors.subtleCard }]}>
                        <Ionicons
                          name={getIconName(alert.alert_type, alert.severity)}
                          size={moderateScale(24)}
                          color={theme.colors.mutedText}
                        />
                      </View>
                      <View style={styles.alertContent}>
                        <View style={styles.alertHeader}>
                          <View style={styles.alertTitleContainer}>
                          <Text style={styles.alertTitle}>{alert.title}</Text>
                            {farms.length > 1 && (
                              <Text style={styles.farmLabel}>{farmName}</Text>
                            )}
                          </View>
                          <Text style={styles.alertTime}>{formatDate(alert.acknowledged_at || alert.created_at)}</Text>
                        </View>
                        <Text style={styles.alertDescription}>{alert.message}</Text>
                      </View>
                      <Ionicons name="checkmark-circle" size={moderateScale(20)} color={theme.colors.mutedText} />
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    container: {
      flexGrow: 1,
      padding: moderateScale(16),
      paddingBottom: moderateScale(100),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: moderateScale(24),
      paddingHorizontal: moderateScale(4),
    },
    backButton: {
      width: moderateScale(44),
      height: moderateScale(44),
      borderRadius: moderateScale(22),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerTitle: {
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      flex: 1,
      textAlign: 'center',
    },
    headerSpacer: {
      width: moderateScale(24),
    },
    alertCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    alertCardCritical: {
      backgroundColor: theme.colors.danger,
      borderColor: theme.colors.danger,
    },
    iconContainer: {
      width: moderateScale(48),
      height: moderateScale(48),
      borderRadius: moderateScale(24),
      backgroundColor: theme.colors.subtleCard,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: moderateScale(16),
    },
    iconContainerCritical: {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    alertContent: {
      flex: 1,
      marginRight: moderateScale(12),
    },
    alertTitle: {
      fontSize: fontScale(16),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(4),
    },
    alertDescription: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
    },
    alertDescriptionCritical: {
      color: 'rgba(255, 255, 255, 0.9)',
    },
    alertHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(4),
    },
    alertTime: {
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
    },
    alertTitleCritical: {
      color: theme.colors.surface,
    },
    alertTitleContainer: {
      flex: 1,
      marginRight: moderateScale(8),
    },
    farmLabel: {
      fontSize: fontScale(11),
      color: theme.colors.mutedText,
      marginTop: moderateScale(2),
      fontWeight: '500',
    },
    farmLabelCritical: {
      color: 'rgba(255, 255, 255, 0.8)',
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    toggleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(4),
      paddingVertical: moderateScale(4),
      paddingHorizontal: moderateScale(8),
    },
    toggleButtonText: {
      fontSize: fontScale(14),
      color: theme.colors.accent,
      fontWeight: '600',
    },
    alertCardAcknowledged: {
      opacity: 0.7,
    },
    acknowledgeButton: {
      padding: moderateScale(8),
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: moderateScale(100),
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: moderateScale(100),
      paddingHorizontal: moderateScale(32),
    },
    emptyText: {
      fontSize: fontScale(18),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginTop: moderateScale(16),
    },
    emptySubtext: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginTop: moderateScale(8),
    },
    sectionTitle: {
      fontSize: fontScale(16),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(12),
      marginTop: moderateScale(8),
    },
  });
