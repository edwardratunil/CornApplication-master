import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

const faqItems = [
  {
    id: 'faq-1',
    question: 'How do I add a new farm?',
    answer:
      'Navigate to the Farm Locations screen and tap the Add Farm button. Provide the farm name and description to create it.',
  },
  {
    id: 'faq-2',
    question: 'Why is my device not sending data?',
    answer:
      'Ensure the device is powered, connected to the network, and that the MAC address is registered under the correct farm.',
  },
  {
    id: 'faq-3',
    question: 'Can I change my email address?',
    answer:
      'Email addresses are tied to your account and cannot currently be changed. Contact support if you need assistance.',
  },
];

export default function HelpCenterScreen() {
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
          <Text style={styles.headerTitle}>Help Center</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <Text style={styles.introText}>
          Find answers to the most common questions below. If you need additional assistance, feel free to reach out through the Contact Us page.
        </Text>

        {faqItems.map((item) => (
          <View key={item.id} style={styles.faqCard}>
            <Text style={styles.faqQuestion}>{item.question}</Text>
            <Text style={styles.faqAnswer}>{item.answer}</Text>
          </View>
        ))}

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={moderateScale(20)} color={theme.colors.accent} />
          <Text style={styles.tipText}>
            Tip: Keep your farms and devices organized by updating their names and descriptions regularly. This makes it easier to monitor the right modules at a glance.
          </Text>
        </View>
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
    faqCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
      marginBottom: moderateScale(16),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    faqQuestion: {
      fontSize: fontScale(16),
      fontWeight: '600',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(8),
    },
    faqAnswer: {
      color: theme.colors.mutedText,
      fontSize: fontScale(14),
      lineHeight: moderateScale(20),
    },
    tipCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: moderateScale(12),
      marginTop: moderateScale(24),
      backgroundColor: theme.colors.subtleCard,
      padding: moderateScale(16),
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tipText: {
      flex: 1,
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      lineHeight: moderateScale(20),
    },
  });

