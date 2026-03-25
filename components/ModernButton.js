import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { moderateScale, fontScale } from '../utils/responsive';

export default function ModernButton({ title, onPress, style, textStyle, variant = 'primary' }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.buttonBase, variant === 'primary' ? styles.primary : styles.secondary, style]}
    >
      <Text style={[styles.buttonText, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    borderRadius: moderateScale(30),
    paddingVertical: moderateScale(7),
    paddingHorizontal: moderateScale(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#fff',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#fff',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: fontScale(12),
  },
});
