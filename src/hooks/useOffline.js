import { useState, useEffect, useCallback } from 'react';
import { getDB, getCachedData, cacheData, savePendingSync } from '../utils/offlineDb';
import { syncPendingData } from '../utils/syncManager';
import { toast } from 'react-toastify';

export const useOffline = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);

    const refreshPendingCount = useCallback(async () => {
        try {
            const db = await getDB();
            const count = await db.count('pending_sync');
            setPendingCount(count);
            return count;
        } catch (e) {
            console.error("Error al contar pendientes:", e);
            return 0;
        }
    }, []);

    const updateOnlineStatus = useCallback(async () => {
        const online = navigator.onLine;
        setIsOnline(online);
        if (online) {
            toast.info('Conexión restaurada. Sincronizando datos...');
            await syncPendingData();
            const count = await refreshPendingCount();
            if (count === 0) {
                // Solo recargar si realmente se limpio la cola para evitar bucles si hay errores persistentes
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } else {
            toast.warning('Modo offline activado. Los datos se guardarán localmente.');
        }
    }, [refreshPendingCount]);

    useEffect(() => {
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        refreshPendingCount();

        // Intervalo para actualizar el contador y TRATAR de sincronizar si estamos online
        const interval = setInterval(async () => {
            const count = await refreshPendingCount();
            if (count > 0 && navigator.onLine) {
                // Intentar sincronizar en segundo plano si hay pendientes y hay red
                await syncPendingData();
                await refreshPendingCount();
            }
        }, 10000); // Cada 10 segundos para no ser tan agresivo si hay fallos

        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
            clearInterval(interval);
        };
    }, [updateOnlineStatus, refreshPendingCount]);

    return {
        isOnline,
        pendingCount,
        saveOffline: savePendingSync,
        cacheData,
        getCachedData,
        refreshPendingCount,
        syncPendingData
    };
};
