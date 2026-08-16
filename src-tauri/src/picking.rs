use chrono::Local;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingOrder {
    pub id: Option<i64>,
    pub shipment_id: String,
    pub order_number: Option<String>,
    pub customer_name: Option<String>,
    pub carrier: Option<String>,
    pub item_code: String,
    pub item_description: Option<String>,
    pub requested_qty: f64,
    pub picked_qty: f64,
    pub status: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipmentSummary {
    pub id: String,
    pub shipment_id: String,
    pub customer: String,
    pub carrier: String,
    pub total_items: usize,
    pub audited_items: usize,
    pub status: String,
    pub items: Vec<PickingOrder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingAudit {
    pub id: Option<i64>,
    pub shipment_id: String,
    pub order_number: Option<String>,
    pub item_code: String,
    pub item_description: Option<String>,
    pub requested_qty: f64,
    pub audited_qty: f64,
    pub difference: f64,
    pub auditor_user: Option<String>,
    pub status: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackingList {
    pub shipment_id: String,
    pub items: Vec<PickingOrder>,
    pub created_at: String,
}

/// Obtiene el listado consolidado de despachos (Shipments)
pub fn get_shipments_from_db(conn: &Connection) -> Result<Vec<ShipmentSummary>> {
    let mut stmt_orders = conn.prepare(
        "SELECT id, shipment_id, order_number, customer_name, carrier, item_code, item_description,
                requested_qty, picked_qty, status, timestamp
         FROM picking_orders
         ORDER BY id ASC",
    )?;

    let order_iter = stmt_orders.query_map([], |row| {
        Ok(PickingOrder {
            id: Some(row.get(0)?),
            shipment_id: row.get(1)?,
            order_number: row.get(2)?,
            customer_name: row.get(3)?,
            carrier: row.get(4)?,
            item_code: row.get(5)?,
            item_description: row.get(6)?,
            requested_qty: row.get(7)?,
            picked_qty: row.get(8)?,
            status: row.get(9)?,
            timestamp: row.get(10)?,
        })
    })?;

    let mut grouped: HashMap<String, ShipmentSummary> = HashMap::new();
    for ord_res in order_iter {
        if let Ok(ord) = ord_res {
            let s_id = ord.shipment_id.clone();
            let entry = grouped.entry(s_id.clone()).or_insert_with(|| ShipmentSummary {
                id: s_id.clone(),
                shipment_id: s_id.clone(),
                customer: ord.customer_name.clone().unwrap_or_else(|| "Cliente".to_string()),
                carrier: ord.carrier.clone().unwrap_or_else(|| "N/A".to_string()),
                total_items: 0,
                audited_items: 0,
                status: "Pendiente".to_string(),
                items: Vec::new(),
            });
            entry.total_items += 1;
            entry.items.push(ord);
        }
    }

    // Contar auditorías realizadas
    let mut stmt_audits = conn.prepare("SELECT shipment_id, COUNT(*) FROM picking_audits GROUP BY shipment_id")?;
    let audit_iter = stmt_audits.query_map([], |row| {
        let sid: String = row.get(0)?;
        let count: usize = row.get(1)?;
        Ok((sid, count))
    })?;

    for a in audit_iter.flatten() {
        if let Some(summary) = grouped.get_mut(&a.0) {
            summary.audited_items = a.1;
            if summary.audited_items >= summary.total_items && summary.total_items > 0 {
                summary.status = "Auditado".to_string();
            }
        }
    }

    let mut result: Vec<ShipmentSummary> = grouped.into_values().collect();
    result.sort_by(|a, b| a.shipment_id.cmp(&b.shipment_id));
    Ok(result)
}

/// Obtiene los detalles de un despacho específico
pub fn get_shipment_details_from_db(conn: &Connection, shipment_id: &str) -> Result<Option<ShipmentSummary>> {
    let shipments = get_shipments_from_db(conn)?;
    Ok(shipments.into_iter().find(|s| s.shipment_id == shipment_id || s.id == shipment_id))
}

/// Genera el packing list de un despacho
pub fn get_packing_list_from_db(conn: &Connection, shipment_id: &str) -> Result<PackingList> {
    let mut stmt = conn.prepare(
        "SELECT id, shipment_id, order_number, customer_name, carrier, item_code, item_description,
                requested_qty, picked_qty, status, timestamp
         FROM picking_orders
         WHERE shipment_id = ?1",
    )?;

    let items_iter = stmt.query_map(params![shipment_id], |row| {
        Ok(PickingOrder {
            id: Some(row.get(0)?),
            shipment_id: row.get(1)?,
            order_number: row.get(2)?,
            customer_name: row.get(3)?,
            carrier: row.get(4)?,
            item_code: row.get(5)?,
            item_description: row.get(6)?,
            requested_qty: row.get(7)?,
            picked_qty: row.get(8)?,
            status: row.get(9)?,
            timestamp: row.get(10)?,
        })
    })?;

    let mut items = Vec::new();
    for it in items_iter.flatten() {
        items.push(it);
    }

    Ok(PackingList {
        shipment_id: shipment_id.to_string(),
        items,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

/// Elimina un despacho y sus órdenes asociadas
pub fn delete_shipment_from_db(conn: &Connection, shipment_id: &str) -> Result<()> {
    conn.execute("DELETE FROM picking_orders WHERE shipment_id = ?1", params![shipment_id])?;
    conn.execute("DELETE FROM picking_audits WHERE shipment_id = ?1", params![shipment_id])?;
    Ok(())
}

/// Obtiene todas las auditorías de picking
pub fn get_picking_audits_from_db(conn: &Connection) -> Result<Vec<PickingAudit>> {
    let mut stmt = conn.prepare(
        "SELECT id, shipment_id, order_number, item_code, item_description, requested_qty, audited_qty, difference, auditor_user, status, timestamp
         FROM picking_audits
         ORDER BY id DESC",
    )?;

    let audit_iter = stmt.query_map([], |row| {
        Ok(PickingAudit {
            id: Some(row.get(0)?),
            shipment_id: row.get(1)?,
            order_number: row.get(2)?,
            item_code: row.get(3)?,
            item_description: row.get(4)?,
            requested_qty: row.get(5)?,
            audited_qty: row.get(6)?,
            difference: row.get(7)?,
            auditor_user: row.get(8)?,
            status: row.get(9)?,
            timestamp: row.get(10)?,
        })
    })?;

    let mut list = Vec::new();
    for a in audit_iter.flatten() {
        list.push(a);
    }
    Ok(list)
}

/// Guarda una auditoría de picking
pub fn save_picking_audit_to_db(conn: &Connection, mut audit: PickingAudit) -> Result<PickingAudit> {
    if audit.timestamp.trim().is_empty() {
        audit.timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    audit.difference = audit.audited_qty - audit.requested_qty;

    conn.execute(
        "INSERT INTO picking_audits (
            shipment_id, order_number, item_code, item_description, requested_qty,
            audited_qty, difference, auditor_user, status, timestamp
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            audit.shipment_id,
            audit.order_number,
            audit.item_code,
            audit.item_description,
            audit.requested_qty,
            audit.audited_qty,
            audit.difference,
            audit.auditor_user,
            audit.status,
            audit.timestamp,
        ],
    )?;

    audit.id = Some(conn.last_insert_rowid());
    Ok(audit)
}

/// Actualiza una auditoría existente
pub fn update_picking_audit_in_db(conn: &Connection, id: i64, audit: PickingAudit) -> Result<PickingAudit> {
    let diff = audit.audited_qty - audit.requested_qty;
    conn.execute(
        "UPDATE picking_audits SET
            shipment_id = ?1,
            order_number = ?2,
            item_code = ?3,
            item_description = ?4,
            requested_qty = ?5,
            audited_qty = ?6,
            difference = ?7,
            auditor_user = ?8,
            status = ?9,
            timestamp = ?10
         WHERE id = ?11",
        params![
            audit.shipment_id,
            audit.order_number,
            audit.item_code,
            audit.item_description,
            audit.requested_qty,
            audit.audited_qty,
            diff,
            audit.auditor_user,
            audit.status,
            audit.timestamp,
            id,
        ],
    )?;
    Ok(audit)
}

/// Elimina auditorías por lista de IDs
pub fn delete_picking_audits_from_db(conn: &Connection, ids: &[i64]) -> Result<usize> {
    let mut count = 0;
    for id in ids {
        count += conn.execute("DELETE FROM picking_audits WHERE id = ?1", params![id])?;
    }
    Ok(count)
}

/// Importación masiva de órdenes de picking
pub fn import_picking_orders_bulk(conn: &mut Connection, orders: &[PickingOrder]) -> Result<usize> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO picking_orders (
                shipment_id, order_number, customer_name, carrier, item_code,
                item_description, requested_qty, picked_qty, status, timestamp
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;

        for ord in orders {
            let ts = if ord.timestamp.is_empty() {
                Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
            } else {
                ord.timestamp.clone()
            };

            stmt.execute(params![
                ord.shipment_id,
                ord.order_number,
                ord.customer_name,
                ord.carrier,
                ord.item_code,
                ord.item_description,
                ord.requested_qty,
                ord.picked_qty,
                ord.status,
                ts,
            ])?;
        }
    }
    tx.commit()?;
    Ok(orders.len())
}

/// Obtiene el detalle de una auditoría individual por ID
pub fn get_picking_audit_by_id_db(conn: &Connection, id: i64) -> Result<Option<PickingAudit>> {
    let mut stmt = conn.prepare(
        "SELECT id, shipment_id, order_number, item_code, item_description, requested_qty, audited_qty, difference, auditor_user, status, timestamp
         FROM picking_audits
         WHERE id = ?1",
    )?;

    let res = stmt.query_row(params![id], |row| {
        Ok(PickingAudit {
            id: Some(row.get(0)?),
            shipment_id: row.get(1)?,
            order_number: row.get(2)?,
            item_code: row.get(3)?,
            item_description: row.get(4)?,
            requested_qty: row.get(5)?,
            audited_qty: row.get(6)?,
            difference: row.get(7)?,
            auditor_user: row.get(8)?,
            status: row.get(9)?,
            timestamp: row.get(10)?,
        })
    });

    match res {
        Ok(a) => Ok(Some(a)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}
