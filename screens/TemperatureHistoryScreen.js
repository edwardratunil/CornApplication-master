import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  PanResponder,
  Alert,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { moderateScale, fontScale } from '../utils/responsive';
import SimpleLineGraph from '../components/SimpleLineGraph';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { fetchThresholds, updateThresholds, fetchSensorHistory } from '../services/farmService';
import { useFocusEffect } from '@react-navigation/native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function formatTime(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${ampm}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeForAPI(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function TemperatureHistoryScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useUser();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);
  const { selectedFarm } = route.params || {};

  const [temperatureThreshold, setTemperatureThreshold] = useState(30.0);
  const [savedTemperatureThreshold, setSavedTemperatureThreshold] = useState(30.0);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const sliderWidthRef = useRef(200);
  const sliderStartX = useRef(0);

  // Date and time picker states
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(today);
  const [startTime, setStartTime] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 6, 0));
  const [endTime, setEndTime] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // History data states
  const [historyData, setHistoryData] = useState([]); // Original order (oldest to latest) for graph
  const [statistics, setStatistics] = useState({ min: null, max: null, average: null });
  const [loading, setLoading] = useState(false);

  const sliderPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX } = evt.nativeEvent;
        sliderStartX.current = evt.nativeEvent.pageX - locationX;
        const width = sliderWidthRef.current;
        const percentage = Math.max(0, Math.min(100, (locationX / width) * 100));
        const value = Math.round(10 + (percentage / 100) * 50);
        setTemperatureThreshold(Math.max(10, Math.min(60, value)));
      },
      onPanResponderMove: (evt) => {
        const width = sliderWidthRef.current;
        const currentX = evt.nativeEvent.pageX - sliderStartX.current;
        const percentage = Math.max(0, Math.min(100, (currentX / width) * 100));
        const value = Math.round(10 + (percentage / 100) * 50);
        setTemperatureThreshold(Math.max(10, Math.min(60, value)));
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const thresholdPercentage = ((temperatureThreshold - 10) / 50) * 100;

  const loadThresholds = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      return;
    }

    try {
      const response = await fetchThresholds(user.id, selectedFarm.id);
      const thresholds = response?.thresholds ?? {};
      if (thresholds.temperatureThreshold !== undefined) {
        const value = Number(thresholds.temperatureThreshold);
        setTemperatureThreshold(value);
        setSavedTemperatureThreshold(value);
      }
    } catch (error) {
      console.warn('Failed to load thresholds:', error);
    }
  }, [selectedFarm?.id, user?.id]);

  const loadHistoryData = useCallback(async () => {
    if (!user?.id || !selectedFarm?.id) {
      setHistoryData([]);
      setStatistics({ min: null, max: null, average: null });
      return;
    }

    setLoading(true);
    try {
      const dateStr = formatDate(selectedDate);
      const startTimeStr = formatTimeForAPI(startTime);
      const endTimeStr = formatTimeForAPI(endTime);

      const response = await fetchSensorHistory(
        user.id,
        selectedFarm.id,
        'temperature',
        dateStr,
        startTimeStr,
        endTimeStr
      );

      if (response?.success) {
        const hourlyData = response.hourly_data || [];
        // Keep original order (oldest to latest) for graph
        setHistoryData(hourlyData);
        setStatistics(response.statistics || { min: null, max: null, average: null });
      } else {
        setHistoryData([]);
        setStatistics({ min: null, max: null, average: null });
      }
    } catch (error) {
      console.warn('Failed to load history data:', error);
      setHistoryData([]);
      setStatistics({ min: null, max: null, average: null });
    } finally {
      setLoading(false);
    }
  }, [selectedFarm?.id, user?.id, selectedDate, startTime, endTime]);

  useFocusEffect(
    useCallback(() => {
      loadThresholds();
      loadHistoryData();
    }, [loadThresholds, loadHistoryData])
  );

  useEffect(() => {
    loadHistoryData();
  }, [selectedDate, startTime, endTime]);

  const saveThreshold = useCallback(
    async () => {
      if (!user?.id || !selectedFarm?.id) {
        return;
      }

      setThresholdSaving(true);
      try {
        await updateThresholds(user.id, selectedFarm.id, {
          temperatureThreshold: temperatureThreshold,
        });
        setSavedTemperatureThreshold(temperatureThreshold);
      } catch (error) {
        console.warn('Failed to save threshold:', error);
        Alert.alert('Save Failed', error?.message || 'Unable to save threshold. Please try again.');
        setTemperatureThreshold(savedTemperatureThreshold);
      } finally {
        setThresholdSaving(false);
      }
    },
    [selectedFarm?.id, user?.id, temperatureThreshold, savedTemperatureThreshold]
  );

  const hasThresholdChanged = temperatureThreshold !== savedTemperatureThreshold;

  // Prepare graph data
  const graphData = useMemo(() => {
    if (historyData.length === 0) return [];
    return historyData.map((item) => item.value);
  }, [historyData]);

  const graphLabels = useMemo(() => {
    if (historyData.length === 0) return [];
    return historyData.map((item) => {
      const date = new Date(item.timestamp);
      return formatTime(date);
    });
  }, [historyData]);

  const hasData = historyData.length > 0;

  // Reversed data for list display (latest to oldest)
  const reversedHistoryData = useMemo(() => {
    return [...historyData].reverse();
  }, [historyData]);

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
          <Text style={styles.headerTitle}>Temperature History</Text>
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
          <Text style={styles.sectionTitle}>Temperature Threshold</Text>
          <View style={styles.thresholdContainer}>
            <Text style={styles.thresholdLabel}>
              Alert when temperature is above: {Math.round(temperatureThreshold)}°C ({Math.round(temperatureThreshold * 9/5 + 32)}°F)
            </Text>
            <View style={styles.sliderContainer}>
              <Text style={styles.sliderMinLabel}>10°C</Text>
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
                      { width: `${thresholdPercentage}%` },
                    ]}
                  />
                </View>
                <View
                  style={[
                    styles.sliderThumb,
                    { left: `${thresholdPercentage}%` },
                  ]}
                />
              </View>
              <Text style={styles.sliderMaxLabel}>60°C</Text>
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
          <Text style={styles.sectionTitle}>Temperature History</Text>
          
          {/* Date and Time Filters */}
          <View style={styles.filterContainer}>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Date:</Text>
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.filterButtonText}>{formatDate(selectedDate)}</Text>
                <Ionicons name="calendar-outline" size={moderateScale(16)} color={theme.colors.primaryText} />
              </TouchableOpacity>
            </View>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Start:</Text>
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => setShowStartTimePicker(true)}
              >
                <Text style={styles.filterButtonText}>{formatTime(startTime)}</Text>
                <Ionicons name="time-outline" size={moderateScale(16)} color={theme.colors.primaryText} />
              </TouchableOpacity>
            </View>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>End:</Text>
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => setShowEndTimePicker(true)}
              >
                <Text style={styles.filterButtonText}>{formatTime(endTime)}</Text>
                <Ionicons name="time-outline" size={moderateScale(16)} color={theme.colors.primaryText} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Date/Time Pickers */}
          {showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (date) {
                  setSelectedDate(date);
                  // Update start and end times to match new date
                  const newStartTime = new Date(date);
                  newStartTime.setHours(startTime.getHours(), startTime.getMinutes());
                  const newEndTime = new Date(date);
                  newEndTime.setHours(endTime.getHours(), endTime.getMinutes());
                  setStartTime(newStartTime);
                  setEndTime(newEndTime);
                }
              }}
            />
          )}
          {showStartTimePicker && (
            <DateTimePicker
              value={startTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                setShowStartTimePicker(Platform.OS === 'ios');
                if (date) {
                  setStartTime(date);
                }
              }}
            />
          )}
          {showEndTimePicker && (
            <DateTimePicker
              value={endTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                setShowEndTimePicker(Platform.OS === 'ios');
                if (date) {
                  setEndTime(date);
                }
              }}
            />
          )}

          {/* Statistics */}
          {hasData && (
            <View style={styles.statisticsContainer}>
              <View style={styles.statisticItem}>
                <Text style={styles.statisticLabel}>Min</Text>
                <Text style={styles.statisticValue}>
                  {statistics.min !== null ? `${statistics.min.toFixed(1)}°C` : '--'}
                </Text>
              </View>
              <View style={styles.statisticItem}>
                <Text style={styles.statisticLabel}>Max</Text>
                <Text style={styles.statisticValue}>
                  {statistics.max !== null ? `${statistics.max.toFixed(1)}°C` : '--'}
                </Text>
              </View>
              <View style={styles.statisticItem}>
                <Text style={styles.statisticLabel}>Average</Text>
                <Text style={styles.statisticValue}>
                  {statistics.average !== null ? `${statistics.average.toFixed(1)}°C` : '--'}
                </Text>
              </View>
            </View>
          )}

          {/* Chart */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.accentSecondary} />
            </View>
          ) : hasData ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chartScrollView}
              contentContainerStyle={styles.chartScrollContent}
            >
              <View style={styles.chartContainer}>
                <SimpleLineGraph
                  data={graphData}
                  labels={graphLabels}
                  color={theme.colors.accentSecondary}
                  minWidth={Math.max(SCREEN_WIDTH - moderateScale(80), graphData.length * moderateScale(50))}
                />
              </View>
            </ScrollView>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>No data available</Text>
            </View>
          )}

          {/* Hourly Data List */}
          {hasData && (
            <View style={styles.hourlyDataContainer}>
              {reversedHistoryData.map((item, index) => {
                const date = new Date(item.timestamp);
                const fahrenheit = item.value * 9/5 + 32;
                return (
                  <View key={index} style={styles.historyRow}>
                    <Text style={styles.historyLabel}>{formatTime(date)}</Text>
                    <Text style={styles.historyValue}>
                      {item.value.toFixed(1)}°C ({fahrenheit.toFixed(1)}°F)
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
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
      gap: moderateScale(8),
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(20),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(6),
      marginBottom: moderateScale(20),
      borderWidth: 1,
      borderColor: theme.colors.border,
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
    sectionTitle: {
      color: theme.colors.primaryText,
      fontSize: fontScale(18),
      fontWeight: 'bold',
      marginBottom: moderateScale(16),
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
    filterContainer: {
      gap: moderateScale(12),
      marginBottom: moderateScale(16),
    },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    filterLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '500',
      minWidth: moderateScale(60),
    },
    filterButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(8),
      backgroundColor: theme.colors.surface,
      borderRadius: moderateScale(8),
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
      flex: 1,
    },
    filterButtonText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      flex: 1,
    },
    statisticsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: theme.colors.surface,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
      marginBottom: moderateScale(16),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    statisticItem: {
      alignItems: 'center',
      gap: moderateScale(4),
    },
    statisticLabel: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      fontWeight: '500',
    },
    statisticValue: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      fontWeight: 'bold',
    },
    chartScrollView: {
      marginBottom: moderateScale(16),
    },
    chartScrollContent: {
      paddingRight: moderateScale(16),
    },
    chartContainer: {
      minWidth: Math.max(SCREEN_WIDTH - moderateScale(80), moderateScale(600)),
    },
    loadingContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: moderateScale(40),
    },
    noDataContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: moderateScale(40),
    },
    noDataText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
    },
    hourlyDataContainer: {
      marginTop: moderateScale(16),
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
  });
