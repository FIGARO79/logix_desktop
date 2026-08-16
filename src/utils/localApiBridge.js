import { getDB, matchRef, getGRNExpectedQty } from './offlineDb';
import { isTauri, callTauriCommand } from './tauriBridge';
import * as XLSX from 'xlsx';

/**
 * Crea una respuesta HTTP simulada (Response) compatible con la API Fetch estándar.
 */
function createJsonResponse(data, status = 200) {
    const bodyStr = JSON.stringify(data);
    return new Response(bodyStr, {
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: {
            'Content-Type': 'application/json',
            'X-Powered-By': 'Logix-Local-Rust-Core'
        }
    });
}

function createTextResponse(text, status = 200, contentType = 'text/plain') {
    return new Response(text, {
        status,
        statusText: 'OK',
        headers: {
            'Content-Type': contentType,
            'X-Powered-By': 'Logix-Local-Rust-Core'
        }
    });
}

/**
 * Función auxiliar para descargar un archivo CSV/Excel en el navegador.
 */
export function downloadLocalFile(filename, content, mimeType = 'text/csv;charset=utf-8;') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 200);
}

/**
 * Despachador central de peticiones locales /api/...
 */
export async function handleLocalApiRequest(urlStr, options = {}) {
    const url = new URL(urlStr, window.location.origin);
    const pathname = url.pathname;
    const method = (options.method || 'GET').toUpperCase();
    const searchParams = url.searchParams;

    let body = null;
    if (options.body) {
        if (typeof options.body === 'string') {
            try {
                body = JSON.parse(options.body);
            } catch {
                body = options.body;
            }
        } else if (options.body instanceof FormData) {
            body = {};
            for (const [k, v] of options.body.entries()) {
                body[k] = v;
            }
        } else {
            body = options.body;
        }
    }

    try {
        const db = isTauri() ? null : await getDB();

        // -------------------------------------------------------------
        // 1. AUTH & USUARIOS
        // -------------------------------------------------------------
        if (pathname === '/api/admin/verify') {
            return createJsonResponse({
                is_admin: true,
                user: { username: 'admin', role: 'admin', full_name: 'Administrador Local' }
            });
        }

        if (pathname === '/api/login' || pathname === '/api/admin/login') {
            const username = body?.username || 'admin';
            const password = body?.password || '';
            if (isTauri()) {
                try {
                    const res = await callTauriCommand('login', { username, passwordHash: password });
                    return createJsonResponse({ success: true, user: res, role: res?.role || 'admin' });
                } catch (e) {
                    return createJsonResponse({ error: String(e), message: "Usuario o contraseña incorrectos" }, 401);
                }
            }
            return createJsonResponse({
                success: true,
                user: { id: 1, username, role: 'admin' }
            });
        }

        if (pathname === '/api/register') {
            const username = body?.username || '';
            const password = body?.password || '';
            if (isTauri()) {
                try {
                    const res = await callTauriCommand('register_user', { username, passwordHash: password });
                    return createJsonResponse({ success: true, message: res });
                } catch (e) {
                    return createJsonResponse({ error: String(e) }, 400);
                }
            }
            return createJsonResponse({ success: true, message: "Usuario registrado localmente" });
        }

        if (pathname === '/api/logout') {
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/admin/users') {
            if (isTauri()) {
                try {
                    const users = await callTauriCommand('get_all_users_admin');
                    return createJsonResponse(users || []);
                } catch (e) {
                    console.warn("Error getting users from SQLite:", e);
                }
            }
            const localUsers = await db.getAll('local_users') || [];
            if (localUsers.length === 0) {
                return createJsonResponse([
                    { id: 1, username: 'admin', role: 'admin', permissions: 'stock,inbound,picking,inventory,planner,counts,admin', is_approved: true }
                ]);
            }
            return createJsonResponse(localUsers);
        }

        if (pathname.startsWith('/api/admin/approve/')) {
            const userId = parseInt(pathname.replace('/api/admin/approve/', '')) || 0;
            if (isTauri() && userId > 0) {
                await callTauriCommand('approve_user_admin', { userId });
            }
            return createJsonResponse({ success: true, message: "Usuario aprobado exitosamente" });
        }

        if (pathname === '/api/admin/inventory/available_aisles') {
            if (isTauri()) {
                const aisles = await callTauriCommand('get_available_aisles');
                return createJsonResponse({ aisles: aisles || [] });
            }
            return createJsonResponse({ aisles: ['A', 'B', 'C', 'D', 'E'] });
        }

        if (pathname === '/api/admin/inventory/auditor_zones') {
            if (isTauri()) {
                const zones = await callTauriCommand('get_auditor_zones');
                return createJsonResponse(zones || []);
            }
            return createJsonResponse([]);
        }

        if (pathname === '/api/admin/inventory/assign_zones') {
            const userId = body?.user_id || body?.userId || 0;
            const assignedZones = body?.assigned_zones || body?.assignedZones || '';
            if (isTauri()) {
                const msg = await callTauriCommand('assign_auditor_zones', { userId, assignedZones });
                return createJsonResponse({ message: msg });
            }
            return createJsonResponse({ message: "Zonas asignadas" });
        }

        if (pathname.startsWith('/api/admin/delete/')) {
            const userId = parseInt(pathname.replace('/api/admin/delete/', '')) || 0;
            if (isTauri()) {
                await callTauriCommand('delete_user_admin', { userId });
            }
            if (db) await db.delete('local_users', userId);
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/admin/reset_password/')) {
            const userId = parseInt(pathname.replace('/api/admin/reset_password/', '')) || 0;
            const newPassword = body?.new_password || body?.password || '123456';
            if (isTauri()) {
                await callTauriCommand('reset_user_password_admin', { userId, newPassword });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/admin/permissions/')) {
            const userId = parseInt(pathname.replace('/api/admin/permissions/', '')) || 0;
            const permissions = typeof body?.permissions === 'string' ? body.permissions : JSON.stringify(body?.permissions || {});
            if (isTauri()) {
                await callTauriCommand('update_user_permissions_admin', { userId, permissions });
            }
            return createJsonResponse({ success: true });
        }

        // -------------------------------------------------------------
        // 2. INBOUND & RECEPCIÓN
        // -------------------------------------------------------------
        if (pathname.startsWith('/api/find_item/')) {
            const parts = pathname.replace('/api/find_item/', '').split('/');
            const code = decodeURIComponent(parts[0] || '').trim().toUpperCase();
            const importRef = decodeURIComponent(parts[1] || '').trim().toUpperCase();

            if (isTauri()) {
                try {
                    const res = await callTauriCommand('find_item_inbound', { itemCode: code, importRef: importRef || null });
                    if (res) {
                        return createJsonResponse({
                            itemCode: res.item_code,
                            description: res.description,
                            binLocation: res.bin_location,
                            weight: res.weight,
                            itemType: res.item_type,
                            sicCode: res.sic_code,
                            defaultQtyGrn: res.default_qty_grn,
                            xdockTotal: res.xdock_total,
                            xdockPending: res.xdock_pending,
                            xdockCustomers: res.xdock_customers,
                            expectedBreakdown: res.expected_breakdown,
                            suggestedBin: res.suggested_bin || null
                        });
                    }
                } catch (e) {
                    console.warn("Error calling find_item_inbound in Rust:", e);
                }
            }

            // Fallback en navegador
            let localItem = await db.get('master_items', code);
            if (!localItem) {
                const allItems = await db.getAll('master_items') || [];
                localItem = allItems.find(it => (it.Item_Code || it.item_code || '').toString().toUpperCase().trim() === code);
            }
            if (!localItem) {
                return createJsonResponse({ error: "Item no encontrado" }, 404);
            }

            const itemCodeFinal = localItem.Item_Code || localItem.item_code || code;
            const itemDescriptionFinal = localItem.Item_Description || localItem.description || '';
            const itemBinFinal = localItem.Bin_Location || localItem.Bin_1 || localItem.bin_location || 'N/A';
            const itemWeightFinal = localItem.Weight_Per_Unit || localItem.Weight_per_Unit || 0;
            const itemTypeFinal = localItem.ABC_Code_stockroom || localItem.ABC_Code || '';
            const itemSicFinal = localItem.SIC_Code_stockroom || localItem.SIC_Code || '';

            return createJsonResponse({
                itemCode: itemCodeFinal,
                description: itemDescriptionFinal,
                binLocation: itemBinFinal,
                weight: itemWeightFinal,
                itemType: itemTypeFinal,
                sicCode: itemSicFinal,
                defaultQtyGrn: 0,
                xdockTotal: 0,
                xdockPending: 0,
                xdockCustomers: [],
                expectedBreakdown: []
            });
        }

        if (pathname === '/api/get_logs') {
            const versionDate = searchParams.get('version_date');
            if (isTauri()) {
                try {
                    const logs = await callTauriCommand('get_inbound_logs', { versionDate: versionDate || null });
                    if (logs) {
                        return createJsonResponse(logs.map(l => ({
                            id: l.id,
                            timestamp: l.timestamp,
                            importReference: l.import_reference,
                            waybill: l.waybill,
                            itemCode: l.item_code,
                            itemDescription: l.item_description,
                            binLocation: l.bin_location,
                            relocatedBin: l.relocated_bin,
                            qtyReceived: l.qty_received,
                            qtyGrn: l.qty_grn,
                            difference: l.difference,
                            username: l.username,
                            client_id: l.client_id,
                            version_date: l.version_date
                        })));
                    }
                } catch (e) {
                    console.warn("Error getting logs from SQLite:", e);
                }
            }

            const localLogs = await db.getAll('local_inbound') || [];
            return createJsonResponse(localLogs);
        }

        if (pathname === '/api/save_log' || pathname === '/api/add_log' || (pathname === '/api/inbound/logs' && method === 'POST')) {
            if (isTauri()) {
                try {
                    const saved = await callTauriCommand('save_inbound_log', {
                        entry: {
                            id: body?.id ? Number(body.id) : null,
                            timestamp: body?.timestamp || '',
                            import_reference: body?.importReference || body?.import_reference || '',
                            waybill: body?.waybill || null,
                            item_code: body?.itemCode || body?.item_code || '',
                            item_description: body?.itemDescription || body?.item_description || null,
                            bin_location: body?.binLocation || body?.bin_location || null,
                            relocated_bin: body?.relocatedBin || body?.relocated_bin || null,
                            qty_received: Number(body?.qtyReceived ?? body?.quantity ?? body?.qty_received ?? 0),
                            qty_grn: Number(body?.qtyGrn ?? body?.qty_grn ?? 0),
                            difference: Number(body?.difference ?? (Number(body?.qtyReceived ?? body?.quantity ?? 0) - Number(body?.qtyGrn ?? 0))),
                            username: body?.username || 'admin',
                            client_id: body?.client_id || null,
                            archived_at: null,
                            version_date: body?.version_date || null
                        }
                    });
                    return createJsonResponse({ success: true, log: saved });
                } catch (e) {
                    console.error("Error saving log in Tauri:", e);
                }
            }

            const logRecord = {
                id: body?.id || Date.now(),
                ...body,
                timestamp: body?.timestamp || new Date().toISOString()
            };
            await db.put('local_inbound', logRecord);
            return createJsonResponse({ success: true, log: logRecord });
        }

        if (pathname.startsWith('/api/update_log/')) {
            const id = parseInt(pathname.replace('/api/update_log/', '')) || 0;
            if (isTauri() && id > 0) {
                try {
                    const saved = await callTauriCommand('save_inbound_log', {
                        entry: {
                            id,
                            timestamp: body?.timestamp || '',
                            import_reference: body?.importReference || body?.import_reference || '',
                            waybill: body?.waybill || null,
                            item_code: body?.itemCode || body?.item_code || '',
                            item_description: body?.itemDescription || body?.item_description || null,
                            bin_location: body?.binLocation || body?.bin_location || null,
                            relocated_bin: body?.relocatedBin || body?.relocated_bin || null,
                            qty_received: Number(body?.qtyReceived ?? body?.quantity ?? body?.qty_received ?? 0),
                            qty_grn: Number(body?.qtyGrn ?? body?.qty_grn ?? 0),
                            difference: Number(body?.difference ?? (Number(body?.qtyReceived ?? body?.quantity ?? 0) - Number(body?.qtyGrn ?? 0))),
                            username: body?.username || 'admin',
                            client_id: body?.client_id || null,
                            archived_at: null,
                            version_date: body?.version_date || null
                        }
                    });
                    return createJsonResponse({ success: true, log: saved });
                } catch (e) {
                    console.error("Error updating log in Tauri:", e);
                }
            }
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/delete_log/')) {
            const id = parseInt(pathname.replace('/api/delete_log/', '')) || 0;
            if (isTauri()) {
                await callTauriCommand('delete_inbound_log', { id });
            }
            await db.delete('local_inbound', id);
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/logs/archive') {
            if (isTauri()) {
                await callTauriCommand('archive_inbound_logs');
            }
            return createJsonResponse({ success: true, message: "Logs archivados exitosamente" });
        }

        if (pathname === '/api/logs/versions') {
            if (isTauri()) {
                try {
                    const versions = await callTauriCommand('get_inbound_versions');
                    return createJsonResponse(versions || []);
                } catch (e) {
                    console.warn("Error getting versions:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname === '/api/inbound/ir_reconciliation' || pathname.startsWith('/api/inbound/ir_reconciliation/')) {
            if (method === 'DELETE') {
                const id = decodeURIComponent(pathname.replace('/api/inbound/ir_reconciliation/', '')).trim();
                if (isTauri() && id) {
                    await callTauriCommand('delete_ir_reconciliation', { id });
                }
                if (db && id) {
                    await db.delete('local_ir_reconciliation', id);
                }
                return createJsonResponse({ success: true, message: "Registro eliminado" });
            }

            if (method === 'POST') {
                if (isTauri()) {
                    try {
                        const rec = await callTauriCommand('save_ir_reconciliation', {
                            rec: {
                                id: String(body?.id || Date.now()),
                                import_reference: body?.import_reference || body?.importReference || '',
                                waybill: body?.waybill || null,
                                item_code: body?.item_code || body?.itemCode || null,
                                item_description: body?.item_description || body?.itemDescription || null,
                                expected_qty: Number(body?.expected_qty || body?.expectedQty || 0),
                                received_qty: Number(body?.received_qty || body?.receivedQty || 0),
                                diff_qty: Number(body?.diff_qty || body?.diffQty || 0),
                                status: body?.status || 'pending',
                                user_id: body?.user_id || 'admin',
                                timestamp: body?.timestamp || new Date().toISOString()
                            }
                        });
                        return createJsonResponse({ success: true, record: rec });
                    } catch (e) {
                        console.error("Error in save_ir_reconciliation:", e);
                    }
                }
                const recData = {
                    id: body?.id || `rec_${Date.now()}`,
                    ...body,
                    timestamp: new Date().toISOString()
                };
                await db.put('local_ir_reconciliation', recData);
                return createJsonResponse({ success: true, record: recData });
            }

            if (isTauri()) {
                try {
                    const recs = await callTauriCommand('get_ir_reconciliations');
                    return createJsonResponse(recs || []);
                } catch (e) {
                    console.warn("Error getting IR reconciliations:", e);
                }
            }
            const records = await db.getAll('local_ir_reconciliation') || [];
            return createJsonResponse(records);
        }

        if (pathname === '/api/inbound/saved_grn_reconciliations' || pathname.startsWith('/api/inbound/saved_grn_reconciliations/')) {
            const subId = pathname.replace('/api/inbound/saved_grn_reconciliations', '').replace(/^\//, '').trim();

            if (method === 'DELETE' && subId) {
                const id = Number(subId);
                if (isTauri()) {
                    try {
                        const msg = await callTauriCommand('delete_saved_grn_reconciliation', { id });
                        return createJsonResponse({ success: true, message: msg });
                    } catch (e) {
                        return createErrorResponse(e.message || String(e), 500);
                    }
                }
                return createJsonResponse({ success: true, message: "Eliminado localmente" });
            }

            if (subId && !isNaN(Number(subId))) {
                const id = Number(subId);
                if (isTauri()) {
                    try {
                        const detail = await callTauriCommand('get_saved_grn_reconciliation_detail', { id });
                        return createJsonResponse(detail || null);
                    } catch (e) {
                        return createErrorResponse(e.message || String(e), 500);
                    }
                }
                return createJsonResponse(null);
            }

            // GET list
            if (isTauri()) {
                try {
                    const grnFilter = searchParams.get('grn') || null;
                    const irFilter = searchParams.get('import_reference') || null;
                    const list = await callTauriCommand('get_saved_grn_reconciliations', {
                        grnFilter: grnFilter,
                        irFilter: irFilter
                    });
                    return createJsonResponse(list || []);
                } catch (e) {
                    console.warn("Error getting saved GRN reconciliations:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname === '/api/inbound/save_grn_reconciliation' && method === 'POST') {
            if (isTauri()) {
                try {
                    const reconId = await callTauriCommand('save_grn_reconciliation_snapshot', {
                        payload: {
                            grn_number: body?.grn_number || '',
                            import_reference: body?.import_reference || '',
                            waybill: body?.waybill || null,
                            items: (body?.items || []).map(it => ({
                                grn_number: it.grn_number || it.GRN || body?.grn_number || '',
                                import_reference: it.import_reference || it.Import_Reference || body?.import_reference || '',
                                waybill: it.waybill || it.Waybill || null,
                                order_line: it.order_line || it.Order_Line || null,
                                item_code: it.item_code || it.Codigo_Item || '',
                                description: it.description || it.Descripcion || null,
                                location: it.location || it.Ubicacion || null,
                                relocated_bin: it.relocated_bin || it.Reubicado || null,
                                qty_expected: Number(it.qty_expected ?? it.Cant_Esperada ?? 0),
                                qty_received: Number(it.qty_received ?? it.Cant_Recibida ?? 0),
                                difference: Number(it.difference ?? it.Diferencia ?? 0),
                                difference_reason: it.difference_reason || it.motivo_diferencia || null,
                                operator_comment: it.operator_comment || it.observacion || null,
                            })),
                            username: body?.username || 'admin',
                            notes: body?.notes || null
                        }
                    });
                    return createJsonResponse({ success: true, id: reconId, message: "Conciliación guardada exitosamente en la base de datos" });
                } catch (e) {
                    console.error("Error in save_grn_reconciliation_snapshot:", e);
                    return createErrorResponse(e.message || String(e), 500);
                }
            }
            return createJsonResponse({ success: true, id: Date.now(), message: "Conciliación guardada localmente" });
        }

        // Auditor de Inbound
        if (pathname === '/api/inbound/auditor/alerts') {
            if (isTauri()) {
                try {
                    const alerts = await callTauriCommand('get_inbound_alerts');
                    return createJsonResponse(alerts || []);
                } catch (e) {
                    console.warn("Error getting alerts:", e);
                }
            }
            const alerts = await db.getAll('local_audit_alerts') || [];
            return createJsonResponse(alerts);
        }

        if (pathname === '/api/inbound/auditor/run') {
            if (isTauri()) {
                const count = await callTauriCommand('run_inbound_auditor');
                return createJsonResponse({ success: true, alerts_generated: count || 0 });
            }
            return createJsonResponse({ success: true, alerts_generated: 0 });
        }

        if (pathname === '/api/inbound/auditor/alerts/resolve-bulk') {
            const alertIds = body?.alert_ids || body?.alertIds || [];
            if (isTauri() && alertIds.length > 0) {
                await callTauriCommand('resolve_inbound_alerts_bulk', { alertIds });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/inbound/auditor/clear')) {
            if (isTauri()) {
                await callTauriCommand('clear_inbound_alerts');
            }
            if (db) await db.clear('local_audit_alerts');
            return createJsonResponse({ success: true });
        }

        if (pathname.includes('/api/inbound/auditor/alerts') && pathname.includes('/resolve')) {
            const id = parseInt(pathname.split('/alerts/')[1]?.split('/')[0]) || 0;
            if (isTauri() && id > 0) {
                await callTauriCommand('resolve_inbound_alert', { id });
            }
            return createJsonResponse({ success: true });
        }

        // -------------------------------------------------------------
        // 3. CONSULTA DE STOCK & UBICACIONES
        // -------------------------------------------------------------
        if (pathname === '/api/search_items' || pathname === '/api/stock/search') {
            const q = (searchParams.get('q') || '').trim();
            if (isTauri()) {
                try {
                    const items = await callTauriCommand('search_stock_items', { query: q });
                    if (items) {
                        return createJsonResponse(items.map(it => {
                            const binLoc = it.bin_location || 'N/A';
                            const addBins = it.additional_bins || '';
                            const qty = typeof it.system_qty === 'number' ? it.system_qty : parseFloat(it.system_qty || '0') || 0;
                            const cost = typeof it.unit_cost === 'number' ? it.unit_cost : parseFloat(it.unit_cost || '0') || 0;
                            const weight = typeof it.weight_per_unit === 'number' ? it.weight_per_unit : parseFloat(it.weight_per_unit || '0') || 0;
                            const sic = it.sic_code || '0';
                            const abc = it.abc_code || '';
                            const updated = it.updated_at || '';

                            return {
                                itemCode: it.item_code,
                                item_code: it.item_code,
                                description: it.description || '',
                                binLocation: binLoc,
                                bin_location: binLoc,
                                system_bin: binLoc,
                                additionalBins: addBins,
                                aditionalBins: addBins,
                                additional_bins: addBins,
                                additional_locations: addBins,
                                systemQty: qty,
                                system_qty: qty,
                                physicalQty: qty,
                                physical_qty: qty,
                                unitCost: cost,
                                unit_cost: cost,
                                weightPerUnit: weight,
                                weight_per_unit: weight,
                                weight: weight,
                                weight_kg: weight,
                                sicCode: sic,
                                sic_code: sic,
                                abcCode: abc,
                                abc_code: abc,
                                itemType: abc,
                                lengthCm: it.length_cm || 0,
                                widthCm: it.width_cm || 0,
                                heightCm: it.height_cm || 0,
                                volumeCm3: it.volume_cm3 || 0,
                                updatedAt: updated,
                                dateLastReceived: updated ? updated.split(' ')[0] : ''
                            };
                        }));
                    }
                } catch (e) {
                    console.warn("Error in search_stock_items:", e);
                }
            }

            const allItems = await db.getAll('master_items') || [];
            const qUpper = q.toUpperCase();
            const matches = allItems.filter(item =>
                (item.Item_Code && item.Item_Code.toUpperCase().includes(qUpper)) ||
                (item.item_code && item.item_code.toUpperCase().includes(qUpper)) ||
                (item.Item_Description && item.Item_Description.toUpperCase().includes(qUpper)) ||
                (item.description && item.description.toUpperCase().includes(qUpper)) ||
                (item.Bin_Location && item.Bin_Location.toUpperCase().includes(qUpper)) ||
                (item.Bin_1 && item.Bin_1.toUpperCase().includes(qUpper)) ||
                (item.bin_location && item.bin_location.toUpperCase().includes(qUpper)) ||
                (item.Aditional_Bin_Location && item.Aditional_Bin_Location.toUpperCase().includes(qUpper)) ||
                (item.additional_bins && item.additional_bins.toUpperCase().includes(qUpper))
            );

            return createJsonResponse(matches.slice(0, 50).map(item => {
                const code = item.Item_Code || item.item_code || '';
                const desc = item.Item_Description || item.description || '';
                const binLoc = item.Bin_Location || item.Bin_1 || item.bin_location || 'N/A';
                const addBins = item.Aditional_Bin_Location || item.additional_bins || item.additional_bin_location || item.aditional_bins || item.bin_2 || '';
                const qty = typeof item.System_Qty === 'number' ? item.System_Qty : parseFloat(item.System_Qty || item.Physical_Qty || item.physical_qty || item.system_qty || '0') || 0;
                const cost = typeof item.Unit_Cost === 'number' ? item.Unit_Cost : parseFloat(item.Unit_Cost || item.unit_cost || item.cost_per_unit || '0') || 0;
                const weight = typeof item.Weight_Per_Unit === 'number' ? item.Weight_Per_Unit : parseFloat(item.Weight_Per_Unit || item.Weight_per_Unit || item.weight_per_unit || item.weight || '0') || 0;
                const sic = item.SIC_Code || item.SIC_Code_stockroom || item.sic_code || '0';
                const abc = item.ABC_Code || item.ABC_Code_stockroom || item.abc_code || item.item_type || '';
                const updated = item.updated_at || item.updatedAt || '';

                return {
                    itemCode: code,
                    item_code: code,
                    description: desc,
                    binLocation: binLoc,
                    bin_location: binLoc,
                    system_bin: binLoc,
                    additionalBins: addBins,
                    aditionalBins: addBins,
                    additional_bins: addBins,
                    additional_locations: addBins,
                    systemQty: qty,
                    system_qty: qty,
                    physicalQty: qty,
                    physical_qty: qty,
                    unitCost: cost,
                    unit_cost: cost,
                    weightPerUnit: weight,
                    weight_per_unit: weight,
                    weight: weight,
                    weight_kg: weight,
                    sicCode: sic,
                    sic_code: sic,
                    abcCode: abc,
                    abc_code: abc,
                    itemType: abc,
                    lengthCm: item.length_cm || 0,
                    widthCm: item.width_cm || 0,
                    heightCm: item.height_cm || 0,
                    volumeCm3: item.volume_cm3 || 0,
                    updatedAt: updated,
                    dateLastReceived: updated ? updated.split(' ')[0] : ''
                };
            }));
        }

        if (pathname.startsWith('/api/get_item_details/')) {
            const code = decodeURIComponent(pathname.replace('/api/get_item_details/', '')).trim().toUpperCase();
            if (isTauri()) {
                try {
                    const details = await callTauriCommand('get_item_details', { itemCode: code });
                    if (details) {
                        const binLoc = details.bin_location || 'N/A';
                        const addBins = details.additional_bins || '';
                        const qty = typeof details.system_qty === 'number' ? details.system_qty : parseFloat(details.system_qty || '0') || 0;
                        const cost = typeof details.unit_cost === 'number' ? details.unit_cost : parseFloat(details.unit_cost || '0') || 0;
                        const weight = typeof details.weight_kg === 'number' ? details.weight_kg : parseFloat(details.weight_kg || '0') || 0;
                        const sic = details.sic_code || '0';
                        const abc = details.abc_code || '';
                        const updated = details.updated_at || '';

                        return createJsonResponse({
                            itemCode: details.item_code,
                            item_code: details.item_code,
                            description: details.description || '',
                            binLocation: binLoc,
                            bin_location: binLoc,
                            system_bin: binLoc,
                            additionalBins: addBins,
                            aditionalBins: addBins,
                            additional_bins: addBins,
                            additional_locations: addBins,
                            systemQty: qty,
                            system_qty: qty,
                            physicalQty: qty,
                            physical_qty: qty,
                            unitCost: cost,
                            unit_cost: cost,
                            weight: weight,
                            weight_kg: weight,
                            weightPerUnit: weight,
                            weight_per_unit: weight,
                            sicCode: sic,
                            sic_code: sic,
                            abcCode: abc,
                            abc_code: abc,
                            itemType: abc,
                            lengthCm: details.length_cm || 0,
                            widthCm: details.width_cm || 0,
                            heightCm: details.height_cm || 0,
                            volumeCm3: details.volume_cm3 || 0,
                            updatedAt: updated,
                            dateLastReceived: updated ? updated.split(' ')[0] : ''
                        });
                    }
                } catch (e) {
                    console.warn("Error in get_item_details:", e);
                }
            }

            let item = await db.get('master_items', code);
            if (!item) {
                const allItems = await db.getAll('master_items') || [];
                item = allItems.find(i => (i.Item_Code && i.Item_Code.toUpperCase() === code) || (i.item_code && i.item_code.toUpperCase() === code));
            }
            if (item) {
                const itemCode = item.Item_Code || item.item_code || code;
                const desc = item.Item_Description || item.description || '';
                const binLoc = item.Bin_Location || item.Bin_1 || item.bin_location || 'N/A';
                const addBins = item.Aditional_Bin_Location || item.additional_bins || item.additional_bin_location || item.aditional_bins || item.bin_2 || '';
                const qty = typeof item.System_Qty === 'number' ? item.System_Qty : parseFloat(item.System_Qty || item.Physical_Qty || item.physical_qty || item.system_qty || '0') || 0;
                const cost = typeof item.Unit_Cost === 'number' ? item.Unit_Cost : parseFloat(item.Unit_Cost || item.unit_cost || item.cost_per_unit || '0') || 0;
                const weight = typeof item.Weight_Per_Unit === 'number' ? item.Weight_Per_Unit : parseFloat(item.Weight_Per_Unit || item.Weight_per_Unit || item.weight_per_unit || item.weight || '0') || 0;
                const sic = item.SIC_Code || item.SIC_Code_stockroom || item.sic_code || '0';
                const abc = item.ABC_Code || item.ABC_Code_stockroom || item.abc_code || item.item_type || '';
                const updated = item.updated_at || item.updatedAt || '';

                return createJsonResponse({
                    itemCode: itemCode,
                    item_code: itemCode,
                    description: desc,
                    binLocation: binLoc,
                    bin_location: binLoc,
                    system_bin: binLoc,
                    additionalBins: addBins,
                    aditionalBins: addBins,
                    additional_bins: addBins,
                    additional_locations: addBins,
                    systemQty: qty,
                    system_qty: qty,
                    physicalQty: qty,
                    physical_qty: qty,
                    unitCost: cost,
                    unit_cost: cost,
                    weight: weight,
                    weight_kg: weight,
                    weightPerUnit: weight,
                    weight_per_unit: weight,
                    sicCode: sic,
                    sic_code: sic,
                    abcCode: abc,
                    abc_code: abc,
                    itemType: abc,
                    lengthCm: item.length_cm || 0,
                    widthCm: item.width_cm || 0,
                    heightCm: item.height_cm || 0,
                    volumeCm3: item.volume_cm3 || 0,
                    updatedAt: updated,
                    dateLastReceived: updated ? updated.split(' ')[0] : ''
                });
            }
            return createJsonResponse({ error: "Item no encontrado" }, 404);
        }

        if (pathname === '/api/views/valid_bins') {
            if (isTauri()) {
                try {
                    const bins = await callTauriCommand('get_valid_bins');
                    if (bins) return createJsonResponse(bins);
                } catch (e) {
                    console.warn("Error getting valid bins:", e);
                }
            }
            const allItems = await db.getAll('master_items') || [];
            const binsSet = new Set();
            allItems.forEach(it => {
                const b = it.Bin_Location || it.Bin_1 || it.bin_location;
                if (b && b !== 'N/A' && b !== 'SIN UBICACION') binsSet.add(b.trim().toUpperCase());
            });
            return createJsonResponse(Array.from(binsSet));
        }

        if (pathname === '/api/views/occupancy_stats' || pathname === '/api/views/occupancy_detail') {
            if (isTauri()) {
                try {
                    const occ = await callTauriCommand('get_occupancy_stats');
                    if (occ) return createJsonResponse(occ);
                } catch (e) {
                    console.warn("Error getting occupancy stats:", e);
                }
            }
            const allItems = await db.getAll('master_items') || [];
            const totalItems = allItems.length;
            const occupiedBins = new Set(allItems.map(it => it.Bin_Location || it.Bin_1).filter(Boolean)).size;
            return createJsonResponse({
                total_bins: Math.max(occupiedBins, 100),
                occupied_bins: occupiedBins,
                occupancy_rate: occupiedBins > 0 ? (occupiedBins / Math.max(occupiedBins, 100)) * 100 : 0,
                total_skus: totalItems,
                categories: []
            });
        }

        // -------------------------------------------------------------
        // 4. PICKING & DESPACHOS (SHIPMENTS)
        // -------------------------------------------------------------
        if (pathname === '/api/shipments/') {
            if (isTauri()) {
                try {
                    const shipments = await callTauriCommand('get_shipments');
                    if (shipments) return createJsonResponse(shipments);
                } catch (e) {
                    console.warn("Error getting shipments in Tauri:", e);
                }
            }
            const orders = await db.getAll('picking_orders') || [];
            return createJsonResponse(orders);
        }

        if (pathname.startsWith('/api/shipments/')) {
            const rest = pathname.replace('/api/shipments/', '');
            if (rest.endsWith('/packing_list')) {
                const shipId = rest.replace('/packing_list', '');
                if (isTauri()) {
                    try {
                        const pl = await callTauriCommand('get_shipment_packing_list', { shipmentId: shipId });
                        if (pl) return createJsonResponse(pl);
                    } catch (e) {
                        console.warn("Error getting packing list in Tauri:", e);
                    }
                }
                return createJsonResponse({ shipment_id: shipId, items: [], created_at: new Date().toISOString() });
            }

            const shipId = rest;
            if (method === 'DELETE') {
                if (isTauri()) {
                    await callTauriCommand('delete_shipment', { shipmentId: shipId });
                }
                return createJsonResponse({ success: true });
            }

            if (isTauri()) {
                const details = await callTauriCommand('get_shipment_details', { shipmentId: shipId });
                if (details) return createJsonResponse(details);
            }
            return createJsonResponse({ id: shipId, items: [] });
        }

        if (pathname === '/api/views/view_picking_audits') {
            if (isTauri()) {
                try {
                    const audits = await callTauriCommand('get_picking_audits');
                    if (audits) return createJsonResponse(audits);
                } catch (e) {
                    console.warn("Error getting picking audits:", e);
                }
            }
            const audits = await db.getAll('picking_audits') || [];
            return createJsonResponse(audits);
        }

        if (pathname === '/api/picking/save_audit') {
            if (isTauri()) {
                try {
                    const saved = await callTauriCommand('save_picking_audit', {
                        audit: {
                            id: body?.id || null,
                            shipment_id: body?.shipment_id || body?.shipmentId || 'GENERAL',
                            order_number: body?.order_number || null,
                            item_code: body?.item_code || body?.itemCode || '',
                            item_description: body?.item_description || body?.itemDescription || null,
                            requested_qty: Number(body?.requested_qty || body?.requestedQty || 0),
                            audited_qty: Number(body?.audited_qty || body?.auditedQty || 0),
                            difference: Number(body?.difference || 0),
                            auditor_user: body?.auditor_user || 'admin',
                            status: body?.status || 'Auditado',
                            timestamp: body?.timestamp || new Date().toISOString()
                        }
                    });
                    return createJsonResponse({ success: true, record: saved });
                } catch (e) {
                    console.error("Error saving picking audit:", e);
                }
            }
            const record = { id: body?.id || Date.now(), ...body };
            await db.put('picking_audits', record);
            return createJsonResponse({ success: true, record });
        }

        if (pathname.startsWith('/api/update_picking_audit/')) {
            const id = parseInt(pathname.replace('/api/update_picking_audit/', '')) || 0;
            if (isTauri()) {
                try {
                    const updated = await callTauriCommand('update_picking_audit', {
                        id,
                        audit: {
                            id: id,
                            shipment_id: body?.shipment_id || 'GENERAL',
                            order_number: body?.order_number || null,
                            item_code: body?.item_code || '',
                            item_description: body?.item_description || null,
                            requested_qty: Number(body?.requested_qty || 0),
                            audited_qty: Number(body?.audited_qty || 0),
                            difference: Number(body?.difference || 0),
                            auditor_user: body?.auditor_user || 'admin',
                            status: body?.status || 'Auditado',
                            timestamp: body?.timestamp || new Date().toISOString()
                        }
                    });
                    return createJsonResponse({ success: true, record: updated });
                } catch (e) {
                    console.error("Error updating picking audit:", e);
                }
            }
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/picking_audit/')) {
            const id = parseInt(pathname.replace('/api/picking_audit/', '').split('/')[0]) || 0;
            if (isTauri() && id > 0) {
                const audit = await callTauriCommand('get_picking_audit_by_id', { auditId: id });
                if (audit) return createJsonResponse(audit);
            }
            return createJsonResponse({ id, status: 'Auditado' });
        }

        if (pathname === '/api/delete_picking_audits') {
            const ids = (body?.ids || (body?.id ? [body.id] : [])).map(Number);
            if (isTauri()) {
                await callTauriCommand('delete_picking_audits', { ids });
            }
            return createJsonResponse({ success: true });
        }

        // -------------------------------------------------------------
        // 5. CONTEOS CÍCLICOS & AUDITORÍAS DE INVENTARIO
        // -------------------------------------------------------------
        if (pathname === '/api/sessions/active') {
            if (isTauri()) {
                try {
                    const session = await callTauriCommand('get_active_count_session');
                    if (session) return createJsonResponse(session);
                } catch (e) {
                    console.warn("Error getting active session:", e);
                }
            }
            return createJsonResponse({
                id: 1,
                session_id: 1,
                name: 'Sesión Principal Local',
                is_active: true,
                start_time: new Date().toISOString()
            });
        }

        if (pathname === '/api/sessions/start') {
            const name = body?.name || `Sesión ${new Date().toLocaleDateString()}`;
            const username = body?.username || 'admin';
            if (isTauri()) {
                try {
                    const newSession = await callTauriCommand('start_count_session', { name, username });
                    return createJsonResponse(newSession);
                } catch (e) {
                    console.error("Error starting count session:", e);
                }
            }
            return createJsonResponse({ id: Date.now(), session_id: Date.now(), name, is_active: true, start_time: new Date().toISOString() });
        }

        if (pathname.includes('/api/sessions/') && pathname.endsWith('/close')) {
            const sessionId = parseInt(pathname.split('/sessions/')[1]?.split('/')[0]) || 1;
            if (isTauri()) {
                await callTauriCommand('close_count_session', { sessionId });
            }
            return createJsonResponse({ success: true, message: "Sesión cerrada" });
        }

        if (pathname.includes('/api/sessions/') && pathname.includes('/locations')) {
            const sessionId = parseInt(pathname.split('/sessions/')[1]?.split('/')[0]) || 1;
            if (isTauri()) {
                try {
                    const locs = await callTauriCommand('get_session_locations', { sessionId });
                    if (locs) return createJsonResponse(locs);
                } catch (e) {
                    console.warn("Error getting session locations:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname.includes('/api/sessions/') && pathname.includes('/counts/')) {
            const sessionId = parseInt(pathname.split('/sessions/')[1]?.split('/')[0]) || 1;
            const location = decodeURIComponent(pathname.split('/counts/')[1] || '').trim().toUpperCase();
            if (isTauri()) {
                try {
                    const counts = await callTauriCommand('get_session_counts_by_location', { sessionId, location });
                    if (counts) return createJsonResponse(counts);
                } catch (e) {
                    console.warn("Error getting counts by location:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname.startsWith('/api/get_item_for_counting/')) {
            const code = decodeURIComponent(pathname.replace('/api/get_item_for_counting/', '')).trim().toUpperCase();
            if (isTauri()) {
                try {
                    const item = await callTauriCommand('get_item_for_counting', { itemCode: code });
                    if (item) return createJsonResponse(item);
                } catch (e) {
                    console.warn("Error getting item for counting in Rust:", e);
                }
            }

            let item = await db.get('master_items', code);
            if (item) {
                return createJsonResponse({
                    item_code: item.Item_Code,
                    description: item.Item_Description,
                    bin_location: item.Bin_Location || item.Bin_1 || 'N/A',
                    system_qty: item.System_Qty || 0,
                    unit_cost: item.Unit_Cost || 0
                });
            }
            return createJsonResponse({
                item_code: code,
                description: 'Ítem no registrado en maestro',
                bin_location: 'N/A',
                system_qty: 0,
                unit_cost: 0
            });
        }

        if (pathname === '/api/counts') {
            if (method === 'POST') {
                if (isTauri()) {
                    try {
                        const saved = await callTauriCommand('add_count_record', {
                            record: {
                                id: body?.id || null,
                                session_id: body?.session_id || body?.sessionId || 1,
                                count_type: body?.count_type || body?.countType || 'cycle_count',
                                item_code: body?.item_code || body?.itemCode || '',
                                description: body?.description || null,
                                location: body?.location || body?.bin_location || 'N/A',
                                counted_qty: Number(body?.counted_qty || body?.quantity || 0),
                                stage: Number(body?.stage || 1),
                                user_id: body?.user_id || body?.userId || 'admin',
                                status: body?.status || 'completed',
                                unit_cost: Number(body?.unit_cost || 0),
                                timestamp: body?.timestamp || null
                            }
                        });
                        return createJsonResponse({ success: true, count: saved });
                    } catch (e) {
                        console.error("Error adding count record in Rust:", e);
                    }
                }
                const countRecord = { id: body?.id || Date.now(), ...body, timestamp: new Date().toISOString() };
                await db.put('local_counts', countRecord);
                return createJsonResponse({ success: true, count: countRecord });
            }

            if (isTauri()) {
                const all = await callTauriCommand('get_all_counts', { countType: null });
                return createJsonResponse(all || []);
            }
            const counts = await db.getAll('local_counts') || [];
            return createJsonResponse(counts);
        }

        if (pathname === '/api/counts/all' || pathname === '/api/counts/recordings') {
            if (isTauri()) {
                try {
                    const counts = await callTauriCommand('get_all_counts', { countType: null });
                    return createJsonResponse(counts || []);
                } catch (e) {
                    console.warn("Error in get_all_counts:", e);
                }
            }
            const counts = await db.getAll('local_counts') || [];
            return createJsonResponse(counts);
        }

        if (pathname === '/api/counts/stats' || pathname === '/api/counts/dashboard_stats') {
            if (isTauri()) {
                try {
                    const stats = await callTauriCommand('get_count_stats');
                    if (stats) return createJsonResponse(stats);
                } catch (e) {
                    console.warn("Error getting count stats:", e);
                }
            }
            return createJsonResponse({
                total_counts: 0,
                total_units: 0,
                accuracy_rate: 100,
                locations_counted: 0,
                discrepancies: 0
            });
        }

        if (pathname === '/api/counts/differences' || pathname === '/api/cycle_counts/calculate_differences') {
            if (isTauri()) {
                try {
                    const diffs = await callTauriCommand('calculate_cycle_count_differences');
                    if (diffs) {
                        return createJsonResponse(diffs.map(d => ({
                            item_code: d.item_code,
                            location: d.location,
                            system_qty: d.system_qty,
                            counted_qty: d.counted_qty,
                            diff_qty: d.diff_qty,
                            unit_cost: d.unit_cost,
                            diff_val: d.diff_val,
                            status: d.status,
                            stage_used: d.stage_used
                        })));
                    }
                } catch (e) {
                    console.warn("Error calculating cycle count diffs in Rust:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname.startsWith('/api/get_item_for_counting/')) {
            const code = decodeURIComponent(pathname.replace('/api/get_item_for_counting/', '')).trim().toUpperCase();
            if (isTauri()) {
                const it = await callTauriCommand('get_item_for_counting', { itemCode: code });
                if (it) {
                    return createJsonResponse({
                        item_code: it.item_code,
                        description: it.description,
                        bin_location: it.bin_location,
                        system_qty: it.system_qty,
                        unit_cost: it.unit_cost
                    });
                }
            }
            return createJsonResponse({ item_code: code, description: 'Item local', bin_location: 'A-01', system_qty: 0, unit_cost: 0 });
        }

        if (pathname.startsWith('/api/counts/recordings/') && pathname.includes('/root_cause')) {
            const recordingId = parseInt(pathname.split('/recordings/')[1]?.split('/')[0]) || 0;
            const rootCause = body?.root_cause || body?.rootCause || body?.notes || '';
            if (isTauri() && recordingId > 0) {
                await callTauriCommand('update_count_root_cause', { countId: recordingId, rootCause });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/counts/')) {
            const id = parseInt(pathname.replace('/api/counts/', '').split('/')[0]) || 0;
            if (method === 'DELETE') {
                if (isTauri() && id > 0) {
                    await callTauriCommand('delete_count_record', { id });
                }
                if (db) await db.delete('local_counts', id);
                return createJsonResponse({ success: true });
            }
            if (method === 'PUT' || method === 'POST') {
                if (isTauri() && id > 0) {
                    await callTauriCommand('update_count_record', {
                        id,
                        record: {
                            id,
                            session_id: body?.session_id || 1,
                            count_type: body?.count_type || 'cycle_count',
                            item_code: body?.item_code || '',
                            description: body?.description || null,
                            location: body?.location || 'N/A',
                            counted_qty: Number(body?.counted_qty || 0),
                            stage: Number(body?.stage || 1),
                            user_id: body?.user_id || 'admin',
                            status: body?.status || 'completed',
                            unit_cost: Number(body?.unit_cost || 0),
                            timestamp: body?.timestamp || null
                        }
                    });
                }
                return createJsonResponse({ success: true });
            }
        }

        if (pathname === '/api/locations/close') {
            const sessionId = body?.session_id || 1;
            const location = body?.location || '';
            if (isTauri()) {
                await callTauriCommand('close_location', { sessionId, location });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/locations/reopen') {
            const sessionId = body?.session_id || 1;
            const location = body?.location || '';
            if (isTauri()) {
                await callTauriCommand('reopen_location', { sessionId, location });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/recount_list/active') {
            if (isTauri()) {
                try {
                    const list = await callTauriCommand('get_active_recount_list');
                    return createJsonResponse(list || []);
                } catch (e) {
                    console.warn("Error getting recount list:", e);
                }
            }
            return createJsonResponse([]);
        }

        // -------------------------------------------------------------
        // 6. SPOT CHECK & EXPRESS AUDIT
        // -------------------------------------------------------------
        if (pathname === '/api/spot_check/list') {
            if (isTauri()) {
                try {
                    const list = await callTauriCommand('get_spot_checks');
                    return createJsonResponse(list || []);
                } catch (e) {
                    console.warn("Error getting spot checks:", e);
                }
            }
            const list = await db.getAll('local_spot_check') || [];
            return createJsonResponse(list);
        }

        if (pathname.startsWith('/api/spot_check/find/')) {
            const code = decodeURIComponent(pathname.replace('/api/spot_check/find/', '')).trim().toUpperCase();
            if (isTauri()) {
                try {
                    const item = await callTauriCommand('find_item_spot_check', { itemCode: code });
                    if (item) return createJsonResponse(item);
                } catch (e) {
                    console.warn("Error in find_item_spot_check:", e);
                }
            }
            return createJsonResponse({ error: "Item no encontrado" }, 404);
        }

        if (pathname === '/api/spot_check/save') {
            if (isTauri()) {
                try {
                    const record = await callTauriCommand('save_spot_check', {
                        record: {
                            id: body?.id || null,
                            item_code: body?.item_code || body?.itemCode || '',
                            description: body?.description || null,
                            location: body?.location || body?.bin_location || 'N/A',
                            system_qty: Number(body?.system_qty || body?.systemQty || 0),
                            counted_qty: Number(body?.counted_qty || body?.countedQty || 0),
                            diff_qty: Number(body?.diff_qty || 0),
                            user_id: body?.user_id || 'admin',
                            timestamp: body?.timestamp || ''
                        }
                    });
                    return createJsonResponse({ success: true, record });
                } catch (e) {
                    console.error("Error in save_spot_check:", e);
                }
            }
            const record = { id: body?.id || Date.now(), ...body, timestamp: new Date().toISOString() };
            await db.put('local_spot_check', record);
            return createJsonResponse({ success: true, record });
        }

        if (pathname === '/api/spot_check/clear') {
            if (isTauri()) {
                await callTauriCommand('clear_spot_checks');
            }
            await db.clear('local_spot_check');
            return createJsonResponse({ success: true });
        }

        if (pathname.startsWith('/api/spot_check/delete/')) {
            const id = parseInt(pathname.replace('/api/spot_check/delete/', '')) || 0;
            if (isTauri() && id > 0) {
                await callTauriCommand('delete_spot_check', { id });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/express_audit/recordings') {
            if (isTauri()) {
                try {
                    const list = await callTauriCommand('get_express_audits');
                    return createJsonResponse(list || []);
                } catch (e) {
                    console.warn("Error getting express audits:", e);
                }
            }
            const list = await db.getAll('local_express_audit') || [];
            return createJsonResponse(list);
        }

        if (pathname.startsWith('/api/express_audit/find/')) {
            const code = decodeURIComponent(pathname.replace('/api/express_audit/find/', '')).trim().toUpperCase();
            if (isTauri()) {
                try {
                    const item = await callTauriCommand('find_item_express_audit', { itemCode: code });
                    if (item) return createJsonResponse(item);
                } catch (e) {
                    console.warn("Error in find_item_express_audit:", e);
                }
            }
            return createJsonResponse({ error: "Item no encontrado" }, 404);
        }

        if (pathname === '/api/express_audit/save') {
            if (isTauri()) {
                try {
                    const record = await callTauriCommand('save_express_audit', {
                        record: {
                            id: body?.id || null,
                            item_code: body?.item_code || '',
                            description: body?.description || null,
                            location: body?.location || 'N/A',
                            system_qty: Number(body?.system_qty || 0),
                            audited_qty: Number(body?.audited_qty || 0),
                            diff_qty: Number(body?.diff_qty || 0),
                            user_id: body?.user_id || 'admin',
                            timestamp: body?.timestamp || ''
                        }
                    });
                    return createJsonResponse({ success: true, record });
                } catch (e) {
                    console.error("Error in save_express_audit:", e);
                }
            }
            const record = { id: body?.id || Date.now(), ...body, timestamp: new Date().toISOString() };
            await db.put('local_express_audit', record);
            return createJsonResponse({ success: true, record });
        }

        if (pathname === '/api/express_audit/clear') {
            if (isTauri()) {
                await callTauriCommand('clear_express_audits');
            }
            await db.clear('local_express_audit');
            return createJsonResponse({ success: true });
        }

        // -------------------------------------------------------------
        // 7. RECONCILIACIÓN (INBOUND / GRN & INVENTARIO GENERAL)
        // -------------------------------------------------------------
        if (pathname === '/api/views/reconciliation') {
            const archiveDate = searchParams.get('archive_date') || null;
            if (isTauri()) {
                try {
                    const response = await callTauriCommand('get_inbound_reconciliation', {
                        archiveDate,
                        snapshotDate: null,
                        filterGrn: null,
                        filterWaybill: null,
                        filterImportRef: null,
                        isHistory: false
                    });
                    if (response) return createJsonResponse(response);
                } catch (e) {
                    console.warn("Error getting inbound reconciliation from SQLite:", e);
                }
            }

            // Fallback en IndexedDB offline si no corre en Tauri
            const logs = await db.getAll('inbound_logs') || [];
            const rows = logs.map(l => ({
                id: l.id || Math.random(),
                Import_Reference: l.importReference || l.import_reference || '',
                Waybill: l.waybill || '-',
                GRN: l.grn || 'N/A',
                Order_Line: l.order_line || '-',
                Codigo_Item: l.itemCode || l.item_code || '',
                Descripcion: l.itemDescription || l.item_description || '',
                Ubicacion: l.binLocation || l.bin_location || 'N/A',
                Reubicado: l.relocatedBin || l.relocated_bin || '',
                Cant_Esperada: Number(l.expected_qty || l.qty_grn || 0),
                Cant_Recibida: Number(l.qtyReceived || l.qty_received || 0),
                Diferencia: Number(l.difference || 0),
                Timestamp: l.timestamp || new Date().toISOString(),
                Usuario: l.username || 'admin',
                Snapshot_Date: l.archived_at || null
            }));
            return createJsonResponse({ data: rows, archive_versions: [], snapshot_versions: [] });
        }

        if (pathname === '/api/views/reconciliation/history') {
            const snapshotDate = searchParams.get('snapshot_date') || null;
            const filterGrn = searchParams.get('grn') || null;
            const filterWaybill = searchParams.get('waybill') || null;
            const filterImportRef = searchParams.get('import_reference') || null;

            if (isTauri()) {
                try {
                    const response = await callTauriCommand('get_inbound_reconciliation', {
                        archiveDate: null,
                        snapshotDate,
                        filterGrn,
                        filterWaybill,
                        filterImportRef,
                        isHistory: true
                    });
                    if (response) return createJsonResponse(response);
                } catch (e) {
                    console.warn("Error getting inbound reconciliation history:", e);
                }
            }
            return createJsonResponse({ data: [], archive_versions: [], snapshot_versions: [] });
        }

        if (pathname === '/api/views/reconciliation/archive') {
            if (isTauri()) {
                const countMsg = await callTauriCommand('archive_inbound_logs');
                const nowStr = new Date().toISOString();
                return createJsonResponse({ success: true, archive_date: nowStr, message: countMsg });
            }
            return createJsonResponse({ success: true, archive_date: new Date().toISOString() });
        }

        if (pathname === '/api/logs/unarchive') {
            const versionDate = body?.version_date || body?.versionDate || '';
            if (isTauri() && versionDate) {
                const msg = await callTauriCommand('unarchive_inbound_logs_version', { versionDate });
                return createJsonResponse({ success: true, message: msg });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/views/reconciliation/restore_rows_bulk') {
            const ids = body?.ids || body?.row_ids || [];
            if (isTauri() && ids.length > 0) {
                const msg = await callTauriCommand('restore_inbound_rows_bulk', { ids });
                return createJsonResponse({ success: true, message: msg });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/views/reconciliation/delete_rows_bulk') {
            const ids = body?.ids || body?.row_ids || [];
            if (isTauri() && ids.length > 0) {
                const msg = await callTauriCommand('delete_inbound_rows_bulk', { ids });
                return createJsonResponse({ success: true, message: msg });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/admin/inventory/reconciliation') {
            if (isTauri()) {
                try {
                    const rec = await callTauriCommand('get_reconciliation_data', { qtyTolerance: 0.05, valTolerance: 50.0 });
                    if (rec) return createJsonResponse(rec);
                } catch (e) {
                    console.warn("Error getting reconciliation from SQLite:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname === '/api/admin/inventory/summary') {
            if (isTauri()) {
                try {
                    const summary = await callTauriCommand('get_inventory_summary');
                    if (summary) return createJsonResponse(summary);
                } catch (e) {
                    console.warn("Error in get_inventory_summary:", e);
                }
            }
            return createJsonResponse({
                total_skus: 0,
                total_counted: 0,
                total_variance_cost: 0,
                current_stage: 1,
                is_active: true
            });
        }

        if (pathname === '/api/admin/inventory/settings' || pathname === '/api/w2w/settings') {
            if (method === 'POST') {
                if (isTauri()) {
                    await callTauriCommand('save_inventory_settings', {
                        settings: {
                            stage: Number(body?.stage || 1),
                            auto_advance: Boolean(body?.auto_advance),
                            qty_tolerance: Number(body?.qty_tolerance || 0.05),
                            val_tolerance: Number(body?.val_tolerance || 50.0)
                        }
                    });
                }
                return createJsonResponse({ success: true });
            }

            if (isTauri()) {
                try {
                    const cfg = await callTauriCommand('get_inventory_settings');
                    if (cfg) return createJsonResponse(cfg);
                } catch (e) {
                    console.warn("Error getting inventory settings:", e);
                }
            }
            return createJsonResponse({ stage: 1, auto_advance: false, qty_tolerance: 0.05, val_tolerance: 50.0 });
        }

        if (pathname === '/api/admin/inventory/start_stage_1' || pathname === '/admin/inventory/start_stage_1') {
            if (isTauri()) {
                const msg = await callTauriCommand('start_w2w_stage_1');
                return createJsonResponse({ message: msg });
            }
            return createJsonResponse({ message: "Etapa 1 iniciada" });
        }

        if (pathname.startsWith('/api/admin/inventory/advance') || pathname.startsWith('/admin/inventory/advance')) {
            const stage = parseInt(pathname.split('/').pop() || '2') || 2;
            const qtyTolerance = body?.qty_tolerance ? Number(body.qty_tolerance) : null;
            const valTolerance = body?.val_tolerance ? Number(body.val_tolerance) : null;
            if (isTauri()) {
                const recountCount = await callTauriCommand('advance_inventory_stage', {
                    stage,
                    qtyTolerance,
                    valTolerance
                });
                return createJsonResponse({ success: true, stage, recount_count: recountCount, message: `Etapa ${stage} iniciada. ${recountCount} ítems enviados a reconteo.` });
            }
            return createJsonResponse({ success: true, stage });
        }

        if (pathname === '/api/admin/inventory/approve_item') {
            const itemCode = body?.item_code || body?.itemCode || '';
            if (isTauri() && itemCode) {
                const msg = await callTauriCommand('approve_w2w_item', { itemCode });
                return createJsonResponse({ message: msg });
            }
            return createJsonResponse({ message: `Ítem ${itemCode} aprobado.` });
        }

        if (pathname === '/api/admin/inventory/archive_w2w') {
            const archiveName = body?.archive_name || body?.name || null;
            if (isTauri()) {
                const msg = await callTauriCommand('archive_w2w_reconciliation', { archiveName });
                return createJsonResponse({ message: msg });
            }
            return createJsonResponse({ message: "Reconciliación archivada" });
        }

        if (pathname === '/api/admin/inventory/finalize' || pathname === '/admin/inventory/finalize') {
            if (isTauri()) {
                await callTauriCommand('finalize_inventory');
            }
            return createJsonResponse({ success: true, message: "Inventario finalizado exitosamente" });
        }

        // -------------------------------------------------------------
        // 8. SLOTTING & PLANIFICADOR DE CONTEOS
        // -------------------------------------------------------------
        if (pathname === '/api/admin/slotting-summary') {
            if (isTauri()) {
                try {
                    const sum = await callTauriCommand('get_slotting_summary');
                    if (sum) return createJsonResponse(sum);
                } catch (e) {
                    console.warn("Error getting slotting summary:", e);
                }
            }
            return createJsonResponse({ total_locations: 0, optimized_locations: 0, pending_relocations: 0 });
        }

        if (pathname === '/api/admin/slotting-config') {
            if (method === 'POST') {
                if (isTauri()) {
                    await callTauriCommand('save_slotting_config', { config: body });
                }
                return createJsonResponse({ success: true, message: "Configuración de slotting guardada" });
            }
            if (isTauri()) {
                try {
                    const cfg = await callTauriCommand('get_slotting_config');
                    if (cfg) return createJsonResponse(cfg);
                } catch (e) {
                    console.warn("Error in get_slotting_config:", e);
                }
            }
            return createJsonResponse({});
        }

        if (pathname.startsWith('/api/suggest_bin/') || pathname.startsWith('/api/suggest_slotting_bin/')) {
            const itemCode = decodeURIComponent(pathname.split('/').pop() || '').trim().toUpperCase();
            if (isTauri() && itemCode) {
                try {
                    const bin = await callTauriCommand('suggest_slotting_bin', { itemCode });
                    return createJsonResponse({ suggestedBin: bin, suggested_bin: bin });
                } catch (e) {
                    console.warn("Error in suggest_slotting_bin:", e);
                }
            }
            return createJsonResponse({ suggestedBin: null, suggested_bin: null });
        }

        if (pathname === '/api/planner/config') {
            if (method === 'POST') {
                if (isTauri()) {
                    await callTauriCommand('save_planner_config', {
                        config: {
                            cycle_type: body?.cycle_type || 'ABC',
                            days_per_cycle: Number(body?.days_per_cycle || 30),
                            a_frequency_days: Number(body?.a_frequency_days || 7),
                            b_frequency_days: Number(body?.b_frequency_days || 15),
                            c_frequency_days: Number(body?.c_frequency_days || 30)
                        }
                    });
                }
                return createJsonResponse({ success: true });
            }

            if (isTauri()) {
                try {
                    const cfg = await callTauriCommand('get_planner_config');
                    if (cfg) return createJsonResponse(cfg);
                } catch (e) {
                    console.warn("Error getting planner config:", e);
                }
            }
            return createJsonResponse({ cycle_type: 'ABC', days_per_cycle: 30, a_frequency_days: 7, b_frequency_days: 15, c_frequency_days: 30 });
        }

        if (pathname === '/api/planner/current_plan' || pathname === '/api/planner/execution/stats') {
            if (isTauri()) {
                try {
                    const stats = await callTauriCommand('get_planner_stats');
                    if (stats) return createJsonResponse(stats);
                } catch (e) {
                    console.warn("Error in get_planner_stats:", e);
                }
            }
            return createJsonResponse({
                total_items_planned: 0,
                completed_today: 0,
                remaining_today: 0,
                progress_percentage: 0
            });
        }

        if (pathname === '/api/planner/execution/daily_items') {
            if (isTauri()) {
                try {
                    const items = await callTauriCommand('get_planner_daily_items');
                    if (items) return createJsonResponse(items);
                } catch (e) {
                    console.warn("Error getting daily items in Rust:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname === '/api/planner/execution/save') {
            if (isTauri()) {
                try {
                    const rec = await callTauriCommand('save_planner_execution', {
                        record: {
                            id: body?.id || null,
                            plan_date: body?.plan_date || '',
                            item_code: body?.item_code || '',
                            description: body?.description || null,
                            bin_location: body?.bin_location || null,
                            status: body?.status || 'Completado',
                            user_id: body?.user_id || 'admin',
                            timestamp: body?.timestamp || ''
                        }
                    });
                    return createJsonResponse({ success: true, record: rec });
                } catch (e) {
                    console.error("Error saving planner execution:", e);
                }
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/planner/execution/items_with_differences') {
            if (isTauri()) {
                const diffs = await callTauriCommand('get_items_with_differences_planner');
                return createJsonResponse(diffs || []);
            }
            return createJsonResponse([]);
        }

        if (pathname.startsWith('/api/planner/cycle_count_differences/')) {
            const recId = parseInt(pathname.replace('/api/planner/cycle_count_differences/', '')) || 0;
            const status = body?.status || body?.root_cause || 'Investigado';
            if (isTauri() && recId > 0) {
                await callTauriCommand('update_planner_difference_cause', { execId: recId, status });
            }
            return createJsonResponse({ success: true });
        }

        if (pathname === '/api/planner/recalculate_all_differences') {
            if (isTauri()) {
                const diffs = await callTauriCommand('calculate_cycle_count_differences');
                return createJsonResponse({ success: true, count: diffs?.length || 0 });
            }
            return createJsonResponse({ success: true, count: 0 });
        }

        // -------------------------------------------------------------
        // 9. EXPORTACIONES (CSV / XLSX)
        // -------------------------------------------------------------
        if (pathname.startsWith('/api/export_') || pathname.startsWith('/api/counts/export') || pathname.startsWith('/api/spot_check/export') || pathname.startsWith('/api/planner/generate_plan')) {
            if (pathname.includes('counts') || pathname.includes('recount')) {
                const counts = isTauri() ? await callTauriCommand('get_all_counts', { countType: null }) : await db.getAll('local_counts') || [];
                const ws = XLSX.utils.json_to_sheet(counts || []);
                const csv = XLSX.utils.sheet_to_csv(ws);
                downloadLocalFile(`conteos_${Date.now()}.csv`, csv);
                return createTextResponse(csv, 200, 'text/csv');
            }
            if (pathname.includes('reconciliation')) {
                let recData = [];
                if (isTauri()) {
                    const archiveDate = searchParams.get('archive_date') || null;
                    const snapshotDate = searchParams.get('snapshot_date') || null;
                    const recRes = await callTauriCommand('get_inbound_reconciliation', {
                        archiveDate,
                        snapshotDate,
                        filterGrn: null,
                        filterWaybill: null,
                        filterImportRef: null,
                        isHistory: !!snapshotDate
                    });
                    recData = recRes?.data || [];
                }
                const ws = XLSX.utils.json_to_sheet(recData || []);
                const csv = XLSX.utils.sheet_to_csv(ws);
                downloadLocalFile(`conciliacion_inbound_${Date.now()}.csv`, csv);
                return createTextResponse(csv, 200, 'text/csv');
            }
            if (pathname.includes('spot_check')) {
                const spot = isTauri() ? await callTauriCommand('get_spot_checks') : [];
                const ws = XLSX.utils.json_to_sheet(spot || []);
                const csv = XLSX.utils.sheet_to_csv(ws);
                downloadLocalFile(`spot_check_${Date.now()}.csv`, csv);
                return createTextResponse(csv, 200, 'text/csv');
            }
            if (pathname.includes('inbound') || pathname.includes('logs')) {
                const logs = isTauri() ? await callTauriCommand('get_inbound_logs', { versionDate: null }) : [];
                const ws = XLSX.utils.json_to_sheet(logs || []);
                const csv = XLSX.utils.sheet_to_csv(ws);
                downloadLocalFile(`inbound_logs_${Date.now()}.csv`, csv);
                return createTextResponse(csv, 200, 'text/csv');
            }
        }

        // -------------------------------------------------------------
        // 10. SINCRONIZACIÓN, CARGAS & UTILIDADES
        // -------------------------------------------------------------
        if (pathname === '/api/sync/status') {
            return createJsonResponse({
                last_sync: new Date().toISOString(),
                is_synced: true,
                pending_count: 0
            });
        }

        if (pathname === '/api/sync/master_data') {
            return createJsonResponse({
                success: true,
                message: "Maestro sincronizado en almacenamiento local",
                timestamp: new Date().toISOString()
            });
        }

        if (pathname === '/api/grn/unique_references') {
            if (isTauri()) {
                try {
                    const refs = await callTauriCommand('get_unique_grn_references');
                    return createJsonResponse((refs || []).map(r => ({ reference: r })));
                } catch (e) {
                    console.warn("Error getting unique GRN references:", e);
                }
            }
            return createJsonResponse([]);
        }

        if (pathname === '/api/clear_database') {
            if (isTauri()) {
                await callTauriCommand('clear_all_database');
            }
            await db.clear('master_items');
            await db.clear('grn_pending');
            await db.clear('xdock_reservations');
            await db.clear('po_lookup');
            await db.clear('picking_orders');
            await db.clear('picking_audits');
            await db.clear('local_counts');
            await db.clear('local_inbound');
            return createJsonResponse({ success: true, message: "Base de datos local restablecida correctamente" });
        }

        if (pathname === '/api/measure-v2') {
            if (isTauri() && body?.item_code) {
                try {
                    const res = await callTauriCommand('save_item_measurement', {
                        measurement: {
                            item_code: body.item_code,
                            length_cm: Number(body.length_cm || 20.0),
                            width_cm: Number(body.width_cm || 15.0),
                            height_cm: Number(body.height_cm || 10.0),
                            volume_cm3: Number(body.volume_cm3 || 3000.0),
                            weight_kg: Number(body.weight_kg || 0.0)
                        }
                    });
                    return createJsonResponse(res);
                } catch (e) {
                    console.error("Error saving measurement in Tauri:", e);
                }
            }
            return createJsonResponse({
                success: true,
                length_cm: 20.0,
                width_cm: 15.0,
                height_cm: 10.0,
                volume_cm3: 3000.0,
                confidence: 0.95
            });
        }

        // Fallback genérico para cualquier otra ruta de /api
        return createJsonResponse({ success: true, message: "Operación completada en modo local", path: pathname });

    } catch (err) {
        console.error(`[LocalApiBridge Error] En ${pathname}:`, err);
        return createJsonResponse({ error: String(err), message: "Error interno en despachador local" }, 500);
    }
}
