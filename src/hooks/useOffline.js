/**
 * Hook de compatibilidad de estado de red para Logix Desktop Portable.
 * Al operar 100% de manera local y autónoma (Rust + SQLite), siempre reporta estado activo.
 */

const noopAsync = async () => {};
const noopCountAsync = async () => 0;
const noopSyncAsync = async () => ({ success: true, synced: 0 });

export const useOffline = () => {
    return {
        isOnline: true,
        pendingCount: 0,
        saveOffline: noopAsync,
        cacheData: noopAsync,
        getCachedData: async () => null,
        refreshPendingCount: noopCountAsync,
        syncPendingData: noopSyncAsync
    };
};
