use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationRow {
    pub id: String,
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub system_qty: f64,
    pub cost: f64,
    pub c1: Option<f64>,
    pub c2: Option<f64>,
    pub c3: Option<f64>,
    pub c4: Option<f64>,
    pub final_counted: f64,
    pub diff_qty: f64,
    pub diff_val: f64,
    pub status: String,
    pub is_counted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralInventoryStats {
    pub total_items: i64,
    pub counted_items_count: usize,
    pub progress_percentage: f64,
    pub total_system_units: f64,
    pub total_counted_units: f64,
    pub total_system_value: f64,
    pub total_counted_value: f64,
    pub net_variance_value: f64,
    pub abs_variance_value: f64,
    pub accuracy_percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventorySummary {
    pub total_skus: usize,
    pub total_counted: usize,
    pub total_variance_cost: f64,
    pub current_stage: i32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventorySettings {
    pub stage: i32,
    pub auto_advance: bool,
    pub qty_tolerance: f64,
    pub val_tolerance: f64,
}

impl Default for InventorySettings {
    fn default() -> Self {
        Self {
            stage: 1,
            auto_advance: false,
            qty_tolerance: 0.05,
            val_tolerance: 50.0,
        }
    }
}

/// Obtiene la reconciliación completa consultando SQLite
pub fn get_reconciliation_from_db(
    conn: &Connection,
    qty_tolerance: Option<f64>,
    val_tolerance: Option<f64>,
) -> Result<Vec<ReconciliationRow>> {
    let mut stmt_items = conn.prepare(
        "SELECT item_code, description, bin_location, system_qty, unit_cost FROM inventory_items",
    )?;
    let master_items: Vec<(String, String, String, f64, f64)> = stmt_items
        .query_map([], |row| {
            let code: String = row.get(0)?;
            let desc: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let bin: String = row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string());
            let qty: f64 = row.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
            let cost: f64 = row.get::<_, Option<f64>>(4)?.unwrap_or(0.0);
            Ok((code, desc, bin, qty, cost))
        })?
        .flatten()
        .collect();

    let mut stmt_counts = conn.prepare("SELECT item_code, counted_qty, stage FROM counts")?;
    let count_records: Vec<(String, f64, i32)> = stmt_counts
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .flatten()
        .collect();

    let recount_statuses = HashMap::new();
    let q_tol = qty_tolerance.unwrap_or(0.05);
    let v_tol = val_tolerance.unwrap_or(50.0);

    Ok(calculate_reconciliation(master_items, count_records, recount_statuses, q_tol, v_tol))
}

/// Obtiene las estadísticas de inventario general desde SQLite
pub fn get_reconciliation_stats_from_db(conn: &Connection) -> Result<GeneralInventoryStats> {
    let mut stmt_items = conn.prepare("SELECT item_code, system_qty, unit_cost FROM inventory_items")?;
    let master_qty_cost: Vec<(String, f64, f64)> = stmt_items
        .query_map([], |row| {
            let code: String = row.get(0)?;
            let qty: f64 = row.get::<_, Option<f64>>(1)?.unwrap_or(0.0);
            let cost: f64 = row.get::<_, Option<f64>>(2)?.unwrap_or(0.0);
            Ok((code, qty, cost))
        })?
        .flatten()
        .collect();

    let mut stmt_counts = conn.prepare("SELECT item_code, counted_qty, stage FROM counts")?;
    let count_records: Vec<(String, f64, i32)> = stmt_counts
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .flatten()
        .collect();

    Ok(calculate_general_inventory_stats(master_qty_cost, count_records))
}

/// Obtiene el resumen para el panel de administración de inventario
pub fn get_inventory_summary_from_db(conn: &Connection) -> Result<InventorySummary> {
    let stats = get_reconciliation_stats_from_db(conn)?;
    let settings = get_inventory_settings_from_db(conn)?;

    Ok(InventorySummary {
        total_skus: stats.total_items as usize,
        total_counted: stats.counted_items_count,
        total_variance_cost: stats.abs_variance_value,
        current_stage: settings.stage,
        is_active: true,
    })
}

/// Obtiene la configuración de W2W / Inventario General
pub fn get_inventory_settings_from_db(conn: &Connection) -> Result<InventorySettings> {
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = 'w2w_settings'")?;
    let val_str: Option<String> = stmt.query_row([], |row| row.get(0)).ok();

    if let Some(s) = val_str {
        if let Ok(cfg) = serde_json::from_str::<InventorySettings>(&s) {
            return Ok(cfg);
        }
    }
    Ok(InventorySettings::default())
}

/// Guarda la configuración de W2W
pub fn save_inventory_settings_to_db(conn: &Connection, settings: &InventorySettings) -> Result<()> {
    let val_json = serde_json::to_string(settings).unwrap_or_default();
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('w2w_settings', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![val_json],
    )?;
    Ok(())
}

/// Inicia el ciclo de inventario en Etapa 1 (limpia conteos previos y listas de reconteo)
pub fn start_w2w_stage_1_db(conn: &Connection) -> Result<String> {
    conn.execute("DELETE FROM recount_list", [])?;
    conn.execute("DELETE FROM counts", [])?;
    conn.execute("DELETE FROM session_locations", [])?;
    conn.execute("DELETE FROM count_sessions", [])?;

    let mut settings = get_inventory_settings_from_db(conn)?;
    settings.stage = 1;
    save_inventory_settings_to_db(conn, &settings)?;

    Ok("Inventario reiniciado en Etapa 1. Todos los datos de conteo han sido reseteados.".to_string())
}

/// Avanza de etapa en el inventario general con cálculo de tolerancias y generación automática de reconteos
pub fn advance_inventory_stage_db(
    conn: &Connection,
    next_stage: i32,
    qty_tolerance: Option<f64>,
    val_tolerance: Option<f64>,
) -> Result<usize> {
    let mut settings = get_inventory_settings_from_db(conn)?;
    let q_tol = qty_tolerance.unwrap_or(settings.qty_tolerance);
    let v_tol = val_tolerance.unwrap_or(settings.val_tolerance);

    settings.stage = next_stage;
    settings.qty_tolerance = q_tol;
    settings.val_tolerance = v_tol;
    save_inventory_settings_to_db(conn, &settings)?;

    // Calcular reconciliación con conteos actuales
    let rows = get_reconciliation_from_db(conn, Some(q_tol), Some(v_tol))?;
    
    // Limpiar lista de reconteo anterior para esta etapa
    conn.execute("DELETE FROM recount_list WHERE stage_to_count = ?1", params![next_stage])?;

    let now_ts = chrono::Utc::now().to_rfc3339();
    let mut recount_count = 0;

    for row in rows {
        if row.status == "PENDING" || row.status == "PENDING_RECOUNT" || row.status == "DISCREPANCY" {
            conn.execute(
                "INSERT INTO recount_list (item_code, stage_to_count, status, created_at)
                 VALUES (?1, ?2, 'pending', ?3)",
                params![row.item_code, next_stage, now_ts],
            )?;
            recount_count += 1;
        }
    }

    Ok(recount_count)
}

/// Finaliza el inventario Wall-to-Wall
pub fn finalize_w2w_db(conn: &Connection) -> Result<String> {
    conn.execute("UPDATE count_sessions SET status = 'closed'", [])?;
    conn.execute("UPDATE session_locations SET is_open = 0", [])?;
    Ok("Inventario Wall-to-Wall finalizado exitosamente.".to_string())
}

/// Aprueba manualmente una discrepancia de un SKU
pub fn approve_w2w_item_db(conn: &Connection, item_code: &str) -> Result<String> {
    let code = item_code.trim().to_uppercase();
    conn.execute(
        "UPDATE recount_list SET status = 'approved' WHERE item_code = ?1",
        params![code],
    )?;
    Ok(format!("Ítem {} aprobado manualmente.", code))
}

/// Archiva la reconciliación actual como un histórico
pub fn archive_w2w_reconciliation_db(conn: &Connection, archive_name: Option<String>) -> Result<String> {
    let name = archive_name.unwrap_or_else(|| {
        chrono::Utc::now().format("W2W_%Y-%m-%d_%H%M%S").to_string()
    });
    let rows = get_reconciliation_from_db(conn, None, None)?;
    let json_val = serde_json::to_string(&rows).unwrap_or_default();
    let key = format!("w2w_archive_{}", name);

    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, json_val],
    )?;

    Ok(format!("Reconciliación archivada exitosamente como '{}'", name))
}

/// Algoritmo principal de cálculo de reconciliación
pub fn calculate_reconciliation(
    master_items: Vec<(String, String, String, f64, f64)>,
    count_records: Vec<(String, f64, i32)>,
    recount_statuses: HashMap<String, String>,
    qty_tolerance: f64,
    val_tolerance: f64,
) -> Vec<ReconciliationRow> {
    let mut counts_by_item: HashMap<String, HashMap<i32, f64>> = HashMap::new();
    for (item_code, counted_qty, stage) in count_records {
        let code = item_code.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        counts_by_item
            .entry(code)
            .or_insert_with(HashMap::new)
            .entry(stage)
            .and_modify(|q| *q += counted_qty)
            .or_insert(counted_qty);
    }

    let mut master_map: HashMap<String, (String, String, f64, f64)> = HashMap::new();
    for (item_code, description, bin_location, system_qty, unit_cost) in master_items {
        let code = item_code.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        master_map.insert(code, (description, bin_location, system_qty, unit_cost));
    }

    let mut all_keys: HashSet<String> = HashSet::new();
    for k in master_map.keys() {
        all_keys.insert(k.clone());
    }
    for k in counts_by_item.keys() {
        all_keys.insert(k.clone());
    }

    let mut rows: Vec<ReconciliationRow> = Vec::with_capacity(all_keys.len());

    for code in all_keys {
        let (desc, bin, sys_qty, cost) = master_map
            .get(&code)
            .cloned()
            .unwrap_or(("ITEM NO CATALOGADO".to_string(), "N/A".to_string(), 0.0, 0.0));

        let stage_counts = counts_by_item.get(&code);
        let c1 = stage_counts.and_then(|m| m.get(&1)).copied();
        let c2 = stage_counts.and_then(|m| m.get(&2)).copied();
        let c3 = stage_counts.and_then(|m| m.get(&3)).copied();
        let c4 = stage_counts.and_then(|m| m.get(&4)).copied();

        let mut final_counted: Option<f64> = None;
        if let Some(m) = stage_counts {
            for stg in [4, 3, 2, 1] {
                if let Some(&qty) = m.get(&stg) {
                    final_counted = Some(qty);
                    break;
                }
            }
        }

        let is_counted = final_counted.is_some();
        let final_counted_val = final_counted.unwrap_or(0.0);
        let diff_qty = final_counted_val - sys_qty;
        let abs_diff_qty = diff_qty.abs();
        let diff_val = diff_qty * cost;
        let abs_diff_val = diff_val.abs();

        let mut status = "OK".to_string();
        if !is_counted {
            status = "NOT_COUNTED".to_string();
        } else if abs_diff_qty > 0.0001 {
            if let Some(st) = recount_statuses.get(&code) {
                if st == "manually_approved" {
                    status = "APPROVED_MANUAL".to_string();
                } else {
                    status = "PENDING_RECOUNT".to_string();
                }
            } else {
                let exceeds_qty = if sys_qty > 0.0 {
                    (abs_diff_qty / sys_qty) > qty_tolerance
                } else {
                    false
                };
                let exceeds_val = abs_diff_val > val_tolerance;
                if exceeds_qty || exceeds_val {
                    status = "PENDING".to_string();
                } else {
                    status = "APPROVED_AUTO".to_string();
                }
            }
        }

        rows.push(ReconciliationRow {
            id: code.clone(),
            item_code: code,
            description: desc,
            bin_location: bin,
            system_qty: sys_qty,
            cost,
            c1,
            c2,
            c3,
            c4,
            final_counted: final_counted_val,
            diff_qty,
            diff_val,
            status,
            is_counted,
        });
    }

    let get_status_order = |s: &str| -> i32 {
        match s {
            "PENDING_RECOUNT" => 0,
            "PENDING" => 1,
            "NOT_COUNTED" => 2,
            "DISCREPANCY" => 3,
            "APPROVED_AUTO" => 4,
            "APPROVED_MANUAL" => 5,
            "OK" => 6,
            _ => 7,
        }
    };

    rows.sort_by(|a, b| {
        let order_a = get_status_order(&a.status);
        let order_b = get_status_order(&b.status);
        if order_a != order_b {
            order_a.cmp(&order_b)
        } else {
            b.diff_val.abs().partial_cmp(&a.diff_val.abs()).unwrap_or(std::cmp::Ordering::Equal)
        }
    });

    rows
}

/// Cálculo de estadísticas consolidadas de inventario
pub fn calculate_general_inventory_stats(
    master_qty_cost: Vec<(String, f64, f64)>,
    count_records: Vec<(String, f64, i32)>,
) -> GeneralInventoryStats {
    let mut total_system_units = 0.0;
    let mut total_system_value = 0.0;
    let mut master_cost_map: HashMap<String, f64> = HashMap::new();
    let mut master_qty_map: HashMap<String, f64> = HashMap::new();

    let total_items = master_qty_cost.len() as i64;

    for (item_code, qty, cost) in master_qty_cost {
        let code = item_code.trim().to_uppercase();
        total_system_units += qty;
        total_system_value += qty * cost;
        master_cost_map.insert(code.clone(), cost);
        master_qty_map.insert(code, qty);
    }

    let mut latest_counts: HashMap<String, (i32, f64)> = HashMap::new();
    for (item_code, qty, stage) in count_records {
        let code = item_code.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        latest_counts
            .entry(code)
            .and_modify(|(stg, q)| {
                if stage > *stg {
                    *stg = stage;
                    *q = qty;
                } else if stage == *stg {
                    *q += qty;
                }
            })
            .or_insert((stage, qty));
    }

    let counted_items_count = latest_counts.len();
    let progress_percentage = if total_items > 0 {
        (counted_items_count as f64 / total_items as f64) * 100.0
    } else {
        0.0
    };

    let mut total_counted_units = 0.0;
    let mut total_counted_value = 0.0;
    let mut net_variance_value = 0.0;
    let mut abs_variance_value = 0.0;

    let mut all_item_keys: HashSet<String> = HashSet::new();
    for k in master_cost_map.keys() {
        all_item_keys.insert(k.clone());
    }
    for k in latest_counts.keys() {
        all_item_keys.insert(k.clone());
    }

    for code in all_item_keys {
        let sys_qty = master_qty_map.get(&code).copied().unwrap_or(0.0);
        let cost = master_cost_map.get(&code).copied().unwrap_or(0.0);

        if let Some(&(_, cnt_qty)) = latest_counts.get(&code) {
            total_counted_units += cnt_qty;
            total_counted_value += cnt_qty * cost;

            let diff_qty = cnt_qty - sys_qty;
            let diff_val = diff_qty * cost;

            net_variance_value += diff_val;
            abs_variance_value += diff_val.abs();
        } else {
            let diff_val = -sys_qty * cost;
            net_variance_value += diff_val;
            abs_variance_value += diff_val.abs();
        }
    }

    let accuracy_percentage = if total_system_value > 0.0 {
        let raw_acc = (1.0 - (abs_variance_value / total_system_value)) * 100.0;
        raw_acc.max(0.0).min(100.0)
    } else {
        100.0
    };

    GeneralInventoryStats {
        total_items,
        counted_items_count,
        progress_percentage,
        total_system_units,
        total_counted_units,
        total_system_value,
        total_counted_value,
        net_variance_value,
        abs_variance_value,
        accuracy_percentage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_reconciliation() {
        let master_items = vec![
            ("SKU1".to_string(), "Desc 1".to_string(), "A-1".to_string(), 10.0, 100.0),
            ("SKU2".to_string(), "Desc 2".to_string(), "A-2".to_string(), 5.0, 50.0),
        ];
        let count_records = vec![
            ("SKU1".to_string(), 10.0, 1),
            ("SKU2".to_string(), 3.0, 1),
        ];

        let rows = calculate_reconciliation(master_items, count_records, HashMap::new(), 0.05, 50.0);
        assert_eq!(rows.len(), 2);

        let sku1 = rows.iter().find(|r| r.item_code == "SKU1").unwrap();
        assert_eq!(sku1.status, "OK");
        assert_eq!(sku1.diff_qty, 0.0);

        let sku2 = rows.iter().find(|r| r.item_code == "SKU2").unwrap();
        assert_eq!(sku2.diff_qty, -2.0);
        assert_eq!(sku2.diff_val, -100.0);
    }

    #[test]
    fn test_advance_stage_and_recount_generation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE inventory_items (
                item_code TEXT PRIMARY KEY,
                description TEXT,
                bin_location TEXT,
                system_qty REAL DEFAULT 0.0,
                unit_cost REAL DEFAULT 0.0
            );
            CREATE TABLE counts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                count_type TEXT,
                item_code TEXT,
                description TEXT,
                location TEXT,
                counted_qty REAL DEFAULT 0.0,
                stage INTEGER DEFAULT 1,
                user_id TEXT,
                status TEXT DEFAULT 'completed',
                unit_cost REAL DEFAULT 0.0,
                timestamp TEXT,
                notes TEXT
            );
            CREATE TABLE recount_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_code TEXT NOT NULL,
                description TEXT,
                location TEXT,
                stage_to_count INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                approved INTEGER DEFAULT 0,
                created_at TEXT
            );
            INSERT INTO app_settings (key, value) VALUES ('current_inventory_stage', '1');
            INSERT INTO inventory_items (item_code, system_qty, unit_cost) VALUES ('ITEM_A', 10.0, 100.0);
            INSERT INTO inventory_items (item_code, system_qty, unit_cost) VALUES ('ITEM_B', 20.0, 10.0);
            INSERT INTO counts (item_code, counted_qty, stage) VALUES ('ITEM_A', 7.0, 1);
            INSERT INTO counts (item_code, counted_qty, stage) VALUES ('ITEM_B', 20.0, 1);
        ").unwrap();

        // Avance a Etapa 2 con tolerancia
        let recounts = advance_inventory_stage_db(&conn, 2, Some(0.05), Some(50.0)).unwrap();
        assert_eq!(recounts, 1); // ITEM_A tiene diferencia de 3 unidades ($300 > $50), ITEM_B tiene 0

        // Verificar que ITEM_A está en recount_list
        let recount_item: String = conn.query_row(
            "SELECT item_code FROM recount_list WHERE stage_to_count = 2",
            [],
            |r| r.get(0)
        ).unwrap();
        assert_eq!(recount_item, "ITEM_A");

        // Probar aprobación de ítem
        let approve_msg = approve_w2w_item_db(&conn, "ITEM_A").unwrap();
        assert!(approve_msg.contains("aprobado"));
    }
}
