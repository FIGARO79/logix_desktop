use chrono::Local;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountSession {
    pub id: i64,
    pub session_id: i64,
    pub name: String,
    pub user_username: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub status: String,
    pub inventory_stage: i32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountRecord {
    pub id: Option<i64>,
    pub session_id: Option<i64>,
    pub count_type: String,
    pub item_code: String,
    pub description: Option<String>,
    pub location: String,
    pub counted_qty: f64,
    pub stage: i32,
    pub user_id: String,
    pub status: String,
    pub unit_cost: Option<f64>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemCountingDetails {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub system_qty: f64,
    pub unit_cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountStats {
    pub total_counts: usize,
    pub total_units: f64,
    pub accuracy_rate: f64,
    pub locations_counted: usize,
    pub discrepancies: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecountItem {
    pub id: i64,
    pub item_code: String,
    pub stage_to_count: i32,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleCountResult {
    pub item_code: String,
    pub location: String,
    pub system_qty: f64,
    pub counted_qty: f64,
    pub diff_qty: f64,
    pub unit_cost: f64,
    pub diff_val: f64,
    pub status: String,
    pub stage_used: i32,
}

/// Obtiene la sesión activa de conteo
pub fn get_active_session(conn: &Connection) -> Result<CountSession> {
    let mut stmt = conn.prepare(
        "SELECT id, name, user_username, start_time, end_time, status, inventory_stage
         FROM count_sessions
         WHERE status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1",
    )?;

    let session = stmt.query_row([], |row| {
        let id: i64 = row.get(0)?;
        Ok(CountSession {
            id,
            session_id: id,
            name: row.get(1)?,
            user_username: row.get(2)?,
            start_time: row.get(3)?,
            end_time: row.get(4)?,
            status: row.get(5)?,
            inventory_stage: row.get(6)?,
            is_active: true,
        })
    }).unwrap_or_else(|_| {
        CountSession {
            id: 1,
            session_id: 1,
            name: "Sesión Principal Local".to_string(),
            user_username: "admin".to_string(),
            start_time: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            end_time: None,
            status: "in_progress".to_string(),
            inventory_stage: 1,
            is_active: true,
        }
    });

    Ok(session)
}

/// Inicia una nueva sesión de conteo
pub fn start_session(conn: &Connection, name: &str, username: &str) -> Result<CountSession> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO count_sessions (name, user_username, start_time, status, inventory_stage)
         VALUES (?1, ?2, ?3, 'in_progress', 1)",
        params![name, username, now],
    )?;

    let id = conn.last_insert_rowid();
    Ok(CountSession {
        id,
        session_id: id,
        name: name.to_string(),
        user_username: username.to_string(),
        start_time: now,
        end_time: None,
        status: "in_progress".to_string(),
        inventory_stage: 1,
        is_active: true,
    })
}

/// Cierra una sesión de conteo
pub fn close_session(conn: &Connection, session_id: i64) -> Result<()> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE count_sessions SET status = 'closed', end_time = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    Ok(())
}

/// Obtiene las ubicaciones contadas o abiertas en la sesión
pub fn get_session_locations(conn: &Connection, session_id: i64) -> Result<Vec<String>> {
    let mut locs = HashSet::new();

    if let Ok(mut stmt) = conn.prepare("SELECT location_code FROM session_locations WHERE session_id = ?1") {
        if let Ok(iter) = stmt.query_map(params![session_id], |row| row.get::<_, String>(0)) {
            for l in iter.flatten() {
                locs.insert(l.trim().to_uppercase());
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT location FROM counts WHERE session_id = ?1") {
        if let Ok(iter) = stmt.query_map(params![session_id], |row| row.get::<_, String>(0)) {
            for l in iter.flatten() {
                locs.insert(l.trim().to_uppercase());
            }
        }
    }

    let mut result: Vec<String> = locs.into_iter().filter(|s| !s.is_empty()).collect();
    result.sort();
    Ok(result)
}

/// Obtiene conteos de una ubicación específica en la sesión
pub fn get_session_counts_by_location(conn: &Connection, session_id: i64, location: &str) -> Result<Vec<CountRecord>> {
    let loc_upper = location.trim().to_uppercase();
    let mut stmt = conn.prepare(
        "SELECT id, session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp
         FROM counts
         WHERE session_id = ?1 AND UPPER(location) = ?2
         ORDER BY id DESC",
    )?;

    let iter = stmt.query_map(params![session_id, loc_upper], |row| {
        Ok(CountRecord {
            id: Some(row.get(0)?),
            session_id: Some(row.get(1)?),
            count_type: row.get(2)?,
            item_code: row.get(3)?,
            description: row.get(4)?,
            location: row.get(5)?,
            counted_qty: row.get(6)?,
            stage: row.get(7)?,
            user_id: row.get(8)?,
            status: row.get(9)?,
            unit_cost: row.get(10)?,
            timestamp: row.get(11)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Cierra una ubicación en la sesión
pub fn close_location(conn: &Connection, session_id: i64, location: &str) -> Result<()> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO session_locations (session_id, location_code, status, closed_at)
         VALUES (?1, ?2, 'closed', ?3)",
        params![session_id, location.trim().to_uppercase(), now],
    )?;
    Ok(())
}

/// Reabre una ubicación en la sesión
pub fn reopen_location(conn: &Connection, session_id: i64, location: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM session_locations WHERE session_id = ?1 AND UPPER(location_code) = ?2",
        params![session_id, location.trim().to_uppercase()],
    )?;
    Ok(())
}

/// Obtiene los detalles de un ítem para la interfaz de conteo
pub fn get_item_for_counting(conn: &Connection, code: &str) -> Result<ItemCountingDetails> {
    let clean_code = code.trim().to_uppercase();
    let mut stmt = conn.prepare(
        "SELECT item_code, description, bin_location, system_qty, unit_cost 
         FROM inventory_items 
         WHERE UPPER(item_code) = ?1",
    )?;

    let mut item_res = stmt.query_row(params![clean_code], |row| {
        Ok(ItemCountingDetails {
            item_code: row.get(0)?,
            description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            bin_location: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
            system_qty: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            unit_cost: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
        })
    }).ok();

    // Fallback flexible para ítems con puntos, guiones o prefijos (ej. .>RU18278, BG-0086)
    if item_res.is_none() {
        let alpha_code: String = clean_code.chars().filter(|c| c.is_alphanumeric()).collect();
        if !alpha_code.is_empty() {
            let mut stmt_all = conn.prepare("SELECT item_code, description, bin_location, system_qty, unit_cost FROM inventory_items")?;
            let iter = stmt_all.query_map([], |row| {
                Ok(ItemCountingDetails {
                    item_code: row.get(0)?,
                    description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    bin_location: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
                    system_qty: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    unit_cost: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                })
            })?;
            for it in iter {
                if let Ok(cand) = it {
                    let cand_alpha: String = cand.item_code.chars().filter(|c| c.is_alphanumeric()).collect();
                    if cand_alpha.to_uppercase() == alpha_code {
                        item_res = Some(cand);
                        break;
                    }
                }
            }
        }
    }

    let res = item_res.unwrap_or_else(|| ItemCountingDetails {
        item_code: clean_code,
        description: "Ítem no registrado en maestro".to_string(),
        bin_location: "N/A".to_string(),
        system_qty: 0.0,
        unit_cost: 0.0,
    });

    Ok(res)
}

/// Registra un conteo físico en SQLite
pub fn add_count(conn: &Connection, mut record: CountRecord) -> Result<CountRecord> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    if record.timestamp.is_none() || record.timestamp.as_ref().unwrap().trim().is_empty() {
        record.timestamp = Some(now);
    }

    let code_upper = record.item_code.trim().to_uppercase();
    record.item_code = code_upper.clone();

    // Completar descripción y costo si faltan
    if record.description.is_none() || record.unit_cost.is_none() {
        if let Ok(info) = get_item_for_counting(conn, &code_upper) {
            if record.description.is_none() || record.description.as_ref().unwrap().is_empty() {
                record.description = Some(info.description);
            }
            if record.unit_cost.is_none() {
                record.unit_cost = Some(info.unit_cost);
            }
        }
    }

    conn.execute(
        "INSERT INTO counts (session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            record.session_id.unwrap_or(1),
            record.count_type,
            record.item_code,
            record.description,
            record.location.trim().to_uppercase(),
            record.counted_qty,
            record.stage,
            record.user_id,
            record.status,
            record.unit_cost.unwrap_or(0.0),
            record.timestamp,
        ],
    )?;

    record.id = Some(conn.last_insert_rowid());
    Ok(record)
}

/// Obtiene todos los conteos registrados
pub fn get_all_counts(conn: &Connection, count_type: Option<String>) -> Result<Vec<CountRecord>> {
    let sql = if let Some(ct) = count_type {
        format!(
            "SELECT id, session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp
             FROM counts WHERE count_type = '{}' ORDER BY id DESC", ct
        )
    } else {
        "SELECT id, session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp
         FROM counts ORDER BY id DESC".to_string()
    };

    let mut stmt = conn.prepare(&sql)?;
    let iter = stmt.query_map([], |row| {
        Ok(CountRecord {
            id: Some(row.get(0)?),
            session_id: Some(row.get(1)?),
            count_type: row.get(2)?,
            item_code: row.get(3)?,
            description: row.get(4)?,
            location: row.get(5)?,
            counted_qty: row.get(6)?,
            stage: row.get(7)?,
            user_id: row.get(8)?,
            status: row.get(9)?,
            unit_cost: row.get(10)?,
            timestamp: row.get(11)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Elimina un conteo
pub fn delete_count(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM counts WHERE id = ?1", params![id])?;
    Ok(())
}

/// Actualiza un conteo existente
pub fn update_count(conn: &Connection, id: i64, record: CountRecord) -> Result<()> {
    conn.execute(
        "UPDATE counts SET
            item_code = ?1,
            description = ?2,
            location = ?3,
            counted_qty = ?4,
            stage = ?5,
            user_id = ?6,
            status = ?7,
            unit_cost = ?8
         WHERE id = ?9",
        params![
            record.item_code.trim().to_uppercase(),
            record.description,
            record.location.trim().to_uppercase(),
            record.counted_qty,
            record.stage,
            record.user_id,
            record.status,
            record.unit_cost.unwrap_or(0.0),
            id,
        ],
    )?;
    Ok(())
}

/// Estadísticas de conteo
pub fn get_count_stats(conn: &Connection) -> Result<CountStats> {
    let all_counts = get_all_counts(conn, None)?;
    let total_counts = all_counts.len();
    let total_units: f64 = all_counts.iter().map(|c| c.counted_qty).sum();
    let locations_counted = all_counts.iter().map(|c| c.location.clone()).collect::<HashSet<String>>().len();

    let diffs = get_cycle_count_differences_db(conn)?;
    let discrepancies = diffs.iter().filter(|d| d.status != "OK").count();
    let accuracy_rate = if diffs.is_empty() {
        100.0
    } else {
        let ok_count = diffs.len() - discrepancies;
        (ok_count as f64 / diffs.len() as f64) * 100.0
    };

    Ok(CountStats {
        total_counts,
        total_units,
        accuracy_rate,
        locations_counted,
        discrepancies,
    })
}

/// Obtiene la lista activa de reconteo (Recount List)
pub fn get_active_recount_list(conn: &Connection) -> Result<Vec<RecountItem>> {
    let mut stmt = conn.prepare("SELECT id, item_code, stage_to_count, status, created_at FROM recount_list WHERE status = 'pending'")?;
    let iter = stmt.query_map([], |row| {
        Ok(RecountItem {
            id: row.get(0)?,
            item_code: row.get(1)?,
            stage_to_count: row.get(2)?,
            status: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Calcula discrepancias de conteo cíclico consultando la base de datos local
pub fn get_cycle_count_differences_db(conn: &Connection) -> Result<Vec<CycleCountResult>> {
    let mut stmt_stock = conn.prepare("SELECT item_code, bin_location, system_qty, unit_cost FROM inventory_items")?;
    let system_stock: Vec<(String, String, f64, f64)> = stmt_stock
        .query_map([], |row| {
            let code: String = row.get(0)?;
            let bin: String = row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "N/A".to_string());
            let qty: f64 = row.get::<_, Option<f64>>(2)?.unwrap_or(0.0);
            let cost: f64 = row.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
            Ok((code, bin, qty, cost))
        })?
        .flatten()
        .collect();

    let mut stmt_counts = conn.prepare("SELECT item_code, location, counted_qty, stage FROM counts")?;
    let physical_counts: Vec<(String, String, f64, i32)> = stmt_counts
        .query_map([], |row| {
            let code: String = row.get(0)?;
            let loc: String = row.get(1)?;
            let qty: f64 = row.get(2)?;
            let stage: i32 = row.get(3)?;
            Ok((code, loc, qty, stage))
        })?
        .flatten()
        .collect();

    Ok(calculate_cycle_count_differences(system_stock, physical_counts))
}

pub fn calculate_cycle_count_differences(
    system_stock: Vec<(String, String, f64, f64)>,
    physical_counts: Vec<(String, String, f64, i32)>,
) -> Vec<CycleCountResult> {
    let mut counts_by_key_stage: HashMap<(String, String), HashMap<i32, f64>> = HashMap::new();

    for (item, loc, qty, stage) in physical_counts {
        let item_clean = item.trim().to_uppercase();
        let loc_clean = loc.trim().to_uppercase();
        if item_clean.is_empty() {
            continue;
        }
        let key = (item_clean, loc_clean);
        counts_by_key_stage
            .entry(key)
            .or_insert_with(HashMap::new)
            .entry(stage)
            .and_modify(|q| *q += qty)
            .or_insert(qty);
    }

    let mut physical_map: HashMap<(String, String), (f64, i32)> = HashMap::new();
    for (key, stage_map) in counts_by_key_stage {
        let mut final_qty = 0.0;
        let mut selected_stage = 1;
        for stg in [4, 3, 2, 1] {
            if let Some(&q) = stage_map.get(&stg) {
                final_qty = q;
                selected_stage = stg;
                break;
            }
        }
        physical_map.insert(key, (final_qty, selected_stage));
    }

    let mut system_map: HashMap<(String, String), (f64, f64)> = HashMap::new();
    for (item, loc, sys_qty, cost) in system_stock {
        let item_clean = item.trim().to_uppercase();
        let loc_clean = loc.trim().to_uppercase();
        if item_clean.is_empty() {
            continue;
        }
        system_map.insert((item_clean, loc_clean), (sys_qty, cost));
    }

    let mut all_keys: HashSet<(String, String)> = HashSet::new();
    for k in system_map.keys() {
        all_keys.insert(k.clone());
    }
    for k in physical_map.keys() {
        all_keys.insert(k.clone());
    }

    let mut results = Vec::new();

    for (item, loc) in all_keys {
        let (sys_qty, unit_cost) = system_map.get(&(item.clone(), loc.clone())).copied().unwrap_or((0.0, 0.0));
        let (cnt_qty, stage_used) = physical_map.get(&(item.clone(), loc.clone())).copied().unwrap_or((0.0, 1));
        let diff_qty = cnt_qty - sys_qty;
        let diff_val = diff_qty * unit_cost;

        let status = if diff_qty.abs() <= 0.0001 {
            "OK"
        } else if diff_qty > 0.0 {
            "SOBRANTE"
        } else {
            "FALTANTE"
        };

        results.push(CycleCountResult {
            item_code: item,
            location: loc,
            system_qty: sys_qty,
            counted_qty: cnt_qty,
            diff_qty,
            unit_cost,
            diff_val,
            status: status.to_string(),
            stage_used,
        });
    }

    results
}

/// Actualiza la causa raíz de una discrepancia
pub fn update_count_root_cause_db(conn: &Connection, count_id: i64, root_cause: String) -> Result<()> {
    conn.execute(
        "UPDATE counts SET notes = ?1 WHERE id = ?2",
        params![root_cause, count_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_cycle_count_differences() {
        let system_stock = vec![
            ("ITEM01".to_string(), "A-01".to_string(), 10.0, 5.0),
            ("ITEM02".to_string(), "B-02".to_string(), 20.0, 10.0),
        ];

        let physical_counts = vec![
            ("ITEM01".to_string(), "A-01".to_string(), 12.0, 1),
            ("ITEM02".to_string(), "B-02".to_string(), 15.0, 1),
        ];

        let results = calculate_cycle_count_differences(system_stock, physical_counts);
        assert_eq!(results.len(), 2);

        let item1 = results.iter().find(|r| r.item_code == "ITEM01").unwrap();
        assert_eq!(item1.diff_qty, 2.0);
        assert_eq!(item1.status, "SOBRANTE");

        let item2 = results.iter().find(|r| r.item_code == "ITEM02").unwrap();
        assert_eq!(item2.diff_qty, -5.0);
        assert_eq!(item2.status, "FALTANTE");
    }

    #[test]
    fn test_count_session_and_location_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE count_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                status TEXT NOT NULL,
                inventory_stage INTEGER DEFAULT 1,
                user_username TEXT NOT NULL
            );
            CREATE TABLE session_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                location_code TEXT NOT NULL,
                status TEXT NOT NULL,
                closed_at TEXT
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
            INSERT INTO app_settings (key, value) VALUES ('current_inventory_stage', '1');
        ").unwrap();

        // Iniciar sesión
        let session = start_session(&conn, "Sesión Pasillo A", "auditor1").unwrap();
        assert_eq!(session.status, "in_progress");

        // Cerrar y reabrir ubicación
        close_location(&conn, session.id, "LOC-A-01").unwrap();
        let closed_locs = get_session_locations(&conn, session.id).unwrap();
        assert_eq!(closed_locs.len(), 1);
        assert_eq!(closed_locs[0], "LOC-A-01");

        reopen_location(&conn, session.id, "LOC-A-01").unwrap();
        let reloaded_locs = get_session_locations(&conn, session.id).unwrap();
        assert_eq!(reloaded_locs.len(), 0);

        // Añadir conteo
        let record = CountRecord {
            id: None,
            session_id: Some(session.id),
            count_type: "cycle_count".to_string(),
            item_code: "SKU100".to_string(),
            description: Some("Test SKU".to_string()),
            location: "LOC-A-01".to_string(),
            counted_qty: 15.0,
            stage: 1,
            user_id: "auditor1".to_string(),
            status: "completed".to_string(),
            unit_cost: Some(20.0),
            timestamp: None,
        };
        let added = add_count(&conn, record).unwrap();
        assert!(added.id.is_some());

        // Actualizar causa raíz
        update_count_root_cause_db(&conn, added.id.unwrap(), "Discrepancia en empaque".to_string()).unwrap();
        let note: String = conn.query_row("SELECT notes FROM counts WHERE id = ?1", params![added.id.unwrap()], |r| r.get(0)).unwrap();
        assert_eq!(note, "Discrepancia en empaque");

        // Cerrar sesión
        close_session(&conn, session.id).unwrap();
        let closed_status: String = conn.query_row("SELECT status FROM count_sessions WHERE id = ?1", params![session.id], |r| r.get(0)).unwrap();
        assert_eq!(closed_status, "closed");
    }
}
