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
 * Devuelve un array de filas: Array<Array<string>>.
 */
export const readTableFromFile = async (file) => {
    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, {
            type: 'array',
            raw: true,
            cellText: true,
            cellDates: false,
            codepage: 65001
        });
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
            return [];
        }
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: '',
            raw: true,
            rawNumbers: false,
            blankrows: false
        });
        return (rawRows || []).map(row => Array.isArray(row) ? row.map(cell => cell !== null && cell !== undefined ? String(cell).trim() : '') : []);
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
 * Encuentra la fila de encabezados y construye el mapa de columnas a índices.
 */
const buildColumnMap = (rows) => {
    const maxSearch = Math.min(rows.length, 15);
    let headerRowIdx = 0;
    let bestMatchCount = -1;

    const knownKeywords = [
        'item', 'itemcode', 'codigo', 'sku', 'material',
        'description', 'descripcion', 'desc', 'texto',
        'bin', 'bin1', 'binlocation', 'ubicacion',
        'quantity', 'qty', 'cantidad', 'physicalqty',
        'grn', 'grnnumber', 'pedido', 'order', 'ordernumber',
        'waybill', 'wb', 'importref', 'importrefcode', 'importreference',
        'customer', 'cliente', 'customername', 'despatch', 'despatchnumber',
        'reservedqty', 'quantityreserved', 'totalreserved'
    ];

    for (let r = 0; r < maxSearch; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;
        let matchCount = 0;
        row.forEach(cell => {
            const norm = normalizeHeaderKey(cell);
            if (norm && knownKeywords.some(k => norm.includes(k) || k.includes(norm))) {
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
        for (const alias of aliases) {
            const norm = normalizeHeaderKey(alias);
            if (colMap[norm] !== undefined && colMap[norm] < row.length) {
                const val = row[colMap[norm]];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    return String(val).trim();
                }
            }
        }
        return '';
    };

    return { headerRowIdx, colMap, getCol, rawHeaders: headerRow.map(h => normalizeHeaderKey(h)) };
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

            // Identificación precisa del tipo de archivo (de lo más específico a lo general)
            const isPoLookupFile = fileName.includes('extractor') || fileName.includes('purchase') || fileName.includes('po_lookup') ||
                (rawHeaders.some(h => h.includes('waybill') || h === 'wb') && rawHeaders.some(h => h.includes('import') || h === 'ir'));

            const isXdockFile = !isPoLookupFile && (fileName.includes('0006') || fileName.includes('xdock') || fileName.includes('crossdock') || fileName.includes('reserva') ||
                rawHeaders.some(h => ['reservedqty', 'quantityreserved', 'totalreserved', 'actionqty', 'sonumber'].includes(h)));

            const isPickingFile = !isPoLookupFile && !isXdockFile && (fileName.includes('240') || fileName.includes('picking') || fileName.includes('salida') ||
                rawHeaders.some(h => ['despatchnumber', 'despatch', 'despacho', 'notaentrega', 'picklistprintedtime', 'rpstatustime'].includes(h)) ||
                (rawHeaders.some(h => ['ordernumber', 'order', 'pedido'].includes(h)) && rawHeaders.some(h => ['customer', 'cliente', 'customername'].includes(h))));

            const isGrnFile = !isPoLookupFile && !isXdockFile && !isPickingFile && (fileName.includes('280') || fileName.includes('grn') || fileName.includes('entrada') ||
                (rawHeaders.some(h => ['grn', 'grnnumber', 'referenciaimportacion', 'importreference'].includes(h)) && !rawHeaders.includes('bin1') && !rawHeaders.includes('physicalqty')));

            const isItemMasterFile = !isPoLookupFile && !isXdockFile && !isPickingFile && !isGrnFile && (fileName.includes('250') || fileName.includes('master') || fileName.includes('maestro') || fileName.includes('item_master') ||
                rawHeaders.some(h => ['bin1', 'binlocation', 'physicalqty', 'stockroom', 'costperunit', 'totalweight'].includes(h)) ||
                (rawHeaders.some(h => ['itemcode', 'item', 'material', 'sku', 'codigo'].includes(h)) &&
                 rawHeaders.some(h => ['description', 'descripcion', 'itemdescription', 'denominacion', 'bin1', 'binlocation', 'ubicacion'].includes(h))));

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
                    if (isTauri()) {
                        const resMsg = await invoke('add_inventory_items_bulk', { items: itemsToInsert });
                        resolve(resMsg || `Se cargaron ${itemsToInsert.length} registros en el Maestro de Ítems (SQLite).`);
                        return;
                    }
                    resolve(`Se procesaron ${itemsToInsert.length} registros del Maestro de Ítems localmente.`);
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

                if (isTauri()) {
                    const ordersToInsert = [];
                    for (const key of keys) {
                        const orderData = ordersMap[key];
                        for (const item of orderData.items) {
                            ordersToInsert.push({
                                shipment_id: orderData.order_number,
                                order_number: orderData.order_number,
                                customer_name: orderData.customer_name,
                                carrier: 'N/A',
                                item_code: item['Item Code'],
                                item_description: item['Item Description'],
                                requested_qty: Number(item['Qty'] || 0),
                                picked_qty: 0,
                                status: 'Pendiente',
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                    const resMsg = await invoke('import_picking_orders_bulk', { orders: ordersToInsert });
                    resolve(resMsg || `Se cargaron ${keys.length} pedidos de picking en SQLite.`);
                    return;
                }
                resolve(`Se procesaron ${keys.length} pedidos de picking localmente.`);
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

                if (isTauri()) {
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

                if (isTauri()) {
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

            // 5. PO Extractor / PO Lookup (Excel / CSV)
            if (isPoLookupFile) {
                const wbMap = {};
                const irMap = {};

                for (const row of dataRows) {
                    let waybill = getCol(row, 'waybill', 'waybill_number', 'wb').toUpperCase();
                    let import_ref = getCol(row, 'import_ref_code', 'import_ref', 'import_reference', 'ir').toUpperCase();
                    let item_code = getCol(row, 'item_code', 'item', 'sku', 'material').toUpperCase();
                    let qty = getCol(row, 'despatched_qty', 'qty', 'quantity', 'cantidad') || '0';
                    let grn = getCol(row, 'grn_number', 'grn').toUpperCase().replace(/\//g, ',');
                    let customer_ref = getCol(row, 'customer_reference', 'customer_ref', 'referencia_cliente').toUpperCase();

                    if (!waybill || !import_ref || waybill === 'WAYBILL' || import_ref === 'IMPORT REF CODE') {
                        continue;
                    }

                    const itemObj = { item_code, qty, grn, customer_ref };

                    if (!wbMap[waybill]) {
                        wbMap[waybill] = { id: `wb_${waybill}`, type: 'wb', value: waybill, waybill, import_ref, items: [] };
                    }
                    wbMap[waybill].items.push(itemObj);

                    if (!irMap[import_ref]) {
                        irMap[import_ref] = { id: `ir_${import_ref}`, type: 'ir', value: import_ref, waybill, import_ref, items: [] };
                    }
                    irMap[import_ref].items.push(itemObj);
                }

                if (isTauri()) {
                    const poJsonData = {
                        wb_to_data: wbMap,
                        ir_to_data: irMap,
                        updated_at: new Date().toISOString()
                    };
                    await invoke('save_po_lookup_json', { jsonContent: JSON.stringify(poJsonData, null, 2) });
                    resolve(`Se guardaron las relaciones de PO Extractor en data/po_lookup.json.`);
                    return;
                }
                resolve(`Se procesaron ${Object.keys(wbMap).length} waybills de PO Extractor.`);
                return;
            }

            resolve("Tipo de archivo no reconocido o sin registros procesables.");
        } catch (err) {
            console.error("Error al procesar archivo estructurado:", err);
            resolve(`Error al procesar el archivo: ${err.message || err}`);
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


