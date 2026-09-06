/**
 * networkHostClient.js — Cliente y Gestor de Modo de Red (Host / Cliente / Standalone)
 * 
 * Permite que una terminal opere de manera autónoma (Standalone),
 * como Servidor Central (Host), o como Terminal Remota (Cliente).
 */

const STORAGE_KEY = 'logix_network_settings';

export const getNetworkConfig = () => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Error reading network settings:', e);
    }
    return {
        mode: 'standalone', // 'standalone' | 'host' | 'client'
        hostUrl: 'http://127.0.0.1:8088',
        port: 8088,
        autoSync: true
    };
};

export const saveNetworkConfig = (config) => {
    try {
        const current = getNetworkConfig();
        const updated = { ...current, ...config };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('logix-network-config-changed', { detail: updated }));
        return updated;
    } catch (e) {
        console.error('Error saving network settings:', e);
        return null;
    }
};

/**
 * Prueba la conectividad con el servidor Host
 */
export const testHostConnection = async (hostUrl) => {
    const cleanUrl = (hostUrl || '').replace(/\/+$/, '');
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        
        const res = await fetch(cleanUrl + '/api/status', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            return { success: true, data };
        } else {
            return { success: false, error: 'El servidor respondió con código ' + res.status };
        }
    } catch (err) {
        return { success: false, error: err.name === 'AbortError' ? 'Tiempo de espera agotado (Timeout)' : (err.message || 'No se pudo conectar') };
    }
};

/**
 * Obtiene las conciliaciones desde el Host
 */
export const fetchReconciliationFromHost = async (hostUrl) => {
    const cleanUrl = (hostUrl || '').replace(/\/+$/, '');
    const res = await fetch(cleanUrl + '/api/reconciliation');
    if (!res.ok) throw new Error('Error ' + res.status + ' al consultar conciliación del host');
    return await res.json();
};

/**
 * Obtiene la lista de operadores activos desde el Host
 */
export const fetchOperatorsFromHost = async (hostUrl) => {
    const cleanUrl = (hostUrl || '').replace(/\/+$/, '');
    const res = await fetch(cleanUrl + '/api/operators');
    if (!res.ok) throw new Error('Error ' + res.status + ' al consultar operadores del host');
    const data = await res.json();
    return data.operators || [];
};

/**
 * Envía conteos de un operario al Host de manera atómica
 */
export const submitCountsToHost = async (hostUrl, counts) => {
    const cleanUrl = (hostUrl || '').replace(/\/+$/, '');
    const res = await fetch(cleanUrl + '/api/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts })
    });
    if (!res.ok) throw new Error('Error ' + res.status + ' al enviar conteos al host');
    return await res.json();
};
