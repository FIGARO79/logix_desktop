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

                if (isPickingFile) {
                    // Procesar como alistamiento de picking (240)
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

                        // Normalizar fecha a YYYY-MM-DD
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

                // Si no es 240, procesar como maestro de inventario (250 / General)
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
                        // Descartar palabras clave de encabezado repetidas
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
                    if (isTauri()) {
                        const resMsg = await invoke('add_inventory_items_bulk', { items: itemsToInsert });
                        resolve(resMsg || `Se cargaron ${itemsToInsert.length} registros en SQLite local`);
                    } else {
                        resolve(`Se procesaron ${itemsToInsert.length} registros localmente`);
                    }
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


