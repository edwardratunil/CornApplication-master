import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Image,
  ActivityIndicator,
  TextInput,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useFarms } from '../contexts/FarmContext';
import {
  fetchDashboardSnapshot,
  updateFarmRelays,
  fetchThresholds,
  updateThresholds,
  fetchAutomationSettings,
  updateAutomationSettings,
} from '../services/farmService';

const defaultHistory = [
  { id: '1', label: 'Today', value: '80%' },
  { id: '2', label: 'Yesterday', value: '78%' },
  { id: '3', label: '2 days ago', value: '82%' },
  { id: '4', label: '3 days ago', value: '76%' },
];

const initialSensorSnapshot = {
  water_level_cm: 0,
  pesticide_level_cm: 0,
  wind_speed_ms: 0,
  water_flow_lpm: 0,
  temperature_c: 0,
  humidity_percent: 0,
  timestamp: null,
};

const initialRelayState = {
  relay1: 0,
  relay2: 0,
  relay3: 0,
  relay4: 0,
};


function parseNumericValue(value) {
  const numeric = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(numeric) ? 0 : numeric;
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default function WaterLevelScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useUser();
  const { farms } = useFarms();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);
  const { selectedFarm, history = defaultHistory } = route.params || {};

  const [isMistingEnabled, setIsMistingEnabled] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState(null);
  const [sensorData, setSensorData] = useState(initialSensorSnapshot);
  const [relays, setRelays] = useState(initialRelayState);
  const [relayUpdating, setRelayUpdating] = useState(false);
  const [waterThreshold, setWaterThreshold] = useState(20.0); // Default threshold in cm
  const [savedWaterThreshold, setSavedWaterThreshold] = useState(20.0); // Saved value from DB
  const [thresholdLoading, setThresholdLoading] = useState(false);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [isAutomated, setIsAutomated] = useState(false); // false = manual (default), true = automated
  const [durationMinutes, setDurationMinutes] = useState('2'); // Duration in minutes
  const [intervalMinutes, setIntervalMinutes] = useState('60'); // Interval in minutes
  const [automationSaving, setAutomationSaving] = useState(false);
  const sliderWidthRef = useRef(200);

  const sliderStartX = useRef(0);
  const sliderPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        const { locationX } = evt.nativeEvent;
        sliderStartX.current = evt.nativeEvent.pageX - locationX;
        const width = sliderWidthRef.current;
        const percentage = Math.max(0, Math.min(100, (locationX / width) * 100));
        const value = Math.round((percentage / 100) * 80); // Range: 0-80 cm
        setWaterThreshold(Math.max(0, Math.min(80, value)));
      },
      onPanResponderMove: (evt, gestureState) => {
        const width = sliderWidthRef.current;
        const currentX = evt.nativeEvent.pageX - sliderStartX.current;
        const percentage = Math.max(0, Math.min(100, (currentX / width) * 100));
        const value = Math.round((percentage / 100) * 80); // Range: 0-80 cm
        setWaterThreshold(Math.max(0, Math.min(80, value)));
      },
      onPanResponderRelease: () => {
        // Don't auto-save, wait for confirm button
      },
    })
  ).current;





  const normalizeSensorSnapshot = useCallback(
    (data) => ({
      water_level_cm: safeNumber(data?.water_level_cm),
      pesticide_level_cm: safeNumber(data?.pesticide_level_cm),
      wind_speed_ms: safeNumber(data?.wind_speed_ms),
      water_flow_lpm: safeNumber(data?.water_flow_lpm),
      temperature_c: safeNumber(data?.temperature_c),
      humidity_percent: safeNumber(data?.humidity_percent),
      timestamp: data?.timestamp ?? null,
    }),
    []
  );

  const normalizeRelays = useCallback(
    (data) => ({
      relay1: safeNumber(data?.relay1) === 1 ? 1 : 0,
      relay2: safeNumber(data?.relay2) === 1 ? 1 : 0,
      relay3: safeNumber(data?.relay3) === 1 ? 1 : 0,
      relay4: safeNumber(data?.relay4) === 1 ? 1 : 0,
    }),
    []
  );

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedFarm?.id) {
        setSensorData(initialSensorSnapshot);
        setRelays(initialRelayState);
        setIsMistingEnabled(false);
        setSnapshotError(null);
        setSnapshotLoading(false);
        return;
      }

      let isActive = true;

      const loadSnapshot = async () => {
        setSnapshotLoading(true);
        try {
          const response = await fetchDashboardSnapshot(user.id, selectedFarm.id);
          if (!isActive) {
            return;
          }
          const sensorSnapshot = normalizeSensorSnapshot(response?.sensors ?? {});
          const relaySnapshot = normalizeRelays(response?.relays ?? {});
          setSensorData(sensorSnapshot);
          setRelays(relaySnapshot);
          setIsMistingEnabled(Boolean(relaySnapshot.relay1));
          setSnapshotError(null);
        } catch (error) {
          if (isActive) {
            setSensorData(initialSensorSnapshot);
            setRelays(initialRelayState);
            setIsMistingEnabled(false);
            setSnapshotError(error?.message || 'Unable to fetch sensor data right now.');
          }
        } finally {
          if (isActive) {
            setSnapshotLoading(false);
          }
        }
      };

      loadSnapshot();

      return () => {
        isActive = false;
      };
    }, [normalizeRelays, normalizeSensorSnapshot, selectedFarm?.id, user?.id])
  );


  const loadThresholds = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      return;
    }

    setThresholdLoading(true);
    try {
      const response = await fetchThresholds(user.id, selectedFarm.id);
      const thresholds = response?.thresholds ?? {};
      if (thresholds.waterLevelThreshold !== undefined) {
        const value = Number(thresholds.waterLevelThreshold);
        setWaterThreshold(value);
        setSavedWaterThreshold(value);
      }
    } catch (error) {
      // Use default if fetch fails
      console.warn('Failed to load thresholds:', error);
    } finally {
      setThresholdLoading(false);
    }
  }, [selectedFarm?.id, user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadThresholds();
    }, [loadThresholds])
  );

  const saveThreshold = useCallback(
    async () => {
      if (!user?.id || !selectedFarm?.id) {
        return;
      }

      setThresholdSaving(true);
      try {
        await updateThresholds(user.id, selectedFarm.id, {
          waterLevelThreshold: waterThreshold,
        });
        setSavedWaterThreshold(waterThreshold);
      } catch (error) {
        console.warn('Failed to save threshold:', error);
        Alert.alert('Save Failed', error?.message || 'Unable to save threshold. Please try again.');
        // Revert to saved value on error
        setWaterThreshold(savedWaterThreshold);
      } finally {
        setThresholdSaving(false);
      }
    },
    [selectedFarm?.id, user?.id, waterThreshold, savedWaterThreshold]
  );

  const hasThresholdChanged = waterThreshold !== savedWaterThreshold;

  // Check if water level is too low to enable misting
  const isWaterLevelTooLow = useMemo(() => {
    const currentWaterLevel = safeNumber(sensorData.water_level_cm);
    const threshold = safeNumber(waterThreshold);
    return currentWaterLevel === 0 || currentWaterLevel <= threshold;
  }, [sensorData.water_level_cm, waterThreshold]);

  const handleToggleMisting = async (value) => {
    if (!user?.id || !selectedFarm?.id) {
      Alert.alert('Unavailable', 'Farm information is missing.');
      return;
    }

    // Check water level before turning on
    if (value) {
      // Check if pesticide misting is active
      if (relays.relay2 === 1) {
        Alert.alert(
          'Action Not Allowed',
          'Pesticide misting is currently active. Turn it off before enabling water misting.'
        );
        return;
      }

      // Check water level
      const currentWaterLevel = safeNumber(sensorData.water_level_cm);
      const threshold = safeNumber(waterThreshold);
      
      if (currentWaterLevel === 0 || currentWaterLevel <= threshold) {
        Alert.alert(
          'Water Level Too Low',
          `Cannot turn on water misting. Water level (${currentWaterLevel.toFixed(1)} cm) is at or below threshold (${threshold.toFixed(1)} cm). Please refill the water tank.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    setIsMistingEnabled(value);
    setRelayUpdating(true);
    try {
      const response = await updateFarmRelays(user.id, selectedFarm.id, { relay1: value ? 1 : 0 });
      const updatedRelays = normalizeRelays(response?.relays ?? {});
      setRelays(updatedRelays);
      setIsMistingEnabled(Boolean(updatedRelays.relay1));
    } catch (error) {
      setIsMistingEnabled(Boolean(relays.relay1));
      Alert.alert('Update Failed', error?.message || 'Unable to update water misting right now.');
    } finally {
      setRelayUpdating(false);
    }
  };

  const handleToggleAutomation = async (value) => {
    if (!user?.id || !selectedFarm?.id) {
      Alert.alert('Unavailable', 'Farm information is missing.');
      return;
    }

    if (!hasMainDevice) {
      Alert.alert(
        'No Main Device',
        'Please register a main device for this farm before enabling automation. Go to Device Screen to add a main device.',
        [{ text: 'OK' }]
      );
      return;
    }

    const wasAutomated = isAutomated;
    setIsAutomated(value);
    
    // If switching to automated, turn off manual misting
    if (value && isMistingEnabled) {
      handleToggleMisting(false);
    }

    // Save automation mode immediately
    try {
      await updateAutomationSettings(user.id, selectedFarm.id, {
        isAutomated: value,
      });
      
      // If switching from automated to manual mode, reload relay state
      // (backend will turn off relays if automation was running)
      if (wasAutomated && !value) {
        // Reload snapshot to get updated relay state
        try {
          const response = await fetchDashboardSnapshot(user.id, selectedFarm.id);
          const relaySnapshot = normalizeRelays(response?.relays ?? {});
          setRelays(relaySnapshot);
          setIsMistingEnabled(Boolean(relaySnapshot.relay1));
        } catch (error) {
          console.warn('Failed to reload relay state:', error);
        }
      }
    } catch (error) {
      // Revert on error
      setIsAutomated(!value);
      Alert.alert('Update Failed', error?.message || 'Unable to update automation mode. Please try again.');
    }
  };

  const handleSaveAutomation = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      Alert.alert('Unavailable', 'Farm information is missing.');
      return;
    }

    const durationNum = Number(durationMinutes);
    const intervalNum = Number(intervalMinutes);

    if (!Number.isFinite(durationNum) || durationNum <= 0) {
      Alert.alert('Invalid Duration', 'Please enter a valid duration in minutes (greater than 0).');
      return;
    }

    if (!Number.isFinite(intervalNum) || intervalNum <= 0) {
      Alert.alert('Invalid Interval', 'Please enter a valid interval in minutes (greater than 0).');
      return;
    }

    if (intervalNum < durationNum) {
      Alert.alert('Invalid Settings', 'Interval must be greater than or equal to duration.');
      return;
    }

    setAutomationSaving(true);
    try {
      await updateAutomationSettings(user.id, selectedFarm.id, {
        isAutomated,
        durationMinutes: durationNum,
        intervalMinutes: intervalNum,
      });
      Alert.alert('Saved', 'Automation settings saved successfully.');
    } catch (error) {
      Alert.alert('Save Failed', error?.message || 'Unable to save automation settings. Please try again.');
    } finally {
      setAutomationSaving(false);
    }
  }, [durationMinutes, intervalMinutes, isAutomated, selectedFarm?.id, user?.id]);

  const loadAutomationSettings = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      return;
    }

    try {
      const response = await fetchAutomationSettings(user.id, selectedFarm.id);
      const settings = response?.settings ?? {};
      if (settings.isAutomated !== undefined) {
        setIsAutomated(settings.isAutomated);
      }
      if (settings.durationMinutes !== undefined) {
        setDurationMinutes(String(settings.durationMinutes));
      }
      if (settings.intervalMinutes !== undefined) {
        setIntervalMinutes(String(settings.intervalMinutes));
      }
    } catch (error) {
      // Use defaults if fetch fails
      console.warn('Failed to load automation settings:', error);
    }
  }, [selectedFarm?.id, user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadAutomationSettings();
    }, [loadAutomationSettings])
  );

  const hasMainDevice = useMemo(() => {
    if (!selectedFarm?.id) return false;
    const currentFarm = farms.find((f) => f.id === selectedFarm.id);
    return currentFarm?.devices?.some((d) => d.deviceType === 'main') ?? false;
  }, [farms, selectedFarm?.id]);


  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Water Level</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        {selectedFarm && (
          <View style={styles.selectedFarmBadge}>
            <Image
              source={require('../assets/adaptive-icon.png')}
              style={styles.selectedFarmIcon}
            />
            <Text style={styles.selectedFarmText}>{selectedFarm.name}</Text>
          </View>
        )}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Water Level Threshold</Text>
          <View style={styles.thresholdContainer}>
            <Text style={styles.thresholdLabel}>
              Alert when water level is below: {Math.round(waterThreshold)} cm
            </Text>
            <View style={styles.sliderContainer}>
              <Text style={styles.sliderMinLabel}>0 cm</Text>
              <View
                style={styles.sliderWrapper}
                onLayout={(e) => {
                  sliderWidthRef.current = e.nativeEvent.layout.width;
                }}
                {...sliderPanResponder.panHandlers}
              >
                <View style={styles.sliderTrack}>
                  <View
                    style={[
                      styles.sliderFill,
                      { width: `${(waterThreshold / 80) * 100}%` },
                    ]}
                  />
                </View>
                <View
                  style={[
                    styles.sliderThumb,
                    { left: `${(waterThreshold / 80) * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.sliderMaxLabel}>80 cm</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.confirmThresholdButton,
                (!hasThresholdChanged || thresholdSaving) && styles.confirmThresholdButtonDisabled,
              ]}
              onPress={saveThreshold}
              disabled={!hasThresholdChanged || thresholdSaving}
            >
              {thresholdSaving ? (
                <ActivityIndicator size="small" color={theme.colors.surface} />
              ) : (
                <Text style={styles.confirmThresholdButtonText}>Confirm</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.titleRow}>
            <Text style={styles.sectionTitle}>Misting Mode</Text>
            <View style={styles.switchContainer}>
              <Switch
                value={isAutomated}
                onValueChange={handleToggleAutomation}
                thumbColor={isAutomated ? theme.colors.surface : theme.colors.border}
                trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                disabled={
                  !hasMainDevice ||
                  automationSaving ||
                  snapshotLoading ||
                  !user?.id ||
                  !selectedFarm?.id
                }
              />
            </View>
          </View>
          <View style={styles.toggleTextContainer}>
            <Text style={styles.toggleLabel}>
              {isAutomated ? 'Automated' : 'Manual'}
            </Text>
              <Text style={styles.toggleSubLabel}>
                {isAutomated
                  ? 'Water misting runs automatically based on settings'
                  : 'Control water misting manually'}
              </Text>
              {!hasMainDevice && (
                <Text style={styles.disabledHint}>
                  Register a main device to enable automation
                </Text>
              )}
            </View>
        </View>

        {isAutomated && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Automation Settings</Text>
            <View style={styles.automationContainer}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Duration (minutes)</Text>
                <Text style={styles.inputDescription}>
                  How long the misting will run each cycle
                </Text>
                <TextInput
                  style={styles.automationInput}
                  value={durationMinutes}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    if (cleaned === '') {
                      setDurationMinutes('');
                      return;
                    }
                    const num = Math.max(1, Math.min(240, parseInt(cleaned, 10)));
                    setDurationMinutes(String(num));
                  }}
                  keyboardType="number-pad"
                  placeholder="2"
                  maxLength={3}
                  editable={!automationSaving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Interval (minutes)</Text>
                <Text style={styles.inputDescription}>
                  Time between each misting cycle
                </Text>
                <TextInput
                  style={styles.automationInput}
                  value={intervalMinutes}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    if (cleaned === '') {
                      setIntervalMinutes('');
                      return;
                    }
                    const num = Math.max(1, Math.min(1440, parseInt(cleaned, 10)));
                    setIntervalMinutes(String(num));
                  }}
                  keyboardType="number-pad"
                  placeholder="60"
                  maxLength={4}
                  editable={!automationSaving}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.confirmAutomationButton,
                  automationSaving && styles.confirmAutomationButtonDisabled,
                ]}
                onPress={handleSaveAutomation}
                disabled={automationSaving}
              >
                {automationSaving ? (
                  <ActivityIndicator size="small" color={theme.colors.surface} />
                ) : (
                  <Text style={styles.confirmAutomationButtonText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.sectionCard}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextContainer}>
              <Text style={styles.toggleLabel}>Water Misting</Text>
              <Text
                style={[
                  styles.toggleStatus,
                  isMistingEnabled ? styles.statusOn : styles.statusOff,
                ]}
              >
                {isMistingEnabled ? 'Status: ON' : 'Status: OFF'}
              </Text>
              {isAutomated && (
                <Text style={styles.disabledHint}>
                  Disabled in automated mode
                </Text>
              )}
              {!isAutomated && isWaterLevelTooLow && !isMistingEnabled && (
                <Text style={styles.disabledHint}>
                  Water level too low to enable misting
                </Text>
              )}
            </View>
            <View style={styles.switchContainer}>
              <Switch
                value={isMistingEnabled}
                onValueChange={handleToggleMisting}
                thumbColor={isMistingEnabled ? theme.colors.surface : theme.colors.border}
                trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                disabled={
                  isAutomated ||
                  relayUpdating ||
                  snapshotLoading ||
                  !user?.id ||
                  !selectedFarm?.id ||
                  (isWaterLevelTooLow && !isMistingEnabled)
                }
              />
            </View>
          </View>
        </View>

      </ScrollView>

    </SafeAreaView>
  );
}

const createStyles = (theme, insets) =>
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
      paddingBottom: moderateScale(100) + insets.bottom,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: moderateScale(20),
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
      flex: 1,
      textAlign: 'center',
      color: theme.colors.primaryText,
      fontSize: fontScale(20),
      fontWeight: 'bold',
    },
    headerPlaceholder: {
      width: moderateScale(44),
    },
    selectedFarmBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(20),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(6),
      marginBottom: moderateScale(20),
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: moderateScale(8),
    },
    selectedFarmIcon: {
      width: moderateScale(18),
      height: moderateScale(18),
      resizeMode: 'contain',
    },
    selectedFarmText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '500',
    },
    sectionCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(16),
      padding: moderateScale(20),
      marginBottom: moderateScale(20),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    snapshotHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(16),
    },
    snapshotValueContainer: {
      flex: 1,
    },
    snapshotLabel: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      marginBottom: moderateScale(4),
    },
    snapshotValue: {
      color: theme.colors.primaryText,
      fontSize: fontScale(18),
      fontWeight: '600',
    },
    snapshotLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(8),
      marginBottom: moderateScale(12),
    },
    snapshotLoadingText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
    },
    snapshotErrorText: {
      color: theme.colors.danger,
      fontSize: fontScale(12),
      marginBottom: moderateScale(12),
    },
    sectionTitle: {
      color: theme.colors.primaryText,
      fontSize: fontScale(18),
      fontWeight: 'bold',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: moderateScale(16),
    },
    historyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: moderateScale(10),
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    historyLabel: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
    },
    historyValue: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      fontWeight: '600',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: moderateScale(20),
      gap: moderateScale(12),
    },
    toggleTextContainer: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    toggleLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      fontWeight: '500',
    },
    toggleStatus: {
      marginTop: moderateScale(6),
      fontSize: fontScale(14),
      fontWeight: '600',
    },
    statusOn: {
      color: theme.colors.success,
    },
    statusOff: {
      color: theme.colors.danger,
    },
    thresholdContainer: {
      gap: moderateScale(12),
    },
    thresholdLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '500',
    },
    sliderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(12),
      marginVertical: moderateScale(8),
    },
    sliderMinLabel: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      minWidth: moderateScale(40),
    },
    sliderMaxLabel: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      minWidth: moderateScale(40),
    },
    sliderWrapper: {
      flex: 1,
      height: moderateScale(40),
      justifyContent: 'center',
      position: 'relative',
    },
    sliderTrack: {
      height: moderateScale(4),
      backgroundColor: theme.colors.border,
      borderRadius: moderateScale(2),
      position: 'relative',
    },
    sliderFill: {
      height: '100%',
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(2),
      position: 'absolute',
      left: 0,
      top: 0,
    },
    sliderThumb: {
      width: moderateScale(20),
      height: moderateScale(20),
      borderRadius: moderateScale(10),
      backgroundColor: theme.colors.accent,
      borderWidth: 2,
      borderColor: theme.colors.surface,
      position: 'absolute',
      top: moderateScale(-8),
      marginLeft: moderateScale(-10),
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 3,
    },
    thresholdInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(8),
      alignSelf: 'flex-start',
    },
    thresholdInput: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: moderateScale(8),
      paddingVertical: moderateScale(8),
      paddingHorizontal: moderateScale(12),
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      minWidth: moderateScale(80),
      textAlign: 'center',
      backgroundColor: theme.colors.surface,
    },
    thresholdUnit: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
    },
    confirmThresholdButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(10),
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(20),
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: moderateScale(8),
      alignSelf: 'flex-start',
    },
    confirmThresholdButtonDisabled: {
      opacity: 0.5,
      backgroundColor: theme.colors.border,
    },
    confirmThresholdButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(14),
      fontWeight: '600',
    },
    toggleSubLabel: {
      marginTop: moderateScale(4),
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      flexWrap: 'wrap',
    },
    switchContainer: {
      flexShrink: 0,
    },
    disabledHint: {
      marginTop: moderateScale(4),
      color: theme.colors.warning ?? theme.colors.danger,
      fontSize: fontScale(11),
      fontStyle: 'italic',
    },
    automationContainer: {
      gap: moderateScale(16),
      marginTop: moderateScale(8),
    },
    inputGroup: {
      gap: moderateScale(6),
    },
    inputLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '600',
    },
    inputDescription: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
    },
    automationInput: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: moderateScale(10),
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      backgroundColor: theme.colors.surface,
      marginTop: moderateScale(4),
    },
    confirmAutomationButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(10),
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(20),
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: moderateScale(8),
    },
    confirmAutomationButtonDisabled: {
      opacity: 0.5,
      backgroundColor: theme.colors.border,
    },
    confirmAutomationButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(14),
      fontWeight: '600',
    },
  });

