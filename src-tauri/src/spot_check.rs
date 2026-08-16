use chrono::Local;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotCheckItem {
    pub id: Option<i64>,
    pub item_code: String,
    pub description: Option<String>,
    pub location: String,
    pub system_qty: f64,
    pub counted_qty: f64,
    pub diff_qty: f64,
    pub user_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpressAuditItem {
    pub id: Option<i64>,
    pub item_code: String,
    pub description: Option<String>,
    pub location: String,
    pub system_qty: f64,
    pub audited_qty: f64,
    pub diff_qty: f64,
    pub user_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemQuickFind {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub system_qty: f64,
    pub unit_cost: f64,
}

/// Búsqueda rápida de SKU en el maestro local
pub fn find_item_quick(conn: &Connection, code: &str) -> Result<Option<ItemQuickFind>> {
    let clean_code = code.trim().to_uppercase();
    let mut stmt = conn.prepare(
        "SELECT item_code, description, bin_location, system_qty, unit_cost
         FROM inventory_items
         WHERE UPPER(item_code) = ?1",
    )?;

    let res = stmt.query_row(params![clean_code], |row| {
        Ok(ItemQuickFind {
            item_code: row.get(0)?,
            description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            bin_location: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
            system_qty: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            unit_cost: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
        })
    }).ok();

    Ok(res)
}

/// Obtiene todos los spot checks realizados
pub fn get_spot_checks_from_db(conn: &Connection) -> Result<Vec<SpotCheckItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, item_code, description, location, system_qty, counted_qty, diff_qty, user_id, timestamp
         FROM spot_checks
         ORDER BY id DESC",
    )?;

    let iter = stmt.query_map([], |row| {
        Ok(SpotCheckItem {
            id: Some(row.get(0)?),
            item_code: row.get(1)?,
            description: row.get(2)?,
            location: row.get(3)?,
            system_qty: row.get(4)?,
            counted_qty: row.get(5)?,
            diff_qty: row.get(6)?,
            user_id: row.get(7)?,
            timestamp: row.get(8)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Guarda un spot check
pub fn save_spot_check_to_db(conn: &Connection, mut record: SpotCheckItem) -> Result<SpotCheckItem> {
    if record.timestamp.trim().is_empty() {
        record.timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    record.diff_qty = record.counted_qty - record.system_qty;

    conn.execute(
        "INSERT INTO spot_checks (item_code, description, location, system_qty, counted_qty, diff_qty, user_id, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.item_code.trim().to_uppercase(),
            record.description,
            record.location.trim().to_uppercase(),
            record.system_qty,
            record.counted_qty,
            record.diff_qty,
            record.user_id,
            record.timestamp,
        ],
    )?;

    record.id = Some(conn.last_insert_rowid());
    Ok(record)
}

/// Limpia el historial de spot checks
pub fn clear_spot_checks_in_db(conn: &Connection) -> Result<usize> {
    let rows = conn.execute("DELETE FROM spot_checks", [])?;
    Ok(rows)
}

/// Elimina un spot check específico
pub fn delete_spot_check_in_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM spot_checks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Obtiene todos los express audits
pub fn get_express_audits_from_db(conn: &Connection) -> Result<Vec<ExpressAuditItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, item_code, description, location, system_qty, audited_qty, diff_qty, user_id, timestamp
         FROM express_audits
         ORDER BY id DESC",
    )?;

    let iter = stmt.query_map([], |row| {
        Ok(ExpressAuditItem {
            id: Some(row.get(0)?),
            item_code: row.get(1)?,
            description: row.get(2)?,
            location: row.get(3)?,
            system_qty: row.get(4)?,
            audited_qty: row.get(5)?,
            diff_qty: row.get(6)?,
            user_id: row.get(7)?,
            timestamp: row.get(8)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Guarda un express audit
pub fn save_express_audit_to_db(conn: &Connection, mut record: ExpressAuditItem) -> Result<ExpressAuditItem> {
    if record.timestamp.trim().is_empty() {
        record.timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    record.diff_qty = record.audited_qty - record.system_qty;

    conn.execute(
        "INSERT INTO express_audits (item_code, description, location, system_qty, audited_qty, diff_qty, user_id, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.item_code.trim().to_uppercase(),
            record.description,
            record.location.trim().to_uppercase(),
            record.system_qty,
            record.audited_qty,
            record.diff_qty,
            record.user_id,
            record.timestamp,
        ],
    )?;

    record.id = Some(conn.last_insert_rowid());
    Ok(record)
}

/// Limpia todos los express audits
pub fn clear_express_audits_in_db(conn: &Connection) -> Result<usize> {
    let rows = conn.execute("DELETE FROM express_audits", [])?;
    Ok(rows)
}
