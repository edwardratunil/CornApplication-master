import React, { useEffect, useMemo } from 'react';
import { Text, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

export default function SplashScreen({ onFinish }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onFinish(); // This calls the function from App.js to continue flow
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>CORN MIST</Text>
      <Image source={require('../assets/loading.gif')} style={styles.loading} />
    </SafeAreaView>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logo: {
      width: moderateScale(160),
      height: moderateScale(160),
      marginBottom: moderateScale(20),
    },
    title: {
      fontSize: fontScale(40),
      fontWeight: 'bold',
      color: theme.colors.accent,
      textShadowColor: theme.isDark ? '#000' : '#FFFFFF',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 4,
      marginBottom: moderateScale(30),
    },
    loading: {
      width: moderateScale(80),
      height: moderateScale(80),
    },
  });
