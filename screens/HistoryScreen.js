import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import SimpleLineGraph from '../components/SimpleLineGraph';

const filterTabs = ['All', 'Humidity', 'Temperature', 'Wind'];

const historyData = [
  {
    id: 1,
    title: 'Humidity',
    value: '75%',
    change: '+5%',
    isPositive: true,
    data: [70, 72, 68, 74, 76, 73, 75], // Sample data points for graph
  },
  {
    id: 2,
    title: 'Temperature',
    value: '25°C',
    change: '+2°C',
    isPositive: true,
    data: [23, 24, 22, 25, 26, 24, 25], // Sample data points for graph
  },
  {
    id: 3,
    title: 'Wind',
    value: '15 km/h',
    change: '-3 km/h',
    isPositive: false,
    data: [18, 17, 16, 15, 14, 15, 15], // Sample data points for graph
  },
];

const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function HistoryScreen() {
  const navigation = useNavigation();
  const [selectedFilter, setSelectedFilter] = useState('All');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={moderateScale(24)} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>History</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Filter Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsContainer}
          contentContainerStyle={styles.tabsContent}
        >
          {filterTabs.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                selectedFilter === tab && styles.tabActive,
              ]}
              onPress={() => setSelectedFilter(tab)}
            >
              <Text
                style={[
                  styles.tabText,
                  selectedFilter === tab && styles.tabTextActive,
                ]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Data Cards */}
        {historyData.map((item) => (
          <View key={item.id} style={styles.dataCard}>
            <Text style={styles.dataTitle}>{item.title}</Text>
            <Text style={styles.dataValue}>{item.value}</Text>
            <View style={styles.changeContainer}>
              <Text style={styles.changeLabel}>Last 7 Days </Text>
              <Text
                style={[
                  styles.changeValue,
                  item.isPositive ? styles.changePositive : styles.changeNegative,
                ]}
              >
                {item.change}
              </Text>
            </View>
            <SimpleLineGraph data={item.data} color="#AAAAAA" labels={daysOfWeek} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1A231A',
  },
  scrollView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: moderateScale(16),
    paddingBottom: moderateScale(100),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: moderateScale(24),
    paddingHorizontal: moderateScale(4),
  },
  headerTitle: {
    fontSize: fontScale(20),
    fontWeight: 'bold',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: moderateScale(24),
  },
  tabsContainer: {
    marginBottom: moderateScale(24),
  },
  tabsContent: {
    paddingHorizontal: moderateScale(4),
  },
  tab: {
    backgroundColor: '#2C2C2C',
    borderRadius: moderateScale(20),
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(10),
    marginRight: moderateScale(12),
  },
  tabActive: {
    backgroundColor: '#4CAF50',
  },
  tabText: {
    fontSize: fontScale(14),
    fontWeight: '500',
    color: '#FFFFFF',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  dataCard: {
    backgroundColor: '#2C2C2C',
    borderRadius: moderateScale(12),
    padding: moderateScale(20),
    marginBottom: moderateScale(16),
  },
  dataTitle: {
    fontSize: fontScale(14),
    color: '#AAAAAA',
    marginBottom: moderateScale(8),
  },
  dataValue: {
    fontSize: fontScale(36),
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: moderateScale(8),
  },
  changeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: moderateScale(16),
  },
  changeLabel: {
    fontSize: fontScale(14),
    color: '#AAAAAA',
  },
  changeValue: {
    fontSize: fontScale(14),
    fontWeight: 'bold',
  },
  changePositive: {
    color: '#4CAF50',
  },
  changeNegative: {
    color: '#FF5252',
  },
});
