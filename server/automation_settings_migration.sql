-- Migration: Add automation_settings table
-- This table stores automation settings for water misting per farm

CREATE TABLE IF NOT EXISTS `automation_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `farm_id` int(11) NOT NULL,
  `is_automated` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0 = manual, 1 = automated',
  `duration_minutes` int(11) NOT NULL DEFAULT 2 COMMENT 'Duration in minutes for each misting cycle',
  `interval_minutes` int(11) NOT NULL DEFAULT 60 COMMENT 'Interval in minutes between misting cycles',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `farm_id` (`farm_id`),
  CONSTRAINT `automation_settings_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: Add automation_state table
-- This table tracks the current state of automated misting per farm

CREATE TABLE IF NOT EXISTS `automation_state` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `farm_id` int(11) NOT NULL,
  `relays_on_at` datetime DEFAULT NULL COMMENT 'When relays were turned ON',
  `next_check_at` datetime DEFAULT NULL COMMENT 'When to check conditions again',
  `last_checked_at` datetime DEFAULT NULL COMMENT 'Last time conditions were checked',
  `is_running` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Whether misting is currently running',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `farm_id` (`farm_id`),
  CONSTRAINT `automation_state_ibfk_1` FOREIGN KEY (`farm_id`) REFERENCES `farm` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

