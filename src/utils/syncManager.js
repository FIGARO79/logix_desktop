import { getDB } from './offlineDb';

/**
 * Sincroniza los datos maestros (Items, GRN, XDock, PO Lookup) desde el servidor a IndexedDB.
 */
export const downloadMasterData = async () => {
    try {
        const res = await fetch('/api/sync/master_data');
        if (!res.ok) throw new Error('Error al descargar datos maestros');
        
        const data = await res.json();
        const db = await getDB();
        
        const tx = db.transaction(['master_items', 'grn_pending', 'xdock_reservations', 'po_lookup', 'sync_metadata'], 'readwrite');
        
        // Limpiar y cargar Master Items
        const itemStore = tx.objectStore('master_items');
        await itemStore.clear();
        for (const item of data.master_items) {
            if (item && item.Item_Code) {
                itemStore.put(item);
            }
        }
        
        // Cargar GRN Pending
        const grnStore = tx.objectStore('grn_pending');
        await grnStore.clear();
        for (const [code, info] of Object.entries(data.grn_pending)) {
            if (code && code !== 'null' && code !== 'undefined') {
                if (info && typeof info === 'object') {
                    grnStore.put({ Item_Code: code, grns: info.grns, total_expected: info.total_expected });
                } else {
                    grnStore.put({ Item_Code: code, total_expected: info });
                }
            }
        }
        
        // Cargar Xdock
        const xdockStore = tx.objectStore('xdock_reservations');
        await xdockStore.clear();
        for (const [code, info] of Object.entries(data.xdock_reservations)) {
            if (code && code !== 'null' && code !== 'undefined') {
                if (typeof info === 'object' && info !== null) {
                    const totalVal = info.total !== undefined ? info.total : (info.reserved_qty !== undefined ? info.reserved_qty : 0);
                    let custArr = [];
                    if (Array.isArray(info.customers)) {
                        custArr = info.customers;
                    } else if (info.customer_name) {
                        custArr = [info.customer_name];
                    }
                    const custNameStr = typeof info.customer_name === 'string' && info.customer_name ? info.customer_name : custArr.map(c => typeof c === 'object' ? (c.name || c.customer_name || 'Desconocido') : c).join(' / ');
                    xdockStore.put({ Item_Code: code, total: totalVal, customers: custArr, reserved_qty: totalVal, customer_name: custNameStr, po_number: info.po_number || info.po_date || '' });
                } else {
                    const totalVal = Number(info) || 0;
                    xdockStore.put({ Item_Code: code, total: totalVal, customers: [] });
                }
            }
        }
        
        // Cargar PO Lookup
        const poStore = tx.objectStore('po_lookup');
        await poStore.clear();
        
        const poPromises = [];
        if (data.po_lookup.wb_to_data) {
            for (const [wb, info] of Object.entries(data.po_lookup.wb_to_data)) {
                if (!wb) continue;
                const normalizedWb = wb.trim().toUpperCase();
                poPromises.push(poStore.put({ 
                    id: `wb_${normalizedWb}`, 
                    type: 'wb', 
                    value: normalizedWb, 
                    import_ref: info.import_ref 
                }));
            }
        }
        if (data.po_lookup.ir_to_data) {
            for (const [ir, info] of Object.entries(data.po_lookup.ir_to_data)) {
                if (!ir) continue;
                const normalizedIr = ir.trim().toUpperCase();
                poPromises.push(poStore.put({ 
                    id: `ir_${normalizedIr}`, 
                    type: 'ir', 
                    value: normalizedIr, 
                    waybill: info.waybill,
                    items: info.items
                }));
            }
        }
        await Promise.all(poPromises);
        
        // Guardar timestamp de sincronización
        const metaStore = tx.objectStore('sync_metadata');
        await metaStore.put({ key: 'last_master_sync', value: Date.now() });
        
        await tx.done;
        console.log('✅ Sincronización de maestros completada.');
        return true;
    } catch (error) {
        console.error('❌ Error en downloadMasterData:', error);
        return false;
    }
};

/**
 * Sincroniza los registros pendientes hacia el servidor (Inbound, Planner, Picking, Counts).
 */
export const syncPendingData = async () => {
    if (!navigator.onLine) return;
    
    const db = await getDB();
    const allPending = await db.getAll('pending_sync');
    
    if (allPending.length === 0) return;
    
    console.log(`Logix: Intentando sincronizar ${allPending.length} registros pendientes...`);
    
    let successCount = 0;
    let failCount = 0;

    for (const record of allPending) {
        try {
            // Determinar endpoint según la colección
            let url = '';
            let method = '';
            
            if (record.collection === 'inbound') {
                url = record.editId ? `/api/update_log/${record.editId}` : '/api/add_log';
                method = record.editId ? 'PUT' : 'POST';
            } else if (record.collection === 'planner') {
                url = '/api/planner/execution/save';
                method = 'POST';
            } else if (record.collection === 'picking') {
                url = '/api/save_picking_audit';
                method = 'POST';
            } else if (record.collection === 'counts') {
                url = '/api/w2w/save_count';
                method = 'POST';
                if (!record.payload.session_id) {
                    try {
                        let activeSess = await db.get('active_sessions', 'cycle_count');
                        if (!activeSess && navigator.onLine) {
                            const sessRes = await fetch('/api/sessions/active');
                            if (sessRes.ok) {
                                const fetchedSess = await sessRes.json();
                                if (fetchedSess && (fetchedSess.id || fetchedSess.session_id)) {
                                    activeSess = fetchedSess;
                                    await db.put('active_sessions', { type: 'cycle_count', ...activeSess });
                                }
                            }
                        }
                        const sId = activeSess ? (activeSess.id || activeSess.session_id) : null;
                        if (sId) {
                            record.payload.session_id = sId;
                            console.log(`Logix Sync: Recuperado session_id (${sId}) para registro de conteo.`);
                        } else {
                            console.warn(`Logix Sync: No se pudo recuperar session_id para registro ${record.id}`);
                        }
                    } catch (err) {
                        console.error("Error al intentar recuperar session_id en sync:", err);
                    }
                }
            } else if (record.collection === 'spot_check') {
                url = '/api/spot_check/save';
                method = 'POST';
            } else {
                console.warn(`Colección desconocida en sync: ${record.collection}`);
                continue;
            }

            const payload = {
                ...record.payload,
                client_id: record.id
            };

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                await db.delete('pending_sync', record.id);
                console.log(`✅ Registro ${record.id} (${record.collection}) sincronizado.`);
                successCount++;
            } else if (res.status === 409) {
                // Conflicto: borrar localmente y dejar que el servidor gane
                await db.delete('pending_sync', record.id);
                console.log(`⚠️ Conflicto detectado (409) para ${record.id}. Registro local eliminado.`);
                successCount++;
            } else if (res.status >= 400 && res.status < 500) {
                // Error de cliente (400 Bad Request, etc): probablemente datos inválidos
                console.error(`❌ Error de validación/cliente (${res.status}) para ${record.id}:`, await res.text());
                failCount++;
                // En Inbound, si el error es permanente (ej. datos inválidos), 
                // podríamos querer eliminarlo o marcarlo, pero por ahora lo dejamos para no perder datos.
            } else {
                console.error(`❌ Error de servidor (${res.status}) al sincronizar ${record.id}`);
                failCount++;
            }
        } catch (error) {
            console.error(`🚨 Fallo crítico de red al sincronizar ${record.id}:`, error);
            failCount++;
            break; // Detener si hay fallo de red real para no saturar
        }
    }

    if (successCount > 0 || failCount > 0) {
        console.log(`Logix Sync: ${successCount} exitosos, ${failCount} fallidos.`);
    }
};

/**
 * Descarga y cachea los pedidos recientes de picking.
 */
export const downloadPickingTracking = async () => {
    if (!navigator.onLine) return null;
    try {
        const res = await fetch('/api/picking/tracking', { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        const db = await getDB();
        const tx = db.transaction('picking_tracking', 'readwrite');
        const store = tx.objectStore('picking_tracking');
        await store.clear();
        for (const t of data) {
            await store.put(t);
        }
        await tx.done;
        return data;
    } catch (e) {
        console.error(e);
        return null;
    }
};

/**
 * Descarga y cachea el detalle de un pedido de picking.
 */
export const downloadPickingOrder = async (order, despatch) => {
    if (!navigator.onLine) return null;
    try {
        const res = await fetch(`/api/picking/order/${order}/${despatch}`, { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        const db = await getDB();
        await db.put('picking_orders', {
            id: `${order}_${despatch}`,
            order,
            despatch,
            data,
            timestamp: Date.now()
        });
        return data;
    } catch (e) {
        console.error(e);
        return null;
    }
};

// Mantener compatibilidad con el nombre anterior
export const syncPendingInbound = syncPendingData;

/**
 * Verifica si el maestro local está desactualizado comparando timestamps con el servidor.
 */
export const checkAndSyncIfNeeded = async () => {
    if (!navigator.onLine) return false;
    
    try {
        const res = await fetch('/api/sync/status');
        if (!res.ok) return false;
        const serverStatus = await res.json();
        
        const db = await getDB();
        const lastSyncMeta = await db.get('sync_metadata', 'last_master_sync_server');
        const lastLocalSync = lastSyncMeta ? lastSyncMeta.value : 0;
        
        // Calcular el MTIME máximo de TODOS los archivos maestros clave reportados por el servidor
        const relevantMtimes = Object.values(serverStatus).filter(v => typeof v === 'number');
        const maxServerMtime = Math.max(...relevantMtimes, 0);
        
        // Si el MTIME máximo en el servidor es mayor que nuestra última sincronización local
        if (maxServerMtime > lastLocalSync) {
            console.log('Logix: Datos maestros desactualizados (GRN u otros). Sincronizando en segundo plano...');
            const success = await downloadMasterData();
            if (success) {
                const tx = db.transaction('sync_metadata', 'readwrite');
                await tx.objectStore('sync_metadata').put({ 
                    key: 'last_master_sync_server', 
                    value: maxServerMtime 
                });
                await tx.done;
                return true; // Indica que se realizó una sincronización
            }
        }
    } catch (e) {
        console.error('Error en checkAndSyncIfNeeded:', e);
    }
    return false;
};
