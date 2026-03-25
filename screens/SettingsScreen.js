import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Image, Modal, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale, setGlobalFontSizeMultiplier } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { getAvatarSource } from '../utils/avatarAssets';

const HOSTINGER_AUTH_URL = '';
const USER_MANUAL_URL = '';

const FONT_SIZE_OPTIONS = [
  { label: 'Small', multiplier: 0.85 },
  { label: 'Medium', multiplier: 1.0 },
  { label: 'Large', multiplier: 1.15 },
  { label: 'Extra Large', multiplier: 1.3 },
];

export default function SettingScreen({ setIsAuthenticated }) {
  const navigation = useNavigation();
  const { theme, toggleTheme, setFontSize, fontSizeMultiplier } = useTheme();
  const [pushNotifications, setPushNotifications] = useState(true);
  const [fontSizeModalVisible, setFontSizeModalVisible] = useState(false);

  const styles = useMemo(() => createStyles(theme), [theme]);
  const { user } = useUser();

  const isDarkMode = theme.isDark;

  const handleLogout = async () => {
    if (!user?.id) {
      // If no user ID, just log out locally
      if (setIsAuthenticated) {
        setIsAuthenticated(false);
      }
      return;
    }

    try {
      // Call logout endpoint to update activity_status
      await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'logout',
          user_id: user.id,
        }),
      });
    } catch (error) {
      // Log error but continue with logout
      console.error('Logout API call failed:', error);
    } finally {
      // Always log out locally regardless of API call result
    if (setIsAuthenticated) {
      setIsAuthenticated(false);
      }
    }
  };

  const handleOpenUserManual = async () => {
    try {
      const supported = await Linking.canOpenURL(USER_MANUAL_URL);
      if (supported) {
        await Linking.openURL(USER_MANUAL_URL);
      } else {
        Alert.alert('Error', 'Cannot open the user manual URL');
      }
    } catch (error) {
      console.error('Error opening user manual:', error);
      Alert.alert('Error', 'Failed to open user manual');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
          {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
            </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.headerSpacer} />
          </View>

        {/* Account Section */}
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.profileCard} onPress={() => navigation.navigate('AccountDetailsScreen')}>
          <View style={styles.profileImageContainer}>
            <Image source={getAvatarSource(user.avatar)} style={styles.profileImage} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{`${user.firstName} ${user.lastName}`}</Text>
            <Text style={styles.profileEmail}>{user.email}</Text>
          </View>
          <Ionicons name="chevron-forward" size={moderateScale(20)} color={theme.colors.mutedText} />
            </TouchableOpacity>

        {/* Preferences Section */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        
        {/* Dark Mode Toggle */}
        <View style={styles.preferenceRow}>
          <View style={styles.preferenceContent}>
            <Text style={styles.preferenceLabel}>Dark Mode</Text>
            <Text style={styles.preferenceSubtext}>Toggle between light and dark theme</Text>
          </View>
          <Switch
            value={isDarkMode}
            onValueChange={toggleTheme}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            thumbColor={isDarkMode ? theme.colors.surface : '#f4f3f4'}
            ios_backgroundColor={theme.colors.border}
          />
          </View>

        {/* Push Notifications Toggle */}
        <View style={styles.preferenceRow}>
          <View style={styles.preferenceContent}>
            <Text style={styles.preferenceLabel}>Push Notifications</Text>
            <Text style={styles.preferenceSubtext}>Receive alerts on your device</Text>
        </View>
          <Switch
            value={pushNotifications}
            onValueChange={setPushNotifications}
            trackColor={{ false: '#767577', true: '#4CAF50' }}
            thumbColor={pushNotifications ? '#FFFFFF' : '#f4f3f4'}
            ios_backgroundColor="#767577"
          />
            </View>

        {/* Font Size Selection */}
        <TouchableOpacity 
          style={styles.preferenceRow}
          onPress={() => setFontSizeModalVisible(true)}
        >
          <View style={styles.preferenceContent}>
            <Text style={styles.preferenceLabel}>Font Size</Text>
            <Text style={styles.preferenceSubtext}>
              {FONT_SIZE_OPTIONS.find(opt => opt.multiplier === fontSizeMultiplier)?.label || 'Medium'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={moderateScale(20)} color={theme.colors.mutedText} />
        </TouchableOpacity>

        {/* Support Section */}
        <Text style={styles.sectionTitle}>Support</Text>
        
        {/* User Manual */}
        <TouchableOpacity style={styles.supportRow} onPress={handleOpenUserManual}>
          <Text style={styles.supportLabel}>User Manual</Text>
          <Ionicons name="chevron-forward" size={moderateScale(20)} color={theme.colors.mutedText} />
        </TouchableOpacity>
        
        {/* Help Center */}
        <TouchableOpacity style={styles.supportRow} onPress={() => navigation.navigate('HelpCenterScreen')}>
          <Text style={styles.supportLabel}>Help Center</Text>
          <Ionicons name="chevron-forward" size={moderateScale(20)} color={theme.colors.mutedText} />
            </TouchableOpacity>

        {/* Log Out Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>
      </ScrollView>

      {/* Font Size Selection Modal */}
      <Modal
        visible={fontSizeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFontSizeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Font Size</Text>
              <TouchableOpacity onPress={() => setFontSizeModalVisible(false)}>
                <Ionicons name="close" size={moderateScale(24)} color={theme.colors.icon} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Choose your preferred font size</Text>
            {FONT_SIZE_OPTIONS.map((option) => {
              const isSelected = option.multiplier === fontSizeMultiplier;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.fontSizeOption,
                    isSelected && styles.fontSizeOptionSelected,
                  ]}
                  onPress={() => {
                    // Update global font size immediately
                    setGlobalFontSizeMultiplier(option.multiplier);
                    // Update theme context (saves to storage)
                    setFontSize(option.multiplier);
                    setFontSizeModalVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.fontSizeOptionLabel,
                      isSelected && styles.fontSizeOptionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {isSelected && (
                    <Ionicons
                      name="checkmark"
                      size={moderateScale(20)}
                      color={theme.colors.accent}
                    />
                  )}
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
      marginBottom: moderateScale(24),
      paddingHorizontal: moderateScale(4),
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
    sectionTitle: {
      fontSize: fontScale(18),
    fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginTop: moderateScale(24),
      marginBottom: moderateScale(12),
  },
    profileCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
    flexDirection: 'row',
    alignItems: 'center',
      marginBottom: moderateScale(8),
    },
    profileImageContainer: {
      width: moderateScale(56),
      height: moderateScale(56),
      borderRadius: moderateScale(28),
      backgroundColor: theme.colors.subtleCard,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: moderateScale(16),
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    profileImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    profileInfo: {
      flex: 1,
  },
    profileName: {
      fontSize: fontScale(16),
    fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(4),
  },
    profileEmail: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
  },
    preferenceRow: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
    flexDirection: 'row',
      alignItems: 'center',
    justifyContent: 'space-between',
      marginBottom: moderateScale(8),
      borderWidth: 1,
      borderColor: theme.colors.border,
  },
    preferenceContent: {
      flex: 1,
      marginRight: moderateScale(16),
    },
    preferenceLabel: {
      fontSize: fontScale(16),
    fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(4),
    },
    preferenceSubtext: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
  },
    supportRow: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
    flexDirection: 'row',
      alignItems: 'center',
    justifyContent: 'space-between',
      marginBottom: moderateScale(8),
      borderWidth: 1,
      borderColor: theme.colors.border,
  },
    supportLabel: {
      fontSize: fontScale(16),
    fontWeight: 'bold',
      color: theme.colors.primaryText,
  },
    logoutButton: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
    alignItems: 'center',
      marginTop: moderateScale(24),
      borderWidth: 1,
      borderColor: theme.colors.border,
  },
    logoutText: {
      fontSize: fontScale(16),
    fontWeight: 'bold',
      color: theme.colors.danger,
  },
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: moderateScale(20),
    },
    modalCard: {
      width: '85%',
      maxWidth: moderateScale(400),
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(20),
      padding: moderateScale(24),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(8),
    },
    modalTitle: {
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    modalSubtitle: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginBottom: moderateScale(20),
    },
    fontSizeOption: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: moderateScale(16),
      paddingHorizontal: moderateScale(16),
      borderRadius: moderateScale(12),
      marginBottom: moderateScale(8),
      backgroundColor: theme.colors.subtleCard,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    fontSizeOptionSelected: {
      backgroundColor: theme.colors.accent + '20',
      borderColor: theme.colors.accent,
      borderWidth: 2,
    },
    fontSizeOptionLabel: {
      fontSize: fontScale(16),
      color: theme.colors.primaryText,
      fontWeight: '500',
    },
    fontSizeOptionLabelSelected: {
      color: theme.colors.accent,
      fontWeight: 'bold',
  },
});
