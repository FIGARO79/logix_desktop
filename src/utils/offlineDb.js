import { openDB } from 'idb';

const DB_NAME = 'LogixOfflineDB';
const DB_VERSION = 9;

const initDB = async () => {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db, _oldVersion) {
            // Tabla para registros de Inbound que aún no se han subido
            if (!db.objectStoreNames.contains('pending_sync')) {
                db.createObjectStore('pending_sync', { keyPath: 'id' });
            }

            // Tabla para caché de datos de consulta genérica
            if (!db.objectStoreNames.contains('data_cache')) {
                db.createObjectStore('data_cache', { keyPath: 'key' });
            }

            // Tabla para el maestro de items (Caché local)
            if (!db.objectStoreNames.contains('master_items')) {
                const itemStore = db.createObjectStore('master_items', { keyPath: 'Item_Code' });
                itemStore.createIndex('by-description', 'Item_Description');
            }

            // Tabla para metadatos de sincronización
            if (!db.objectStoreNames.contains('sync_metadata')) {
                db.createObjectStore('sync_metadata', { keyPath: 'key' });
            }

            // Tabla para PO Lookup (Matches de Waybill / Import Ref)
            if (!db.objectStoreNames.contains('po_lookup')) {
                db.createObjectStore('po_lookup', { keyPath: 'id' });
            }

            // Tabla para GRN Pending
            if (!db.objectStoreNames.contains('grn_pending')) {
                db.createObjectStore('grn_pending', { keyPath: 'Item_Code' });
            }

            // Tabla para Xdock
            if (!db.objectStoreNames.contains('xdock_reservations')) {
                db.createObjectStore('xdock_reservations', { keyPath: 'Item_Code' });
            }

            // --- Nuevas tablas Versión 3 ---
            if (!db.objectStoreNames.contains('planner_daily_items')) {
                db.createObjectStore('planner_daily_items', { keyPath: 'id' }); // id será date_itemcode
            }

            // --- Nuevas tablas Versión 4 (Picking & Counts) ---
            if (!db.objectStoreNames.contains('picking_tracking')) {
                db.createObjectStore('picking_tracking', { keyPath: 'order_number' });
            }
            if (!db.objectStoreNames.contains('picking_orders')) {
                db.createObjectStore('picking_orders', { keyPath: 'id' }); // id será order_despatch
            }
            if (!db.objectStoreNames.contains('active_sessions')) {
                db.createObjectStore('active_sessions', { keyPath: 'type' }); // type: 'cycle_count'
            }
        },
    });
};

export const getDB = () => initDB();

/**
 * Guarda un registro pendiente en la cola de sincronización.
 * @param {string} collection Nombre de la colección (opcional para logs genéricos)
 * @param {object} payload Datos a sincronizar
 * @param {number|string} editId ID real en BD si es una edición
 */
export const savePendingSync = async (collection, payload, editId = null) => {
    const db = await getDB();
    // Generar UUID si no existe uno previo
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
 * @param {string} key Identificador de la caché
 * @param {any} data Datos a guardar
 */
export const cacheData = async (key, data) => {
    const db = await getDB();
    await db.put('data_cache', { key, data, timestamp: new Date().toISOString() });
};

/**
 * Recupera datos de la caché genérica.
 * @param {string} key Identificador de la caché
 */
export const getCachedData = async (key) => {
    const db = await getDB();
    const result = await db.get('data_cache', key);
    return result ? result.data : null;
};

/**
 * Obtiene la cantidad esperada de GRN para un SKU e IR, basándose en las GRNs asociadas de po_lookup.
 */
export const getGRNExpectedQty = async (db, itemCode, importRef) => {
    if (!importRef || !itemCode) return 0;
    const normalizedIr = importRef.trim().toUpperCase();
    const normalizedCode = itemCode.trim().toUpperCase();

    try {
        // 1. Obtener GRNs asociadas a la IR desde po_lookup
        const poInfo = await db.get('po_lookup', `ir_${normalizedIr}`);
        const associatedGrns = new Set();
        if (poInfo && poInfo.items) {
            poInfo.items.forEach(it => {
                const grnVal = it.grn ? String(it.grn).toUpperCase().trim() : '';
                if (grnVal) {
                    grnVal.split(',').forEach(g => {
                        const gKey = g.trim();
                        if (gKey) {
                            associatedGrns.add(gKey);
                        }
                    });
                }
            });
        }

        // 2. Obtener todos los registros de grn_pending
        const allGrns = await db.getAll('grn_pending') || [];
        const itemGrns = allGrns.filter(g => String(g.Item_Code).toUpperCase().trim() === normalizedCode);

        // 3. Si tenemos GRNs asociadas, buscar en el objeto grns
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

        // 4. Fallback: buscar por Import_Reference === normalizedIr en registros de GRN (reporte 280)
        const fallbackSum = itemGrns
            .filter(g => String(g.Import_Reference || '').toUpperCase().trim() === normalizedIr)
            .reduce((acc, curr) => acc + (parseInt(curr.total_expected) || 0), 0);
        return fallbackSum;
    } catch (err) {
        console.error("Error in getGRNExpectedQty:", err);
        return 0;
    }
};

/**
 * Obtiene de forma masiva las cantidades esperadas de GRN para una lista de SKUs e IRs,
 * cargando toda la tabla grn_pending una sola vez en memoria y resolviendo po_lookup en paralelo.
 * @param {object} db Instancia de IndexedDB
 * @param {Array<{itemCode: string, importRef: string}>} items Lista de ítems a consultar
 * @returns {Promise<Object>} Un mapa con claves "itemCode|importRef" y sus respectivas cantidades esperadas.
 */
export const getGRNExpectedQtyBulk = async (db, items) => {
    if (!items || items.length === 0) return {};
    const resultMap = {};

    try {
        const uniqueIrs = new Set();
        items.forEach(item => {
            const ir = item.importRef || '';
            if (ir) {
                uniqueIrs.add(ir.trim().toUpperCase());
            }
        });

        // 1. Obtener po_lookup para las IR únicas en paralelo
        const poInfoMap = new Map();
        await Promise.all(Array.from(uniqueIrs).map(async ir => {
            try {
                const poInfo = await db.get('po_lookup', `ir_${ir}`);
                if (poInfo) {
                    poInfoMap.set(ir, poInfo);
                }
            } catch (e) {
                console.error(`Error al consultar po_lookup para IR ${ir}:`, e);
            }
        }));

        // 2. Obtener todos los registros de grn_pending de una sola vez
        const allGrns = await db.getAll('grn_pending') || [];

        // 3. Indexar grn_pending por SKU para búsqueda rápida
        const grnsByItem = new Map();
        allGrns.forEach(g => {
            if (g.Item_Code) {
                const code = String(g.Item_Code).toUpperCase().trim();
                if (!grnsByItem.has(code)) {
                    grnsByItem.set(code, []);
                }
                grnsByItem.get(code).push(g);
            }
        });

        // 4. Calcular el total esperado para cada ítem solicitado
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

            const poInfo = poInfoMap.get(normalizedIr);
            const associatedGrns = new Set();
            if (poInfo && poInfo.items) {
                poInfo.items.forEach(it => {
                    const grnVal = it.grn ? String(it.grn).toUpperCase().trim() : '';
                    if (grnVal) {
                        grnVal.split(',').forEach(g => {
                            const gKey = g.trim();
                            if (gKey) {
                                associatedGrns.add(gKey);
                            }
                        });
                    }
                });
            }

            const itemGrns = grnsByItem.get(normalizedCode) || [];

            let sum = 0;
            if (associatedGrns.size > 0) {
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
            }

            if (sum > 0) {
                resultMap[key] = sum;
            } else {
                // Fallback: buscar por Import_Reference === normalizedIr en registros de GRN (reporte 280)
                const fallbackSum = itemGrns
                    .filter(g => String(g.Import_Reference || '').toUpperCase().trim() === normalizedIr)
                    .reduce((acc, curr) => acc + (parseInt(curr.total_expected) || 0), 0);
                resultMap[key] = fallbackSum;
            }
        });
    } catch (err) {
        console.error("Error en getGRNExpectedQtyBulk:", err);
    }

    return resultMap;
};
