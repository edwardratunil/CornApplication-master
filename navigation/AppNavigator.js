import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { FarmProvider } from '../contexts/FarmContext';
import { useTheme, getNavigationTheme } from '../contexts/ThemeContext';
import { UserProvider, useUser } from '../contexts/UserContext';
import { AlertProvider } from '../contexts/AlertContext';
import HeartbeatManager from '../components/HeartbeatManager';

const HOSTINGER_AUTH_URL = '';

// Screens
import HomeScreen from '../screens/HomeScreen';
import DeviceScreen from '../screens/DeviceScreen';
import ModuleScreen from '../screens/ModuleScreen';
import SettingScreen from '../screens/SettingsScreen';
import AlertsScreen from '../screens/AlertsScreen';
import AccountDetailsScreen from '../screens/AccountDetailsScreen';
import HelpCenterScreen from '../screens/HelpCenterScreen';
import ContactUsScreen from '../screens/ContactUsScreen';
import WaterLevelScreen from '../screens/WaterLevelScreen';
import PesticideLevelScreen from '../screens/PesticideLevelScreen';
import TemperatureHistoryScreen from '../screens/TemperatureHistoryScreen';
import HumidityHistoryScreen from '../screens/HumidityHistoryScreen';
import WindSpeedHistoryScreen from '../screens/WindSpeedHistoryScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Custom Bottom Navigation Bar
function CustomTabBar({ state, descriptors, navigation }) {
  const { theme } = useTheme();
  const getIconName = (routeName, isFocused) => {
    switch (routeName) {
      case 'Dashboard':
        return 'grid-outline';
      case 'Device':
        return 'wifi-outline';
      case 'Settings':
        return 'settings-outline';
      default:
        return 'home';
    }
  };

  return (
    <View style={[styles.bottomNav, { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border }] }>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const iconName = getIconName(route.name, isFocused);
        const iconColor = isFocused ? theme.colors.accent : theme.colors.mutedText;
        const textColor = isFocused ? theme.colors.accent : theme.colors.mutedText;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            onPress={onPress}
            style={styles.navItem}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name={iconName}
                size={moderateScale(24)}
                color={iconColor}
              />
            </View>
            <Text style={[styles.navLabel, { color: textColor }]}>
              {route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Main Tabs with custom tab bar
function MainTabs({ setIsAuthenticated }) {
  const { theme } = useTheme();
  const { user } = useUser();

  const handleLogout = async () => {
    if (user?.id) {
      try {
        // Call logout endpoint to update activity_status
        await fetch(HOSTINGER_AUTH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'logout',
            user_id: user.id,
          }),
        });
      } catch (error) {
        // Log error but continue with logout
        console.error('Logout API call failed:', error);
      }
    }
    // Always log out locally regardless of API call result
    if (setIsAuthenticated) {
      setIsAuthenticated(false);
    }
  };

  return (
<Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
  screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: theme.colors.card },
      }}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={HomeScreen}
        options={{
    headerRight: () => (
      <TouchableOpacity
        onPress={handleLogout}
        style={{ marginRight: 16 }}
      >
              <MaterialCommunityIcons name="logout" size={26} color={theme.colors.icon} />
      </TouchableOpacity>
    ),
  }}
      />
      <Tab.Screen name="Device" component={DeviceScreen} />
      <Tab.Screen name="Settings">
        {() => <SettingScreen setIsAuthenticated={setIsAuthenticated} />}
      </Tab.Screen>
</Tab.Navigator>
);
}

// Main App Navigator
export default function AppNavigator({ isAuthenticated, setIsAuthenticated }) {
  const { theme } = useTheme();
  const navTheme = useMemo(() => getNavigationTheme(theme), [theme]);

  return (
    <NavigationContainer theme={navTheme}>
      <UserProvider>
        <HeartbeatManager isAuthenticated={isAuthenticated} />
        <FarmProvider>
          <AlertProvider>
            <Stack.Navigator
            screenOptions={{ headerShown: false, animation: 'fade' }}
            initialRouteName={isAuthenticated ? "MainTabs" : "LoginScreen"}
          >
      {isAuthenticated ? (
              <>
                <Stack.Screen name="MainTabs">
          {() => <MainTabs setIsAuthenticated={setIsAuthenticated} />}
        </Stack.Screen>
                <Stack.Screen
                  name="WaterLevelScreen"
                  component={WaterLevelScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="PesticideLevelScreen"
                  component={PesticideLevelScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="TemperatureHistoryScreen"
                  component={TemperatureHistoryScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="HumidityHistoryScreen"
                  component={HumidityHistoryScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="WindSpeedHistoryScreen"
                  component={WindSpeedHistoryScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="AlertsScreen"
                  component={AlertsScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="ModuleScreen"
                  component={ModuleScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="AccountDetailsScreen"
                  component={AccountDetailsScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="HelpCenterScreen"
                  component={HelpCenterScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="ContactUsScreen"
                  component={ContactUsScreen}
                  options={{ headerShown: false }}
                />
              </>
      ) : (
        <>
          <Stack.Screen name="LoginScreen">
            {props => (
              <LoginScreen {...props} setIsAuthenticated={setIsAuthenticated} />
            )}
          </Stack.Screen>
                <Stack.Screen name="RegisterScreen" component={RegisterScreen} />
                <Stack.Screen name="ForgotPasswordScreen" component={ForgotPasswordScreen} />
        </>
      )}
    </Stack.Navigator>
          </AlertProvider>
        </FarmProvider>
      </UserProvider>
  </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: moderateScale(70),
    borderTopLeftRadius: moderateScale(20),
    borderTopRightRadius: moderateScale(20),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: moderateScale(8),
    paddingBottom: Platform.OS === 'ios' ? moderateScale(20) : moderateScale(8),
    paddingHorizontal: moderateScale(8),
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: moderateScale(8),
    elevation: 8,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: moderateScale(4),
  },
  iconContainer: {
    position: 'relative',
    marginBottom: moderateScale(4),
  },
  navLabel: {
    fontSize: fontScale(12),
    fontWeight: '500',
  },
});
