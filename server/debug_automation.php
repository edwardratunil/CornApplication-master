<?php
/**
 * Debug script for automated misting
 * 
 * This script helps diagnose why automated misting is not working.
 * Run this manually to check the status of automation for a specific farm.
 * 
 * Usage:
 *   php debug_automation.php <farm_id>
 */

declare(strict_types=1);

const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';

if ($argc < 2) {
    echo "Usage: php debug_automation.php <farm_id>\n";
    exit(1);
}

$farmId = (int)$argv[1];

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $connection = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $connection->set_charset('utf8mb4');
} catch (mysqli_sql_exception $exception) {
    echo "ERROR: Database connection failed: " . $exception->getMessage() . "\n";
    exit(1);
}

// Include required functions
require_once __DIR__ . '/alert_service.php';

// We need to define these functions locally since they're not in a separate file
function fetchMainDevice(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT id, farm_id, mac_address, relay_1, relay_2, relay_3, relay_4
         FROM device
         WHERE farm_id = ? AND device_type = "main"
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $device = $result->fetch_assoc() ?: null;
    $stmt->close();
    return $device;
}

function fetchWaterLevel(mysqli $connection, int $deviceId): ?float
{
    $stmt = $connection->prepare(
        'SELECT water_level
         FROM main_readings
         WHERE device_id = ?
         ORDER BY timestamp DESC
         LIMIT 1'
    );
    $stmt->bind_param('i', $deviceId);
    $stmt->execute();
    $result = $stmt->get_result();
    $reading = $result->fetch_assoc();
    $stmt->close();
    if ($reading && $reading['water_level'] !== null) {
        return (float)$reading['water_level'];
    }
    return null;
}

function fetchWaterLevelThreshold(mysqli $connection, int $farmId): ?float
{
    $stmt = $connection->prepare(
        'SELECT water_level_threshold
         FROM sensor_thresholds
         WHERE farm_id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();
    if ($row && $row['water_level_threshold'] !== null) {
        return (float)$row['water_level_threshold'];
    }
    return 20.0; // Default
}

function fetchLatestSensorReadings(mysqli $connection, int $farmId): array
{
    $sensors = [
        'temperature' => null,
        'humidity' => null,
        'wind_speed' => null,
    ];
    $maxAgeMinutes = 15;
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $maxAge = $now->sub(new DateInterval('PT' . $maxAgeMinutes . 'M'));
    
    // Get main device for wind speed
    $mainDevice = fetchMainDevice($connection, $farmId);
    if ($mainDevice !== null) {
        $deviceId = (int)$mainDevice['id'];
        $stmt = $connection->prepare(
            'SELECT windspeed, timestamp
             FROM main_readings
             WHERE device_id = ?
             ORDER BY timestamp DESC
             LIMIT 1'
        );
        $stmt->bind_param('i', $deviceId);
        $stmt->execute();
        $result = $stmt->get_result();
        $reading = $result->fetch_assoc();
        $stmt->close();
        if ($reading && $reading['windspeed'] !== null && $reading['timestamp'] !== null) {
            $readingTime = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $reading['timestamp'], new DateTimeZone('UTC'));
            if ($readingTime !== null && $readingTime >= $maxAge) {
                $sensors['wind_speed'] = (float)$reading['windspeed'];
            }
        }
    }
    
    // Get node devices for temperature and humidity
    $nodeStmt = $connection->prepare(
        'SELECT id FROM device WHERE farm_id = ? AND device_type = "node"'
    );
    $nodeStmt->bind_param('i', $farmId);
    $nodeStmt->execute();
    $nodeResult = $nodeStmt->get_result();
    $nodeDeviceIds = [];
    while ($row = $nodeResult->fetch_assoc()) {
        $nodeDeviceIds[] = (int)$row['id'];
    }
    $nodeStmt->close();
    
    if (!empty($nodeDeviceIds)) {
        $placeholders = implode(',', array_fill(0, count($nodeDeviceIds), '?'));
        $nodeReadingsStmt = $connection->prepare(
            "SELECT temperature, humidity, timestamp
             FROM node_readings
             WHERE device_id IN ($placeholders)
             ORDER BY timestamp DESC
             LIMIT 1"
        );
        $nodeReadingsStmt->bind_param(str_repeat('i', count($nodeDeviceIds)), ...$nodeDeviceIds);
        $nodeReadingsStmt->execute();
        $nodeReadingsResult = $nodeReadingsStmt->get_result();
        $nodeReading = $nodeReadingsResult->fetch_assoc();
        $nodeReadingsStmt->close();
        if ($nodeReading && $nodeReading['timestamp'] !== null) {
            $readingTime = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $nodeReading['timestamp'], new DateTimeZone('UTC'));
            if ($readingTime !== null && $readingTime >= $maxAge) {
                if ($nodeReading['temperature'] !== null) {
                    $sensors['temperature'] = (float)$nodeReading['temperature'];
                }
                if ($nodeReading['humidity'] !== null) {
                    $sensors['humidity'] = (float)$nodeReading['humidity'];
                }
            }
        }
    }
    return $sensors;
}

function fetchThresholds(mysqli $connection, int $farmId): array
{
    $stmt = $connection->prepare(
        'SELECT temperature_threshold, humidity_threshold, wind_speed_threshold
         FROM sensor_thresholds
         WHERE farm_id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();
    if ($row) {
        return [
            'temperature' => (float)$row['temperature_threshold'],
            'humidity' => (float)$row['humidity_threshold'],
            'wind_speed' => (float)$row['wind_speed_threshold'],
        ];
    }
    return [
        'temperature' => 25.0,
        'humidity' => 70.0,
        'wind_speed' => 15.0,
    ];
}

echo "========================================\n";
echo "AUTOMATED MISTING DEBUG REPORT\n";
echo "Farm ID: $farmId\n";
echo "Time: " . date('Y-m-d H:i:s') . "\n";
echo "========================================\n\n";

// 1. Check if automation is enabled
echo "1. CHECKING AUTOMATION SETTINGS:\n";
$settingsStmt = $connection->prepare(
    'SELECT is_automated, duration_minutes, interval_minutes 
     FROM automation_settings 
     WHERE farm_id = ?'
);
$settingsStmt->bind_param('i', $farmId);
$settingsStmt->execute();
$settingsResult = $settingsStmt->get_result();
$settings = $settingsResult->fetch_assoc();
$settingsStmt->close();

if (!$settings) {
    echo "   ❌ ERROR: No automation_settings found for farm $farmId\n";
    echo "   → Solution: Enable automation in the app settings\n\n";
    exit(1);
}

echo "   ✓ Automation Settings Found:\n";
echo "     - is_automated: " . ($settings['is_automated'] ? 'YES (Enabled)' : 'NO (Disabled)') . "\n";
echo "     - duration_minutes: " . $settings['duration_minutes'] . "\n";
echo "     - interval_minutes: " . $settings['interval_minutes'] . "\n\n";

if (!$settings['is_automated']) {
    echo "   ❌ ERROR: Automation is DISABLED for this farm\n";
    echo "   → Solution: Enable automation in the app\n\n";
    exit(1);
}

// 2. Check automation state
echo "2. CHECKING AUTOMATION STATE:\n";
$stateStmt = $connection->prepare(
    'SELECT relays_on_at, next_check_at, last_checked_at, is_running
     FROM automation_state
     WHERE farm_id = ?'
);
$stateStmt->bind_param('i', $farmId);
$stateStmt->execute();
$stateResult = $stateStmt->get_result();
$state = $stateResult->fetch_assoc();
$stateStmt->close();

if (!$state) {
    echo "   ⚠ WARNING: No automation_state found (will be created on first run)\n\n";
    $state = [
        'relays_on_at' => null,
        'next_check_at' => null,
        'last_checked_at' => null,
        'is_running' => 0
    ];
} else {
    echo "   ✓ Automation State:\n";
    echo "     - is_running: " . ($state['is_running'] ? 'YES' : 'NO') . "\n";
    echo "     - relays_on_at: " . ($state['relays_on_at'] ?? 'NULL') . "\n";
    echo "     - next_check_at: " . ($state['next_check_at'] ?? 'NULL') . "\n";
    echo "     - last_checked_at: " . ($state['last_checked_at'] ?? 'NULL') . "\n";
    
    if ($state['is_running']) {
        echo "   ⚠ INFO: Automation is currently RUNNING\n\n";
    } else if ($state['next_check_at'] !== null) {
        $nextCheck = new DateTime($state['next_check_at']);
        $now = new DateTime();
        $minutesUntilCheck = (int)(($nextCheck->getTimestamp() - $now->getTimestamp()) / 60);
        if ($minutesUntilCheck > 0) {
            echo "   ⚠ INFO: Next check scheduled in $minutesUntilCheck minutes\n";
            echo "   → This is why automation is not checking now\n\n";
        } else {
            echo "   ✓ Next check time has passed - should check on next cron run\n\n";
        }
    } else {
        echo "   ✓ next_check_at is NULL - will check immediately on next cron run\n\n";
    }
}

// 3. Check main device
echo "3. CHECKING MAIN DEVICE:\n";
$mainDevice = fetchMainDevice($connection, $farmId);
if (!$mainDevice) {
    echo "   ❌ ERROR: No main device found for farm $farmId\n";
    echo "   → Solution: Register a main device for this farm\n\n";
    exit(1);
}
echo "   ✓ Main Device Found:\n";
echo "     - Device ID: " . $mainDevice['id'] . "\n";
echo "     - MAC Address: " . ($mainDevice['mac_address'] ?? 'N/A') . "\n";
echo "     - Relays: [" . $mainDevice['relay_1'] . "," . $mainDevice['relay_2'] . "," . $mainDevice['relay_3'] . "," . $mainDevice['relay_4'] . "]\n\n";

// 4. Check water level
echo "4. CHECKING WATER LEVEL:\n";
$waterLevel = fetchWaterLevel($connection, $mainDevice['id']);
$waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
echo "   - Water Level: " . ($waterLevel !== null ? $waterLevel . " cm" : "NULL (No reading)") . "\n";
echo "   - Water Threshold: " . $waterThreshold . " cm\n";
if ($waterLevel === null) {
    echo "   ❌ ERROR: No water level reading available\n";
    echo "   → Solution: Ensure main device is sending water level data\n\n";
} else if ($waterLevel <= $waterThreshold) {
    echo "   ❌ ERROR: Water level ($waterLevel cm) <= threshold ($waterThreshold cm)\n";
    echo "   → Solution: Refill water tank\n\n";
} else {
    echo "   ✓ Water level is OK\n\n";
}

// 5. Check sensor readings
echo "5. CHECKING SENSOR READINGS:\n";
$sensors = fetchLatestSensorReadings($connection, $farmId);
echo "   - Temperature: " . ($sensors['temperature'] !== null ? $sensors['temperature'] . "°C" : "NULL") . "\n";
echo "   - Humidity: " . ($sensors['humidity'] !== null ? $sensors['humidity'] . "%" : "NULL") . "\n";
echo "   - Wind Speed: " . ($sensors['wind_speed'] !== null ? $sensors['wind_speed'] . " m/s (" . ($sensors['wind_speed'] * 3.6) . " km/h)" : "NULL") . "\n\n";

if ($sensors['temperature'] === null || $sensors['humidity'] === null || $sensors['wind_speed'] === null) {
    echo "   ❌ ERROR: Missing sensor data\n";
    if ($sensors['temperature'] === null) echo "     - Temperature reading is missing\n";
    if ($sensors['humidity'] === null) echo "     - Humidity reading is missing\n";
    if ($sensors['wind_speed'] === null) echo "     - Wind speed reading is missing\n";
    echo "   → Solution: Ensure node devices are sending sensor data\n\n";
}

// 6. Check thresholds
echo "6. CHECKING THRESHOLDS:\n";
$thresholds = fetchThresholds($connection, $farmId);
echo "   - Temperature Threshold: " . $thresholds['temperature'] . "°C\n";
echo "   - Humidity Threshold: " . $thresholds['humidity'] . "%\n";
echo "   - Wind Speed Threshold: " . $thresholds['wind_speed'] . " km/h\n\n";

// 7. Check conditions
echo "7. CHECKING CONDITIONS:\n";
if ($sensors['temperature'] === null || $sensors['humidity'] === null || $sensors['wind_speed'] === null) {
    echo "   ❌ Cannot check conditions - missing sensor data\n\n";
} else {
    $tempCheck = (float)$sensors['temperature'] > (float)$thresholds['temperature'];
    $humidityCheck = (float)$sensors['humidity'] < (float)$thresholds['humidity'];
    $windSpeedKmh = (float)$sensors['wind_speed'] * 3.6;
    $windCheck = $windSpeedKmh < (float)$thresholds['wind_speed'];
    
    echo "   - Temperature: " . $sensors['temperature'] . "°C > " . $thresholds['temperature'] . "°C = " . ($tempCheck ? "✓ YES" : "✗ NO") . "\n";
    echo "   - Humidity: " . $sensors['humidity'] . "% < " . $thresholds['humidity'] . "% = " . ($humidityCheck ? "✓ YES" : "✗ NO") . "\n";
    echo "   - Wind Speed: " . number_format($windSpeedKmh, 2) . " km/h < " . $thresholds['wind_speed'] . " km/h = " . ($windCheck ? "✓ YES" : "✗ NO") . "\n";
    
    $allConditionsMet = $tempCheck && $humidityCheck && $windCheck;
    echo "\n   Result: " . ($allConditionsMet ? "✓ ALL CONDITIONS MET" : "✗ CONDITIONS NOT MET") . "\n\n";
    
    if (!$allConditionsMet) {
        echo "   Conditions NOT met because:\n";
        if (!$tempCheck) echo "     - Temperature is too low\n";
        if (!$humidityCheck) echo "     - Humidity is too high\n";
        if (!$windCheck) echo "     - Wind speed is too high\n";
        echo "\n";
    }
}

// 8. Summary
echo "========================================\n";
echo "SUMMARY:\n";
echo "========================================\n";

$issues = [];
if (!$settings['is_automated']) {
    $issues[] = "Automation is disabled";
}
if (!$mainDevice) {
    $issues[] = "No main device found";
}
if ($waterLevel === null) {
    $issues[] = "No water level reading";
} else if ($waterLevel <= $waterThreshold) {
    $issues[] = "Water level too low";
}
if ($sensors['temperature'] === null || $sensors['humidity'] === null || $sensors['wind_speed'] === null) {
    $issues[] = "Missing sensor data";
}
if ($state['next_check_at'] !== null) {
    $nextCheck = new DateTime($state['next_check_at']);
    $now = new DateTime();
    if ($nextCheck > $now) {
        $minutesUntilCheck = (int)(($nextCheck->getTimestamp() - $now->getTimestamp()) / 60);
        $issues[] = "Next check scheduled in $minutesUntilCheck minutes (waiting for interval)";
    }
}

if (empty($issues)) {
    echo "✓ No blocking issues found. Automation should work.\n";
    echo "  If it's still not working, check:\n";
    echo "  1. Is the cron job running? (run_misting_worker.php)\n";
    echo "  2. Check cron job logs for errors\n";
    echo "  3. Verify cron job is running every 1-2 minutes\n";
} else {
    echo "❌ Issues found that prevent automation:\n";
    foreach ($issues as $i => $issue) {
        echo "  " . ($i + 1) . ". $issue\n";
    }
}

echo "\n";

$connection->close();

