import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useFarms } from '../contexts/FarmContext';
import { useTheme } from '../contexts/ThemeContext';

export default function ModuleScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { farmId } = route.params || {};
  const numericFarmId = farmId ? Number(farmId) : null;

  const {
    farms,
    isLoading: farmsLoading,
    addModule,
    editModule,
    removeModule,
  } = useFarms();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);

  const [macAddress, setMacAddress] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('main');
  const [editingDevice, setEditingDevice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const currentFarm = useMemo(
    () => farms.find((farmItem) => farmItem.id === numericFarmId),
    [farms, numericFarmId]
  );
  const existingMainDevice = useMemo(
    () => currentFarm?.devices?.find((device) => (device.deviceType ?? 'main') === 'main'),
    [currentFarm]
  );
  const editingIsMain = editingDevice?.deviceType === 'main';
  const isMainSelectionDisabled = Boolean(
    existingMainDevice && (!editingDevice || existingMainDevice.id !== editingDevice.id)
  );

  const formatMacAddress = useCallback((value) => {
    const cleaned = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 12);
    const pairs = cleaned.match(/.{1,2}/g) || [];
    return pairs.join(':');
  }, []);

  const openGoogleMaps = useCallback((latitude, longitude) => {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    
    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert('Error', 'Invalid GPS coordinates');
      return;
    }

    // Validate coordinate ranges
    if (!(-90.0 <= lat && lat <= 90.0) || !(-180.0 <= lon && lon <= 180.0)) {
      Alert.alert('Error', 'Invalid GPS coordinates: Out of valid range');
      return;
    }

    // Check for zero coordinates (no GPS fix)
    if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) {
      Alert.alert('Error', 'GPS coordinates not available (no GPS fix)');
      return;
    }

    // Google Maps URL format: latitude,longitude
    const url = Platform.select({
      ios: `maps://app?daddr=${lat},${lon}&directionsmode=driving`,
      android: `google.navigation:q=${lat},${lon}`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    });

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(url);
        } else {
          // Fallback to web version
          const webUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
          return Linking.openURL(webUrl);
        }
      })
      .catch((err) => {
        console.error('Error opening maps:', err);
        Alert.alert('Error', 'Unable to open maps. Please try again.');
      });
  }, []);

  const handleMacInputChange = useCallback(
    (value) => {
      setMacAddress(formatMacAddress(value));
    },
    [formatMacAddress]
  );

  useEffect(() => {
    if (!editingDevice) return;
    const updatedDevice = currentFarm?.devices?.find((device) => device.id === editingDevice.id);
    if (!updatedDevice) {
      setEditingDevice(null);
      setMacAddress('');
      setDeviceName('');
      setDeviceType('main');
      return;
    }

    setMacAddress(formatMacAddress(updatedDevice.macAddress ?? ''));
    setDeviceName(updatedDevice.deviceName ?? '');
    setDeviceType(updatedDevice.deviceType ?? 'main');
  }, [currentFarm, editingDevice, formatMacAddress]);

  const resetForm = () => {
    setMacAddress('');
    setDeviceName('');
    setDeviceType('main');
    setEditingDevice(null);
  };

  const handleSaveModule = async () => {
    const formattedMac = formatMacAddress(macAddress);

    if (formattedMac.length !== 17) {
      Alert.alert(
        'Invalid MAC Address',
        'Please enter a valid MAC address using 12 hexadecimal characters (e.g., AA:BB:CC:DD:EE:FF).'
      );
      return;
    }

    if (!deviceName.trim()) {
      Alert.alert('Error', 'Please provide a device name.');
      return;
    }

    if (!currentFarm) {
      Alert.alert('Error', 'Farm data not available.');
      return;
    }

  if (deviceType === 'main' && isMainSelectionDisabled) {
    Alert.alert('Main Device Limit', 'Only one main device can be registered per farm.');
    return;
  }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingDevice) {
        await editModule({
          deviceId: editingDevice.id,
          farmId: currentFarm.id,
          macAddress: formattedMac,
          deviceName: deviceName.trim(),
          deviceType,
        });
        Alert.alert('Success', 'Device updated successfully!');
      } else {
        await addModule({
          farmId: currentFarm.id,
          macAddress: formattedMac,
          deviceName: deviceName.trim(),
          deviceType,
        });
        Alert.alert('Success', 'Device added successfully!');
      }
      resetForm();
    } catch (error) {
      const message = error?.message || 'Something went wrong. Please try again.';
      setErrorMessage(message);
      Alert.alert('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditDevice = (device) => {
    setEditingDevice(device);
    setMacAddress(formatMacAddress(device.macAddress ?? ''));
    setDeviceName(device.deviceName ?? '');
    setDeviceType(device.deviceType ?? 'main');
  };

  const handleDeleteDevice = (device) => {
    if (!currentFarm) {
      Alert.alert('Error', 'Farm data not available.');
      return;
    }

    Alert.alert('Delete Device', `Are you sure you want to delete "${device.deviceName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setIsSubmitting(true);
          setErrorMessage(null);
          try {
            await removeModule({ deviceId: device.id, farmId: currentFarm.id });
            Alert.alert('Success', 'Device deleted successfully!');
          } catch (error) {
            const message = error?.message || 'Unable to delete device. Please try again.';
            setErrorMessage(message);
            Alert.alert('Error', message);
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    ]);
  };

  if (farmsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={styles.loadingText}>Loading farm data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentFarm) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Farm data not available</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonLabel}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{currentFarm.name}</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.moduleFormSection}>
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={moderateScale(18)} color={theme.colors.danger} />
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          )}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {editingDevice ? 'Edit Device' : 'Add New Device'}
            </Text>
            {editingDevice && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={resetForm}
                disabled={isSubmitting}
              >
                <Text style={styles.clearButtonText}>Add New</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>MAC Address</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="AA:BB:CC:DD:EE:FF"
                placeholderTextColor={theme.colors.mutedText}
                value={macAddress}
                onChangeText={handleMacInputChange}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType={Platform.OS === 'ios' ? 'default' : 'visible-password'}
                maxLength={17}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Device Name</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter device name"
                placeholderTextColor={theme.colors.mutedText}
                value={deviceName}
                onChangeText={setDeviceName}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Device Type</Text>
            <View style={styles.deviceTypeContainer}>
              <TouchableOpacity
                style={[
                  styles.deviceTypeButton,
                  deviceType === 'main' && styles.deviceTypeButtonActive,
                  isMainSelectionDisabled && deviceType !== 'main' && styles.disabledButton,
                  isSubmitting && styles.disabledButton,
                ]}
                onPress={() => {
                  if (isMainSelectionDisabled && deviceType !== 'main') {
                    Alert.alert('Main Device Limit', 'Only one main device can be registered per farm.');
                    return;
                  }
                  setDeviceType('main');
                }}
                disabled={isSubmitting || (isMainSelectionDisabled && deviceType !== 'main')}
              >
                <Text
                  style={[
                    styles.deviceTypeText,
                    deviceType === 'main' && styles.deviceTypeTextActive,
                  ]}
                >
                  Main
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deviceTypeButton,
                  deviceType === 'node' && styles.deviceTypeButtonActive,
                  isSubmitting && styles.disabledButton,
                ]}
                onPress={() => setDeviceType('node')}
                disabled={isSubmitting}
              >
                <Text
                  style={[
                    styles.deviceTypeText,
                    deviceType === 'node' && styles.deviceTypeTextActive,
                  ]}
                >
                  Node
                </Text>
              </TouchableOpacity>
            </View>
            {!isSubmitting && isMainSelectionDisabled && (
              <Text style={styles.deviceTypeHelpText}>
                A main device is already registered. Add additional modules as nodes.
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.saveButton, isSubmitting && styles.disabledButton]}
            onPress={handleSaveModule}
            disabled={isSubmitting}
          >
            <Text style={styles.saveButtonText}>
              {isSubmitting ? 'Saving...' : editingDevice ? 'Update' : 'Add'} Device
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.devicesListSection}>
          <Text style={styles.sectionTitle}>Registered Devices</Text>
          {currentFarm.devices && currentFarm.devices.length > 0 ? (
            currentFarm.devices.map((device) => (
              <View key={device.id} style={styles.deviceCard}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>{device.deviceName}</Text>
                  <Text style={styles.deviceMac}>{device.macAddress}</Text>
                  <View style={styles.deviceTypeBadge}>
                    <Text style={styles.deviceTypeBadgeText}>
                      {device.deviceType === 'main' ? 'Main' : 'Node'}
                    </Text>
                  </View>
                  {device.deviceType === 'node' && (
                    <View style={styles.gpsInfo}>
                      {device.latitude != null && 
                       device.longitude != null &&
                       !isNaN(Number(device.latitude)) && 
                       !isNaN(Number(device.longitude)) &&
                       Number(device.latitude) !== 0 && 
                       Number(device.longitude) !== 0 &&
                       // Additional validation: ensure coordinates are within valid ranges
                       Number(device.latitude) >= -90 && Number(device.latitude) <= 90 &&
                       Number(device.longitude) >= -180 && Number(device.longitude) <= 180 &&
                       // Reject coordinates that are clearly wrong (zero coordinates)
                       Math.abs(Number(device.latitude)) >= 0.0001 &&
                       Math.abs(Number(device.longitude)) >= 0.0001 ? (
                        <TouchableOpacity
                          style={styles.gpsButton}
                          onPress={() => openGoogleMaps(device.latitude, device.longitude)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="location" size={moderateScale(14)} color={theme.colors.accent} />
                          <Text style={styles.gpsText}>
                            {device.latitude.toFixed(6)}, {device.longitude.toFixed(6)}
                          </Text>
                          <Ionicons name="open-outline" size={moderateScale(12)} color={theme.colors.accent} />
                        </TouchableOpacity>
                      ) : (
                        <>
                          <Ionicons name="location-outline" size={moderateScale(14)} color={theme.colors.mutedText} />
                          <Text style={styles.gpsTextNoFix}>GPS: No fix</Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
                <View style={styles.deviceActions}>
                  <TouchableOpacity
                    style={styles.deviceActionButton}
                    onPress={() => handleEditDevice(device)}
                    disabled={isSubmitting}
                  >
                    <Ionicons
                      name="create"
                      size={moderateScale(18)}
                      color={theme.colors.accentSecondary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deviceActionButton}
                    onPress={() => handleDeleteDevice(device)}
                    disabled={isSubmitting}
                  >
                    <Ionicons name="trash" size={moderateScale(18)} color={theme.colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyDevicesContainer}>
              <Text style={styles.emptyDevicesText}>No devices registered</Text>
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
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: moderateScale(20),
      gap: moderateScale(12),
    },
    loadingText: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: moderateScale(20),
    },
    errorText: {
      fontSize: fontScale(16),
      color: theme.colors.primaryText,
      marginBottom: moderateScale(20),
    },
    backButton: {
      paddingHorizontal: moderateScale(20),
      paddingVertical: moderateScale(12),
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
    },
    backButtonLabel: {
      color: theme.colors.surface,
      fontSize: fontScale(16),
      fontWeight: '600',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: moderateScale(24),
    },
    headerButton: {
      width: moderateScale(40),
      height: moderateScale(40),
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: moderateScale(12),
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerTitle: {
      flex: 1,
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      textAlign: 'center',
    },
    placeholder: {
      width: moderateScale(40),
    },
    moduleFormSection: {
      marginBottom: moderateScale(24),
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(20),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.dangerTransparent ?? 'rgba(220, 53, 69, 0.12)',
      borderRadius: moderateScale(8),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(8),
      marginBottom: moderateScale(12),
      gap: moderateScale(8),
    },
    errorBannerText: {
      flex: 1,
      fontSize: fontScale(12),
      color: theme.colors.danger,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(16),
    },
    sectionTitle: {
      fontSize: fontScale(18),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    clearButton: {
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(6),
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(8),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    clearButtonText: {
      fontSize: fontScale(12),
      color: theme.colors.primaryText,
      fontWeight: '500',
    },
    inputWrapper: {
      marginBottom: moderateScale(20),
    },
    inputLabel: {
      fontSize: fontScale(14),
      fontWeight: '500',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(8),
    },
    inputContainer: {
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    input: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      padding: 0,
    },
    deviceTypeContainer: {
      flexDirection: 'row',
      gap: moderateScale(12),
    },
    deviceTypeButton: {
      flex: 1,
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(14),
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    deviceTypeButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    deviceTypeText: {
      fontSize: fontScale(16),
      color: theme.colors.mutedText,
      fontWeight: '500',
    },
    deviceTypeTextActive: {
      color: theme.colors.surface,
      fontWeight: 'bold',
    },
    deviceTypeHelpText: {
      marginTop: moderateScale(8),
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
    },
    saveButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(16),
      alignItems: 'center',
      marginTop: moderateScale(8),
    },
    saveButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(18),
      fontWeight: 'bold',
    },
    devicesListSection: {
      marginTop: moderateScale(24),
    },
    deviceCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
      marginBottom: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    deviceInfo: {
      flex: 1,
    },
    deviceName: {
      fontSize: fontScale(16),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(4),
    },
    deviceMac: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginBottom: moderateScale(8),
    },
    deviceTypeBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(6),
      paddingHorizontal: moderateScale(8),
      paddingVertical: moderateScale(4),
    },
    deviceTypeBadgeText: {
      fontSize: fontScale(12),
      color: theme.colors.surface,
      fontWeight: '500',
    },
    gpsInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: moderateScale(8),
      gap: moderateScale(6),
    },
    gpsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(6),
      paddingVertical: moderateScale(4),
      paddingHorizontal: moderateScale(8),
      borderRadius: moderateScale(6),
      backgroundColor: theme.colors.subtleCard,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    gpsText: {
      fontSize: fontScale(12),
      color: theme.colors.accent,
      fontWeight: '500',
    },
    gpsTextNoFix: {
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
      fontStyle: 'italic',
    },
    deviceActions: {
      flexDirection: 'row',
      gap: moderateScale(12),
    },
    deviceActionButton: {
      width: moderateScale(36),
      height: moderateScale(36),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(8),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    emptyDevicesContainer: {
      alignItems: 'center',
      paddingVertical: moderateScale(32),
    },
    emptyDevicesText: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
    },
    disabledButton: {
      opacity: 0.6,
    },
  });

