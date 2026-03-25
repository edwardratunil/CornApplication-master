-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Dec 10, 2025 at 05:46 AM
-- Server version: 11.8.3-MariaDB-log
-- PHP Version: 7.2.34

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `u343161419_cropmist`
--

-- --------------------------------------------------------

--
-- Table structure for table `alert`
--

CREATE TABLE `alert` (
  `id` int(11) NOT NULL,
  `farm_id` int(11) NOT NULL,
  `device_id` int(11) DEFAULT NULL,
  `alert_type` enum('water_low','water_critical','pesticide_low','pesticide_critical','device_offline','device_reconnected','schedule_started','schedule_completed','schedule_failed','temperature_high','temperature_low','humidity_high','humidity_low','wind_high','gps_lost','sensor_error','relay_error','system_error') NOT NULL,
  `severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `status` enum('active','acknowledged','resolved') NOT NULL DEFAULT 'active',
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `acknowledged_at` timestamp NULL DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `acknowledged_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `alert`
--


-- --------------------------------------------------------

--
-- Table structure for table `automation_settings`
--

CREATE TABLE `automation_settings` (
  `id` int(11) NOT NULL,
  `farm_id` int(11) NOT NULL,
  `is_automated` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 = manual, 1 = automated',
  `duration_minutes` int(11) NOT NULL DEFAULT 2 COMMENT 'Duration in minutes for each misting cycle',
  `interval_minutes` int(11) NOT NULL DEFAULT 60 COMMENT 'Interval in minutes between misting cycles',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `automation_settings`
--



-- --------------------------------------------------------

--
-- Table structure for table `automation_state`
--

CREATE TABLE `automation_state` (
  `id` int(11) NOT NULL,
  `farm_id` int(11) NOT NULL,
  `relays_on_at` datetime DEFAULT NULL COMMENT 'When relays were turned ON',
  `next_check_at` datetime DEFAULT NULL COMMENT 'When to check conditions again',
  `last_checked_at` datetime DEFAULT NULL COMMENT 'Last time conditions were checked',
  `is_running` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Whether misting is currently running',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `automation_state`
--


-- --------------------------------------------------------

--
-- Table structure for table `device`
--

CREATE TABLE `device` (
  `id` int(11) NOT NULL,
  `farm_id` int(11) NOT NULL,
  `mac_address` varchar(255) NOT NULL,
  `device_name` varchar(255) NOT NULL,
  `device_type` enum('main','node') NOT NULL,
  `relay_1` tinyint(4) DEFAULT 0,
  `relay_2` tinyint(4) DEFAULT 0,
  `relay_3` tinyint(4) DEFAULT 0,
  `relay_4` tinyint(4) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `last_heartbeat` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `device`
--



-- --------------------------------------------------------

--
-- Table structure for table `email_verifications`
--

CREATE TABLE `email_verifications` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `email` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `farm`
--

CREATE TABLE `farm` (
  `id` int(11) NOT NULL,
  `users_id` int(11) NOT NULL,
  `farm_name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `farm`
--



-- --------------------------------------------------------

--
-- Table structure for table `logs`
--

CREATE TABLE `logs` (
  `id` int(11) NOT NULL,
  `users_id` int(11) DEFAULT NULL,
  `log_type` enum('user_action','system_event','security_event','error','warning','info') NOT NULL DEFAULT 'info',
  `action_type` varchar(50) DEFAULT NULL,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int(11) DEFAULT NULL,
  `description` text NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `client_source` varchar(50) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `logs`
--

-- --------------------------------------------------------

--
-- Table structure for table `main_readings`
--

CREATE TABLE `main_readings` (
  `id` int(11) NOT NULL,
  `device_id` int(11) NOT NULL,
  `water_level` decimal(10,2) DEFAULT NULL,
  `pesticide_level` decimal(10,2) DEFAULT NULL,
  `windspeed` decimal(10,2) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `flow_rate` decimal(10,2) DEFAULT NULL,
  `timestamp` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `main_readings`
--

-- --------------------------------------------------------

--
-- Table structure for table `misting_schedule`
--

CREATE TABLE `misting_schedule` (
  `id` int(11) NOT NULL,
  `farm_id` int(11) NOT NULL,
  `schedule_type` enum('water','pesticide') NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `duration_seconds` int(11) NOT NULL DEFAULT 0,
  `status` enum('pending','running','completed','cancelled') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `misting_schedule`
--
-- --------------------------------------------------------

--
-- Table structure for table `node_readings`
--

CREATE TABLE `node_readings` (
  `id` int(11) NOT NULL,
  `device_id` int(11) NOT NULL,
  `temperature` decimal(5,2) DEFAULT NULL,
  `humidity` decimal(5,2) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `flow_rate` decimal(10,2) DEFAULT NULL,
  `timestamp` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `node_readings`
--
-- --------------------------------------------------------

--
-- Table structure for table `password_resets`
--

CREATE TABLE `password_resets` (
  `id` int(11) NOT NULL,
  `email` varchar(255) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sensor_thresholds`
--

CREATE TABLE `sensor_thresholds` (
  `id` int(11) NOT NULL,
  `farm_id` int(11) NOT NULL,
  `water_level_threshold` decimal(10,2) DEFAULT 20.00 COMMENT 'Alert when water level is below this value (cm)',
  `pesticide_level_threshold` decimal(10,2) DEFAULT 20.00 COMMENT 'Alert when pesticide level is below this value (cm)',
  `temperature_threshold` decimal(5,2) DEFAULT 25.00 COMMENT 'Alert when temperature is above this value (°C)',
  `humidity_threshold` decimal(5,2) DEFAULT 70.00 COMMENT 'Alert when humidity is above this value (%)',
  `wind_speed_threshold` decimal(5,2) DEFAULT 15.00 COMMENT 'Alert when wind speed is above this value (km/h)',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `auto_water_misting_duration_seconds` int(11) DEFAULT 120 COMMENT 'Duration in seconds for auto-water misting (default: 120 = 2 minutes)',
  `auto_water_misting_interval_seconds` int(11) DEFAULT 1800 COMMENT 'Interval in seconds between auto-water misting activations (default: 1800 = 30 minutes)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `sensor_thresholds`
--

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `first_name` varchar(255) NOT NULL,
  `last_name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','user') NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `avatar` text DEFAULT NULL,
  `user_token` varchar(255) DEFAULT NULL,
  `csrf_token` varchar(64) DEFAULT NULL,
  `last_logged_in` datetime DEFAULT NULL,
  `activity_status` varchar(50) NOT NULL DEFAULT 'Offline',
  `push_token` varchar(255) DEFAULT NULL,
  `push_notifications_enabled` tinyint(1) DEFAULT 1,
  `email_verified` tinyint(1) NOT NULL DEFAULT 0,
  `last_active_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

-- --------------------------------------------------------

--
-- Table structure for table `user_activity_log`
--

CREATE TABLE `user_activity_log` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `action` varchar(100) NOT NULL,
  `description` text NOT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `user_activity_log`
--


--
-- Indexes for dumped tables
--

--
-- Indexes for table `alert`
--
ALTER TABLE `alert`
  ADD PRIMARY KEY (`id`),
  ADD KEY `farm_id` (`farm_id`),
  ADD KEY `device_id` (`device_id`),
  ADD KEY `alert_type` (`alert_type`),
  ADD KEY `status` (`status`),
  ADD KEY `severity` (`severity`),
  ADD KEY `created_at` (`created_at`),
  ADD KEY `fk_alert_user` (`acknowledged_by`);

--
-- Indexes for table `automation_settings`
--
ALTER TABLE `automation_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `farm_id` (`farm_id`);

--
-- Indexes for table `automation_state`
--
ALTER TABLE `automation_state`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `farm_id` (`farm_id`);

--
-- Indexes for table `device`
--
ALTER TABLE `device`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `mac_address` (`mac_address`),
  ADD KEY `farm_id` (`farm_id`),
  ADD KEY `idx_last_heartbeat` (`last_heartbeat`);

--
-- Indexes for table `email_verifications`
--
ALTER TABLE `email_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_token` (`token`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_email` (`email`);

--
-- Indexes for table `farm`
--
ALTER TABLE `farm`
  ADD PRIMARY KEY (`id`),
  ADD KEY `users_id` (`users_id`);

--
-- Indexes for table `logs`
--
ALTER TABLE `logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_users_id` (`users_id`),
  ADD KEY `idx_log_type` (`log_type`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_entity` (`entity_type`,`entity_id`),
  ADD KEY `idx_logs_client_source` (`client_source`);

--
-- Indexes for table `main_readings`
--
ALTER TABLE `main_readings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `device_id` (`device_id`);

--
-- Indexes for table `misting_schedule`
--
ALTER TABLE `misting_schedule`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_farm_type_status` (`farm_id`,`schedule_type`,`status`);

--
-- Indexes for table `node_readings`
--
ALTER TABLE `node_readings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `device_id` (`device_id`);

--
-- Indexes for table `password_resets`
--
ALTER TABLE `password_resets`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `sensor_thresholds`
--
ALTER TABLE `sensor_thresholds`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `farm_id` (`farm_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_users_csrf_token` (`csrf_token`);

--
-- Indexes for table `user_activity_log`
--
ALTER TABLE `user_activity_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_action` (`action`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_user_action` (`user_id`,`action`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `alert`
--
ALTER TABLE `alert`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=49;

--
-- AUTO_INCREMENT for table `automation_settings`
--
ALTER TABLE `automation_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `automation_state`
--
ALTER TABLE `automation_state`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `device`
--
ALTER TABLE `device`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `email_verifications`
--
ALTER TABLE `email_verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `farm`
--
ALTER TABLE `farm`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;

--
-- AUTO_INCREMENT for table `logs`
--
ALTER TABLE `logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=444;

--
-- AUTO_INCREMENT for table `main_readings`
--
ALTER TABLE `main_readings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3235;

--
-- AUTO_INCREMENT for table `misting_schedule`
--
ALTER TABLE `misting_schedule`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `node_readings`
--
ALTER TABLE `node_readings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10328;

--
-- AUTO_INCREMENT for table `password_resets`
--
ALTER TABLE `password_resets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sensor_thresholds`
--
ALTER TABLE `sensor_thresholds`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=35;

--
-- AUTO_INCREMENT for table `user_activity_log`
--
ALTER TABLE `user_activity_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `alert`
--
ALTER TABLE `alert`
  ADD CONSTRAINT `fk_alert_device` FOREIGN KEY (`device_id`) REFERENCES `device` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_alert_farm` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_alert_user` FOREIGN KEY (`acknowledged_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `automation_settings`
--
ALTER TABLE `automation_settings`
  ADD CONSTRAINT `automation_settings_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `automation_state`
--
ALTER TABLE `automation_state`
  ADD CONSTRAINT `automation_state_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `device`
--
ALTER TABLE `device`
  ADD CONSTRAINT `device_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `farm`
--
ALTER TABLE `farm`
  ADD CONSTRAINT `farm_ibfk_1` FOREIGN KEY (`users_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `main_readings`
--
ALTER TABLE `main_readings`
  ADD CONSTRAINT `main_readings_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `device` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `misting_schedule`
--
ALTER TABLE `misting_schedule`
  ADD CONSTRAINT `fk_schedule_farm_gateway` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `node_readings`
--
ALTER TABLE `node_readings`
  ADD CONSTRAINT `node_readings_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `device` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `sensor_thresholds`
--
ALTER TABLE `sensor_thresholds`
  ADD CONSTRAINT `sensor_thresholds_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `user_activity_log`
--
ALTER TABLE `user_activity_log`
  ADD CONSTRAINT `fk_activity_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
