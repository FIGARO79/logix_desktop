use chrono::Local;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerConfig {
    pub cycle_type: String,
    pub days_per_cycle: i32,
    pub a_frequency_days: i32,
    pub b_frequency_days: i32,
    pub c_frequency_days: i32,
}

impl Default for PlannerConfig {
    fn default() -> Self {
        Self {
            cycle_type: "ABC".to_string(),
            days_per_cycle: 30,
            a_frequency_days: 7,
            b_frequency_days: 15,
            c_frequency_days: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerDailyItem {
    pub id: String,
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub system_qty: f64,
    pub status: String,
    pub abc_category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerStats {
    pub total_items_planned: usize,
    pub completed_today: usize,
    pub remaining_today: usize,
    pub progress_percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerExecutionRecord {
    pub id: Option<i64>,
    pub plan_date: String,
    pub item_code: String,
    pub description: Option<String>,
    pub bin_location: Option<String>,
    pub status: String,
    pub user_id: Option<String>,
    pub timestamp: String,
}

/// Obtiene la configuración del planificador de conteos
pub fn get_planner_config_from_db(conn: &Connection) -> Result<PlannerConfig> {
    let mut stmt = conn.prepare("SELECT value FROM planner_config WHERE key = 'config'")?;
    let val_str: Option<String> = stmt.query_row([], |row| row.get(0)).ok();

    if let Some(s) = val_str {
        if let Ok(cfg) = serde_json::from_str::<PlannerConfig>(&s) {
            return Ok(cfg);
        }
    }
    Ok(PlannerConfig::default())
}

/// Guarda la configuración del planificador
pub fn save_planner_config_to_db(conn: &Connection, config: &PlannerConfig) -> Result<()> {
    let val_json = serde_json::to_string(config).unwrap_or_default();
    conn.execute(
        "INSERT INTO planner_config (key, value) VALUES ('config', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![val_json],
    )?;
    Ok(())
}

/// Obtiene o genera la lista de ítems planificados para hoy según el maestro de inventario
pub fn get_planner_daily_items_from_db(conn: &Connection) -> Result<Vec<PlannerDailyItem>> {
    let today = Local::now().format("%Y-%m-%d").to_string();

    // 1. Revisar si ya hay ejecuciones hoy
    let mut stmt_exec = conn.prepare(
        "SELECT item_code, status FROM planner_executions WHERE plan_date = ?1",
    )?;
    let mut exec_map = std::collections::HashMap::new();
    if let Ok(iter) = stmt_exec.query_map(params![today], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
        for item in iter.flatten() {
            exec_map.insert(item.0.to_uppercase(), item.1);
        }
    }

    // 2. Extraer ítems desde inventory_items
    let mut stmt = conn.prepare(
        "SELECT item_code, description, bin_location, system_qty, abc_code 
         FROM inventory_items 
         ORDER BY system_qty DESC
         LIMIT 50",
    )?;

    let iter = stmt.query_map([], |row| {
        let code: String = row.get(0)?;
        let desc: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
        let bin: String = row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string());
        let qty: f64 = row.get::<_, Option<f64>>(3)?.unwrap_or(0.0);
        let abc: String = row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "A".to_string());

        let code_upper = code.to_uppercase();
        let status = exec_map.get(&code_upper).cloned().unwrap_or_else(|| "Pendiente".to_string());

        Ok(PlannerDailyItem {
            id: code.clone(),
            item_code: code,
            description: desc,
            bin_location: bin,
            system_qty: qty,
            status,
            abc_category: if abc.is_empty() { "A".to_string() } else { abc },
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Guarda un registro de ejecución del planificador
pub fn save_planner_execution_to_db(
    conn: &Connection,
    mut record: PlannerExecutionRecord,
) -> Result<PlannerExecutionRecord> {
    if record.plan_date.trim().is_empty() {
        record.plan_date = Local::now().format("%Y-%m-%d").to_string();
    }
    if record.timestamp.trim().is_empty() {
        record.timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }

    conn.execute(
        "INSERT INTO planner_executions (plan_date, item_code, description, bin_location, status, user_id, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.plan_date,
            record.item_code.trim().to_uppercase(),
            record.description,
            record.bin_location,
            record.status,
            record.user_id,
            record.timestamp,
        ],
    )?;

    record.id = Some(conn.last_insert_rowid());
    Ok(record)
}

/// Estadísticas del plan del día
pub fn get_planner_stats_from_db(conn: &Connection) -> Result<PlannerStats> {
    let items = get_planner_daily_items_from_db(conn)?;
    let total = items.len();
    let completed = items.iter().filter(|it| it.status == "Completado" || it.status == "Auditado").count();
    let remaining = total.saturating_sub(completed);
    let progress = if total > 0 {
        (completed as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    Ok(PlannerStats {
        total_items_planned: total,
        completed_today: completed,
        remaining_today: remaining,
        progress_percentage: progress,
    })
}

/// Obtiene los ítems del planificador que presentaron diferencias durante la ejecución
pub fn get_items_with_differences_db(conn: &Connection) -> Result<Vec<PlannerExecutionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, plan_date, item_code, description, bin_location, status, user_id, timestamp
         FROM planner_executions
         WHERE status LIKE '%DIFERENCIA%' OR status LIKE '%DISCREPANCIA%' OR status = 'Investigado'
         ORDER BY id DESC",
    )?;

    let iter = stmt.query_map([], |row| {
        Ok(PlannerExecutionRecord {
            id: Some(row.get(0)?),
            plan_date: row.get(1)?,
            item_code: row.get(2)?,
            description: row.get(3)?,
            bin_location: row.get(4)?,
            status: row.get(5)?,
            user_id: row.get(6)?,
            timestamp: row.get(7)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Actualiza el estado o causa raíz de la diferencia en el planificador
pub fn update_planner_difference_cause_db(
    conn: &Connection,
    exec_id: i64,
    status: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE planner_executions SET status = ?1 WHERE id = ?2",
        params![status, exec_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE planner_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE planner_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_date TEXT NOT NULL,
                item_code TEXT NOT NULL,
                description TEXT,
                bin_location TEXT,
                system_qty REAL DEFAULT 0.0,
                counted_qty REAL DEFAULT 0.0,
                status TEXT DEFAULT 'Pendiente',
                user_id TEXT,
                timestamp TEXT
            );
        ").unwrap();
        conn
    }

    #[test]
    fn test_save_and_get_planner_config() {
        let conn = setup_test_db();
        let config = PlannerConfig {
            cycle_type: "ABC".to_string(),
            days_per_cycle: 45,
            a_frequency_days: 5,
            b_frequency_days: 10,
            c_frequency_days: 20,
        };

        save_planner_config_to_db(&conn, &config).unwrap();
        let loaded = get_planner_config_from_db(&conn).unwrap();

        assert_eq!(loaded.cycle_type, "ABC");
        assert_eq!(loaded.days_per_cycle, 45);
        assert_eq!(loaded.a_frequency_days, 5);
    }

    #[test]
    fn test_planner_difference_cause_update() {
        let conn = setup_test_db();
        conn.execute("
            INSERT INTO planner_executions (plan_date, item_code, system_qty, counted_qty, status)
            VALUES ('2026-08-16', 'SKU999', 10.0, 8.0, 'Discrepancia')
        ", []).unwrap();

        update_planner_difference_cause_db(&conn, 1, "Investigado - Ajuste aplicado").unwrap();

        let updated_status: String = conn.query_row(
            "SELECT status FROM planner_executions WHERE id = 1",
            [],
            |r| r.get(0)
        ).unwrap();

        assert_eq!(updated_status, "Investigado - Ajuste aplicado");
    }
}
