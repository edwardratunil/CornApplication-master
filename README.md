# CORN MIST - Smart Agricultural Misting System

**Version:** 1.0.0  
**Tagline:** Mist It Right. Harvest Bright.  
**Last Updated:** January 2025

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Safety Features](#safety-features)
- [Security Features](#security-features)
- [Recent Updates & Improvements](#recent-updates--improvements)
- [Installation & Setup](#installation--setup)
- [API Documentation](#api-documentation)
- [Cron Jobs](#cron-jobs)
- [Troubleshooting](#troubleshooting)
- [Areas for Improvement](#areas-for-improvement)
- [Documentation](#documentation)
- [License](#license)

---

## Overview

**CORN MIST** is a comprehensive IoT-based agricultural misting management system designed for corn farming operations. The system enables farmers to monitor environmental conditions, control water and pesticide misting systems, and automate irrigation based on real-time sensor data.

### Key Capabilities

- **Real-time Sensor Monitoring**: Temperature, humidity, wind speed, water level, pesticide level, and flow rate
- **Automated Misting**: Intelligent misting based on environmental conditions with continuous monitoring
- **Scheduled Misting**: Pre-configured schedules for water and pesticide application
- **Manual Control**: Direct relay control via mobile app
- **Multi-Farm Management**: Support for multiple farms per user
- **Comprehensive Alert System**: Notifications for critical conditions and system events with Philippine timezone support
- **User Activity Tracking**: Real-time user online/offline status monitoring
- **Security Logging**: Failed login attempt tracking and user activity logging

---

## Features

### Mobile Application (React Native)

#### Dashboard
- Real-time sensor data visualization
- Weather integration (OpenWeatherMap API)
- Quick access to all farm metrics
- Visual status indicators for relays and sensors
- User activity status display

#### Water Misting Management
- **Manual Mode**: Direct toggle control for water misting
- **Automated Mode**: Sensor-based automatic misting
  - Temperature threshold monitoring (checks continuously during active misting)
  - Humidity threshold monitoring (checks continuously during active misting)
  - Wind speed threshold monitoring (automatic shutdown if exceeded)
  - Water level threshold monitoring (priority check)
  - Configurable duration and interval
  - Alert notifications when automated misting starts/completes
- Water level threshold configuration
- Safety checks prevent misting when water level is low
- Automatic shutdown if conditions change during misting

#### Pesticide Misting Management
- Manual toggle control
- Scheduled misting with date/time selection
- Pesticide level threshold configuration
- Duration-based scheduling
- Automatic shutdown on wind speed threshold exceedance

#### Device Management
- Register main devices (ESP32 with sensors and relays)
- Register node devices (ESP32 with DHT22 and GPS)
- MAC address-based device identification
- Device status monitoring
- GPS coordinate validation and display
- Google Maps integration for device location

#### History & Analytics
- **Temperature History**: 
  - Interactive graphs (oldest to latest, left to right)
  - Hourly data list (latest to oldest, top to bottom)
  - Date and time range filtering
  - Statistics (min, max, average)
- **Humidity History**: Same features as temperature
- **Wind Speed History**: Same features as temperature
- Historical data visualization with customizable time ranges

#### Alerts System
- Real-time alert notifications
- Alert types: water level, temperature, humidity, wind speed, automation events
- Alert status: active, acknowledged, resolved
- Philippine timezone (Asia/Manila) support
- Alert filtering and management

#### Settings & Configuration
- User profile management with avatar selection
- Farm management (create, update, delete)
- Sensor threshold configuration
- Theme customization (light/dark mode)
- Font size adjustment (Small, Medium, Large, Extra Large)
- Push notifications toggle
- **User Manual**: Direct link to online user manual
- Help Center and Contact Us
- Account settings and logout

#### User Activity Tracking
- Real-time user online/offline status
- Heartbeat mechanism (30-second intervals)
- Automatic offline detection (15-second timeout)
- Activity status updates in database

### Backend Services (PHP)

#### Authentication System
- User registration with email validation
- Secure password hashing (bcrypt, cost factor 10)
- Password reset via OTP (One-Time Password, 10-minute expiration)
- Session management
- **User Activity Logging**: Comprehensive logging of user actions to `logs` table
- **Failed Login Attempt Logging**: Security event logging for authentication failures
- Activity status tracking (online/offline)

#### Farm Management API
- CRUD operations for farms
- Device registration and management
- Dashboard snapshot generation
- Relay state management
- Sensor threshold management
- Automation settings management
- Alert management (fetch, acknowledge, resolve)

#### Misting System
- **Scheduled Misting**: Process user-created schedules
  - Water and pesticide schedules
  - Duration enforcement
  - Automatic completion
  - Wind speed shutdown protection
- **Automated Misting**: Sensor-based automation
  - Temperature, humidity, wind speed, and water level checks
  - Continuous monitoring during active misting
  - Automatic shutdown on condition changes
  - Configurable check intervals
  - Immediate check on enable
- **Manual Control**: Direct relay control
- Mutual exclusion between water and pesticide misting
- Water level safety checks
- Wind speed automatic shutdown

#### Device Gateway
- ESP32 handshake and authorization
- Sensor data synchronization
- Relay state polling
- Heartbeat monitoring
- GPS coordinate validation
- Invalid coordinate rejection

#### Alert System
- Alert generation for critical conditions
- Alert types: water_low, temperature_high, temperature_low, humidity_high, wind_speed_high, schedule_started, schedule_completed
- Alert severity levels: critical, warning, info
- Philippine timezone conversion
- Alert acknowledgment and resolution

#### Logging System
- User activity logging (`logs` table)
- Security event logging (failed login attempts)
- System event logging
- Error logging with detailed context

### Hardware (ESP32)

#### Main Device (mainesp32/)
- **Sensors**:
  - Ultrasonic sensor (HC-SR04) - water/pesticide level measurement
  - Anemometer - wind speed measurement
  - Water flow sensor - flow rate measurement
- **Relays**: 4-channel relay control
  - Relay 1: Water misting
  - Relay 2: Pesticide misting
  - Relay 3: Reserved
  - Relay 4: Auxiliary (turns on with Relay 1 or 2)
- **Communication**:
  - WiFi connectivity
  - HTTPS POST to server
  - WebSocket for real-time relay updates (Railway.app)
  - Configuration portal (Access Point mode)
  - Retry mechanisms for network failures

#### Node Device (nodeesp32/)
- **Sensors**:
  - DHT22 - temperature and humidity measurement
  - GPS module (NMEA) - location tracking with coordinate validation
- **Communication**:
  - WiFi connectivity
  - HTTPS POST to server
  - Captive portal for WiFi configuration
  - GPS coordinate parsing and validation

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Application                        │
│                  (React Native / Expo)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Dashboard  │  │   Misting    │  │   Settings   │     │
│  │   Screen     │  │   Control    │  │   Screen     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   History    │  │   Alerts     │  │   Devices    │     │
│  │   Screens    │  │   Screen     │  │   Screen     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└───────────────────────────┬───────────────────────────────┘
                              │ HTTPS/JSON
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    Backend Server (PHP)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  auth.php          - Authentication & User Management │  │
│  │  farm.php           - Farm & Device Management       │  │
│  │  device_gateway.php - ESP32 Communication            │  │
│  │  alert_service.php  - Alert Management               │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  run_misting_worker.php - Unified Misting Worker     │  │
│  │  run_alert_checker.php  - Alert & Activity Checker  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              │ MySQL Database
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    Database (MySQL)                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Core Tables:                                          │  │
│  │  - users, farm, device                                 │  │
│  │  - main_readings, node_readings                       │  │
│  │  - misting_schedule                                    │  │
│  │  - sensor_thresholds                                  │  │
│  │  - automation_settings, automation_state              │  │
│  │  - alert, logs                                        │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

┌─────────────────┐         ┌─────────────────┐
│  Main ESP32     │         │  Node ESP32     │
│  (Sensors +     │         │  (DHT22 + GPS)  │
│   Relays)       │         │                 │
└────────┬────────┘         └────────┬────────┘
         │                            │
         │ HTTPS POST                 │ HTTPS POST
         │ WebSocket                  │
         │                            │
         └────────────┬───────────────┘
                      │
         ┌────────────▼────────────┐
         │   Railway WebSocket     │
         │   Service (Relay Push)  │
         └─────────────────────────┘
```

---

## Technology Stack

### Frontend
- **Framework**: React Native (Expo SDK ~54.0)
- **Navigation**: React Navigation (Stack & Bottom Tabs)
- **State Management**: React Context API
- **UI Components**: 
  - React Native Paper
  - React Native Vector Icons (Ionicons, MaterialCommunityIcons)
  - Custom components (GlassCard, SimpleLineGraph)
- **Charts**: Custom line graph components
- **Location**: Expo Location API
- **Storage**: AsyncStorage
- **Date/Time**: @react-native-community/datetimepicker
- **Blur Effects**: @react-native-community/blur, expo-blur

### Backend
- **Language**: PHP 7.4+ (strict types enabled)
- **Database**: MySQL (MariaDB)
- **API Style**: RESTful JSON APIs
- **Authentication**: bcrypt password hashing (cost factor 10)
- **Cron Jobs**: PHP scripts for scheduled tasks
- **Timezone**: Asia/Manila (Philippine time)

### Hardware
- **Microcontroller**: ESP32
- **Programming**: MicroPython
- **Sensors**: 
  - DHT22 (Temperature & Humidity)
  - Ultrasonic HC-SR04 (Water/Pesticide Level)
  - Anemometer (Wind Speed)
  - Water Flow Sensor (Flow Rate)
  - GPS Module (NMEA)
- **Actuators**: 4-channel Relay Module

### Infrastructure
- **Web Hosting**: Hostinger (PHP/MySQL)
- **WebSocket Service**: Railway.app (Node.js/Bun)
- **Weather API**: OpenWeatherMap
- **Database**: MySQL on Hostinger
- **Time Zone**: Asia/Manila (UTC+8)

---

## Safety Features

### 1. Water Level Protection ⚠️
- **Prevents misting when water level is critically low**
- Checks water level before:
  - Manual misting activation
  - Automated misting activation
  - Scheduled misting start
- **Automatic shutdown**:
  - Turns off misting if water level drops below threshold during operation
  - Monitors water level continuously during manual misting
  - Immediate shutdown for scheduled and automated misting
- **Alert generation**: Creates alerts when water level is too low
- **Frontend validation**: Disables toggle switch when water level is insufficient

### 2. Wind Speed Protection 🌪️
- **Automatic shutdown when wind speed exceeds threshold**
- Applies to:
  - Manual misting (water and pesticide)
  - Scheduled misting (water and pesticide)
  - Automated misting
- **Real-time monitoring**: Continuous wind speed checks during active misting
- **Alert generation**: Creates alerts when wind speed threshold is exceeded
- **Safety priority**: Wind speed checks override other conditions

### 3. Mutual Exclusion 🔒
- **Water and pesticide misting cannot run simultaneously**
- Prevents conflicts between different misting types
- Automatic relay management ensures only one type is active
- State tracking prevents race conditions

### 4. Schedule Safety 🕐
- **Duration enforcement**: Schedules automatically complete after configured duration
- **Water level checks**: Schedules are cancelled if water level is too low
- **Wind speed checks**: Schedules are cancelled if wind speed exceeds threshold
- **Status tracking**: Prevents duplicate or overlapping schedules
- **Automatic cleanup**: Completed schedules are properly marked

### 5. Automation Safety 🤖
- **Condition validation**: All sensor conditions must be met before activation
  - Temperature > threshold
  - Humidity < threshold
  - Wind speed < threshold
  - Water level > threshold
- **Water level priority**: Water level is checked before other conditions
- **Continuous monitoring**: 
  - Temperature and humidity checked during active misting
  - Automatic shutdown if conditions change
- **State persistence**: Automation state is tracked to prevent conflicts
- **Immediate check**: When automation is enabled, conditions are checked on next cron run
- **Graceful degradation**: System continues to function if sensors fail
- **Alert notifications**: Users are notified when automated misting starts/completes

### 6. Device Safety 🔌
- **MAC address validation**: Only registered devices can connect
- **Authorization checks**: Devices must complete handshake before operation
- **Heartbeat monitoring**: Tracks device connectivity
- **GPS validation**: Invalid coordinates are rejected
- **Coordinate range validation**: Ensures GPS readings are within valid ranges

### 7. Error Handling 🛡️
- **Database error handling**: Graceful error responses
- **Network error handling**: Retry mechanisms for ESP32
- **Null value protection**: Safe number conversion and validation
- **Exception handling**: Comprehensive try-catch blocks
- **Logging**: Detailed error logging for debugging

### 8. Data Validation ✅
- **Input sanitization**: All user inputs are validated
- **Type checking**: Strict type declarations in PHP
- **Range validation**: Threshold values are validated
- **SQL injection prevention**: Prepared statements throughout
- **GPS coordinate validation**: Invalid coordinates rejected

---

## Security Features

### 1. Authentication & Authorization 🔐

#### Password Security
- **bcrypt hashing**: Passwords are hashed using bcrypt (cost factor 10)
- **Password requirements**: Minimum 8 characters
- **Password reset**: Secure OTP-based password reset
  - OTP expires after 10 minutes
  - OTP is hashed before storage
  - One OTP per email at a time

#### Session Management
- **User ID validation**: All API requests validate user ownership
- **Farm ownership checks**: Users can only access their own farms
- **Device authorization**: MAC address-based device authentication
- **Activity tracking**: User online/offline status monitoring

#### Security Logging
- **Failed login attempt logging**: All authentication failures are logged
  - Invalid credentials
  - Unverified accounts
  - User not found
- **User activity logging**: Comprehensive logging of user actions
  - Registration, login, logout
  - Profile updates
  - Farm management operations
  - Device management operations
  - Threshold updates
  - Relay control operations

### 2. API Security 🔒

#### Input Validation
- **JSON validation**: All request bodies are validated
- **Parameter sanitization**: MAC addresses, emails, and other inputs are sanitized
- **SQL injection prevention**: Prepared statements with parameter binding
- **Type checking**: Strict type declarations (`declare(strict_types=1)`)

#### Access Control
- **CORS headers**: Configured for cross-origin requests
- **Method restrictions**: Only POST requests accepted (except OPTIONS)
- **Action validation**: Only whitelisted actions are processed

### 3. Database Security 🗄️

#### Connection Security
- **Prepared statements**: All queries use prepared statements
- **Error reporting**: MySQLi error reporting enabled
- **Connection charset**: UTF-8 encoding to prevent injection

#### Data Protection
- **Password storage**: Passwords never stored in plain text
- **Sensitive data**: Database credentials in PHP constants (should use environment variables - see improvements)

### 4. Device Security 🛡️

#### ESP32 Security
- **MAC address validation**: Only registered devices can connect
- **Handshake protocol**: Devices must complete authorization
- **WebSocket token**: Secret token for WebSocket connections
- **WiFi configuration**: Secure AP mode for initial setup

### 5. Network Security 🌐

#### HTTPS
- **Encrypted communication**: All API calls use HTTPS
- **Certificate validation**: SSL/TLS encryption for data in transit

#### WebSocket Security
- **Token authentication**: WebSocket service uses secret token
- **Railway service**: Secure WebSocket service for relay updates

---

## Recent Updates & Improvements

### Version 1.0.0 (January 2025)

#### New Features
1. **User Activity Logging System**
   - Comprehensive logging of user actions to `logs` table
   - Tracks registration, login, logout, profile updates, farm/device operations
   - Security event logging for failed login attempts

2. **User Activity Status Tracking**
   - Real-time online/offline status monitoring
   - Heartbeat mechanism (30-second intervals)
   - Automatic offline detection (15-second timeout)
   - Activity status updates in database

3. **Enhanced Alert System**
   - Philippine timezone (Asia/Manila) support
   - Alert notifications for automated misting start/complete
   - Improved alert filtering and management
   - Alert acknowledgment and resolution

4. **Wind Speed Protection**
   - Automatic shutdown when wind speed exceeds threshold
   - Applies to all misting modes (manual, scheduled, automated)
   - Real-time wind speed monitoring
   - Alert generation for wind speed threshold exceedance

5. **Enhanced Automated Misting**
   - Continuous temperature and humidity monitoring during active misting
   - Automatic shutdown if conditions change
   - Immediate condition check when automation is enabled
   - Alert notifications for automation events

6. **GPS Coordinate Validation**
   - Fixed GPS coordinate parsing (latitude/longitude)
   - Coordinate range validation
   - Invalid coordinate rejection
   - Google Maps integration with validation

7. **History Screen Improvements**
   - Graph display: oldest to latest (chronological, left to right)
   - List display: latest to oldest (most recent first)
   - Date and time range filtering
   - Statistics display (min, max, average)

8. **Settings Enhancements**
   - User Manual link (opens online manual)
   - Font size adjustment (4 sizes)
   - Improved theme customization
   - Enhanced user profile management

9. **Debug Tools**
   - `debug_automation.php` script for troubleshooting automated misting
   - Comprehensive diagnostic information
   - Condition checking and state analysis

#### Bug Fixes
1. Fixed GPS coordinate parsing (latitude/longitude direction handling)
2. Fixed alert timezone display (Philippine time)
3. Fixed user activity status persistence
4. Fixed automated misting immediate check on enable
5. Fixed history data ordering (graph vs list)

#### Performance Improvements
1. Optimized heartbeat mechanism (reduced interval to 30 seconds)
2. Faster offline detection (15 seconds)
3. Improved sensor data freshness checks
4. Enhanced logging for debugging

---

## Installation & Setup

### Prerequisites
- Node.js 16+ and npm
- Expo CLI
- PHP 7.4+ with MySQLi extension
- MySQL 5.7+ database
- ESP32 devices with MicroPython
- Hostinger hosting account (or similar PHP/MySQL hosting)
- Railway.app account (for WebSocket service)

### Mobile App Setup

```bash
# Install dependencies
npm install

# Start Expo development server
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

### Backend Setup

1. **Database Configuration**
   - Update database credentials in:
     - `server/auth.php`
     - `server/farm.php`
     - `server/device_gateway.php`
     - `server/run_misting_worker.php`
     - `server/run_alert_checker.php`
   - Run SQL migrations:
     - `cropmist.sql` (main schema)
     - `sensor_thresholds_migration.sql`
     - `automation_settings_migration.sql`
     - `alerts_schema.sql`

2. **Cron Job Setup**
   - **Misting Worker** (`run_misting_worker.php`): Run every 1-2 minutes
     ```
     */1 * * * * /usr/bin/php -q /home/USERNAME/public_html/server/run_misting_worker.php
     ```
   - **Alert Checker** (`run_alert_checker.php`): Run every 1 minute
     ```
     */1 * * * * /usr/bin/php -q /home/USERNAME/public_html/server/run_alert_checker.php
     ```

3. **WebSocket Service**
   - Deploy `relay-push-service/` to Railway.app
   - Configure Railway environment variables
   - Update `PUSH_SERVICE_URL` and `PUSH_SERVICE_API_KEY` in PHP files

4. **Timezone Configuration**
   - Ensure server timezone is set to `Asia/Manila`
   - PHP: `date_default_timezone_set('Asia/Manila')`

### ESP32 Setup

1. **Main Device** (`mainesp32/`)
   - Flash MicroPython firmware to ESP32
   - Upload Python files to ESP32:
     - `main.py`
     - `relay.py`
     - `ultrasonic.py`
     - `anemometer.py`
     - `waterflow.py`
   - Configure WiFi via AP portal
   - Register MAC address in app

2. **Node Device** (`nodeesp32/`)
   - Flash MicroPython firmware to ESP32
   - Upload Python files to ESP32:
     - `main.py`
     - `boot.py`
     - `dht22.py`
     - `gps.py`
   - Configure WiFi via captive portal
   - Register as "node" type device in app

---

## API Documentation

### Authentication Endpoints (`server/auth.php`)

#### Register
```json
POST /server/auth.php
{
  "action": "register",
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login
```json
POST /server/auth.php
{
  "action": "login",
  "email": "user@example.com",
  "password": "password123"
}
```

#### Logout
```json
POST /server/auth.php
{
  "action": "logout",
  "user_id": 1
}
```

#### Heartbeat
```json
POST /server/auth.php
{
  "action": "heartbeat",
  "user_id": 1
}
```

### Farm Management Endpoints (`server/farm.php`)

#### List Farms
```json
POST /server/farm.php
{
  "action": "list_farms",
  "user_id": 1
}
```

#### Create Farm
```json
POST /server/farm.php
{
  "action": "create_farm",
  "user_id": 1,
  "name": "Farm Name",
  "location": "Location"
}
```

#### Dashboard Snapshot
```json
POST /server/farm.php
{
  "action": "dashboard_snapshot",
  "user_id": 1,
  "farm_id": 1
}
```

#### Update Relays
```json
POST /server/farm.php
{
  "action": "update_relays",
  "user_id": 1,
  "farm_id": 1,
  "relay_1": 1,
  "relay_2": 0,
  "relay_3": 0,
  "relay_4": 1
}
```

#### Fetch Alerts
```json
POST /server/farm.php
{
  "action": "fetch_alerts",
  "user_id": 1,
  "farm_id": 1,
  "status": "all",
  "limit": 50
}
```

### Device Gateway Endpoints (`server/device_gateway.php`)

#### Handshake
```json
POST /server/device_gateway.php
{
  "action": "handshake",
  "mac_address": "AA:BB:CC:DD:EE:FF"
}
```

#### Sync Sensor Data
```json
POST /server/device_gateway.php
{
  "action": "sync",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "device_type": "main",
  "sensor_data": {
    "water_level": 50.5,
    "windspeed": 5.2,
    "flow_rate": 2.1
  }
}
```

---

## Cron Jobs

### 1. Misting Worker (`run_misting_worker.php`)
- **Frequency**: Every 1-2 minutes
- **Purpose**: 
  - Process scheduled misting (water/pesticide)
  - Process automated misting (sensor-based)
  - Handle misting completion and cleanup
  - Monitor conditions during active misting
- **Logging**: Comprehensive logging for debugging

### 2. Alert Checker (`run_alert_checker.php`)
- **Frequency**: Every 1 minute
- **Purpose**:
  - Check sensor thresholds
  - Generate alerts for threshold violations
  - Mark inactive users as offline (15-second threshold)
  - Update user activity status

---

## Troubleshooting

### Automated Misting Not Working

1. **Run Debug Script**:
   ```bash
   php server/debug_automation.php <farm_id>
   ```
   This will show:
   - Automation settings status
   - Current automation state
   - Sensor readings and their age
   - Which conditions are met/not met
   - Blocking issues

2. **Common Issues**:
   - Automation not enabled in settings
   - Missing sensor data (temperature, humidity, wind speed)
   - Water level too low
   - `next_check_at` set in future (waiting for interval)
   - Cron job not running

3. **Solutions**:
   - Enable automation in app settings
   - Ensure node devices are sending sensor data
   - Check water level threshold
   - Reset `next_check_at` to NULL:
     ```sql
     UPDATE automation_state SET next_check_at = NULL WHERE farm_id = <farm_id>;
     ```
   - Verify cron job is running

### GPS Coordinates Incorrect

- **Issue**: Coordinates showing wrong location
- **Solution**: 
  - GPS module should be properly connected
  - Ensure GPS has satellite lock
  - Check GPS parsing in `nodeesp32/gps.py`
  - Invalid coordinates are automatically rejected

### Alerts Showing Wrong Time

- **Issue**: Alerts showing 8-hour offset
- **Solution**: 
  - Backend converts UTC to Philippine time (Asia/Manila)
  - Frontend displays pre-converted timestamps
  - Ensure server timezone is set correctly

### User Activity Status Not Updating

- **Issue**: User remains "online" after disconnecting
- **Solution**:
  - Heartbeat runs every 30 seconds
  - Offline detection: 15 seconds after last heartbeat
  - Cron job marks users offline every minute
  - Check heartbeat service is running

---

## Areas for Improvement

### 🔴 Critical Security Issues

1. **Hardcoded Database Credentials**
   - Move to environment variables or `.env` file
   - Use configuration file outside web root
   - Implement secrets management

2. **CORS Configuration**
   - Restrict to specific domains
   - Use whitelist of allowed origins

3. **API Key Exposure**
   - Store in environment variables
   - Use secrets management

4. **Rate Limiting**
   - Implement rate limiting per IP
   - Add CAPTCHA for login attempts
   - Implement exponential backoff

### 🟡 Security Enhancements

5. **Session Management**
   - Implement JWT tokens for stateless authentication
   - Add token expiration and refresh mechanism

6. **Error Information Disclosure**
   - Use generic error messages for users
   - Log detailed errors server-side only

### 🟢 Safety Improvements

7. **Device Heartbeat Tracking**
   - Add `last_seen` TIMESTAMP column to `device` table
   - Create cron job to detect offline devices
   - Generate alerts for offline devices

8. **Temperature & Humidity Alerts**
   - Add separate high/low thresholds
   - Implement alert generation for both conditions

9. **Relay Error Detection**
   - ESP32 should report relay state after setting
   - Compare expected vs actual relay state
   - Generate alerts for relay errors

### 🔵 Feature Enhancements

10. **Push Notifications**
    - Implement push notifications for critical alerts
    - Add notification preferences

11. **Data Backup & Recovery**
    - Implement automated database backups
    - Add data export functionality

12. **Logging & Monitoring**
    - Implement structured logging
    - Add log rotation
    - Create monitoring dashboard

---

## Documentation

### Setup Guides
- `server/debug_automation.php` - Debug script for automated misting
- `cropmist.sql` - Main database schema
- `sensor_thresholds_migration.sql` - Sensor thresholds table
- `automation_settings_migration.sql` - Automation tables
- `alerts_schema.sql` - Alert system schema

### Code Documentation
- Inline comments in PHP files
- Function documentation in code
- Error logging for debugging

---

## License

This project is open source. Please refer to the license file for details.

---

## Support & Contact

For issues, questions, or contributions, please contact the development team.

**Application Name**: CORN MIST  
**Version**: 1.0.0  
**Last Updated**: January 2025

---

## Summary

CORN MIST is a comprehensive agricultural IoT system with strong safety features including water level protection, wind speed shutdown, and mutual exclusion. The system includes:

✅ **Implemented Features**:
- Real-time sensor monitoring
- Automated and scheduled misting
- Comprehensive alert system
- User activity tracking
- Security logging
- GPS coordinate validation
- History analytics with proper ordering
- User manual integration

⚠️ **Security Recommendations**:
1. Move hardcoded credentials to environment variables
2. Restrict CORS to specific domains
3. Implement rate limiting
4. Complete push notification integration

The system is functional and safe for basic operations, but addressing the security improvements listed above will make it production-ready for commercial deployment.
