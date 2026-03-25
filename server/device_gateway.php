<?php
declare(strict_types=1);

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Only POST requests are supported.', 405);
}

$rawInput = file_get_contents('php://input');
if ($rawInput === false || $rawInput === '') {
    respondError('Request body is empty.');
}

$payload = json_decode($rawInput, true);
if (!is_array($payload)) {
    respondError('Invalid JSON payload.');
}

$action = $payload['action'] ?? '';

const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';
const DEFAULT_SYNC_INTERVAL = 30;
const DEFAULT_RELAY_FETCH_INTERVAL = 2;
const PUSH_SERVICE_URL = '';
const PUSH_SERVICE_API_KEY = '';
const WATER_DEFAULT_DURATION_SECONDS = 120;
const PESTICIDE_DEFAULT_DURATION_SECONDS = 60;

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $connection = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $connection->set_charset('utf8mb4');
} catch (mysqli_sql_exception $exception) {
    respondError(
        'Database connection failed.',
        500,
        ['error' => $exception->getMessage()]
    );
}

ensureMistingScheduleTable($connection);
ensureAlertTable($connection);
ensureSensorThresholdsTable($connection);

try {
    switch ($action) {
        case 'handshake':
            handleHandshake($connection, $payload);
            break;

        case 'sync':
            handleSync($connection, $payload);
            break;

        case 'fetch_relays':
            handleFetchRelays($connection, $payload);
            break;

        default:
            respondError('Unsupported action.', 400, ['action' => $action]);
    }
} catch (Throwable $throwable) {
    respondError(
        'Internal server error.',
        500,
        ['error' => $throwable->getMessage()]
    );
} finally {
    $connection->close();
}

/**
 * @param array<string, mixed> $payload
 */
function handleHandshake(mysqli $connection, array $payload): void
{
    $macAddress = sanitizeMacAddress($payload['mac_address'] ?? null);
    if ($macAddress === null) {
        respondError('Invalid or missing MAC address.');
    }

    $device = fetchDeviceByMac($connection, $macAddress);
    if ($device === null) {
        respondSuccess([
            'success'     => true,
            'authorized'  => false,
            'message'     => 'Device is not registered. Please add the MAC address on the server.',
            'relay_states'=> [0, 0, 0, 0],
            'poll_interval' => DEFAULT_SYNC_INTERVAL,
            'relay_poll_interval' => DEFAULT_RELAY_FETCH_INTERVAL,
        ]);
    }

    $device = processMistingSchedules($connection, $device);

    updateDeviceHeartbeat($connection, (int)$device['id']);

    $device = processMistingSchedules($connection, $device);
    $relayStates = getRelayStatesFromRow($device);

    respondSuccess([
        'success'       => true,
        'authorized'    => true,
        'message'       => 'Device authorized.',
        'poll_interval' => DEFAULT_SYNC_INTERVAL,
        'relay_poll_interval' => DEFAULT_RELAY_FETCH_INTERVAL,
        'relay_states'  => $relayStates,
    ]);
}

/**
 * @param array<string, mixed> $payload
 */
function handleSync(mysqli $connection, array $payload): void
{
    $macAddress = sanitizeMacAddress($payload['mac_address'] ?? null);
    if ($macAddress === null) {
        respondError('Invalid or missing MAC address.');
    }

    $device = fetchDeviceByMac($connection, $macAddress);
    if ($device === null) {
        respondSuccess([
            'success'     => true,
            'authorized'  => false,
            'message'     => 'Device not registered or disabled.',
            'relay_states'=> [0, 0, 0, 0],
            'poll_interval' => DEFAULT_SYNC_INTERVAL,
            'relay_poll_interval' => DEFAULT_RELAY_FETCH_INTERVAL,
        ]);
    }

    $sensors = $payload['sensors'] ?? [];
    if (!is_array($sensors)) {
        $sensors = [];
    }

    $deviceType = $device['device_type'] ?? 'main';
    
    if ($deviceType === 'node') {
        // Node module sensors: temperature, humidity, GPS coordinates
        $temperature = extractNumeric($sensors, 'temperature_c');
        $humidity = extractNumeric($sensors, 'humidity_percent');
        $latitude = extractNumeric($sensors, 'latitude');
        $longitude = extractNumeric($sensors, 'longitude');
        $flow = extractNumeric($sensors, 'water_flow_lpm');

        // Validate GPS coordinates before storing
        // Reject coordinates that are clearly invalid:
        // - Zero coordinates (0, 0) - indicates no GPS fix
        // - Coordinates outside valid ranges
        // - Coordinates that are clearly wrong (e.g., in ocean far from land)
        if ($latitude !== null && $longitude !== null) {
            // Check if coordinates are zero (no GPS fix)
            if (abs($latitude) < 0.0001 && abs($longitude) < 0.0001) {
                $latitude = null;
                $longitude = null;
            }
            // Validate coordinate ranges
            elseif (!(-90.0 <= $latitude && $latitude <= 90.0) || !(-180.0 <= $longitude && $longitude <= 180.0)) {
                // Invalid coordinate range - don't store
                $latitude = null;
                $longitude = null;
            }
        }

        storeNodeSensorSnapshot(
            $connection,
            (int)$device['id'],
            $temperature,
            $humidity,
            $latitude,
            $longitude,
            $flow
        );
        
        // Real-time temperature alert check (immediately after storing data)
        if ($temperature !== null && isset($device['farm_id']) && $device['farm_id'] !== null) {
            try {
                require_once __DIR__ . '/alert_service.php';
                $thresholds = getSensorThresholds($connection, (int)$device['farm_id']);
                if ($thresholds && $thresholds['temperature_threshold'] !== null) {
                    $threshold = (float)$thresholds['temperature_threshold'];
                    if ($temperature > $threshold) {
                        createAlert(
                            $connection,
                            (int)$device['farm_id'],
                            (int)$device['id'],
                            'temperature_high',
                            ($temperature - $threshold > 10.0) ? 'critical' : 'warning',
                            ($temperature - $threshold > 10.0) ? 'CRITICAL: Temperature Very High' : 'Temperature High',
                            sprintf(
                                'Temperature is %.1f°C, which exceeds the threshold of %.1f°C by %.1f°C. Please take appropriate action.',
                                $temperature,
                                $threshold,
                                $temperature - $threshold
                            ),
                            [
                                'current_temperature' => $temperature,
                                'threshold' => $threshold,
                                'excess' => $temperature - $threshold,
                                'unit' => '°C'
                            ]
                        );
                        error_log(sprintf(
                            "[Alert] ✅ Created temperature alert for farm %d: %.1f°C > %.1f°C",
                            (int)$device['farm_id'],
                            $temperature,
                            $threshold
                        ));
                    }
                }
            } catch (Throwable $e) {
                // Log error but don't break the sync
                error_log("[Alert Error] Temperature alert check failed: " . $e->getMessage());
            }
        }
    } else {
        // Main device sensors: wind, water, pesticide, flow
        $wind = extractNumeric($sensors, 'wind_speed_ms');
        $water = extractNumeric($sensors, 'water_level_cm');
        $pesticide = extractNumeric($sensors, 'pesticide_level_cm');
        $flow = extractNumeric($sensors, 'water_flow_lpm');

        storeSensorSnapshot(
            $connection,
            (int)$device['id'],
            $wind,
            $water,
            $pesticide,
            $flow,
            $sensors
        );
        
        // Real-time wind speed alert check (immediately after storing data)
        if ($wind !== null && isset($device['farm_id']) && $device['farm_id'] !== null) {
            try {
                require_once __DIR__ . '/alert_service.php';
                $thresholds = getSensorThresholds($connection, (int)$device['farm_id']);
                if ($thresholds && $thresholds['wind_speed_threshold'] !== null) {
                    $windKmh = $wind * 3.6; // Convert m/s to km/h
                    $threshold = (float)$thresholds['wind_speed_threshold'];
                    if ($windKmh > $threshold) {
                        createAlert(
                            $connection,
                            (int)$device['farm_id'],
                            (int)$device['id'],
                            'wind_high',
                            ($windKmh - $threshold > 10.0) ? 'critical' : 'warning',
                            ($windKmh - $threshold > 10.0) ? 'CRITICAL: Wind Speed Very High' : 'Wind Speed High',
                            sprintf(
                                'Wind speed is %.1f km/h, which exceeds the threshold of %.1f km/h by %.1f km/h. High winds may affect misting effectiveness.',
                                $windKmh,
                                $threshold,
                                $windKmh - $threshold
                            ),
                            [
                                'current_wind_speed' => $windKmh,
                                'threshold' => $threshold,
                                'excess' => $windKmh - $threshold,
                                'unit' => 'km/h'
                            ]
                        );
                        error_log(sprintf(
                            "[Alert] ✅ Created wind speed alert for farm %d: %.1f km/h > %.1f km/h",
                            (int)$device['farm_id'],
                            $windKmh,
                            $threshold
                        ));
                    }
                }
            } catch (Throwable $e) {
                // Log error but don't break the sync
                error_log("[Alert Error] Wind speed alert check failed: " . $e->getMessage());
            }
        }
    }

    updateDeviceHeartbeat($connection, (int)$device['id']);

    $device = processMistingSchedules($connection, $device);
    $relayStates = getRelayStatesFromRow($device);

    respondSuccess([
        'success'       => true,
        'authorized'    => true,
        'poll_interval' => DEFAULT_SYNC_INTERVAL,
        'relay_poll_interval' => DEFAULT_RELAY_FETCH_INTERVAL,
        'relay_states'  => $relayStates,
    ]);
}

/**
 * @param array<string, mixed> $payload
 */
function handleFetchRelays(mysqli $connection, array $payload): void
{
    $macAddress = sanitizeMacAddress($payload['mac_address'] ?? null);
    if ($macAddress === null) {
        respondError('Invalid or missing MAC address.');
    }

    $device = fetchDeviceByMac($connection, $macAddress);
    if ($device === null) {
        respondSuccess([
            'success'            => true,
            'authorized'         => false,
            'message'            => 'Device not registered or disabled.',
            'relay_states'       => [0, 0, 0, 0],
            'poll_interval'      => DEFAULT_SYNC_INTERVAL,
            'relay_poll_interval'=> DEFAULT_RELAY_FETCH_INTERVAL,
        ]);
    }

    updateDeviceHeartbeat($connection, (int)$device['id']);

    $relayStates = getRelayStatesFromRow($device);

    respondSuccess([
        'success'            => true,
        'authorized'         => true,
        'relay_states'       => $relayStates,
        'poll_interval'      => DEFAULT_SYNC_INTERVAL,
        'relay_poll_interval'=> DEFAULT_RELAY_FETCH_INTERVAL,
    ]);
}

function fetchDeviceByMac(mysqli $connection, string $macAddress): ?array
{
    $statement = $connection->prepare(
        'SELECT id, farm_id, mac_address, device_type, relay_1, relay_2, relay_3, relay_4 FROM device WHERE mac_address = ? LIMIT 1'
    );
    $statement->bind_param('s', $macAddress);
    $statement->execute();
    $result = $statement->get_result();
    $device = $result->fetch_assoc() ?: null;
    $statement->close();

    return $device;
}

function updateDeviceHeartbeat(mysqli $connection, int $deviceId): void
{
    $statement = $connection->prepare(
        'UPDATE device SET created_at = created_at WHERE id = ?'
    );
    $statement->bind_param('i', $deviceId);
    $statement->execute();
    $statement->close();
}

function getRelayStatesFromRow(array $deviceRow): array
{
    return [
        (int)($deviceRow['relay_1'] ?? 0) === 1 ? 1 : 0,
        (int)($deviceRow['relay_2'] ?? 0) === 1 ? 1 : 0,
        (int)($deviceRow['relay_3'] ?? 0) === 1 ? 1 : 0,
        (int)($deviceRow['relay_4'] ?? 0) === 1 ? 1 : 0,
    ];
}

function processMistingSchedules(mysqli $connection, array $deviceRow): array
{
    $farmId = (int)$deviceRow['farm_id'];
    $macAddress = isset($deviceRow['mac_address']) ? (string)$deviceRow['mac_address'] : null;
    $deviceId = (int)$deviceRow['id'];
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));

    $relayStates = [
        'relay_1' => (int)$deviceRow['relay_1'],
        'relay_2' => (int)$deviceRow['relay_2'],
        'relay_3' => (int)$deviceRow['relay_3'],
        'relay_4' => (int)$deviceRow['relay_4'],
    ];

    $updated = false;

    foreach (['water' => 'relay_1', 'pesticide' => 'relay_2'] as $type => $relayKey) {
        $schedule = fetchActiveSchedule($connection, $farmId, $type);
        if ($schedule === null) {
            continue;
        }

        $status = $schedule['status'];
        $scheduleId = (int)$schedule['id'];
        $durationSeconds = (int)$schedule['duration_seconds'] > 0
            ? (int)$schedule['duration_seconds']
            : getDefaultDurationForType($type);

        $scheduledAt = parseScheduleDate((string)$schedule['scheduled_at']);
        if ($scheduledAt === null) {
            continue;
        }

        if ($status === 'pending' && $scheduledAt <= $now) {
            $startedAt = startMistingSchedule($connection, $scheduleId);
            $status = 'running';
            $schedule['started_at'] = $startedAt->format('Y-m-d H:i:s');
        }

        if ($status === 'running') {
            $startedAt = isset($schedule['started_at']) ? parseScheduleDate((string)$schedule['started_at']) : null;
            if ($startedAt === null) {
                $startedAt = startMistingSchedule($connection, $scheduleId);
            }

            $endTime = $startedAt->add(new DateInterval('PT' . $durationSeconds . 'S'));
            if ($now >= $endTime) {
                completeMistingSchedule($connection, $scheduleId);
                if ($relayStates[$relayKey] !== 0) {
                    $relayStates[$relayKey] = 0;
                    $updated = true;
                }
                continue;
            }

            if ($relayStates[$relayKey] !== 1) {
                $relayStates[$relayKey] = 1;
                $updated = true;
            }

            if ($relayKey === 'relay_1' && $relayStates['relay_2'] !== 0) {
                $relayStates['relay_2'] = 0;
                $updated = true;
            } elseif ($relayKey === 'relay_2' && $relayStates['relay_1'] !== 0) {
                $relayStates['relay_1'] = 0;
                $updated = true;
            }
        }
    }

    // Relay 4 (Pump): Automatically ON when Relay 1 (water valve) or Relay 2 (pesticide valve) is ON
    // The pump must run when either valve is open
    $relay4 = ($relayStates['relay_1'] === 1 || $relayStates['relay_2'] === 1) ? 1 : 0;
    if ($relayStates['relay_4'] !== $relay4) {
        $relayStates['relay_4'] = $relay4;
        $updated = true;
    }

    // Relay 3: Not used - ensure it's always OFF
    if ($relayStates['relay_3'] !== 0) {
        $relayStates['relay_3'] = 0;
        $updated = true;
    }

    if ($updated) {
        $updateStmt = $connection->prepare(
            'UPDATE device SET relay_1 = ?, relay_2 = ?, relay_3 = ?, relay_4 = ? WHERE id = ?'
        );
        $updateStmt->bind_param(
            'iiiii',
            $relayStates['relay_1'],
            $relayStates['relay_2'],
            $relayStates['relay_3'],
            $relayStates['relay_4'],
            $deviceId
        );
        $updateStmt->execute();
        $updateStmt->close();

        if ($macAddress) {
            publishRelayUpdate($macAddress, array_values($relayStates));
        }

        $deviceRow['relay_1'] = $relayStates['relay_1'];
        $deviceRow['relay_2'] = $relayStates['relay_2'];
        $deviceRow['relay_3'] = $relayStates['relay_3'];
        $deviceRow['relay_4'] = $relayStates['relay_4'];
    }

    return $deviceRow;
}

function fetchActiveSchedule(mysqli $connection, int $farmId, string $type): ?array
{
    $stmt = $connection->prepare(
        'SELECT id, schedule_type, scheduled_at, duration_seconds, status, started_at
         FROM misting_schedule
         WHERE farm_id = ? AND schedule_type = ? AND status IN ("pending", "running")
         ORDER BY scheduled_at ASC, id ASC
         LIMIT 1'
    );
    $stmt->bind_param('is', $farmId, $type);
    $stmt->execute();
    $result = $stmt->get_result();
    $schedule = $result->fetch_assoc() ?: null;
    $stmt->close();

    return $schedule;
}

function startMistingSchedule(mysqli $connection, int $scheduleId): DateTimeImmutable
{
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $formatted = $now->format('Y-m-d H:i:s');
    $stmt = $connection->prepare(
        'UPDATE misting_schedule
         SET status = "running", started_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?'
    );
    $stmt->bind_param('si', $formatted, $scheduleId);
    $stmt->execute();
    $stmt->close();

    return $now;
}

function completeMistingSchedule(mysqli $connection, int $scheduleId): void
{
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $formatted = $now->format('Y-m-d H:i:s');
    $stmt = $connection->prepare(
        'UPDATE misting_schedule
         SET status = "completed", completed_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?'
    );
    $stmt->bind_param('si', $formatted, $scheduleId);
    $stmt->execute();
    $stmt->close();
}

function getDefaultDurationForType(string $type): int
{
    return $type === 'water' ? WATER_DEFAULT_DURATION_SECONDS : PESTICIDE_DEFAULT_DURATION_SECONDS;
}

function parseScheduleDate(string $value): ?DateTimeImmutable
{
    if ($value === '') {
        return null;
    }

    $trimmed = trim($value);

    $date = DateTimeImmutable::createFromFormat(DateTimeInterface::ATOM, $trimmed);
    if ($date instanceof DateTimeImmutable) {
        return $date->setTimezone(new DateTimeZone('UTC'));
    }

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

function ensureMistingScheduleTable(mysqli $connection): void
{
    $connection->query(
        'CREATE TABLE IF NOT EXISTS misting_schedule (
            id INT NOT NULL AUTO_INCREMENT,
            farm_id INT NOT NULL,
            schedule_type ENUM("water", "pesticide") NOT NULL,
            scheduled_at DATETIME NOT NULL,
            duration_seconds INT NOT NULL DEFAULT 0,
            status ENUM("pending", "running", "completed", "cancelled") NOT NULL DEFAULT "pending",
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            started_at DATETIME DEFAULT NULL,
            completed_at DATETIME DEFAULT NULL,
            created_by INT DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_farm_type_status (farm_id, schedule_type, status),
            CONSTRAINT fk_schedule_farm_gateway FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
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

/**
 * @param array<string, mixed> $sensors
 */
function storeSensorSnapshot(
    mysqli $connection,
    int $deviceId,
    ?float $wind,
    ?float $water,
    ?float $pesticide,
    ?float $flow,
    array $sensors
): void {
    $statement = $connection->prepare(
        'INSERT INTO main_readings
            (device_id, water_level, pesticide_level, windspeed, flow_rate, timestamp)
         VALUES (?, ?, ?, ?, ?, NOW())'
    );

    $statement->bind_param(
        'idddd',
        $deviceId,
        $water,
        $pesticide,
        $wind,
        $flow
    );
    $statement->execute();
    $statement->close();
}

function storeNodeSensorSnapshot(
    mysqli $connection,
    int $deviceId,
    ?float $temperature,
    ?float $humidity,
    ?float $latitude,
    ?float $longitude,
    ?float $flow
): void {
    $statement = $connection->prepare(
        'INSERT INTO node_readings
            (device_id, temperature, humidity, latitude, longitude, flow_rate, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, NOW())'
    );

    $statement->bind_param(
        'iddddd',
        $deviceId,
        $temperature,
        $humidity,
        $latitude,
        $longitude,
        $flow
    );
    $statement->execute();
    $statement->close();
}

function sanitizeMacAddress(?string $mac): ?string
{
    if ($mac === null) {
        return null;
    }

    $mac = strtoupper(trim($mac));
    $mac = str_replace('-', ':', $mac);
    $mac = preg_replace('/[^0-9A-F:]/', '', $mac);

    if ($mac === null) {
        return null;
    }

    $mac = str_replace('::', ':', $mac);
    if (strlen($mac) === 12) {
        $mac = implode(':', str_split($mac, 2));
    }

    if (!preg_match('/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/', $mac)) {
        return null;
    }

    return $mac;
}


/**
 * Ensure alert table exists
 */
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
            CONSTRAINT fk_alert_farm FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE,
            CONSTRAINT fk_alert_device FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE SET NULL,
            CONSTRAINT fk_alert_user FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/**
 * Ensure sensor thresholds table exists
 */
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
            CONSTRAINT fk_thresholds_farm FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/**
 * @param array<string, mixed> $data
 */
function extractNumeric(array $data, string $key): ?float
{
    if (!array_key_exists($key, $data)) {
        return null;
    }

    $value = $data[$key];
    if (is_numeric($value)) {
        return (float)$value;
    }

    return null;
}

function respondError(string $message, int $statusCode = 400, array $extra = []): void
{
    http_response_code($statusCode);
    echo json_encode(array_merge([
        'success' => false,
        'message' => $message,
    ], $extra));
    exit;
}

function respondSuccess(array $payload): void
{
    http_response_code(200);
    echo json_encode($payload);
    exit;
}