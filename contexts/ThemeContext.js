import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'corn_app_theme_preference';
const FONT_SIZE_STORAGE_KEY = 'corn_app_font_size_preference';

const lightPalette = {
  background: '#F5F5F5',
  card: '#FFFFFF',
  surface: '#FFFFFF',
  primaryText: '#1A1C1A',
  secondaryText: '#4A4A4A',
  mutedText: '#757575',
  border: '#E0E0E0',
  accent: '#4CAF50',
  accentSecondary: '#03A9F4',
  danger: '#FF5252',
  success: '#4CAF50',
  overlay: 'rgba(0,0,0,0.65)',
  icon: '#1E1E1E',
  subtleCard: '#F0F0F0',
};

const darkPalette = {
  background: '#1A231A',
  card: '#2C2C2C',
  surface: '#2C2C2C',
  primaryText: '#FFFFFF',
  secondaryText: '#D0D0D0',
  mutedText: '#AAAAAA',
  border: '#3A3A3A',
  accent: '#4CAF50',
  accentSecondary: '#03A9F4',
  danger: '#FF5252',
  success: '#4CAF50',
  overlay: 'rgba(0,0,0,0.75)',
  icon: '#FFFFFF',
  subtleCard: '#1F2920',
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState('light');
  const [fontSizeMultiplier, setFontSizeMultiplier] = useState(1.0);
  const isDark = themeName === 'dark';

  const palette = isDark ? darkPalette : lightPalette;

  const theme = useMemo(
    () => ({
      name: themeName,
      colors: palette,
      isDark,
      fontSizeMultiplier,
    }),
    [palette, themeName, isDark, fontSizeMultiplier]
  );

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') {
          setThemeName(stored);
        }
      })
      .catch(() => {});

    AsyncStorage.getItem(FONT_SIZE_STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const multiplier = parseFloat(stored);
          if (!isNaN(multiplier) && multiplier >= 0.7 && multiplier <= 1.5) {
            setFontSizeMultiplier(multiplier);
          }
        }
      })
      .catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeName((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const setFontSize = useCallback((multiplier) => {
    setFontSizeMultiplier(multiplier);
    AsyncStorage.setItem(FONT_SIZE_STORAGE_KEY, multiplier.toString()).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme: setThemeName, setFontSize, fontSizeMultiplier }),
    [theme, toggleTheme, setFontSize, fontSizeMultiplier]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function getNavigationTheme(theme) {
  return {
    dark: theme.isDark,
    colors: {
      primary: theme.colors.accent,
      background: theme.colors.background,
      card: theme.colors.card,
      text: theme.colors.primaryText,
      border: theme.colors.border,
      notification: theme.colors.accent,
    },
  };
}

