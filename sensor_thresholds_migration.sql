-- Migration: Add sensor_thresholds table
-- This table stores threshold settings for each farm's sensors

CREATE TABLE IF NOT EXISTS `sensor_thresholds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `farm_id` int(11) NOT NULL,
  `water_level_threshold` decimal(10,2) DEFAULT 20.00 COMMENT 'Alert when water level is below this value (cm)',
  `pesticide_level_threshold` decimal(10,2) DEFAULT 20.00 COMMENT 'Alert when pesticide level is below this value (cm)',
  `temperature_threshold` decimal(5,2) DEFAULT 25.00 COMMENT 'Alert when temperature is above this value (°C)',
  `humidity_threshold` decimal(5,2) DEFAULT 70.00 COMMENT 'Alert when humidity is above this value (%)',
  `wind_speed_threshold` decimal(5,2) DEFAULT 15.00 COMMENT 'Alert when wind speed is above this value (km/h)',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `farm_id` (`farm_id`),
  CONSTRAINT `sensor_thresholds_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

