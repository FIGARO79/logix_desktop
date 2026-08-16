import { openDB } from 'idb';

const isTauri = () => typeof window !== 'undefined' && window.__TAURI__ !== undefined;

const DB_NAME = 'LogixOfflineDB';
const DB_VERSION = 11;

// En modo Tauri nativo, no abrimos IndexedDB; usamos SQLite a través de Rust
class NullDBStore {
    async get() { return null; }
    async getAll() { return []; }
    async put() { return null; }
    async delete() { return null; }
    async clear() { return null; }
    async count() { return 0; }
    transaction() {
        return {
            objectStore: () => this,
            done: Promise.resolve(),
        };
    }
}

const nullDbInstance = new NullDBStore();

let dbPromise = null;

const initDB = async () => {
    if (isTauri()) {
        return nullDbInstance;
    }

    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db, _oldVersion) {
                const stores = [
                    'pending_sync', 'data_cache', 'master_items', 'sync_metadata',
                    'po_lookup', 'grn_pending', 'xdock_reservations', 'planner_daily_items',
                    'picking_tracking', 'picking_orders', 'active_sessions', 'picking_audits',
                    'picking_audit_history', 'local_counts', 'local_count_sessions', 'local_inbound',
                    'local_spot_check', 'local_express_audit', 'local_ir_reconciliation',
                    'local_inbound_audit', 'local_audit_alerts', 'local_slotting_config',
                    'local_planner_config', 'local_planner_plans', 'local_planner_executions',
                    'local_users', 'local_w2w_settings'
                ];
                for (const storeName of stores) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const opts = (storeName === 'master_items') ? { keyPath: 'Item_Code' } :
                                     (storeName === 'local_slotting_config' || storeName === 'local_planner_config' || storeName === 'local_w2w_settings' || storeName === 'data_cache' || storeName === 'sync_metadata') ? { keyPath: 'key' } :
                                     (storeName === 'active_sessions') ? { keyPath: 'type' } :
                                     { keyPath: 'id' };
                        db.createObjectStore(storeName, opts);
                    }
                }
            },
        });
    }
    return dbPromise;
};

export const getDB = () => {
    if (isTauri()) {
        return Promise.resolve(nullDbInstance);
    }
    return initDB();
};

/**
 * Guarda un registro pendiente en la cola de sincronización.
 */
export const savePendingSync = async (collection, payload, editId = null) => {
    if (isTauri()) {
        return crypto.randomUUID();
    }
    const db = await getDB();
    const id = (typeof editId === 'string' && editId.includes('-')) ? editId : crypto.randomUUID();
    const record = {
        id,
        collection,
        payload,
        editId: typeof editId === 'number' ? editId : null,
        timestamp: new Date().toISOString(),
    };
    await db.put('pending_sync', record);
    return id;
};

/**
 * Guarda datos en caché genérica.
 */
export const cacheData = async (key, data) => {
    if (isTauri()) return;
    const db = await getDB();
    await db.put('data_cache', { key, data, timestamp: new Date().toISOString() });
};

/**
 * Recupera datos de la caché genérica.
 */
export const getCachedData = async (key) => {
    if (isTauri()) return null;
    const db = await getDB();
    const result = await db.get('data_cache', key);
    return result ? result.data : null;
};

/**
 * Función de comparación flexible para referencias (Import Reference, Waybill, PO)
 */
export const matchRef = (val1, val2) => {
    if (!val1 || !val2) return false;
    const s1 = String(val1).trim().toUpperCase();
    const s2 = String(val2).trim().toUpperCase();
    if (s1 === s2) return true;

    const stripPrefix = (str) => str.replace(/^(IR|REF|PO)[-_\s]*/i, '');
    const clean1 = stripPrefix(s1).replace(/[^A-Z0-9]/g, '');
    const clean2 = stripPrefix(s2).replace(/[^A-Z0-9]/g, '');
    if (clean1 && clean2 && clean1 === clean2) return true;

    const normParts = (str) => stripPrefix(str).split(/[^A-Z0-9]+/).map(p => p.replace(/^0+/, '')).filter(Boolean).join('-');
    const p1 = normParts(s1);
    const p2 = normParts(s2);
    return Boolean(p1 && p2 && p1 === p2);
};

/**
 * Obtiene la cantidad esperada de GRN para un SKU e IR.
 */
export const getGRNExpectedQty = async (db, itemCode, importRef) => {
    if (!importRef || !itemCode) return 0;
    if (isTauri()) return 0; // En Tauri se resuelve directamente desde Rust

    const normalizedIr = importRef.trim().toUpperCase();
    const cleanIr = normalizedIr.replace(/[^A-Z0-9]/g, '');
    const normalizedCode = itemCode.trim().toUpperCase();
    const cleanCode = normalizedCode.replace(/[^A-Z0-9]/g, '');

    try {
        let poInfo = await db.get('po_lookup', `ir_${normalizedIr}`) || (cleanIr ? await db.get('po_lookup', `ir_${cleanIr}`) : null);
        if (!poInfo) {
            const allPos = await db.getAll('po_lookup') || [];
            poInfo = allPos.find(p => {
                const irVal = p.import_ref || p.import_reference || (p.type === 'ir' ? p.value : '') || '';
                return matchRef(irVal, normalizedIr);
            });
        }

        const associatedGrns = new Set();
        let directPoQty = 0;
        if (poInfo && poInfo.items) {
            poInfo.items.forEach(it => {
                const itCode = String(it.item_code || '').toUpperCase().trim();
                const itClean = itCode.replace(/[^A-Z0-9]/g, '');
                if (itCode === normalizedCode || (cleanCode && itClean === cleanCode)) {
                    directPoQty += parseInt(it.qty || it.despatched_qty || 0) || 0;
                }
                const grnVal = it.grn ? String(it.grn).toUpperCase().trim() : '';
                if (grnVal) {
                    grnVal.split(',').forEach(g => {
                        const gKey = g.trim();
                        if (gKey) associatedGrns.add(gKey);
                    });
                }
            });
        }

        const allGrns = await db.getAll('grn_pending') || [];
        const itemGrns = allGrns.filter(g => {
            const gCode = String(g.Item_Code || '').toUpperCase().trim();
            return gCode === normalizedCode || (cleanCode && gCode.replace(/[^A-Z0-9]/g, '') === cleanCode);
        });

        if (associatedGrns.size > 0) {
            let sum = 0;
            itemGrns.forEach(g => {
                if (g.grns) {
                    Object.entries(g.grns).forEach(([grnNum, qty]) => {
                        if (associatedGrns.has(grnNum.toUpperCase().trim())) {
                            sum += parseInt(qty) || 0;
                        }
                    });
                } else {
                    const grnNum = (g.GRN_Number || '').trim().toUpperCase();
                    if (grnNum && associatedGrns.has(grnNum)) {
                        sum += parseInt(g.total_expected) || 0;
                    }
                }
            });
            if (sum > 0) return sum;
        }

        const fallbackSum = itemGrns
            .filter(g => matchRef(g.Import_Reference || g.import_ref || '', normalizedIr))
            .reduce((acc, curr) => acc + (parseInt(curr.total_expected) || 0), 0);
        if (fallbackSum > 0) return fallbackSum;

        if (directPoQty > 0) return directPoQty;

        return 0;
    } catch (err) {
        console.error("Error in getGRNExpectedQty:", err);
        return 0;
    }
};

/**
 * Obtiene de forma masiva las cantidades esperadas de GRN.
 */
export const getGRNExpectedQtyBulk = async (db, items) => {
    if (!items || items.length === 0) return {};
    if (isTauri()) return {}; // En Tauri se resuelve directamente desde Rust
    const resultMap = {};

    try {
        const uniqueIrs = new Set();
        items.forEach(item => {
            const ir = item.importRef || '';
            if (ir) uniqueIrs.add(ir.trim().toUpperCase());
        });

        const poInfoMap = new Map();
        const allPos = await db.getAll('po_lookup') || [];

        Array.from(uniqueIrs).forEach(ir => {
            const match = allPos.find(p => {
                const irVal = p.import_ref || p.import_reference || (p.type === 'ir' ? p.value : '') || '';
                return matchRef(irVal, ir);
            });
            if (match) poInfoMap.set(ir, match);
        });

        const allGrns = await db.getAll('grn_pending') || [];
        const grnsByItem = new Map();
        allGrns.forEach(g => {
            if (g.Item_Code) {
                const code = String(g.Item_Code).toUpperCase().trim();
                if (!grnsByItem.has(code)) grnsByItem.set(code, []);
                grnsByItem.get(code).push(g);
            }
        });

        items.forEach(item => {
            const importRef = item.importRef || '';
            const itemCode = item.itemCode || '';
            const key = `${itemCode}|${importRef}`;

            if (!importRef || !itemCode) {
                resultMap[key] = 0;
                return;
            }

            const normalizedIr = importRef.trim().toUpperCase();
            const normalizedCode = itemCode.trim().toUpperCase();
            const cleanCode = normalizedCode.replace(/[^A-Z0-9]/g, '');

            const poInfo = poInfoMap.get(normalizedIr);
            const associatedGrns = new Set();
            let directPoQty = 0;
            if (poInfo && poInfo.items) {
                poInfo.items.forEach(it => {
                    const itCode = String(it.item_code || '').toUpperCase().trim();
                    const itClean = itCode.replace(/[^A-Z0-9]/g, '');
                    if (itCode === normalizedCode || (cleanCode && itClean === cleanCode)) {
                        directPoQty += parseInt(it.qty || it.despatched_qty || 0) || 0;
                    }
                    const grnVal = it.grn ? String(it.grn).toUpperCase().trim() : '';
                    if (grnVal) {
                        grnVal.split(',').forEach(g => {
                            const gKey = g.trim();
                            if (gKey) associatedGrns.add(gKey);
                        });
                    }
                });
            }

            const itemGrns = grnsByItem.get(normalizedCode) || [];

            if (associatedGrns.size > 0) {
                let sum = 0;
                itemGrns.forEach(g => {
                    if (g.grns) {
                        Object.entries(g.grns).forEach(([grnNum, qty]) => {
                            if (associatedGrns.has(grnNum.toUpperCase().trim())) {
                                sum += parseInt(qty) || 0;
                            }
                        });
                    } else {
                        const grnNum = (g.GRN_Number || '').trim().toUpperCase();
                        if (grnNum && associatedGrns.has(grnNum)) {
                            sum += parseInt(g.total_expected) || 0;
                        }
                    }
                });
                if (sum > 0) {
                    resultMap[key] = sum;
                    return;
                }
            }

            const fallbackSum = itemGrns
                .filter(g => matchRef(g.Import_Reference || g.import_ref || '', normalizedIr))
                .reduce((acc, curr) => acc + (parseInt(curr.total_expected) || 0), 0);

            resultMap[key] = fallbackSum > 0 ? fallbackSum : directPoQty;
        });

        return resultMap;
    } catch (err) {
        console.error("Error in getGRNExpectedQtyBulk:", err);
        return {};
    }
};
