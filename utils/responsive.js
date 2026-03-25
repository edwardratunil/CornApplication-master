import { Dimensions, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Base dimensions (iPhone 11 Pro - 375x812)
const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

// Scale factor based on screen width
const scale = (size) => (SCREEN_WIDTH / BASE_WIDTH) * size;

// Scale factor based on screen height
const verticalScale = (size) => (SCREEN_HEIGHT / BASE_HEIGHT) * size;

// Moderate scale - combines width and height scaling
const moderateScale = (size, factor = 0.5) => size + (scale(size) - size) * factor;

// Font size multiplier from theme context (default 1.0)
let globalFontSizeMultiplier = 1.0;

export const setGlobalFontSizeMultiplier = (multiplier) => {
  globalFontSizeMultiplier = multiplier;
};

// Font scaling with limits
const fontScale = (size) => {
  const scaled = scale(size);
  // Apply user's font size preference multiplier
  const userScaled = scaled * globalFontSizeMultiplier;
  // Limit font scaling to prevent too large/small fonts
  const maxSize = size * 1.5;
  const minSize = size * 0.8;
  if (userScaled > maxSize) return maxSize;
  if (userScaled < minSize) return minSize;
  return userScaled;
};

// Get responsive dimensions
export const getResponsiveDimensions = () => ({
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  isSmallDevice: SCREEN_WIDTH < 375,
  isMediumDevice: SCREEN_WIDTH >= 375 && SCREEN_WIDTH < 414,
  isLargeDevice: SCREEN_WIDTH >= 414,
  isTablet: SCREEN_WIDTH >= 768,
});

// Responsive padding/margin
export const responsivePadding = {
  xs: moderateScale(4),
  sm: moderateScale(8),
  md: moderateScale(16),
  lg: moderateScale(24),
  xl: moderateScale(32),
};

// Responsive font sizes
export const responsiveFontSize = {
  xs: fontScale(10),
  sm: fontScale(12),
  md: fontScale(14),
  lg: fontScale(16),
  xl: fontScale(18),
  xxl: fontScale(20),
  xxxl: fontScale(24),
  title: fontScale(28),
  largeTitle: fontScale(36),
  huge: fontScale(40),
};

// Responsive spacing
export const responsiveSpacing = {
  xs: moderateScale(4),
  sm: moderateScale(8),
  md: moderateScale(12),
  lg: moderateScale(16),
  xl: moderateScale(20),
  xxl: moderateScale(24),
  xxxl: moderateScale(32),
};

// Responsive border radius
export const responsiveBorderRadius = {
  sm: moderateScale(8),
  md: moderateScale(12),
  lg: moderateScale(16),
  xl: moderateScale(24),
  xxl: moderateScale(32),
  round: moderateScale(50),
};

// Export scaling functions
export { scale, verticalScale, moderateScale, fontScale, SCREEN_WIDTH, SCREEN_HEIGHT };

