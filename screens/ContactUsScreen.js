import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

const contactChannels = [
  {
    id: 'support-email',
    label: 'Email Support',
    value: 'support@cornmist.io',
    icon: 'mail-outline',
    action: () => Linking.openURL('mailto:support@cornmist.io'),
  },
  {
    id: 'support-phone',
    label: 'Phone Hotline',
    value: '+1 (555) 123-4567',
    icon: 'call-outline',
    action: () => Linking.openURL('tel:+15551234567'),
  },
  {
    id: 'support-chat',
    label: 'Live Chat',
    value: 'Chat with an agent',
    icon: 'chatbubbles-outline',
    action: () => {},
  },
];

export default function ContactUsScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color={theme.colors.icon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Contact Us</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <Text style={styles.introText}>
          Need help or have feedback? Reach out through any of the channels below and our support team will get back to you as soon as possible.
        </Text>

        {contactChannels.map((channel) => (
          <TouchableOpacity
            key={channel.id}
            style={styles.contactCard}
            onPress={channel.action}
            activeOpacity={channel.action ? 0.7 : 1}
          >
            <View style={styles.contactIconContainer}>
              <Ionicons name={channel.icon} size={moderateScale(22)} color={theme.colors.accent} />
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>{channel.label}</Text>
              <Text style={styles.contactValue}>{channel.value}</Text>
            </View>
            {channel.action && (
              <Ionicons name="chevron-forward" size={moderateScale(20)} color={theme.colors.mutedText} />
            )}
          </TouchableOpacity>
        ))}

        <View style={styles.officeCard}>
          <Ionicons name="location-outline" size={moderateScale(20)} color={theme.colors.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.officeTitle}>Headquarters</Text>
            <Text style={styles.officeAddress}>123 Harvest Lane, Suite 200
San Francisco, CA 94105
United States</Text>
          </View>
        </View>

        <Text style={styles.responseTime}>
          Our team typically responds within 1 business day. For urgent matters, please use the hotline.
        </Text>
      </ScrollView>
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
      paddingBottom: moderateScale(40),
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
    introText: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
      marginBottom: moderateScale(20),
    },
    contactCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(14),
      marginBottom: moderateScale(14),
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: moderateScale(12),
    },
    contactIconContainer: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(18),
      backgroundColor: theme.colors.subtleCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactInfo: {
      flex: 1,
    },
    contactLabel: {
      fontSize: fontScale(15),
      fontWeight: '600',
      color: theme.colors.primaryText,
    },
    contactValue: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      marginTop: moderateScale(4),
    },
    officeCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: theme.colors.subtleCard,
      padding: moderateScale(16),
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: moderateScale(12),
      marginTop: moderateScale(20),
    },
    officeTitle: {
      fontSize: fontScale(15),
      fontWeight: '600',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(6),
    },
    officeAddress: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      lineHeight: moderateScale(20),
    },
    responseTime: {
      marginTop: moderateScale(24),
      color: theme.colors.mutedText,
      fontSize: fontScale(13),
      lineHeight: moderateScale(20),
    },
  });

