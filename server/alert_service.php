<?php
/**
 * Centralized Alert Service
 * 
 * This service handles all alert creation and threshold checking.
 * Single source of truth for alert logic.
 */

/**
 * Check all sensor thresholds and create alerts if needed
 * This is the MAIN function to call - it handles everything
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID to check
 * @return array Results of alert checks
 */
function checkAllSensorAlerts(mysqli $connection, int $farmId): array
{
    $results = [
        'farm_id' => $farmId,
        'alerts_created' => 0,
        'checks_performed' => [],
        'errors' => []
    ];

    try {
        // Get all thresholds for this farm
        $thresholds = getSensorThresholds($connection, $farmId);
        
        if (!$thresholds) {
            $results['errors'][] = "No thresholds found for farm $farmId";
            return $results;
        }

        // Check temperature alert
        if ($thresholds['temperature_threshold'] !== null) {
            $tempResult = checkTemperatureAlert($connection, $farmId, $thresholds['temperature_threshold']);
            $results['checks_performed']['temperature'] = $tempResult;
            if ($tempResult['alert_created']) {
                $results['alerts_created']++;
            }
        }

        // Check wind speed alert
        if ($thresholds['wind_speed_threshold'] !== null) {
            $windResult = checkWindSpeedAlert($connection, $farmId, $thresholds['wind_speed_threshold']);
            $results['checks_performed']['wind_speed'] = $windResult;
            if ($windResult['alert_created']) {
                $results['alerts_created']++;
            }
        }

        // Check humidity alert
        if ($thresholds['humidity_threshold'] !== null) {
            $humidityResult = checkHumidityAlert($connection, $farmId, $thresholds['humidity_threshold']);
            $results['checks_performed']['humidity'] = $humidityResult;
            if ($humidityResult['alert_created']) {
                $results['alerts_created']++;
            }
        }

        // Check water level alert
        if ($thresholds['water_level_threshold'] !== null) {
            $waterResult = checkWaterLevelAlert($connection, $farmId, $thresholds['water_level_threshold']);
            $results['checks_performed']['water_level'] = $waterResult;
            if ($waterResult['alert_created']) {
                $results['alerts_created']++;
            }
        }

        // Check pesticide level alert
        if ($thresholds['pesticide_level_threshold'] !== null) {
            $pesticideResult = checkPesticideLevelAlert($connection, $farmId, $thresholds['pesticide_level_threshold']);
            $results['checks_performed']['pesticide_level'] = $pesticideResult;
            if ($pesticideResult['alert_created']) {
                $results['alerts_created']++;
            }
        }

    } catch (Exception $e) {
        $results['errors'][] = "Error checking alerts: " . $e->getMessage();
        error_log("[Alert Service] Error for farm $farmId: " . $e->getMessage());
    }

    return $results;
}

/**
 * Get sensor thresholds for a farm
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @return array|null Thresholds or null if not found
 */
function getSensorThresholds(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT 
            temperature_threshold,
            humidity_threshold,
            wind_speed_threshold,
            water_level_threshold,
            pesticide_level_threshold
         FROM sensor_thresholds 
         WHERE farm_id = ? 
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return $row ?: null;
}

/**
 * Get latest temperature reading for a farm
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @return array|null Contains 'value', 'device_id', 'timestamp' or null
 */
function getLatestTemperature(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT 
            nr.temperature as value,
            nr.device_id,
            nr.timestamp,
            TIMESTAMPDIFF(MINUTE, nr.timestamp, NOW()) as minutes_ago
         FROM node_readings nr
         INNER JOIN device d ON nr.device_id = d.id
         WHERE d.farm_id = ? AND d.device_type = "node" AND nr.temperature IS NOT NULL
         ORDER BY nr.timestamp DESC
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    // Only return if data is less than 15 minutes old
    if ($row && $row['minutes_ago'] < 15) {
        return [
            'value' => (float)$row['value'],
            'device_id' => (int)$row['device_id'],
            'timestamp' => $row['timestamp'],
            'age_minutes' => (int)$row['minutes_ago']
        ];
    }

    return null;
}

/**
 * Get latest wind speed reading for a farm
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @return array|null Contains 'value' (in km/h), 'device_id', 'timestamp' or null
 */
function getLatestWindSpeed(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT 
            mr.windspeed as value_ms,
            mr.device_id,
            mr.timestamp,
            TIMESTAMPDIFF(MINUTE, mr.timestamp, NOW()) as minutes_ago
         FROM main_readings mr
         INNER JOIN device d ON mr.device_id = d.id
         WHERE d.farm_id = ? AND d.device_type = "main" AND mr.windspeed IS NOT NULL
         ORDER BY mr.timestamp DESC
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    // Only return if data is less than 15 minutes old
    if ($row && $row['minutes_ago'] < 15) {
        return [
            'value' => (float)$row['value_ms'] * 3.6, // Convert m/s to km/h
            'device_id' => (int)$row['device_id'],
            'timestamp' => $row['timestamp'],
            'age_minutes' => (int)$row['minutes_ago']
        ];
    }

    return null;
}

/**
 * Get latest humidity reading for a farm
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @return array|null Contains 'value', 'device_id', 'timestamp' or null
 */
function getLatestHumidity(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT 
            nr.humidity as value,
            nr.device_id,
            nr.timestamp,
            TIMESTAMPDIFF(MINUTE, nr.timestamp, NOW()) as minutes_ago
         FROM node_readings nr
         INNER JOIN device d ON nr.device_id = d.id
         WHERE d.farm_id = ? AND d.device_type = "node" AND nr.humidity IS NOT NULL
         ORDER BY nr.timestamp DESC
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    // Only return if data is less than 15 minutes old
    if ($row && $row['minutes_ago'] < 15) {
        return [
            'value' => (float)$row['value'],
            'device_id' => (int)$row['device_id'],
            'timestamp' => $row['timestamp'],
            'age_minutes' => (int)$row['minutes_ago']
        ];
    }

    return null;
}

/**
 * Get latest water level reading for a farm
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @return array|null Contains 'value', 'device_id', 'timestamp' or null
 */
function getLatestWaterLevel(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT 
            mr.water_level as value,
            mr.device_id,
            mr.timestamp,
            TIMESTAMPDIFF(MINUTE, mr.timestamp, NOW()) as minutes_ago
         FROM main_readings mr
         INNER JOIN device d ON mr.device_id = d.id
         WHERE d.farm_id = ? AND d.device_type = "main" AND mr.water_level IS NOT NULL
         ORDER BY mr.timestamp DESC
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    // Only return if data is less than 15 minutes old
    if ($row && $row['minutes_ago'] < 15) {
        return [
            'value' => (float)$row['value'],
            'device_id' => (int)$row['device_id'],
            'timestamp' => $row['timestamp'],
            'age_minutes' => (int)$row['minutes_ago']
        ];
    }

    return null;
}

/**
 * Get latest pesticide level reading for a farm
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @return array|null Contains 'value', 'device_id', 'timestamp' or null
 */
function getLatestPesticideLevel(mysqli $connection, int $farmId): ?array
{
    $stmt = $connection->prepare(
        'SELECT 
            mr.pesticide_level as value,
            mr.device_id,
            mr.timestamp,
            TIMESTAMPDIFF(MINUTE, mr.timestamp, NOW()) as minutes_ago
         FROM main_readings mr
         INNER JOIN device d ON mr.device_id = d.id
         WHERE d.farm_id = ? AND d.device_type = "main" AND mr.pesticide_level IS NOT NULL
         ORDER BY mr.timestamp DESC
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    // Only return if data is less than 15 minutes old
    if ($row && $row['minutes_ago'] < 15) {
        return [
            'value' => (float)$row['value'],
            'device_id' => (int)$row['device_id'],
            'timestamp' => $row['timestamp'],
            'age_minutes' => (int)$row['minutes_ago']
        ];
    }

    return null;
}

/**
 * Check temperature alert
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @param float $threshold Temperature threshold in Celsius
 * @return array Result with 'alert_created', 'current_value', 'threshold', 'message'
 */
function checkTemperatureAlert(mysqli $connection, int $farmId, float $threshold): array
{
    $result = [
        'alert_created' => false,
        'current_value' => null,
        'threshold' => $threshold,
        'message' => '',
        'error' => null
    ];

    $reading = getLatestTemperature($connection, $farmId);
    
    if (!$reading) {
        $result['message'] = 'No recent temperature data available';
        return $result;
    }

    $currentTemp = $reading['value'];
    $result['current_value'] = $currentTemp;

    // Check if temperature exceeds threshold
    if ($currentTemp > $threshold) {
        $excess = $currentTemp - $threshold;
        $severity = ($excess > 10.0) ? 'critical' : 'warning';
        
        $alertCreated = createAlert(
            $connection,
            $farmId,
            $reading['device_id'],
            'temperature_high',
            $severity,
            $severity === 'critical' ? 'CRITICAL: Temperature Very High' : 'Temperature High',
            sprintf(
                'Temperature is %.1f°C, which exceeds the threshold of %.1f°C by %.1f°C. Please take appropriate action.',
                $currentTemp,
                $threshold,
                $excess
            ),
            [
                'current_temperature' => $currentTemp,
                'threshold' => $threshold,
                'excess' => $excess,
                'unit' => '°C'
            ]
        );

        $result['alert_created'] = $alertCreated;
        $result['message'] = $alertCreated 
            ? "Alert created: {$currentTemp}°C > {$threshold}°C"
            : "Alert already exists";
    } else {
        $result['message'] = "Temperature OK: {$currentTemp}°C <= {$threshold}°C";
    }

    return $result;
}

/**
 * Check wind speed alert
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @param float $threshold Wind speed threshold in km/h
 * @return array Result with 'alert_created', 'current_value', 'threshold', 'message'
 */
function checkWindSpeedAlert(mysqli $connection, int $farmId, float $threshold): array
{
    $result = [
        'alert_created' => false,
        'current_value' => null,
        'threshold' => $threshold,
        'message' => '',
        'error' => null
    ];

    $reading = getLatestWindSpeed($connection, $farmId);
    
    if (!$reading) {
        $result['message'] = 'No recent wind speed data available';
        return $result;
    }

    $currentWind = $reading['value']; // Already in km/h
    $result['current_value'] = $currentWind;

    // Check if wind speed exceeds threshold
    if ($currentWind > $threshold) {
        $excess = $currentWind - $threshold;
        $severity = ($excess > 10.0) ? 'critical' : 'warning';
        
        $alertCreated = createAlert(
            $connection,
            $farmId,
            $reading['device_id'],
            'wind_high',
            $severity,
            $severity === 'critical' ? 'CRITICAL: Wind Speed Very High' : 'Wind Speed High',
            sprintf(
                'Wind speed is %.1f km/h, which exceeds the threshold of %.1f km/h by %.1f km/h. High winds may affect misting effectiveness.',
                $currentWind,
                $threshold,
                $excess
            ),
            [
                'current_wind_speed' => $currentWind,
                'threshold' => $threshold,
                'excess' => $excess,
                'unit' => 'km/h'
            ]
        );

        $result['alert_created'] = $alertCreated;
        $result['message'] = $alertCreated 
            ? "Alert created: {$currentWind} km/h > {$threshold} km/h"
            : "Alert already exists";
    } else {
        $result['message'] = "Wind speed OK: {$currentWind} km/h <= {$threshold} km/h";
    }

    return $result;
}

/**
 * Check humidity alert
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @param float $threshold Humidity threshold in percent
 * @return array Result with 'alert_created', 'current_value', 'threshold', 'message'
 */
function checkHumidityAlert(mysqli $connection, int $farmId, float $threshold): array
{
    $result = [
        'alert_created' => false,
        'current_value' => null,
        'threshold' => $threshold,
        'message' => '',
        'error' => null
    ];

    $reading = getLatestHumidity($connection, $farmId);
    
    if (!$reading) {
        $result['message'] = 'No recent humidity data available';
        return $result;
    }

    $currentHumidity = $reading['value'];
    $result['current_value'] = $currentHumidity;

    // Check if humidity exceeds threshold (high) or below threshold (low)
    if ($currentHumidity > $threshold) {
        $excess = $currentHumidity - $threshold;
        $severity = ($excess > 20.0) ? 'critical' : 'warning';
        
        $alertCreated = createAlert(
            $connection,
            $farmId,
            $reading['device_id'],
            'humidity_high',
            $severity,
            $severity === 'critical' ? 'CRITICAL: Humidity Very High' : 'Humidity High',
            sprintf(
                'Humidity is %.1f%%, which exceeds the threshold of %.1f%% by %.1f%%.',
                $currentHumidity,
                $threshold,
                $excess
            ),
            [
                'current_humidity' => $currentHumidity,
                'threshold' => $threshold,
                'excess' => $excess,
                'unit' => '%'
            ]
        );

        $result['alert_created'] = $alertCreated;
        $result['message'] = $alertCreated 
            ? "Alert created: {$currentHumidity}% > {$threshold}%"
            : "Alert already exists";
    } else {
        $result['message'] = "Humidity OK: {$currentHumidity}% <= {$threshold}%";
    }

    return $result;
}

/**
 * Check water level alert
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @param float $threshold Water level threshold in cm
 * @return array Result with 'alert_created', 'current_value', 'threshold', 'message'
 */
function checkWaterLevelAlert(mysqli $connection, int $farmId, float $threshold): array
{
    $result = [
        'alert_created' => false,
        'current_value' => null,
        'threshold' => $threshold,
        'message' => '',
        'error' => null
    ];

    $reading = getLatestWaterLevel($connection, $farmId);
    
    if (!$reading) {
        $result['message'] = 'No recent water level data available';
        return $result;
    }

    $currentLevel = $reading['value'];
    $result['current_value'] = $currentLevel;

    // Check if water level is below threshold (low)
    if ($currentLevel < $threshold) {
        $deficit = $threshold - $currentLevel;
        $severity = ($deficit > 10.0) ? 'critical' : 'warning';
        $alertType = ($deficit > 10.0) ? 'water_critical' : 'water_low';
        
        $alertCreated = createAlert(
            $connection,
            $farmId,
            $reading['device_id'],
            $alertType,
            $severity,
            $severity === 'critical' ? 'CRITICAL: Water Level Very Low' : 'Water Level Low',
            sprintf(
                'Water level is %.1f cm, which is below the threshold of %.1f cm by %.1f cm. Please refill the water tank.',
                $currentLevel,
                $threshold,
                $deficit
            ),
            [
                'current_water_level' => $currentLevel,
                'threshold' => $threshold,
                'deficit' => $deficit,
                'unit' => 'cm'
            ]
        );

        $result['alert_created'] = $alertCreated;
        $result['message'] = $alertCreated 
            ? "Alert created: {$currentLevel} cm < {$threshold} cm"
            : "Alert already exists";
    } else {
        $result['message'] = "Water level OK: {$currentLevel} cm >= {$threshold} cm";
    }

    return $result;
}

/**
 * Check pesticide level alert
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @param float $threshold Pesticide level threshold in cm
 * @return array Result with 'alert_created', 'current_value', 'threshold', 'message'
 */
function checkPesticideLevelAlert(mysqli $connection, int $farmId, float $threshold): array
{
    $result = [
        'alert_created' => false,
        'current_value' => null,
        'threshold' => $threshold,
        'message' => '',
        'error' => null
    ];

    $reading = getLatestPesticideLevel($connection, $farmId);
    
    if (!$reading) {
        $result['message'] = 'No recent pesticide level data available';
        return $result;
    }

    $currentLevel = $reading['value'];
    $result['current_value'] = $currentLevel;

    // Check if pesticide level is below threshold (low)
    if ($currentLevel < $threshold) {
        $deficit = $threshold - $currentLevel;
        $severity = ($deficit > 10.0) ? 'critical' : 'warning';
        $alertType = ($deficit > 10.0) ? 'pesticide_critical' : 'pesticide_low';
        
        $alertCreated = createAlert(
            $connection,
            $farmId,
            $reading['device_id'],
            $alertType,
            $severity,
            $severity === 'critical' ? 'CRITICAL: Pesticide Level Very Low' : 'Pesticide Level Low',
            sprintf(
                'Pesticide level is %.1f cm, which is below the threshold of %.1f cm by %.1f cm. Please refill the pesticide tank.',
                $currentLevel,
                $threshold,
                $deficit
            ),
            [
                'current_pesticide_level' => $currentLevel,
                'threshold' => $threshold,
                'deficit' => $deficit,
                'unit' => 'cm'
            ]
        );

        $result['alert_created'] = $alertCreated;
        $result['message'] = $alertCreated 
            ? "Alert created: {$currentLevel} cm < {$threshold} cm"
            : "Alert already exists";
    } else {
        $result['message'] = "Pesticide level OK: {$currentLevel} cm >= {$threshold} cm";
    }

    return $result;
}

/**
 * Create an alert in the database
 * 
 * @param mysqli $connection Database connection
 * @param int $farmId Farm ID
 * @param int|null $deviceId Device ID (can be null)
 * @param string $alertType Alert type (e.g., 'temperature_high')
 * @param string $severity Severity ('info', 'warning', 'critical')
 * @param string $title Alert title
 * @param string $message Alert message
 * @param array $metadata Additional metadata
 * @return bool True if alert was created, false if it already exists
 */
function createAlert(
    mysqli $connection,
    int $farmId,
    ?int $deviceId,
    string $alertType,
    string $severity,
    string $title,
    string $message,
    array $metadata = []
): bool {
    // Check if an active alert of this type already exists for this farm
    $checkStmt = $connection->prepare(
        'SELECT id FROM alert 
         WHERE farm_id = ? AND alert_type = ? AND status = "active"
         LIMIT 1'
    );
    $checkStmt->bind_param('is', $farmId, $alertType);
    $checkStmt->execute();
    $result = $checkStmt->get_result();
    $existing = $result->fetch_assoc();
    $checkStmt->close();

    // If alert already exists, don't create duplicate
    if ($existing) {
        error_log(sprintf(
            "[Alert Service] Farm %d: Alert type '%s' already exists (ID: %d), skipping",
            $farmId,
            $alertType,
            $existing['id']
        ));
        return false;
    }

    // Insert new alert
    $metadataJson = json_encode($metadata);
    
    if ($deviceId !== null && $deviceId > 0) {
        $stmt = $connection->prepare(
            'INSERT INTO alert (farm_id, device_id, alert_type, severity, title, message, metadata, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, "active")'
        );
        $stmt->bind_param('iisssss', $farmId, $deviceId, $alertType, $severity, $title, $message, $metadataJson);
    } else {
        $stmt = $connection->prepare(
            'INSERT INTO alert (farm_id, device_id, alert_type, severity, title, message, metadata, status)
             VALUES (?, NULL, ?, ?, ?, ?, ?, "active")'
        );
        $stmt->bind_param('isssss', $farmId, $alertType, $severity, $title, $message, $metadataJson);
    }

    try {
        $stmt->execute();
        $alertId = $connection->insert_id;
        $stmt->close();
        
        error_log(sprintf(
            "[Alert Service] ✅ Created alert (ID: %d) for farm %d: %s - %s",
            $alertId,
            $farmId,
            $alertType,
            $title
        ));
        
        return true;
    } catch (Exception $e) {
        $stmt->close();
        error_log(sprintf(
            "[Alert Service] ❌ ERROR creating alert for farm %d: %s",
            $farmId,
            $e->getMessage()
        ));
        throw $e;
    }
}

/**
 * Check alerts for all farms (useful for cron jobs)
 * 
 * @param mysqli $connection Database connection
 * @return array Summary of all checks
 */
function checkAlertsForAllFarms(mysqli $connection): array
{
    $summary = [
        'farms_checked' => 0,
        'total_alerts_created' => 0,
        'results' => []
    ];

    // Get all farms with thresholds
    $stmt = $connection->query(
        'SELECT DISTINCT farm_id FROM sensor_thresholds'
    );

    while ($row = $stmt->fetch_assoc()) {
        $farmId = (int)$row['farm_id'];
        $summary['farms_checked']++;
        
        $result = checkAllSensorAlerts($connection, $farmId);
        $summary['total_alerts_created'] += $result['alerts_created'];
        $summary['results'][] = $result;
    }

    return $summary;
}

