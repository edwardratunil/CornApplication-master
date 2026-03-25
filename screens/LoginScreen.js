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
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale, SCREEN_WIDTH } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';
import { useUser } from '../contexts/UserContext';

const HOSTINGER_AUTH_URL = 'https://cropmist.com/server/auth.php';

export default function LoginScreen({ setIsAuthenticated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigation = useNavigation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);
  const { updateUser } = useUser();

  const handleLogin = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      Alert.alert('Missing Information', 'Please enter both email and password.');
      return;
    }

    const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please provide a valid email address.');
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
          action: 'login',
          email: trimmedEmail,
          password: trimmedPassword,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'Login failed. Please verify your credentials.';
        
        // Handle email not verified
        if (data?.email_not_verified) {
          Alert.alert(
            'Email Not Verified',
            message + '\n\nWould you like to resend the verification email?',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Resend Email',
                onPress: () => handleResendVerificationEmail(trimmedEmail),
              },
            ]
          );
          return;
        }
        
        throw new Error(message);
      }

      const sanitizedData = {
        id: data.data?.id ?? null,
        firstName: data.data?.first_name ?? '',
        lastName: data.data?.last_name ?? '',
        email: data.data?.email ?? trimmedEmail,
        role: data.data?.role ?? 'user',
        avatar: data.data?.avatar ?? 'farmer1',
      };

      updateUser(sanitizedData);
      setIsAuthenticated(true);
    } catch (error) {
      Alert.alert('Login Error', error.message || 'Unable to log in right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    navigation.navigate('ForgotPasswordScreen');
  };

  const handleResendVerificationEmail = async (email) => {
    try {
      const response = await fetch(HOSTINGER_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'resend_verification_email',
          email: email,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        const message = data?.message || 'Failed to resend verification email.';
        Alert.alert('Error', message);
        return;
      }

      Alert.alert('Success', data.message || 'Verification email sent. Please check your inbox.');
    } catch (error) {
      Alert.alert('Error', 'Failed to resend verification email. Please try again later.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? moderateScale(60) : insets.bottom}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header with Icon */}
          <View style={styles.headerContainer}>
            <Image source={require('../assets/adaptive-icon.png')} style={styles.headerIcon} />
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Monitor Your Farm, Smarter.</Text>
          </View>

          {/* Email/Username Input */}
            <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Email or Username</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={moderateScale(20)} color={theme.colors.icon} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your email or username"
                placeholderTextColor={theme.colors.mutedText}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </View>

            {/* Password Input */}
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={moderateScale(20)} color={theme.colors.icon} style={styles.inputIcon} />
                <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={theme.colors.mutedText}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
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
            </View>

          {/* Forgot Password Link */}
          <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotPasswordContainer}>
            <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.colors.surface} />
            ) : (
              <Text style={styles.loginButtonText}>Login</Text>
            )}
            </TouchableOpacity>

          {/* Sign Up Link */}
          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('RegisterScreen')}>
              <Text style={styles.signupLink}>Sign Up</Text>
              </TouchableOpacity>
          </View>
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
      padding: moderateScale(24),
    justifyContent: 'center',
      paddingBottom: moderateScale(40) + insets.bottom,
    },
    headerContainer: {
    alignItems: 'center',
      marginBottom: moderateScale(40),
    },
      headerIcon: {
        width: moderateScale(60),
        height: moderateScale(60),
        resizeMode: 'contain',
        marginBottom: moderateScale(16),
  },
  title: {
      fontSize: fontScale(32),
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
    flexDirection: 'row',
    alignItems: 'center',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    inputIcon: {
      marginRight: moderateScale(12),
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
    forgotPasswordContainer: {
      alignItems: 'flex-end',
      marginBottom: moderateScale(24),
  },
  forgotText: {
      color: theme.colors.accent,
      fontSize: fontScale(14),
    fontWeight: '500',
  },
  loginButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(16),
    alignItems: 'center',
      marginBottom: moderateScale(24),
    },
    buttonDisabled: {
      opacity: 0.7,
  },
  loginButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(18),
    fontWeight: 'bold',
    },
    signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    },
    signupText: {
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
  },
    signupLink: {
      color: theme.colors.accent,
      fontSize: fontScale(14),
      fontWeight: '600',
  },
});
