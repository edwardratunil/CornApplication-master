import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { moderateScale, fontScale } from '../utils/responsive';
import { useFarms } from '../contexts/FarmContext';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useAlerts } from '../contexts/AlertContext';
import { fetchDashboardSnapshot } from '../services/farmService';

const WEATHER_API_KEY = '698df9fdc1634e1bb02135651252006';

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

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

const safeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export default function HomeScreen() {
  const navigation = useNavigation();
  const { unreadCount } = useAlerts();
  const { farms, selectedFarm, setSelectedFarm } = useFarms();
  const { user } = useUser();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [farmModalVisible, setFarmModalVisible] = useState(false);
  const [sensorSnapshot, setSensorSnapshot] = useState(initialSensorSnapshot);
  const [relaySnapshot, setRelaySnapshot] = useState(initialRelayState);
  const [runningSchedules, setRunningSchedules] = useState([]);
  const [sensorError, setSensorError] = useState(null);
  const [sensorLoading, setSensorLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const waterBlinkAnim = useRef(new Animated.Value(0)).current;
  const pesticideBlinkAnim = useRef(new Animated.Value(0)).current;
  const waterBlinkLoop = useRef(null);
  const pesticideBlinkLoop = useRef(null);

  const waterHistory = useMemo(
    () => {
      // Only show sensor data when a farm is selected
      const hasFarm = selectedFarm?.id !== undefined;
      const waterLevel = hasFarm && sensorSnapshot.timestamp
        ? sensorSnapshot.water_level_cm.toFixed(2)
        : '--';
      const flowRate = hasFarm && sensorSnapshot.timestamp
        ? sensorSnapshot.water_flow_lpm.toFixed(2)
        : '--';
      
      return [
        {
          id: 'water_current',
          label: 'Current Level',
          value: `${waterLevel} cm`,
        },
        {
          id: 'water_flow',
          label: 'Flow Rate',
          value: `${flowRate} L/min`,
        },
      ];
    },
    [sensorSnapshot.water_flow_lpm, sensorSnapshot.water_level_cm, sensorSnapshot.timestamp, selectedFarm?.id]
  );

  const pesticideHistory = useMemo(
    () => {
      // Only show sensor data when a farm is selected
      const hasFarm = selectedFarm?.id !== undefined;
      const pesticideLevel = hasFarm && sensorSnapshot.timestamp
        ? sensorSnapshot.pesticide_level_cm.toFixed(2)
        : '--';
      
      return [
        {
          id: 'pesticide_current',
          label: 'Current Level',
          value: `${pesticideLevel} cm`,
        },
      ];
    },
    [sensorSnapshot.pesticide_level_cm, sensorSnapshot.timestamp, selectedFarm?.id]
  );

  const temperatureHistory = useMemo(
    () => {
      // Only use database sensor data, not weather API
      const hasFarm = selectedFarm?.id !== undefined;
      const hasData = hasFarm && sensorSnapshot.timestamp;
      const tempValue = hasData
        ? sensorSnapshot.temperature_c.toFixed(1)
        : '--';
      
      return [
        {
          id: 'temp_today',
          label: 'Today',
          value: `${tempValue}°C`,
        },
        { id: 'temp_yesterday', label: 'Yesterday', value: '--°C' },
        { id: 'temp_2days', label: '2 days ago', value: '--°C' },
      ];
    },
    [sensorSnapshot.temperature_c, sensorSnapshot.timestamp, selectedFarm?.id]
  );

  const humidityHistory = useMemo(
    () => {
      // Only use database sensor data, not weather API
      const hasFarm = selectedFarm?.id !== undefined;
      const hasData = hasFarm && sensorSnapshot.timestamp;
      const humidityValue = hasData
        ? sensorSnapshot.humidity_percent.toFixed(0)
        : '--';
      
      return [
        {
          id: 'humidity_today',
          label: 'Today',
          value: `${humidityValue}%`,
        },
        { id: 'humidity_yesterday', label: 'Yesterday', value: '--%' },
        { id: 'humidity_2days', label: '2 days ago', value: '--%' },
      ];
    },
    [sensorSnapshot.humidity_percent, sensorSnapshot.timestamp, selectedFarm?.id]
  );

  const flowRateHistory = useMemo(
    () => {
      // Only show sensor data when a farm is selected
      const hasFarm = selectedFarm?.id !== undefined;
      const flowValue = hasFarm && sensorSnapshot.timestamp
        ? sensorSnapshot.water_flow_lpm.toFixed(2)
        : '--';
      
      return [
        {
          id: 'flow_today',
          label: 'Today',
          value: `${flowValue} L/min`,
        },
        { id: 'flow_yesterday', label: 'Yesterday', value: '2.5 L/min' },
        { id: 'flow_2days', label: '2 days ago', value: '2.8 L/min' },
      ];
    },
    [sensorSnapshot.water_flow_lpm, sensorSnapshot.timestamp, selectedFarm?.id]
  );

  const waterSchedule = useMemo(
    () =>
      runningSchedules.find(
        (schedule) => schedule?.scheduleType === 'water' && schedule?.status === 'running'
      ) || null,
    [runningSchedules]
  );

  const pesticideSchedule = useMemo(
    () =>
      runningSchedules.find(
        (schedule) => schedule?.scheduleType === 'pesticide' && schedule?.status === 'running'
      ) || null,
    [runningSchedules]
  );

  const isWaterActive = Boolean(waterSchedule) || relaySnapshot.relay1 === 1;
  const isPesticideActive = Boolean(pesticideSchedule) || relaySnapshot.relay2 === 1;

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

  const windHistory = useMemo(
    () => {
      // Only use database sensor data, not weather API
      const hasFarm = selectedFarm?.id !== undefined;
      let windSpeedKmh = '--';
      
      if (hasFarm && sensorSnapshot.timestamp) {
        // Convert m/s to km/h (multiply by 3.6)
        windSpeedKmh = (sensorSnapshot.wind_speed_ms * 3.6).toFixed(1);
      }
      
      return [
        {
          id: 'wind_today',
          label: 'Today',
          value: `${windSpeedKmh} km/h`,
        },
        { id: 'wind_yesterday', label: 'Yesterday', value: '-- km/h' },
        { id: 'wind_2days', label: '2 days ago', value: '-- km/h' },
      ];
    },
    [sensorSnapshot.wind_speed_ms, sensorSnapshot.timestamp, selectedFarm?.id]
  );

  const waterCardBackground = waterBlinkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.card, 'rgba(52, 199, 89, 0.35)'],
  });
  const pesticideCardBackground = pesticideBlinkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.card, 'rgba(255, 204, 0, 0.35)'],
  });
  const waterCardScale = waterBlinkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });
  const pesticideCardScale = pesticideBlinkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });

  const handleNavigate = (screenName, extraParams = {}) => {
    navigation.navigate(screenName, {
      selectedFarm,
      ...extraParams,
    });
  };

  // Farm selection is now handled automatically in FarmContext

  const handleSelectFarm = (farm) => {
    setSelectedFarm(farm);
    setFarmModalVisible(false);
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchWeather({ silent: true }),
        loadSensorSnapshot({ silent: true }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchWeather, loadSensorSnapshot]);

  const loadSensorSnapshot = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id || !selectedFarm?.id) {
      setSensorSnapshot(initialSensorSnapshot);
      setRelaySnapshot(initialRelayState);
      setRunningSchedules([]);
      setSensorError(null);
      setSensorLoading(false);
      return;
    }

    if (!silent) {
      setSensorLoading(true);
    }

    try {
      const response = await fetchDashboardSnapshot(user.id, selectedFarm.id);
      const sensors = response?.sensors ?? {};
      const relays = response?.relays ?? {};
      const running = Array.isArray(response?.runningSchedules) ? response.runningSchedules : [];
      setSensorSnapshot({
        water_level_cm: safeNumber(sensors.water_level_cm),
        pesticide_level_cm: safeNumber(sensors.pesticide_level_cm),
        wind_speed_ms: safeNumber(sensors.wind_speed_ms),
        water_flow_lpm: safeNumber(sensors.water_flow_lpm),
        temperature_c: safeNumber(sensors.temperature_c),
        humidity_percent: safeNumber(sensors.humidity_percent),
        timestamp: sensors.timestamp ?? null,
      });
      setRelaySnapshot({
        relay1: safeNumber(relays.relay1) === 1 ? 1 : 0,
        relay2: safeNumber(relays.relay2) === 1 ? 1 : 0,
        relay3: safeNumber(relays.relay3) === 1 ? 1 : 0,
        relay4: safeNumber(relays.relay4) === 1 ? 1 : 0,
      });
      setRunningSchedules(running);
      setSensorError(null);
    } catch (error) {
      setSensorSnapshot(initialSensorSnapshot);
      setRelaySnapshot(initialRelayState);
      setRunningSchedules([]);
      setSensorError(error?.message || 'Unable to fetch sensor data.');
    } finally {
      if (!silent) {
        setSensorLoading(false);
      }
    }
  }, [selectedFarm?.id, user?.id]);

  useEffect(() => {
    loadSensorSnapshot();
  }, [loadSensorSnapshot]);

  useEffect(() => {
    waterBlinkLoop.current?.stop();
    if (isWaterActive) {
      waterBlinkLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(waterBlinkAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: false,
          }),
          Animated.timing(waterBlinkAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: false,
          }),
        ])
      );
      waterBlinkLoop.current.start();
    } else {
      waterBlinkAnim.setValue(0);
    }

    return () => {
      waterBlinkLoop.current?.stop();
    };
  }, [isWaterActive, waterBlinkAnim]);

  useEffect(() => {
    pesticideBlinkLoop.current?.stop();
    if (isPesticideActive) {
      pesticideBlinkLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pesticideBlinkAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: false,
          }),
          Animated.timing(pesticideBlinkAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: false,
          }),
        ])
      );
      pesticideBlinkLoop.current.start();
    } else {
      pesticideBlinkAnim.setValue(0);
    }

    return () => {
      pesticideBlinkLoop.current?.stop();
    };
  }, [isPesticideActive, pesticideBlinkAnim]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const refreshSilently = async () => {
        await loadSensorSnapshot({ silent: true });
      };

      refreshSilently();
      const interval = setInterval(() => {
        if (isActive) {
          refreshSilently();
        }
      }, 15000);

      return () => {
        isActive = false;
        clearInterval(interval);
      };
    }, [loadSensorSnapshot])
  );

  const fetchWeather = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission to access location was denied.');
        return;
      }

      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      if (!location || !location.coords) {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown && lastKnown.coords) {
          location = lastKnown;
        } else {
          setError('Unable to determine location.');
          return;
        }
      }

      const lat = location.coords.latitude;
      const lon = location.coords.longitude;
      const url = ``;

      const res = await fetch(url);
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (!data?.location || !data?.current) {
          setError('Invalid data from weather API.');
        } else {
          setWeather(data);
        }
      } catch (e) {
        setError('Failed to parse weather data.');
      }
    } catch (err) {
      setError(err?.message || 'Unable to fetch weather data.');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  const getWeatherIcon = (condition) => {
    const conditionText = condition?.toLowerCase() || '';
    if (conditionText.includes('sun') || conditionText.includes('clear')) {
      return { name: 'sunny', color: '#FFC107' };
    } else if (conditionText.includes('rain')) {
      return { name: 'rainy', color: '#2196F3' };
    } else if (conditionText.includes('cloud')) {
      return { name: 'cloudy', color: theme.colors.mutedText };
    }
    return { name: 'partly-sunny', color: theme.colors.mutedText };
  };

  const getDayAbbreviation = (dateString) => {
    const date = new Date(dateString);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>CORN MIST</Text>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => navigation.navigate('AlertsScreen')}
          >
            <View style={styles.bellContainer}>
              <Ionicons name="notifications-outline" size={moderateScale(22)} color={theme.colors.icon} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.weatherCard}>
          <View style={styles.currentWeather}>
            <View style={styles.currentWeatherLeft}>
              <Text style={styles.locationText}>
                {weather ? `${weather.location.name}, ${weather.location.region}` : 'Loading...'}
              </Text>
              <Text style={styles.temperatureText}>
                {weather ? Math.round(weather.current.temp_c) : '--'}°
              </Text>
              <Text style={styles.conditionText}>
                {weather ? weather.current.condition.text : 'Loading...'}
              </Text>
            </View>
            <View style={styles.currentWeatherRight}>
              {weather && (
                <Ionicons
                  name={getWeatherIcon(weather.current.condition.text).name}
                  size={moderateScale(80)}
                  color={getWeatherIcon(weather.current.condition.text).color}
                />
              )}
            </View>
          </View>

          <View style={styles.forecastContainer}>
            {weather && weather.forecast ? (
              weather.forecast.forecastday.slice(0, 5).map((day, index) => {
                const dayIcon = getWeatherIcon(day.day.condition.text);
                return (
                  <View key={index} style={styles.forecastDay}>
                    <Text style={styles.forecastDayText}>{getDayAbbreviation(day.date)}</Text>
                    <Ionicons
                      name={dayIcon.name}
                      size={moderateScale(24)}
                      color={dayIcon.color}
                    />
                    {day.day.daily_chance_of_rain > 0 ? (
                      <Text style={styles.forecastValue}>{day.day.daily_chance_of_rain}%</Text>
                    ) : (
                      <Text style={styles.forecastValue}>{Math.round(day.day.avgtemp_c)}°</Text>
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.loadingText}>Loading forecast...</Text>
            )}
          </View>
        </View>

        {sensorSnapshot.timestamp && (
          <Text style={styles.sensorTimestamp}>
            Last updated: {new Date(sensorSnapshot.timestamp).toLocaleString()}
          </Text>
        )}

        {sensorLoading && (
          <View style={styles.sensorStatusRow}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.sensorStatusText}>Updating sensor data...</Text>
          </View>
        )}
        {sensorError && !sensorLoading && (
          <Text style={styles.sensorErrorText}>{sensorError}</Text>
        )}

        {(Boolean(waterSchedule) || Boolean(pesticideSchedule)) && (
          <View style={styles.runningBanner}>
            {waterSchedule && (
              <View style={styles.runningBannerRow}>
                <Ionicons name="water-outline" size={moderateScale(18)} color={theme.colors.surface} />
                <Text style={styles.runningBannerText}>
                  Water misting schedule running
                  {getScheduleEndLabel(waterSchedule)
                    ? ` • Ends around ${getScheduleEndLabel(waterSchedule)}`
                    : ''}
                </Text>
              </View>
            )}
            {pesticideSchedule && (
              <View style={styles.runningBannerRow}>
                <Ionicons name="bug-outline" size={moderateScale(18)} color={theme.colors.surface} />
                <Text style={styles.runningBannerText}>
                  Pesticide misting schedule running
                  {getScheduleEndLabel(pesticideSchedule)
                    ? ` • Ends around ${getScheduleEndLabel(pesticideSchedule)}`
                    : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Real-time Data</Text>
            <Text style={styles.selectedFarmName}>
              {selectedFarm ? selectedFarm.name : 'No farm selected'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.selectFarmButton}
            onPress={() => setFarmModalVisible(true)}
          >
            <Ionicons name="swap-horizontal" size={moderateScale(18)} color={theme.colors.surface} />
            <Text style={styles.selectFarmText}>Select Farm</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dataGrid}>
          <AnimatedTouchableOpacity
            style={[
              styles.dataCard,
              {
                backgroundColor: waterCardBackground,
                transform: [{ scale: waterCardScale }],
              },
              !selectedFarm?.id && styles.dataCardDisabled,
            ]}
            onPress={() =>
              handleNavigate('WaterLevelScreen', {
                history: waterHistory,
              })
            }
            disabled={!selectedFarm?.id}
          >
            <Ionicons name="water-outline" size={moderateScale(32)} color={theme.colors.icon} />
            <Text style={styles.dataLabel}>Water Level</Text>
            <Text style={styles.dataValue}>{waterHistory[0].value}</Text>
            {Boolean(waterSchedule) && (
              <View style={[styles.runningBadge, styles.runningBadgeWater]}>
                <Text style={styles.runningBadgeText}>RUNNING</Text>
              </View>
            )}
          </AnimatedTouchableOpacity>

          <AnimatedTouchableOpacity
            style={[
              styles.dataCard,
              {
                backgroundColor: pesticideCardBackground,
                transform: [{ scale: pesticideCardScale }],
              },
              !selectedFarm?.id && styles.dataCardDisabled,
            ]}
            onPress={() =>
              handleNavigate('PesticideLevelScreen', {
                history: pesticideHistory,
              })
            }
            disabled={!selectedFarm?.id}
          >
            <Ionicons name="bug-outline" size={moderateScale(32)} color={theme.colors.icon} />
            <Text style={styles.dataLabel}>Pesticide Level</Text>
            <Text style={styles.dataValue}>{pesticideHistory[0].value}</Text>
            {Boolean(pesticideSchedule) && (
              <View style={[styles.runningBadge, styles.runningBadgePesticide]}>
                <Text style={styles.runningBadgeText}>RUNNING</Text>
              </View>
            )}
          </AnimatedTouchableOpacity>

          <TouchableOpacity
            style={[styles.dataCard, !selectedFarm?.id && styles.dataCardDisabled]}
            onPress={() =>
              handleNavigate('TemperatureHistoryScreen', {
                history: temperatureHistory,
              })
            }
            disabled={!selectedFarm?.id}
          >
            <Ionicons name="thermometer-outline" size={moderateScale(32)} color={theme.colors.icon} />
            <Text style={styles.dataLabel}>Temperature</Text>
            <Text style={styles.dataValue}>
              {temperatureHistory[0].value}
              {selectedFarm?.id && sensorSnapshot.timestamp && (() => {
                const tempNum = parseFloat(temperatureHistory[0].value.replace(/[^0-9.-]/g, ''));
                if (!isNaN(tempNum) && tempNum > 0) {
                  const fahrenheit = Math.round(tempNum * 9/5 + 32);
                  return ` (${fahrenheit}°F)`;
                }
                return '';
              })()}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dataCard, !selectedFarm?.id && styles.dataCardDisabled]}
            onPress={() =>
              handleNavigate('HumidityHistoryScreen', {
                history: humidityHistory,
              })
            }
            disabled={!selectedFarm?.id}
          >
            <Ionicons name="water" size={moderateScale(32)} color={theme.colors.icon} />
            <Text style={styles.dataLabel}>Humidity</Text>
            <Text style={styles.dataValue}>{humidityHistory[0].value}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dataCard, !selectedFarm?.id && styles.dataCardDisabled]}
            onPress={() =>
              handleNavigate('WindSpeedHistoryScreen', {
                history: windHistory,
              })
            }
            disabled={!selectedFarm?.id}
          >
            <Ionicons name="leaf-outline" size={moderateScale(32)} color={theme.colors.icon} />
            <Text style={styles.dataLabel}>Wind Speed</Text>
            <Text style={styles.dataValue}>{windHistory[0].value}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dataCard, !selectedFarm?.id && styles.dataCardDisabled]}
            onPress={() => {
              // Flow Rate card - can navigate to a detail screen if needed
            }}
            disabled={!selectedFarm?.id}
          >
            <Ionicons name="speedometer-outline" size={moderateScale(32)} color={theme.colors.icon} />
            <Text style={styles.dataLabel}>Flow Rate</Text>
            <Text style={styles.dataValue}>{flowRateHistory[0].value}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={farmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFarmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Farm</Text>
              <TouchableOpacity onPress={() => setFarmModalVisible(false)}>
                <Ionicons name="close" size={moderateScale(22)} color={theme.colors.icon} />
              </TouchableOpacity>
            </View>

            {farms.map((farm) => {
              const isActive = selectedFarm?.id === farm.id;
              return (
                <TouchableOpacity
                  key={farm.id}
                  style={[styles.farmOption, isActive && styles.farmOptionActive]}
                  onPress={() => handleSelectFarm(farm)}
                >
                  <Ionicons
                    name={isActive ? 'radio-button-on' : 'radio-button-off'}
                    size={moderateScale(20)}
                    color={isActive ? theme.colors.surface : theme.colors.mutedText}
                  />
                  <Text
                    style={[styles.farmOptionText, isActive && styles.farmOptionTextActive]}
                  >
                    {farm.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
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
      marginTop: moderateScale(8),
      marginBottom: moderateScale(24),
    },
    headerSpacer: {
      width: moderateScale(32),
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontScale(24),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    headerIconButton: {
      width: moderateScale(44),
      height: moderateScale(44),
      borderRadius: moderateScale(22),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bellContainer: {
      position: 'relative',
      width: moderateScale(22),
      height: moderateScale(22),
    },
    badge: {
      position: 'absolute',
      top: moderateScale(-6),
      right: moderateScale(-6),
      backgroundColor: theme.colors.danger || '#FF3B30',
      borderRadius: moderateScale(10),
      minWidth: moderateScale(20),
      height: moderateScale(20),
      paddingHorizontal: moderateScale(4),
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.colors.card,
    },
    badgeText: {
      color: '#FFFFFF',
      fontSize: fontScale(10),
      fontWeight: 'bold',
    },
    weatherCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(16),
      padding: moderateScale(20),
      marginBottom: moderateScale(24),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    sensorStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(8),
      marginBottom: moderateScale(12),
    },
    sensorStatusText: {
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
    },
    sensorErrorText: {
      marginBottom: moderateScale(12),
      fontSize: fontScale(12),
      color: theme.colors.danger,
    },
    runningBanner: {
      backgroundColor: theme.colors.accent,
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(14),
      borderRadius: moderateScale(12),
      marginBottom: moderateScale(16),
      gap: moderateScale(6),
    },
    runningBannerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(8),
    },
    runningBannerText: {
      color: theme.colors.surface,
      fontSize: fontScale(13),
      fontWeight: '600',
      flex: 1,
    },
    sensorTimestamp: {
      marginTop: moderateScale(8),
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
    },
    currentWeather: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(20),
    },
    currentWeatherLeft: {
      flex: 1,
    },
    locationText: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginBottom: moderateScale(8),
    },
    temperatureText: {
      fontSize: fontScale(48),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(4),
    },
    conditionText: {
      fontSize: fontScale(16),
      color: theme.colors.primaryText,
    },
    currentWeatherRight: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    forecastContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: moderateScale(16),
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    forecastDay: {
      alignItems: 'center',
      flex: 1,
    },
    forecastDayText: {
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
      marginBottom: moderateScale(8),
    },
    forecastValue: {
      fontSize: fontScale(14),
      color: theme.colors.primaryText,
      marginTop: moderateScale(4),
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(16),
    },
    sectionTitle: {
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    selectedFarmName: {
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginTop: moderateScale(4),
    },
    dataCardDisabled: {
      opacity: 0.5,
    },
    selectFarmButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(6),
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(10),
    },
    selectFarmText: {
      color: theme.colors.surface,
      fontSize: fontScale(14),
      fontWeight: '600',
    },
    dataGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    dataCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(20),
      alignItems: 'center',
      width: '48%',
      marginBottom: moderateScale(16),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    dataCardFull: {
      width: '100%',
    },
    dataLabel: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginTop: moderateScale(12),
      marginBottom: moderateScale(8),
    },
    dataValue: {
      fontSize: fontScale(28),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    runningBadge: {
      position: 'absolute',
      top: moderateScale(12),
      right: moderateScale(12),
      paddingHorizontal: moderateScale(10),
      paddingVertical: moderateScale(4),
      borderRadius: moderateScale(10),
    },
    runningBadgeWater: {
      backgroundColor: 'rgba(52, 199, 89, 0.25)',
    },
    runningBadgePesticide: {
      backgroundColor: 'rgba(255, 204, 0, 0.25)',
    },
    runningBadgeText: {
      fontSize: fontScale(10),
      fontWeight: '700',
      color: theme.colors.primaryText,
      letterSpacing: 0.6,
    },
    loadingText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
      textAlign: 'center',
      padding: moderateScale(20),
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
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(16),
    },
    modalTitle: {
      fontSize: fontScale(18),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    farmOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(12),
      paddingVertical: moderateScale(12),
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(12),
      marginBottom: moderateScale(8),
      backgroundColor: theme.colors.subtleCard,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    farmOptionActive: {
      backgroundColor: theme.colors.accent,
    },
    farmOptionText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      fontWeight: '500',
    },
    farmOptionTextActive: {
      color: theme.colors.surface,
    },
  });
