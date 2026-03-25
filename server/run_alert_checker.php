<?php
declare(strict_types=1);

/**
 * Alert Checker - Dedicated cron job for checking sensor thresholds and creating alerts
 *
 * This script runs independently to check all farms for temperature, wind speed,
 * humidity, water level, and pesticide level alerts.
 *
 * Usage (Hostinger cron):
 *   /usr/bin/php -q /home/USERNAME/public_html/server/run_alert_checker.php
 * 
 * Recommended: Run every 1-2 minutes
 */

const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $connection = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $connection->set_charset('utf8mb4');
} catch (mysqli_sql_exception $exception) {
    logLine('Failed to connect to database: ' . $exception->getMessage());
    echo "[ERROR] Database connection failed: " . $exception->getMessage() . "\n";
    exit(1);
}

try {
    // Ensure alert table exists
    ensureAlertTable($connection);
    ensureSensorThresholdsTable($connection);

    // Use centralized alert service
    require_once __DIR__ . '/alert_service.php';
    
    $summary = checkAlertsForAllFarms($connection);
    
    // Update user activity status (mark inactive users as offline)
    $activityUpdateResult = updateUserActivityStatus($connection);
    
    $output = sprintf(
        '[%s] Alert check complete. Checked %d farms, created %d alerts. Marked %d users as offline.',
        date('Y-m-d H:i:s'),
        $summary['farms_checked'],
        $summary['total_alerts_created'],
        $activityUpdateResult['users_marked_offline']
    );
    
    logLine($output);
    echo $output . "\n";
    
    // Log details for each farm that had alerts or errors
    foreach ($summary['results'] as $result) {
        if ($result['alerts_created'] > 0 || !empty($result['errors'])) {
            $farmOutput = sprintf(
                '  Farm %d: Created %d alerts',
                $result['farm_id'],
                $result['alerts_created']
            );
            logLine($farmOutput);
            echo $farmOutput . "\n";
            
            foreach ($result['checks_performed'] as $sensor => $check) {
                if ($check['alert_created']) {
                    $checkOutput = sprintf(
                        '    - %s: %s',
                        ucfirst($sensor),
                        $check['message']
                    );
                    logLine($checkOutput);
                    echo $checkOutput . "\n";
                }
            }
            
            if (!empty($result['errors'])) {
                foreach ($result['errors'] as $error) {
                    $errorOutput = sprintf('    ERROR: %s', $error);
                    logLine($errorOutput);
                    echo $errorOutput . "\n";
                }
            }
        }
    }
    
} catch (Throwable $throwable) {
    $error = 'Alert checker error: ' . $throwable->getMessage();
    logLine($error);
    echo "[ERROR] " . $error . "\n";
    exit(1);
} finally {
    $connection->close();
}

exit(0);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ensureAlertTable(mysqli $connection): void
{
    $connection->query(
        'CREATE TABLE IF NOT EXISTS alert (
            id INT NOT NULL AUTO_INCREMENT,
            farm_id INT NOT NULL,
            device_id INT DEFAULT NULL,
            alert_type ENUM(
                "water_low", "water_critical", "pesticide_low", "pesticide_critical",
                "device_offline", "device_reconnected", "schedule_started", "schedule_completed",
                "schedule_failed", "temperature_high", "temperature_low", "humidity_high",
                "humidity_low", "wind_high", "gps_lost", "sensor_error", "relay_error", "system_error"
            ) NOT NULL,
            severity ENUM("info", "warning", "critical") NOT NULL DEFAULT "warning",
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            status ENUM("active", "acknowledged", "resolved") NOT NULL DEFAULT "active",
            metadata JSON DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            acknowledged_at TIMESTAMP NULL DEFAULT NULL,
            resolved_at TIMESTAMP NULL DEFAULT NULL,
            acknowledged_by INT DEFAULT NULL,
            PRIMARY KEY (id),
            KEY farm_id (farm_id),
            KEY device_id (device_id),
            KEY alert_type (alert_type),
            KEY status (status),
            KEY severity (severity),
            KEY created_at (created_at),
            CONSTRAINT fk_alert_farm_checker FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE,
            CONSTRAINT fk_alert_device_checker FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE SET NULL,
            CONSTRAINT fk_alert_user_checker FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function ensureSensorThresholdsTable(mysqli $connection): void
{
    $connection->query(
        'CREATE TABLE IF NOT EXISTS sensor_thresholds (
            id INT NOT NULL AUTO_INCREMENT,
            farm_id INT NOT NULL,
            water_level_threshold DECIMAL(10,2) DEFAULT 20.00,
            pesticide_level_threshold DECIMAL(10,2) DEFAULT 20.00,
            temperature_threshold DECIMAL(5,2) DEFAULT 25.00,
            humidity_threshold DECIMAL(5,2) DEFAULT 70.00,
            wind_speed_threshold DECIMAL(5,2) DEFAULT 15.00,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY farm_id (farm_id),
            CONSTRAINT fk_thresholds_farm_checker FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function logLine(string $message): void
{
    $timestamp = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    error_log("[alert-checker][$timestamp] $message");
}

/**
 * Update user activity status - mark users as offline if inactive for more than 15 minutes
 * 
 * @param mysqli $connection
 * @return array{users_marked_offline: int}
 */
function updateUserActivityStatus(mysqli $connection): array
{
    // Threshold: mark users as offline if inactive for more than 15 seconds
    // Since cron job runs every 1 minute, this ensures users are marked offline
    // within 15-60 seconds of disconnection (depending on when cron runs)
    // Heartbeat sends every 30 seconds with 5-second timeout, so failures are detected quickly
    // Worst case: 60 seconds (if cron just ran), Best case: 15 seconds (if cron runs right after)
    $inactivityThresholdMinutes = 0.25; // 15 seconds
    
    try {
        // Calculate the cutoff time (convert minutes to seconds for precision)
        $cutoffSeconds = (int)($inactivityThresholdMinutes * 60);
        $cutoffTime = date('Y-m-d H:i:s', strtotime('-' . $cutoffSeconds . ' seconds'));
        
        // Update users who are marked as Active but haven't been active recently
        $stmt = $connection->prepare("
            UPDATE users 
            SET activity_status = 'Offline' 
            WHERE activity_status = 'Active' 
            AND (last_active_at IS NULL OR last_active_at < ?)
        ");
        $stmt->bind_param('s', $cutoffTime);
        $stmt->execute();
        $affectedRows = $connection->affected_rows;
        $stmt->close();
        
        return ['users_marked_offline' => $affectedRows];
    } catch (mysqli_sql_exception $exception) {
        logLine('Failed to update user activity status: ' . $exception->getMessage());
        return ['users_marked_offline' => 0];
    }
}

