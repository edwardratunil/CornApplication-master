<?php
declare(strict_types=1);

/**
 * Cron-friendly automated misting worker.
 *
 * Logic:
 * - Check farms with automation enabled
 * - Fetch latest sensor readings (temperature, humidity, wind speed)
 * - Check conditions:
 *   - Temperature > temperature_threshold
 *   - Humidity < humidity_threshold
 *   - Wind speed < wind_speed_threshold
 * - If all conditions met:
 *   - Turn Relay 1 and Relay 4 ON for configured duration
 *   - After duration, turn OFF and wait for interval
 *   - After interval, check conditions again
 * - If conditions not met, do not turn relays ON; continue checking periodically
 *
 * Usage (Hostinger cron):
 *   /usr/bin/php -q /home/USERNAME/public_html/server/run_automated_misting.php
 * 
 * Recommended: Run every 1-2 minutes
 */

const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';

const PUSH_SERVICE_URL = '';
const PUSH_SERVICE_API_KEY = '';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $connection = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $connection->set_charset('utf8mb4');
} catch (mysqli_sql_exception $exception) {
    logLine('Failed to connect to database: ' . $exception->getMessage());
    exit(1);
}

try {
    ensureAutomationSettingsTable($connection);
    ensureAutomationStateTable($connection);

    $farms = fetchAutomatedFarms($connection);
    if (empty($farms)) {
        logLine('No farms with automation enabled found.');
        exit(0);
    }

    $processed = 0;
    foreach ($farms as $farm) {
        if (processAutomatedMisting($connection, $farm)) {
            $processed++;
        }
    }

    logLine(sprintf('Automated misting run complete. Farms processed: %d', $processed));
} catch (Throwable $throwable) {
    logLine('Automation error: ' . $throwable->getMessage());
    exit(1);
} finally {
    $connection->close();
}

exit(0);

/**
 * @return array<int, array<string, mixed>>
 */
function fetchAutomatedFarms(mysqli $connection): array
{
    $sql = <<<SQL
        SELECT 
            f.id AS farm_id,
            a.is_automated,
            a.duration_minutes,
            a.interval_minutes
        FROM farm f
        INNER JOIN automation_settings a ON f.id = a.farm_id
        WHERE a.is_automated = 1
    SQL;

    $result = $connection->query($sql);
    $farms = [];
    while ($row = $result->fetch_assoc()) {
        $farms[] = $row;
    }
    $result->close();

    return $farms;
}

/**
 * Returns true when the farm's device relays were changed.
 */
function processAutomatedMisting(mysqli $connection, array $farm): bool
{
    $farmId = (int)$farm['farm_id'];
    $durationMinutes = (int)$farm['duration_minutes'];
    $intervalMinutes = (int)$farm['interval_minutes'];
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));

    // Get main device for this farm
    $mainDevice = fetchMainDevice($connection, $farmId);
    if ($mainDevice === null) {
        logLine(sprintf('Farm %d: No main device found, skipping.', $farmId));
        return false;
    }

    $deviceId = (int)$mainDevice['id'];
    $macAddress = isset($mainDevice['mac_address']) ? (string)$mainDevice['mac_address'] : null;

    // Get or create automation state
    $state = getOrCreateAutomationState($connection, $farmId);

    // Get latest sensor readings
    $sensors = fetchLatestSensorReadings($connection, $farmId);
    
    // Get thresholds
    $thresholds = fetchThresholds($connection, $farmId);

    // If relays are running, check if duration has elapsed
    if ($state['is_running'] === 1 && $state['relays_on_at'] !== null) {
        $relaysOnAt = parseDateTime((string)$state['relays_on_at']);
        if ($relaysOnAt !== null) {
            $endTime = $relaysOnAt->add(new DateInterval('PT' . ($durationMinutes * 60) . 'S'));
            if ($now >= $endTime) {
                // Duration elapsed, turn off relays
                logLine(sprintf('Farm %d: Duration elapsed, turning off relays.', $farmId));
                updateRelays($connection, $deviceId, $macAddress, 0, 0, 0, 0);
                updateAutomationState(
                    $connection,
                    $farmId,
                    null, // relays_on_at
                    $now->add(new DateInterval('PT' . ($intervalMinutes * 60) . 'S'))->format('Y-m-d H:i:s'), // next_check_at
                    $now->format('Y-m-d H:i:s'), // last_checked_at
                    0 // is_running
                );
                return true;
            } else {
                // Relays are still running, don't check conditions yet
                logLine(sprintf('Farm %d: Relays still running (will end at %s).', $farmId, $endTime->format('Y-m-d H:i:s')));
                return false;
            }
        }
    }

    // Check if we should check conditions now (only when relays are not running)
    $shouldCheck = false;
    if ($state['is_running'] === 0) {
        if ($state['next_check_at'] === null) {
            // First time or after interval, check immediately
            $shouldCheck = true;
        } else {
            $nextCheck = parseDateTime((string)$state['next_check_at']);
            if ($nextCheck !== null && $now >= $nextCheck) {
                $shouldCheck = true;
            }
        }
    }

    // Check conditions if it's time
    if ($shouldCheck) {
        $conditionsMet = checkConditions($sensors, $thresholds);
        
        logLine(sprintf(
            'Farm %d: Checking conditions - temp=%.1f (threshold: %.1f), hum=%.1f (threshold: %.1f), wind=%.1f m/s (threshold: %.1f km/h)',
            $farmId,
            $sensors['temperature'] ?? 0,
            $thresholds['temperature'] ?? 0,
            $sensors['humidity'] ?? 0,
            $thresholds['humidity'] ?? 0,
            $sensors['wind_speed'] ?? 0,
            $thresholds['wind_speed'] ?? 0
        ));

        if ($conditionsMet) {
            // Conditions met, turn relays ON
            logLine(sprintf(
                'Farm %d: All conditions met! Turning on relays for %d minutes.',
                $farmId,
                $durationMinutes
            ));
            updateRelays($connection, $deviceId, $macAddress, 1, 0, 0, 1);
            updateAutomationState(
                $connection,
                $farmId,
                $now->format('Y-m-d H:i:s'), // relays_on_at
                null, // next_check_at (will check when duration ends)
                $now->format('Y-m-d H:i:s'), // last_checked_at
                1 // is_running
            );
            return true;
        } else {
            // Conditions not met, schedule next check
            logLine(sprintf(
                'Farm %d: Conditions not met. Next check in %d minutes.',
                $farmId,
                $intervalMinutes
            ));
            updateAutomationState(
                $connection,
                $farmId,
                null, // relays_on_at
                $now->add(new DateInterval('PT' . ($intervalMinutes * 60) . 'S'))->format('Y-m-d H:i:s'), // next_check_at
                $now->format('Y-m-d H:i:s'), // last_checked_at
                0 // is_running
            );
            return false;
        }
    } else {
        // Not time to check yet
        if ($state['next_check_at'] !== null) {
            $nextCheck = parseDateTime((string)$state['next_check_at']);
            if ($nextCheck !== null) {
                $minutesUntilCheck = (int)(($nextCheck->getTimestamp() - $now->getTimestamp()) / 60);
                logLine(sprintf('Farm %d: Waiting for next check in %d minutes.', $farmId, $minutesUntilCheck));
            }
        }
    }

    return false;
}

function checkConditions(array $sensors, array $thresholds): bool
{
    $temperature = $sensors['temperature'] ?? null;
    $humidity = $sensors['humidity'] ?? null;
    $windSpeed = $sensors['wind_speed'] ?? null;

    $tempThreshold = $thresholds['temperature'] ?? 25.0;
    $humidityThreshold = $thresholds['humidity'] ?? 70.0;
    $windThreshold = $thresholds['wind_speed'] ?? 15.0;

    // If any sensor reading is missing, conditions cannot be met
    if ($temperature === null || $humidity === null || $windSpeed === null) {
        logLine(sprintf(
            'Missing sensor data - temp: %s, humidity: %s, wind: %s',
            $temperature === null ? 'NULL' : (string)$temperature,
            $humidity === null ? 'NULL' : (string)$humidity,
            $windSpeed === null ? 'NULL' : (string)$windSpeed
        ));
        return false;
    }

    // Convert wind speed from m/s to km/h (thresholds are stored in km/h)
    $windSpeedKmh = (float)$windSpeed * 3.6; // m/s to km/h

    $tempCheck = (float)$temperature > (float)$tempThreshold;
    $humidityCheck = (float)$humidity < (float)$humidityThreshold;
    $windCheck = $windSpeedKmh < (float)$windThreshold;

    logLine(sprintf(
        'Condition checks - Temp: %.1f > %.1f = %s, Humidity: %.1f < %.1f = %s, Wind: %.2f km/h < %.1f km/h = %s',
        (float)$temperature,
        (float)$tempThreshold,
        $tempCheck ? 'YES' : 'NO',
        (float)$humidity,
        (float)$humidityThreshold,
        $humidityCheck ? 'YES' : 'NO',
        $windSpeedKmh,
        (float)$windThreshold,
        $windCheck ? 'YES' : 'NO'
    ));

    return $tempCheck && $humidityCheck && $windCheck;
}

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

function fetchLatestSensorReadings(mysqli $connection, int $farmId): array
{
    $sensors = [
        'temperature' => null,
        'humidity' => null,
        'wind_speed' => null,
    ];

    // Get main device for wind speed
    $mainDevice = fetchMainDevice($connection, $farmId);
    if ($mainDevice !== null) {
        $deviceId = (int)$mainDevice['id'];
        $stmt = $connection->prepare(
            'SELECT windspeed
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

        if ($reading && $reading['windspeed'] !== null) {
            $sensors['wind_speed'] = (float)$reading['windspeed'];
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
            "SELECT temperature, humidity
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

        if ($nodeReading) {
            if ($nodeReading['temperature'] !== null) {
                $sensors['temperature'] = (float)$nodeReading['temperature'];
            }
            if ($nodeReading['humidity'] !== null) {
                $sensors['humidity'] = (float)$nodeReading['humidity'];
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

    // Return defaults
    return [
        'temperature' => 25.0,
        'humidity' => 70.0,
        'wind_speed' => 15.0,
    ];
}

function getOrCreateAutomationState(mysqli $connection, int $farmId): array
{
    $stmt = $connection->prepare(
        'SELECT relays_on_at, next_check_at, last_checked_at, is_running
         FROM automation_state
         WHERE farm_id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $state = $result->fetch_assoc();
    $stmt->close();

    if ($state) {
        return $state;
    }

    // Create new state
    $insertStmt = $connection->prepare(
        'INSERT INTO automation_state (farm_id, is_running)
         VALUES (?, 0)'
    );
    $insertStmt->bind_param('i', $farmId);
    $insertStmt->execute();
    $insertStmt->close();

    return [
        'relays_on_at' => null,
        'next_check_at' => null,
        'last_checked_at' => null,
        'is_running' => 0,
    ];
}

function updateAutomationState(
    mysqli $connection,
    int $farmId,
    ?string $relaysOnAt,
    ?string $nextCheckAt,
    ?string $lastCheckedAt,
    int $isRunning
): void {
    $stmt = $connection->prepare(
        'INSERT INTO automation_state 
         (farm_id, relays_on_at, next_check_at, last_checked_at, is_running)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         relays_on_at = VALUES(relays_on_at),
         next_check_at = VALUES(next_check_at),
         last_checked_at = VALUES(last_checked_at),
         is_running = VALUES(is_running),
         updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->bind_param('isssi', $farmId, $relaysOnAt, $nextCheckAt, $lastCheckedAt, $isRunning);
    $stmt->execute();
    $stmt->close();
}

function updateRelays(
    mysqli $connection,
    int $deviceId,
    ?string $macAddress,
    int $relay1,
    int $relay2,
    int $relay3,
    int $relay4
): void {
    $updateStmt = $connection->prepare(
        'UPDATE device SET relay_1 = ?, relay_2 = ?, relay_3 = ?, relay_4 = ? WHERE id = ?'
    );
    $updateStmt->bind_param('iiiii', $relay1, $relay2, $relay3, $relay4, $deviceId);
    $updateStmt->execute();
    $updateStmt->close();

    if ($macAddress) {
        publishRelayUpdate($macAddress, [$relay1, $relay2, $relay3, $relay4]);
    }

    logLine(sprintf(
        'Updated device %d (mac %s) relays to [%d,%d,%d,%d]',
        $deviceId,
        $macAddress ?? 'unknown',
        $relay1,
        $relay2,
        $relay3,
        $relay4
    ));
}

function publishRelayUpdate(string $macAddress, array $relayStates): void
{
    if (PUSH_SERVICE_URL === '') {
        return;
    }

    $payload = json_encode([
        'mac' => strtoupper($macAddress),
        'relays' => array_map(static fn($value) => $value ? 1 : 0, $relayStates),
    ]);

    if ($payload === false) {
        return;
    }

    $ch = curl_init(PUSH_SERVICE_URL);
    if ($ch === false) {
        return;
    }

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . PUSH_SERVICE_API_KEY,
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);

    curl_exec($ch);
    curl_close($ch);
}

function parseDateTime(string $value): ?DateTimeImmutable
{
    if ($value === '') {
        return null;
    }

    $trimmed = trim($value);
    $date = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $trimmed, new DateTimeZone('UTC'));
    if ($date instanceof DateTimeImmutable) {
        return $date;
    }

    $timestamp = strtotime($trimmed);
    if ($timestamp === false) {
        return null;
    }

    return (new DateTimeImmutable('@' . $timestamp))->setTimezone(new DateTimeZone('UTC'));
}

function ensureAutomationSettingsTable(mysqli $connection): void
{
    $connection->query(
        'CREATE TABLE IF NOT EXISTS automation_settings (
            id INT NOT NULL AUTO_INCREMENT,
            farm_id INT NOT NULL,
            is_automated TINYINT(1) NOT NULL DEFAULT 0,
            duration_minutes INT NOT NULL DEFAULT 2,
            interval_minutes INT NOT NULL DEFAULT 60,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY farm_id (farm_id),
            CONSTRAINT fk_automation_settings_worker FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function ensureAutomationStateTable(mysqli $connection): void
{
    $connection->query(
        'CREATE TABLE IF NOT EXISTS automation_state (
            id INT NOT NULL AUTO_INCREMENT,
            farm_id INT NOT NULL,
            relays_on_at DATETIME DEFAULT NULL,
            next_check_at DATETIME DEFAULT NULL,
            last_checked_at DATETIME DEFAULT NULL,
            is_running TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY farm_id (farm_id),
            CONSTRAINT fk_automation_state_worker FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function logLine(string $message): void
{
    $timestamp = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    error_log("[automated-misting][$timestamp] $message");
}

