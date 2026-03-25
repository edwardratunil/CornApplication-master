<?php
declare(strict_types=1);

/**
 * Unified cron-friendly misting worker.
 *
 * This script handles both:
 * 1. Scheduled Misting: Processes user-created misting schedules (water/pesticide)
 * 2. Automated Misting: Processes sensor-based automated misting
 *
 * Usage (Hostinger cron):
 *   /usr/bin/php -q /home/USERNAME/public_html/server/run_misting_worker.php
 * 
 * Recommended: Run every 1-2 minutes
 */

const DB_HOST = 'localhost';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';

const WATER_DEFAULT_DURATION_SECONDS = 120;
const PESTICIDE_DEFAULT_DURATION_SECONDS = 60;

const PUSH_SERVICE_URL = '';
const PUSH_SERVICE_API_KEY = '';

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
    // Ensure all required tables exist
    ensureMistingScheduleTable($connection);
    ensureAutomationSettingsTable($connection);
    ensureAutomationStateTable($connection);
    ensureAlertTable($connection);
    
    // Include alert service for creating alerts
    require_once __DIR__ . '/alert_service.php';

    $schedulerProcessed = 0;
    $automationProcessed = 0;

    // 1. Process scheduled misting (water/pesticide schedules)
    $devices = fetchMainDevices($connection);
    if (!empty($devices)) {
        foreach ($devices as $device) {
            if (processMistingSchedules($connection, $device)) {
                $schedulerProcessed++;
            }
        }
    }

    // 2. Process automated misting (sensor-based automation)
    $farms = fetchAutomatedFarms($connection);
    if (!empty($farms)) {
        foreach ($farms as $farm) {
            if (processAutomatedMisting($connection, $farm)) {
                $automationProcessed++;
            }
        }
    }

    $summary = sprintf(
        '[%s] Worker run complete. Schedules: %d, Automation: %d',
        date('Y-m-d H:i:s'),
        $schedulerProcessed,
        $automationProcessed
    );
    
    logLine($summary);
    echo $summary . "\n";
} catch (Throwable $throwable) {
    $error = 'Worker error: ' . $throwable->getMessage();
    logLine($error);
    echo "[ERROR] " . $error . "\n";
    exit(1);
} finally {
    $connection->close();
}

exit(0);

// ============================================================================
// SCHEDULED MISTING FUNCTIONS
// ============================================================================

/**
 * @return array<int, array<string, mixed>>
 */
function fetchMainDevices(mysqli $connection): array
{
    $sql = <<<SQL
        SELECT id, farm_id, mac_address, relay_1, relay_2, relay_3, relay_4
        FROM device
        WHERE device_type = 'main'
    SQL;

    $result = $connection->query($sql);
    $devices = [];
    while ($row = $result->fetch_assoc()) {
        $devices[] = $row;
    }
    $result->close();

    return $devices;
}

/**
 * Returns true when the device record was changed.
 */
function processMistingSchedules(mysqli $connection, array $deviceRow): bool
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
    $hasActiveWaterSchedule = false;
    $hasActivePesticideSchedule = false;

    foreach (['water' => 'relay_1', 'pesticide' => 'relay_2'] as $type => $relayKey) {
        $schedule = fetchActiveSchedule($connection, $farmId, $type);
        if ($schedule === null) {
            // No active schedule for this type - ensure relay is OFF if it was on due to a schedule
            // (but don't turn off if it's being controlled manually or by automation)
            if ($type === 'water') {
                $hasActiveWaterSchedule = false;
            } else {
                $hasActivePesticideSchedule = false;
            }
            continue;
        }
        
        // Mark that we have an active schedule
        if ($type === 'water') {
            $hasActiveWaterSchedule = true;
        } else {
            $hasActivePesticideSchedule = true;
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
            // Check water level before starting water misting schedule
            if ($type === 'water') {
                $waterLevel = fetchWaterLevel($connection, $deviceId);
                $waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
                if ($waterLevel !== null && $waterThreshold !== null && $waterLevel <= $waterThreshold) {
                    // Water level too low, cannot start misting
                    logLine(sprintf(
                        '[Schedule] Water level (%.1f cm) <= threshold (%.1f cm), cannot start water misting schedule %d',
                        $waterLevel,
                        $waterThreshold,
                        $scheduleId
                    ));
                    createWaterLowAlert($connection, $farmId, $deviceId, $waterLevel, $waterThreshold);
                    // Mark schedule as failed
                    $stmt = $connection->prepare(
                        'UPDATE misting_schedule SET status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                    );
                    $stmt->bind_param('i', $scheduleId);
                    $stmt->execute();
                    $stmt->close();
                    continue;
                }
            }
            // Check pesticide level before starting pesticide misting schedule
            if ($type === 'pesticide') {
                $pesticideLevel = fetchPesticideLevel($connection, $deviceId);
                $pesticideThreshold = fetchPesticideLevelThreshold($connection, $farmId);
                if ($pesticideLevel !== null && $pesticideThreshold !== null && $pesticideLevel <= $pesticideThreshold) {
                    // Pesticide level too low, cannot start misting
                    logLine(sprintf(
                        '[Schedule] Pesticide level (%.1f cm) <= threshold (%.1f cm), cannot start pesticide misting schedule %d',
                        $pesticideLevel,
                        $pesticideThreshold,
                        $scheduleId
                    ));
                    createPesticideLowAlert($connection, $farmId, $deviceId, $pesticideLevel, $pesticideThreshold);
                    // Mark schedule as failed
                    $stmt = $connection->prepare(
                        'UPDATE misting_schedule SET status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                    );
                    $stmt->bind_param('i', $scheduleId);
                    $stmt->execute();
                    $stmt->close();
                    continue;
                }
            }
            
            $startedAt = startMistingSchedule($connection, $scheduleId);
            $status = 'running';
            $schedule['started_at'] = $startedAt->format('Y-m-d H:i:s');
        }

        if ($status === 'running') {
            // Check wind speed first - applies to both water and pesticide misting
            $sensors = fetchLatestSensorReadings($connection, $farmId);
            $thresholds = fetchThresholds($connection, $farmId);
            if ($sensors['wind_speed'] !== null && $thresholds['wind_speed'] !== null) {
                $windSpeedMs = (float)$sensors['wind_speed'];
                $windSpeedKmh = $windSpeedMs * 3.6; // Convert m/s to km/h
                $windThreshold = (float)$thresholds['wind_speed'];
                
                if ($windSpeedKmh >= $windThreshold) {
                    // Wind speed exceeds threshold, turn off immediately
                    logLine(sprintf(
                        '[Schedule] Wind speed (%.2f km/h) >= threshold (%.1f km/h), turning off %s misting schedule %d immediately',
                        $windSpeedKmh,
                        $windThreshold,
                        $type,
                        $scheduleId
                    ));
                    
                    // Create wind speed alert
                    createAlert(
                        $connection,
                        $farmId,
                        $deviceId,
                        'wind_speed',
                        'critical',
                        'High Wind Speed: Misting Stopped',
                        sprintf(
                            'Wind speed is %.2f km/h, which exceeds the threshold of %.1f km/h. All misting has been automatically stopped for safety.',
                            $windSpeedKmh,
                            $windThreshold
                        ),
                        [
                            'wind_speed_kmh' => $windSpeedKmh,
                            'threshold_kmh' => $windThreshold,
                            'excess_kmh' => $windSpeedKmh - $windThreshold,
                            'shutdown_type' => 'scheduled_misting',
                            'schedule_id' => $scheduleId,
                            'schedule_type' => $type,
                            'reason' => 'wind_speed_exceeded'
                        ]
                    );
                    
                    completeMistingSchedule($connection, $scheduleId);
                    $relayStates[$relayKey] = 0;
                    $relayStates['relay_4'] = 0; // Also turn off pump
                    $updated = true;
                    continue;
                }
            }
            
            // Check water level before/while running water misting
            if ($type === 'water') {
                $waterLevel = fetchWaterLevel($connection, $deviceId);
                $waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
                if ($waterLevel !== null && $waterThreshold !== null && $waterLevel <= $waterThreshold) {
                    // Water level too low, turn off immediately
                    logLine(sprintf(
                        '[Schedule] Water level (%.1f cm) <= threshold (%.1f cm), turning off water misting immediately',
                        $waterLevel,
                        $waterThreshold
                    ));
                    createWaterLowAlert($connection, $farmId, $deviceId, $waterLevel, $waterThreshold);
                    completeMistingSchedule($connection, $scheduleId);
                    $relayStates[$relayKey] = 0;
                    $updated = true;
                    continue;
                }
            }
            // Check pesticide level before/while running pesticide misting
            if ($type === 'pesticide') {
                $pesticideLevel = fetchPesticideLevel($connection, $deviceId);
                $pesticideThreshold = fetchPesticideLevelThreshold($connection, $farmId);
                if ($pesticideLevel !== null && $pesticideThreshold !== null && $pesticideLevel <= $pesticideThreshold) {
                    // Pesticide level too low, turn off immediately
                    logLine(sprintf(
                        '[Schedule] Pesticide level (%.1f cm) <= threshold (%.1f cm), turning off pesticide misting immediately',
                        $pesticideLevel,
                        $pesticideThreshold
                    ));
                    createPesticideLowAlert($connection, $farmId, $deviceId, $pesticideLevel, $pesticideThreshold);
                    completeMistingSchedule($connection, $scheduleId);
                    $relayStates[$relayKey] = 0;
                    $updated = true;
                    continue;
                }
            }
            $startedAt = isset($schedule['started_at'])
                ? parseScheduleDate((string)$schedule['started_at'])
                : null;
            if ($startedAt === null) {
                $startedAt = startMistingSchedule($connection, $scheduleId);
            }

            $endTime = $startedAt->add(new DateInterval('PT' . $durationSeconds . 'S'));
            if ($now >= $endTime) {
                // Duration elapsed, complete the schedule and turn off relay
                logLine(sprintf(
                    '[Schedule] %s schedule %d duration elapsed (started: %s, ended: %s), turning off relay %s',
                    $type,
                    $scheduleId,
                    $startedAt->format('Y-m-d H:i:s'),
                    $endTime->format('Y-m-d H:i:s'),
                    $relayKey
                ));
                completeMistingSchedule($connection, $scheduleId);
                // Force relay to OFF
                $relayStates[$relayKey] = 0;
                $updated = true;
                // Mark schedule as completed so mutual exclusion doesn't interfere
                if ($type === 'water') {
                    $hasActiveWaterSchedule = false;
                } else {
                    $hasActivePesticideSchedule = false;
                }
                continue;
            }

            if ($relayStates[$relayKey] !== 1) {
                $relayStates[$relayKey] = 1;
                $updated = true;
            }

            // Mutual exclusion: if water is on, turn off pesticide and vice versa
            // Only apply mutual exclusion if both schedules are actively running
            if ($relayKey === 'relay_1' && $relayStates['relay_2'] !== 0 && $hasActivePesticideSchedule) {
                // Water schedule is running, but pesticide relay is also on from a schedule
                // This shouldn't happen, but turn off pesticide to enforce mutual exclusion
                logLine(sprintf('[Schedule] Water schedule running, turning off pesticide relay (mutual exclusion)'));
                $relayStates['relay_2'] = 0;
                $updated = true;
            } elseif ($relayKey === 'relay_2' && $relayStates['relay_1'] !== 0 && $hasActiveWaterSchedule) {
                // Pesticide schedule is running, but water relay is also on from a schedule
                // This shouldn't happen, but turn off water to enforce mutual exclusion
                logLine(sprintf('[Schedule] Pesticide schedule running, turning off water relay (mutual exclusion)'));
                $relayStates['relay_1'] = 0;
                $updated = true;
            }
        }
    }

    // Safety check: Ensure pesticide relay is OFF if no active pesticide schedule
    // (This handles cases where schedule completed but relay update failed)
    // BUT: Only turn off if it's not manual control - check automation state first
    if (!$hasActivePesticideSchedule && $relayStates['relay_2'] === 1) {
        $automationState = getOrCreateAutomationState($connection, $farmId);
        // If automation is running, it's controlled by automation (not schedule), so don't turn off
        // If automation is NOT running and no schedule, it's likely manual control - don't turn off here
        // The manual check below will handle manual control properly
        // This safety check is now disabled to prevent interfering with manual misting
        // The manual pesticide check below will handle turning off if needed (e.g., owner offline)
    }
    
    // Safety check: Ensure water relay is OFF if no active water schedule
    // Similar logic - disabled to prevent interfering with manual misting
    // The manual water check below will handle it properly

    // Check manual water misting (relay_1) - monitor water level and turn off if too low
    // Only check if relay is ON and not controlled by schedule or automation
    if ($relayStates['relay_1'] === 1 && !$hasActiveWaterSchedule) {
        $automationState = getOrCreateAutomationState($connection, $farmId);
        // Only check if automation is not running (manual control)
        if ($automationState['is_running'] === 0) {
            // EMERGENCY SHUTDOWN: Check if farm owner is offline
            if (isFarmOwnerOffline($connection, $farmId)) {
                logLine(sprintf(
                    '[Emergency Shutdown] Device %d: Farm owner is offline, shutting down manual water misting (relay_1).',
                    $deviceId
                ));
                
                // Create emergency shutdown alert
                createAlert(
                    $connection,
                    $farmId,
                    $deviceId,
                    'system_error',
                    'critical',
                    'Emergency Shutdown: Water Misting',
                    'Misting has been automatically shut down because the farm owner is offline. This is a safety measure to prevent unattended operation.',
                    [
                        'shutdown_type' => 'water_misting',
                        'relay' => 'relay_1',
                        'reason' => 'farm_owner_offline',
                        'device_id' => $deviceId
                    ]
                );
                
                $relayStates['relay_1'] = 0;
                $updated = true;
            } else {
                // Check wind speed first - turn off if exceeds threshold
                $sensors = fetchLatestSensorReadings($connection, $farmId);
                $thresholds = fetchThresholds($connection, $farmId);
                if ($sensors['wind_speed'] !== null && $thresholds['wind_speed'] !== null) {
                    $windSpeedMs = (float)$sensors['wind_speed'];
                    $windSpeedKmh = $windSpeedMs * 3.6; // Convert m/s to km/h
                    $windThreshold = (float)$thresholds['wind_speed'];
                    
                    if ($windSpeedKmh >= $windThreshold) {
                        // Wind speed exceeds threshold, turn off immediately
                        logLine(sprintf(
                            '[Manual] Device %d: Wind speed (%.2f km/h) >= threshold (%.1f km/h), turning off manual water misting.',
                            $deviceId,
                            $windSpeedKmh,
                            $windThreshold
                        ));
                        
                        // Create wind speed alert
                        createAlert(
                            $connection,
                            $farmId,
                            $deviceId,
                            'wind_speed',
                            'critical',
                            'High Wind Speed: Misting Stopped',
                            sprintf(
                                'Wind speed is %.2f km/h, which exceeds the threshold of %.1f km/h. All misting has been automatically stopped for safety.',
                                $windSpeedKmh,
                                $windThreshold
                            ),
                            [
                                'wind_speed_kmh' => $windSpeedKmh,
                                'threshold_kmh' => $windThreshold,
                                'excess_kmh' => $windSpeedKmh - $windThreshold,
                                'shutdown_type' => 'manual_water_misting',
                                'relay' => 'relay_1',
                                'reason' => 'wind_speed_exceeded'
                            ]
                        );
                        
                        $relayStates['relay_1'] = 0;
                        $updated = true;
                    } else {
                        // Wind speed is OK, check water level
                        $waterLevel = fetchWaterLevel($connection, $deviceId);
                        $waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
                        
                        // Turn off if water level is null (no reading)
                        if ($waterLevel === null) {
                            logLine(sprintf(
                                '[Manual] Device %d: No water level reading available, turning off manual water misting.',
                                $deviceId
                            ));
                            $relayStates['relay_1'] = 0;
                            $updated = true;
                        }
                        // Turn off if water level is 0 or <= threshold
                        elseif ($waterThreshold !== null && $waterLevel <= $waterThreshold) {
                            logLine(sprintf(
                                '[Manual] Device %d: Water level (%.1f cm) <= threshold (%.1f cm), turning off manual water misting.',
                                $deviceId,
                                $waterLevel,
                                $waterThreshold
                            ));
                            createWaterLowAlert($connection, $farmId, $deviceId, $waterLevel, $waterThreshold);
                            $relayStates['relay_1'] = 0;
                            $updated = true;
                        }
                    }
                } else {
                    // No wind speed data available, check water level
                    $waterLevel = fetchWaterLevel($connection, $deviceId);
                    $waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
                    
                    // Turn off if water level is null (no reading)
                    if ($waterLevel === null) {
                        logLine(sprintf(
                            '[Manual] Device %d: No water level reading available, turning off manual water misting.',
                            $deviceId
                        ));
                        $relayStates['relay_1'] = 0;
                        $updated = true;
                    }
                    // Turn off if water level is 0 or <= threshold
                    elseif ($waterThreshold !== null && $waterLevel <= $waterThreshold) {
                        logLine(sprintf(
                            '[Manual] Device %d: Water level (%.1f cm) <= threshold (%.1f cm), turning off manual water misting.',
                            $deviceId,
                            $waterLevel,
                            $waterThreshold
                        ));
                        createWaterLowAlert($connection, $farmId, $deviceId, $waterLevel, $waterThreshold);
                        $relayStates['relay_1'] = 0;
                        $updated = true;
                    }
                }
            }
        }
    }

    // Check manual pesticide misting (relay_2) - emergency shutdown if owner is offline
    // Only check if relay is ON and not controlled by schedule or automation
    if ($relayStates['relay_2'] === 1 && !$hasActivePesticideSchedule) {
        $automationState = getOrCreateAutomationState($connection, $farmId);
        // Only check if automation is not running (manual control)
        if ($automationState['is_running'] === 0) {
            // EMERGENCY SHUTDOWN: Check if farm owner is offline
            if (isFarmOwnerOffline($connection, $farmId)) {
                logLine(sprintf(
                    '[Emergency Shutdown] Device %d: Farm owner is offline, shutting down manual pesticide misting (relay_2).',
                    $deviceId
                ));
                
                // Create emergency shutdown alert
                // Use 'relay_error' instead of 'system_error' to allow separate alerts for water vs pesticide
                createAlert(
                    $connection,
                    $farmId,
                    $deviceId,
                    'relay_error',
                    'critical',
                    'Emergency Shutdown: Pesticide Misting',
                    'Misting has been automatically shut down because the farm owner is offline. This is a safety measure to prevent unattended operation.',
                    [
                        'shutdown_type' => 'pesticide_misting',
                        'relay' => 'relay_2',
                        'reason' => 'farm_owner_offline',
                        'device_id' => $deviceId
                    ]
                );
                
                $relayStates['relay_2'] = 0;
                $updated = true;
            } else {
                // Check wind speed first - turn off if exceeds threshold
                $sensors = fetchLatestSensorReadings($connection, $farmId);
                $thresholds = fetchThresholds($connection, $farmId);
                if ($sensors['wind_speed'] !== null && $thresholds['wind_speed'] !== null) {
                    $windSpeedMs = (float)$sensors['wind_speed'];
                    $windSpeedKmh = $windSpeedMs * 3.6; // Convert m/s to km/h
                    $windThreshold = (float)$thresholds['wind_speed'];
                    
                    if ($windSpeedKmh >= $windThreshold) {
                        // Wind speed exceeds threshold, turn off immediately
                        logLine(sprintf(
                            '[Manual] Device %d: Wind speed (%.2f km/h) >= threshold (%.1f km/h), turning off manual pesticide misting.',
                            $deviceId,
                            $windSpeedKmh,
                            $windThreshold
                        ));
                        
                        // Create wind speed alert
                        createAlert(
                            $connection,
                            $farmId,
                            $deviceId,
                            'wind_speed',
                            'critical',
                            'High Wind Speed: Misting Stopped',
                            sprintf(
                                'Wind speed is %.2f km/h, which exceeds the threshold of %.1f km/h. All misting has been automatically stopped for safety.',
                                $windSpeedKmh,
                                $windThreshold
                            ),
                            [
                                'wind_speed_kmh' => $windSpeedKmh,
                                'threshold_kmh' => $windThreshold,
                                'excess_kmh' => $windSpeedKmh - $windThreshold,
                                'shutdown_type' => 'manual_pesticide_misting',
                                'relay' => 'relay_2',
                                'reason' => 'wind_speed_exceeded'
                            ]
                        );
                        
                        $relayStates['relay_2'] = 0;
                        $updated = true;
                    } else {
                        // Wind speed is OK, check pesticide level
                        $pesticideLevel = fetchPesticideLevel($connection, $deviceId);
                        $pesticideThreshold = fetchPesticideLevelThreshold($connection, $farmId);
                        
                        // Turn off if pesticide level is null (no reading)
                        if ($pesticideLevel === null) {
                            logLine(sprintf(
                                '[Manual] Device %d: No pesticide level reading available, turning off manual pesticide misting.',
                                $deviceId
                            ));
                            $relayStates['relay_2'] = 0;
                            $updated = true;
                        }
                        // Turn off if pesticide level is 0 or <= threshold
                        elseif ($pesticideThreshold !== null && $pesticideLevel <= $pesticideThreshold) {
                            logLine(sprintf(
                                '[Manual] Device %d: Pesticide level (%.1f cm) <= threshold (%.1f cm), turning off manual pesticide misting.',
                                $deviceId,
                                $pesticideLevel,
                                $pesticideThreshold
                            ));
                            createPesticideLowAlert($connection, $farmId, $deviceId, $pesticideLevel, $pesticideThreshold);
                            $relayStates['relay_2'] = 0;
                            $updated = true;
                        }
                    }
                } else {
                    // No wind speed data available, check pesticide level
                    $pesticideLevel = fetchPesticideLevel($connection, $deviceId);
                    $pesticideThreshold = fetchPesticideLevelThreshold($connection, $farmId);
                    
                    // Turn off if pesticide level is null (no reading)
                    if ($pesticideLevel === null) {
                        logLine(sprintf(
                            '[Manual] Device %d: No pesticide level reading available, turning off manual pesticide misting.',
                            $deviceId
                        ));
                        $relayStates['relay_2'] = 0;
                        $updated = true;
                    }
                    // Turn off if pesticide level is 0 or <= threshold
                    elseif ($pesticideThreshold !== null && $pesticideLevel <= $pesticideThreshold) {
                        logLine(sprintf(
                            '[Manual] Device %d: Pesticide level (%.1f cm) <= threshold (%.1f cm), turning off manual pesticide misting.',
                            $deviceId,
                            $pesticideLevel,
                            $pesticideThreshold
                        ));
                        createPesticideLowAlert($connection, $farmId, $deviceId, $pesticideLevel, $pesticideThreshold);
                        $relayStates['relay_2'] = 0;
                        $updated = true;
                    }
                }
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

        $logPrefix = $hasActiveWaterSchedule || $hasActivePesticideSchedule ? '[Schedule]' : '[Manual]';
        logLine(sprintf(
            '%s Updated device %d (mac %s) relays to [%d,%d,%d,%d]',
            $logPrefix,
            $deviceId,
            $macAddress ?? 'unknown',
            $relayStates['relay_1'],
            $relayStates['relay_2'],
            $relayStates['relay_3'],
            $relayStates['relay_4']
        ));

        return true;
    }

    return false;
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

// ============================================================================
// AUTOMATED MISTING FUNCTIONS
// ============================================================================

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
        logLine(sprintf('[Automation] Farm %d: No main device found, skipping.', $farmId));
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

    // If relays are running, check if duration has elapsed OR water level is too low
    if ($state['is_running'] === 1 && $state['relays_on_at'] !== null) {
        // First check: if water level is too low, turn off immediately
        $waterLevel = fetchWaterLevel($connection, $deviceId);
        $waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
        
        // Check if water level is null (no reading) or <= threshold
        if ($waterLevel === null) {
            logLine(sprintf(
                '[Automation] Farm %d: No water level reading available, cannot continue automation.',
                $farmId
            ));
            // Turn off relays if no reading available
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
        }
        
        if ($waterThreshold !== null && $waterLevel <= $waterThreshold) {
            // Water level too low, turn off immediately
            logLine(sprintf(
                '[Automation] Farm %d: Water level (%.1f cm) <= threshold (%.1f cm), turning off relays immediately.',
                $farmId,
                $waterLevel,
                $waterThreshold
            ));
            createWaterLowAlert($connection, $farmId, $deviceId, $waterLevel, $waterThreshold);
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
        }
        
        // Check sensor conditions - turn off if thresholds are no longer met
        $sensors = fetchLatestSensorReadings($connection, $farmId);
        $thresholds = fetchThresholds($connection, $farmId);
        
        // Check wind speed - turn off if exceeds threshold
        if ($sensors['wind_speed'] !== null && $thresholds['wind_speed'] !== null) {
            $windSpeedMs = (float)$sensors['wind_speed'];
            $windSpeedKmh = $windSpeedMs * 3.6; // Convert m/s to km/h
            $windThreshold = (float)$thresholds['wind_speed'];
            
            if ($windSpeedKmh >= $windThreshold) {
                // Wind speed exceeds threshold, turn off immediately
                logLine(sprintf(
                    '[Automation] Farm %d: Wind speed (%.2f km/h) >= threshold (%.1f km/h), turning off relays immediately.',
                    $farmId,
                    $windSpeedKmh,
                    $windThreshold
                ));
                
                // Create wind speed alert
                createAlert(
                    $connection,
                    $farmId,
                    $deviceId,
                    'wind_speed',
                    'critical',
                    'High Wind Speed: Misting Stopped',
                    sprintf(
                        'Wind speed is %.2f km/h, which exceeds the threshold of %.1f km/h. All misting has been automatically stopped for safety.',
                        $windSpeedKmh,
                        $windThreshold
                    ),
                    [
                        'wind_speed_kmh' => $windSpeedKmh,
                        'threshold_kmh' => $windThreshold,
                        'excess_kmh' => $windSpeedKmh - $windThreshold,
                        'shutdown_type' => 'automated_misting',
                        'reason' => 'wind_speed_exceeded'
                    ]
                );
                
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
            }
        }
        
        // Check temperature - turn off if drops below threshold
        if ($sensors['temperature'] !== null && $thresholds['temperature'] !== null) {
            $temperature = (float)$sensors['temperature'];
            $tempThreshold = (float)$thresholds['temperature'];
            
            if ($temperature <= $tempThreshold) {
                // Temperature dropped below threshold, turn off immediately
                logLine(sprintf(
                    '[Automation] Farm %d: Temperature (%.1f°C) <= threshold (%.1f°C), turning off relays immediately.',
                    $farmId,
                    $temperature,
                    $tempThreshold
                ));
                
                // Create temperature alert
                createAlert(
                    $connection,
                    $farmId,
                    $deviceId,
                    'temperature',
                    'warning',
                    'Temperature Below Threshold: Misting Stopped',
                    sprintf(
                        'Temperature has dropped to %.1f°C, which is below the threshold of %.1f°C. Misting has been automatically stopped.',
                        $temperature,
                        $tempThreshold
                    ),
                    [
                        'temperature' => $temperature,
                        'threshold' => $tempThreshold,
                        'difference' => $temperature - $tempThreshold,
                        'shutdown_type' => 'automated_misting',
                        'reason' => 'temperature_below_threshold'
                    ]
                );
                
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
            }
        }
        
        // Check humidity - turn off if rises above threshold
        if ($sensors['humidity'] !== null && $thresholds['humidity'] !== null) {
            $humidity = (float)$sensors['humidity'];
            $humidityThreshold = (float)$thresholds['humidity'];
            
            if ($humidity >= $humidityThreshold) {
                // Humidity rose above threshold, turn off immediately
                logLine(sprintf(
                    '[Automation] Farm %d: Humidity (%.1f%%) >= threshold (%.1f%%), turning off relays immediately.',
                    $farmId,
                    $humidity,
                    $humidityThreshold
                ));
                
                // Create humidity alert
                createAlert(
                    $connection,
                    $farmId,
                    $deviceId,
                    'humidity',
                    'warning',
                    'Humidity Above Threshold: Misting Stopped',
                    sprintf(
                        'Humidity has risen to %.1f%%, which exceeds the threshold of %.1f%%. Misting has been automatically stopped.',
                        $humidity,
                        $humidityThreshold
                    ),
                    [
                        'humidity' => $humidity,
                        'threshold' => $humidityThreshold,
                        'excess' => $humidity - $humidityThreshold,
                        'shutdown_type' => 'automated_misting',
                        'reason' => 'humidity_above_threshold'
                    ]
                );
                
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
            }
        }
        
        // Second check: if duration has elapsed
        $relaysOnAt = parseDateTime((string)$state['relays_on_at']);
        if ($relaysOnAt !== null) {
            $endTime = $relaysOnAt->add(new DateInterval('PT' . ($durationMinutes * 60) . 'S'));
            if ($now >= $endTime) {
                // Duration elapsed, turn off relays
                logLine(sprintf('[Automation] Farm %d: Duration elapsed, turning off relays.', $farmId));
                
                // Calculate actual duration
                $actualDurationMinutes = (int)(($now->getTimestamp() - $relaysOnAt->getTimestamp()) / 60);
                
                // Create alert notification that automated misting has completed
                createAlert(
                    $connection,
                    $farmId,
                    $deviceId,
                    'schedule_completed', // Using schedule_completed type for automation events
                    'info',
                    'Automated Misting Completed',
                    sprintf(
                        'Automated misting has completed successfully after running for %d minutes. Next check will be in %d minutes.',
                        $actualDurationMinutes,
                        $intervalMinutes
                    ),
                    [
                        'automation_type' => 'automated_misting',
                        'scheduled_duration_minutes' => $durationMinutes,
                        'actual_duration_minutes' => $actualDurationMinutes,
                        'interval_minutes' => $intervalMinutes,
                        'started_at' => $relaysOnAt->format('Y-m-d H:i:s'),
                        'completed_at' => $now->format('Y-m-d H:i:s'),
                    ]
                );
                
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
                logLine(sprintf('[Automation] Farm %d: Relays still running (will end at %s).', $farmId, $endTime->format('Y-m-d H:i:s')));
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
            logLine(sprintf('[Automation] Farm %d: No next_check_at set, checking conditions immediately.', $farmId));
        } else {
            $nextCheck = parseDateTime((string)$state['next_check_at']);
            if ($nextCheck !== null && $now >= $nextCheck) {
                $shouldCheck = true;
                logLine(sprintf('[Automation] Farm %d: next_check_at (%s) has passed, checking conditions now.', $farmId, $state['next_check_at']));
            } else {
                // Log why we're not checking
                if ($nextCheck !== null) {
                    $minutesUntilCheck = (int)(($nextCheck->getTimestamp() - $now->getTimestamp()) / 60);
                    logLine(sprintf('[Automation] Farm %d: Waiting for next check in %d minutes (next_check_at: %s, now: %s).', 
                        $farmId, 
                        $minutesUntilCheck,
                        $state['next_check_at'],
                        $now->format('Y-m-d H:i:s')
                    ));
                } else {
                    logLine(sprintf('[Automation] Farm %d: next_check_at is invalid, checking conditions immediately.', $farmId));
                    $shouldCheck = true; // If we can't parse the date, check anyway
                }
            }
        }
    } else {
        logLine(sprintf('[Automation] Farm %d: Automation is currently running (is_running=1), skipping condition check.', $farmId));
    }

    // Check conditions if it's time
    if ($shouldCheck) {
        // Check water level first before checking other conditions
        $waterLevel = fetchWaterLevel($connection, $deviceId);
        $waterThreshold = fetchWaterLevelThreshold($connection, $farmId);
        
        // If no water level reading, cannot turn on
        if ($waterLevel === null) {
            logLine(sprintf(
                '[Automation] Farm %d: No water level reading available, cannot turn on relays.',
                $farmId
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
        
        // If water level is <= threshold, cannot turn on
        if ($waterThreshold !== null && $waterLevel <= $waterThreshold) {
            // Water level too low, cannot turn on automation
            logLine(sprintf(
                '[Automation] Farm %d: Water level (%.1f cm) <= threshold (%.1f cm), cannot turn on relays.',
                $farmId,
                $waterLevel,
                $waterThreshold
            ));
            createWaterLowAlert($connection, $farmId, $deviceId, $waterLevel, $waterThreshold);
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
        
        // Get node device ID for temperature alerts (temperature comes from node devices)
        $nodeDeviceId = null;
        $nodeStmt = $connection->prepare(
            'SELECT id FROM device WHERE farm_id = ? AND device_type = "node" LIMIT 1'
        );
        $nodeStmt->bind_param('i', $farmId);
        $nodeStmt->execute();
        $nodeResult = $nodeStmt->get_result();
        $nodeDevice = $nodeResult->fetch_assoc();
        $nodeStmt->close();
        if ($nodeDevice) {
            $nodeDeviceId = (int)$nodeDevice['id'];
        }
        
        $conditionsMet = checkConditions($sensors, $thresholds);
        
        logLine(sprintf(
            '[Automation] Farm %d: Checking conditions - temp=%.1f (threshold: %.1f), hum=%.1f (threshold: %.1f), wind=%.1f m/s (threshold: %.1f km/h)',
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
                '[Automation] Farm %d: All conditions met! Turning on relays for %d minutes.',
                $farmId,
                $durationMinutes
            ));
            
            // Create alert notification that automated misting has started
            createAlert(
                $connection,
                $farmId,
                $deviceId,
                'schedule_started', // Using schedule_started type for automation events
                'info',
                'Automated Misting Started',
                sprintf(
                    'Automated misting has started because all conditions are met. Misting will run for %d minutes. Conditions: Temperature: %.1f°C, Humidity: %.1f%%, Wind Speed: %.2f km/h.',
                    $durationMinutes,
                    $sensors['temperature'] ?? 0,
                    $sensors['humidity'] ?? 0,
                    ($sensors['wind_speed'] ?? 0) * 3.6 // Convert m/s to km/h
                ),
                [
                    'automation_type' => 'automated_misting',
                    'duration_minutes' => $durationMinutes,
                    'temperature' => $sensors['temperature'] ?? null,
                    'humidity' => $sensors['humidity'] ?? null,
                    'wind_speed_ms' => $sensors['wind_speed'] ?? null,
                    'wind_speed_kmh' => ($sensors['wind_speed'] ?? 0) * 3.6,
                    'started_at' => $now->format('Y-m-d H:i:s'),
                ]
            );
            
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
                '[Automation] Farm %d: Conditions not met. Next check in %d minutes.',
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
                logLine(sprintf('[Automation] Farm %d: Waiting for next check in %d minutes.', $farmId, $minutesUntilCheck));
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
            '[Automation] Missing sensor data - temp: %s, humidity: %s, wind: %s. Cannot proceed with automation.',
            $temperature === null ? 'NULL' : (string)$temperature,
            $humidity === null ? 'NULL' : (string)$humidity,
            $windSpeed === null ? 'NULL' : (string)$windSpeed
        ));
        return false;
    }
    
    // Log sensor values for debugging
    logLine(sprintf(
        '[Automation] Sensor readings - Temperature: %.1f°C, Humidity: %.1f%%, Wind Speed: %.2f m/s (%.2f km/h)',
        $temperature,
        $humidity,
        $windSpeed,
        $windSpeed * 3.6
    ));

    // Convert wind speed from m/s to km/h (thresholds are stored in km/h)
    $windSpeedKmh = (float)$windSpeed * 3.6; // m/s to km/h

    $tempCheck = (float)$temperature > (float)$tempThreshold;
    $humidityCheck = (float)$humidity < (float)$humidityThreshold;
    $windCheck = $windSpeedKmh < (float)$windThreshold;

    logLine(sprintf(
        '[Automation] Condition checks - Temp: %.1f > %.1f = %s, Humidity: %.1f < %.1f = %s, Wind: %.2f km/h < %.1f km/h = %s',
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

    // Maximum age for sensor readings (15 minutes) - reject older data
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
            $readingTime = parseDateTime((string)$reading['timestamp']);
            // Only use reading if it's recent (within maxAgeMinutes)
            if ($readingTime !== null && $readingTime >= $maxAge) {
                $sensors['wind_speed'] = (float)$reading['windspeed'];
                $ageMinutes = (int)(($now->getTimestamp() - $readingTime->getTimestamp()) / 60);
                logLine(sprintf(
                    '[Automation] Farm %d: Wind speed reading: %.2f m/s (timestamp: %s, age: %d minutes)',
                    $farmId,
                    $sensors['wind_speed'],
                    $reading['timestamp'],
                    $ageMinutes
                ));
            } else {
                $ageMinutes = $readingTime !== null ? (int)(($now->getTimestamp() - $readingTime->getTimestamp()) / 60) : 'unknown';
                logLine(sprintf(
                    '[Automation] Farm %d: Wind speed reading is too old (timestamp: %s, age: %s minutes, max age: %d minutes), ignoring.',
                    $farmId,
                    $reading['timestamp'],
                    $ageMinutes,
                    $maxAgeMinutes
                ));
            }
        } else {
            logLine(sprintf(
                '[Automation] Farm %d: No wind speed reading found in main_readings (device_id: %d).',
                $farmId,
                $deviceId
            ));
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
            $readingTime = parseDateTime((string)$nodeReading['timestamp']);
            // Only use readings if they're recent (within maxAgeMinutes)
            if ($readingTime !== null && $readingTime >= $maxAge) {
                if ($nodeReading['temperature'] !== null) {
                    $sensors['temperature'] = (float)$nodeReading['temperature'];
                }
                if ($nodeReading['humidity'] !== null) {
                    $sensors['humidity'] = (float)$nodeReading['humidity'];
                }
                $ageMinutes = (int)(($now->getTimestamp() - $readingTime->getTimestamp()) / 60);
                logLine(sprintf(
                    '[Automation] Farm %d: Node readings - Temperature: %s, Humidity: %s (timestamp: %s, age: %d minutes)',
                    $farmId,
                    $sensors['temperature'] !== null ? sprintf('%.1f°C', $sensors['temperature']) : 'NULL',
                    $sensors['humidity'] !== null ? sprintf('%.1f%%', $sensors['humidity']) : 'NULL',
                    $nodeReading['timestamp'],
                    $ageMinutes
                ));
            } else {
                $ageMinutes = $readingTime !== null ? (int)(($now->getTimestamp() - $readingTime->getTimestamp()) / 60) : 'unknown';
                logLine(sprintf(
                    '[Automation] Farm %d: Temperature/humidity readings are too old (timestamp: %s, age: %s minutes, max age: %d minutes), ignoring.',
                    $farmId,
                    $nodeReading['timestamp'],
                    $ageMinutes,
                    $maxAgeMinutes
                ));
            }
        } else {
            logLine(sprintf(
                '[Automation] Farm %d: No node device readings found.',
                $farmId
            ));
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
        '[Automation] Updated device %d (mac %s) relays to [%d,%d,%d,%d]',
        $deviceId,
        $macAddress ?? 'unknown',
        $relay1,
        $relay2,
        $relay3,
        $relay4
    ));
}

// ============================================================================
// SHARED FUNCTIONS
// ============================================================================

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
            CONSTRAINT fk_schedule_farm_worker FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
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

    // Return default threshold (20.0 cm)
    return 20.0;
}

function fetchPesticideLevel(mysqli $connection, int $deviceId): ?float
{
    $stmt = $connection->prepare(
        'SELECT pesticide_level
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

    if ($reading && $reading['pesticide_level'] !== null) {
        return (float)$reading['pesticide_level'];
    }

    return null;
}

function fetchPesticideLevelThreshold(mysqli $connection, int $farmId): ?float
{
    $stmt = $connection->prepare(
        'SELECT pesticide_level_threshold
         FROM sensor_thresholds
         WHERE farm_id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $farmId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    if ($row && $row['pesticide_level_threshold'] !== null) {
        return (float)$row['pesticide_level_threshold'];
    }

    // Return default threshold (20.0 cm)
    return 20.0;
}

function createWaterLowAlert(mysqli $connection, int $farmId, int $deviceId, float $waterLevel, float $threshold): void
{
    // Determine alert type first
    $alertType = ($waterLevel <= ($threshold * 0.5)) ? 'water_critical' : 'water_low';
    
    // Check if an active alert of this type already exists for this farm
    $checkStmt = $connection->prepare(
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
    $severity = ($alertType === 'water_critical') ? 'critical' : 'warning';
    
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

    $stmt = $connection->prepare(
        'INSERT INTO alert (farm_id, device_id, alert_type, severity, title, message, metadata, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, "active")'
    );
    $stmt->bind_param('iissss', $farmId, $deviceId, $alertType, $severity, $title, $message, $metadata);
    $stmt->execute();
    $stmt->close();

    logLine(sprintf(
        '[Alert] Created %s alert for farm %d: Water level %.1f cm <= threshold %.1f cm',
        $alertType,
        $farmId,
        $waterLevel,
        $threshold
    ));
}

function createPesticideLowAlert(mysqli $connection, int $farmId, int $deviceId, float $pesticideLevel, float $threshold): void
{
    // Determine alert type first
    $alertType = ($pesticideLevel <= ($threshold * 0.5)) ? 'pesticide_critical' : 'pesticide_low';
    
    // Check if an active alert of this type already exists for this farm
    $checkStmt = $connection->prepare(
        'SELECT id FROM alert 
         WHERE farm_id = ? AND alert_type IN ("pesticide_low", "pesticide_critical") AND status = "active"
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

    // Determine severity based on how low the pesticide level is
    $severity = ($alertType === 'pesticide_critical') ? 'critical' : 'warning';
    
    $title = $severity === 'critical' 
        ? 'CRITICAL: Pesticide Level Critically Low'
        : 'Pesticide Level Low';
    
    $message = sprintf(
        'Pesticide level is %s (%.1f cm). Threshold: %.1f cm. Please refill the pesticide tank immediately.',
        $severity === 'critical' ? 'critically low' : 'low',
        $pesticideLevel,
        $threshold
    );

    $metadata = json_encode([
        'current_level' => $pesticideLevel,
        'threshold' => $threshold,
        'unit' => 'cm',
    ]);

    $stmt = $connection->prepare(
        'INSERT INTO alert (farm_id, device_id, alert_type, severity, title, message, metadata, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, "active")'
    );
    $stmt->bind_param('iissss', $farmId, $deviceId, $alertType, $severity, $title, $message, $metadata);
    $stmt->execute();
    $stmt->close();

    logLine(sprintf(
        '[Alert] Created %s alert for farm %d: Pesticide level %.1f cm <= threshold %.1f cm',
        $alertType,
        $farmId,
        $pesticideLevel,
        $threshold
    ));
}

/**
 * Check if the farm owner is offline
 * 
 * @param mysqli $connection
 * @param int $farmId
 * @return bool True if farm owner is offline, false if online or not found
 */
function isFarmOwnerOffline(mysqli $connection, int $farmId): bool
{
    try {
        // Get the farm owner's user ID
        $stmt = $connection->prepare('SELECT users_id FROM farm WHERE id = ? LIMIT 1');
        $stmt->bind_param('i', $farmId);
        $stmt->execute();
        $result = $stmt->get_result();
        $farm = $result->fetch_assoc();
        $stmt->close();

        if (!$farm || !isset($farm['users_id'])) {
            // Farm not found - assume offline for safety
            return true;
        }

        $userId = (int)$farm['users_id'];

        // Check if user's activity_status is 'Offline'
        $stmt = $connection->prepare('SELECT activity_status FROM users WHERE id = ? LIMIT 1');
        $stmt->bind_param('i', $userId);
        $stmt->execute();
        $result = $stmt->get_result();
        $user = $result->fetch_assoc();
        $stmt->close();

        if (!$user || !isset($user['activity_status'])) {
            // User not found - assume offline for safety
            return true;
        }

        // Return true if activity_status is 'Offline'
        return strtolower($user['activity_status']) === 'offline';
    } catch (mysqli_sql_exception $exception) {
        // On error, assume offline for safety
        logLine(sprintf(
            '[Emergency Shutdown] Error checking farm owner status for farm %d: %s',
            $farmId,
            $exception->getMessage()
        ));
        return true; // Fail-safe: assume offline if we can't check
    }
}

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

function logLine(string $message): void
{
    $timestamp = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    error_log("[misting-worker][$timestamp] $message");
}

