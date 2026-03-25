import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useAuth } from '../contexts/AuthContext';
import {
  AVATAR_OPTIONS,
  DEFAULT_AVATAR_ID,
  ensureValidAvatarId,
  getAvatarSource,
} from '../utils/avatarAssets';

const HOSTINGER_AUTH_URL = '';

export default function AccountDetailsScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { user, updateUser, resetUser } = useUser();
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);

  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(ensureValidAvatarId(user.avatar));
  
  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecialChar: false,
  });

  useEffect(() => {
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setSelectedAvatar(ensureValidAvatarId(user.avatar));
  }, [user]);

  const activeAvatarSource = useMemo(() => getAvatarSource(selectedAvatar), [selectedAvatar]);

  const checkPasswordRequirements = (pwd) => {
    return {
      minLength: pwd.length >= 8,
      hasUppercase: /[A-Z]/.test(pwd),
      hasLowercase: /[a-z]/.test(pwd),
      hasNumber: /[0-9]/.test(pwd),
      hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd),
    };
  };

  const validateStrongPassword = (pwd) => {
    const requirements = checkPasswordRequirements(pwd);
    if (!requirements.minLength) {
      return 'Password must be at least 8 characters long.';
    }
    if (!requirements.hasUppercase) {
      return 'Password must contain at least one uppercase letter.';
    }
    if (!requirements.hasLowercase) {
      return 'Password must contain at least one lowercase letter.';
    }
    if (!requirements.hasNumber) {
      return 'Password must contain at least one number.';
    }
    if (!requirements.hasSpecialChar) {
      return 'Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?).';
    }
    return null;
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
    setPasswordRequirements(checkPasswordRequirements(text));
  };

  const handleSave = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (!trimmedFirstName || !trimmedLastName) {
      Alert.alert('Validation', 'Please provide both first and last name.');
      return;
    }

    if (password) {
      if (!oldPassword) {
        Alert.alert('Old Password Required', 'Please enter your current password to change it.');
        return;
      }

      const passwordError = validateStrongPassword(password);
      if (passwordError) {
        Alert.alert('Weak Password', passwordError);
        return;
      }

      if (password !== confirmPassword) {
        Alert.alert('Password Mismatch', 'Password and confirm password must match.');
        return;
      }
    }

    if (!user?.id || !user?.email) {
      Alert.alert('Account Error', 'Unable to determine your account. Please log in again.');
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        action: 'update_profile',
        user_id: user.id,
        email: user.email,
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
        avatar: selectedAvatar,
      };

      if (password) {
        payload.old_password = oldPassword;
        payload.new_password = password;
      }

      const response = await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'Failed to update account. Please try again later.';
        throw new Error(message);
      }

      const updatedAvatarId = ensureValidAvatarId(data?.data?.avatar ?? selectedAvatar);

      setSelectedAvatar(updatedAvatarId);

      updateUser({
        id: user.id,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        email: user.email,
        role: user.role,
        avatar: updatedAvatarId,
      });

      const passwordChanged = Boolean(password);

      setOldPassword('');
      setPassword('');
      setConfirmPassword('');
      setShowOldPassword(false);
      setShowPassword(false);
      setShowConfirmPassword(false);

      const successMessage = passwordChanged
        ? 'Password updated successfully. Please log in again to continue.'
        : 'Account details updated successfully.';

      Alert.alert('Success', successMessage, [
        {
          text: 'OK',
          onPress: () => {
            if (passwordChanged) {
              resetUser();
              logout();
            } else {
              navigation.goBack();
            }
          },
        },
      ]);
    } catch (error) {
      Alert.alert('Update Failed', error.message || 'Unable to update your account right now.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? moderateScale(60) : insets.bottom}
      >
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Account Details</Text>
            <View style={styles.headerPlaceholder} />
          </View>

        <View style={styles.avatarSection}>
          <Image source={activeAvatarSource} style={styles.profileAvatar} />
          <Text style={styles.avatarTitle}>Profile Picture</Text>
          <Text style={styles.avatarHelpText}>Select one of the farmer icons below.</Text>
          <View style={styles.avatarGrid}>
            {AVATAR_OPTIONS.map((avatar) => {
              const isSelected = avatar.id === selectedAvatar;
              return (
                <TouchableOpacity
                  key={avatar.id}
                  style={[
                    styles.avatarOption,
                    isSelected && styles.avatarOptionSelected,
                  ]}
                  onPress={() => setSelectedAvatar(avatar.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${avatar.label}`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Image source={getAvatarSource(avatar.id)} style={styles.avatarOptionImage} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Profile Information</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>First Name</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter first name"
                placeholderTextColor={theme.colors.mutedText}
                value={firstName}
                onChangeText={setFirstName}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Last Name</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter last name"
                placeholderTextColor={theme.colors.mutedText}
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email</Text>
            <View style={[styles.inputContainer, styles.disabledContainer]}>
              <Text style={styles.readonlyText}>{user.email}</Text>
            </View>
            <Text style={styles.helpText}>Email address cannot be changed.</Text>
          </View>

          <Text style={styles.sectionTitle}>Change Password</Text>
          <Text style={styles.helpText}>
            Enter your current password and new password to change it. Leave blank to keep your current password.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Current Password</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter current password"
                placeholderTextColor={theme.colors.mutedText}
                secureTextEntry={!showOldPassword}
                value={oldPassword}
                onChangeText={setOldPassword}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowOldPassword((prev) => !prev)}
              >
                <Ionicons
                  name={showOldPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={moderateScale(20)}
                  color={theme.colors.icon}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter new password"
                placeholderTextColor={theme.colors.mutedText}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={handlePasswordChange}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword((prev) => !prev)}
              >
                <Ionicons
                  name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={moderateScale(20)}
                  color={theme.colors.icon}
                />
              </TouchableOpacity>
            </View>
            {password.length > 0 && (
              <View style={styles.passwordRequirementsContainer}>
                <Text style={styles.passwordRequirementsTitle}>Password Requirements:</Text>
                <View style={styles.passwordRequirementItem}>
                  <Ionicons
                    name={passwordRequirements.minLength ? 'checkmark-circle' : 'close-circle'}
                    size={moderateScale(16)}
                    color={passwordRequirements.minLength ? theme.colors.success || '#4CAF50' : theme.colors.danger || '#F44336'}
                  />
                  <Text style={[
                    styles.passwordRequirementText,
                    passwordRequirements.minLength && styles.passwordRequirementMet
                  ]}>
                    At least 8 characters
                  </Text>
                </View>
                <View style={styles.passwordRequirementItem}>
                  <Ionicons
                    name={passwordRequirements.hasUppercase ? 'checkmark-circle' : 'close-circle'}
                    size={moderateScale(16)}
                    color={passwordRequirements.hasUppercase ? theme.colors.success || '#4CAF50' : theme.colors.danger || '#F44336'}
                  />
                  <Text style={[
                    styles.passwordRequirementText,
                    passwordRequirements.hasUppercase && styles.passwordRequirementMet
                  ]}>
                    One uppercase letter
                  </Text>
                </View>
                <View style={styles.passwordRequirementItem}>
                  <Ionicons
                    name={passwordRequirements.hasLowercase ? 'checkmark-circle' : 'close-circle'}
                    size={moderateScale(16)}
                    color={passwordRequirements.hasLowercase ? theme.colors.success || '#4CAF50' : theme.colors.danger || '#F44336'}
                  />
                  <Text style={[
                    styles.passwordRequirementText,
                    passwordRequirements.hasLowercase && styles.passwordRequirementMet
                  ]}>
                    One lowercase letter
                  </Text>
                </View>
                <View style={styles.passwordRequirementItem}>
                  <Ionicons
                    name={passwordRequirements.hasNumber ? 'checkmark-circle' : 'close-circle'}
                    size={moderateScale(16)}
                    color={passwordRequirements.hasNumber ? theme.colors.success || '#4CAF50' : theme.colors.danger || '#F44336'}
                  />
                  <Text style={[
                    styles.passwordRequirementText,
                    passwordRequirements.hasNumber && styles.passwordRequirementMet
                  ]}>
                    One number
                  </Text>
                </View>
                <View style={styles.passwordRequirementItem}>
                  <Ionicons
                    name={passwordRequirements.hasSpecialChar ? 'checkmark-circle' : 'close-circle'}
                    size={moderateScale(16)}
                    color={passwordRequirements.hasSpecialChar ? theme.colors.success || '#4CAF50' : theme.colors.danger || '#F44336'}
                  />
                  <Text style={[
                    styles.passwordRequirementText,
                    passwordRequirements.hasSpecialChar && styles.passwordRequirementMet
                  ]}>
                    {'One special character (!@#$%^&*()_+-=[]{}|;:,.<>?)'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Confirm Password</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={theme.colors.mutedText}
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword((prev) => !prev)}
              >
                <Ionicons
                  name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={moderateScale(20)}
                  color={theme.colors.icon}
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={theme.colors.surface} />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (theme, insets) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      flexGrow: 1,
      padding: moderateScale(20),
      paddingBottom: moderateScale(40) + insets.bottom,
    },
    avatarSection: {
      alignItems: 'center',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(16),
      padding: moderateScale(20),
      marginBottom: moderateScale(28),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    profileAvatar: {
      width: moderateScale(120),
      height: moderateScale(120),
      borderRadius: moderateScale(60),
      marginBottom: moderateScale(16),
      borderWidth: 2,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface,
    },
    avatarTitle: {
      fontSize: fontScale(18),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(6),
    },
    avatarGrid: {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      marginTop: moderateScale(16),
      gap: moderateScale(12),
    },
    avatarHelpText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      marginTop: moderateScale(4),
      textAlign: 'center',
    },
    avatarOption: {
      width: moderateScale(72),
      height: moderateScale(72),
      borderRadius: moderateScale(20),
      backgroundColor: theme.colors.subtleCard,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      padding: moderateScale(8),
    },
    avatarOptionSelected: {
      borderColor: theme.colors.accent,
      borderWidth: 2,
      backgroundColor: theme.colors.card,
      shadowColor: theme.colors.accent,
      shadowOpacity: 0.25,
      shadowRadius: moderateScale(6),
      shadowOffset: { width: 0, height: moderateScale(4) },
      elevation: 4,
    },
    avatarOptionImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'contain',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: moderateScale(24),
    },
    headerButton: {
      width: moderateScale(44),
      height: moderateScale(44),
      borderRadius: moderateScale(12),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    headerPlaceholder: {
      width: moderateScale(44),
    },
    sectionTitle: {
      fontSize: fontScale(18),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(12),
    },
    inputGroup: {
      marginBottom: moderateScale(16),
    },
    inputLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '500',
      marginBottom: moderateScale(8),
    },
    inputContainer: {
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      flexDirection: 'row',
      alignItems: 'center',
    },
    disabledContainer: {
      backgroundColor: theme.colors.subtleCard,
    },
    input: {
      flex: 1,
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      padding: 0,
    },
    readonlyText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
    },
    helpText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(12),
      marginTop: moderateScale(6),
    },
    saveButton: {
      marginTop: moderateScale(24),
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(14),
      paddingVertical: moderateScale(16),
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    saveButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(16),
      fontWeight: '600',
    },
    eyeButton: {
      paddingLeft: moderateScale(8),
    },
    passwordRequirementsContainer: {
      marginTop: moderateScale(12),
      padding: moderateScale(12),
      backgroundColor: theme.colors.subtleCard || theme.colors.card,
      borderRadius: moderateScale(8),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    passwordRequirementsTitle: {
      fontSize: fontScale(13),
      fontWeight: '600',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(8),
    },
    passwordRequirementItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: moderateScale(6),
      gap: moderateScale(8),
    },
    passwordRequirementText: {
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
      flex: 1,
    },
    passwordRequirementMet: {
      color: theme.colors.success || '#4CAF50',
    },
  });

