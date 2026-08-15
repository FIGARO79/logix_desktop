import { invoke } from '@tauri-apps/api/tauri';
import { getDB } from './offlineDb';

export const isTauri = () => {
    return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
};

/**
 * Invoca un comando nativo en Rust a través del canal IPC de Tauri.
 */
export const callTauriCommand = async (commandName, args = {}) => {
    if (isTauri()) {
        try {
            return await invoke(commandName, args);
        } catch (err) {
            console.error(`Error en comando Tauri '${commandName}':`, err);
            throw err;
        }
    }
    console.warn(`Tauri no está disponible en este entorno. Comando '${commandName}' omitido.`);
    return null;
};

/**
 * Puente para autenticación local
 */
export const tauriLogin = async (username, password) => {
    if (isTauri()) {
        return await invoke('login', { username, passwordHash: password });
    }
    // Fallback local en navegador para vista previa
    return { id: 1, username, role: 'admin' };
};

/**
 * Registro de nuevos usuarios localmente en SQLite
 */
export const tauriRegisterUser = async (username, password) => {
    if (isTauri()) {
        return await invoke('register_user', { username, passwordHash: password });
    }
    return "Usuario registrado exitosamente";
};

/**
 * Obtiene todos los usuarios registrados desde la base de datos SQLite
 */
export const tauriGetAllUsersAdmin = async () => {
    if (isTauri()) {
        return await invoke('get_all_users_admin');
    }
    return [{ id: 1, username: 'admin', role: 'admin', is_approved: true, permissions: 'stock,inbound,picking,inventory,planner,counts,admin' }];
};

/**
 * Elimina un usuario por ID en SQLite
 */
export const tauriDeleteUserAdmin = async (userId) => {
    if (isTauri()) {
        return await invoke('delete_user_admin', { userId });
    }
    return "Usuario eliminado";
};

/**
 * Restablece la contraseña de un usuario en SQLite
 */
export const tauriResetPasswordAdmin = async (userId, newPassword) => {
    if (isTauri()) {
        return await invoke('reset_user_password_admin', { userId, newPassword });
    }
    return "Contraseña actualizada";
};

/**
 * Parsea un archivo CSV/TSV/TXT local e inserta los datos masivamente en SQLite local / IndexedDB.
 */
export const processLocalCSVUpload = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                if (!text || typeof text !== 'string') {
                    resolve("El archivo seleccionado está vacío.");
                    return;
                }

                const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
                if (lines.length === 0) {
                    resolve("El archivo no contiene filas procesables.");
                    return;
                }

                // Detectar delimitador (coma, punto y coma, tabulación o barra vertical)
                const firstLine = lines[0];
                let delimiter = ',';
                if (firstLine.includes('\t')) delimiter = '\t';
                else if (firstLine.includes(';')) delimiter = ';';
                else if (firstLine.includes('|')) delimiter = '|';

                const rawHeaders = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

                const fileName = file.name.toLowerCase();
                const isPickingFile = fileName.includes('240') || fileName.includes('picking') || fileName.includes('salida') ||
                    rawHeaders.some(h => ['despatch', 'order_number', 'order number', 'despatch_number', 'despatch number', 'customer_code', 'customer code'].includes(h));

                const isGrnFile = fileName.includes('280') || fileName.includes('grn') || fileName.includes('entradas') ||
                    (rawHeaders.some(h => ['grn', 'grn_number', 'import_ref', 'import_reference', 'referencia_importacion'].includes(h)) && !isPickingFile);

                const isXdockFile = fileName.includes('0006') || fileName.includes('xdock') || fileName.includes('crossdock') || fileName.includes('reservas') ||
                    rawHeaders.some(h => ['reserved_qty', 'xdock', 'crossdock'].includes(h));

                const isPoLookupFile = fileName.includes('po_extractor') || fileName.includes('purchase order') || fileName.includes('extractor') ||
                    (rawHeaders.includes('waybill') && (rawHeaders.includes('import_ref') || rawHeaders.includes('import_reference')));

                // 1. ARCHIVO 240 (Salidas Picking)
                if (isPickingFile) {
                    const ordersMap = {}; // { 'order_despatch': { order_number, despatch_number, customer_code, customer_name, print_date, items: [] } }

                    const hasHeader = rawHeaders.some(h =>
                        ['order', 'pedido', 'despatch', 'despacho', 'item', 'codigo', 'código', 'material', 'sku', 'cliente', 'customer'].includes(h)
                    );
                    const startIdx = hasHeader ? 1 : 0;

                    for (let i = startIdx; i < lines.length; i++) {
                        const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
                        if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

                        const row = {};
                        if (hasHeader) {
                            rawHeaders.forEach((h, idx) => {
                                row[h] = values[idx] || '';
                            });
                        }

                        let order_number = row['order_number'] || row['order number'] || row['order'] || row['pedido'] || row['numero_pedido'] || row['no_pedido'] || row['documento'] || values[0] || '';
                        let despatch_number = row['despatch_number'] || row['despatch number'] || row['despatch'] || row['despacho'] || row['nota_entrega'] || row['entrega'] || values[1] || '00';
                        let customer_code = row['customer_code'] || row['customer code'] || row['cliente'] || row['codigo_cliente'] || row['código_cliente'] || row['cod_cliente'] || (values[2] || 'N/A');
                        let customer_name = row['customer_name'] || row['customer name'] || row['nombre_cliente'] || row['cliente_nombre'] || row['nombre'] || (values[3] || 'Cliente General');
                        let item_code = row['item_code'] || row['item code'] || row['item'] || row['codigo'] || row['código'] || row['material'] || row['sku'] || (values[4] || '');
                        let description = row['item_description'] || row['item description'] || row['description'] || row['descripcion'] || row['descripción'] || row['texto breve'] || (values[5] || '');
                        let order_line = row['order_line'] || row['order line'] || row['linea'] || row['línea'] || row['posicion'] || (values[6] || (i - startIdx + 1).toString());
                        let qty = parseInt(row['qty'] || row['quantity'] || row['cantidad'] || row['cant'] || row['qty_req'] || values[7] || '0', 10) || 0;
                        let rawDate = row['print_date'] || row['print date'] || row['fecha_impresion'] || row['fecha'] || values[8] || new Date().toISOString().split('T')[0];

                        let print_date = rawDate.split(' ')[0] || rawDate.split('T')[0];
                        if (print_date.includes('/')) {
                            const dateParts = print_date.split('/');
                            if (dateParts.length === 3) {
                                if (dateParts[0].length === 4) {
                                    print_date = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
                                } else {
                                    print_date = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;
                                }
                            }
                        }

                        if (!order_number || !item_code) continue;

                        const cleanOrder = order_number.trim();
                        const cleanDespatch = despatch_number.trim();
                        const key = `${cleanOrder}_${cleanDespatch}`;

                        if (!ordersMap[key]) {
                            ordersMap[key] = {
                                order_number: cleanOrder,
                                despatch_number: cleanDespatch,
                                customer_code: customer_code.trim(),
                                customer_name: customer_name.trim(),
                                print_date: print_date,
                                items: []
                            };
                        }

                        ordersMap[key].items.push({
                            'Customer Code': customer_code.trim(),
                            'Customer Name': customer_name.trim(),
                            'Item Code': item_code.toUpperCase().trim(),
                            'Item Description': description.trim(),
                            'Order Line': order_line.toString().trim(),
                            'Qty': qty
                        });
                    }

                    const keys = Object.keys(ordersMap);
                    if (keys.length === 0) {
                        resolve("No se encontraron pedidos de picking válidos en el archivo 240.");
                        return;
                    }

                    const db = await getDB();
                    const txTracking = db.transaction('picking_tracking', 'readwrite');
                    const trackingStore = txTracking.objectStore('picking_tracking');
                    let totalLines = 0;
                    for (const key of keys) {
                        const orderData = ordersMap[key];
                        totalLines += orderData.items.length;
                        await trackingStore.put({
                            order_number: orderData.order_number,
                            despatch_number: orderData.despatch_number,
                            customer_code: orderData.customer_code,
                            customer_name: orderData.customer_name,
                            total_lines: orderData.items.length,
                            print_date: orderData.print_date,
                            is_audited: false
                        });
                    }
                    await txTracking.done;

                    const txOrders = db.transaction('picking_orders', 'readwrite');
                    const ordersStore = txOrders.objectStore('picking_orders');
                    for (const key of keys) {
                        const orderData = ordersMap[key];
                        await ordersStore.put({
                            id: key,
                            order: orderData.order_number,
                            despatch: orderData.despatch_number,
                            data: orderData.items
                        });
                    }
                    await txOrders.done;

                    const txMeta = db.transaction('sync_metadata', 'readwrite');
                    await txMeta.objectStore('sync_metadata').put({ key: 'picking', value: Math.floor(Date.now() / 1000) });
                    await txMeta.done;

                    resolve(`Se cargaron ${keys.length} pedidos de picking (${totalLines} líneas) en la base de datos local.`);
                    return;
                }

                // 2. ARCHIVO 280 (Entradas GRN)
                if (isGrnFile) {
                    const grnMap = {};
                    const hasHeader = rawHeaders.some(h => ['item', 'codigo', 'código', 'material', 'sku', 'grn', 'pedido', 'cantidad'].includes(h));
                    const startIdx = hasHeader ? 1 : 0;

                    for (let i = startIdx; i < lines.length; i++) {
                        const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
                        if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

                        const row = {};
                        if (hasHeader) {
                            rawHeaders.forEach((h, idx) => { row[h] = values[idx] || ''; });
                        }

                        let item_code = row['item_code'] || row['item'] || row['codigo'] || row['código'] || row['sku'] || row['material'] || values[0] || '';
                        let grn_number = row['grn'] || row['grn_number'] || row['pedido'] || row['po_number'] || row['referencia'] || values[1] || 'GRN_LOCAL';
                        let qty = parseFloat((row['total_expected'] || row['expected_qty'] || row['qty'] || row['cantidad'] || row['cant_esperada'] || values[2] || '0').toString().replace(',', '.')) || 0;
                        let import_ref = row['import_ref'] || row['import_reference'] || row['referencia_importacion'] || row['referencia'] || values[3] || '';

                        if (!item_code) continue;
                        const cleanCode = item_code.toUpperCase().trim();
                        const cleanGrn = grn_number.trim().toUpperCase();

                        if (!grnMap[cleanCode]) {
                            grnMap[cleanCode] = { Item_Code: cleanCode, grns: {}, total_expected: 0, Import_Reference: import_ref };
                        }

                        grnMap[cleanCode].grns[cleanGrn] = (grnMap[cleanCode].grns[cleanGrn] || 0) + qty;
                        grnMap[cleanCode].total_expected += qty;
                        if (import_ref && !grnMap[cleanCode].Import_Reference) {
                            grnMap[cleanCode].Import_Reference = import_ref;
                        }
                    }

                    const db = await getDB();
                    const tx = db.transaction('grn_pending', 'readwrite');
                    const store = tx.objectStore('grn_pending');
                    let totalItems = 0;
                    for (const [code, data] of Object.entries(grnMap)) {
                        await store.put(data);
                        totalItems++;
                    }
                    await tx.done;

                    const txMeta = db.transaction('sync_metadata', 'readwrite');
                    await txMeta.objectStore('sync_metadata').put({ key: 'grn_pending', value: Math.floor(Date.now() / 1000) });
                    await txMeta.done;

                    resolve(`Se cargaron ${totalItems} registros de Entradas GRN (280) en la base de datos local.`);
                    return;
                }

                // 3. ARCHIVO 0006 (Reservas Xdock)
                if (isXdockFile) {
                    const xdockMap = {};
                    const hasHeader = rawHeaders.some(h => ['item', 'codigo', 'código', 'material', 'sku', 'reserved_qty', 'cantidad', 'cliente'].includes(h));
                    const startIdx = hasHeader ? 1 : 0;

                    for (let i = startIdx; i < lines.length; i++) {
                        const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
                        if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

                        const row = {};
                        if (hasHeader) {
                            rawHeaders.forEach((h, idx) => { row[h] = values[idx] || ''; });
                        }

                        let item_code = row['item_code'] || row['item'] || row['codigo'] || row['código'] || row['sku'] || row['material'] || values[0] || '';
                        let qty = parseFloat((row['reserved_qty'] || row['total'] || row['qty'] || row['cantidad'] || values[1] || '0').toString().replace(',', '.')) || 0;
                        let customer = row['customer_name'] || row['customer'] || row['cliente'] || row['nombre_cliente'] || values[2] || 'Cliente General';
                        let po_number = row['po_number'] || row['po_date'] || row['po'] || values[3] || '';

                        if (!item_code) continue;
                        const cleanCode = item_code.toUpperCase().trim();

                        if (!xdockMap[cleanCode]) {
                            xdockMap[cleanCode] = { Item_Code: cleanCode, total: 0, reserved_qty: 0, customers: new Set(), po_number };
                        }

                        xdockMap[cleanCode].total += qty;
                        xdockMap[cleanCode].reserved_qty += qty;
                        if (customer) xdockMap[cleanCode].customers.add(customer.trim());
                    }

                    const db = await getDB();
                    const tx = db.transaction('xdock_reservations', 'readwrite');
                    const store = tx.objectStore('xdock_reservations');
                    let totalItems = 0;
                    for (const [code, data] of Object.entries(xdockMap)) {
                        const custArr = Array.from(data.customers);
                        await store.put({
                            Item_Code: code,
                            total: data.total,
                            reserved_qty: data.reserved_qty,
                            customers: custArr,
                            customer_name: custArr.join(' / '),
                            po_number: data.po_number
                        });
                        totalItems++;
                    }
                    await tx.done;

                    const txMeta = db.transaction('sync_metadata', 'readwrite');
                    await txMeta.objectStore('sync_metadata').put({ key: 'xdock_reservations', value: Math.floor(Date.now() / 1000) });
                    await txMeta.done;

                    resolve(`Se cargaron ${totalItems} registros de Reservas Xdock (0006) en la base de datos local.`);
                    return;
                }

                // 4. PO Extractor / PO Lookup
                if (isPoLookupFile) {
                    const hasHeader = rawHeaders.some(h => ['waybill', 'import_ref', 'import_reference', 'item'].includes(h));
                    const startIdx = hasHeader ? 1 : 0;

                    const db = await getDB();
                    const tx = db.transaction('po_lookup', 'readwrite');
                    const store = tx.objectStore('po_lookup');

                    let count = 0;
                    for (let i = startIdx; i < lines.length; i++) {
                        const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
                        if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

                        const row = {};
                        if (hasHeader) {
                            rawHeaders.forEach((h, idx) => { row[h] = values[idx] || ''; });
                        }

                        let waybill = (row['waybill'] || values[0] || '').trim().toUpperCase();
                        let import_ref = (row['import_ref'] || row['import_reference'] || values[1] || '').trim().toUpperCase();

                        if (waybill) {
                            await store.put({ id: `wb_${waybill}`, type: 'wb', value: waybill, import_ref });
                            count++;
                        }
                        if (import_ref) {
                            await store.put({ id: `ir_${import_ref}`, type: 'ir', value: import_ref, waybill });
                            count++;
                        }
                    }
                    await tx.done;

                    const txMeta = db.transaction('sync_metadata', 'readwrite');
                    await txMeta.objectStore('sync_metadata').put({ key: 'po_extractor', value: Math.floor(Date.now() / 1000) });
                    await txMeta.done;

                    resolve(`Se cargaron ${count} relaciones de PO Extractor / Lookup en la base de datos local.`);
                    return;
                }

                // 5. ARCHIVO 250 (Maestro de Ítems / General)
                const itemsToInsert = [];
                const hasHeader = rawHeaders.some(h =>
                    ['item', 'codigo', 'código', 'material', 'sku', 'descripcion', 'descripción', 'bin', 'ubicacion', 'ubicación', 'cantidad'].includes(h)
                );

                const startIdx = hasHeader ? 1 : 0;

                for (let i = startIdx; i < lines.length; i++) {
                    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
                    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

                    const row = {};
                    if (hasHeader) {
                        rawHeaders.forEach((h, idx) => {
                            row[h] = values[idx] || '';
                        });
                    }

                    // Búsqueda flexible de campos
                    let item_code = row['item_code'] || row['item'] || row['codigo'] || row['código'] || row['sku'] || row['material'] || row['item_no'] || row['articulo'] || row['artículo'] || values[0];
                    let description = row['item_description'] || row['description'] || row['descripcion'] || row['descripción'] || row['texto breve'] || row['denominacion'] || row['denominación'] || (values[1] || '');
                    let bin_location = row['bin_1'] || row['bin_location'] || row['ubicacion'] || row['ubicación'] || row['bin'] || row['almacen'] || row['almacén'] || (values[2] || 'N/A');
                    let system_qty = parseFloat((row['system_qty'] || row['quantity'] || row['cantidad'] || values[3] || '0').toString().replace(',', '.')) || 0;
                    let unit_cost = parseFloat((row['unit_cost'] || row['cost'] || row['costo'] || row['precio'] || values[4] || '0').toString().replace(',', '.')) || 0;
                    let weight_per_unit = parseFloat((row['weight_per_unit'] || row['weight'] || row['peso'] || values[5] || '0').toString().replace(',', '.')) || 0;
                    let sic_code = row['sic_code'] || row['sic'] || '0';

                    if (item_code && item_code.trim() !== '') {
                        const cleanCode = item_code.toUpperCase().trim();
                        if (!['ITEM', 'CODIGO', 'CÓDIGO', 'MATERIAL', 'SKU', 'ITEM_CODE'].includes(cleanCode)) {
                            itemsToInsert.push({
                                item_code: cleanCode,
                                description: description.trim(),
                                bin_location: bin_location.trim(),
                                system_qty,
                                unit_cost,
                                weight_per_unit,
                                sic_code: sic_code.toString().trim()
                            });
                        }
                    }
                }

                if (itemsToInsert.length > 0) {
                    let resMsg = '';
                    if (isTauri()) {
                        resMsg = await invoke('add_inventory_items_bulk', { items: itemsToInsert });
                    }

                    const db = await getDB();
                    const txMaster = db.transaction('master_items', 'readwrite');
                    const masterStore = txMaster.objectStore('master_items');
                    for (const item of itemsToInsert) {
                        await masterStore.put({
                            Item_Code: item.item_code,
                            Item_Description: item.description,
                            Bin_Location: item.bin_location,
                            System_Qty: item.system_qty,
                            Unit_Cost: item.unit_cost,
                            Weight_Per_Unit: item.weight_per_unit,
                            SIC_Code: item.sic_code
                        });
                    }
                    await txMaster.done;

                    const txMeta = db.transaction('sync_metadata', 'readwrite');
                    await txMeta.objectStore('sync_metadata').put({ key: 'master_items', value: Math.floor(Date.now() / 1000) });
                    await txMeta.done;

                    resolve(resMsg || `Se cargaron ${itemsToInsert.length} registros en el Maestro de Ítems (250) local`);
                } else {
                    resolve("No se encontraron registros de inventario procesables en el archivo");
                }
            } catch (err) {
                console.error("Error al procesar archivo local:", err);
                resolve("Error al procesar el archivo localmente");
            }
        };
        reader.onerror = () => reject("Error al leer el archivo");
        reader.readAsText(file);
    });
};

/**
 * Extrae los números de GRN/Pedido de un archivo 280/GRN localmente.
 */
export const previewLocalGRNFile = async (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                if (!text || typeof text !== 'string') {
                    resolve([]);
                    return;
                }

                const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                if (lines.length <= 1) {
                    resolve([]);
                    return;
                }

                const delimiter = lines[0].includes(';') ? ';' : (lines[0].includes('\t') ? '\t' : ',');
                const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

                const grnSet = new Set();
                const grnColIdx = headers.findIndex(h =>
                    ['grn', 'grn_number', 'pedido', 'po_number', 'documento', 'referencia', 'po', 'grn_master'].includes(h)
                );

                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
                    let val = (grnColIdx !== -1 && values[grnColIdx]) ? values[grnColIdx] : values[0];
                    if (val && val.trim() !== '' && !['GRN', 'PEDIDO', 'PO'].includes(val.toUpperCase())) {
                        grnSet.add(val.trim());
                    }
                }

                resolve(Array.from(grnSet));
            } catch (err) {
                console.error("Error previsualizando GRNs localmente:", err);
                resolve([]);
            }
        };
        reader.onerror = () => resolve([]);
        reader.readAsText(file);
    });
};





/**
 * Obtiene los detalles de un ítem para etiquetado desde la base de datos local SQLite.
 */
export const tauriGetItemDetails = async (itemCode) => {
    if (isTauri()) {
        return await invoke('get_item_details', { itemCode });
    }
    return {
        item_code: itemCode.toUpperCase(),
        description: 'DESCRIPCIÓN DE PRUEBA LOCAL',
        bin_location: 'A-01-02',
        additional_bins: 'B-02-01',
        weight_kg: 2.5
    };
};

/**
 * Obtiene los datos de reconciliación de inventario consolidado desde Rust (IPC).
 */
export const tauriGetReconciliationData = async (qtyTolerance = 0.05, valTolerance = 50.0) => {
    if (isTauri()) {
        return await invoke('get_reconciliation_data', { qtyTolerance, valTolerance });
    }
    return [];
};

/**
 * Obtiene los KPIs y estadísticas globales de inventario desde Rust (IPC).
 */
export const tauriGetReconciliationStats = async () => {
    if (isTauri()) {
        return await invoke('get_reconciliation_stats');
    }
    return {
        total_items: 0,
        counted_items_count: 0,
        progress_percentage: 0,
        total_system_units: 0,
        total_counted_units: 0,
        total_system_value: 0,
        total_counted_value: 0,
        net_variance_value: 0,
        abs_variance_value: 0,
        accuracy_percentage: 100
    };
};


