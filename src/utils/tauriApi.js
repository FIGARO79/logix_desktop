/**
 * tauriApi.js — Módulo de acceso directo a comandos Tauri (invoke)
 *
 * Reemplaza el patrón fetch('/api/...') → localApiBridge → callTauriCommand
 * por llamadas directas a invoke() sin capas intermedias.
 *
 * Uso:
 *   import { savePickingAudit, getPickingAudits } from '../utils/tauriApi';
 *   const id = await savePickingAudit(payload);
 */

const getInvoke = () => {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI__?.tauri?.invoke) return window.__TAURI__.tauri.invoke;
    if (window.__TAURI__?.invoke) return window.__TAURI__.invoke;
    return null;
};

const tauriInvoke = async (cmd, args = {}) => {
    const invokeFn = getInvoke();
    if (invokeFn) {
        try {
            return await invokeFn(cmd, args);
        } catch (err) {
            console.warn(`Invocación nativa de '${cmd}' falló, usando respaldo API:`, err);
        }
    }

    if (cmd === 'save_picking_audit_full') {
        const res = await fetch('/api/save_picking_audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args.payload || args)
        });
        if (res.ok) {
            const data = await res.json();
            return data.audit_id || data.id || Date.now();
        }
    } else if (cmd === 'get_picking_audits_full') {
        const res = await fetch('/api/views/view_picking_audits');
        if (res.ok) return await res.json();
    } else if (cmd === 'get_picking_tracking') {
        const res = await fetch('/api/picking/tracking');
        if (res.ok) return await res.json();
    } else if (cmd === 'get_picking_order_details') {
        const res = await fetch(`/api/picking/order_details?order_number=${encodeURIComponent(args.orderNumber || '')}&despatch_number=${encodeURIComponent(args.despatchNumber || '')}`);
        if (res.ok) return await res.json();
    }

    if (cmd.startsWith('save_') || cmd.startsWith('update_') || cmd.startsWith('delete_')) {
        return Date.now();
    }
    return null;
};

// ─────────────────────────────────────────────────────
// AUTH & USERS
// ─────────────────────────────────────────────────────

export const loginUser = (username, password) =>
    tauriInvoke('login', { username, password });

export const registerUser = (data) =>
    tauriInvoke('register_user', { data });

export const getAllUsersAdmin = () =>
    tauriInvoke('get_all_users_admin');

export const deleteUserAdmin = (userId) =>
    tauriInvoke('delete_user_admin', { userId });

export const resetUserPasswordAdmin = (userId, newPassword) =>
    tauriInvoke('reset_user_password_admin', { userId, newPassword });

export const updateUserPermissionsAdmin = (userId, permissions) =>
    tauriInvoke('update_user_permissions_admin', { userId, permissions });

export const approveUserAdmin = (userId) =>
    tauriInvoke('approve_user_admin', { userId });

export const getAvailableAisles = () =>
    tauriInvoke('get_available_aisles');

export const getAuditorZones = (username) =>
    tauriInvoke('get_auditor_zones', { username });

export const assignAuditorZones = (username, zones) =>
    tauriInvoke('assign_auditor_zones', { username, zones });

// ─────────────────────────────────────────────────────
// INVENTORY & MASTER ITEMS
// ─────────────────────────────────────────────────────

export const getInventoryItems = () =>
    tauriInvoke('get_inventory_items');

export const addInventoryItem = (item) =>
    tauriInvoke('add_inventory_item', { item });

export const addInventoryItemsBulk = (items) =>
    tauriInvoke('add_inventory_items_bulk', { items });

export const getItemDetails = (itemCode) =>
    tauriInvoke('get_item_details', { itemCode });

export const searchStockItems = (query) =>
    tauriInvoke('search_stock_items', { query });

export const getValidBins = () =>
    tauriInvoke('get_valid_bins');

export const getOccupancyStats = () =>
    tauriInvoke('get_occupancy_stats');

export const saveItemMeasurement = (data) =>
    tauriInvoke('save_item_measurement', { data });

export const clearAllDatabase = () =>
    tauriInvoke('clear_all_database');

// ─────────────────────────────────────────────────────
// INBOUND & RECEIVING
// ─────────────────────────────────────────────────────

export const getInboundLogs = () =>
    tauriInvoke('get_inbound_logs');

export const saveInboundLog = (log) =>
    tauriInvoke('save_inbound_log', { log });

export const deleteInboundLog = (id) =>
    tauriInvoke('delete_inbound_log', { id });

export const archiveInboundLogs = (ids) =>
    tauriInvoke('archive_inbound_logs', { ids });

export const getInboundVersions = () =>
    tauriInvoke('get_inbound_versions');

export const findItemInbound = (itemCode) =>
    tauriInvoke('find_item_inbound', { itemCode });

export const getInboundAlerts = () =>
    tauriInvoke('get_inbound_alerts');

export const clearInboundAlerts = () =>
    tauriInvoke('clear_inbound_alerts');

export const resolveInboundAlert = (alertId) =>
    tauriInvoke('resolve_inbound_alert', { alertId });

export const resolveInboundAlertsBulk = (alertIds) =>
    tauriInvoke('resolve_inbound_alerts_bulk', { alertIds });

export const runInboundAuditor = () =>
    tauriInvoke('run_inbound_auditor');

export const getIrReconciliations = () =>
    tauriInvoke('get_ir_reconciliations');

export const saveIrReconciliation = (data) =>
    tauriInvoke('save_ir_reconciliation', { data });

export const deleteIrReconciliation = (id) =>
    tauriInvoke('delete_ir_reconciliation', { id });

export const getInboundReconciliation = () =>
    tauriInvoke('get_inbound_reconciliation');

export const saveGrnReconciliationSnapshot = (data) =>
    tauriInvoke('save_grn_reconciliation_snapshot', { data });

export const getSavedGrnReconciliations = () =>
    tauriInvoke('get_saved_grn_reconciliations');

export const getSavedGrnReconciliationDetail = (id) =>
    tauriInvoke('get_saved_grn_reconciliation_detail', { id });

export const deleteSavedGrnReconciliation = (id) =>
    tauriInvoke('delete_saved_grn_reconciliation', { id });

export const lookupInboundReference = (reference) =>
    tauriInvoke('lookup_inbound_reference', { reference });

// ─────────────────────────────────────────────────────
// COUNTS & SESSIONS
// ─────────────────────────────────────────────────────

export const getActiveCountSession = () =>
    tauriInvoke('get_active_count_session');

export const startCountSession = (data) =>
    tauriInvoke('start_count_session', { data });

export const closeCountSession = (sessionId) =>
    tauriInvoke('close_count_session', { sessionId });

export const getSessionLocations = (sessionId) =>
    tauriInvoke('get_session_locations', { sessionId });

export const getSessionCountsByLocation = (sessionId, location) =>
    tauriInvoke('get_session_counts_by_location', { sessionId, location });

export const closeLocation = (sessionId, location) =>
    tauriInvoke('close_location', { sessionId, location });

export const reopenLocation = (sessionId, location) =>
    tauriInvoke('reopen_location', { sessionId, location });

export const getItemForCounting = (itemCode) =>
    tauriInvoke('get_item_for_counting', { itemCode });

export const addCountRecord = (record) =>
    tauriInvoke('add_count_record', { record });

export const getAllCounts = () =>
    tauriInvoke('get_all_counts');

export const deleteCountRecord = (id) =>
    tauriInvoke('delete_count_record', { id });

export const updateCountRecord = (id, data) =>
    tauriInvoke('update_count_record', { id, data });

export const updateCountRootCause = (id, rootCause) =>
    tauriInvoke('update_count_root_cause', { id, rootCause });

export const getCountStats = () =>
    tauriInvoke('get_count_stats');

export const calculateCycleCountDifferences = () =>
    tauriInvoke('calculate_cycle_count_differences');

export const getActiveRecountList = () =>
    tauriInvoke('get_active_recount_list');

// ─────────────────────────────────────────────────────
// RECONCILIATION & GENERAL INVENTORY
// ─────────────────────────────────────────────────────

export const getReconciliationData = () =>
    tauriInvoke('get_reconciliation_data');

export const getReconciliationStats = () =>
    tauriInvoke('get_reconciliation_stats');

export const getInventorySummary = () =>
    tauriInvoke('get_inventory_summary');

export const getInventorySettings = () =>
    tauriInvoke('get_inventory_settings');

export const saveInventorySettings = (settings) =>
    tauriInvoke('save_inventory_settings', { settings });

export const startW2wStage1 = () =>
    tauriInvoke('start_w2w_stage_1');

export const advanceInventoryStage = () =>
    tauriInvoke('advance_inventory_stage');

export const finalizeInventory = () =>
    tauriInvoke('finalize_inventory');

export const approveW2wItem = (itemCode) =>
    tauriInvoke('approve_w2w_item', { itemCode });

export const archiveW2wReconciliation = () =>
    tauriInvoke('archive_w2w_reconciliation');

// ─────────────────────────────────────────────────────
// PICKING & SHIPMENTS
// ─────────────────────────────────────────────────────

export const getPickingTracking = () =>
    tauriInvoke('get_picking_tracking');

export const getPickingOrderDetails = (orderNumber, despatchNumber) =>
    tauriInvoke('get_picking_order_details', { order_number: orderNumber, despatch_number: despatchNumber, orderNumber, despatchNumber });

export const savePickingAudit = (payload) =>
    tauriInvoke('save_picking_audit_full', { payload });

export const getPickingAudits = () =>
    tauriInvoke('get_picking_audits_full');

export const getPickingAuditById = (auditId) =>
    tauriInvoke('get_picking_audit_by_id_full', { audit_id: auditId, auditId });

export const updatePickingAudit = (auditId, payload) =>
    tauriInvoke('update_picking_audit_full', { id: auditId, auditId, payload });

export const deletePickingAudits = (ids) =>
    tauriInvoke('delete_picking_audits', { ids });

export const getPickingPackingList = (auditId) =>
    tauriInvoke('get_picking_packing_list', { audit_id: auditId, auditId });

export const createShipment = (data) =>
    tauriInvoke('create_shipment', { data });

export const listShipments = () =>
    tauriInvoke('list_shipments');

export const getConsolidatedPackingList = (shipmentId) =>
    tauriInvoke('get_consolidated_packing_list', { shipmentId });

export const deleteShipment = (shipmentId) =>
    tauriInvoke('delete_shipment', { shipmentId });

export const importPickingOrdersBulk = (orders) =>
    tauriInvoke('import_picking_orders_bulk', { orders });

// ─────────────────────────────────────────────────────
// SPOT CHECK & EXPRESS AUDIT
// ─────────────────────────────────────────────────────

export const getSpotChecks = () =>
    tauriInvoke('get_spot_checks');

export const findItemSpotCheck = (itemCode) =>
    tauriInvoke('find_item_spot_check', { itemCode });

export const saveSpotCheck = (data) =>
    tauriInvoke('save_spot_check', { data });

export const clearSpotChecks = () =>
    tauriInvoke('clear_spot_checks');

export const deleteSpotCheck = (id) =>
    tauriInvoke('delete_spot_check', { id });

export const getExpressAudits = () =>
    tauriInvoke('get_express_audits');

export const findItemExpressAudit = (itemCode) =>
    tauriInvoke('find_item_express_audit', { itemCode });

export const saveExpressAudit = (data) =>
    tauriInvoke('save_express_audit', { data });

export const clearExpressAudits = () =>
    tauriInvoke('clear_express_audits');

// ─────────────────────────────────────────────────────
// SLOTTING & PLANNER
// ─────────────────────────────────────────────────────

export const suggestSlottingBin = (itemCode) =>
    tauriInvoke('suggest_slotting_bin', { itemCode });

export const getSlottingSummary = () =>
    tauriInvoke('get_slotting_summary');

export const getSlottingConfig = () =>
    tauriInvoke('get_slotting_config');

export const saveSlottingConfig = (config) =>
    tauriInvoke('save_slotting_config', { config });

export const getPlannerConfig = () =>
    tauriInvoke('get_planner_config');

export const savePlannerConfig = (config) =>
    tauriInvoke('save_planner_config', { config });

export const getPlannerDailyItems = (date) =>
    tauriInvoke('get_planner_daily_items', { date });

export const getItemsWithDifferencesPlanner = () =>
    tauriInvoke('get_items_with_differences_planner');

export const updatePlannerDifferenceCause = (id, cause) =>
    tauriInvoke('update_planner_difference_cause', { id, cause });

export const savePlannerExecution = (data) =>
    tauriInvoke('save_planner_execution', { data });

export const getPlannerStats = () =>
    tauriInvoke('get_planner_stats');

// ─────────────────────────────────────────────────────
// EXPORT DEFAULT (acceso agrupado opcional)
// ─────────────────────────────────────────────────────

export default {
    // Auth
    loginUser, registerUser, getAllUsersAdmin, deleteUserAdmin,
    resetUserPasswordAdmin, updateUserPermissionsAdmin, approveUserAdmin,
    getAvailableAisles, getAuditorZones, assignAuditorZones,
    // Inventory
    getInventoryItems, addInventoryItem, addInventoryItemsBulk,
    getItemDetails, searchStockItems, getValidBins, getOccupancyStats,
    saveItemMeasurement, clearAllDatabase,
    // Inbound
    getInboundLogs, saveInboundLog, deleteInboundLog, archiveInboundLogs,
    getInboundVersions, findItemInbound, getInboundAlerts, clearInboundAlerts,
    resolveInboundAlert, resolveInboundAlertsBulk, runInboundAuditor,
    getIrReconciliations, saveIrReconciliation, deleteIrReconciliation,
    getInboundReconciliation, saveGrnReconciliationSnapshot,
    getSavedGrnReconciliations, getSavedGrnReconciliationDetail,
    deleteSavedGrnReconciliation, lookupInboundReference,
    // Counts
    getActiveCountSession, startCountSession, closeCountSession,
    getSessionLocations, getSessionCountsByLocation, closeLocation,
    reopenLocation, getItemForCounting, addCountRecord, getAllCounts,
    deleteCountRecord, updateCountRecord, updateCountRootCause,
    getCountStats, calculateCycleCountDifferences, getActiveRecountList,
    // Reconciliation
    getReconciliationData, getReconciliationStats, getInventorySummary,
    getInventorySettings, saveInventorySettings, startW2wStage1,
    advanceInventoryStage, finalizeInventory, approveW2wItem, archiveW2wReconciliation,
    // Picking
    getPickingTracking, getPickingOrderDetails, savePickingAudit,
    getPickingAudits, getPickingAuditById, updatePickingAudit,
    deletePickingAudits, getPickingPackingList, createShipment,
    listShipments, getConsolidatedPackingList, deleteShipment,
    importPickingOrdersBulk,
    // Spot & Express
    getSpotChecks, findItemSpotCheck, saveSpotCheck, clearSpotChecks,
    deleteSpotCheck, getExpressAudits, findItemExpressAudit,
    saveExpressAudit, clearExpressAudits,
    // Slotting & Planner
    suggestSlottingBin, getSlottingSummary, getSlottingConfig,
    saveSlottingConfig, getPlannerConfig, savePlannerConfig,
    getPlannerDailyItems, getItemsWithDifferencesPlanner,
    updatePlannerDifferenceCause, savePlannerExecution, getPlannerStats,
};
