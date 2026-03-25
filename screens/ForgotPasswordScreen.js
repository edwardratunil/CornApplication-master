import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

const HOSTINGER_AUTH_URL = '';

const STEP = {
  EMAIL: 1,
  OTP: 2,
  RESET: 3,
};

export default function ForgotPasswordScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [step, setStep] = useState(STEP.EMAIL);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (resendTimer <= 0) {
      return;
    }

    const timeout = setTimeout(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearTimeout(timeout);
  }, [resendTimer]);

  const handleSendOtp = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      Alert.alert('Missing Email', 'Please enter your registered email address.');
      return;
    }

    const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please input a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'request_password_reset',
          email: trimmedEmail,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'Unable to send OTP. Please try again.';
        throw new Error(message);
      }

      Alert.alert('OTP Sent', data.message);
      setEmail(trimmedEmail);
      setStep(STEP.OTP);
      setResendTimer(120);
    } catch (error) {
      Alert.alert('Request Failed', error.message || 'Unable to send OTP right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const trimmedOtp = otp.trim();

    if (trimmedOtp.length !== 6) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit OTP from your email.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'verify_password_reset',
          email,
          otp: trimmedOtp,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'OTP verification failed. Please try again.';
        throw new Error(message);
      }

      Alert.alert('Verified', 'OTP verified. Please enter your new password.');
      setStep(STEP.RESET);
      setResendTimer(0);
    } catch (error) {
      Alert.alert('Verification Failed', error.message || 'Unable to verify OTP right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmedPassword = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();
    const trimmedOtp = otp.trim();

    if (trimmedPassword.length < 8) {
      Alert.alert('Weak Password', 'New password must be at least 8 characters long.');
      return;
    }

    if (trimmedPassword !== trimmedConfirm) {
      Alert.alert('Password Mismatch', 'New password and confirmation do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'reset_password',
          email,
          otp: trimmedOtp,
          new_password: trimmedPassword,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'Unable to reset password. Please try again.';
        throw new Error(message);
      }

      Alert.alert('Success', 'Password updated successfully. Please log in with your new password.', [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error) {
      Alert.alert('Reset Failed', error.message || 'Unable to reset password right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderEmailStep = () => (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>Forgot Password</Text>
      <Text style={styles.sectionSubtitle}>
        Enter your registered email address. We will send a one-time password (OTP) to reset your password.
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Email</Text>
        <View style={styles.inputContainer}>
          <Ionicons
            name="mail-outline"
            size={moderateScale(20)}
            color={theme.colors.icon}
            style={styles.leadingIcon}
          />
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

      <TouchableOpacity
        style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
        onPress={handleSendOtp}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={theme.colors.surface} />
        ) : (
          <Text style={styles.primaryButtonText}>Send OTP</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderOtpStep = () => (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>Enter OTP</Text>
      <Text style={styles.sectionSubtitle}>
        Please check your email for the 6-digit OTP and enter it below.
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>One-Time Password</Text>
        <View style={styles.inputContainer}>
          <Ionicons
            name="key-outline"
            size={moderateScale(20)}
            color={theme.colors.icon}
            style={styles.leadingIcon}
          />
          <TextInput
            style={styles.input}
            placeholder="Enter 6-digit OTP"
            placeholderTextColor={theme.colors.mutedText}
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
        onPress={handleVerifyOtp}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={theme.colors.surface} />
        ) : (
          <Text style={styles.primaryButtonText}>Verify OTP</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.secondaryButton,
          (isLoading || resendTimer > 0) && styles.buttonDisabled,
        ]}
        onPress={handleSendOtp}
        disabled={isLoading || resendTimer > 0}
      >
        <Text style={styles.secondaryButtonText}>
          {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderResetStep = () => (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>Set New Password</Text>
      <Text style={styles.sectionSubtitle}>Create a strong password to protect your account.</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>New Password</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Enter new password"
            placeholderTextColor={theme.colors.mutedText}
            secureTextEntry={!showPassword}
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <TouchableOpacity
            style={styles.trailingButton}
            onPress={() => setShowPassword((prev) => !prev)}
          >
            <Ionicons
              name={showPassword ? 'eye-outline' : 'eye-off-outline'}
              size={moderateScale(20)}
              color={theme.colors.icon}
            />
          </TouchableOpacity>
        </View>
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
            style={styles.trailingButton}
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
        style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
        onPress={handleResetPassword}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={theme.colors.surface} />
        ) : (
          <Text style={styles.primaryButtonText}>Reset Password</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Forgot Password</Text>
            <View style={styles.headerPlaceholder} />
          </View>

          {step === STEP.EMAIL && renderEmailStep()}
          {step === STEP.OTP && renderOtpStep()}
          {step === STEP.RESET && renderResetStep()}
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
    container: {
      flexGrow: 1,
      padding: moderateScale(20),
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
    sectionContainer: {
      flex: 1,
    },
    sectionTitle: {
      fontSize: fontScale(22),
      fontWeight: '700',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(12),
    },
    sectionSubtitle: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginBottom: moderateScale(20),
      lineHeight: moderateScale(20),
    },
    inputGroup: {
      marginBottom: moderateScale(20),
    },
    inputLabel: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      fontWeight: '500',
      marginBottom: moderateScale(8),
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
    },
    input: {
      flex: 1,
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      padding: 0,
    },
    leadingIcon: {
      marginRight: moderateScale(12),
    },
    trailingButton: {
      marginLeft: moderateScale(12),
    },
    primaryButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(16),
      alignItems: 'center',
      marginTop: moderateScale(10),
    },
    primaryButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(16),
      fontWeight: '600',
    },
    secondaryButton: {
      alignItems: 'center',
      marginTop: moderateScale(16),
    },
    secondaryButtonText: {
      color: theme.colors.accent,
      fontSize: fontScale(14),
      fontWeight: '600',
    },
    buttonDisabled: {
      opacity: 0.7,
    },
  });


