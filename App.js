import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './navigation/AppNavigator';
import SplashScreen from './screens/SplashScreen';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { setGlobalFontSizeMultiplier } from './utils/responsive';

function RootApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const { theme, fontSizeMultiplier } = useTheme();

  useEffect(() => {
    setGlobalFontSizeMultiplier(fontSizeMultiplier);
  }, [fontSizeMultiplier]);

  const handleSplashFinish = () => {
    setShowSplash(false);
  };

  const statusBarStyle = theme.isDark ? 'light' : 'dark';

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {showSplash ? (
        <>
          <SplashScreen onFinish={handleSplashFinish} />
          <StatusBar style={statusBarStyle} />
        </>
      ) : (
        <>
          <AuthProvider
            isAuthenticated={isAuthenticated}
            setIsAuthenticated={setIsAuthenticated}
          >
            <AppNavigator
              isAuthenticated={isAuthenticated}
              setIsAuthenticated={setIsAuthenticated}
            />
          </AuthProvider>
          <StatusBar style={statusBarStyle} />
        </>
      )}
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RootApp />
    </ThemeProvider>
  );
}
