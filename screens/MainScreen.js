import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ImageBackground,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LoginScreen from './LoginScreen';
import RegisterScreen from './RegisterScreen';
import { moderateScale, fontScale, SCREEN_WIDTH, SCREEN_HEIGHT } from '../utils/responsive';

// Images
const cornBackground = require('../assets/corn_background.jpg');
const cornLogo = require('../assets/logo.png');

export default function MainScreen({ onLogin }) {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [currentView, setCurrentView] = useState('main');
  const [mainLoading, setMainLoading] = useState({ login: false, register: false });

  const modalAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (showLogin || showRegister) {
      Animated.parallel([
        Animated.timing(modalAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      modalAnim.setValue(0);
      fadeAnim.setValue(0);
    }
  }, [showLogin, showRegister]);

  const handleLoginPress = () => {
    setMainLoading((l) => ({ ...l, login: true }));
    setTimeout(() => {
      setMainLoading((l) => ({ ...l, login: false }));
      setShowLogin(true);
      setCurrentView('login');
    }, 400);
  };

  const handleRegisterPress = () => {
    setMainLoading((l) => ({ ...l, register: true }));
    setTimeout(() => {
      setMainLoading((l) => ({ ...l, register: false }));
      setShowRegister(true);
      setCurrentView('register');
    }, 400);
  };

  const handleBack = () => {
    Animated.parallel([
      Animated.timing(modalAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowLogin(false);
      setShowRegister(false);
      setCurrentView('main');
    });
  };

  const handleLoginSuccess = () => {
    onLogin();
  };

  const handleRegisterSuccess = () => {
    setShowRegister(false);
    setShowLogin(true);
    setCurrentView('login');
  };

  const renderModalContent = () => {
    const isLogin = currentView === 'login';
    const ContentComponent = isLogin ? LoginScreen : RegisterScreen;
    const onSuccess = isLogin ? handleLoginSuccess : handleRegisterSuccess;

    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ImageBackground source={cornBackground} style={styles.backgroundImage} resizeMode="cover">
          <View style={styles.container}>
            <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} />
            <Animated.View
              style={[
                styles.modalContainer,
                {
                  transform: [
                    {
                      translateY: modalAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [SCREEN_HEIGHT, 0],
                      }),
                    },
                    {
                      scale: modalAnim.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0.8, 1.05, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Text style={styles.backButtonText}>✕</Text>
            </TouchableOpacity>
              <ContentComponent onLogin={onSuccess} onRegisterSuccess={onSuccess} />
            </Animated.View>
          </View>
        </ImageBackground>
      </SafeAreaView>
    );
  };

  if (currentView !== 'main') return renderModalContent();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ImageBackground source={cornBackground} style={styles.backgroundImage} resizeMode="cover">
        <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <Image source={cornLogo} style={styles.logo} />
          </View>
          <Text style={styles.title}>CORN MIST</Text>
          <View style={styles.underline} />
          <Text style={styles.tagline}>Mist It Right. Harvest Bright.</Text>
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.loginButton}
              onPress={handleLoginPress}
              activeOpacity={0.7}
            >
              <Text style={styles.loginButtonText}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.signupButton}
              onPress={handleRegisterPress}
              activeOpacity={0.7}
            >
              <Text style={styles.signupButtonText}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: moderateScale(110),
    paddingHorizontal: moderateScale(24),
  },
  logoContainer: {
    height: moderateScale(110),
    width: moderateScale(110),
    borderRadius: moderateScale(60),
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: moderateScale(12),
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: moderateScale(2) },
    shadowOpacity: 0.14,
    shadowRadius: moderateScale(8),
    marginTop: moderateScale(3),
  },
  logo: {
    width: moderateScale(160),
    height: moderateScale(160),
    borderRadius: moderateScale(50),
    marginBottom: moderateScale(22),
  },
  title: {
    fontSize: fontScale(40),
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 2,
    textShadowColor: 'black',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 10,
    marginTop: moderateScale(20),
    textAlign: 'center',
  },
  underline: {
    width: moderateScale(180),
    height: 2,
    backgroundColor: '#fff',
    marginTop: moderateScale(5),
  },
  tagline: {
    fontSize: fontScale(20),
    color: '#fff',
    fontWeight: '600',
    letterSpacing: 0.6,
    marginTop: moderateScale(10),
    textAlign: 'center',
    textShadowColor: 'black',
    textShadowOffset: { width: 2, height: 1 },
    textShadowRadius: 4,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: moderateScale(10),
    gap: moderateScale(20),
  },
  loginButton: {
    width: SCREEN_WIDTH * 0.69,
    paddingVertical: moderateScale(16),
    borderRadius: moderateScale(70),
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(99, 99, 99, 0.56)',
    marginTop: moderateScale(299),
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: fontScale(18),
    fontWeight: '600',
    letterSpacing: 1,
  },
  signupButton: {
    width: SCREEN_WIDTH * 0.69,
    paddingVertical: moderateScale(16),
    borderRadius: moderateScale(30),
    backgroundColor: '#fff',
    alignItems: 'center',
    marginBottom: moderateScale(190),
  },
  signupButtonText: {
    color: '#193059',
    fontSize: fontScale(18),
    fontWeight: '700',
    letterSpacing: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1,
  },
  modalContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000',
    zIndex: 2,
    height: '100%',
    paddingTop: moderateScale(32),
  },
  backButton: {
    position: 'absolute',
    top: moderateScale(24),
    right: moderateScale(24),
    zIndex: 3,
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: moderateScale(2) },
    shadowOpacity: 0.08,
    shadowRadius: moderateScale(4),
  },
  backButtonText: {
    fontSize: fontScale(20),
    color: '#888',
    fontWeight: 'bold',
  },
});
