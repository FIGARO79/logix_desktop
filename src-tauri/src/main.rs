// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod counts;
mod db;
mod general_inventory;
mod inbound;
mod master_maps;
mod network_sync;
mod picking;
mod planner;
mod printer;
mod server;
mod slotting;
mod spot_check;
mod stock;

use db::{get_app_data_dir, Database};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;

pub struct AppState {
    pub db: Database,
    pub server: server::HostServerManager,
    pub sync_watcher: network_sync::NetworkSyncWatcher,
}

fn get_data_file_path(filename: &str) -> PathBuf {
    let data_dir = get_app_data_dir();
    let target_file = data_dir.join(filename);

    if target_file.exists() {
        return target_file;
    }

    // Migración transparente si existía en Logix_portable
    if let Some(parent) = data_dir.parent() {
        let old_portable_file = parent.join("Logix_portable").join(filename);
        if old_portable_file.exists() {
            let _ = std::fs::copy(&old_portable_file, &target_file);
            return target_file;
        }
    }

    // Si aún no existe (por ejemplo, antes del primer guardado), retornar la ruta dentro de data/
    target_file
}

// -------------------------------------------------------------
// 1. AUTENTICACIÓN & USUARIOS
// -------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub permissions: String,
    pub is_approved: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserAdminView {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub permissions: String,
    pub is_approved: bool,
    pub assigned_zones: String,
    pub created_at: String,
}

#[tauri::command]
fn login(
    state: State<'_, AppState>,
    username: String,
    password_hash: String,
) -> Result<User, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, username, role, permissions, is_approved FROM users WHERE username = ?1 AND password_hash = ?2")
        .map_err(|e| e.to_string())?;

    let user = stmt
        .query_row(params![username.trim(), password_hash.trim()], |row| {
            let is_appr: i32 = row.get(4)?;
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                role: row.get(2)?,
                permissions: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| {
                    "stock,inbound,picking,inventory,planner,counts,admin".to_string()
                }),
                is_approved: is_appr != 0,
            })
        })
        .map_err(|_| "Usuario o contraseña incorrectos".to_string())?;

    Ok(user)
}

#[tauri::command]
fn register_user(
    state: State<'_, AppState>,
    username: String,
    password_hash: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (username, password_hash, role, permissions, is_approved) VALUES (?1, ?2, 'operator', 'stock,inbound,picking,counts', 1);",
        params![username.trim(), password_hash.trim()],
    )
    .map_err(|_| "El nombre de usuario ya existe".to_string())?;

    Ok("Usuario registrado exitosamente".to_string())
}

#[tauri::command]
fn get_all_users_admin(state: State<'_, AppState>) -> Result<Vec<UserAdminView>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, username, role, permissions, is_approved, assigned_zones, created_at FROM users")
        .map_err(|e| e.to_string())?;

    let user_iter = stmt
        .query_map([], |row| {
            let is_appr: i32 = row.get(4)?;
            Ok(UserAdminView {
                id: row.get(0)?,
                username: row.get(1)?,
                role: row.get(2)?,
                permissions: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| {
                    "stock,inbound,picking,inventory,planner,counts,admin".to_string()
                }),
                is_approved: is_appr != 0,
                assigned_zones: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                created_at: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut users = Vec::new();
    for u in user_iter.flatten() {
        users.push(u);
    }
    Ok(users)
}

#[tauri::command]
fn delete_user_admin(state: State<'_, AppState>, user_id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM users WHERE id = ?1", params![user_id])
        .map_err(|e| e.to_string())?;
    Ok("Usuario eliminado".to_string())
}

#[tauri::command]
fn reset_user_password_admin(
    state: State<'_, AppState>,
    user_id: i64,
    new_password: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![new_password.trim(), user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Contraseña actualizada".to_string())
}

#[tauri::command]
fn update_user_permissions_admin(
    state: State<'_, AppState>,
    user_id: i64,
    permissions: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE users SET permissions = ?1 WHERE id = ?2",
        params![permissions.trim(), user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Permisos actualizados".to_string())
}

#[tauri::command]
fn approve_user_admin(state: State<'_, AppState>, user_id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE users SET is_approved = 1 WHERE id = ?1",
        params![user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Usuario aprobado exitosamente".to_string())
}

#[tauri::command]
fn get_available_aisles(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::get_available_aisles_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_auditor_zones(state: State<'_, AppState>) -> Result<Vec<stock::AuditorZoneInfo>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::get_auditor_zones_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn assign_auditor_zones(
    state: State<'_, AppState>,
    user_id: i64,
    assigned_zones: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::assign_auditor_zones_db(&conn, user_id, &assigned_zones).map_err(|e| e.to_string())
}

// -------------------------------------------------------------
// 2. INVENTARIO & MAESTRO DE PRODUCTOS
// -------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryItem {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub additional_bins: Option<String>,
    pub system_qty: f64,
    pub unit_cost: f64,
    pub weight_per_unit: f64,
    pub sic_code: String,
    pub abc_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ItemDetails {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub additional_bins: String,
    pub weight_kg: f64,
    pub system_qty: f64,
    pub unit_cost: f64,
    pub sic_code: String,
    pub abc_code: String,
    pub length_cm: f64,
    pub width_cm: f64,
    pub height_cm: f64,
    pub volume_cm3: f64,
    pub updated_at: String,
}

#[tauri::command]
fn get_inventory_items(state: State<'_, AppState>) -> Result<Vec<InventoryItem>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT item_code, description, bin_location, additional_bins, system_qty, unit_cost, weight_per_unit, sic_code, abc_code FROM inventory_items")
        .map_err(|e| e.to_string())?;

    let item_iter = stmt
        .query_map([], |row| {
            Ok(InventoryItem {
                item_code: row.get(0)?,
                description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                bin_location: row
                    .get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "N/A".to_string()),
                additional_bins: row.get(3)?,
                system_qty: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                unit_cost: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                weight_per_unit: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                sic_code: row
                    .get::<_, Option<String>>(7)?
                    .unwrap_or_else(|| "0".to_string()),
                abc_code: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for item in item_iter.flatten() {
        items.push(item);
    }
    Ok(items)
}

#[tauri::command]
fn add_inventory_item(state: State<'_, AppState>, item: InventoryItem) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO inventory_items (item_code, description, bin_location, additional_bins, system_qty, unit_cost, weight_per_unit, sic_code, abc_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(item_code) DO UPDATE SET
            description = excluded.description,
            bin_location = excluded.bin_location,
            additional_bins = excluded.additional_bins,
            system_qty = excluded.system_qty,
            unit_cost = excluded.unit_cost,
            weight_per_unit = excluded.weight_per_unit,
            sic_code = excluded.sic_code,
            abc_code = excluded.abc_code;",
        params![
            item.item_code.trim().to_uppercase(),
            item.description,
            item.bin_location.trim().to_uppercase(),
            item.additional_bins.unwrap_or_default(),
            item.system_qty,
            item.unit_cost,
            item.weight_per_unit,
            item.sic_code,
            item.abc_code,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok("Item guardado correctamente".to_string())
}

#[tauri::command]
fn add_inventory_items_bulk(
    state: State<'_, AppState>,
    items: Vec<InventoryItem>,
) -> Result<String, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO inventory_items (item_code, description, bin_location, additional_bins, system_qty, unit_cost, weight_per_unit, sic_code, abc_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(item_code) DO UPDATE SET
                    description = excluded.description,
                    bin_location = excluded.bin_location,
                    additional_bins = excluded.additional_bins,
                    system_qty = excluded.system_qty,
                    unit_cost = excluded.unit_cost,
                    weight_per_unit = excluded.weight_per_unit,
                    sic_code = excluded.sic_code,
                    abc_code = excluded.abc_code;",
            )
            .map_err(|e| e.to_string())?;

        for item in &items {
            stmt.execute(params![
                item.item_code.trim().to_uppercase(),
                item.description,
                item.bin_location.trim().to_uppercase(),
                item.additional_bins.clone().unwrap_or_default(),
                item.system_qty,
                item.unit_cost,
                item.weight_per_unit,
                item.sic_code,
                item.abc_code,
            ])
            .map_err(|e| e.to_string())?;
        }

        let now_ts = chrono::Utc::now().timestamp();
        let _ = tx.execute(
            "INSERT INTO sync_metadata (key, timestamp) VALUES ('master_items', ?1)
             ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
            params![now_ts],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(format!("Se guardaron {} ítems exitosamente", items.len()))
}

#[tauri::command]
fn get_item_details(state: State<'_, AppState>, item_code: String) -> Result<ItemDetails, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let code_clean = item_code.trim().to_uppercase();

    let mut stmt = conn
        .prepare("SELECT item_code, description, bin_location, additional_bins, weight_per_unit, system_qty, unit_cost, sic_code, abc_code, length_cm, width_cm, height_cm, volume_cm3, updated_at FROM inventory_items WHERE UPPER(item_code) = ?1")
        .map_err(|e| e.to_string())?;

    let mut result = stmt
        .query_row(params![code_clean], |row| {
            Ok(ItemDetails {
                item_code: row.get(0)?,
                description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                bin_location: row
                    .get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "N/A".to_string()),
                additional_bins: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                weight_kg: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                system_qty: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                unit_cost: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                sic_code: row
                    .get::<_, Option<String>>(7)?
                    .unwrap_or_else(|| "0".to_string()),
                abc_code: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                length_cm: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                width_cm: row.get::<_, Option<f64>>(10)?.unwrap_or(0.0),
                height_cm: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                volume_cm3: row.get::<_, Option<f64>>(12)?.unwrap_or(0.0),
                updated_at: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
            })
        })
        .ok();

    // Fallback: si no se encontró exacto, buscar ignorando caracteres especiales / símbolos (ej. .>RU18278, BG-0086)
    if result.is_none() {
        let alpha_code: String = code_clean.chars().filter(|c| c.is_alphanumeric()).collect();
        if !alpha_code.is_empty() {
            let mut stmt_all = conn.prepare("SELECT item_code, description, bin_location, additional_bins, weight_per_unit, system_qty, unit_cost, sic_code, abc_code, length_cm, width_cm, height_cm, volume_cm3, updated_at FROM inventory_items").map_err(|e| e.to_string())?;
            let iter = stmt_all
                .query_map([], |row| {
                    Ok(ItemDetails {
                        item_code: row.get(0)?,
                        description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        bin_location: row
                            .get::<_, Option<String>>(2)?
                            .unwrap_or_else(|| "N/A".to_string()),
                        additional_bins: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        weight_kg: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                        system_qty: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                        unit_cost: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                        sic_code: row
                            .get::<_, Option<String>>(7)?
                            .unwrap_or_else(|| "0".to_string()),
                        abc_code: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                        length_cm: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                        width_cm: row.get::<_, Option<f64>>(10)?.unwrap_or(0.0),
                        height_cm: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                        volume_cm3: row.get::<_, Option<f64>>(12)?.unwrap_or(0.0),
                        updated_at: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                    })
                })
                .map_err(|e| e.to_string())?;

            for cand in iter.flatten() {
                let cand_alpha: String = cand
                    .item_code
                    .chars()
                    .filter(|c| c.is_alphanumeric())
                    .collect();
                if cand_alpha.to_uppercase() == alpha_code {
                    result = Some(cand);
                    break;
                }
            }
        }
    }

    match result {
        Some(details) => Ok(details),
        None => Err(format!(
            "Item '{}' no encontrado en el inventario local",
            code_clean
        )),
    }
}

#[tauri::command]
fn search_stock_items(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<stock::StockItemResult>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::search_stock_items(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_stock_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<Vec<stock::StockItemResult>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::search_stock_by_location(&conn, &location).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_valid_bins(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::get_valid_bins(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_occupancy_stats(state: State<'_, AppState>) -> Result<stock::OccupancyStats, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::get_occupancy_stats(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_item_measurement(
    state: State<'_, AppState>,
    measurement: stock::ItemMeasurementInput,
) -> Result<stock::MeasurementResponse, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    stock::save_item_measurement(&conn, measurement).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_all_database(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "DELETE FROM inventory_items;
         DELETE FROM inbound_logs;
         DELETE FROM inbound_alerts;
         DELETE FROM ir_reconciliations;
         DELETE FROM counts;
         DELETE FROM count_sessions;
         DELETE FROM session_locations;
         DELETE FROM recount_list;
         DELETE FROM picking_orders;
         DELETE FROM picking_audits;
         DELETE FROM spot_checks;
         DELETE FROM express_audits;
         DELETE FROM planner_executions;",
    )
    .map_err(|e| e.to_string())?;

    Ok("Base de datos local restablecida correctamente".to_string())
}

// -------------------------------------------------------------
// 3. INBOUND & RECEPCIÓN
// -------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct InboundLookup {
    pub waybill: String,
    pub import_ref: String,
    pub items: Vec<Value>,
}

#[tauri::command]
fn get_inbound_logs(
    state: State<'_, AppState>,
    version_date: Option<String>,
) -> Result<Vec<inbound::LogInbound>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::get_logs_from_db(&conn, version_date).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_inbound_log(
    state: State<'_, AppState>,
    mut entry: inbound::LogInbound,
) -> Result<inbound::LogInbound, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    if entry.client_id.is_none() || entry.client_id.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
        entry.client_id = Some(format!(
            "inb_{}_{}",
            chrono::Local::now().format("%Y%m%d%H%M%S"),
            network_sync::uuid_fast()
        ));
    }

    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    let saved = inbound::save_log_to_db(
        &conn,
        entry,
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
    )
    .map_err(|e| e.to_string())?;

    // Replicar evento a la red descentralizada si está disponible
    if let Ok(payload) = serde_json::to_value(&saved) {
        let _ = network_sync::publish_event(&conn, "INBOUND_LOG_SAVE", payload);
    }

    Ok(saved)
}

#[tauri::command]
fn delete_inbound_log(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let client_id: Option<String> = conn
        .query_row(
            "SELECT client_id FROM inbound_logs WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok();

    inbound::delete_log_from_db(&conn, id).map_err(|e| e.to_string())?;

    if let Some(cid) = client_id {
        let payload = serde_json::json!({
            "client_id": cid,
            "id": id
        });
        let _ = network_sync::publish_event(&conn, "INBOUND_LOG_DELETE", payload);
    }

    Ok("Log eliminado".to_string())
}

#[tauri::command]
fn archive_inbound_logs(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count = inbound::archive_logs_in_db(&conn).map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "archived_at": now
    });
    let _ = network_sync::publish_event(&conn, "INBOUND_LOGS_ARCHIVE", payload);

    Ok(format!("{} logs archivados exitosamente", count))
}

#[tauri::command]
fn sync_inbound_logs_network(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let count = network_sync::broadcast_all_inbound_logs(&conn)?;
    Ok(format!("{} registros de inbound sincronizados con la red", count))
}

#[tauri::command]
fn get_inbound_versions(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::get_versions_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_item_inbound(
    state: State<'_, AppState>,
    item_code: String,
    import_ref: Option<String>,
) -> Result<inbound::InboundItemFinderResult, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    inbound::find_item_inbound(
        &conn,
        &item_code,
        import_ref.as_deref(),
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_inbound_alerts(state: State<'_, AppState>) -> Result<Vec<inbound::InboundAlert>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::get_alerts_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_inbound_alerts(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::clear_alerts_in_db(&conn).map_err(|e| e.to_string())?;
    Ok("Alertas limpiadas".to_string())
}

#[tauri::command]
fn resolve_inbound_alert(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::resolve_alert_in_db(&conn, id).map_err(|e| e.to_string())?;
    Ok("Alerta resuelta".to_string())
}

#[tauri::command]
fn resolve_inbound_alerts_bulk(
    state: State<'_, AppState>,
    alert_ids: Vec<i64>,
) -> Result<usize, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::resolve_alerts_bulk_in_db(&conn, &alert_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn run_inbound_auditor(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    inbound::run_inbound_auditor_db(
        &conn,
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_ir_reconciliations(
    state: State<'_, AppState>,
) -> Result<Vec<inbound::IrReconciliation>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::get_ir_reconciliations_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_ir_reconciliation(
    state: State<'_, AppState>,
    rec: inbound::IrReconciliation,
) -> Result<inbound::IrReconciliation, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::save_ir_reconciliation_to_db(&conn, rec).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_ir_reconciliation(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::delete_ir_reconciliation_from_db(&conn, &id).map_err(|e| e.to_string())?;
    Ok("Registro eliminado".to_string())
}

#[tauri::command]
fn get_inbound_reconciliation(
    state: State<'_, AppState>,
    archive_date: Option<String>,
    snapshot_date: Option<String>,
    filter_grn: Option<String>,
    filter_waybill: Option<String>,
    filter_import_ref: Option<String>,
    is_history: Option<bool>,
) -> Result<inbound::InboundReconciliationResponse, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    inbound::get_inbound_reconciliation_view(
        &conn,
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
        archive_date,
        snapshot_date,
        filter_grn,
        filter_waybill,
        filter_import_ref,
        is_history.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn unarchive_inbound_logs_version(
    state: State<'_, AppState>,
    version_date: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let count =
        inbound::unarchive_logs_version_db(&conn, &version_date).map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "version_date": version_date
    });
    let _ = network_sync::publish_event(&conn, "INBOUND_LOGS_UNARCHIVE", payload);

    Ok(format!("{} registros desarchivados con éxito", count))
}

#[tauri::command]
fn restore_inbound_rows_bulk(state: State<'_, AppState>, ids: Vec<i64>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut client_ids: Vec<String> = Vec::new();
    for id in &ids {
        if let Ok(cid) = conn.query_row(
            "SELECT client_id FROM inbound_logs WHERE id = ?1",
            params![id],
            |r| r.get::<_, Option<String>>(0),
        ) {
            if let Some(c) = cid {
                client_ids.push(c);
            }
        }
    }

    let count = inbound::restore_inbound_rows_bulk_db(&conn, &ids).map_err(|e| e.to_string())?;

    if !client_ids.is_empty() {
        let payload = serde_json::json!({
            "client_ids": client_ids,
            "ids": ids
        });
        let _ = network_sync::publish_event(&conn, "INBOUND_LOGS_RESTORE_BULK", payload);
    }

    Ok(format!("{} registros restaurados", count))
}

#[tauri::command]
fn delete_inbound_rows_bulk(state: State<'_, AppState>, ids: Vec<i64>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut client_ids: Vec<String> = Vec::new();
    for id in &ids {
        if let Ok(cid) = conn.query_row(
            "SELECT client_id FROM inbound_logs WHERE id = ?1",
            params![id],
            |r| r.get::<_, Option<String>>(0),
        ) {
            if let Some(c) = cid {
                client_ids.push(c);
            }
        }
    }

    let count = inbound::delete_inbound_rows_bulk_db(&conn, &ids).map_err(|e| e.to_string())?;

    if !client_ids.is_empty() {
        let payload = serde_json::json!({
            "client_ids": client_ids,
            "ids": ids
        });
        let _ = network_sync::publish_event(&conn, "INBOUND_LOGS_DELETE_BULK", payload);
    }

    Ok(format!("{} registros eliminados", count))
}

#[tauri::command]
fn get_inbound_ir_stats_data(
    import_ref: String,
) -> Result<inbound::InboundIrStatsResponse, String> {
    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    Ok(inbound::get_inbound_ir_stats_data_rust(
        &import_ref,
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
    ))
}

#[tauri::command]
fn get_inbound_expected_bulk(
    items: Vec<inbound::InboundExpectedQueryItem>,
) -> Result<std::collections::HashMap<String, f64>, String> {
    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    Ok(inbound::get_inbound_expected_bulk_rust(
        items,
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
    ))
}

#[tauri::command]
fn save_grn_reconciliation_snapshot(
    state: State<'_, AppState>,
    payload: inbound::SaveGRNReconciliationPayload,
) -> Result<i64, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::save_grn_reconciliation_snapshot_in_db(&mut conn, payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn upsert_draft_comment(
    state: State<'_, AppState>,
    payload: inbound::UpsertDraftCommentPayload,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::upsert_draft_comment_in_db(&conn, payload).map_err(|e| e.to_string())?;
    Ok("Comentario guardado correctamente".to_string())
}

#[tauri::command]
fn get_saved_grn_reconciliations(
    state: State<'_, AppState>,
    grn_filter: Option<String>,
    ir_filter: Option<String>,
) -> Result<Vec<inbound::SavedGRNReconciliationHeader>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::get_saved_grn_reconciliations_list_from_db(&conn, grn_filter, ir_filter)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_saved_grn_reconciliation_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Option<inbound::SavedGRNReconciliationDetail>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::get_saved_grn_reconciliation_detail_from_db(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_saved_grn_reconciliation(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    inbound::delete_saved_grn_reconciliation_from_db(&conn, id).map_err(|e| e.to_string())?;
    Ok("Conciliación eliminada con éxito".to_string())
}

#[tauri::command]
fn get_unique_grn_references(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let po_path = get_data_file_path("po_lookup.json");
    let grn_path = get_data_file_path("grn_master_data.json");
    let refs = inbound::get_unique_grn_references(
        &conn,
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
    );
    Ok(refs)
}

#[tauri::command]
fn get_inbound_master_maps(
    state: State<'_, AppState>,
) -> Result<Vec<master_maps::MasterMapEntry>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    let stmt = conn
        .prepare("SELECT po_number, item_code, status FROM inbound_records")
        .ok();
    let db_grns = if let Some(mut s) = stmt {
        s.query_map([], |row| {
            let ir: Option<String> = row.get(0).ok();
            let grn: Option<String> = row.get(1).ok();
            let wb: Option<String> = row.get(2).ok();
            Ok((ir, grn, wb))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        Vec::new()
    };

    let grn_path = get_data_file_path("grn_master_data.json");
    let po_path = get_data_file_path("po_lookup.json");

    let maps = master_maps::build_master_maps_rust(
        db_grns,
        grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
        po_path.to_str().unwrap_or("./data/po_lookup.json"),
    );
    Ok(maps)
}

#[tauri::command]
fn save_po_lookup_json(state: State<'_, AppState>, json_content: String) -> Result<String, String> {
    let path = get_data_file_path("po_lookup.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, json_content).map_err(|e| e.to_string())?;
    if let Ok(conn) = state.db.get_connection() {
        let now_ts = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "INSERT INTO sync_metadata (key, timestamp) VALUES ('po_extractor', ?1)
             ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
            params![now_ts],
        );
    }
    Ok("Caché local PO Extractor guardado en data/po_lookup.json".to_string())
}

#[tauri::command]
fn save_grn_master_json(
    state: State<'_, AppState>,
    json_content: String,
) -> Result<String, String> {
    let path = get_data_file_path("grn_master_data.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, json_content).map_err(|e| e.to_string())?;
    if let Ok(conn) = state.db.get_connection() {
        let now_ts = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "INSERT INTO sync_metadata (key, timestamp) VALUES ('grn_pending', ?1)
             ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
            params![now_ts],
        );
    }
    Ok("Caché local GRN guardado en data/grn_master_data.json".to_string())
}

#[tauri::command]
fn save_xdock_reservations_json(
    state: State<'_, AppState>,
    json_content: String,
) -> Result<String, String> {
    let path = get_data_file_path("xdock_reservations.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, json_content).map_err(|e| e.to_string())?;
    if let Ok(conn) = state.db.get_connection() {
        let now_ts = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "INSERT INTO sync_metadata (key, timestamp) VALUES ('xdock_reservations', ?1)
             ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
            params![now_ts],
        );
    }
    Ok("Caché local de Reservas Xdock guardado en data/xdock_reservations.json".to_string())
}

fn strip_ir_prefix(s: &str) -> &str {
    let t = s.trim();
    if t.starts_with("IR-") || t.starts_with("IR_") || t.starts_with("IR ") {
        &t[3..]
    } else if let Some(stripped) = t.strip_prefix("IR") {
        stripped
    } else if t.starts_with("REF-") || t.starts_with("PO-") {
        &t[4..]
    } else {
        t
    }
}

#[tauri::command]
fn lookup_inbound_reference(
    state: State<'_, AppState>,
    waybill: Option<String>,
    import_ref: Option<String>,
) -> Result<InboundLookup, String> {
    let wb = waybill.unwrap_or_default().trim().to_uppercase();
    let ir = import_ref.unwrap_or_default().trim().to_uppercase();

    let clean_wb = wb.replace(|c: char| !c.is_alphanumeric(), "");
    let clean_ir = ir.replace(|c: char| !c.is_alphanumeric(), "");

    let ir_stripped = strip_ir_prefix(&ir);
    let _clean_ir_stripped = ir_stripped.replace(|c: char| !c.is_alphanumeric(), "");

    let grn_path = get_data_file_path("grn_master_data.json");
    let po_path = get_data_file_path("po_lookup.json");

    let mut res_wb = wb.clone();
    let mut res_ir = ir.clone();
    let mut res_items: Vec<Value> = Vec::new();

    // 1. Lectura desde po_lookup.json
    if let Ok(data) = std::fs::read_to_string(&po_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&data) {
            if !ir.is_empty() {
                if let Some(ir_map) = json.get("ir_to_data").and_then(|v| v.as_object()) {
                    let mut found_wb_str = None;
                    for (k, e) in ir_map {
                        if inbound::match_ref_rust(k, &ir) {
                            found_wb_str = e
                                .get("waybill")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            if let Some(items) = e.get("items").and_then(|v| v.as_array()) {
                                res_items = items.clone();
                            }
                            res_ir = k.clone();
                            break;
                        }
                    }
                    if let Some(wb_found) = found_wb_str {
                        if !wb_found.is_empty() {
                            res_wb = wb_found;
                        }
                    }
                }
                // Si no se encontró en ir_to_data, buscar en wb_to_data
                if res_items.is_empty() {
                    if let Some(wb_map) = json.get("wb_to_data").and_then(|v| v.as_object()) {
                        for (wb_k, e) in wb_map {
                            let obj_ir = e.get("import_ref").and_then(|v| v.as_str()).unwrap_or("");
                            if inbound::match_ref_rust(obj_ir, &ir) {
                                res_wb = wb_k.clone();
                                res_ir = obj_ir.to_string();
                                if let Some(items) = e.get("items").and_then(|v| v.as_array()) {
                                    res_items = items.clone();
                                }
                                break;
                            }
                        }
                    }
                }
            } else if !wb.is_empty() {
                if let Some(wb_map) = json.get("wb_to_data").and_then(|v| v.as_object()) {
                    let mut found_ir_str = None;
                    for (k, e) in wb_map {
                        if inbound::match_ref_rust(k, &wb) {
                            found_ir_str = e
                                .get("import_ref")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            if let Some(items) = e.get("items").and_then(|v| v.as_array()) {
                                res_items = items.clone();
                            }
                            res_wb = k.clone();
                            break;
                        }
                    }
                    if let Some(ir_found) = found_ir_str {
                        if !ir_found.is_empty() {
                            res_ir = ir_found;
                        }
                    }
                }
                // Si no se encontró en wb_to_data, buscar en ir_to_data
                if res_items.is_empty() {
                    if let Some(ir_map) = json.get("ir_to_data").and_then(|v| v.as_object()) {
                        for (ir_k, e) in ir_map {
                            let obj_wb = e.get("waybill").and_then(|v| v.as_str()).unwrap_or("");
                            if inbound::match_ref_rust(obj_wb, &wb) {
                                res_ir = ir_k.clone();
                                res_wb = obj_wb.to_string();
                                if let Some(items) = e.get("items").and_then(|v| v.as_array()) {
                                    res_items = items.clone();
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback a Master Maps
    if (res_wb == wb && !ir.is_empty()) || (res_ir == ir && !wb.is_empty()) {
        let conn = state.db.get_connection().ok();
        let db_grns = if let Some(c) = conn {
            if let Ok(mut stmt) =
                c.prepare("SELECT po_number, item_code, status FROM inbound_records")
            {
                stmt.query_map([], |row| {
                    Ok((row.get(0).ok(), row.get(1).ok(), row.get(2).ok()))
                })
                .ok()
                .map(|iter| iter.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        let master_maps = master_maps::build_master_maps_rust(
            db_grns,
            grn_path.to_str().unwrap_or("./data/grn_master_data.json"),
            po_path.to_str().unwrap_or("./data/po_lookup.json"),
        );

        for m in master_maps {
            let m_ir = m.import_reference.trim().to_uppercase();
            let m_wb = m.waybill.trim().to_uppercase();
            let m_grn = m.grn_number.trim().to_uppercase();

            let clean_m_ir = m_ir.replace(|c: char| !c.is_alphanumeric(), "");
            let clean_m_wb = m_wb.replace(|c: char| !c.is_alphanumeric(), "");
            let clean_m_grn = m_grn.replace(|c: char| !c.is_alphanumeric(), "");

            if !clean_ir.is_empty() {
                if clean_m_ir == clean_ir || m_ir == ir || clean_m_grn == clean_ir {
                    if !m_wb.is_empty() {
                        res_wb = m_wb;
                    }
                    if !m_ir.is_empty() {
                        res_ir = m_ir;
                    }
                    break;
                }
            } else if !clean_wb.is_empty() && (clean_m_wb == clean_wb || m_wb == wb) {
                if !m_wb.is_empty() {
                    res_wb = m_wb;
                }
                if !m_ir.is_empty() {
                    res_ir = m_ir;
                }
                break;
            }
        }
    }

    Ok(InboundLookup {
        waybill: res_wb,
        import_ref: res_ir,
        items: res_items,
    })
}

// -------------------------------------------------------------
// 4. CONTEOS CÍCLICOS & SESIONES
// -------------------------------------------------------------

#[tauri::command]
fn get_active_count_session(state: State<'_, AppState>) -> Result<Option<counts::CountSession>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_active_session(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_count_session(
    state: State<'_, AppState>,
    name: String,
    username: String,
) -> Result<counts::CountSession, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::start_session(&conn, &name, &username).map_err(|e| e.to_string())
}

#[tauri::command]
fn close_count_session(state: State<'_, AppState>, session_id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::close_session(&conn, session_id).map_err(|e| e.to_string())?;
    Ok("Sesión cerrada".to_string())
}

#[tauri::command]
fn get_session_locations(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_session_locations(&conn, session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_counts_by_location(
    state: State<'_, AppState>,
    session_id: i64,
    location: String,
) -> Result<Vec<counts::CountRecord>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_session_counts_by_location(&conn, session_id, &location).map_err(|e| e.to_string())
}

#[tauri::command]
fn close_location(
    state: State<'_, AppState>,
    session_id: i64,
    location: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::close_location(&conn, session_id, &location).map_err(|e| e.to_string())?;
    Ok("Ubicación cerrada".to_string())
}

#[tauri::command]
fn reopen_location(
    state: State<'_, AppState>,
    session_id: i64,
    location: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::reopen_location(&conn, session_id, &location).map_err(|e| e.to_string())?;
    Ok("Ubicación reabierta".to_string())
}

#[tauri::command]
fn get_item_for_counting(
    state: State<'_, AppState>,
    item_code: String,
) -> Result<counts::ItemCountingDetails, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_item_for_counting(&conn, &item_code).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_count_record(
    state: State<'_, AppState>,
    record: counts::CountRecord,
) -> Result<counts::CountRecord, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::add_count(&conn, record).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_counts(
    state: State<'_, AppState>,
    count_type: Option<String>,
) -> Result<Vec<counts::CountRecord>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_all_counts(&conn, count_type).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_count_record(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::delete_count(&conn, id).map_err(|e| e.to_string())?;
    Ok("Conteo eliminado".to_string())
}

#[tauri::command]
fn update_count_record(
    state: State<'_, AppState>,
    id: i64,
    record: counts::CountRecord,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::update_count(&conn, id, record).map_err(|e| e.to_string())?;
    Ok("Conteo actualizado".to_string())
}

#[tauri::command]
fn get_count_stats(state: State<'_, AppState>) -> Result<counts::CountStats, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_count_stats(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_inventory_dashboard_stats(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_inventory_dashboard_stats(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn calculate_cycle_count_differences(
    state: State<'_, AppState>,
) -> Result<Vec<counts::CycleCountResult>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_cycle_count_differences_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_active_recount_list(state: State<'_, AppState>) -> Result<Vec<counts::RecountItem>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_active_recount_list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_planner_cycle_count_differences(
    state: State<'_, AppState>,
    year: Option<i32>,
    month: Option<i32>,
    only_differences: Option<bool>,
) -> Result<Vec<counts::PlannerCycleCountDiff>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::get_planner_cycle_count_differences(
        &conn,
        year,
        month,
        only_differences.unwrap_or(true),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_planner_cycle_count_diff(
    state: State<'_, AppState>,
    rec_id: i64,
    physical_qty: f64,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::update_planner_cycle_count_diff(&conn, rec_id, physical_qty)
        .map_err(|e| e.to_string())?;
    Ok("Actualizado correctamente".to_string())
}

// -------------------------------------------------------------
// 5. RECONCILIACIÓN & INVENTARIO GENERAL (W2W)
// -------------------------------------------------------------

#[tauri::command]
fn get_reconciliation_data(
    state: State<'_, AppState>,
    qty_tolerance: Option<f64>,
    val_tolerance: Option<f64>,
) -> Result<Vec<general_inventory::ReconciliationRow>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::get_reconciliation_from_db(&conn, qty_tolerance, val_tolerance)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_reconciliation_stats(
    state: State<'_, AppState>,
) -> Result<general_inventory::GeneralInventoryStats, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::get_reconciliation_stats_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_inventory_summary(
    state: State<'_, AppState>,
) -> Result<general_inventory::InventorySummary, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::get_inventory_summary_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_inventory_settings(
    state: State<'_, AppState>,
) -> Result<general_inventory::InventorySettings, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::get_inventory_settings_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_inventory_settings(
    state: State<'_, AppState>,
    settings: general_inventory::InventorySettings,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::save_inventory_settings_to_db(&conn, &settings)
        .map_err(|e| e.to_string())?;
    Ok("Configuración guardada".to_string())
}

#[tauri::command]
fn start_w2w_stage_1(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::start_w2w_stage_1_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn advance_inventory_stage(
    state: State<'_, AppState>,
    stage: i32,
    qty_tolerance: Option<f64>,
    val_tolerance: Option<f64>,
) -> Result<usize, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::advance_inventory_stage_db(&conn, stage, qty_tolerance, val_tolerance)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn finalize_inventory(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::finalize_w2w_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_w2w_item(state: State<'_, AppState>, item_code: String) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::approve_w2w_item_db(&conn, &item_code).map_err(|e| e.to_string())
}

#[tauri::command]
fn archive_w2w_reconciliation(
    state: State<'_, AppState>,
    archive_name: Option<String>,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    general_inventory::archive_w2w_reconciliation_db(&conn, archive_name).map_err(|e| e.to_string())
}

// -------------------------------------------------------------
// 6. PICKING & DESPACHOS (SHIPMENTS)
// -------------------------------------------------------------

#[tauri::command]
fn get_picking_tracking(
    state: State<'_, AppState>,
) -> Result<Vec<picking::PickingTrackingItem>, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let csv_path = get_data_file_path("AURRSGLBD0240.csv");
    let _ = picking::seed_picking_orders_from_csv_if_empty(
        &mut conn,
        csv_path.to_str().unwrap_or("./data/AURRSGLBD0240.csv"),
    );
    picking::get_picking_tracking_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_picking_order_details(
    state: State<'_, AppState>,
    order_number: String,
    despatch_number: String,
) -> Result<Vec<picking::PickingOrderRow>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::get_picking_order_details_from_db(&conn, &order_number, &despatch_number)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_picking_audit_full(
    state: State<'_, AppState>,
    payload: picking::PickingAuditFullInput,
) -> Result<i64, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::save_picking_audit_full_to_db(&mut conn, payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_picking_audits_full(
    state: State<'_, AppState>,
) -> Result<Vec<picking::PickingAuditSummaryFull>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::get_picking_audits_full_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_picking_audit_by_id_full(
    state: State<'_, AppState>,
    audit_id: i64,
) -> Result<Option<picking::PickingAuditSummaryFull>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::get_picking_audit_by_id_full_db(&conn, audit_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_picking_audit_full(
    state: State<'_, AppState>,
    id: i64,
    payload: picking::PickingAuditFullInput,
) -> Result<bool, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::update_picking_audit_full_in_db(&mut conn, id, payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_picking_audits(state: State<'_, AppState>, ids: Vec<i64>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::delete_picking_audits_from_db(&conn, &ids).map_err(|e| e.to_string())?;
    Ok("Auditorías eliminadas".to_string())
}

#[tauri::command]
fn get_picking_packing_list(
    state: State<'_, AppState>,
    audit_id: i64,
) -> Result<Option<picking::PickingAuditPackingListDto>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::get_picking_packing_list_from_db(&conn, audit_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_shipment(
    state: State<'_, AppState>,
    audit_ids: Vec<i64>,
    note: Option<String>,
    carrier: Option<String>,
    username: Option<String>,
) -> Result<i64, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::create_shipment_in_db(&mut conn, &audit_ids, note, carrier, username)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_shipments(state: State<'_, AppState>) -> Result<Vec<picking::ShipmentDto>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::list_shipments_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_consolidated_packing_list(
    state: State<'_, AppState>,
    shipment_id: i64,
) -> Result<Option<picking::ConsolidatedPackingListDto>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::get_consolidated_packing_list_from_db(&conn, shipment_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_shipment(state: State<'_, AppState>, shipment_id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    picking::delete_shipment_in_db(&conn, shipment_id).map_err(|e| e.to_string())?;
    Ok("Despacho eliminado".to_string())
}

#[tauri::command]
fn import_picking_orders_bulk(
    state: State<'_, AppState>,
    orders: Vec<picking::PickingOrderImportRow>,
) -> Result<String, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let count =
        picking::import_picking_orders_bulk_db(&mut conn, &orders).map_err(|e| e.to_string())?;
    let now_ts = chrono::Utc::now().timestamp();
    let _ = conn.execute(
        "INSERT INTO sync_metadata (key, timestamp) VALUES ('picking', ?1)
         ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
        params![now_ts],
    );
    Ok(format!(
        "Se importaron {} registros de picking en SQLite",
        count
    ))
}

// -------------------------------------------------------------
// 7. SPOT CHECK & EXPRESS AUDIT
// -------------------------------------------------------------

#[tauri::command]
fn get_spot_checks(state: State<'_, AppState>) -> Result<Vec<spot_check::SpotCheckItem>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::get_spot_checks_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_item_spot_check(
    state: State<'_, AppState>,
    item_code: String,
) -> Result<Option<spot_check::ItemQuickFind>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::find_item_quick(&conn, &item_code).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_spot_check(
    state: State<'_, AppState>,
    record: spot_check::SpotCheckItem,
) -> Result<spot_check::SpotCheckItem, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::save_spot_check_to_db(&conn, record).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_spot_checks(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::clear_spot_checks_in_db(&conn).map_err(|e| e.to_string())?;
    Ok("Spot checks limpiados".to_string())
}

#[tauri::command]
fn delete_spot_check(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::delete_spot_check_in_db(&conn, id).map_err(|e| e.to_string())?;
    Ok("Spot check eliminado".to_string())
}

#[tauri::command]
fn get_express_audits(
    state: State<'_, AppState>,
) -> Result<Vec<spot_check::ExpressAuditItem>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::get_express_audits_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_item_express_audit(
    state: State<'_, AppState>,
    item_code: String,
) -> Result<Option<spot_check::ItemQuickFind>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::find_item_quick(&conn, &item_code).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_express_audit(
    state: State<'_, AppState>,
    record: spot_check::ExpressAuditItem,
) -> Result<spot_check::ExpressAuditItem, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::save_express_audit_to_db(&conn, record).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_express_audits(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    spot_check::clear_express_audits_in_db(&conn).map_err(|e| e.to_string())?;
    Ok("Express audits limpiados".to_string())
}

// -------------------------------------------------------------
// 8. SLOTTING & PLANIFICADOR
// -------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct SlottingSummary {
    pub total_locations: usize,
    pub optimized_locations: usize,
    pub pending_relocations: usize,
}

#[tauri::command]
fn suggest_slotting_bin(
    state: State<'_, AppState>,
    item_code: String,
) -> Result<Option<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let slotting_path = get_data_file_path("slotting_parameters.json");

    let mut stmt = conn
        .prepare("SELECT item_code, description, bin_location, weight_per_unit, sic_code FROM inventory_items WHERE UPPER(item_code) = ?1")
        .map_err(|e| e.to_string())?;

    let code_upper = item_code.trim().to_uppercase();
    let item_res = stmt.query_row(params![code_upper], |row| {
        let code: String = row.get(0)?;
        let desc: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
        let bin: String = row
            .get::<_, Option<String>>(2)?
            .unwrap_or_else(|| "N/A".to_string());
        let weight: f64 = row.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
        let sic: String = row
            .get::<_, Option<String>>(4)?
            .unwrap_or_else(|| "0".to_string());
        Ok((code, desc, bin, weight, sic))
    });

    if let Ok((code, desc, bin, weight, sic)) = item_res {
        let result = slotting::calculate_suggested_bin(
            &conn,
            slotting_path
                .to_str()
                .unwrap_or("./data/slotting_parameters.json"),
            &code,
            &desc,
            &bin,
            weight,
            &sic,
        );
        Ok(result)
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn get_slotting_summary(state: State<'_, AppState>) -> Result<SlottingSummary, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let slotting_path = get_data_file_path("slotting_parameters.json");
    let (storage, _, _, _) = slotting::load_slotting_config(
        slotting_path
            .to_str()
            .unwrap_or("./data/slotting_parameters.json"),
    );

    let total_locations = storage.len();
    let occupancy = slotting::get_occupancy_from_db(&conn);
    let occupied = occupancy.len();

    Ok(SlottingSummary {
        total_locations,
        optimized_locations: occupied,
        pending_relocations: 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OccupancyDetailRow {
    pub bin_code: String,
    pub aisle: String,
    pub level: i32,
    pub zone: String,
    pub spot: String,
    pub skus: i32,
    pub occupancy_pct: i32,
}

#[tauri::command]
fn get_occupancy_report(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let slotting_path = get_data_file_path("slotting_parameters.json");
    let (mut storage, _, _, _) = slotting::load_slotting_config(
        slotting_path
            .to_str()
            .unwrap_or("./data/slotting_parameters.json"),
    );
    let occupancy = slotting::get_occupancy_from_db(&conn);

    if storage.is_empty() {
        if let Ok(mut stmt) =
            conn.prepare("SELECT bin_code, zone, aisle, level, spot, score FROM storage_locations")
        {
            if let Ok(iter) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    slotting::BinInfo {
                        zone: r.get(1)?,
                        aisle: r.get(2)?,
                        level: r.get(3)?,
                        spot: r.get(4)?,
                        score: r.get(5)?,
                    },
                ))
            }) {
                for item in iter.flatten() {
                    storage.insert(item.0.to_uppercase(), item.1);
                }
            }
        }
    }

    let mut zones_map: HashMap<String, Value> = HashMap::new();
    let mut zones_by_items: HashMap<String, i32> = HashMap::new();
    let mut aisles_by_items: HashMap<String, i32> = HashMap::new();
    let mut total_items: i32 = 0;
    let mut filled_bins: i32 = 0;
    let mut available_bins: i32 = 0;

    for (bin_code, info) in &storage {
        let zone = info.zone.clone().unwrap_or_else(|| "Unknown".to_string());
        let level = info.level.clamp(0, 8);
        let aisle = info.aisle.clone().unwrap_or_else(|| "N/A".to_string());

        let current_skus = *occupancy.get(bin_code).unwrap_or(&0);
        let limit = if zone.trim().eq_ignore_ascii_case("minuteria") {
            3
        } else {
            4
        };
        let bin_pct = std::cmp::min(
            100,
            ((current_skus as f64 / limit as f64) * 100.0).round() as i32,
        );

        if !zones_map.contains_key(&zone) {
            let mut levels_map = serde_json::Map::new();
            for l in 0..=8 {
                levels_map.insert(
                    l.to_string(),
                    serde_json::json!({
                        "total": 0,
                        "occupied_skus": 0,
                        "full_bins": 0,
                        "total_occupancy_pct": 0,
                        "occupied_bins": 0
                    }),
                );
            }
            zones_map.insert(
                zone.clone(),
                serde_json::json!({
                    "total": 0,
                    "occupied": 0,
                    "levels": levels_map
                }),
            );
        }

        if let Some(z_val) = zones_map.get_mut(&zone) {
            if let Some(z_obj) = z_val.as_object_mut() {
                if let Some(tot) = z_obj.get_mut("total").and_then(|v| v.as_i64()) {
                    z_obj.insert("total".to_string(), serde_json::json!(tot + 1));
                }
                if current_skus > 0 {
                    if let Some(occ) = z_obj.get_mut("occupied").and_then(|v| v.as_i64()) {
                        z_obj.insert("occupied".to_string(), serde_json::json!(occ + 1));
                    }
                }
                if let Some(lvl_map) = z_obj.get_mut("levels").and_then(|v| v.as_object_mut()) {
                    if let Some(lvl_entry) = lvl_map
                        .get_mut(&level.to_string())
                        .and_then(|v| v.as_object_mut())
                    {
                        let l_tot = lvl_entry.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
                        let l_occ_bins = lvl_entry
                            .get("occupied_bins")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        let l_full = lvl_entry
                            .get("full_bins")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        let l_skus = lvl_entry
                            .get("occupied_skus")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        let l_pct = lvl_entry
                            .get("total_occupancy_pct")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);

                        lvl_entry.insert("total".to_string(), serde_json::json!(l_tot + 1));
                        lvl_entry.insert(
                            "total_occupancy_pct".to_string(),
                            serde_json::json!(l_pct + bin_pct as i64),
                        );

                        if current_skus > 0 {
                            lvl_entry.insert(
                                "occupied_bins".to_string(),
                                serde_json::json!(l_occ_bins + 1),
                            );
                            lvl_entry.insert(
                                "occupied_skus".to_string(),
                                serde_json::json!(l_skus + current_skus as i64),
                            );
                            if current_skus >= limit {
                                lvl_entry
                                    .insert("full_bins".to_string(), serde_json::json!(l_full + 1));
                            }
                        }
                    }
                }
            }
        }

        if current_skus > 0 {
            filled_bins += 1;
            total_items += current_skus;
            *zones_by_items.entry(zone.clone()).or_insert(0) += current_skus;
            if aisle != "N/A" {
                *aisles_by_items.entry(aisle.clone()).or_insert(0) += current_skus;
            }
        } else {
            available_bins += 1;
        }
    }

    let total_bins = storage.len() as i32;
    let occupancy_pct = if total_bins > 0 {
        ((filled_bins as f64 / total_bins as f64) * 100.0).round() as i32
    } else {
        0
    };
    let avg_items_per_bin = if filled_bins > 0 {
        format!("{:.1}", total_items as f64 / filled_bins as f64)
    } else {
        "0.0".to_string()
    };

    let mut sorted_zones_items: Vec<(String, i32)> = zones_by_items.into_iter().collect();
    sorted_zones_items.sort_by_key(|b| std::cmp::Reverse(b.1));
    let top_zones_by_items: HashMap<String, i32> = sorted_zones_items.into_iter().take(5).collect();

    let mut sorted_aisles_items: Vec<(String, i32)> = aisles_by_items.into_iter().collect();
    sorted_aisles_items.sort_by_key(|b| std::cmp::Reverse(b.1));
    let top_aisles: HashMap<String, i32> = sorted_aisles_items.into_iter().take(5).collect();

    let bins_by_zone: HashMap<String, i32> = zones_map
        .iter()
        .map(|(z, val)| {
            let count = val.get("total").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            (z.clone(), count)
        })
        .collect();

    Ok(serde_json::json!({
        "summary": {
            "total_bins": total_bins,
            "filled_bins": filled_bins,
            "available_bins": available_bins,
            "occupancy_pct": occupancy_pct,
            "total_items": total_items,
            "avg_items_per_bin": avg_items_per_bin
        },
        "zones": zones_map,
        "analytics": {
            "bins_by_zone": bins_by_zone,
            "zones_by_items": top_zones_by_items,
            "top_aisles": top_aisles
        }
    }))
}

#[tauri::command]
fn get_occupancy_detail(
    state: State<'_, AppState>,
    zone: String,
    level: Option<i64>,
) -> Result<Vec<OccupancyDetailRow>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let slotting_path = get_data_file_path("slotting_parameters.json");
    let (mut storage, _, _, _) = slotting::load_slotting_config(
        slotting_path
            .to_str()
            .unwrap_or("./data/slotting_parameters.json"),
    );
    let occupancy = slotting::get_occupancy_from_db(&conn);

    if storage.is_empty() {
        if let Ok(mut stmt) =
            conn.prepare("SELECT bin_code, zone, aisle, level, spot, score FROM storage_locations")
        {
            if let Ok(iter) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    slotting::BinInfo {
                        zone: r.get(1)?,
                        aisle: r.get(2)?,
                        level: r.get(3)?,
                        spot: r.get(4)?,
                        score: r.get(5)?,
                    },
                ))
            }) {
                for item in iter.flatten() {
                    storage.insert(item.0.to_uppercase(), item.1);
                }
            }
        }
    }

    let mut list = Vec::new();
    let target_zone = zone.trim().to_uppercase();

    for (bin_code, info) in storage {
        let b_zone = info.zone.unwrap_or_else(|| "Unknown".to_string());
        let b_level = info.level as i64;
        let current_zone = b_zone.trim().to_uppercase();

        if current_zone == target_zone && (level.is_none() || level == Some(b_level)) {
            let sku_count = *occupancy.get(&bin_code).unwrap_or(&0);
            let limit = if target_zone == "MINUTERIA" { 3 } else { 4 };
            let occupancy_pct = std::cmp::min(
                100,
                ((sku_count as f64 / limit as f64) * 100.0).round() as i32,
            );

            list.push(OccupancyDetailRow {
                bin_code,
                aisle: info.aisle.unwrap_or_else(|| "N/A".to_string()),
                level: b_level as i32,
                zone: b_zone,
                spot: info.spot.unwrap_or_else(|| "Cold".to_string()),
                skus: sku_count,
                occupancy_pct,
            });
        }
    }

    list.sort_by(|a, b| match a.aisle.cmp(&b.aisle) {
        std::cmp::Ordering::Equal => a.bin_code.cmp(&b.bin_code),
        other => other,
    });
    Ok(list)
}

#[tauri::command]
fn get_slotting_config() -> Result<Value, String> {
    let slotting_path = get_data_file_path("slotting_parameters.json");
    if let Ok(data) = std::fs::read_to_string(&slotting_path) {
        if let Ok(val) = serde_json::from_str::<Value>(&data) {
            return Ok(val);
        }
    }
    // Fallback a configuración embebida en el binario
    if let Ok(val) = serde_json::from_str::<Value>(slotting::DEFAULT_SLOTTING_JSON) {
        return Ok(val);
    }
    Ok(serde_json::json!({
        "zone_rules": slotting::ZoneRules::default(),
        "mix_limits": slotting::MixLimits::default()
    }))
}

#[tauri::command]
fn save_slotting_config(state: State<'_, AppState>, config: Value) -> Result<String, String> {
    let slotting_path = get_data_file_path("slotting_parameters.json");
    if let Ok(str_val) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(&slotting_path, str_val);
    }

    if let Ok(mut conn) = state.db.get_connection() {
        if let Some(storage) = config.get("storage").and_then(|s| s.as_object()) {
            if let Ok(tx) = conn.transaction() {
                let _ = tx.execute("DELETE FROM storage_locations;", []);
                if let Ok(mut stmt) = tx.prepare(
                    "INSERT INTO storage_locations (bin_code, zone, aisle, level, spot, score)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(bin_code) DO UPDATE SET
                        zone = excluded.zone,
                        aisle = excluded.aisle,
                        level = excluded.level,
                        spot = excluded.spot,
                        score = excluded.score;",
                ) {
                    for (bin_code, info) in storage {
                        let zone = info
                            .get("zone")
                            .and_then(|v| v.as_str())
                            .unwrap_or("General");
                        let aisle = info.get("aisle").and_then(|v| v.as_str()).unwrap_or("");
                        let level = info.get("level").and_then(|v| v.as_i64()).unwrap_or(0);
                        let spot = info.get("spot").and_then(|v| v.as_str()).unwrap_or("cold");
                        let score = info.get("score").and_then(|v| v.as_i64()).unwrap_or(0);

                        let _ = stmt.execute(params![
                            bin_code.trim().to_uppercase(),
                            zone,
                            aisle,
                            level,
                            spot,
                            score
                        ]);
                    }
                }
                let _ = tx.commit();
            }
        }
    }

    Ok("Configuración de slotting guardada".to_string())
}

#[tauri::command]
fn get_planner_config(state: State<'_, AppState>) -> Result<planner::PlannerConfig, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::get_planner_config_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_planner_config(
    state: State<'_, AppState>,
    config: planner::PlannerConfig,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::save_planner_config_to_db(&conn, &config).map_err(|e| e.to_string())?;
    Ok("Configuración de planificador guardada".to_string())
}

#[tauri::command]
fn get_planner_daily_items(
    state: State<'_, AppState>,
) -> Result<Vec<planner::PlannerDailyItem>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::get_planner_daily_items_from_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_planner_execution(
    state: State<'_, AppState>,
    record: planner::PlannerExecutionRecord,
) -> Result<planner::PlannerExecutionRecord, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::save_planner_execution_to_db(&conn, record).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_count_root_cause(
    state: State<'_, AppState>,
    count_id: i64,
    root_cause: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    counts::update_count_root_cause_db(&conn, count_id, root_cause).map_err(|e| e.to_string())?;
    Ok("Causa raíz actualizada".to_string())
}

#[tauri::command]
fn get_items_with_differences_planner(
    state: State<'_, AppState>,
) -> Result<Vec<planner::PlannerExecutionRecord>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::get_items_with_differences_db(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_planner_difference_cause(
    state: State<'_, AppState>,
    exec_id: i64,
    status: String,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::update_planner_difference_cause_db(&conn, exec_id, &status)
        .map_err(|e| e.to_string())?;
    Ok("Estado de diferencia actualizado".to_string())
}

#[tauri::command]
fn get_planner_stats(state: State<'_, AppState>) -> Result<planner::PlannerStats, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    planner::get_planner_stats_from_db(&conn).map_err(|e| e.to_string())
}

// -------------------------------------------------------------
// 12. IMPRESIÓN DIRECTA & CONFIGURACIÓN DE IMPRESORAS
// -------------------------------------------------------------

#[tauri::command]
fn get_system_printers() -> Result<Vec<printer::PrinterInfo>, String> {
    printer::get_available_printers()
}

#[tauri::command]
fn print_sandvik_label_silent(
    printer_name: Option<String>,
    label: printer::SandvikLabelPrintPayload,
) -> Result<String, String> {
    let zpl = printer::generate_sandvik_zpl(&label);
    printer::send_raw_to_printer(printer_name, &zpl)
}

#[tauri::command]
fn print_raw_zpl(printer_name: Option<String>, zpl_content: String) -> Result<String, String> {
    printer::send_raw_to_printer(printer_name, &zpl_content)
}

#[tauri::command]
fn test_print_label(printer_name: Option<String>) -> Result<String, String> {
    let test_label = printer::SandvikLabelPrintPayload {
        item_code: "TEST-ITEM-999".to_string(),
        description: "ETIQUETA DE PRUEBA LOGIX".to_string(),
        quantity: 1,
        weight: "1.25".to_string(),
        packaging_date: Some(chrono::Local::now().format("%d/%m/%y").to_string()),
        bin_location: "TEST-BIN-01".to_string(),
        qr_data: Some("TEST-ITEM-999".to_string()),
    };
    let zpl = printer::generate_sandvik_zpl(&test_label);
    printer::send_raw_to_printer(printer_name, &zpl)
}

#[tauri::command]
fn get_sync_status(state: State<'_, AppState>) -> Result<HashMap<String, i64>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut map = HashMap::new();

    // 1. Read from sync_metadata
    if let Ok(mut stmt) = conn.prepare("SELECT key, timestamp FROM sync_metadata") {
        if let Ok(iter) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }) {
            for item in iter.flatten() {
                map.insert(item.0, item.1);
            }
        }
    }

    // 2. Fallbacks from table timestamps if key is missing or 0
    if !map.contains_key("master_items") || map["master_items"] == 0 {
        if let Ok(mut stmt) =
            conn.prepare("SELECT MAX(strftime('%s', updated_at)) FROM inventory_items")
        {
            if let Ok(Some(ts)) = stmt.query_row([], |r| r.get::<_, Option<i64>>(0)) {
                map.insert("master_items".to_string(), ts);
            }
        }
    }

    if !map.contains_key("grn_pending") || map["grn_pending"] == 0 {
        if let Ok(mut stmt) =
            conn.prepare("SELECT MAX(strftime('%s', timestamp)) FROM inbound_logs")
        {
            if let Ok(Some(ts)) = stmt.query_row([], |r| r.get::<_, Option<i64>>(0)) {
                map.insert("grn_pending".to_string(), ts);
            }
        }
        if !map.contains_key("grn_pending") || map["grn_pending"] == 0 {
            let grn_path = get_data_file_path("grn_master_data.json");
            if let Ok(meta) = std::fs::metadata(&grn_path) {
                if let Ok(mtime) = meta.modified() {
                    if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                        map.insert("grn_pending".to_string(), dur.as_secs() as i64);
                    }
                }
            }
        }
    }

    if !map.contains_key("picking") || map["picking"] == 0 {
        if let Ok(mut stmt) =
            conn.prepare("SELECT MAX(strftime('%s', timestamp)) FROM picking_orders")
        {
            if let Ok(Some(ts)) = stmt.query_row([], |r| r.get::<_, Option<i64>>(0)) {
                map.insert("picking".to_string(), ts);
            }
        }
    }

    if !map.contains_key("xdock_reservations") || map["xdock_reservations"] == 0 {
        if let Ok(mut stmt) =
            conn.prepare("SELECT MAX(strftime('%s', timestamp)) FROM xdock_reservations")
        {
            if let Ok(Some(ts)) = stmt.query_row([], |r| r.get::<_, Option<i64>>(0)) {
                map.insert("xdock_reservations".to_string(), ts);
            }
        }
        if !map.contains_key("xdock_reservations") || map["xdock_reservations"] == 0 {
            let xdock_path = get_data_file_path("xdock_reservations.json");
            if let Ok(meta) = std::fs::metadata(&xdock_path) {
                if let Ok(mtime) = meta.modified() {
                    if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                        map.insert("xdock_reservations".to_string(), dur.as_secs() as i64);
                    }
                }
            }
        }
    }

    if !map.contains_key("po_extractor") || map["po_extractor"] == 0 {
        if let Ok(mut stmt) = conn.prepare("SELECT MAX(strftime('%s', timestamp)) FROM po_lookup") {
            if let Ok(Some(ts)) = stmt.query_row([], |r| r.get::<_, Option<i64>>(0)) {
                map.insert("po_extractor".to_string(), ts);
            }
        }
        if !map.contains_key("po_extractor") || map["po_extractor"] == 0 {
            let po_path = get_data_file_path("po_lookup.json");
            if let Ok(meta) = std::fs::metadata(&po_path) {
                if let Ok(mtime) = meta.modified() {
                    if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                        map.insert("po_extractor".to_string(), dur.as_secs() as i64);
                    }
                }
            }
        }
    }

    Ok(map)
}

#[tauri::command]
fn set_sync_status(
    state: State<'_, AppState>,
    key: String,
    timestamp: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let ts = timestamp.unwrap_or_else(|| chrono::Utc::now().timestamp());
    conn.execute(
        "INSERT INTO sync_metadata (key, timestamp) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
        params![key, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// -------------------------------------------------------------
// 15. HOST SERVER (MODO SERVIDOR LOCAL)
// -------------------------------------------------------------

#[tauri::command]
fn start_host_server(
    state: State<'_, AppState>,
    port: Option<u16>,
) -> Result<server::ServerInfo, String> {
    let p = port.unwrap_or(8088);
    let db_clone = Database::new();
    let info = state.server.start(db_clone, p)?;

    // Persistir configuración en SQLite para auto-arranque permanente al reiniciar la app
    if let Ok(conn) = state.db.get_connection() {
        let _ = conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('host_server_autostart', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        );
        let _ = conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('host_server_port', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            [p.to_string()],
        );
    }

    Ok(info)
}

#[tauri::command]
fn stop_host_server(state: State<'_, AppState>) -> Result<server::ServerInfo, String> {
    let info = state.server.stop()?;

    // Desactivar auto-arranque en SQLite
    if let Ok(conn) = state.db.get_connection() {
        let _ = conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('host_server_autostart', '0')
             ON CONFLICT(key) DO UPDATE SET value = '0'",
            [],
        );
    }

    Ok(info)
}

#[tauri::command]
fn get_host_server_info(state: State<'_, AppState>) -> Result<server::ServerInfo, String> {
    Ok(state.server.get_info())
}

#[tauri::command]
fn get_distinct_operators(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT user_id FROM counts WHERE user_id IS NOT NULL AND user_id != '' 
         UNION 
         SELECT username FROM users WHERE is_approved = 1",
        )
        .map_err(|e| e.to_string())?;

    let ops: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(ops)
}

// -------------------------------------------------------------
// 16. DESCENTRALIZED NETWORK REPLICATION
// -------------------------------------------------------------

#[tauri::command]
fn get_network_environment() -> Result<network_sync::NetworkEnvironment, String> {
    Ok(network_sync::detect_environment())
}

#[tauri::command]
fn create_desktop_shortcut() -> Result<bool, String> {
    network_sync::ensure_desktop_shortcut()
}

#[tauri::command]
fn publish_sync_event(
    state: State<'_, AppState>,
    event_type: String,
    payload: Value,
) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    network_sync::publish_event(&conn, &event_type, payload)
}

#[tauri::command]
fn save_and_replicate_work_file(
    state: State<'_, AppState>,
    file_name: String,
    file_type: String,
    parsed_data: Value,
    uploader: Option<String>,
) -> Result<String, String> {
    let env = network_sync::detect_environment();
    let cargas_dir_str = match env.cargas_dir {
        Some(ref dir) => dir.clone(),
        None => return Ok("Modo local: no se replicó a la red".to_string()),
    };

    let cargas_dir = PathBuf::from(&cargas_dir_str);
    let _ = std::fs::create_dir_all(&cargas_dir);

    let now_prefix = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let safe_base = file_name.replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '_', "_");
    let json_filename = format!("{}_{}_{}.json", now_prefix, file_type, safe_base);

    let json_path = cargas_dir.join(&json_filename);
    let json_bytes = serde_json::to_vec_pretty(&parsed_data).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, &json_bytes)
        .map_err(|e| format!("Error guardando datos de carga en red: {}", e))?;

    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let record_count = if let Some(arr) = parsed_data.as_array() {
        arr.len()
    } else if let Some(obj) = parsed_data.as_object() {
        obj.len()
    } else {
        0
    };

    let payload = serde_json::json!({
        "file_name": safe_base,
        "data_file": json_filename,
        "file_type": file_type,
        "uploader": uploader.unwrap_or_else(|| env.machine_id.clone()),
        "record_count": record_count
    });

    network_sync::publish_event(&conn, "WORK_FILE_UPLOAD", payload)
}

// -------------------------------------------------------------
// MAIN ENTRYPOINT
// -------------------------------------------------------------

fn main() {
    let db = Database::new();
    let server = server::HostServerManager::new();
    let sync_watcher = network_sync::NetworkSyncWatcher::new();
    db.init()
        .expect("Error al inicializar la base de datos local SQLite");

    // Auto-arranque persistente de Servidor Host si fue previamente activado
    if let Ok(conn) = db.get_connection() {
        let should_autostart: bool = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'host_server_autostart'",
                [],
                |r| r.get::<_, String>(0),
            )
            .map(|v| v == "1")
            .unwrap_or(false);

        if should_autostart {
            let port: u16 = conn
                .query_row(
                    "SELECT value FROM app_settings WHERE key = 'host_server_port'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .map(|v| v.parse::<u16>().unwrap_or(8088))
                .unwrap_or(8088);

            eprintln!(
                "[main] Auto-iniciando Servidor Host guardado en puerto {}",
                port
            );
            let _ = server.start(Database::new(), port);
        }
    }

    // Iniciar observador de eventos de red en segundo plano
    let db_path = db.get_path();
    sync_watcher.start(db_path);

    // Si corre desde la red, asegurar que exista el acceso directo en el Escritorio
    let _ = network_sync::ensure_desktop_shortcut();

    // Garantizar que slotting_parameters.json resida dentro de data/
    let slotting_path = get_data_file_path("slotting_parameters.json");
    if !slotting_path.exists() {
        let _ = std::fs::write(&slotting_path, slotting::DEFAULT_SLOTTING_JSON);
        eprintln!("[main] Inicializado archivo: {}", slotting_path.display());
    }

    // Auto-seed storage_locations si está vacía (Fix: ocupación de bodega en .exe)
    if let Ok(conn) = db.get_connection() {
        slotting::seed_storage_locations_if_empty(&conn);
    }

    let sync_watcher_clone = sync_watcher.clone();

    tauri::Builder::default()
        .setup(move |app| {
            sync_watcher_clone.set_app_handle(app.handle());
            Ok(())
        })
        .manage(AppState {
            db,
            server,
            sync_watcher,
        })
        .invoke_handler(tauri::generate_handler![
            // Auth & Users
            login,
            register_user,
            get_all_users_admin,
            delete_user_admin,
            reset_user_password_admin,
            update_user_permissions_admin,
            approve_user_admin,
            get_available_aisles,
            get_auditor_zones,
            assign_auditor_zones,
            // Inventory & Master Items
            get_inventory_items,
            add_inventory_item,
            add_inventory_items_bulk,
            get_item_details,
            search_stock_items,
            search_stock_by_location,
            get_valid_bins,
            get_occupancy_stats,
            save_item_measurement,
            clear_all_database,
            // Inbound & Receiving
            get_inbound_logs,
            save_inbound_log,
            delete_inbound_log,
            archive_inbound_logs,
            sync_inbound_logs_network,
            get_inbound_versions,
            find_item_inbound,
            get_inbound_alerts,
            clear_inbound_alerts,
            resolve_inbound_alert,
            resolve_inbound_alerts_bulk,
            run_inbound_auditor,
            get_ir_reconciliations,
            save_ir_reconciliation,
            delete_ir_reconciliation,
            get_inbound_reconciliation,
            save_grn_reconciliation_snapshot,
            upsert_draft_comment,
            get_saved_grn_reconciliations,
            get_saved_grn_reconciliation_detail,
            delete_saved_grn_reconciliation,
            unarchive_inbound_logs_version,
            restore_inbound_rows_bulk,
            delete_inbound_rows_bulk,
            get_unique_grn_references,
            get_inbound_master_maps,
            save_po_lookup_json,
            save_grn_master_json,
            save_xdock_reservations_json,
            lookup_inbound_reference,
            get_inbound_ir_stats_data,
            get_inbound_expected_bulk,
            // Counts & Sessions
            get_active_count_session,
            start_count_session,
            close_count_session,
            get_session_locations,
            get_session_counts_by_location,
            close_location,
            reopen_location,
            get_item_for_counting,
            add_count_record,
            get_all_counts,
            delete_count_record,
            update_count_record,
            update_count_root_cause,
            get_count_stats,
            get_inventory_dashboard_stats,
            calculate_cycle_count_differences,
            get_active_recount_list,
            get_planner_cycle_count_differences,
            update_planner_cycle_count_diff,
            // Reconciliation & General Inventory
            get_reconciliation_data,
            get_reconciliation_stats,
            get_inventory_summary,
            get_inventory_settings,
            save_inventory_settings,
            start_w2w_stage_1,
            advance_inventory_stage,
            finalize_inventory,
            approve_w2w_item,
            archive_w2w_reconciliation,
            // Picking & Shipments
            get_picking_tracking,
            get_picking_order_details,
            save_picking_audit_full,
            get_picking_audits_full,
            get_picking_audit_by_id_full,
            update_picking_audit_full,
            delete_picking_audits,
            get_picking_packing_list,
            create_shipment,
            list_shipments,
            get_consolidated_packing_list,
            delete_shipment,
            import_picking_orders_bulk,
            // Spot Check & Express Audit
            get_spot_checks,
            find_item_spot_check,
            save_spot_check,
            clear_spot_checks,
            delete_spot_check,
            get_express_audits,
            find_item_express_audit,
            save_express_audit,
            clear_express_audits,
            // Slotting & Planner
            suggest_slotting_bin,
            get_slotting_summary,
            get_slotting_config,
            save_slotting_config,
            get_occupancy_report,
            get_occupancy_detail,
            get_planner_config,
            save_planner_config,
            get_planner_daily_items,
            get_items_with_differences_planner,
            update_planner_difference_cause,
            save_planner_execution,
            get_planner_stats,
            // Printer & Silent Printing
            get_system_printers,
            print_sandvik_label_silent,
            print_raw_zpl,
            test_print_label,
            // Sync Status
            get_sync_status,
            set_sync_status,
            // Host Server & Multi-User
            start_host_server,
            stop_host_server,
            get_host_server_info,
            get_distinct_operators,
            // Network Sync & Multi-Terminal Replicación
            get_network_environment,
            create_desktop_shortcut,
            publish_sync_event,
            save_and_replicate_work_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
