import { invoke } from '@tauri-apps/api/tauri';
import { getDB } from './offlineDb';
import * as XLSX from 'xlsx';

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
 * Muestra un diálogo de confirmación asíncrono no bloqueante del hilo principal.
 */
export const confirmNative = async (message, title = "Confirmación") => {
    if (isTauri()) {
        try {
            const { ask } = await import('@tauri-apps/api/dialog');
            return await ask(message, { title, type: 'warning' });
        } catch (e) {
            console.warn("Fallback to window.confirm:", e);
        }
    }
    return window.confirm(message);
};

export const parseQuantitySmart = (val) => {
    if (val === null || val === undefined) return 0;
    let valStr = String(val).trim();
    if (!valStr) return 0;

    if (valStr.includes(',') && valStr.includes('.')) {
        const lastComma = valStr.lastIndexOf(',');
        const lastDot = valStr.lastIndexOf('.');
        if (lastComma > lastDot) {
            valStr = valStr.replace(/\./g, '').replace(',', '.');
        } else {
            valStr = valStr.replace(/,/g, '');
        }
    } else if (valStr.includes(',')) {
        const parts = valStr.split(',');
        if (parts[parts.length - 1].length !== 3) {
            valStr = valStr.replace(',', '.');
        } else {
            valStr = valStr.replace(/,/g, '');
        }
    }
    const num = parseFloat(valStr);
    return isNaN(num) ? 0 : num;
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
 * Lee y extrae cualquier archivo (.xlsx, .xls, .csv, .tsv, .txt) utilizando SheetJS
 * respetando el estándar RFC 4180 (comillas dobles, comas internas, caracteres de escape).
 * Devuelve un array de filas: Array<Array<string>> buscando la primera hoja que contenga datos reales.
 */
export const readTableFromFile = async (file) => {
    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, {
            type: 'array',
            raw: false,
            cellText: true,
            cellDates: false,
            codepage: 65001
        });
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
            return [];
        }

        // Buscar entre las hojas la primera que contenga filas con datos
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;
            const rawRows = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                defval: '',
                raw: false,
                rawNumbers: false,
                blankrows: false
            });
            const validRows = (rawRows || [])
                .map(row => Array.isArray(row) ? row.map(cell => cell !== null && cell !== undefined ? String(cell).trim() : '') : [])
                .filter(row => row.some(cell => cell !== ''));

            if (validRows.length > 0) {
                return validRows;
            }
        }
        return [];
    } catch (err) {
        console.error("Error al leer archivo estructurado con SheetJS:", err);
        return [];
    }
};

/**
 * Normaliza un nombre de encabezado eliminando acentos, espacios y caracteres especiales.
 */
const normalizeHeaderKey = (h) => {
    if (!h) return '';
    return String(h)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
};

/**
 * Encuentra la fila de encabezados y construye el mapa de columnas a índices con coincidencia difusa.
 */
const buildColumnMap = (rows) => {
    const maxSearch = Math.min(rows.length, 20);
    let headerRowIdx = 0;
    let bestMatchCount = -1;

    const knownKeywords = [
        'item', 'itemcode', 'codigo', 'sku', 'material', 'articulo',
        'description', 'descripcion', 'desc', 'texto',
        'bin', 'bin1', 'binlocation', 'ubicacion',
        'quantity', 'qty', 'cantidad', 'physicalqty', 'systemqty', 'despatchedqty',
        'grn', 'grnnumber', 'pedido', 'order', 'ordernumber', 'purchaseorder', 'po',
        'waybill', 'wb', 'awb', 'airwaybill', 'guia', 'importref', 'importrefcode', 'importreference',
        'customer', 'cliente', 'customername', 'customerref', 'customerreference',
        'despatch', 'despatchnumber', 'picklistprintedtime', 'rpstatustime',
        'reservedqty', 'quantityreserved', 'totalreserved', 'actionqty'
    ];

    for (let r = 0; r < maxSearch; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;
        let matchCount = 0;
        row.forEach(cell => {
            const norm = normalizeHeaderKey(cell);
            if (norm && knownKeywords.some(k => norm === k || norm.includes(k) || k.includes(norm))) {
                matchCount++;
            }
        });
        if (matchCount > bestMatchCount) {
            bestMatchCount = matchCount;
            headerRowIdx = r;
        }
    }

    const headerRow = rows[headerRowIdx] || [];
    const colMap = {};
    headerRow.forEach((cell, idx) => {
        const norm = normalizeHeaderKey(cell);
        if (norm && colMap[norm] === undefined) {
            colMap[norm] = idx;
        }
    });

    const getCol = (row, ...aliases) => {
        if (!row || row.length === 0) return '';

        // 1. Coincidencia exacta de alias normalizado
        for (const alias of aliases) {
            const norm = normalizeHeaderKey(alias);
            if (norm && colMap[norm] !== undefined && colMap[norm] < row.length) {
                const val = row[colMap[norm]];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    return String(val).trim();
                }
            }
        }

        // 2. Coincidencia parcial (el nombre de columna contiene el alias o viceversa)
        for (const alias of aliases) {
            const norm = normalizeHeaderKey(alias);
            if (!norm || norm.length < 2) continue;
            for (const [colName, colIdx] of Object.entries(colMap)) {
                if (colName === norm || colName.includes(norm) || (norm.length >= 4 && norm.includes(colName))) {
                    if (colIdx < row.length) {
                        const val = row[colIdx];
                        if (val !== undefined && val !== null && String(val).trim() !== '') {
                            return String(val).trim();
                        }
                    }
                }
            }
        }
        return '';
    };

    return { headerRowIdx, colMap, getCol, rawHeaders: headerRow.map(h => normalizeHeaderKey(h)) };
};

/**
 * Clasificador determinista de archivos maestros Sandvik/Logix.
 * Previene cruces, colisiones y falsos positivos entre los 5 tipos de archivos.
 */
export const classifyUploadedFile = (fileName, rawHeaders = []) => {
    const fn = (fileName || '').toLowerCase();
    const cleanFn = fn.replace(/[^a-z0-9]/g, '');
    const cleanHeaders = (rawHeaders || []).map(h => normalizeHeaderKey(h));

    const hasHeader = (...keys) => {
        return cleanHeaders.some(h =>
            keys.some(k => {
                const normK = normalizeHeaderKey(k);
                return h === normK || h.includes(normK) || (normK.length >= 4 && normK.includes(h));
            })
        );
    };

    // PRIORIDAD 1: Identificación precisa por Nombre de Archivo Específico
    if (
        cleanFn.includes('extractor') ||
        cleanFn.includes('purchaseorder') ||
        cleanFn.includes('purchase') ||
        cleanFn.includes('polookup') ||
        cleanFn.includes('poextractor') ||
        cleanFn.includes('waybill') ||
        cleanFn.includes('guia') ||
        cleanFn.includes('ordencompra') ||
        cleanFn.includes('ordenescompra')
    ) {
        return 'po_extractor';
    }

    if (cleanFn.includes('0006') || cleanFn.includes('lamp0006') || cleanFn.includes('xdock') || cleanFn.includes('crossdock')) {
        return '0006';
    }

    if (cleanFn.includes('280') || cleanFn.includes('0280') || cleanFn.includes('goodsreceived') || (cleanFn.includes('grn') && !cleanFn.includes('po'))) {
        return '280';
    }

    if (cleanFn.includes('240') || cleanFn.includes('0240') || cleanFn.includes('picking') || cleanFn.includes('despacho') || cleanFn.includes('despachos')) {
        return '240';
    }

    if (cleanFn.includes('250') || cleanFn.includes('0250') || cleanFn.includes('stockroom') || cleanFn.includes('balance') || cleanFn.includes('master') || cleanFn.includes('maestro') || cleanFn.includes('item')) {
        return '250';
    }

    // PRIORIDAD 2: Identificación Determinista por Firmas Fuertes de Encabezados

    // A. PO Extractor (Relaciones Waybill - Import Reference - PO)
    if (
        hasHeader('waybill', 'wb', 'awb', 'airwaybill', 'guia') ||
        hasHeader('importrefcode', 'importreference', 'importref', 'referenciaimportacion') ||
        (hasHeader('customerreference', 'customerref', 'purchaseorder', 'ponumber') && hasHeader('despatchedqty', 'grnnumber'))
    ) {
        return 'po_extractor';
    }

    // B. Reporte 0006 (Reservas Xdock / Cross-Dock)
    if (
        hasHeader('quantityreserved', 'totalreserved', 'actionqty', 'action_qty', 'reservedqty')
    ) {
        return '0006';
    }

    // C. Reporte 250 (Maestro de Ítems / Stockroom Master)
    if (
        hasHeader('bin1', 'binlocation', 'costperunit', 'totalweight', 'abccodestockroom', 'siccodestockroom', 'frozenqty') ||
        (hasHeader('itemcode', 'item', 'material', 'sku', 'codigo') && hasHeader('bin1', 'binlocation', 'physicalqty', 'ubicacion'))
    ) {
        return '250';
    }

    // D. Reporte 280 (Entradas GRN / Goods Received)
    if (
        (hasHeader('grn', 'grnnumber') && (hasHeader('goodsreceived', 'referenciaimportacion', 'importreference') || hasHeader('totalexpected', 'expectedqty'))) ||
        (hasHeader('grn', 'grnnumber') && !hasHeader('despatchnumber', 'despatch', 'despacho', 'picklistprintedtime', 'waybill', 'wb'))
    ) {
        return '280';
    }

    // E. Reporte 240 (Salidas Picking / Despachos)
    if (
        hasHeader('despatchnumber', 'despatch', 'despacho', 'notaentrega', 'picklistprintedtime', 'rpstatustime', 'despatch_') ||
        (hasHeader('ordernumber', 'order_', 'pedido') && hasHeader('customer', 'cliente', 'customername') && hasHeader('picklistprintedtime', 'despatch', 'carrier'))
    ) {
        return '240';
    }

    return null;
};

/**
 * Parsea un archivo CSV/TSV/TXT/XLSX local e inserta los datos masivamente en SQLite local / almacenamiento.
 */
export const processLocalCSVUpload = async (file, selectedGrns = [], updateOption = 'combine') => {
    return new Promise(async (resolve) => {
        try {
            const fileName = file.name.toLowerCase();
            const rows = await readTableFromFile(file);

            if (!rows || rows.length === 0) {
                resolve("El archivo seleccionado está vacío o no contiene filas procesables.");
                return;
            }

            const { headerRowIdx, colMap, getCol, rawHeaders } = buildColumnMap(rows);
            const dataRows = rows.slice(headerRowIdx + 1);

            if (dataRows.length === 0) {
                resolve("El archivo no contiene filas de datos tras los encabezados.");
                return;
            }

            const fileType = classifyUploadedFile(file.name, rawHeaders);

            const isItemMasterFile = fileType === '250';
            const isPickingFile = fileType === '240';
            const isGrnFile = fileType === '280';
            const isXdockFile = fileType === '0006';
            const isPoLookupFile = fileType === 'po_extractor';

            // 1. REPORTE 250 (Maestro de Ítems / Stockroom Master)
            if (isItemMasterFile) {
                const itemsToInsert = [];
                for (const row of dataRows) {
                    let item_code = getCol(row, 'item_code', 'item', 'codigo', 'sku', 'material', 'item_no', 'articulo');
                    if (!item_code) continue;

                    const cleanCode = item_code.toUpperCase().trim();
                    if (!cleanCode || ['ITEM', 'CODIGO', 'MATERIAL', 'SKU', 'ITEM_CODE', 'ITEMCODE'].includes(cleanCode)) continue;

                    let description = getCol(row, 'item_description', 'description', 'descripcion', 'denominacion', 'texto breve');
                    let bin_location = getCol(row, 'bin_1', 'bin_location', 'bin', 'ubicacion', 'almacen') || 'N/A';
                    let additional_bins = getCol(row, 'aditional_bin_location', 'additional_bin_location', 'additional_bins', 'aditional_bins', 'bin_2', 'ubicacion_adicional') || '';
                    let system_qty = parseQuantitySmart(getCol(row, 'physical_qty', 'system_qty', 'quantity', 'cantidad', 'available_qty') || '0');
                    let unit_cost = parseQuantitySmart(getCol(row, 'cost_per_unit', 'unit_cost', 'cost', 'costo', 'precio') || '0');
                    let weight_per_unit = parseQuantitySmart(getCol(row, 'weight_per_unit', 'totalweight', 'net_weight_kg', 'weight', 'peso') || '0');
                    let sic_code = getCol(row, 'sic_code_stockroom', 'sic_code_company', 'sic_code', 'sic') || '0';
                    let abc_code = getCol(row, 'abc_code_stockroom', 'abc_code_company', 'abc_code', 'abc', 'item_type') || '';

                    itemsToInsert.push({
                        item_code: cleanCode,
                        description: (description || '').trim(),
                        bin_location: (bin_location || 'N/A').trim(),
                        additional_bins: (additional_bins || '').trim(),
                        system_qty,
                        unit_cost,
                        weight_per_unit,
                        sic_code: (sic_code || '0').toString().trim(),
                        abc_code: (abc_code || '').toString().trim()
                    });
                }

                if (itemsToInsert.length > 0) {
                    try {
                        const db = await getDB();
                        if (db) {
                            const tx = db.transaction(['master_items', 'sync_metadata'], 'readwrite');
                            const store = tx.objectStore('master_items');
                            for (const it of itemsToInsert) {
                                store.put({
                                    Item_Code: it.item_code,
                                    Item_Description: it.description,
                                    Bin_1: it.bin_location,
                                    Aditional_Bin_Location: it.additional_bins,
                                    Physical_Qty: it.system_qty,
                                    Cost_per_Unit: it.unit_cost,
                                    Weight_per_Unit: it.weight_per_unit,
                                    SIC_Code_stockroom: it.sic_code,
                                    ABC_Code_stockroom: it.abc_code,
                                });
                            }
                            const metaStore = tx.objectStore('sync_metadata');
                            metaStore.put({ key: 'master_items', value: Math.floor(Date.now() / 1000) });
                            await tx.done;
                        }
                    } catch (idbErr) {
                        console.warn("Error actualizando IndexedDB master_items:", idbErr);
                    }

                    if (isTauri()) {
                        await invoke('set_sync_status', { key: 'master_items', timestamp: Math.floor(Date.now() / 1000) });
                        const resMsg = await invoke('add_inventory_items_bulk', { items: itemsToInsert });
                        resolve(resMsg || `Se cargaron ${itemsToInsert.length} registros en el Maestro de Ítems (250).`);
                        return;
                    }
                    resolve(`Se procesaron ${itemsToInsert.length} registros del Maestro de Ítems (250) localmente.`);
                    return;
                }
            }

            // 2. REPORTE 240 (Salidas Picking)
            if (isPickingFile) {
                const ordersMap = {};
                for (let i = 0; i < dataRows.length; i++) {
                    const row = dataRows[i];
                    let order_number = getCol(row, 'order_', 'order_number', 'order', 'pedido', 'numero_pedido', 'no_pedido', 'documento');
                    let despatch_number = getCol(row, 'despatch_', 'despatch_number', 'despatch', 'despacho', 'nota_entrega') || '00';
                    let customer_code = getCol(row, 'customer', 'customer_code', 'cliente', 'codigo_cliente') || 'N/A';
                    let customer_name = getCol(row, 'customer_name', 'nombre_cliente', 'cliente_nombre', 'end_user_name', 'nombre') || 'Cliente General';
                    let item_code = getCol(row, 'item', 'item_code', 'codigo', 'material', 'sku');
                    let description = getCol(row, 'description', 'item_description', 'descripcion', 'texto breve');
                    let order_line = getCol(row, 'order_line', 'linea', 'posicion') || (i + 1).toString();
                    let qty = parseInt(parseQuantitySmart(getCol(row, 'qty', 'quantity', 'cantidad', 'cant', 'qty_req') || '0'), 10) || 0;
                    let print_date = getCol(row, 'pick_list_printed_time', 'creation_time', 'requested_date', 'print_date', 'fecha_impresion', 'fecha') || new Date().toISOString().split('T')[0];

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
                            print_date: print_date.split(' ')[0] || print_date,
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

                const ordersToInsert = [];
                for (const key of keys) {
                    const orderData = ordersMap[key];
                    for (const item of orderData.items) {
                        ordersToInsert.push({
                            shipment_id: orderData.order_number,
                            order_number: orderData.order_number,
                            despatch_number: orderData.despatch_number,
                            customer_code: orderData.customer_code,
                            customer_name: orderData.customer_name,
                            carrier: 'N/A',
                            order_line: item['Order Line'] || '1',
                            item_code: item['Item Code'],
                            item_description: item['Item Description'],
                            requested_qty: Number(item['Qty'] || 0),
                            picked_qty: 0,
                            print_date: orderData.print_date,
                            time_zone_hours: '-05:00',
                            status: 'PP',
                            timestamp: new Date().toISOString()
                        });
                    }
                }

                // Sincronizar con IndexedDB
                try {
                    const db = await getDB();
                    if (db) {
                        await db.clear('picking_orders');
                        await db.clear('picking_tracking');
                        const tx = db.transaction(['picking_orders', 'sync_metadata'], 'readwrite');
                        const store = tx.objectStore('picking_orders');
                        for (const key of keys) {
                            const orderData = ordersMap[key];
                            store.put({
                                id: `${orderData.order_number}_${orderData.despatch_number}`,
                                order: orderData.order_number,
                                despatch: orderData.despatch_number,
                                data: orderData.items,
                                timestamp: Date.now()
                            });
                        }
                        const metaStore = tx.objectStore('sync_metadata');
                        metaStore.put({ key: 'picking', value: Math.floor(Date.now() / 1000) });
                        await tx.done;
                    }
                } catch (errDb) {
                    console.warn("Error updating local IndexedDB picking_orders:", errDb);
                }

                if (isTauri()) {
                    await invoke('set_sync_status', { key: 'picking', timestamp: Math.floor(Date.now() / 1000) });
                    const resMsg = await invoke('import_picking_orders_bulk', { orders: ordersToInsert });
                    resolve(resMsg || `Se actualizaron ${keys.length} pedidos de picking en SQLite (240).`);
                    return;
                }
                resolve(`Se procesaron ${keys.length} pedidos de picking localmente (240).`);
                return;
            }

            // 3. REPORTE 280 (Entradas GRN)
            if (isGrnFile) {
                const grnArray = [];
                for (const row of dataRows) {
                    let item_code = getCol(row, 'item_code', 'item', 'codigo', 'material', 'sku');
                    let grn_number = getCol(row, 'grn_number', 'grn', 'pedido', 'documento');
                    let qty = parseQuantitySmart(getCol(row, 'quantity', 'qty', 'total_expected', 'expected_qty', 'cantidad') || '0');
                    let description = getCol(row, 'item_description', 'description', 'descripcion', 'denominacion') || '';
                    let order_number = getCol(row, 'order_number', 'order', 'pedido', 'customer_ref') || '';
                    let order_line = getCol(row, 'order_line', 'linea', 'line_number', 'posicion') || '';
                    let import_ref = getCol(row, 'import_reference', 'import_ref', 'referencia_importacion', 'referencia', 'ir') || '';
                    let waybill = getCol(row, 'waybill', 'wb', 'guia') || '';

                    if (!item_code || !grn_number) continue;
                    const cleanCode = item_code.toUpperCase().trim();
                    const cleanGrn = grn_number.trim().toUpperCase();

                    if (selectedGrns && selectedGrns.length > 0 && !selectedGrns.includes(cleanGrn) && !selectedGrns.includes(grn_number.trim())) {
                        continue;
                    }

                    grnArray.push({
                        Item_Code: cleanCode,
                        Item_Description: description.trim(),
                        Quantity: qty,
                        GRN_Number: cleanGrn,
                        Order_Number: order_number.trim().toUpperCase(),
                        Order_Line: order_line.toString().trim(),
                        Import_Reference: import_ref.trim().toUpperCase(),
                        Waybill: waybill.trim().toUpperCase(),
                    });
                }

                try {
                    const db = await getDB();
                    if (db) {
                        const tx = db.transaction(['grn_pending', 'sync_metadata'], 'readwrite');
                        const store = tx.objectStore('grn_pending');
                        for (const g of grnArray) {
                            store.put({
                                id: `${g.GRN_Number}_${g.Item_Code}_${g.Order_Line || '1'}`,
                                ...g
                            });
                        }
                        const metaStore = tx.objectStore('sync_metadata');
                        metaStore.put({ key: 'grn_pending', value: Math.floor(Date.now() / 1000) });
                        await tx.done;
                    }
                } catch (idbGrnErr) {
                    console.warn("Error updating local IndexedDB grn_pending:", idbGrnErr);
                }

                if (isTauri()) {
                    await invoke('set_sync_status', { key: 'grn_pending', timestamp: Math.floor(Date.now() / 1000) });
                    await invoke('save_grn_master_json', { jsonContent: JSON.stringify(grnArray, null, 2) });
                    resolve(`Se guardaron ${grnArray.length} líneas de GRN (280) en el almacenamiento local.`);
                    return;
                }
                resolve(`Se procesaron ${grnArray.length} líneas de GRN (280) localmente.`);
                return;
            }

            // 4. REPORTE 0006 (Reservas Xdock)
            if (isXdockFile) {
                const xdockMap = {};
                for (const row of dataRows) {
                    let item_code = getCol(row, 'item_code', 'item', 'codigo', 'material', 'sku');
                    let qty = parseQuantitySmart(getCol(row, 'quantity_reserved', 'reserved_qty', 'action_qty', 'total', 'cantidad') || '0');
                    let customer = getCol(row, 'customer_name', 'customer', 'cliente', 'nombre_cliente') || 'Cliente General';
                    let po_number = getCol(row, 'po_number', 'po_date', 'po');

                    if (!item_code) continue;
                    const cleanCode = item_code.toUpperCase().trim();
                    if (!xdockMap[cleanCode]) {
                        xdockMap[cleanCode] = { Item_Code: cleanCode, total: 0, reserved_qty: 0, customers: new Set(), po_number };
                    }
                    xdockMap[cleanCode].total += qty;
                    xdockMap[cleanCode].reserved_qty += qty;
                    if (customer) xdockMap[cleanCode].customers.add(customer.trim());
                }

                try {
                    const db = await getDB();
                    if (db) {
                        const tx = db.transaction(['xdock_reservations', 'sync_metadata'], 'readwrite');
                        const store = tx.objectStore('xdock_reservations');
                        for (const [code, data] of Object.entries(xdockMap)) {
                            store.put({
                                item_code: code,
                                total: data.total,
                                reserved_qty: data.reserved_qty,
                                customers: Array.from(data.customers),
                                po_number: data.po_number
                            });
                        }
                        const metaStore = tx.objectStore('sync_metadata');
                        metaStore.put({ key: 'xdock_reservations', value: Math.floor(Date.now() / 1000) });
                        await tx.done;
                    }
                } catch (idbXErr) {
                    console.warn("Error updating local IndexedDB xdock_reservations:", idbXErr);
                }

                if (isTauri()) {
                    await invoke('set_sync_status', { key: 'xdock_reservations', timestamp: Math.floor(Date.now() / 1000) });
                    const jsonToSave = {};
                    for (const [code, data] of Object.entries(xdockMap)) {
                        jsonToSave[code] = {
                            total: data.total,
                            reserved_qty: data.reserved_qty,
                            customers: Array.from(data.customers),
                            po_number: data.po_number
                        };
                    }
                    await invoke('save_xdock_reservations_json', { jsonContent: JSON.stringify(jsonToSave, null, 2) });
                    resolve(`Se cargaron ${Object.keys(xdockMap).length} registros de Reservas Xdock (0006) en SQLite y almacenamiento local.`);
                    return;
                }
                resolve(`Se procesaron ${Object.keys(xdockMap).length} registros de Reservas Xdock.`);
                return;
            }

            // 5. PO Extractor / PO Lookup (Excel / CSV) - Estructura idéntica a logix_react
            if (isPoLookupFile) {
                const wbLookup = {};
                const irLookup = {};
                const customerRefToGrn = {};

                for (const row of dataRows) {
                    let waybill = getCol(row, 'waybill', 'waybill_number', 'waybill_no', 'waybillno', 'wb', 'awb', 'airwaybill', 'air_waybill', 'guia', 'guia_aerea', 'no_guia', 'tracking').toUpperCase().trim();
                    let import_ref = getCol(row, 'import_ref_code', 'import_ref', 'import_reference', 'import_ref_no', 'ir', 'referencia_importacion', 'ref_importacion', 'ref_import', 'import_code', 'referencia').toUpperCase().trim();
                    let item_code = getCol(row, 'item_code', 'item', 'item_no', 'sku', 'material', 'codigo', 'codigo_articulo', 'articulo', 'itemcode').toUpperCase().trim();
                    let qty = getCol(row, 'despatched_qty', 'despatched_quantity', 'qty', 'quantity', 'cantidad', 'cant', 'despachado', 'qty_despachada') || '0';
                    let grn = getCol(row, 'grn_number', 'grn', 'grn_no', 'pedido_grn', 'recepcion', 'grnnumber').toUpperCase().replace(/\//g, ',').trim();
                    let customer_ref = getCol(row, 'customer_reference', 'customer_ref', 'customer_po', 'purchase_order', 'po_number', 'po', 'order_number', 'order', 'pedido', 'referencia_cliente', 'ref_cliente', 'orden_compra', 'oc').toUpperCase().trim();

                    // Limpieza idéntica a process_po_extractor_logic en logix_react:
                    // Requiere que Waybill y Import Ref Code no sean vacíos ni encabezados
                    if (!waybill || !import_ref || waybill === 'WAYBILL' || import_ref === 'IMPORT REF CODE' || item_code === 'ITEM CODE') {
                        continue;
                    }

                    const itemObj = { item_code, qty, grn, customer_ref };

                    // 1. Agrupado por Waybill (wb_to_data)
                    if (!wbLookup[waybill]) {
                        wbLookup[waybill] = {
                            import_ref: import_ref,
                            items: []
                        };
                    }
                    wbLookup[waybill].items.push(itemObj);

                    // 2. Agrupado por Import Ref Code (ir_to_data)
                    if (!irLookup[import_ref]) {
                        irLookup[import_ref] = {
                            waybill: waybill,
                            items: []
                        };
                    }
                    irLookup[import_ref].items.push(itemObj);

                    // 3. Mapeo por Customer Reference (customer_ref_to_data)
                    if (customer_ref) {
                        if (!customerRefToGrn[customer_ref]) {
                            customerRefToGrn[customer_ref] = {
                                import_ref: import_ref,
                                waybill: waybill,
                                grns: new Set()
                            };
                        }
                        if (grn) {
                            const splitGrns = grn.split(',').map(g => g.trim().toUpperCase()).filter(Boolean);
                            splitGrns.forEach(g => customerRefToGrn[customer_ref].grns.add(g));
                        }
                    }
                }

                const totalWb = Object.keys(wbLookup).length;
                const totalIr = Object.keys(irLookup).length;

                if (totalWb === 0 && totalIr === 0) {
                    resolve(`No se encontraron registros válidos de PO Extractor en '${file.name}' (verifique que contenga columnas Waybill e Import Ref Code).`);
                    return;
                }

                // Serializar customer_ref_to_data convirtiendo Sets a Arrays
                const serializedCustomerRefMap = {};
                for (const [ref, data] of Object.entries(customerRefToGrn)) {
                    serializedCustomerRefMap[ref] = {
                        import_ref: data.import_ref,
                        waybill: data.waybill,
                        grns: Array.from(data.grns)
                    };
                }

                const lookupData = {
                    wb_to_data: wbLookup,
                    ir_to_data: irLookup,
                    customer_ref_to_data: serializedCustomerRefMap,
                    updated_at: new Date().toISOString()
                };

                try {
                    const db = await getDB();
                    if (db) {
                        const tx = db.transaction(['po_lookup', 'sync_metadata'], 'readwrite');
                        const store = tx.objectStore('po_lookup');
                        for (const [wb, val] of Object.entries(wbLookup)) {
                            store.put({ id: `wb_${wb}`, type: 'wb', value: wb, ...val });
                        }
                        for (const [ir, val] of Object.entries(irLookup)) {
                            store.put({ id: `ir_${ir}`, type: 'ir', value: ir, ...val });
                        }
                        const metaStore = tx.objectStore('sync_metadata');
                        metaStore.put({ key: 'po_extractor', value: Math.floor(Date.now() / 1000) });
                        await tx.done;
                    }
                } catch (idbPoErr) {
                    console.warn("Error updating local IndexedDB po_lookup:", idbPoErr);
                }

                if (isTauri()) {
                    await invoke('set_sync_status', { key: 'po_extractor', timestamp: Math.floor(Date.now() / 1000) });
                    await invoke('save_po_lookup_json', { jsonContent: JSON.stringify(lookupData, null, 2) });
                    resolve(`Archivo '${file.name}' procesado con éxito como PO Extractor (${totalWb} Waybills, ${totalIr} Ref. de Importación).`);
                    return;
                }
                resolve(`Archivo '${file.name}' procesado localmente como PO Extractor (${totalWb} Waybills, ${totalIr} Ref. de Importación).`);
                return;
            }

            const detectedHeadersStr = rawHeaders && rawHeaders.length > 0 ? rawHeaders.slice(0, 10).join(', ') : 'ninguno';
            resolve(`Tipo de archivo no reconocido para '${file.name}'. Encabezados detectados: [${detectedHeadersStr}]. Asegúrese de que corresponda a uno de los maestros admitidos (250, 280, 240, 0006 o PO Extractor).`);
        } catch (err) {
            console.error("Error al procesar archivo estructurado:", err);
            resolve(`Error al procesar el archivo '${file.name}': ${err.message || err}`);
        }
    });
};

/**
 * Filtra cadenas que NO son números de GRN válidos (letras sueltas, decimales, fechas YYYYMMDD, encabezados).
 */
export const isIgnoredGRNValue = (val) => {
    if (!val || typeof val !== 'string') return true;
    const v = val.trim();
    if (v === '' || v.length <= 1) return true;
    // Ignorar números decimales como 8.00 o 10.50
    if (/^\d+[\.,]\d+$/.test(v)) return true;
    // Ignorar fechas puras en formato AAAAMMDD (ej. 20260724)
    if (/^\d{8}$/.test(v) && (v.startsWith('202') || v.startsWith('201'))) return true;
    // Ignorar encabezados conocidos
    const upper = v.toUpperCase();
    const headers = ['GRN', 'PEDIDO', 'PO', 'GRN_NUMBER', 'DOCUMENTO', 'REFERENCIA', 'GRN_LOCAL', 'ITEM', 'SKU', 'CÓDIGO', 'CODIGO', 'MATERIAL', 'CANTIDAD', 'QTY', 'FECHA', 'DATE', 'STATUS', 'N/A'];
    if (headers.includes(upper)) return true;
    return false;
};

/**
 * Extrae los números de GRN/Pedido de un archivo 280/GRN localmente de forma 100% segura.
 */
export const previewLocalGRNFile = async (file) => {
    try {
        const rows = await readTableFromFile(file);
        if (!rows || rows.length === 0) return [];

        const { headerRowIdx, getCol } = buildColumnMap(rows);
        const dataRows = rows.slice(headerRowIdx + 1);
        const grnSet = new Set();

        for (const row of dataRows) {
            let val = getCol(row, 'grn_number', 'grn', 'pedido', 'order_number', 'documento', 'po_number');
            if (!val && row.length > 1) {
                for (let c = 0; c < row.length; c++) {
                    const cell = String(row[c] || '').trim();
                    if (cell && !isIgnoredGRNValue(cell)) {
                        val = cell;
                        break;
                    }
                }
            }
            if (val && !isIgnoredGRNValue(val)) {
                grnSet.add(val.trim().toUpperCase());
            }
        }

        return Array.from(grnSet);
    } catch (err) {
        console.error("Error previsualizando GRNs localmente:", err);
        return [];
    }
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

/**
 * Obtiene el mapa maestro de relaciones GRN -> IR / Waybill desde Rust (IPC).
 */
export const tauriGetInboundMasterMaps = async () => {
    if (isTauri()) {
        try {
            return await invoke('get_inbound_master_maps');
        } catch (e) {
            console.error("Error al obtener master maps desde Tauri:", e);
            return [];
        }
    }
    return [];
};

/**
 * Busca referencias cruzadas de Waybill <-> Import Reference en Rust
 */
export const tauriLookupInboundReference = async (waybill = null, importRef = null) => {
    if (isTauri()) {
        try {
            return await invoke('lookup_inbound_reference', {
                waybill: waybill || null,
                importRef: importRef || null,
                import_ref: importRef || null
            });
        } catch (e) {
            console.error("Error en lookup_inbound_reference desde Tauri:", e);
            return null;
        }
    }
    return null;
};

/**
 * Guarda y exporta un archivo Excel (.xlsx) compatible tanto con Tauri nativo (Linux/Windows)
 * como con navegadores web estándar.
 */
export const exportExcelFileNative = async (workbook, defaultFileName = 'export.xlsx') => {
    try {
        const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const uint8Array = new Uint8Array(wbout);

        if (isTauri()) {
            try {
                const { save } = await import('@tauri-apps/api/dialog');
                const { writeBinaryFile } = await import('@tauri-apps/api/fs');

                const selectedPath = await save({
                    defaultPath: defaultFileName,
                    filters: [{
                        name: 'Libro de Excel (*.xlsx)',
                        extensions: ['xlsx']
                    }]
                });

                if (!selectedPath) {
                    // Usuario canceló la selección de ruta
                    return false;
                }

                await writeBinaryFile(selectedPath, uint8Array);
                alert(`✅ Archivo exportado exitosamente:\n${selectedPath}`);
                return true;
            } catch (tauriErr) {
                console.warn("Error guardando con Tauri dialog/fs, usando fallback de navegador:", tauriErr);
            }
        }

        // Fallback estándar en navegador
        const blob = new Blob([uint8Array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultFileName;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 500);
        return true;
    } catch (err) {
        console.error("Error al exportar archivo Excel:", err);
        alert(`❌ Error al exportar archivo: ${err.message || err}`);
        return false;
    }
};

/**
 * Obtiene la lista de impresoras disponibles en el sistema operativo
 */
export const getSystemPrinters = async () => {
    if (isTauri()) {
        try {
            const list = await invoke('get_system_printers');
            return list || [];
        } catch (e) {
            console.warn("Error obteniendo impresoras desde Tauri:", e);
            return [];
        }
    }
    // Entorno de prueba en navegador
    return [
        { name: 'Impresora Predeterminada del Sistema', is_default: true, status: 'En línea' }
    ];
};

/**
 * Envía una etiqueta Sandvik para impresión silenciosa automática
 */
export const printSandvikLabelSilent = async (labelData, printerName = null) => {
    if (isTauri()) {
        try {
            const payload = {
                item_code: labelData.itemCode || labelData.item_code || '',
                description: labelData.description || '',
                quantity: Number(labelData.quantity || 1),
                weight: String(labelData.weight || '0.00'),
                packaging_date: labelData.packagingDate || labelData.packaging_date || null,
                bin_location: labelData.binLocation || labelData.bin_location || labelData.relocatedBin || '',
                qr_data: labelData.qrData || labelData.qr_data || labelData.itemCode || labelData.item_code || ''
            };

            const msg = await invoke('print_sandvik_label_silent', {
                printerName: printerName || null,
                label: payload
            });
            return { success: true, message: msg };
        } catch (e) {
            console.error("Error en impresión silenciosa:", e);
            return { success: false, error: e.message || String(e) };
        }
    }
    return { success: false, error: 'La impresión silenciosa requiere la app de escritorio Tauri.' };
};

/**
 * Envía una etiqueta de prueba a la impresora seleccionada
 */
export const testPrintLabelNative = async (printerName = null) => {
    if (isTauri()) {
        try {
            const msg = await invoke('test_print_label', {
                printerName: printerName || null
            });
            return { success: true, message: msg };
        } catch (e) {
            return { success: false, error: e.message || String(e) };
        }
    }
    return { success: false, error: 'Requiere Tauri Desktop' };
};

/**
 * Obtiene las preferencias locales de impresora de etiquetas
 */
export const getPrinterConfig = () => {
    try {
        const saved = localStorage.getItem('logix_printer_config');
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.warn("Error leyendo configuración de impresora:", e);
    }
    return {
        default_label_printer: '',
        auto_print_enabled: false,
        auto_print_on_scan: false,
        print_mode: 'zpl'
    };
};

/**
 * Guarda las preferencias locales de impresora de etiquetas
 */
export const savePrinterConfig = (config) => {
    try {
        localStorage.setItem('logix_printer_config', JSON.stringify(config));
        return true;
    } catch (e) {
        console.error("Error guardando configuración de impresora:", e);
        return false;
    }
};


