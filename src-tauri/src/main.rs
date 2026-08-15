// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod slotting;
mod counts;
mod general_inventory;
mod master_maps;

use db::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
fn get_inbound_master_maps(
    state: State<'_, AppState>,
) -> Result<Vec<master_maps::MasterMapEntry>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    // Cargar GRNs guardados en SQLite
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

    let grn_path = "./data/grn_master_data.json";
    let po_path = "./data/po_lookup.json";

    let maps = master_maps::build_master_maps_rust(db_grns, grn_path, po_path);
    Ok(maps)
}

pub struct AppState {
    pub db: Database,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InventoryItem {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub system_qty: f64,
    pub unit_cost: f64,
    pub weight_per_unit: f64,
    pub sic_code: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CountRecord {
    pub id: Option<i64>,
    pub count_type: String,
    pub item_code: String,
    pub location: String,
    pub counted_qty: f64,
    pub stage: i32,
    pub user_id: String,
    pub status: String,
    pub timestamp: Option<String>,
}

// --- COMANDOS TAURI (IPC) ---

#[tauri::command]
fn login(state: State<'_, AppState>, username: String, password_hash: String) -> Result<User, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, username, role FROM users WHERE username = ?1 AND password_hash = ?2")
        .map_err(|e| e.to_string())?;
    
    let user = stmt
        .query_row(params![username, password_hash], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                role: row.get(2)?,
            })
        })
        .map_err(|_| "Usuario o contraseña incorrectos".to_string())?;

    Ok(user)
}

#[tauri::command]
fn get_inventory_items(state: State<'_, AppState>) -> Result<Vec<InventoryItem>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT item_code, description, bin_location, system_qty, unit_cost, weight_per_unit, sic_code FROM inventory_items")
        .map_err(|e| e.to_string())?;

    let item_iter = stmt
        .query_map([], |row| {
            Ok(InventoryItem {
                item_code: row.get(0)?,
                description: row.get(1)?,
                bin_location: row.get(2)?,
                system_qty: row.get(3)?,
                unit_cost: row.get(4)?,
                weight_per_unit: row.get(5)?,
                sic_code: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for item in item_iter {
        if let Ok(i) = item {
            items.push(i);
        }
    }
    Ok(items)
}

#[tauri::command]
fn add_inventory_item(state: State<'_, AppState>, item: InventoryItem) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO inventory_items (item_code, description, bin_location, system_qty, unit_cost, weight_per_unit, sic_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(item_code) DO UPDATE SET
            description = excluded.description,
            bin_location = excluded.bin_location,
            system_qty = excluded.system_qty,
            unit_cost = excluded.unit_cost,
            weight_per_unit = excluded.weight_per_unit,
            sic_code = excluded.sic_code;",
        params![
            item.item_code,
            item.description,
            item.bin_location,
            item.system_qty,
            item.unit_cost,
            item.weight_per_unit,
            item.sic_code,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok("Item guardado correctamente".to_string())
}

#[tauri::command]
fn add_inventory_items_bulk(state: State<'_, AppState>, items: Vec<InventoryItem>) -> Result<String, String> {
    let mut conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO inventory_items (item_code, description, bin_location, system_qty, unit_cost, weight_per_unit, sic_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(item_code) DO UPDATE SET
                    description = excluded.description,
                    bin_location = excluded.bin_location,
                    system_qty = excluded.system_qty,
                    unit_cost = excluded.unit_cost,
                    weight_per_unit = excluded.weight_per_unit,
                    sic_code = excluded.sic_code;",
            )
            .map_err(|e| e.to_string())?;

        for item in &items {
            stmt.execute(params![
                item.item_code,
                item.description,
                item.bin_location,
                item.system_qty,
                item.unit_cost,
                item.weight_per_unit,
                item.sic_code,
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(format!("Se guardaron {} ítems exitosamente", items.len()))
}

#[tauri::command]
fn add_count_record(state: State<'_, AppState>, record: CountRecord) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO counts (count_type, item_code, location, counted_qty, stage, user_id, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        params![
            record.count_type,
            record.item_code,
            record.location,
            record.counted_qty,
            record.stage,
            record.user_id,
            record.status,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok("Conteo registrado correctamente".to_string())
}

#[tauri::command]
fn get_count_records(state: State<'_, AppState>, count_type: Option<String>) -> Result<Vec<CountRecord>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let sql = if let Some(ct) = count_type {
        format!("SELECT id, count_type, item_code, location, counted_qty, stage, user_id, status, timestamp FROM counts WHERE count_type = '{}'", ct)
    } else {
        "SELECT id, count_type, item_code, location, counted_qty, stage, user_id, status, timestamp FROM counts".to_string()
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let count_iter = stmt
        .query_map([], |row| {
            Ok(CountRecord {
                id: Some(row.get(0)?),
                count_type: row.get(1)?,
                item_code: row.get(2)?,
                location: row.get(3)?,
                counted_qty: row.get(4)?,
                stage: row.get(5)?,
                user_id: row.get(6)?,
                status: row.get(7)?,
                timestamp: Some(row.get(8)?),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    for r in count_iter {
        if let Ok(rec) = r {
            records.push(rec);
        }
    }
    Ok(records)
}

#[tauri::command]
fn suggest_slotting_bin(
    state: State<'_, AppState>,
    item_code: String,
) -> Result<Option<String>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    // Obtener info del item
    let mut stmt = conn
        .prepare("SELECT item_code, description, bin_location, weight_per_unit, sic_code FROM inventory_items WHERE item_code = ?1")
        .map_err(|e| e.to_string())?;
    
    let item_res = stmt.query_row(params![item_code], |row| {
        let code: String = row.get(0)?;
        let desc: String = row.get(1)?;
        let bin: String = row.get(2)?;
        let weight: f64 = row.get(3)?;
        let sic: String = row.get(4)?;
        Ok((code, desc, bin, weight, sic))
    });

    if let Ok((code, desc, bin, weight, sic)) = item_res {
        let storage = HashMap::new();
        let turnover = HashMap::new();
        let zone_rules = slotting::ZoneRules::default();
        let mix_limits = slotting::MixLimits::default();
        let occupancy = HashMap::new();

        let item_details = slotting::ItemDetails {
            bin_1: bin,
            item_code: code,
            item_description: desc,
            weight_per_unit: weight.to_string(),
        };

        let result = slotting::get_suggested_bin_rust(
            &storage,
            &turnover,
            &zone_rules,
            &mix_limits,
            &item_details,
            &occupancy,
            &sic,
        );

        Ok(result)
    } else {
        Ok(None)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ItemDetails {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub additional_bins: String,
    pub weight_kg: f64,
}

#[tauri::command]
fn get_item_details(state: State<'_, AppState>, item_code: String) -> Result<ItemDetails, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let code_clean = item_code.trim().to_uppercase();

    let mut stmt = conn
        .prepare("SELECT item_code, description, bin_location, weight_per_unit FROM inventory_items WHERE UPPER(item_code) = ?1")
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(params![code_clean], |row| {
        Ok(ItemDetails {
            item_code: row.get(0)?,
            description: row.get(1)?,
            bin_location: row.get(2)?,
            additional_bins: "".to_string(),
            weight_kg: row.get(3)?,
        })
    });

    match result {
        Ok(details) => Ok(details),
        Err(_) => Err(format!("Item '{}' no encontrado en el inventario local", code_clean)),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InboundLookup {
    pub waybill: String,
    pub import_ref: String,
}

#[tauri::command]
fn lookup_inbound_reference(
    state: State<'_, AppState>,
    waybill: Option<String>,
    import_ref: Option<String>,
) -> Result<InboundLookup, String> {
    let wb = waybill.unwrap_or_default().trim().to_uppercase();
    let ir = import_ref.unwrap_or_default().trim().to_uppercase();

    // Consulta en base de datos local SQLite o fallback local
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    
    if !wb.is_empty() {
        let stmt = conn.prepare("SELECT DISTINCT po_number FROM inbound_records WHERE UPPER(po_number) = ?1").ok();
        if let Some(mut s) = stmt {
            if let Ok(found_ir) = s.query_row(params![wb], |row| row.get::<_, String>(0)) {
                return Ok(InboundLookup { waybill: wb, import_ref: found_ir });
            }
        }
    }

    Ok(InboundLookup { waybill: wb, import_ref: ir })
}

#[tauri::command]
fn get_reconciliation_data(
    state: State<'_, AppState>,
    qty_tolerance: Option<f64>,
    val_tolerance: Option<f64>,
) -> Result<Vec<general_inventory::ReconciliationRow>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    // 1. Cargar items del maestro desde SQLite
    let mut stmt_items = conn
        .prepare("SELECT item_code, description, bin_location, system_qty, unit_cost FROM inventory_items")
        .map_err(|e| e.to_string())?;
    let master_items: Vec<(String, String, String, f64, f64)> = stmt_items
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // 2. Cargar conteos desde SQLite
    let mut stmt_counts = conn
        .prepare("SELECT item_code, counted_qty, stage FROM counts")
        .map_err(|e| e.to_string())?;
    let count_records: Vec<(String, f64, i32)> = stmt_counts
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let recount_statuses = HashMap::new();
    let q_tol = qty_tolerance.unwrap_or(0.05);
    let v_tol = val_tolerance.unwrap_or(50.0);

    let rows = general_inventory::calculate_reconciliation(
        master_items,
        count_records,
        recount_statuses,
        q_tol,
        v_tol,
    );

    Ok(rows)
}

#[tauri::command]
fn get_reconciliation_stats(
    state: State<'_, AppState>,
) -> Result<general_inventory::GeneralInventoryStats, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    let mut stmt_items = conn
        .prepare("SELECT item_code, system_qty, unit_cost FROM inventory_items")
        .map_err(|e| e.to_string())?;
    let master_qty_cost: Vec<(String, f64, f64)> = stmt_items
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut stmt_counts = conn
        .prepare("SELECT item_code, counted_qty, stage FROM counts")
        .map_err(|e| e.to_string())?;
    let count_records: Vec<(String, f64, i32)> = stmt_counts
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let stats = general_inventory::calculate_general_inventory_stats(master_qty_cost, count_records);
    Ok(stats)
}

#[tauri::command]
fn calculate_cycle_count_differences(
    state: State<'_, AppState>,
) -> Result<Vec<counts::CycleCountResult>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;

    let mut stmt_stock = conn
        .prepare("SELECT item_code, bin_location, system_qty, unit_cost FROM inventory_items")
        .map_err(|e| e.to_string())?;
    let system_stock: Vec<(String, String, f64, f64)> = stmt_stock
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut stmt_counts = conn
        .prepare("SELECT item_code, location, counted_qty, stage FROM counts")
        .map_err(|e| e.to_string())?;
    let physical_counts: Vec<(String, String, f64, i32)> = stmt_counts
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let results = counts::calculate_cycle_count_differences(system_stock, physical_counts);
    Ok(results)
}

#[tauri::command]
fn register_user(state: State<'_, AppState>, username: String, password_hash: String) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?1, ?2, 'operator');",
        params![username.trim(), password_hash.trim()],
    )
    .map_err(|_| "El nombre de usuario ya existe".to_string())?;

    Ok("Usuario registrado exitosamente".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserAdminView {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub is_approved: bool,
    pub permissions: String,
}

#[tauri::command]
fn get_all_users_admin(state: State<'_, AppState>) -> Result<Vec<UserAdminView>, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, username, role FROM users")
        .map_err(|e| e.to_string())?;

    let user_iter = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let username: String = row.get(1)?;
            let role: String = row.get(2)?;
            Ok(UserAdminView {
                id,
                username: username.clone(),
                role: role.clone(),
                is_approved: true,
                permissions: "stock,inbound,picking,inventory,planner,counts,admin".to_string(),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut users = Vec::new();
    for u in user_iter {
        if let Ok(usr) = u {
            users.push(usr);
        }
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
fn reset_user_password_admin(state: State<'_, AppState>, user_id: i64, new_password: String) -> Result<String, String> {
    let conn = state.db.get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![new_password.trim(), user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Contraseña actualizada".to_string())
}

fn main() {
    let db = Database::new();
    db.init().expect("Error al inicializar la base de datos local SQLite");

    tauri::Builder::default()
        .manage(AppState { db })
        .invoke_handler(tauri::generate_handler![
            login,
            register_user,
            get_inventory_items,
            add_inventory_item,
            add_inventory_items_bulk,
            add_count_record,
            get_count_records,
            suggest_slotting_bin,
            get_item_details,
            lookup_inbound_reference,
            get_reconciliation_data,
            get_reconciliation_stats,
            get_inbound_master_maps,
            calculate_cycle_count_differences,
            get_all_users_admin,
            delete_user_admin,
            reset_user_password_admin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
