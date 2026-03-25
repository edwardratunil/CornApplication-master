import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  Alert,
  Platform,
  Image,
  ActivityIndicator,
  TextInput,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useFarms } from '../contexts/FarmContext';
import {
  fetchDashboardSnapshot,
  updateFarmRelays,
  fetchMistingSchedules,
  createMistingSchedule,
  deleteMistingSchedule,
  fetchThresholds,
  updateThresholds,
} from '../services/farmService';

const defaultHistory = [
  { id: '1', label: 'Today', value: '75%' },
  { id: '2', label: 'Yesterday', value: '72%' },
  { id: '3', label: '2 days ago', value: '78%' },
  { id: '4', label: '3 days ago', value: '74%' },
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

const PESTICIDE_DEFAULT_DURATION_MINUTES = 1;

function getInitialScheduleDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 5);
  date.setSeconds(0, 0);
  return date;
}

function parseNumericValue(value) {
  const numeric = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(numeric) ? 0 : numeric;
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default function PesticideLevelScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useUser();
  const { farms } = useFarms();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);
  const { selectedFarm, history = defaultHistory } = route.params || {};

  const [isMistingEnabled, setIsMistingEnabled] = useState(false);
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(getInitialScheduleDate());
  const [durationMinutes, setDurationMinutes] = useState(String(PESTICIDE_DEFAULT_DURATION_MINUTES));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState(null);
  const [sensorData, setSensorData] = useState(initialSensorSnapshot);
  const [relays, setRelays] = useState(initialRelayState);
  const [relayUpdating, setRelayUpdating] = useState(false);
  const [pesticideThreshold, setPesticideThreshold] = useState(20.0); // Default threshold in cm
  const [savedPesticideThreshold, setSavedPesticideThreshold] = useState(20.0); // Saved value from DB
  const [thresholdLoading, setThresholdLoading] = useState(false);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const sliderWidthRef = useRef(200);
  const sliderStartX = useRef(0);

  const sliderPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX } = evt.nativeEvent;
        sliderStartX.current = evt.nativeEvent.pageX - locationX;
        const width = sliderWidthRef.current;
        const percentage = Math.max(0, Math.min(100, (locationX / width) * 100));
        const value = Math.round((percentage / 100) * 80); // Range: 0-80 cm
        setPesticideThreshold(Math.max(0, Math.min(80, value)));
      },
      onPanResponderMove: (evt) => {
        const width = sliderWidthRef.current;
        const currentX = evt.nativeEvent.pageX - sliderStartX.current;
        const percentage = Math.max(0, Math.min(100, (currentX / width) * 100));
        const value = Math.round((percentage / 100) * 80); // Range: 0-80 cm
        setPesticideThreshold(Math.max(0, Math.min(80, value)));
      },
      onPanResponderRelease: () => {
        // Don't auto-save, wait for confirm button
      },
    })
  ).current;


  useEffect(() => {
    if (!scheduleModalVisible) {
      setShowDatePicker(false);
      setShowTimePicker(false);
    }
  }, [scheduleModalVisible]);

  const normalizeSchedules = useCallback((items) => {
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .filter(
        (item) =>
          item &&
          item.scheduleType === 'pesticide' &&
          (item.status === 'pending' || item.status === 'running')
      )
      .map((item) => {
        const scheduledAt = item?.scheduledAt ? new Date(item.scheduledAt) : null;
        const durationMins =
          typeof item?.durationMinutes === 'number' && !Number.isNaN(item.durationMinutes)
            ? Math.max(1, item.durationMinutes)
            : Math.max(1, Math.round((item?.durationSeconds ?? PESTICIDE_DEFAULT_DURATION_MINUTES * 60) / 60));

        return {
          id: item.id,
          status: item.status,
          scheduledAt,
          displayDate: scheduledAt
            ? scheduledAt.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : 'Unknown date',
          displayTime: scheduledAt
            ? scheduledAt.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })
            : '--:--',
          durationMinutes: durationMins,
        };
      })
      .sort((a, b) => {
        const aTime = a.scheduledAt ? a.scheduledAt.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.scheduledAt ? b.scheduledAt.getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });
  }, []);

  const runningSchedule = useMemo(
    () => schedules.find((schedule) => schedule?.status === 'running') || null,
    [schedules]
  );

  const getScheduleEndLabel = useCallback((schedule) => {
    if (!schedule) {
      return null;
    }
    const start = schedule.startedAt ? new Date(schedule.startedAt) : new Date(schedule.scheduledAt);
    if (Number.isNaN(start.getTime())) {
      return null;
    }
    const end = new Date(start.getTime() + (Number(schedule.durationSeconds) || 0) * 1000);
    if (Number.isNaN(end.getTime())) {
      return null;
    }
    return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const loadSchedules = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      setSchedules([]);
      setScheduleError(null);
      setScheduleLoading(false);
      return;
    }

    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const response = await fetchMistingSchedules(user.id, selectedFarm.id);
      const normalized = normalizeSchedules(response?.schedules ?? []);
      setSchedules(normalized);
    } catch (error) {
      setSchedules([]);
      setScheduleError(error?.message || 'Unable to load schedules right now.');
    } finally {
      setScheduleLoading(false);
    }
  }, [normalizeSchedules, selectedFarm?.id, user?.id]);

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
          setIsMistingEnabled(Boolean(relaySnapshot.relay2));
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

  useFocusEffect(
    useCallback(() => {
      loadSchedules();
    }, [loadSchedules])
  );

  const loadThresholds = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      return;
    }

    setThresholdLoading(true);
    try {
      const response = await fetchThresholds(user.id, selectedFarm.id);
      const thresholds = response?.thresholds ?? {};
      if (thresholds.pesticideLevelThreshold !== undefined) {
        const value = Number(thresholds.pesticideLevelThreshold);
        setPesticideThreshold(value);
        setSavedPesticideThreshold(value);
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
          pesticideLevelThreshold: pesticideThreshold,
        });
        setSavedPesticideThreshold(pesticideThreshold);
      } catch (error) {
        console.warn('Failed to save threshold:', error);
        Alert.alert('Save Failed', error?.message || 'Unable to save threshold. Please try again.');
        setPesticideThreshold(savedPesticideThreshold);
      } finally {
        setThresholdSaving(false);
      }
    },
    [selectedFarm?.id, user?.id, pesticideThreshold, savedPesticideThreshold]
  );

  const hasThresholdChanged = pesticideThreshold !== savedPesticideThreshold;

  const isPesticideLevelTooLow = useMemo(() => {
    const currentPesticideLevel = safeNumber(sensorData.pesticide_level_cm);
    const threshold = safeNumber(pesticideThreshold);
    return currentPesticideLevel === 0 || currentPesticideLevel <= threshold;
  }, [sensorData.pesticide_level_cm, pesticideThreshold]);

  const handleRemoveSchedule = useCallback(
    (id) => {
      if (!user?.id || !selectedFarm?.id) {
        return;
      }

      Alert.alert(
        'Cancel Schedule',
        'Are you sure you want to cancel this schedule?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteMistingSchedule(user.id, selectedFarm.id, id);
                await loadSchedules();
              } catch (error) {
                Alert.alert('Unable to cancel schedule', error?.message || 'Please try again.');
              }
            },
          },
        ]
      );
    },
    [loadSchedules, selectedFarm?.id, user?.id]
  );

  const handleConfirmSchedule = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      Alert.alert('Unavailable', 'Farm information is missing.');
      return;
    }

    if (!(scheduleDate instanceof Date)) {
      Alert.alert('Select Date', 'Please select a date and time for the schedule.');
      return;
    }

    const durationNumeric = Number(durationMinutes);
    if (!Number.isFinite(durationNumeric) || durationNumeric <= 0) {
      Alert.alert('Invalid Duration', 'Please enter a misting duration in minutes.');
      return;
    }

    if (scheduleDate.getTime() < Date.now() - 60 * 1000) {
      Alert.alert('Invalid Time', 'Please select a future date and time for the schedule.');
      return;
    }

    setScheduleSaving(true);
    try {
      await createMistingSchedule(user.id, selectedFarm.id, {
        scheduleType: 'pesticide',
        scheduledAt: scheduleDate.toISOString(),
        durationMinutes: Math.round(durationNumeric),
      });
      setScheduleModalVisible(false);
      setDurationMinutes(String(PESTICIDE_DEFAULT_DURATION_MINUTES));
      await loadSchedules();
      Alert.alert('Scheduled', 'Pesticide misting schedule saved successfully.');
    } catch (error) {
      Alert.alert('Unable to save schedule', error?.message || 'Please try again.');
    } finally {
      setScheduleSaving(false);
    }
  }, [durationMinutes, loadSchedules, scheduleDate, selectedFarm?.id, user?.id]);

  const hasMainDevice = useMemo(() => {
    if (!selectedFarm?.id) return false;
    const currentFarm = farms.find((f) => f.id === selectedFarm.id);
    return currentFarm?.devices?.some((d) => d.deviceType === 'main') ?? false;
  }, [farms, selectedFarm?.id]);

  const openModal = () => {
    if (!hasMainDevice) {
      Alert.alert(
        'No Main Device',
        'Please register a main device for this farm before creating schedules. Go to Device Screen to add a main device.',
        [{ text: 'OK' }]
      );
      return;
    }
    setScheduleDate(getInitialScheduleDate());
    setDurationMinutes(String(PESTICIDE_DEFAULT_DURATION_MINUTES));
    setScheduleModalVisible(true);
  };

  const closeModal = () => {
    setScheduleModalVisible(false);
    setScheduleSaving(false);
  };

  const handleDateChange = (event, selected) => {
    if (Platform.OS !== 'ios') {
      setShowDatePicker(false);
    }
    if (event.type === 'dismissed' || !selected) return;
    setScheduleDate((prev) => {
      const updated = new Date(prev || new Date());
      updated.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      return updated;
    });
  };

  const handleTimeChange = (event, selected) => {
    if (Platform.OS !== 'ios') {
      setShowTimePicker(false);
    }
    if (event.type === 'dismissed' || !selected) return;
    setScheduleDate((prev) => {
      const updated = new Date(prev || new Date());
      updated.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      return updated;
    });
  };

  const handleDurationInputChange = (text) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned === '') {
      setDurationMinutes('');
      return;
    }
    const numeric = Math.max(1, Math.min(240, parseInt(cleaned, 10)));
    setDurationMinutes(String(numeric));
  };

  const handleTogglePesticide = async (value) => {
    if (!user?.id || !selectedFarm?.id) {
      Alert.alert('Unavailable', 'Farm information is missing.');
      return;
    }

    // Check pesticide level before turning on
    if (value) {
      // Check if water misting is active
      if (relays.relay1 === 1) {
        Alert.alert(
          'Action Not Allowed',
          'Water misting is currently active. Turn it off before enabling pesticide misting.'
        );
        return;
      }

      // Check pesticide level
      const currentPesticideLevel = safeNumber(sensorData.pesticide_level_cm);
      const threshold = safeNumber(pesticideThreshold);
      
      if (currentPesticideLevel === 0 || currentPesticideLevel <= threshold) {
        Alert.alert(
          'Pesticide Level Too Low',
          `Cannot turn on pesticide misting. Pesticide level (${currentPesticideLevel.toFixed(1)} cm) is at or below threshold (${threshold.toFixed(1)} cm). Please refill the pesticide tank.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    setIsMistingEnabled(value);
    setRelayUpdating(true);
    try {
      const response = await updateFarmRelays(user.id, selectedFarm.id, { relay2: value ? 1 : 0 });
      const updatedRelays = normalizeRelays(response?.relays ?? {});
      setRelays(updatedRelays);
      setIsMistingEnabled(Boolean(updatedRelays.relay2));
    } catch (error) {
      setIsMistingEnabled(Boolean(relays.relay2));
      Alert.alert('Update Failed', error?.message || 'Unable to update pesticide misting right now.');
    } finally {
      setRelayUpdating(false);
    }
  };

  const graphColor = theme.colors.accentSecondary;

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
          <Text style={styles.headerTitle}>Pesticide Level</Text>
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
          <Text style={styles.sectionTitle}>Pesticide Level Threshold</Text>
          <View style={styles.thresholdContainer}>
            <Text style={styles.thresholdLabel}>
              Alert when pesticide level is below: {Math.round(pesticideThreshold)} cm
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
                      { width: `${(pesticideThreshold / 80) * 100}%` },
                    ]}
                  />
                </View>
                <View
                  style={[
                    styles.sliderThumb,
                    { left: `${(pesticideThreshold / 80) * 100}%` },
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
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>Pesticide Misting</Text>
              <Text
                style={[
                  styles.toggleStatus,
                  isMistingEnabled ? styles.statusOn : styles.statusOff,
                ]}
              >
                {isMistingEnabled ? 'Status: ON' : 'Status: OFF'}
              </Text>
              {isPesticideLevelTooLow && !isMistingEnabled && (
                <Text style={styles.disabledHint}>
                  Pesticide level too low to enable misting
                </Text>
              )}
            </View>
            <Switch
              value={isMistingEnabled}
              onValueChange={handleTogglePesticide}
              thumbColor={isMistingEnabled ? theme.colors.surface : theme.colors.border}
              trackColor={{ false: theme.colors.border, true: theme.colors.accentSecondary }}
              disabled={
                relayUpdating ||
                snapshotLoading ||
                !user?.id ||
                !selectedFarm?.id ||
                (isPesticideLevelTooLow && !isMistingEnabled)
              }
            />
          </View>
        </View>

        <View style={styles.sectionCard}>
          {runningSchedule && (
            <View style={styles.runningBanner}>
              <Ionicons
                name="bug-outline"
                size={moderateScale(18)}
                color={theme.colors.surface}
              />
              <Text style={styles.runningBannerText}>
                Scheduled pesticide misting is running
                {getScheduleEndLabel(runningSchedule)
                  ? ` • Ends around ${getScheduleEndLabel(runningSchedule)}`
                  : ''}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.scheduleButton, !hasMainDevice && styles.scheduleButtonDisabled]}
            onPress={openModal}
            disabled={!hasMainDevice}
          >
            <Ionicons name="calendar" size={moderateScale(20)} color={theme.colors.surface} />
            <Text style={styles.scheduleButtonText}>Add Schedule</Text>
          </TouchableOpacity>
          {!hasMainDevice && (
            <Text style={styles.scheduleWarningText}>
              Register a main device to create schedules
            </Text>
          )}

          <View style={styles.scheduleList}>
            <Text style={styles.scheduleListTitle}>Scheduled Pesticide Misting</Text>
            {scheduleLoading ? (
              <View style={styles.scheduleLoadingRow}>
                <ActivityIndicator size="small" color={theme.colors.accent} />
                <Text style={styles.scheduleLoadingText}>Loading schedules...</Text>
              </View>
            ) : scheduleError ? (
              <Text style={styles.scheduleErrorText}>{scheduleError}</Text>
            ) : schedules.length === 0 ? (
              <Text style={styles.scheduleEmptyText}>No schedules added yet.</Text>
            ) : (
              schedules.map((schedule) => {
                const statusLabel =
                  schedule.status === 'running'
                    ? 'Running'
                    : schedule.status === 'pending'
                    ? 'Pending'
                    : schedule.status;
                return (
                  <View key={schedule.id} style={styles.scheduleItem}>
                    <View style={styles.scheduleInfo}>
                      <Text style={styles.scheduleDate}>{schedule.displayDate}</Text>
                      <Text style={styles.scheduleTime}>{schedule.displayTime}</Text>
                      <Text style={styles.scheduleDuration}>
                        Duration: {schedule.durationMinutes} min
                      </Text>
                      <View
                        style={[
                          styles.scheduleStatusChip,
                          schedule.status === 'running'
                            ? styles.scheduleStatusRunning
                            : styles.scheduleStatusPending,
                        ]}
                      >
                        <Text style={styles.scheduleStatusText}>{statusLabel}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.removeScheduleButton}
                      disabled={schedule.status === 'running'}
                      onPress={() => handleRemoveSchedule(schedule.id)}
                    >
                      <Ionicons
                        name="trash"
                        size={moderateScale(18)}
                        color={
                          schedule.status === 'running'
                            ? theme.colors.border
                            : theme.colors.danger
                        }
                      />
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={scheduleModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Schedule Pesticide Misting</Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={moderateScale(22)} color={theme.colors.icon} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.selectorButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Ionicons name="calendar" size={moderateScale(20)} color={theme.colors.icon} />
              <Text style={styles.selectorButtonText}>
                {scheduleDate.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.selectorButton}
              onPress={() => setShowTimePicker(true)}
            >
              <Ionicons name="time" size={moderateScale(20)} color={theme.colors.icon} />
              <Text style={styles.selectorButtonText}>
                {scheduleDate.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </Text>
            </TouchableOpacity>

            <View style={styles.durationContainer}>
              <Text style={styles.durationLabel}>Duration (minutes)</Text>
              <TextInput
                style={styles.durationInput}
                value={durationMinutes}
                onChangeText={handleDurationInputChange}
                keyboardType="number-pad"
                placeholder="Minutes"
                maxLength={3}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.confirmScheduleButton,
                scheduleSaving && styles.confirmScheduleButtonDisabled,
              ]}
              onPress={handleConfirmSchedule}
              disabled={scheduleSaving}
            >
              {scheduleSaving ? (
                <ActivityIndicator size="small" color={theme.colors.surface} />
              ) : (
                <Text style={styles.confirmScheduleText}>Save Schedule</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {showDatePicker && (
        <DateTimePicker
          value={scheduleDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleDateChange}
        />
      )}

      {showTimePicker && (
        <DateTimePicker
          value={scheduleDate}
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleTimeChange}
        />
      )}
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
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(20),
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
    disabledHint: {
      marginTop: moderateScale(4),
      color: theme.colors.warning ?? theme.colors.danger,
      fontSize: fontScale(11),
      fontStyle: 'italic',
    },
    runningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(8),
      backgroundColor: theme.colors.warning ?? theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(10),
      marginBottom: moderateScale(16),
    },
    runningBannerText: {
      flex: 1,
      color: theme.colors.surface,
      fontSize: fontScale(13),
      fontWeight: '600',
    },
    scheduleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: moderateScale(8),
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(14),
    },
    scheduleButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(16),
      fontWeight: '600',
    },
    scheduleList: {
      marginTop: moderateScale(20),
      gap: moderateScale(12),
    },
    scheduleListTitle: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      fontWeight: '600',
    },
    scheduleLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(6),
    },
    scheduleLoadingText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
    },
    scheduleErrorText: {
      color: theme.colors.danger,
      fontSize: fontScale(13),
    },
    scheduleEmptyText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
    },
    scheduleItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    scheduleInfo: {
      gap: moderateScale(2),
    },
    scheduleDate: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '600',
    },
    scheduleTime: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
    },
    scheduleDuration: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
    },
    scheduleStatusChip: {
      alignSelf: 'flex-start',
      marginTop: moderateScale(4),
      paddingHorizontal: moderateScale(8),
      paddingVertical: moderateScale(4),
      borderRadius: moderateScale(12),
    },
    scheduleStatusRunning: {
      backgroundColor: theme.colors.successAlpha ?? 'rgba(76, 175, 80, 0.12)',
    },
    scheduleStatusPending: {
      backgroundColor: theme.colors.warningAlpha ?? 'rgba(255, 193, 7, 0.12)',
    },
    scheduleStatusText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(12),
      fontWeight: '600',
    },
    removeScheduleButton: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(18),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: moderateScale(20),
    },
    modalCard: {
      width: '90%',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(20),
      padding: moderateScale(20),
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: moderateScale(12),
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalTitle: {
      color: theme.colors.primaryText,
      fontSize: fontScale(18),
      fontWeight: 'bold',
    },
    selectorButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    selectorButtonText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      fontWeight: '500',
    },
    durationContainer: {
      marginTop: moderateScale(8),
      gap: moderateScale(6),
    },
    durationLabel: {
      color: theme.colors.mutedText,
      fontSize: fontScale(13),
    },
    durationInput: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: moderateScale(10),
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(12),
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      backgroundColor: theme.colors.surface,
    },
    confirmScheduleButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(14),
      paddingVertical: moderateScale(14),
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: moderateScale(12),
    },
    confirmScheduleButtonDisabled: {
      opacity: 0.7,
    },
    confirmScheduleText: {
      color: theme.colors.surface,
      fontSize: fontScale(16),
      fontWeight: '600',
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
      backgroundColor: theme.colors.accentSecondary,
      borderRadius: moderateScale(2),
      position: 'absolute',
      left: 0,
      top: 0,
    },
    sliderThumb: {
      width: moderateScale(20),
      height: moderateScale(20),
      borderRadius: moderateScale(10),
      backgroundColor: theme.colors.accentSecondary,
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
      backgroundColor: theme.colors.accentSecondary,
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
    scheduleButtonDisabled: {
      opacity: 0.5,
    },
    scheduleWarningText: {
      color: theme.colors.warning ?? theme.colors.danger,
      fontSize: fontScale(12),
      textAlign: 'center',
      marginTop: moderateScale(8),
      fontStyle: 'italic',
    },
  });

