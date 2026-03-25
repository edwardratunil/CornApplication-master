import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useUser } from './UserContext';
import {
  fetchFarmsForUser,
  createFarmForUser,
  updateFarmForUser,
  deleteFarmForUser,
  createModuleForFarm,
  updateModuleForFarm,
  deleteModuleForFarm,
} from '../services/farmService';

const FarmContext = createContext(null);

export function FarmProvider({ children }) {
  const { user } = useUser();
  const userId = user?.id ? Number(user.id) : null;

  const [farms, setFarms] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedFarm, setSelectedFarm] = useState(null);

  const applyFarmList = useCallback((items = []) => {
    setFarms(
      Array.isArray(items)
        ? items.map((item) => ({
            id: Number(item.id),
            name: item.name ?? '',
            description: item.description ?? item.address ?? '',
            address: item.address ?? item.description ?? '',
            created_at: item.created_at ?? null,
            devices: Array.isArray(item.devices)
              ? item.devices.map((device) => ({
                  id: Number(device.id),
                  macAddress: device.macAddress ?? '',
                  deviceName: device.deviceName ?? '',
                  deviceType: device.deviceType ?? 'main',
                  relay1: Number(device.relay1 ?? device.relay_1 ?? 0),
                  relay2: Number(device.relay2 ?? device.relay_2 ?? 0),
                  relay3: Number(device.relay3 ?? device.relay_3 ?? 0),
                  relay4: Number(device.relay4 ?? device.relay_4 ?? 0),
                  latitude: device.latitude !== null && device.latitude !== undefined 
                    ? Number(device.latitude) 
                    : null,
                  longitude: device.longitude !== null && device.longitude !== undefined 
                    ? Number(device.longitude) 
                    : null,
                  gpsTimestamp: device.gpsTimestamp ?? null,
                  created_at: device.created_at ?? null,
                }))
              : [],
          }))
        : []
    );
  }, []);

  const refreshFarms = useCallback(
    async (overrideUserId = null) => {
      const targetUserId = overrideUserId ?? userId;

      if (!targetUserId) {
        setFarms([]);
        setIsLoading(false);
        setError(null);
        return [];
      }

      setIsLoading(true);
      try {
        const response = await fetchFarmsForUser(targetUserId);
        const list = response?.farms ?? [];
        applyFarmList(list);
        setError(null);
        return list;
      } catch (err) {
        const message = err?.message || 'Unable to load farms.';
        setError(message);
        setFarms([]);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [applyFarmList, userId]
  );

  useEffect(() => {
    if (!userId) {
      setFarms([]);
      setIsLoading(false);
      setError(null);
      setSelectedFarm(null);
      return;
    }

    refreshFarms(userId).catch(() => {
      // Error already handled in refreshFarms
    });
  }, [refreshFarms, userId]);

  // Auto-select first farm when farms are loaded
  useEffect(() => {
    if (farms.length > 0 && !selectedFarm) {
      setSelectedFarm(farms[0]);
    } else if (farms.length > 0 && selectedFarm) {
      // Update selectedFarm if it still exists in the farms list
      const updated = farms.find((farm) => farm.id === selectedFarm.id);
      if (!updated) {
        setSelectedFarm(farms[0]);
      } else if (updated.id !== selectedFarm.id || updated.name !== selectedFarm.name) {
        // Only update if the farm data actually changed
        setSelectedFarm(updated);
      }
    } else if (farms.length === 0) {
      setSelectedFarm(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farms]);

  const addFarm = useCallback(
    async ({ name, description }) => {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      const payload = await createFarmForUser(userId, {
        name,
        description,
      });

      const newFarm = payload?.farm ?? payload?.data?.farm;
      if (newFarm) {
        const description = newFarm.description ?? newFarm.address ?? description ?? '';
        setFarms((prev) => [
          {
            id: Number(newFarm.id),
            name: newFarm.name ?? name,
            description,
            address: newFarm.address ?? newFarm.description ?? '',
            created_at: newFarm.created_at ?? null,
            devices: Array.isArray(newFarm.devices)
              ? newFarm.devices.map((device) => ({
                  id: Number(device.id),
                  macAddress: device.macAddress ?? '',
                  deviceName: device.deviceName ?? '',
                  deviceType: device.deviceType ?? 'main',
                  relay1: Number(device.relay1 ?? device.relay_1 ?? 0),
                  relay2: Number(device.relay2 ?? device.relay_2 ?? 0),
                  relay3: Number(device.relay3 ?? device.relay_3 ?? 0),
                  relay4: Number(device.relay4 ?? device.relay_4 ?? 0),
                  latitude: device.latitude !== null && device.latitude !== undefined 
                    ? Number(device.latitude) 
                    : null,
                  longitude: device.longitude !== null && device.longitude !== undefined 
                    ? Number(device.longitude) 
                    : null,
                  gpsTimestamp: device.gpsTimestamp ?? null,
                  created_at: device.created_at ?? null,
                }))
              : [],
          },
          ...prev,
        ]);
      } else {
        await refreshFarms(userId);
      }

      return newFarm;
    },
    [refreshFarms, userId]
  );

  const editFarm = useCallback(
    async ({ farmId, name, description }) => {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      const payload = await updateFarmForUser(userId, {
        farmId,
        name,
        description,
      });

      const updated = payload?.farm ?? payload?.data?.farm;
      if (updated) {
        setFarms((prev) =>
          prev.map((farm) =>
            farm.id === Number(updated.id || farmId)
              ? {
                  ...farm,
                  name: updated.name ?? name ?? farm.name,
                  description: updated.description ?? updated.address ?? description ?? farm.description,
                  address: updated.address ?? updated.description ?? description ?? farm.address ?? farm.description,
                }
              : farm
          )
        );
      } else {
        await refreshFarms(userId);
      }

      return updated;
    },
    [refreshFarms, userId]
  );

  const removeFarm = useCallback(
    async (farmId) => {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      await deleteFarmForUser(userId, farmId);

      setFarms((prev) => prev.filter((farm) => farm.id !== Number(farmId)));
    },
    [userId]
  );

  const addModule = useCallback(
    async ({ farmId, macAddress, deviceName, deviceType }) => {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      const payload = await createModuleForFarm(userId, {
        farmId,
        macAddress,
        deviceName,
        deviceType,
      });

      const device = payload?.device ?? payload?.data?.device;
      if (device) {
        setFarms((prev) =>
          prev.map((farm) =>
            farm.id === Number(farmId)
              ? {
                  ...farm,
                  devices: [
                    ...(farm.devices || []),
                    {
                      id: Number(device.id),
                      macAddress: device.macAddress ?? macAddress,
                      deviceName: device.deviceName ?? deviceName,
                      deviceType: device.deviceType ?? deviceType ?? 'main',
                      relay1: Number(device.relay1 ?? device.relay_1 ?? 0),
                      relay2: Number(device.relay2 ?? device.relay_2 ?? 0),
                      relay3: Number(device.relay3 ?? device.relay_3 ?? 0),
                      relay4: Number(device.relay4 ?? device.relay_4 ?? 0),
                      latitude: device.latitude !== null && device.latitude !== undefined 
                        ? Number(device.latitude) 
                        : null,
                      longitude: device.longitude !== null && device.longitude !== undefined 
                        ? Number(device.longitude) 
                        : null,
                      gpsTimestamp: device.gpsTimestamp ?? null,
                      created_at: device.created_at ?? null,
                    },
                  ],
                }
              : farm
          )
        );
      } else {
        await refreshFarms(userId);
      }

      return device;
    },
    [refreshFarms, userId]
  );

  const editModule = useCallback(
    async ({ deviceId, farmId, macAddress, deviceName, deviceType }) => {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      const payload = await updateModuleForFarm(userId, {
        deviceId,
        farmId,
        macAddress,
        deviceName,
        deviceType,
      });

      const device = payload?.device ?? payload?.data?.device;
      const targetFarmId = Number(farmId ?? device?.farmId ?? device?.farm_id);

      if (device && targetFarmId) {
        setFarms((prev) =>
          prev.map((farm) =>
            farm.id === targetFarmId
              ? {
                  ...farm,
                  devices: (farm.devices || []).map((existing) =>
                    existing.id === Number(device.id ?? deviceId)
                      ? {
                          ...existing,
                          macAddress: device.macAddress ?? macAddress ?? existing.macAddress,
                          deviceName: device.deviceName ?? deviceName ?? existing.deviceName,
                          deviceType: device.deviceType ?? deviceType ?? existing.deviceType,
                          relay1: Number(device.relay1 ?? device.relay_1 ?? existing.relay1 ?? 0),
                          relay2: Number(device.relay2 ?? device.relay_2 ?? existing.relay2 ?? 0),
                          relay3: Number(device.relay3 ?? device.relay_3 ?? existing.relay3 ?? 0),
                          relay4: Number(device.relay4 ?? device.relay_4 ?? existing.relay4 ?? 0),
                          latitude: device.latitude !== null && device.latitude !== undefined 
                            ? Number(device.latitude) 
                            : (existing.latitude ?? null),
                          longitude: device.longitude !== null && device.longitude !== undefined 
                            ? Number(device.longitude) 
                            : (existing.longitude ?? null),
                          gpsTimestamp: device.gpsTimestamp ?? existing.gpsTimestamp ?? null,
                        }
                      : existing
                  ),
                }
              : farm
          )
        );
      } else {
        await refreshFarms(userId);
      }

      return device;
    },
    [refreshFarms, userId]
  );

  const removeModule = useCallback(
    async ({ deviceId, farmId }) => {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      await deleteModuleForFarm(userId, { deviceId, farmId });

      setFarms((prev) =>
        prev.map((farm) =>
          farm.id === Number(farmId)
            ? {
                ...farm,
                devices: (farm.devices || []).filter((device) => device.id !== Number(deviceId)),
              }
            : farm
        )
      );
    },
    [userId]
  );

  const value = useMemo(
    () => ({
      farms,
      isLoading,
      error,
      selectedFarm,
      setSelectedFarm,
      refreshFarms,
      addFarm,
      editFarm,
      removeFarm,
      addModule,
      editModule,
      removeModule,
    }),
    [addFarm, addModule, editFarm, editModule, error, farms, isLoading, refreshFarms, removeFarm, removeModule, selectedFarm]
  );

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

export function useFarms() {
  const context = useContext(FarmContext);
  if (!context) {
    throw new Error('useFarms must be used within a FarmProvider');
  }
  return context;
}

