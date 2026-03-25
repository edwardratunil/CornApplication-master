<?php
declare(strict_types=1);

/**
 * Cron-friendly misting scheduler worker.
 *
 * - Promotes pending schedules to running when their time arrives.
 * - Turns off running schedules whose duration elapsed.
 * - Ensures mutual exclusion between water (relay 1) and pesticide (relay 2).
 * - Persists relay changes and publishes them via the Railway push service.
 *
 * Usage (Hostinger cron):
 *   /usr/bin/php -q /home/USERNAME/public_html/server/run_misting_scheduler.php
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
    exit(1);
}

try {
    ensureMistingScheduleTable($connection);

    $devices = fetchMainDevices($connection);
    if (empty($devices)) {
        logLine('No main devices found.');
        exit(0);
    }

    $processed = 0;
    foreach ($devices as $device) {
        if (processMistingSchedules($connection, $device)) {
            $processed++;
        }
    }

    logLine(sprintf('Scheduler run complete. Devices updated: %d', $processed));
} catch (Throwable $throwable) {
    logLine('Scheduler error: ' . $throwable->getMessage());
    exit(1);
} finally {
    $connection->close();
}

exit(0);

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
            $startedAt = isset($schedule['started_at'])
                ? parseScheduleDate((string)$schedule['started_at'])
                : null;
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

    $relay4 = ($relayStates['relay_1'] === 1 || $relayStates['relay_2'] === 1) ? 1 : 0;
    if ($relayStates['relay_4'] !== $relay4) {
        $relayStates['relay_4'] = $relay4;
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

        logLine(sprintf(
            'Updated device %d (mac %s) relays to [%d,%d,%d,%d]',
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
            CONSTRAINT fk_schedule_farm_worker FOREIGN KEY (farm_id) REFERENCES farm(id) ON DELETE CASCADE
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

function logLine(string $message): void
{
    $timestamp = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    error_log("[misting-scheduler][$timestamp] $message");
}

