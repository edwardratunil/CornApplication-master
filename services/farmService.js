const HOSTINGER_FARM_URL = 'https://cropmist.com/server/farm.php';

async function postToFarmEndpoint(action, payload) {
  const body = JSON.stringify({
    action,
    ...payload,
  });

  let response;
  try {
    response = await fetch(HOSTINGER_FARM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (networkError) {
    throw new Error(networkError?.message || 'Unable to reach the server.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error('Invalid response from server.');
  }

  if (!response.ok || data?.success === false) {
    const message =
      data?.message ||
      data?.error ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function fetchFarmsForUser(userId) {
  return postToFarmEndpoint('list_farms', { user_id: Number(userId) });
}

export async function createFarmForUser(userId, { name, description }) {
  return postToFarmEndpoint('create_farm', {
    user_id: Number(userId),
    name: name?.trim() ?? '',
    description: description?.trim() ?? '',
  });
}

export async function updateFarmForUser(userId, { farmId, name, description }) {
  return postToFarmEndpoint('update_farm', {
    user_id: Number(userId),
    farm_id: Number(farmId),
    name: name?.trim() ?? '',
    description: description?.trim() ?? '',
  });
}

export async function deleteFarmForUser(userId, farmId) {
  return postToFarmEndpoint('delete_farm', {
    user_id: Number(userId),
    farm_id: Number(farmId),
  });
}

export async function createModuleForFarm(userId, { farmId, macAddress, deviceName, deviceType }) {
  return postToFarmEndpoint('create_module', {
    user_id: Number(userId),
    farm_id: Number(farmId),
    mac_address: macAddress?.trim() ?? '',
    device_name: deviceName?.trim() ?? '',
    device_type: deviceType?.trim().toLowerCase() === 'node' ? 'node' : 'main',
  });
}

export async function updateModuleForFarm(userId, { deviceId, farmId, macAddress, deviceName, deviceType }) {
  return postToFarmEndpoint('update_module', {
    user_id: Number(userId),
    device_id: Number(deviceId),
    farm_id: farmId !== undefined && farmId !== null ? Number(farmId) : undefined,
    mac_address: macAddress?.trim() ?? '',
    device_name: deviceName?.trim() ?? '',
    device_type: deviceType?.trim().toLowerCase() === 'node' ? 'node' : 'main',
  });
}

export async function deleteModuleForFarm(userId, { deviceId, farmId }) {
  return postToFarmEndpoint('delete_module', {
    user_id: Number(userId),
    device_id: Number(deviceId),
    farm_id: farmId !== undefined && farmId !== null ? Number(farmId) : undefined,
  });
}

export async function fetchDashboardSnapshot(userId, farmId) {
  return postToFarmEndpoint('dashboard_snapshot', {
    user_id: Number(userId),
    farm_id: Number(farmId),
  });
}

export async function updateFarmRelays(userId, farmId, relays = {}) {
  const payload = {
    user_id: Number(userId),
    farm_id: Number(farmId),
  };

  ['relay1', 'relay2', 'relay3', 'relay4'].forEach((key) => {
    const value = relays[key];
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === 'boolean') {
      payload[key] = value ? 1 : 0;
    } else if (typeof value === 'number') {
      payload[key] = value === 1 ? 1 : 0;
    } else {
      const normalized = String(value).trim().toLowerCase();
      payload[key] = ['1', 'true', 'on', 'yes'].includes(normalized) ? 1 : 0;
    }
  });

  return postToFarmEndpoint('update_relays', payload);
}

export async function fetchMistingSchedules(userId, farmId) {
  return postToFarmEndpoint('list_misting_schedules', {
    user_id: Number(userId),
    farm_id: Number(farmId),
  });
}

export async function createMistingSchedule(userId, farmId, { scheduleType, scheduledAt, durationMinutes }) {
  return postToFarmEndpoint('create_misting_schedule', {
    user_id: Number(userId),
    farm_id: Number(farmId),
    schedule_type: scheduleType,
    scheduled_at: scheduledAt,
    duration_minutes: Number(durationMinutes),
  });
}

export async function deleteMistingSchedule(userId, farmId, scheduleId) {
  return postToFarmEndpoint('delete_misting_schedule', {
    user_id: Number(userId),
    farm_id: Number(farmId),
    schedule_id: Number(scheduleId),
  });
}

export async function fetchThresholds(userId, farmId) {
  return postToFarmEndpoint('fetch_thresholds', {
    user_id: Number(userId),
    farm_id: Number(farmId),
  });
}

export async function updateThresholds(userId, farmId, thresholds = {}) {
  const payload = {
    user_id: Number(userId),
    farm_id: Number(farmId),
  };

  if (thresholds.waterLevelThreshold !== undefined) {
    payload.water_level_threshold = Number(thresholds.waterLevelThreshold);
  }
  if (thresholds.pesticideLevelThreshold !== undefined) {
    payload.pesticide_level_threshold = Number(thresholds.pesticideLevelThreshold);
  }
  if (thresholds.temperatureThreshold !== undefined) {
    payload.temperature_threshold = Number(thresholds.temperatureThreshold);
  }
  if (thresholds.humidityThreshold !== undefined) {
    payload.humidity_threshold = Number(thresholds.humidityThreshold);
  }
  if (thresholds.windSpeedThreshold !== undefined) {
    payload.wind_speed_threshold = Number(thresholds.windSpeedThreshold);
  }

  return postToFarmEndpoint('update_thresholds', payload);
}

export async function fetchAutomationSettings(userId, farmId) {
  return postToFarmEndpoint('fetch_automation_settings', {
    user_id: Number(userId),
    farm_id: Number(farmId),
  });
}

export async function updateAutomationSettings(userId, farmId, settings = {}) {
  const payload = {
    user_id: Number(userId),
    farm_id: Number(farmId),
  };

  if (settings.isAutomated !== undefined) {
    payload.is_automated = Boolean(settings.isAutomated);
  }
  if (settings.durationMinutes !== undefined) {
    payload.duration_minutes = Number(settings.durationMinutes);
  }
  if (settings.intervalMinutes !== undefined) {
    payload.interval_minutes = Number(settings.intervalMinutes);
  }

  return postToFarmEndpoint('update_automation_settings', payload);
}

export async function fetchAlerts(userId, farmId, options = {}) {
  const payload = {
    user_id: Number(userId),
  };

  // If fetch_all_farms is true, don't require farmId
  if (options.fetch_all_farms === true) {
    payload.fetch_all_farms = true;
  } else {
    payload.farm_id = Number(farmId);
  }

  if (options.status !== undefined) {
    payload.status = options.status; // 'all', 'active', 'acknowledged', 'resolved'
  }
  if (options.limit !== undefined) {
    payload.limit = Number(options.limit);
  }

  return postToFarmEndpoint('fetch_alerts', payload);
}

export async function acknowledgeAlert(userId, alertId) {
  return postToFarmEndpoint('acknowledge_alert', {
    user_id: Number(userId),
    alert_id: Number(alertId),
  });
}

export async function getUnreadAlertCount(userId, farmId) {
  return postToFarmEndpoint('get_unread_alert_count', {
    user_id: Number(userId),
    farm_id: Number(farmId),
  });
}

export async function fetchSensorHistory(userId, farmId, sensorType, date, startTime, endTime) {
  return postToFarmEndpoint('fetch_sensor_history', {
    user_id: Number(userId),
    farm_id: Number(farmId),
    sensor_type: sensorType,
    date: date,
    start_time: startTime,
    end_time: endTime,
  });
}

