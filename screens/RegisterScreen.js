import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale, SCREEN_WIDTH } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

const HOSTINGER_AUTH_URL = '';

export default function RegisterScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecialChar: false,
  });

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

  const handleSignUp = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedConfirmPassword = confirmPassword.trim();

    if (!trimmedFirstName || !trimmedLastName || !trimmedEmail || !trimmedPassword || !trimmedConfirmPassword) {
      Alert.alert('Missing Information', 'Please fill out all fields.');
      return;
    }

    const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please provide a valid email address.');
      return;
    }

    const passwordError = validateStrongPassword(trimmedPassword);
    if (passwordError) {
      Alert.alert('Weak Password', passwordError);
      return;
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'register',
          first_name: trimmedFirstName,
          last_name: trimmedLastName,
          email: trimmedEmail,
          password: trimmedPassword,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'Registration failed. Please try again.';
        throw new Error(message);
      }

      const message = data?.message || 'Account created successfully!';
      Alert.alert('Success', message, [
        {
          text: 'OK',
          onPress: () => navigation.navigate('LoginScreen'),
        },
      ]);

      setFirstName('');
      setLastName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      Alert.alert('Registration Error', error.message || 'Unable to register at this time.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? moderateScale(60) : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerContainer}>
            <Text style={styles.title}>CORN MIST</Text>
            <Text style={styles.subtitle}>Create Your Account</Text>
          </View>

          {/* First Name Input */}
          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>First Name</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter your first name"
                placeholderTextColor={theme.colors.mutedText}
                value={firstName}
                onChangeText={setFirstName}
              />
            </View>
          </View>

          {/* Last Name Input */}
          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Last Name</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter your last name"
                placeholderTextColor={theme.colors.mutedText}
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>

          {/* Email Input */}
          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Email</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={theme.colors.mutedText}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={theme.colors.mutedText}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={handlePasswordChange}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
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

          {/* Confirm Password Input */}
          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Confirm Password</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
                placeholderTextColor={theme.colors.mutedText}
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <Ionicons
                  name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={moderateScale(20)}
                  color={theme.colors.icon}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Create Account Button */}
          <TouchableOpacity
            style={[styles.createButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.colors.surface} />
            ) : (
              <Text style={styles.createButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>

          {/* Login Link */}
          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('LoginScreen')}>
              <Text style={styles.loginLink}>Log In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContainer: {
      flexGrow: 1,
      padding: moderateScale(24),
      justifyContent: 'center',
      paddingBottom: moderateScale(40),
    },
    headerContainer: {
      alignItems: 'center',
      marginBottom: moderateScale(32),
    },
    title: {
      fontSize: fontScale(36),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(8),
    },
    subtitle: {
      fontSize: fontScale(16),
      color: theme.colors.mutedText,
    },
    inputWrapper: {
      marginBottom: moderateScale(20),
    },
    inputLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      marginBottom: moderateScale(8),
      fontWeight: '500',
    },
    inputContainer: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    input: {
      flex: 1,
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      padding: 0,
    },
    eyeButton: {
      padding: moderateScale(4),
    },
    createButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(16),
      alignItems: 'center',
      marginTop: moderateScale(10),
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    createButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(18),
      fontWeight: 'bold',
    },
    loginRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: moderateScale(20),
    },
    loginText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
    },
    loginLink: {
      color: theme.colors.accent,
      fontSize: fontScale(14),
      fontWeight: '600',
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
