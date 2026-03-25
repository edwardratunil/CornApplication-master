-- Alert System Database Schema
-- Add this to your cropmist.sql or run separately

CREATE TABLE IF NOT EXISTS `alert` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `farm_id` int(11) NOT NULL,
  `device_id` int(11) DEFAULT NULL,
  `alert_type` enum(
    'water_low',
    'water_critical',
    'pesticide_low',
    'pesticide_critical',
    'device_offline',
    'device_reconnected',
    'schedule_started',
    'schedule_completed',
    'schedule_failed',
    'temperature_high',
    'temperature_low',
    'humidity_high',
    'humidity_low',
    'wind_high',
    'gps_lost',
    'sensor_error',
    'relay_error',
    'system_error'
  ) NOT NULL,
  `severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `status` enum('active','acknowledged','resolved') NOT NULL DEFAULT 'active',
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `acknowledged_at` timestamp NULL DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `acknowledged_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `farm_id` (`farm_id`),
  KEY `device_id` (`device_id`),
  KEY `alert_type` (`alert_type`),
  KEY `status` (`status`),
  KEY `severity` (`severity`),
  KEY `created_at` (`created_at`),
  CONSTRAINT `alert_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE,
  CONSTRAINT `alert_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `device` (`id`) ON DELETE SET NULL,
  CONSTRAINT `alert_ibfk_3` FOREIGN KEY (`acknowledged_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for efficient querying of active alerts
CREATE INDEX `idx_farm_status_severity` ON `alert` (`farm_id`, `status`, `severity`);

-- Index for device-specific alerts
CREATE INDEX `idx_device_status` ON `alert` (`device_id`, `status`);

