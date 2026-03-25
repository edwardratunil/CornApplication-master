<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';
const PUSH_SERVICE_URL = '';
const PUSH_SERVICE_API_KEY = '';
const WATER_DEFAULT_DURATION_SECONDS = 120;
const PESTICIDE_DEFAULT_DURATION_SECONDS = 60;
const APP_TIMEZONE = 'Asia/Manila';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $connection = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $connection->set_charset('utf8mb4');
} catch (mysqli_sql_exception $exception) {
    respondError('Database connection failed.', 500, $exception->getMessage());
}

ensureMistingScheduleTable($connection);
ensureSensorThresholdsTable($connection);
ensureAutomationSettingsTable($connection);
ensureAutomationStateTable($connection);
ensureAlertTable($connection);

$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true);

if (!is_array($payload)) {
    respondError('Invalid JSON payload.', 400);
}

$action = strtolower(trim((string)($payload['action'] ?? '')));

try {
    switch ($action) {
        case 'list_farms':
            handleListFarms($connection, $payload);
            break;
        case 'create_farm':
            handleCreateFarm($connection, $payload);
            break;
        case 'update_farm':
            handleUpdateFarm($connection, $payload);
            break;
        case 'delete_farm':
            handleDeleteFarm($connection, $payload);
            break;
        case 'create_module':
            handleCreateModule($connection, $payload);
            break;
        case 'update_module':
            handleUpdateModule($connection, $payload);
            break;
        case 'delete_module':
            handleDeleteModule($connection, $payload);
            break;
        case 'dashboard_snapshot':
            handleDashboardSnapshot($connection, $payload);
            break;
        case 'update_relays':
            handleUpdateRelays($connection, $payload);
            break;
        case 'list_misting_schedules':
            handleListMistingSchedules($connection, $payload);
            break;
        case 'create_misting_schedule':
            handleCreateMistingSchedule($connection, $payload);
            break;
        case 'delete_misting_schedule':
            handleDeleteMistingSchedule($connection, $payload);
            break;
        case 'fetch_thresholds':
            handleFetchThresholds($connection, $payload);
            break;
        case 'update_thresholds':
            handleUpdateThresholds($connection, $payload);
            break;
        case 'fetch_automation_settings':
            handleFetchAutomationSettings($connection, $payload);
            break;
        case 'update_automation_settings':
            handleUpdateAutomationSettings($connection, $payload);
            break;
        case 'fetch_alerts':
            handleFetchAlerts($connection, $payload);
            break;
        case 'acknowledge_alert':
            handleAcknowledgeAlert($connection, $payload);
            break;
        case 'get_unread_alert_count':
            handleGetUnreadAlertCount($connection, $payload);
            break;
        case 'check_alerts_now':
            handleCheckAlertsNow($connection, $payload);
            break;
        case 'fetch_sensor_history':
            handleFetchSensorHistory($connection, $payload);
            break;
        default:
            respondError('Unsupported action.', 400);
    }
} catch (Throwable $throwable) {
    respondError('Internal server error.', 500, $throwable->getMessage());
} finally {
    $connection->close();
}

function handleListFarms(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    if ($userId <= 0) {
        respondError('Valid user_id is required.', 422);
    }

    $stmt = $db->prepare('SELECT id, farm_name, description, created_at FROM farm WHERE users_id = ? ORDER BY created_at DESC, id DESC');
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $result = $stmt->get_result();

    $farms = [];
    $farmIds = [];

    while ($row = $result->fetch_assoc()) {
        $farmId = (int)$row['id'];
        $farmIds[] = $farmId;
        $farms[$farmId] = [
            'id' => $farmId,
            'name' => $row['farm_name'],
            'description' => $row['description'] ?? '',
            'created_at' => $row['created_at'],
            'devices' => [],
        ];
    }

    $stmt->close();

    if (!empty($farmIds)) {
        $idList = implode(',', array_map('intval', $farmIds));
        $deviceQuery = sprintf(
            'SELECT id, farm_id, mac_address, device_name, device_type, relay_1, relay_2, relay_3, relay_4, created_at
             FROM device
             WHERE farm_id IN (%s)
             ORDER BY id ASC',
            $idList
        );
        $deviceResult = $db->query($deviceQuery);
        $nodeDeviceIds = [];
        $deviceRows = [];
        while ($deviceRow = $deviceResult->fetch_assoc()) {
            $deviceRows[] = $deviceRow;
            $deviceType = normalizeDeviceType($deviceRow['device_type'] ?? 'main');
            if ($deviceType === 'node') {
                $nodeDeviceIds[] = (int)$deviceRow['id'];
            }
        }
        $deviceResult->close();

        // Fetch GPS coordinates for node devices
        $nodeGpsData = [];
        if (!empty($nodeDeviceIds)) {
            $placeholders = implode(',', array_fill(0, count($nodeDeviceIds), '?'));
            $gpsStmt = $db->prepare(
                "SELECT device_id, latitude, longitude, timestamp
                 FROM node_readings
                 WHERE device_id IN ($placeholders)
                 ORDER BY device_id, timestamp DESC"
            );
            $gpsStmt->bind_param(str_repeat('i', count($nodeDeviceIds)), ...$nodeDeviceIds);
            $gpsStmt->execute();
            $gpsResult = $gpsStmt->get_result();
            while ($gpsRow = $gpsResult->fetch_assoc()) {
                $deviceId = (int)$gpsRow['device_id'];
                // Only keep the latest reading per device
                if (!isset($nodeGpsData[$deviceId])) {
                    $lat = $gpsRow['latitude'] !== null ? (float)$gpsRow['latitude'] : null;
                    $lon = $gpsRow['longitude'] !== null ? (float)$gpsRow['longitude'] : null;
                    
                    // Validate coordinates before including them
                    // Reject zero coordinates, invalid ranges, or clearly wrong coordinates
                    if ($lat !== null && $lon !== null) {
                        // Check if coordinates are zero (no GPS fix)
                        if (abs($lat) < 0.0001 && abs($lon) < 0.0001) {
                            $lat = null;
                            $lon = null;
                        }
                        // Validate coordinate ranges
                        elseif (!(-90.0 <= $lat && $lat <= 90.0) || !(-180.0 <= $lon && $lon <= 180.0)) {
                            // Invalid coordinate range - don't include
                            $lat = null;
                            $lon = null;
                        }
                    }
                    
                    $nodeGpsData[$deviceId] = [
                        'latitude' => $lat,
                        'longitude' => $lon,
                        'timestamp' => $gpsRow['timestamp'] ?? null,
                    ];
                }
            }
            $gpsStmt->close();
        }

        // Build device list with GPS data
        foreach ($deviceRows as $deviceRow) {
            $farmId = (int)$deviceRow['farm_id'];
            if (!isset($farms[$farmId])) {
                continue;
            }

            $deviceId = (int)$deviceRow['id'];
            $deviceType = normalizeDeviceType($deviceRow['device_type'] ?? 'main');
            $deviceData = [
                'id' => $deviceId,
                'farmId' => $farmId,
                'macAddress' => strtoupper($deviceRow['mac_address'] ?? ''),
                'deviceName' => $deviceRow['device_name'] ?? '',
                'deviceType' => $deviceType,
                'relay1' => (int)($deviceRow['relay_1'] ?? 0),
                'relay2' => (int)($deviceRow['relay_2'] ?? 0),
                'relay3' => (int)($deviceRow['relay_3'] ?? 0),
                'relay4' => (int)($deviceRow['relay_4'] ?? 0),
                'created_at' => $deviceRow['created_at'] ?? null,
            ];

            // Add GPS coordinates for node devices
            if ($deviceType === 'node' && isset($nodeGpsData[$deviceId])) {
                $deviceData['latitude'] = $nodeGpsData[$deviceId]['latitude'];
                $deviceData['longitude'] = $nodeGpsData[$deviceId]['longitude'];
                $deviceData['gpsTimestamp'] = $nodeGpsData[$deviceId]['timestamp'];
            }

            $farms[$farmId]['devices'][] = $deviceData;
        }
    }

    respondSuccess([
        'success' => true,
        'farms' => array_values($farms),
    ]);
}

function handleCreateFarm(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $name = trim((string)($payload['name'] ?? ''));
    $description = trim((string)($payload['description'] ?? ''));

    if ($userId <= 0) {
        respondError('Valid user_id is required.', 422);
    }

    if ($name === '') {
        respondError('Farm name is required.', 422);
    }

    $stmt = $db->prepare('INSERT INTO farm (users_id, farm_name, description) VALUES (?, ?, ?)');
    $stmt->bind_param('iss', $userId, $name, $description);
    $stmt->execute();
    $farmId = $stmt->insert_id;
    $stmt->close();

    // Log farm creation activity
    logUserActivity(
        $db,
        $userId,
        'farm_create',
        "Farm '{$name}' created",
        'farm',
        (int)$farmId,
        ['farm_name' => $name]
    );

    respondSuccess([
        'success' => true,
        'farm' => [
            'id' => (int)$farmId,
            'name' => $name,
            'description' => $description,
            'created_at' => date('Y-m-d H:i:s'),
            'devices' => [],
        ],
    ]);
}

function handleUpdateFarm(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $name = trim((string)($payload['name'] ?? ''));
    $description = trim((string)($payload['description'] ?? ''));

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    if ($name === '') {
        respondError('Farm name is required.', 422);
    }

    $stmt = $db->prepare('SELECT users_id FROM farm WHERE id = ? LIMIT 1');
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $farm = $result->fetch_assoc();
    $stmt->close();

    if (!$farm || (int)$farm['users_id'] !== $userId) {
        respondError('Farm not found.', 404);
    }

    $updateStmt = $db->prepare('UPDATE farm SET farm_name = ?, description = ? WHERE id = ? AND users_id = ?');
    $updateStmt->bind_param('ssii', $name, $description, $farmId, $userId);
    $updateStmt->execute();
    $updateStmt->close();

    // Log farm update activity
    logUserActivity(
        $db,
        $userId,
        'farm_update',
        "Farm '{$name}' updated",
        'farm',
        $farmId,
        ['farm_name' => $name]
    );

    respondSuccess([
        'success' => true,
        'farm' => [
            'id' => $farmId,
            'name' => $name,
            'description' => $description,
        ],
    ]);
}

function handleDeleteFarm(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    $stmt = $db->prepare('DELETE FROM farm WHERE id = ? AND users_id = ?');
    $stmt->bind_param('ii', $farmId, $userId);
    $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if ($affected === 0) {
        respondError('Farm not found or already deleted.', 404);
    }

    // Log farm deletion activity
    logUserActivity(
        $db,
        $userId,
        'farm_delete',
        "Farm ID {$farmId} deleted",
        'farm',
        $farmId
    );

    respondSuccess([
        'success' => true,
        'message' => 'Farm deleted successfully.',
    ]);
}

function handleCreateModule(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $macAddressRaw = (string)($payload['mac_address'] ?? '');
    $deviceName = trim((string)($payload['device_name'] ?? ''));
    $deviceType = normalizeDeviceType($payload['device_type'] ?? 'main');

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    if ($deviceName === '') {
        respondError('Device name is required.', 422);
    }

    $macAddress = sanitizeMacAddress($macAddressRaw);
    if ($macAddress === null) {
        respondError('Invalid MAC address supplied.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    if ($deviceType === 'main') {
        ensureNoOtherMainDevice($db, $farmId);
    }

    ensureMacAddressIsUnique($db, $macAddress);

    $stmt = $db->prepare(
        'INSERT INTO device (farm_id, mac_address, device_name, device_type, relay_1, relay_2, relay_3, relay_4)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0)'
    );
    $stmt->bind_param('isss', $farmId, $macAddress, $deviceName, $deviceType);
    $stmt->execute();
    $deviceId = $stmt->insert_id;
    $stmt->close();

    // Log device creation activity
    logUserActivity(
        $db,
        $userId,
        'device_create',
        "Device '{$deviceName}' ({$deviceType}) created",
        'device',
        (int)$deviceId,
        ['device_name' => $deviceName, 'device_type' => $deviceType, 'mac_address' => $macAddress, 'farm_id' => $farmId]
    );

    respondSuccess([
        'success' => true,
        'device' => [
            'id' => (int)$deviceId,
            'farmId' => $farmId,
            'macAddress' => $macAddress,
            'deviceName' => $deviceName,
            'deviceType' => $deviceType,
            'relay1' => 0,
            'relay2' => 0,
            'relay3' => 0,
            'relay4' => 0,
            'created_at' => date('Y-m-d H:i:s'),
        ],
    ]);
}

function handleUpdateModule(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $deviceId = isset($payload['device_id']) ? (int)$payload['device_id'] : 0;
    $macAddressRaw = (string)($payload['mac_address'] ?? '');
    $deviceName = trim((string)($payload['device_name'] ?? ''));
    $deviceType = normalizeDeviceType($payload['device_type'] ?? 'main');

    if ($userId <= 0 || $deviceId <= 0) {
        respondError('Valid user_id and device_id are required.', 422);
    }

    if ($deviceName === '') {
        respondError('Device name is required.', 422);
    }

    $macAddress = sanitizeMacAddress($macAddressRaw);
    if ($macAddress === null) {
        respondError('Invalid MAC address supplied.', 422);
    }

    $stmt = $db->prepare(
        'SELECT d.id, d.farm_id, f.users_id, d.device_type
         FROM device d
         INNER JOIN farm f ON f.id = d.farm_id
         WHERE d.id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $deviceId);
    $stmt->execute();
    $result = $stmt->get_result();
    $device = $result->fetch_assoc();
    $stmt->close();

    if (!$device || (int)$device['users_id'] !== $userId) {
        respondError('Device not found.', 404);
    }

    ensureMacAddressIsUnique($db, $macAddress, $deviceId);

    if ($deviceType === 'main') {
        ensureNoOtherMainDevice($db, (int)$device['farm_id'], (int)$device['id']);
    }

    $updateStmt = $db->prepare('UPDATE device SET mac_address = ?, device_name = ?, device_type = ? WHERE id = ?');
    $updateStmt->bind_param('sssi', $macAddress, $deviceName, $deviceType, $deviceId);
    $updateStmt->execute();
    $updateStmt->close();

    // Log device update activity
    logUserActivity(
        $db,
        $userId,
        'device_update',
        "Device '{$deviceName}' updated",
        'device',
        $deviceId,
        ['device_name' => $deviceName, 'device_type' => $deviceType, 'mac_address' => $macAddress]
    );

    respondSuccess([
        'success' => true,
        'device' => [
            'id' => $deviceId,
            'farmId' => (int)$device['farm_id'],
            'macAddress' => $macAddress,
            'deviceName' => $deviceName,
            'deviceType' => $deviceType,
        ],
    ]);
}

function handleDeleteModule(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $deviceId = isset($payload['device_id']) ? (int)$payload['device_id'] : 0;

    if ($userId <= 0 || $deviceId <= 0) {
        respondError('Valid user_id and device_id are required.', 422);
    }

    $stmt = $db->prepare(
        'SELECT d.id, f.users_id
         FROM device d
         INNER JOIN farm f ON f.id = d.farm_id
         WHERE d.id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $deviceId);
    $stmt->execute();
    $result = $stmt->get_result();
    $device = $result->fetch_assoc();
    $stmt->close();

    if (!$device || (int)$device['users_id'] !== $userId) {
        respondError('Device not found.', 404);
    }

    $deleteStmt = $db->prepare('DELETE FROM device WHERE id = ?');
    $deleteStmt->bind_param('i', $deviceId);
    $deleteStmt->execute();
    $deleteStmt->close();

    // Log device deletion activity
    logUserActivity(
        $db,
        $userId,
        'device_delete',
        "Device ID {$deviceId} deleted",
        'device',
        $deviceId
    );

    respondSuccess([
        'success' => true,
        'message' => 'Device deleted successfully.',
    ]);
}

function handleDashboardSnapshot(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $relays = [
        'relay1' => 0,
        'relay2' => 0,
        'relay3' => 0,
        'relay4' => 0,
    ];

    $sensors = [
        'water_level_cm' => 0.0,
        'pesticide_level_cm' => 0.0,
        'wind_speed_ms' => 0.0,
        'water_flow_lpm' => 0.0,
        'temperature_c' => 0.0,
        'humidity_percent' => 0.0,
        'timestamp' => null,
    ];

    // Check if farm has any devices at all
    $deviceCheckStmt = $db->prepare(
        'SELECT COUNT(*) as device_count FROM device WHERE farm_id = ?'
    );
    $deviceCheckStmt->bind_param('i', $farmId);
    $deviceCheckStmt->execute();
    $deviceCheckResult = $deviceCheckStmt->get_result();
    $deviceCheckRow = $deviceCheckResult->fetch_assoc();
    $deviceCheckStmt->close();

    // Only fetch sensor data if farm has devices
    if ((int)$deviceCheckRow['device_count'] > 0) {
    $mainDevice = fetchMainDevice($db, $farmId);

    if ($mainDevice !== null) {
        $relays['relay1'] = (int)$mainDevice['relay_1'];
        $relays['relay2'] = (int)$mainDevice['relay_2'];
        $relays['relay3'] = (int)$mainDevice['relay_3'];
        $relays['relay4'] = (int)$mainDevice['relay_4'];

        $readingsStmt = $db->prepare(
            'SELECT water_level, pesticide_level, windspeed, flow_rate, timestamp
             FROM main_readings
             WHERE device_id = ?
             ORDER BY timestamp DESC
             LIMIT 1'
        );
        $deviceId = (int)$mainDevice['id'];
        $readingsStmt->bind_param('i', $deviceId);
        $readingsStmt->execute();
        $result = $readingsStmt->get_result();
        $latest = $result->fetch_assoc();
        $readingsStmt->close();

        if ($latest) {
            if ($latest['water_level'] !== null) {
                $sensors['water_level_cm'] = (float)$latest['water_level'];
            }
            if ($latest['pesticide_level'] !== null) {
                $sensors['pesticide_level_cm'] = (float)$latest['pesticide_level'];
            }
            if ($latest['windspeed'] !== null) {
                $sensors['wind_speed_ms'] = (float)$latest['windspeed'];
            }
            if ($latest['flow_rate'] !== null) {
                $sensors['water_flow_lpm'] = (float)$latest['flow_rate'];
            }
            if (!empty($latest['timestamp'])) {
                $timestampUtc = parseScheduleDate((string)$latest['timestamp']);
                $sensors['timestamp'] = formatAppTime($timestampUtc);
            }
        }
    }

    // Fetch node module data (temperature, humidity, GPS)
    $nodeDevicesStmt = $db->prepare(
        'SELECT id FROM device WHERE farm_id = ? AND device_type = "node"'
    );
    $nodeDevicesStmt->bind_param('i', $farmId);
    $nodeDevicesStmt->execute();
    $nodeResult = $nodeDevicesStmt->get_result();
    $nodeDeviceIds = [];
    while ($row = $nodeResult->fetch_assoc()) {
        $nodeDeviceIds[] = (int)$row['id'];
    }
    $nodeDevicesStmt->close();

    // Aggregate temperature and humidity from all node devices (use latest reading)
    if (!empty($nodeDeviceIds)) {
        $placeholders = implode(',', array_fill(0, count($nodeDeviceIds), '?'));
        $nodeReadingsStmt = $db->prepare(
            "SELECT temperature, humidity, latitude, longitude, timestamp, device_id
             FROM node_readings
             WHERE device_id IN ($placeholders)
             ORDER BY timestamp DESC
             LIMIT 1"
        );
        $nodeReadingsStmt->bind_param(str_repeat('i', count($nodeDeviceIds)), ...$nodeDeviceIds);
        $nodeReadingsStmt->execute();
        $nodeReadingsResult = $nodeReadingsStmt->get_result();
        $latestNodeReading = $nodeReadingsResult->fetch_assoc();
        $nodeReadingsStmt->close();

        if ($latestNodeReading) {
            if ($latestNodeReading['temperature'] !== null) {
                $sensors['temperature_c'] = (float)$latestNodeReading['temperature'];
            }
            if ($latestNodeReading['humidity'] !== null) {
                $sensors['humidity_percent'] = (float)$latestNodeReading['humidity'];
            }
            // Use the latest timestamp if it's newer than main device timestamp
            if (!empty($latestNodeReading['timestamp'])) {
                $nodeTimestampUtc = parseScheduleDate((string)$latestNodeReading['timestamp']);
                $nodeTimestampFormatted = formatAppTime($nodeTimestampUtc);
                // Use node timestamp if main device has no timestamp or node is newer
                if (empty($sensors['timestamp']) || $nodeTimestampFormatted > $sensors['timestamp']) {
                    $sensors['timestamp'] = $nodeTimestampFormatted;
                    }
                }
            }
        }
    }

    $runningSchedules = fetchRunningSchedules($db, $farmId);

    respondSuccess([
        'success' => true,
        'sensors' => $sensors,
        'relays' => $relays,
        'runningSchedules' => $runningSchedules,
    ]);
}

function handleUpdateRelays(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $mainDevice = fetchMainDevice($db, $farmId);
    if ($mainDevice === null) {
        respondError('No main device found for this farm.', 404);
    }

    $deviceId = (int)$mainDevice['id'];
    $currentRelay1 = (int)$mainDevice['relay_1'];
    $currentRelay2 = (int)$mainDevice['relay_2'];
    $currentRelay3 = (int)$mainDevice['relay_3'];
    $currentRelay4 = (int)$mainDevice['relay_4'];

    $relay1 = normalizeRelayValue($payload['relay1'] ?? null, $currentRelay1);
    $relay2 = normalizeRelayValue($payload['relay2'] ?? null, $currentRelay2);
    $relay3 = normalizeRelayValue($payload['relay3'] ?? null, $currentRelay3);

    // Check water level before turning on water misting (relay 1)
    if ($relay1 === 1 && $currentRelay1 === 0) {
        $waterLevel = fetchWaterLevelForDevice($db, $deviceId);
        $waterThreshold = fetchWaterLevelThresholdForFarm($db, $farmId);
        
        // If no water level reading, cannot turn on
        if ($waterLevel === null) {
            respondError(
                'Cannot turn on water misting. No water level reading available. Please ensure the sensor is working properly.',
                422
            );
        }
        
        // Ensure both values are floats for proper comparison
        $waterLevelFloat = (float)$waterLevel;
        $waterThresholdFloat = (float)$waterThreshold;
        
        // If water level is 0 or <= threshold, cannot turn on
        if ($waterLevelFloat <= $waterThresholdFloat) {
            // Water level too low, cannot turn on
            createWaterLowAlertForFarm($db, $farmId, $deviceId, $waterLevelFloat, $waterThresholdFloat);
            respondError(sprintf(
                'Cannot turn on water misting. Water level (%.1f cm) is at or below threshold (%.1f cm). Please refill the water tank.',
                $waterLevelFloat,
                $waterThresholdFloat
            ), 422);
        }
    }

    // Relay 4 (Pump): Automatically ON when Relay 1 (water valve) or Relay 2 (pesticide valve) is ON
    $relay4 = ($relay1 === 1 || $relay2 === 1) ? 1 : 0;

    $updateStmt = $db->prepare('UPDATE device SET relay_1 = ?, relay_2 = ?, relay_3 = ?, relay_4 = ? WHERE id = ?');
    $updateStmt->bind_param('iiiii', $relay1, $relay2, $relay3, $relay4, $deviceId);
    $updateStmt->execute();
    $updateStmt->close();

    $macAddress = $mainDevice['mac_address'] ?? null;
    if (is_string($macAddress) && $macAddress !== '') {
        publishRelayUpdate($macAddress, [$relay1, $relay2, $relay3, $relay4]);
    }

    // Log relay update activity
    $relayChanges = [];
    if ($relay1 !== $currentRelay1) $relayChanges[] = "relay1: {$currentRelay1}→{$relay1}";
    if ($relay2 !== $currentRelay2) $relayChanges[] = "relay2: {$currentRelay2}→{$relay2}";
    if ($relay3 !== $currentRelay3) $relayChanges[] = "relay3: {$currentRelay3}→{$relay3}";
    if ($relay4 !== $currentRelay4) $relayChanges[] = "relay4: {$currentRelay4}→{$relay4}";
    
    if (!empty($relayChanges)) {
        logUserActivity(
            $db,
            $userId,
            'relay_update',
            'Relay states updated: ' . implode(', ', $relayChanges),
            'device',
            $deviceId,
            [
                'farm_id' => $farmId,
                'relay1' => $relay1,
                'relay2' => $relay2,
                'relay3' => $relay3,
                'relay4' => $relay4,
                'previous_relay1' => $currentRelay1,
                'previous_relay2' => $currentRelay2,
                'previous_relay3' => $currentRelay3,
                'previous_relay4' => $currentRelay4
            ]
        );
    }

    respondSuccess([
        'success' => true,
        'relays' => [
            'relay1' => $relay1,
            'relay2' => $relay2,
            'relay3' => $relay3,
            'relay4' => $relay4,
        ],
    ]);
}

function handleListMistingSchedules(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $stmt = $db->prepare(
        'SELECT id, farm_id, schedule_type, scheduled_at, duration_seconds, status, started_at, completed_at, created_at, updated_at
         FROM misting_schedule
         WHERE farm_id = ?
         ORDER BY scheduled_at ASC, id ASC'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();

    $schedules = [];
    while ($row = $result->fetch_assoc()) {
        $schedules[] = normalizeScheduleRow($row);
    }
    $stmt->close();

    respondSuccess([
        'success' => true,
        'schedules' => $schedules,
    ]);
}

function handleCreateMistingSchedule(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $typeRaw = isset($payload['schedule_type']) ? strtolower(trim((string)$payload['schedule_type'])) : '';
    $scheduledRaw = isset($payload['scheduled_at']) ? (string)$payload['scheduled_at'] : '';
    $durationMinutes = isset($payload['duration_minutes']) ? (int)$payload['duration_minutes'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    $type = in_array($typeRaw, ['water', 'pesticide'], true) ? $typeRaw : null;
    if ($type === null) {
        respondError('Invalid schedule type. Use "water" or "pesticide".', 422);
    }

    $scheduledAt = parseScheduleDate($scheduledRaw);
    if ($scheduledAt === null) {
        respondError('Invalid scheduled_at value. Provide an ISO 8601 date-time string.', 422);
    }

    $defaultDuration = $type === 'water' ? WATER_DEFAULT_DURATION_SECONDS : PESTICIDE_DEFAULT_DURATION_SECONDS;
    if ($durationMinutes <= 0) {
        $durationMinutes = (int)round($defaultDuration / 60);
    }
    $durationSeconds = max(60, $durationMinutes * 60);

    ensureFarmOwnership($db, $farmId, $userId);

    if (scheduleExistsAtTime($db, $farmId, $scheduledAt)) {
        respondError('A misting schedule already exists at that time.', 409);
    }

    $stmt = $db->prepare(
        'INSERT INTO misting_schedule (farm_id, schedule_type, scheduled_at, duration_seconds, status, created_by)
         VALUES (?, ?, ?, ?, "pending", ?)'
    );
    $scheduledUtc = $scheduledAt->format('Y-m-d H:i:s');
    $createdBy = $userId;
    $stmt->bind_param('issii', $farmId, $type, $scheduledUtc, $durationSeconds, $createdBy);
    $stmt->execute();
    $scheduleId = $stmt->insert_id;
    $stmt->close();

    $query = $db->prepare(
        'SELECT id, farm_id, schedule_type, scheduled_at, duration_seconds, status, started_at, completed_at, created_at, updated_at
         FROM misting_schedule
         WHERE id = ?
         LIMIT 1'
    );
    $query->bind_param('i', $scheduleId);
    $query->execute();
    $result = $query->get_result();
    $schedule = $result->fetch_assoc();
    $query->close();

    // Log schedule creation activity
    $scheduledAtFormatted = $scheduledAt->format('Y-m-d H:i:s');
    logUserActivity(
        $db,
        $userId,
        'schedule_create',
        "Misting schedule created: {$type} at {$scheduledAtFormatted}",
        'schedule',
        (int)$scheduleId,
        [
            'schedule_type' => $type,
            'scheduled_at' => $scheduledAtFormatted,
            'duration_seconds' => $durationSeconds,
            'farm_id' => $farmId
        ]
    );

    respondSuccess([
        'success' => true,
        'schedule' => normalizeScheduleRow($schedule ?: []),
    ]);
}

function handleDeleteMistingSchedule(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $scheduleId = isset($payload['schedule_id']) ? (int)$payload['schedule_id'] : 0;

    if ($userId <= 0 || $farmId <= 0 || $scheduleId <= 0) {
        respondError('Valid user_id, farm_id, and schedule_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $stmt = $db->prepare(
        'UPDATE misting_schedule
         SET status = "cancelled", updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND farm_id = ?'
    );
    $stmt->bind_param('ii', $scheduleId, $farmId);
    $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if ($affected === 0) {
        respondError('Schedule not found.', 404);
    }

    // Log schedule deletion activity
    logUserActivity(
        $db,
        $userId,
        'schedule_delete',
        "Misting schedule ID {$scheduleId} cancelled",
        'schedule',
        $scheduleId,
        ['farm_id' => $farmId]
    );

    respondSuccess([
        'success' => true,
        'message' => 'Schedule cancelled.',
    ]);
}

function ensureMistingScheduleTable(mysqli $db): void
{
    $db->query(
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
            CONSTRAINT fk_schedule_farm FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function ensureSensorThresholdsTable(mysqli $db): void
{
    $db->query(
        'CREATE TABLE IF NOT EXISTS sensor_thresholds (
            id INT NOT NULL AUTO_INCREMENT,
            farm_id INT NOT NULL,
            water_level_threshold DECIMAL(10,2) DEFAULT 20.00,
            pesticide_level_threshold DECIMAL(10,2) DEFAULT 20.00,
            temperature_threshold DECIMAL(5,2) DEFAULT 30.00,
            humidity_threshold DECIMAL(5,2) DEFAULT 60.00,
            wind_speed_threshold DECIMAL(5,2) DEFAULT 10.00,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY farm_id (farm_id),
            CONSTRAINT fk_thresholds_farm FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function handleFetchThresholds(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $stmt = $db->prepare(
        'SELECT water_level_threshold, pesticide_level_threshold, temperature_threshold, 
                humidity_threshold, wind_speed_threshold
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
        respondSuccess([
            'success' => true,
            'thresholds' => [
                'waterLevelThreshold' => (float)$row['water_level_threshold'],
                'pesticideLevelThreshold' => (float)$row['pesticide_level_threshold'],
                'temperatureThreshold' => (float)$row['temperature_threshold'],
                'humidityThreshold' => (float)$row['humidity_threshold'],
                'windSpeedThreshold' => (float)$row['wind_speed_threshold'],
            ],
        ]);
    } else {
        // Return defaults if no thresholds exist yet
        respondSuccess([
            'success' => true,
            'thresholds' => [
                'waterLevelThreshold' => 20.0,
                'pesticideLevelThreshold' => 20.0,
                'temperatureThreshold' => 30.0,
                'humidityThreshold' => 60.0,
                'windSpeedThreshold' => 10.0,
            ],
        ]);
    }
}

function handleUpdateThresholds(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $waterLevel = isset($payload['water_level_threshold']) ? (float)$payload['water_level_threshold'] : null;
    $pesticideLevel = isset($payload['pesticide_level_threshold']) ? (float)$payload['pesticide_level_threshold'] : null;
    $temperature = isset($payload['temperature_threshold']) ? (float)$payload['temperature_threshold'] : null;
    $humidity = isset($payload['humidity_threshold']) ? (float)$payload['humidity_threshold'] : null;
    $windSpeed = isset($payload['wind_speed_threshold']) ? (float)$payload['wind_speed_threshold'] : null;

    // Check if thresholds exist
    $checkStmt = $db->prepare('SELECT id FROM sensor_thresholds WHERE farm_id = ? LIMIT 1');
    $checkStmt->bind_param('i', $farmId);
    $checkStmt->execute();
    $checkResult = $checkStmt->get_result();
    $exists = $checkResult->fetch_assoc() !== null;
    $checkStmt->close();

    if ($exists) {
        // Update existing thresholds
        $updateFields = [];
        $updateParams = [];
        $types = '';

        if ($waterLevel !== null) {
            $updateFields[] = 'water_level_threshold = ?';
            $updateParams[] = $waterLevel;
            $types .= 'd';
        }
        if ($pesticideLevel !== null) {
            $updateFields[] = 'pesticide_level_threshold = ?';
            $updateParams[] = $pesticideLevel;
            $types .= 'd';
        }
        if ($temperature !== null) {
            $updateFields[] = 'temperature_threshold = ?';
            $updateParams[] = $temperature;
            $types .= 'd';
        }
        if ($humidity !== null) {
            $updateFields[] = 'humidity_threshold = ?';
            $updateParams[] = $humidity;
            $types .= 'd';
        }
        if ($windSpeed !== null) {
            $updateFields[] = 'wind_speed_threshold = ?';
            $updateParams[] = $windSpeed;
            $types .= 'd';
        }

        if (empty($updateFields)) {
            respondError('At least one threshold value must be provided.', 422);
        }

        $updateParams[] = $farmId;
        $types .= 'i';

        $updateSql = 'UPDATE sensor_thresholds SET ' . implode(', ', $updateFields) . ' WHERE farm_id = ?';
        $updateStmt = $db->prepare($updateSql);
        $updateStmt->bind_param($types, ...$updateParams);
        $updateStmt->execute();
        $updateStmt->close();
    } else {
        // Insert new thresholds with defaults for unspecified values
        $insertStmt = $db->prepare(
            'INSERT INTO sensor_thresholds 
             (farm_id, water_level_threshold, pesticide_level_threshold, temperature_threshold, 
              humidity_threshold, wind_speed_threshold)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $insertWater = $waterLevel !== null ? $waterLevel : 20.0;
        $insertPesticide = $pesticideLevel !== null ? $pesticideLevel : 20.0;
        $insertTemp = $temperature !== null ? $temperature : 30.0;
        $insertHumidity = $humidity !== null ? $humidity : 60.0;
        $insertWind = $windSpeed !== null ? $windSpeed : 10.0;
        $insertStmt->bind_param('iddddd', $farmId, $insertWater, $insertPesticide, $insertTemp, $insertHumidity, $insertWind);
        $insertStmt->execute();
        $insertStmt->close();
    }

    // Log threshold update activity
    $updatedThresholds = [];
    if ($waterLevel !== null) $updatedThresholds['water_level'] = $waterLevel;
    if ($pesticideLevel !== null) $updatedThresholds['pesticide_level'] = $pesticideLevel;
    if ($temperature !== null) $updatedThresholds['temperature'] = $temperature;
    if ($humidity !== null) $updatedThresholds['humidity'] = $humidity;
    if ($windSpeed !== null) $updatedThresholds['wind_speed'] = $windSpeed;
    
    if (!empty($updatedThresholds)) {
        logUserActivity(
            $db,
            $userId,
            'threshold_update',
            'Sensor thresholds updated',
            'farm',
            $farmId,
            array_merge(['updated_thresholds' => array_keys($updatedThresholds)], $updatedThresholds)
        );
    }

    // Fetch and return updated thresholds
    handleFetchThresholds($db, $payload);
}

function ensureAutomationSettingsTable(mysqli $db): void
{
    $db->query(
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
            CONSTRAINT fk_automation_settings_farm FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function ensureAutomationStateTable(mysqli $db): void
{
    $db->query(
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
            CONSTRAINT fk_automation_state_farm FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function handleFetchAutomationSettings(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $stmt = $db->prepare(
        'SELECT is_automated, duration_minutes, interval_minutes
         FROM automation_settings
         WHERE farm_id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    if ($row) {
        respondSuccess([
            'success' => true,
            'settings' => [
                'isAutomated' => (bool)$row['is_automated'],
                'durationMinutes' => (int)$row['duration_minutes'],
                'intervalMinutes' => (int)$row['interval_minutes'],
            ],
        ]);
    } else {
        // Return defaults if no settings exist yet
        respondSuccess([
            'success' => true,
            'settings' => [
                'isAutomated' => false,
                'durationMinutes' => 2,
                'intervalMinutes' => 60,
            ],
        ]);
    }
}

function handleUpdateAutomationSettings(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $isAutomated = isset($payload['is_automated']) ? (bool)$payload['is_automated'] : null;
    $durationMinutes = isset($payload['duration_minutes']) ? (int)$payload['duration_minutes'] : null;
    $intervalMinutes = isset($payload['interval_minutes']) ? (int)$payload['interval_minutes'] : null;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('Valid user_id and farm_id are required.', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    if ($durationMinutes !== null && ($durationMinutes < 1 || $durationMinutes > 240)) {
        respondError('Duration must be between 1 and 240 minutes.', 422);
    }

    if ($intervalMinutes !== null && ($intervalMinutes < 1 || $intervalMinutes > 1440)) {
        respondError('Interval must be between 1 and 1440 minutes.', 422);
    }

    if ($durationMinutes !== null && $intervalMinutes !== null && $intervalMinutes < $durationMinutes) {
        respondError('Interval must be greater than or equal to duration.', 422);
    }

    $checkStmt = $db->prepare('SELECT id FROM automation_settings WHERE farm_id = ? LIMIT 1');
    $checkStmt->bind_param('i', $farmId);
    $checkStmt->execute();
    $checkResult = $checkStmt->get_result();
    $exists = $checkResult->fetch_assoc() !== null;
    $checkStmt->close();

    if ($exists) {
        // Update existing settings
        $updateFields = [];
        $updateParams = [];
        $types = '';

        if ($isAutomated !== null) {
            $updateFields[] = 'is_automated = ?';
            $updateParams[] = $isAutomated ? 1 : 0;
            $types .= 'i';
        }
        if ($durationMinutes !== null) {
            $updateFields[] = 'duration_minutes = ?';
            $updateParams[] = $durationMinutes;
            $types .= 'i';
        }
        if ($intervalMinutes !== null) {
            $updateFields[] = 'interval_minutes = ?';
            $updateParams[] = $intervalMinutes;
            $types .= 'i';
        }

        if (empty($updateFields)) {
            respondError('At least one setting value must be provided.', 422);
        }

        $updateParams[] = $farmId;
        $types .= 'i';

        $updateSql = 'UPDATE automation_settings SET ' . implode(', ', $updateFields) . ' WHERE farm_id = ?';
        $updateStmt = $db->prepare($updateSql);
        $updateStmt->bind_param($types, ...$updateParams);
        $updateStmt->execute();
        $updateStmt->close();
    } else {
        // Insert new settings with defaults for unspecified values
        $insertStmt = $db->prepare(
            'INSERT INTO automation_settings 
             (farm_id, is_automated, duration_minutes, interval_minutes)
             VALUES (?, ?, ?, ?)'
        );
        $insertIsAutomated = $isAutomated !== null ? ($isAutomated ? 1 : 0) : 0;
        $insertDuration = $durationMinutes !== null ? $durationMinutes : 2;
        $insertInterval = $intervalMinutes !== null ? $intervalMinutes : 60;
        $insertStmt->bind_param('iiii', $farmId, $insertIsAutomated, $insertDuration, $insertInterval);
        $insertStmt->execute();
        $insertStmt->close();
    }

    // If automation is enabled, reset next_check_at to NULL so it checks immediately on next cron run
    if ($isAutomated === true) {
        // Ensure automation_state exists
        $ensureStateStmt = $db->prepare(
            'INSERT INTO automation_state (farm_id, is_running, next_check_at)
             VALUES (?, 0, NULL)
             ON DUPLICATE KEY UPDATE
             next_check_at = NULL,
             is_running = 0'
        );
        $ensureStateStmt->bind_param('i', $farmId);
        $ensureStateStmt->execute();
        $ensureStateStmt->close();
        
        error_log(sprintf('[Automation] Farm %d: Automation enabled - reset next_check_at to NULL for immediate check on next cron run.', $farmId));
    }

    // If automation is disabled, clear the automation state and turn off relays if running
    if ($isAutomated === false) {
        // Check if automation is currently running
        $stateStmt = $db->prepare(
            'SELECT is_running FROM automation_state WHERE farm_id = ? LIMIT 1'
        );
        $stateStmt->bind_param('i', $farmId);
        $stateStmt->execute();
        $stateResult = $stateStmt->get_result();
        $state = $stateResult->fetch_assoc();
        $stateStmt->close();
        
        $isRunning = $state && (int)$state['is_running'] === 1;
        
        // Clear automation state
        $clearStmt = $db->prepare(
            'UPDATE automation_state 
             SET relays_on_at = NULL, next_check_at = NULL, is_running = 0 
             WHERE farm_id = ?'
        );
        $clearStmt->bind_param('i', $farmId);
        $clearStmt->execute();
        $clearStmt->close();
        
        // If automation was running, turn off the relays (Relay 1 and Relay 4)
        if ($isRunning) {
            $mainDevice = fetchMainDevice($db, $farmId);
            if ($mainDevice !== null) {
                $deviceId = (int)$mainDevice['id'];
                $currentRelay1 = (int)$mainDevice['relay_1'];
                $currentRelay2 = (int)$mainDevice['relay_2'];
                $currentRelay3 = (int)$mainDevice['relay_3'];
                $currentRelay4 = (int)$mainDevice['relay_4'];
                
                // Turn off Relay 1 and Relay 4 (keep Relay 2 and 3 as they were)
                $newRelay1 = 0;
                $newRelay4 = ($currentRelay2 === 1) ? 1 : 0; // Keep Relay 4 ON only if Relay 2 (pesticide) is ON
                
                $updateStmt = $db->prepare('UPDATE device SET relay_1 = ?, relay_4 = ? WHERE id = ?');
                $updateStmt->bind_param('iii', $newRelay1, $newRelay4, $deviceId);
                $updateStmt->execute();
                $updateStmt->close();
                
                // Push update to ESP32
                $macAddress = $mainDevice['mac_address'] ?? null;
                if (is_string($macAddress) && $macAddress !== '') {
                    publishRelayUpdate($macAddress, [$newRelay1, $currentRelay2, $currentRelay3, $newRelay4]);
                }
            }
        }
    }

    // Fetch and return updated settings
    handleFetchAutomationSettings($db, $payload);
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

function formatAppTime(?DateTimeImmutable $dateTime): ?string
{
    if (!$dateTime instanceof DateTimeImmutable) {
        return null;
    }

    try {
        $timezone = new DateTimeZone(APP_TIMEZONE);
    } catch (Exception $exception) {
        $timezone = new DateTimeZone('UTC');
    }

    return $dateTime->setTimezone($timezone)->format(DateTimeInterface::ATOM);
}

function normalizeScheduleRow(?array $row): array
{
    if (!$row) {
        return [];
    }

    $scheduledAt = isset($row['scheduled_at']) ? parseScheduleDate((string)$row['scheduled_at']) : null;
    $startedAt = isset($row['started_at']) && $row['started_at'] !== null
        ? parseScheduleDate((string)$row['started_at'])
        : null;
    $completedAt = isset($row['completed_at']) && $row['completed_at'] !== null
        ? parseScheduleDate((string)$row['completed_at'])
        : null;

    return [
        'id' => (int)$row['id'],
        'farmId' => (int)$row['farm_id'],
        'scheduleType' => $row['schedule_type'],
        'scheduledAt' => formatAppTime($scheduledAt),
        'durationSeconds' => (int)$row['duration_seconds'],
        'durationMinutes' => (int)round(((int)$row['duration_seconds']) / 60),
        'status' => $row['status'],
        'startedAt' => formatAppTime($startedAt),
        'completedAt' => formatAppTime($completedAt),
        'timezone' => APP_TIMEZONE,
        'createdAt' => isset($row['created_at']) ? (string)$row['created_at'] : null,
        'updatedAt' => isset($row['updated_at']) ? (string)$row['updated_at'] : null,
    ];
}

/**
 * @return array<int, array<string, mixed>>
 */
function fetchRunningSchedules(mysqli $db, int $farmId): array
{
    $stmt = $db->prepare(
        'SELECT id, farm_id, schedule_type, scheduled_at, duration_seconds, status, started_at, completed_at, created_at, updated_at
         FROM misting_schedule
         WHERE farm_id = ? AND status = "running"
         ORDER BY scheduled_at ASC, id ASC'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();

    $schedules = [];
    while ($row = $result->fetch_assoc()) {
        $schedules[] = normalizeScheduleRow($row);
    }
    $stmt->close();

    return $schedules;
}

function scheduleExistsAtTime(mysqli $db, int $farmId, DateTimeImmutable $scheduledAt): bool
{
    $scheduledUtc = $scheduledAt->format('Y-m-d H:i:s');
    $stmt = $db->prepare(
        'SELECT id
         FROM misting_schedule
         WHERE farm_id = ? AND scheduled_at = ? AND status IN ("pending", "running")
         LIMIT 1'
    );
    $stmt->bind_param('is', $farmId, $scheduledUtc);
    $stmt->execute();
    $stmt->store_result();
    $exists = $stmt->num_rows > 0;
    $stmt->close();

    return $exists;
}

function ensureFarmOwnership(mysqli $db, int $farmId, int $userId): void
{
    $stmt = $db->prepare('SELECT users_id FROM farm WHERE id = ? LIMIT 1');
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $farm = $result->fetch_assoc();
    $stmt->close();

    if (!$farm || (int)$farm['users_id'] !== $userId) {
        respondError('Farm not found.', 404);
    }
}

function ensureMacAddressIsUnique(mysqli $db, string $macAddress, int $ignoreDeviceId = 0): void
{
    if ($ignoreDeviceId > 0) {
        $stmt = $db->prepare('SELECT id FROM device WHERE mac_address = ? AND id <> ? LIMIT 1');
        $stmt->bind_param('si', $macAddress, $ignoreDeviceId);
    } else {
        $stmt = $db->prepare('SELECT id FROM device WHERE mac_address = ? LIMIT 1');
        $stmt->bind_param('s', $macAddress);
    }

    $stmt->execute();
    $stmt->store_result();
    $exists = $stmt->num_rows > 0;
    $stmt->close();

    if ($exists) {
        respondError('MAC address already registered to another device.', 409);
    }
}

function ensureNoOtherMainDevice(mysqli $db, int $farmId, int $ignoreDeviceId = 0): void
{
    if ($ignoreDeviceId > 0) {
        $stmt = $db->prepare("SELECT id FROM device WHERE farm_id = ? AND device_type = 'main' AND id <> ? LIMIT 1");
        $stmt->bind_param('ii', $farmId, $ignoreDeviceId);
    } else {
        $stmt = $db->prepare("SELECT id FROM device WHERE farm_id = ? AND device_type = 'main' LIMIT 1");
        $stmt->bind_param('i', $farmId);
    }

    $stmt->execute();
    $stmt->store_result();
    $exists = $stmt->num_rows > 0;
    $stmt->close();

    if ($exists) {
        respondError('A main device is already registered for this farm.', 409);
    }
}

function fetchMainDevice(mysqli $db, int $farmId): ?array
{
    $stmt = $db->prepare(
        "SELECT id, mac_address, relay_1, relay_2, relay_3, relay_4
         FROM device
         WHERE farm_id = ? AND device_type = 'main'
         LIMIT 1"
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $device = $result->fetch_assoc() ?: null;
    $stmt->close();

    return $device;
}

function normalizeRelayValue($value, int $fallback = 0): int
{
    if ($value === null) {
        return $fallback === 1 ? 1 : 0;
    }

    if (is_bool($value)) {
        return $value ? 1 : 0;
    }

    if (is_numeric($value)) {
        return ((int)$value) === 1 ? 1 : 0;
    }

    $stringValue = strtolower(trim((string)$value));
    if (in_array($stringValue, ['1', 'true', 'on', 'yes'], true)) {
        return 1;
    }

    if (in_array($stringValue, ['0', 'false', 'off', 'no'], true)) {
        return 0;
    }

    return $fallback === 1 ? 1 : 0;
}

function fetchWaterLevelForDevice(mysqli $db, int $deviceId): ?float
{
    $stmt = $db->prepare(
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

function fetchWaterLevelThresholdForFarm(mysqli $db, int $farmId): ?float
{
    $stmt = $db->prepare(
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

    // Return default threshold (20.0 cm)
    return 20.0;
}

function createWaterLowAlertForFarm(mysqli $db, int $farmId, int $deviceId, float $waterLevel, float $threshold): void
{
    // Ensure alert table exists
    ensureAlertTable($db);
    
    // Check if an active alert of this type already exists for this farm
    $checkStmt = $db->prepare(
        'SELECT id FROM alert 
         WHERE farm_id = ? AND alert_type IN ("water_low", "water_critical") AND status = "active"
         LIMIT 1'
    );
    $checkStmt->bind_param('i', $farmId);
    $checkStmt->execute();
    $result = $checkStmt->get_result();
    $existing = $result->fetch_assoc();
    $checkStmt->close();

    // If alert already exists, don't create duplicate
    if ($existing) {
        return;
    }

    // Determine severity based on how low the water level is
    $severity = ($waterLevel <= ($threshold * 0.5)) ? 'critical' : 'warning';
    $alertType = ($waterLevel <= ($threshold * 0.5)) ? 'water_critical' : 'water_low';
    
    $title = $severity === 'critical' 
        ? 'CRITICAL: Water Level Critically Low'
        : 'Water Level Low';
    
    $message = sprintf(
        'Water level is %s (%.1f cm). Threshold: %.1f cm. Please refill the water tank immediately.',
        $severity === 'critical' ? 'critically low' : 'low',
        $waterLevel,
        $threshold
    );

    $metadata = json_encode([
        'current_level' => $waterLevel,
        'threshold' => $threshold,
        'unit' => 'cm',
    ]);

    $stmt = $db->prepare(
        'INSERT INTO alert (farm_id, device_id, alert_type, severity, title, message, metadata, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, "active")'
    );
    $stmt->bind_param('iissss', $farmId, $deviceId, $alertType, $severity, $title, $message, $metadata);
    $stmt->execute();
    $stmt->close();
}

function ensureAlertTable(mysqli $db): void
{
    $db->query(
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

function publishRelayUpdate(string $macAddress, array $relayStates): void
{
    $url = PUSH_SERVICE_URL;
    if ($url === '') {
        return;
    }

    $payload = json_encode([
        'mac' => strtoupper($macAddress),
        'relays' => array_map(static fn($value) => $value ? 1 : 0, $relayStates),
    ]);

    if ($payload === false) {
        return;
    }

    $ch = curl_init($url);
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

function sanitizeMacAddress(string $mac): ?string
{
    $cleaned = strtoupper(trim($mac));
    $cleaned = str_replace(['-', ' '], ':', $cleaned);
    $cleaned = preg_replace('/[^0-9A-F:]/', '', $cleaned);

    if ($cleaned === null) {
        return null;
    }

    $cleaned = preg_replace('/:+/', ':', $cleaned);
    $cleaned = trim($cleaned, ':');

    if (strlen($cleaned) === 12) {
        $cleaned = implode(':', str_split($cleaned, 2));
    }

    if (!preg_match('/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/', $cleaned)) {
        return null;
    }

    return $cleaned;
}

function normalizeDeviceType(string $value): string
{
    $normalized = strtolower(trim($value));
    return $normalized === 'node' ? 'node' : 'main';
}

function handleFetchAlerts(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $fetchAllFarms = isset($payload['fetch_all_farms']) ? (bool)$payload['fetch_all_farms'] : false;

    if ($userId <= 0) {
        respondError('user_id is required.');
    }

    // If fetch_all_farms is true, get alerts from all farms owned by user
    // Otherwise, require farm_id and verify ownership
    if ($fetchAllFarms) {
        // Get all farm IDs owned by this user
        $farmStmt = $db->prepare('SELECT id FROM farm WHERE users_id = ?');
        $farmStmt->bind_param('i', $userId);
        $farmStmt->execute();
        $farmResult = $farmStmt->get_result();
        $userFarmIds = [];
        while ($row = $farmResult->fetch_assoc()) {
            $userFarmIds[] = (int)$row['id'];
        }
        $farmStmt->close();

        if (empty($userFarmIds)) {
            respondSuccess(['success' => true, 'alerts' => []]);
            return;
        }

        $placeholders = implode(',', array_fill(0, count($userFarmIds), '?'));
        $query = 'SELECT id, farm_id, device_id, alert_type, severity, title, message, status, metadata, 
                         created_at, acknowledged_at, resolved_at, acknowledged_by
                  FROM alert
                  WHERE farm_id IN (' . $placeholders . ')';
        $params = $userFarmIds;
        $types = str_repeat('i', count($userFarmIds));
    } else {
        if ($farmId <= 0) {
            respondError('farm_id is required when fetch_all_farms is false.');
        }
        ensureFarmOwnership($db, $farmId, $userId);
    $query = 'SELECT id, farm_id, device_id, alert_type, severity, title, message, status, metadata, 
                     created_at, acknowledged_at, resolved_at, acknowledged_by
              FROM alert
              WHERE farm_id = ?';
    $params = [$farmId];
    $types = 'i';
    }

    $status = isset($payload['status']) ? (string)$payload['status'] : 'all';
    if ($status !== 'all') {
        $query .= ' AND status = ?';
        $params[] = $status;
        $types .= 's';
    }

    $limit = isset($payload['limit']) ? (int)$payload['limit'] : 100;
    $query .= ' ORDER BY created_at DESC LIMIT ?';
    $params[] = $limit;
    $types .= 'i';

    $stmt = $db->prepare($query);
    if (!$stmt) {
        respondError('Failed to prepare query: ' . $db->error, 500);
    }
    
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $result = $stmt->get_result();
    $alerts = [];
    while ($row = $result->fetch_assoc()) {
        // Convert UTC timestamps to Philippine time (Asia/Manila)
        $createdAtUtc = isset($row['created_at']) ? parseScheduleDate((string)$row['created_at']) : null;
        $acknowledgedAtUtc = isset($row['acknowledged_at']) && $row['acknowledged_at'] !== null 
            ? parseScheduleDate((string)$row['acknowledged_at']) 
            : null;
        $resolvedAtUtc = isset($row['resolved_at']) && $row['resolved_at'] !== null 
            ? parseScheduleDate((string)$row['resolved_at']) 
            : null;
        
        $alerts[] = [
            'id' => (int)$row['id'],
            'farm_id' => (int)$row['farm_id'],
            'device_id' => $row['device_id'] !== null ? (int)$row['device_id'] : null,
            'alert_type' => $row['alert_type'],
            'severity' => $row['severity'],
            'title' => $row['title'],
            'message' => $row['message'],
            'status' => $row['status'],
            'metadata' => $row['metadata'] !== null ? json_decode($row['metadata'], true) : null,
            'created_at' => $createdAtUtc !== null ? formatAppTime($createdAtUtc) : null,
            'acknowledged_at' => $acknowledgedAtUtc !== null ? formatAppTime($acknowledgedAtUtc) : null,
            'resolved_at' => $resolvedAtUtc !== null ? formatAppTime($resolvedAtUtc) : null,
            'acknowledged_by' => $row['acknowledged_by'] !== null ? (int)$row['acknowledged_by'] : null,
        ];
    }
    $stmt->close();

    if ($fetchAllFarms) {
        error_log(sprintf('[fetch_alerts] User %d (all farms): Returning %d alerts', $userId, count($alerts)));
    } else {
        error_log(sprintf('[fetch_alerts] Farm %d: Returning %d alerts', $farmId, count($alerts)));
    }
    respondSuccess(['success' => true, 'alerts' => $alerts]);
}

function handleAcknowledgeAlert(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $alertId = isset($payload['alert_id']) ? (int)$payload['alert_id'] : 0;

    if ($userId <= 0 || $alertId <= 0) {
        respondError('user_id and alert_id are required.');
    }

    // Get alert to verify farm ownership
    $stmt = $db->prepare('SELECT farm_id FROM alert WHERE id = ? LIMIT 1');
    $stmt->bind_param('i', $alertId);
    $stmt->execute();
    $result = $stmt->get_result();
    $alert = $result->fetch_assoc();
    $stmt->close();

    if (!$alert) {
        respondError('Alert not found.', 404);
    }

    $farmId = (int)$alert['farm_id'];
    ensureFarmOwnership($db, $farmId, $userId);

    // Update alert status to acknowledged
    $now = date('Y-m-d H:i:s');
    $updateStmt = $db->prepare(
        'UPDATE alert 
         SET status = "acknowledged", acknowledged_at = ?, acknowledged_by = ?
         WHERE id = ? AND status = "active"'
    );
    $updateStmt->bind_param('sii', $now, $userId, $alertId);
    $updateStmt->execute();
    $affected = $updateStmt->affected_rows;
    $updateStmt->close();

    if ($affected === 0) {
        respondError('Alert not found or already acknowledged/resolved.', 404);
    }

    respondSuccess(['success' => true, 'message' => 'Alert acknowledged successfully.']);
}

function handleGetUnreadAlertCount(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('user_id and farm_id are required.');
    }

    ensureFarmOwnership($db, $farmId, $userId);

    $stmt = $db->prepare(
        'SELECT COUNT(*) as count 
         FROM alert 
         WHERE farm_id = ? AND status = "active"'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    $count = (int)($row['count'] ?? 0);

    respondSuccess(['success' => true, 'unread_count' => $count]);
}

function respondError(string $message, int $statusCode = 400, ?string $debug = null): void
{
    http_response_code($statusCode);
    $response = [
        'success' => false,
        'message' => $message,
    ];
    if ($debug !== null) {
        $response['error'] = $debug;
    }
    echo json_encode($response);
    exit;
}

/**
 * Manually trigger alert check for a farm (for testing/debugging)
 */
function handleCheckAlertsNow(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;

    if ($userId <= 0 || $farmId <= 0) {
        respondError('user_id and farm_id are required.');
    }

    ensureFarmOwnership($db, $farmId, $userId);

    // Use centralized alert service
    require_once __DIR__ . '/alert_service.php';
    $result = checkAllSensorAlerts($db, $farmId);
    
    // Format messages for response
    $messages = [];
    foreach ($result['checks_performed'] as $sensor => $checkResult) {
        $messages[] = ucfirst($sensor) . ': ' . $checkResult['message'];
    }
    
    if (!empty($result['errors'])) {
        $messages = array_merge($messages, $result['errors']);
    }
    
    respondSuccess([
        'success' => true,
        'alerts_created' => $result['alerts_created'],
        'messages' => $messages,
        'details' => $result['checks_performed']
    ]);
}

function handleFetchSensorHistory(mysqli $db, array $payload): void
{
    $userId = isset($payload['user_id']) ? (int)$payload['user_id'] : 0;
    $farmId = isset($payload['farm_id']) ? (int)$payload['farm_id'] : 0;
    $sensorType = isset($payload['sensor_type']) ? strtolower(trim((string)$payload['sensor_type'])) : '';
    $date = isset($payload['date']) ? trim((string)$payload['date']) : '';
    $startTime = isset($payload['start_time']) ? trim((string)$payload['start_time']) : '06:00';
    $endTime = isset($payload['end_time']) ? trim((string)$payload['end_time']) : '18:00';

    if ($userId <= 0) {
        respondError('Valid user_id is required.', 422);
    }
    if ($farmId <= 0) {
        respondError('Valid farm_id is required.', 422);
    }
    if (!in_array($sensorType, ['temperature', 'humidity', 'windspeed'])) {
        respondError('sensor_type must be temperature, humidity, or windspeed.', 422);
    }
    if ($date === '') {
        respondError('date is required (format: YYYY-MM-DD).', 422);
    }

    ensureFarmOwnership($db, $farmId, $userId);

    // Parse date and time range
    $dateObj = DateTimeImmutable::createFromFormat('Y-m-d', $date, new DateTimeZone(APP_TIMEZONE));
    if ($dateObj === false) {
        respondError('Invalid date format. Use YYYY-MM-DD.', 422);
    }

    // Parse start and end times (HH:MM format)
    $startTimeParts = explode(':', $startTime);
    $endTimeParts = explode(':', $endTime);
    if (count($startTimeParts) !== 2 || count($endTimeParts) !== 2) {
        respondError('Invalid time format. Use HH:MM.', 422);
    }

    $startHour = (int)$startTimeParts[0];
    $startMinute = (int)$startTimeParts[1];
    $endHour = (int)$endTimeParts[0];
    $endMinute = (int)$endTimeParts[1];

    $startDateTime = $dateObj->setTime($startHour, $startMinute, 0);
    $endDateTime = $dateObj->setTime($endHour, $endMinute, 59);

    // Convert to UTC for database query
    $startUtc = $startDateTime->setTimezone(new DateTimeZone('UTC'));
    $endUtc = $endDateTime->setTimezone(new DateTimeZone('UTC'));

    $startUtcStr = $startUtc->format('Y-m-d H:i:s');
    $endUtcStr = $endUtc->format('Y-m-d H:i:s');

    $hourlyData = [];
    $allValues = [];

    if ($sensorType === 'windspeed') {
        // Fetch from main_readings
        $mainDeviceStmt = $db->prepare(
            'SELECT id FROM device WHERE farm_id = ? AND device_type = "main" LIMIT 1'
        );
        $mainDeviceStmt->bind_param('i', $farmId);
        $mainDeviceStmt->execute();
        $mainDeviceResult = $mainDeviceStmt->get_result();
        $mainDevice = $mainDeviceResult->fetch_assoc();
        $mainDeviceStmt->close();

        if ($mainDevice) {
            $deviceId = (int)$mainDevice['id'];
            $readingsStmt = $db->prepare(
                'SELECT windspeed, timestamp
                 FROM main_readings
                 WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp ASC'
            );
            $readingsStmt->bind_param('iss', $deviceId, $startUtcStr, $endUtcStr);
            $readingsStmt->execute();
            $readingsResult = $readingsStmt->get_result();

            while ($row = $readingsResult->fetch_assoc()) {
                if ($row['windspeed'] !== null) {
                    $value = (float)$row['windspeed'];
                    $timestamp = parseScheduleDate((string)$row['timestamp']);
                    if ($timestamp) {
                        $localTime = $timestamp->setTimezone(new DateTimeZone(APP_TIMEZONE));
                        $hourKey = $localTime->format('Y-m-d H:00:00');
                        if (!isset($hourlyData[$hourKey])) {
                            $hourlyData[$hourKey] = [];
                        }
                        $hourlyData[$hourKey][] = $value;
                        $allValues[] = $value;
                    }
                }
            }
            $readingsStmt->close();
        }
    } else {
        // Fetch from node_readings (temperature or humidity)
        $nodeDevicesStmt = $db->prepare(
            'SELECT id FROM device WHERE farm_id = ? AND device_type = "node"'
        );
        $nodeDevicesStmt->bind_param('i', $farmId);
        $nodeDevicesStmt->execute();
        $nodeResult = $nodeDevicesStmt->get_result();
        $nodeDeviceIds = [];
        while ($row = $nodeResult->fetch_assoc()) {
            $nodeDeviceIds[] = (int)$row['id'];
        }
        $nodeDevicesStmt->close();

        if (!empty($nodeDeviceIds)) {
            $column = $sensorType === 'temperature' ? 'temperature' : 'humidity';
            $placeholders = implode(',', array_fill(0, count($nodeDeviceIds), '?'));
            $readingsStmt = $db->prepare(
                "SELECT $column, timestamp
                 FROM node_readings
                 WHERE device_id IN ($placeholders) AND timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp ASC"
            );
            $params = array_merge($nodeDeviceIds, [$startUtcStr, $endUtcStr]);
            $types = str_repeat('i', count($nodeDeviceIds)) . 'ss';
            $readingsStmt->bind_param($types, ...$params);
            $readingsStmt->execute();
            $readingsResult = $readingsStmt->get_result();

            while ($row = $readingsResult->fetch_assoc()) {
                $value = $row[$column];
                if ($value !== null) {
                    $value = (float)$value;
                    $timestamp = parseScheduleDate((string)$row['timestamp']);
                    if ($timestamp) {
                        $localTime = $timestamp->setTimezone(new DateTimeZone(APP_TIMEZONE));
                        $hourKey = $localTime->format('Y-m-d H:00:00');
                        if (!isset($hourlyData[$hourKey])) {
                            $hourlyData[$hourKey] = [];
                        }
                        $hourlyData[$hourKey][] = $value;
                        $allValues[] = $value;
                    }
                }
            }
            $readingsStmt->close();
        }
    }

    // Calculate hourly averages
    $hourlyAverages = [];
    foreach ($hourlyData as $hourKey => $values) {
        if (!empty($values)) {
            $avg = array_sum($values) / count($values);
            $hourlyAverages[] = [
                'timestamp' => $hourKey,
                'value' => round($avg, 2),
            ];
        }
    }

    // Sort by timestamp
    usort($hourlyAverages, function($a, $b) {
        return strcmp($a['timestamp'], $b['timestamp']);
    });

    // Calculate statistics
    $stats = [
        'min' => null,
        'max' => null,
        'average' => null,
    ];

    if (!empty($allValues)) {
        $stats['min'] = round(min($allValues), 2);
        $stats['max'] = round(max($allValues), 2);
        $stats['average'] = round(array_sum($allValues) / count($allValues), 2);
    }

    respondSuccess([
        'success' => true,
        'sensor_type' => $sensorType,
        'date' => $date,
        'start_time' => $startTime,
        'end_time' => $endTime,
        'statistics' => $stats,
        'hourly_data' => $hourlyAverages,
    ]);
}

/**
 * Log user activity to the logs table
 * 
 * @param mysqli $db Database connection
 * @param int $userId User ID
 * @param string $actionType Action type (e.g., 'farm_create', 'device_create', 'schedule_create')
 * @param string $description Description of the action
 * @param string|null $entityType Entity type (e.g., 'farm', 'device', 'schedule')
 * @param int|null $entityId Entity ID
 * @param array|null $metadata Additional metadata as array (will be JSON encoded)
 */
function logUserActivity(
    mysqli $db,
    int $userId,
    string $actionType,
    string $description,
    ?string $entityType = null,
    ?int $entityId = null,
    ?array $metadata = null
): void {
    try {
        $ipAddress = $_SERVER['REMOTE_ADDR'] ?? null;
        $clientSource = 'mobile_app'; // Can be enhanced to detect web vs mobile
        
        $metadataJson = null;
        if ($metadata !== null) {
            $metadataJson = json_encode($metadata);
        }
        
        $stmt = $db->prepare(
            'INSERT INTO logs (users_id, log_type, action_type, entity_type, entity_id, description, ip_address, client_source, metadata) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        
        $logType = 'user_action';
        $stmt->bind_param(
            'isssissss',
            $userId,
            $logType,
            $actionType,
            $entityType,
            $entityId,
            $description,
            $ipAddress,
            $clientSource,
            $metadataJson
        );
        
        $stmt->execute();
        $stmt->close();
    } catch (mysqli_sql_exception $exception) {
        // Log error but don't fail the main operation
        error_log('Failed to log user activity: ' . $exception->getMessage());
    }
}

function respondSuccess(array $payload): void
{
    http_response_code(200);
    echo json_encode($payload);
    exit;
}
