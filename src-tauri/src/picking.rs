use chrono::Local;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

// ============================================================================
// DTOs & STRUCTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingTrackingItem {
    pub order_number: String,
    pub despatch_number: String,
    pub customer_code: String,
    pub customer_name: String,
    pub total_lines: usize,
    pub print_date: String,
    pub time_zone: String,
    pub is_audited: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingOrderRow {
    #[serde(rename = "Order Number")]
    pub order_number: String,
    #[serde(rename = "Despatch Number")]
    pub despatch_number: String,
    #[serde(rename = "Customer Code")]
    pub customer_code: String,
    #[serde(rename = "Customer Name")]
    pub customer_name: String,
    #[serde(rename = "Item Code")]
    pub item_code: String,
    #[serde(rename = "Item Description")]
    pub item_description: String,
    #[serde(rename = "Order Line")]
    pub order_line: String,
    #[serde(rename = "Qty")]
    pub qty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingOrderImportRow {
    #[serde(default)]
    pub shipment_id: Option<String>,
    pub order_number: String,
    #[serde(default)]
    pub despatch_number: Option<String>,
    #[serde(default)]
    pub customer_code: Option<String>,
    #[serde(default)]
    pub customer_name: Option<String>,
    #[serde(default)]
    pub carrier: Option<String>,
    #[serde(default)]
    pub order_line: Option<String>,
    pub item_code: String,
    #[serde(default)]
    pub item_description: Option<String>,
    pub requested_qty: f64,
    #[serde(default)]
    pub picked_qty: Option<f64>,
    #[serde(default)]
    pub print_date: Option<String>,
    #[serde(default)]
    pub time_zone_hours: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditItemInput {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default, alias = "code")]
    pub item_code: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub order_line: String,
    #[serde(default)]
    pub qty_req: f64,
    #[serde(default)]
    pub qty_scan: f64,
    #[serde(default)]
    pub difference: Option<f64>,
    #[serde(default)]
    pub edited: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageDimensionInput {
    #[serde(default)]
    pub package_number: i64,
    #[serde(default)]
    pub length: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingAuditFullInput {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub order_number: String,
    #[serde(default)]
    pub despatch_number: Option<String>,
    #[serde(default)]
    pub customer_code: Option<String>,
    #[serde(default)]
    pub customer_name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub packages: Option<i64>,
    #[serde(default)]
    pub items: Vec<AuditItemInput>,
    #[serde(default)]
    pub packages_assignment: serde_json::Value,
    #[serde(default)]
    pub packages_dimensions: Vec<PackageDimensionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingAuditItemDto {
    pub id: i64,
    pub item_code: String,
    pub description: String,
    pub order_line: String,
    pub qty_req: f64,
    pub qty_scan: f64,
    pub difference: f64,
    pub edited: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingAuditSummaryFull {
    pub id: i64,
    pub order_number: String,
    pub despatch_number: String,
    pub customer_code: String,
    pub customer_name: String,
    pub username: String,
    pub timestamp: String,
    pub status: String,
    pub packages: i64,
    pub packages_assignment: HashMap<String, HashMap<String, i64>>,
    pub packages_dimensions: Vec<PackageDimensionInput>,
    pub items: Vec<PickingAuditItemDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackingListItemDetailDto {
    pub item_code: String,
    pub description: String,
    pub order_line: String,
    pub qty: f64,
    pub quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickingAuditPackingListDto {
    pub audit_id: i64,
    pub order_number: String,
    pub despatch_number: String,
    pub customer_code: String,
    pub customer_name: String,
    pub timestamp: String,
    pub total_packages: i64,
    pub packages: HashMap<String, Vec<PackingListItemDetailDto>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipmentAuditSummaryDto {
    pub audit_id: i64,
    pub order_number: String,
    pub despatch_number: String,
    pub customer_code: String,
    pub customer_name: String,
    pub packages: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipmentDto {
    pub id: i64,
    pub created_at: String,
    pub username: String,
    pub note: String,
    pub carrier: String,
    pub status: String,
    pub total_orders: usize,
    pub audits: Vec<ShipmentAuditSummaryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidatedOrderItemDto {
    pub order_line: String,
    pub item_code: String,
    pub description: String,
    pub quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidatedOrderDto {
    pub audit_id: i64,
    pub order_number: String,
    pub despatch_number: String,
    pub customer_code: String,
    pub customer_name: String,
    pub timestamp: String,
    pub total_packages: i64,
    pub packages: HashMap<String, Vec<ConsolidatedOrderItemDto>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidatedPackingListDto {
    pub shipment_id: i64,
    pub created_at: String,
    pub carrier: String,
    pub note: String,
    pub total_orders: usize,
    pub orders: Vec<ConsolidatedOrderDto>,
}

// ============================================================================
// SEEDING & IMPORT
// ============================================================================

/// Si la tabla picking_orders está vacía, intenta poblarla desde data/AURRSGLBD0240.csv
pub fn seed_picking_orders_from_csv_if_empty(conn: &mut Connection, csv_path: &str) -> Result<usize> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM picking_orders", [], |r| r.get(0)).unwrap_or(0);
    if count > 0 {
        return Ok(0);
    }

    if !Path::new(csv_path).exists() {
        return Ok(0);
    }

    let file = match File::open(csv_path) {
        Ok(f) => f,
        Err(_) => return Ok(0),
    };

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(file);

    let headers = match rdr.headers() {
        Ok(h) => h.clone(),
        Err(_) => return Ok(0),
    };

    let get_idx = |names: &[&str]| -> Option<usize> {
        for (i, h) in headers.iter().enumerate() {
            let clean = h.trim().trim_start_matches('\u{feff}').to_lowercase();
            for target in names {
                if clean == target.to_lowercase() {
                    return Some(i);
                }
            }
        }
        None
    };

    let idx_order = get_idx(&["ORDER_", "order_number", "order", "pedido"]);
    let idx_despatch = get_idx(&["DESPATCH_", "despatch_number", "despatch", "despacho"]);
    let idx_cust_code = get_idx(&["CUSTOMER", "customer_code", "cliente"]);
    let idx_cust_name = get_idx(&["CUSTOMER_NAME", "customer_name", "nombre_cliente"]);
    let idx_item = get_idx(&["ITEM", "item_code", "codigo", "sku"]);
    let idx_desc = get_idx(&["DESCRIPTION", "item_description", "descripcion"]);
    let idx_line = get_idx(&["ORDER_LINE", "order_line", "linea", "posicion"]);
    let idx_qty = get_idx(&["QTY", "quantity", "cantidad"]);
    let idx_print = get_idx(&["PICK_LIST_PRINTED_TIME", "print_date", "creation_time"]);
    let idx_tz = get_idx(&["Time_Zone_Hours", "time_zone"]);
    let idx_carrier = get_idx(&["Carrier", "carrier", "transportadora"]);

    let tx = conn.transaction()?;
    let mut inserted = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO picking_orders (
                shipment_id, order_number, despatch_number, customer_code, customer_name,
                carrier, order_line, item_code, item_description, requested_qty,
                picked_qty, print_date, time_zone_hours, status, timestamp
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        for result in rdr.records() {
            if let Ok(record) = result {
                let order = idx_order.and_then(|i| record.get(i)).unwrap_or("").trim().to_string();
                let item = idx_item.and_then(|i| record.get(i)).unwrap_or("").trim().to_string();
                if order.is_empty() || item.is_empty() {
                    continue;
                }

                let despatch = idx_despatch.and_then(|i| record.get(i)).unwrap_or("00").trim().to_string();
                let cust_code = idx_cust_code.and_then(|i| record.get(i)).unwrap_or("N/A").trim().to_string();
                let cust_name = idx_cust_name.and_then(|i| record.get(i)).unwrap_or("Cliente General").trim().to_string();
                let desc = idx_desc.and_then(|i| record.get(i)).unwrap_or("").trim().to_string();
                let line = idx_line.and_then(|i| record.get(i)).unwrap_or("1").trim().to_string();
                let raw_qty = idx_qty.and_then(|i| record.get(i)).unwrap_or("0").replace(',', "");
                let qty: f64 = raw_qty.parse().unwrap_or(0.0);
                let print = idx_print.and_then(|i| record.get(i)).unwrap_or("").trim().to_string();
                let tz = idx_tz.and_then(|i| record.get(i)).unwrap_or("-05:00").trim().to_string();
                let carrier = idx_carrier.and_then(|i| record.get(i)).unwrap_or("").trim().to_string();

                stmt.execute(params![
                    order.clone(),
                    order,
                    despatch,
                    cust_code,
                    cust_name,
                    carrier,
                    line,
                    item,
                    desc,
                    qty,
                    0.0,
                    print,
                    tz,
                    "PP",
                    now,
                ])?;
                inserted += 1;
            }
        }
    }
    tx.commit()?;
    Ok(inserted)
}

/// Importación masiva de órdenes de picking desde arrays JSON (ej. subida de archivo 240)
pub fn import_picking_orders_bulk_db(conn: &mut Connection, orders: &[PickingOrderImportRow]) -> Result<usize> {
    let tx = conn.transaction()?;
    // Limpiar órdenes anteriores antes de la carga del nuevo 240
    tx.execute("DELETE FROM picking_orders", [])?;
    let mut count = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO picking_orders (
                shipment_id, order_number, despatch_number, customer_code, customer_name,
                carrier, order_line, item_code, item_description, requested_qty,
                picked_qty, print_date, time_zone_hours, status, timestamp
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        for ord in orders {
            let order = ord.order_number.trim().to_string();
            let item = ord.item_code.trim().to_uppercase();
            if order.is_empty() || item.is_empty() {
                continue;
            }
            let despatch = ord.despatch_number.clone().unwrap_or_else(|| "00".to_string()).trim().to_string();
            let cust_code = ord.customer_code.clone().unwrap_or_else(|| "N/A".to_string()).trim().to_string();
            let cust_name = ord.customer_name.clone().unwrap_or_else(|| "Cliente General".to_string()).trim().to_string();
            let carrier = ord.carrier.clone().unwrap_or_else(|| "N/A".to_string()).trim().to_string();
            let line = ord.order_line.clone().unwrap_or_else(|| "1".to_string()).trim().to_string();
            let desc = ord.item_description.clone().unwrap_or_default().trim().to_string();
            let print = ord.print_date.clone().unwrap_or_else(|| now.split(' ').next().unwrap_or("").to_string()).trim().to_string();
            let tz = ord.time_zone_hours.clone().unwrap_or_else(|| "-05:00".to_string()).trim().to_string();
            let status = ord.status.clone().unwrap_or_else(|| "PP".to_string());
            let ts = ord.timestamp.clone().unwrap_or_else(|| now.clone());
            let picked = ord.picked_qty.unwrap_or(0.0);

            stmt.execute(params![
                order.clone(),
                order,
                despatch,
                cust_code,
                cust_name,
                carrier,
                line,
                item,
                desc,
                ord.requested_qty,
                picked,
                print,
                tz,
                status,
                ts,
            ])?;
            count += 1;
        }
    }
    tx.commit()?;
    Ok(count)
}

// ============================================================================
// 1. TRACKING MATRIX (/api/picking/tracking)
// ============================================================================

pub fn get_picking_tracking_from_db(conn: &Connection) -> Result<Vec<PickingTrackingItem>> {
    // 1. Obtener lista de auditorías existentes para marcar estado
    let mut stmt_audits = conn.prepare("SELECT order_number, despatch_number, status FROM picking_audits")?;
    let mut audited_map: HashMap<(String, String), String> = HashMap::new();
    let mut audited_by_order: HashMap<String, String> = HashMap::new();
    let audit_rows = stmt_audits.query_map([], |r| {
        let o = r.get::<_, String>(0)?.trim().to_uppercase();
        let d = r.get::<_, String>(1)?.trim().to_uppercase();
        let s = r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "Completo".to_string());
        Ok((o, d, s))
    })?;
    for row in audit_rows.flatten() {
        audited_by_order.insert(row.0.clone(), row.2.clone());
        audited_map.insert((row.0, row.1), row.2);
    }

    // 2. Agrupar órdenes de picking_orders
    let mut stmt = conn.prepare(
        "SELECT order_number, despatch_number,
                COALESCE(NULLIF(TRIM(MAX(customer_code)), ''), 'N/A') as cust_code,
                COALESCE(NULLIF(TRIM(MAX(customer_name)), ''), 'Cliente General') as cust_name,
                COUNT(*) as total_lines,
                COALESCE(NULLIF(MAX(print_date), ''), date('now')) as p_date,
                COALESCE(NULLIF(MAX(time_zone_hours), ''), '-05:00') as tz,
                COALESCE(NULLIF(MAX(status), ''), 'PP') as ord_status
         FROM picking_orders
         GROUP BY order_number, despatch_number
         ORDER BY p_date DESC, order_number ASC",
    )?;

    let iter = stmt.query_map([], |row| {
        let order: String = row.get(0)?;
        let despatch: String = row.get(1)?;
        let cust_code: String = row.get(2)?;
        let cust_name: String = row.get(3)?;
        let lines: usize = row.get(4)?;
        let p_date: String = row.get(5)?;
        let tz: String = row.get(6)?;
        let ord_status: String = row.get(7)?;

        let ord_upper = order.trim().to_uppercase();
        let desp_upper = despatch.trim().to_uppercase();
        let key = (ord_upper.clone(), desp_upper.clone());

        let (is_audited, status) = if let Some(st) = audited_map.get(&key) {
            (true, st.clone())
        } else if let Some(st) = audited_map.iter().find(|((o, d), _)| {
            o == &ord_upper && (d.trim_start_matches('0') == desp_upper.trim_start_matches('0') || d.is_empty() || desp_upper.is_empty())
        }).map(|(_, st)| st) {
            (true, st.clone())
        } else if let Some(st) = audited_by_order.get(&ord_upper) {
            (true, st.clone())
        } else if ord_status == "AUDITADO" || ord_status == "Completo" {
            (true, ord_status)
        } else {
            (false, "PP".to_string())
        };

        Ok(PickingTrackingItem {
            order_number: order,
            despatch_number: despatch,
            customer_code: cust_code,
            customer_name: cust_name,
            total_lines: lines,
            print_date: p_date,
            time_zone: tz,
            is_audited,
            status,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

// ============================================================================
// 2. ORDER DETAILS (/api/picking/order/{order}/{despatch})
// ============================================================================

pub fn get_picking_order_details_from_db(conn: &Connection, order_number: &str, despatch_number: &str) -> Result<Vec<PickingOrderRow>> {
    let order_clean = order_number.trim();
    let despatch_clean = despatch_number.trim();

    let mut stmt = conn.prepare(
        "SELECT order_number, despatch_number, customer_code, customer_name,
                item_code, item_description, order_line, requested_qty
         FROM picking_orders
         WHERE TRIM(order_number) = ?1 AND TRIM(despatch_number) = ?2
         ORDER BY CAST(order_line AS INTEGER) ASC, id ASC",
    )?;

    let iter = stmt.query_map(params![order_clean, despatch_clean], |row| {
        Ok(PickingOrderRow {
            order_number: row.get(0)?,
            despatch_number: row.get(1)?,
            customer_code: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
            customer_name: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "Cliente General".to_string()),
            item_code: row.get(4)?,
            item_description: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            order_line: row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "1".to_string()),
            qty: row.get(7)?,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

// ============================================================================
// 3. SAVE AUDIT (/api/save_picking_audit)
// ============================================================================

pub fn save_picking_audit_full_to_db(conn: &mut Connection, payload: PickingAuditFullInput) -> Result<i64> {
    let tx = conn.transaction()?;

    let timestamp = payload.timestamp.unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    let status = payload.status.unwrap_or_else(|| "Completo".to_string());
    let username = payload.username.unwrap_or_else(|| "admin".to_string());
    let packages = payload.packages.unwrap_or(1);
    let cust_code = payload.customer_code.unwrap_or_else(|| "N/A".to_string());
    let cust_name = payload.customer_name.unwrap_or_else(|| "Cliente General".to_string());
    let ord_num = payload.order_number.trim().to_string();
    let desp_num = payload.despatch_number.unwrap_or_else(|| "00".to_string());
    let desp_num = if desp_num.trim().is_empty() { "00".to_string() } else { desp_num.trim().to_string() };

    // 1. Insert or Replace Header
    tx.execute(
        "INSERT INTO picking_audits (
            order_number, despatch_number, customer_code, customer_name,
            username, timestamp, status, packages, shipment_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            ord_num,
            desp_num,
            cust_code,
            cust_name,
            username,
            timestamp,
            status,
            packages,
            ord_num,
        ],
    )?;
    let audit_id = tx.last_insert_rowid();

    // 2. Insert Items
    {
        let mut stmt_item = tx.prepare(
            "INSERT INTO picking_audit_items (
                audit_id, item_code, description, order_line, qty_req, qty_scan, difference, edited
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;

        for item in &payload.items {
            let diff = item.difference.unwrap_or(item.qty_scan - item.qty_req);
            stmt_item.execute(params![
                audit_id,
                item.item_code.trim().to_uppercase(),
                item.description.trim(),
                item.order_line.trim(),
                item.qty_req,
                item.qty_scan,
                diff,
                item.edited.unwrap_or(0),
            ])?;
        }
    }

    // 3. Insert Packages Dimensions
    {
        let mut stmt_dim = tx.prepare(
            "INSERT INTO picking_packages (
                audit_id, package_number, length, width, height, weight
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;

        for dim in &payload.packages_dimensions {
            stmt_dim.execute(params![
                audit_id,
                dim.package_number,
                dim.length,
                dim.width,
                dim.height,
                dim.weight,
            ])?;
        }
    }

    // 4. Insert Packages Assignment
    if let Some(obj) = payload.packages_assignment.as_object() {
        let mut stmt_pkg_item = tx.prepare(
            "INSERT INTO picking_package_items (
                audit_id, package_number, order_line, item_code, description, qty_scan
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;

        for (key, val) in obj {
            let (item_code, order_line) = if key.contains(':') {
                let parts: Vec<&str> = key.splitn(2, ':').collect();
                (parts[0].trim().to_uppercase(), parts[1].trim().to_string())
            } else {
                (key.trim().to_uppercase(), "".to_string())
            };

            let item_desc = payload.items.iter()
                .find(|it| it.item_code.trim().to_uppercase() == item_code && (order_line.is_empty() || it.order_line == order_line))
                .map(|it| it.description.clone())
                .unwrap_or_default();

            if let Some(assignments) = val.as_object() {
                for (pkg_str, qty_val) in assignments {
                    let qty = if let Some(n) = qty_val.as_f64() {
                        n
                    } else if let Some(n) = qty_val.as_i64() {
                        n as f64
                    } else if let Some(s) = qty_val.as_str() {
                        s.parse::<f64>().unwrap_or(0.0)
                    } else {
                        0.0
                    };

                    if qty > 0.0 {
                        let pkg_num: i64 = pkg_str.parse().unwrap_or(1);
                        stmt_pkg_item.execute(params![
                            audit_id,
                            pkg_num,
                            order_line,
                            item_code,
                            item_desc,
                            qty,
                        ])?;
                    }
                }
            }
        }
    }

    // 5. Marcar en picking_orders como AUDITADO
    let _ = tx.execute(
        "UPDATE picking_orders SET status = 'AUDITADO' WHERE UPPER(TRIM(order_number)) = ?1",
        params![ord_num.to_uppercase()],
    );

    tx.commit()?;
    Ok(audit_id)
}

// ============================================================================
// 4. GET ALL AUDITS (/api/views/view_picking_audits)
// ============================================================================

pub fn get_picking_audits_full_from_db(conn: &Connection) -> Result<Vec<PickingAuditSummaryFull>> {
    let mut stmt = conn.prepare(
        "SELECT id, order_number, despatch_number, customer_code, customer_name,
                username, timestamp, status, packages
         FROM picking_audits
         ORDER BY id DESC",
    )?;

    let audit_rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "00".to_string()),
            row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "N/A".to_string()),
            row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Cliente General".to_string()),
            row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "admin".to_string()),
            row.get::<_, Option<String>>(6)?.unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "Completo".to_string()),
            row.get::<_, Option<i64>>(8)?.unwrap_or(1),
        ))
    })?;

    let mut result = Vec::new();

    for r in audit_rows.flatten() {
        let audit_id = r.0;

        // Cargar items
        let mut stmt_items = conn.prepare(
            "SELECT id, item_code, description, order_line, qty_req, qty_scan, difference, edited
             FROM picking_audit_items
             WHERE audit_id = ?1
             ORDER BY id ASC",
        )?;
        let items_iter = stmt_items.query_map(params![audit_id], |row| {
            Ok(PickingAuditItemDto {
                id: row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                item_code: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                order_line: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                qty_req: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                qty_scan: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                difference: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                edited: row.get::<_, Option<i64>>(7)?.unwrap_or(0),
            })
        })?;
        let items: Vec<PickingAuditItemDto> = items_iter.flatten().collect();

        // Cargar asignación de bultos
        let mut stmt_pkg_items = conn.prepare(
            "SELECT package_number, order_line, item_code, qty_scan
             FROM picking_package_items
             WHERE audit_id = ?1
             ORDER BY package_number ASC, id ASC",
        )?;
        let pkg_items_iter = stmt_pkg_items.query_map(params![audit_id], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(1),
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            ))
        })?;

        let mut packages_assignment: HashMap<String, HashMap<String, i64>> = HashMap::new();
        for pki in pkg_items_iter.flatten() {
            let mut order_line = pki.1;
            if order_line.is_empty() {
                if let Some(matching) = items.iter().find(|it| it.item_code == pki.2) {
                    order_line = matching.order_line.clone();
                }
            }
            let key = format!("{}:{}", pki.2, order_line);
            let pkg_str = pki.0.to_string();
            packages_assignment.entry(key).or_default().insert(pkg_str, pki.3 as i64);
        }

        // Cargar dimensiones
        let mut stmt_dims = conn.prepare(
            "SELECT package_number, length, width, height, weight
             FROM picking_packages
             WHERE audit_id = ?1
             ORDER BY package_number ASC",
        )?;
        let dims_iter = stmt_dims.query_map(params![audit_id], |row| {
            Ok(PackageDimensionInput {
                package_number: row.get::<_, Option<i64>>(0)?.unwrap_or(1),
                length: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                width: row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                height: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                weight: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
            })
        })?;
        let packages_dimensions: Vec<PackageDimensionInput> = dims_iter.flatten().collect();

        result.push(PickingAuditSummaryFull {
            id: audit_id,
            order_number: r.1,
            despatch_number: r.2,
            customer_code: r.3,
            customer_name: r.4,
            username: r.5,
            timestamp: r.6,
            status: r.7,
            packages: r.8,
            packages_assignment,
            packages_dimensions,
            items,
        });
    }

    Ok(result)
}

// ============================================================================
// 5. GET AUDIT DETAIL (/api/picking_audit/{id})
// ============================================================================

pub fn get_picking_audit_by_id_full_db(conn: &Connection, id: i64) -> Result<Option<PickingAuditSummaryFull>> {
    let all = get_picking_audits_full_from_db(conn)?;
    Ok(all.into_iter().find(|a| a.id == id))
}

// ============================================================================
// 6. UPDATE AUDIT (/api/update_picking_audit/{id})
// ============================================================================

pub fn update_picking_audit_full_in_db(conn: &mut Connection, id: i64, payload: PickingAuditFullInput) -> Result<bool> {
    let tx = conn.transaction()?;

    let status = payload.status.unwrap_or_else(|| "Completo".to_string());
    let packages = payload.packages.unwrap_or(1);
    let cust_code = payload.customer_code.unwrap_or_else(|| "N/A".to_string());
    let cust_name = payload.customer_name.unwrap_or_else(|| "Cliente General".to_string());
    let ord_num = payload.order_number.trim().to_string();
    let desp_num = payload.despatch_number.unwrap_or_else(|| "00".to_string());
    let desp_num = if desp_num.trim().is_empty() { "00".to_string() } else { desp_num.trim().to_string() };

    tx.execute(
        "UPDATE picking_audits SET
            order_number = ?1,
            despatch_number = ?2,
            customer_code = ?3,
            customer_name = ?4,
            status = ?5,
            packages = ?6
         WHERE id = ?7",
        params![
            ord_num,
            desp_num,
            cust_code,
            cust_name,
            status,
            packages,
            id,
        ],
    )?;

    // Eliminar items previos y reinsertar con edited = 1
    tx.execute("DELETE FROM picking_audit_items WHERE audit_id = ?1", params![id])?;
    {
        let mut stmt_item = tx.prepare(
            "INSERT INTO picking_audit_items (
                audit_id, item_code, description, order_line, qty_req, qty_scan, difference, edited
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;

        for item in &payload.items {
            let diff = item.difference.unwrap_or(item.qty_scan - item.qty_req);
            stmt_item.execute(params![
                id,
                item.item_code.trim().to_uppercase(),
                item.description.trim(),
                item.order_line.trim(),
                item.qty_req,
                item.qty_scan,
                diff,
                1,
            ])?;
        }
    }

    // Reinsertar asignación de bultos
    tx.execute("DELETE FROM picking_package_items WHERE audit_id = ?1", params![id])?;
    if let Some(obj) = payload.packages_assignment.as_object() {
        let mut stmt_pkg_item = tx.prepare(
            "INSERT INTO picking_package_items (
                audit_id, package_number, order_line, item_code, description, qty_scan
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;

        for (key, val) in obj {
            let (item_code, order_line) = if key.contains(':') {
                let parts: Vec<&str> = key.splitn(2, ':').collect();
                (parts[0].trim().to_uppercase(), parts[1].trim().to_string())
            } else {
                (key.trim().to_uppercase(), "".to_string())
            };

            let item_desc = payload.items.iter()
                .find(|it| it.item_code.trim().to_uppercase() == item_code && (order_line.is_empty() || it.order_line == order_line))
                .map(|it| it.description.clone())
                .unwrap_or_default();

            if let Some(assignments) = val.as_object() {
                for (pkg_str, qty_val) in assignments {
                    let qty = if let Some(n) = qty_val.as_f64() {
                        n
                    } else if let Some(n) = qty_val.as_i64() {
                        n as f64
                    } else if let Some(s) = qty_val.as_str() {
                        s.parse::<f64>().unwrap_or(0.0)
                    } else {
                        0.0
                    };

                    if qty > 0.0 {
                        let pkg_num: i64 = pkg_str.parse().unwrap_or(1);
                        stmt_pkg_item.execute(params![
                            id,
                            pkg_num,
                            order_line,
                            item_code,
                            item_desc,
                            qty,
                        ])?;
                    }
                }
            }
        }
    }

    tx.commit()?;
    Ok(true)
}

// ============================================================================
// 7. DELETE AUDITS (/api/delete_picking_audits)
// ============================================================================

pub fn delete_picking_audits_from_db(conn: &Connection, ids: &[i64]) -> Result<usize> {
    let mut count = 0;
    for id in ids {
        count += conn.execute("DELETE FROM picking_audits WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM picking_audit_items WHERE audit_id = ?1", params![id])?;
        conn.execute("DELETE FROM picking_package_items WHERE audit_id = ?1", params![id])?;
        conn.execute("DELETE FROM picking_packages WHERE audit_id = ?1", params![id])?;
        conn.execute("DELETE FROM shipment_audits WHERE audit_id = ?1", params![id])?;
    }
    Ok(count)
}

// ============================================================================
// 8. PACKING LIST DE UNA AUDITORÍA (/api/picking/packing_list/{audit_id})
// ============================================================================

pub fn get_picking_packing_list_from_db(conn: &Connection, audit_id: i64) -> Result<Option<PickingAuditPackingListDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, order_number, despatch_number, customer_code, customer_name, timestamp, packages
         FROM picking_audits
         WHERE id = ?1",
    )?;

    let header_res = stmt.query_row(params![audit_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "00".to_string()),
            row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "N/A".to_string()),
            row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Cliente General".to_string()),
            row.get::<_, Option<String>>(5)?.unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            row.get::<_, Option<i64>>(6)?.unwrap_or(1),
        ))
    });

    let header = match header_res {
        Ok(h) => h,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e),
    };

    let mut stmt_items = conn.prepare(
        "SELECT package_number, item_code, description, order_line, qty_scan
         FROM picking_package_items
         WHERE audit_id = ?1
         ORDER BY package_number ASC, id ASC",
    )?;

    let items_iter = stmt_items.query_map(params![audit_id], |row| {
        Ok((
            row.get::<_, Option<i64>>(0)?.unwrap_or(1),
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
        ))
    })?;

    let mut packages: HashMap<String, Vec<PackingListItemDetailDto>> = HashMap::new();
    for it in items_iter.flatten() {
        let pkg_key = it.0.to_string();
        packages.entry(pkg_key).or_default().push(PackingListItemDetailDto {
            item_code: it.1,
            description: it.2,
            order_line: it.3,
            qty: it.4,
            quantity: it.4,
        });
    }

    if packages.is_empty() {
        let mut stmt_fallback = conn.prepare(
            "SELECT item_code, description, order_line, qty_scan
             FROM picking_audit_items
             WHERE audit_id = ?1 AND qty_scan > 0",
        )?;
        let fb_iter = stmt_fallback.query_map(params![audit_id], |row| {
            let q: f64 = row.get(3)?;
            Ok(PackingListItemDetailDto {
                item_code: row.get(0)?,
                description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                order_line: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                qty: q,
                quantity: q,
            })
        })?;
        let fb_items: Vec<PackingListItemDetailDto> = fb_iter.flatten().collect();
        if !fb_items.is_empty() {
            packages.insert("1".to_string(), fb_items);
        }
    }

    Ok(Some(PickingAuditPackingListDto {
        audit_id: header.0,
        order_number: header.1,
        despatch_number: header.2,
        customer_code: header.3,
        customer_name: header.4,
        timestamp: header.5,
        total_packages: header.6,
        packages,
    }))
}

// ============================================================================
// 9. SHIPMENTS (/api/shipments/)
// ============================================================================

pub fn create_shipment_in_db(conn: &mut Connection, audit_ids: &[i64], note: Option<String>, carrier: Option<String>, username: Option<String>) -> Result<i64> {
    let tx = conn.transaction()?;

    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let user = username.unwrap_or_else(|| "admin".to_string());

    tx.execute(
        "INSERT INTO shipments (username, note, carrier, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user, note, carrier, "active", created_at],
    )?;
    let shipment_id = tx.last_insert_rowid();

    {
        let mut stmt_link = tx.prepare(
            "INSERT INTO shipment_audits (shipment_id, audit_id) VALUES (?1, ?2)",
        )?;
        for aid in audit_ids {
            stmt_link.execute(params![shipment_id, aid])?;
        }
    }

    tx.commit()?;
    Ok(shipment_id)
}

pub fn list_shipments_from_db(conn: &Connection) -> Result<Vec<ShipmentDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, username, note, carrier, status
         FROM shipments
         ORDER BY id DESC",
    )?;

    let ship_iter = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "admin".to_string()),
            row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "active".to_string()),
        ))
    })?;

    let mut result = Vec::new();
    for s in ship_iter.flatten() {
        let ship_id = s.0;

        let mut stmt_audits = conn.prepare(
            "SELECT a.id, a.order_number, a.despatch_number, a.customer_code, a.customer_name, a.packages
             FROM shipment_audits sa
             JOIN picking_audits a ON sa.audit_id = a.id
             WHERE sa.shipment_id = ?1
             ORDER BY a.id ASC",
        )?;

        let audit_items = stmt_audits.query_map(params![ship_id], |row| {
            Ok(ShipmentAuditSummaryDto {
                audit_id: row.get(0)?,
                order_number: row.get(1)?,
                despatch_number: row.get(2)?,
                customer_code: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "N/A".to_string()),
                customer_name: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Cliente General".to_string()),
                packages: row.get::<_, Option<i64>>(5)?.unwrap_or(1),
            })
        })?;

        let audits: Vec<ShipmentAuditSummaryDto> = audit_items.flatten().collect();

        result.push(ShipmentDto {
            id: ship_id,
            created_at: s.1,
            username: s.2,
            note: s.3,
            carrier: s.4,
            status: s.5,
            total_orders: audits.len(),
            audits,
        });
    }

    Ok(result)
}

pub fn get_consolidated_packing_list_from_db(conn: &Connection, shipment_id: i64) -> Result<Option<ConsolidatedPackingListDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, carrier, note, status
         FROM shipments
         WHERE id = ?1",
    )?;

    let ship_res = stmt.query_row(params![shipment_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "active".to_string()),
        ))
    });

    let ship = match ship_res {
        Ok(s) => s,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e),
    };

    let mut stmt_audits = conn.prepare(
        "SELECT a.id, a.order_number, a.despatch_number, a.customer_code, a.customer_name, a.timestamp, a.packages
         FROM shipment_audits sa
         JOIN picking_audits a ON sa.audit_id = a.id
         WHERE sa.shipment_id = ?1
         ORDER BY a.id ASC",
    )?;

    let audits_iter = stmt_audits.query_map(params![shipment_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "00".to_string()),
            row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "N/A".to_string()),
            row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Cliente General".to_string()),
            row.get::<_, Option<String>>(5)?.unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            row.get::<_, Option<i64>>(6)?.unwrap_or(1),
        ))
    })?;

    let mut orders = Vec::new();
    for a in audits_iter.flatten() {
        let audit_id = a.0;

        let mut stmt_pkg = conn.prepare(
            "SELECT package_number, order_line, item_code, description, qty_scan
             FROM picking_package_items
             WHERE audit_id = ?1
             ORDER BY package_number ASC, id ASC",
        )?;

        let pkg_iter = stmt_pkg.query_map(params![audit_id], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(1),
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
            ))
        })?;

        let mut packages: HashMap<String, Vec<ConsolidatedOrderItemDto>> = HashMap::new();
        for p in pkg_iter.flatten() {
            let pkg_key = p.0.to_string();
            packages.entry(pkg_key).or_default().push(ConsolidatedOrderItemDto {
                order_line: p.1,
                item_code: p.2,
                description: p.3,
                quantity: p.4,
            });
        }

        orders.push(ConsolidatedOrderDto {
            audit_id,
            order_number: a.1,
            despatch_number: a.2,
            customer_code: a.3,
            customer_name: a.4,
            timestamp: a.5,
            total_packages: a.6,
            packages,
        });
    }

    Ok(Some(ConsolidatedPackingListDto {
        shipment_id: ship.0,
        created_at: ship.1,
        carrier: ship.2,
        note: ship.3,
        total_orders: orders.len(),
        orders,
    }))
}

pub fn delete_shipment_in_db(conn: &Connection, shipment_id: i64) -> Result<()> {
    conn.execute("DELETE FROM shipment_audits WHERE shipment_id = ?1", params![shipment_id])?;
    conn.execute("DELETE FROM shipments WHERE id = ?1", params![shipment_id])?;
    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE picking_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shipment_id TEXT DEFAULT '',
                order_number TEXT NOT NULL,
                despatch_number TEXT NOT NULL DEFAULT '00',
                customer_code TEXT,
                customer_name TEXT,
                carrier TEXT,
                order_line TEXT DEFAULT '1',
                item_code TEXT NOT NULL,
                item_description TEXT,
                requested_qty REAL DEFAULT 0.0,
                picked_qty REAL DEFAULT 0.0,
                print_date TEXT,
                time_zone_hours TEXT,
                status TEXT DEFAULT 'PP',
                timestamp TEXT NOT NULL
            );
            CREATE TABLE picking_audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT NOT NULL,
                despatch_number TEXT NOT NULL DEFAULT '00',
                customer_code TEXT,
                customer_name TEXT,
                username TEXT NOT NULL DEFAULT 'admin',
                timestamp TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Completo',
                packages INTEGER DEFAULT 1,
                shipment_id TEXT DEFAULT ''
            );
            CREATE TABLE picking_audit_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id INTEGER NOT NULL,
                item_code TEXT NOT NULL,
                description TEXT,
                order_line TEXT DEFAULT '',
                qty_req REAL DEFAULT 0.0,
                qty_scan REAL DEFAULT 0.0,
                difference REAL DEFAULT 0.0,
                edited INTEGER DEFAULT 0
            );
            CREATE TABLE picking_package_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id INTEGER NOT NULL,
                package_number INTEGER NOT NULL,
                order_line TEXT DEFAULT '',
                item_code TEXT NOT NULL,
                description TEXT,
                qty_scan REAL DEFAULT 0.0
            );
            CREATE TABLE picking_packages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id INTEGER NOT NULL,
                package_number INTEGER NOT NULL,
                length REAL DEFAULT 0.0,
                width REAL DEFAULT 0.0,
                height REAL DEFAULT 0.0,
                weight REAL DEFAULT 0.0
            );
            CREATE TABLE shipments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                note TEXT,
                carrier TEXT,
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL
            );
            CREATE TABLE shipment_audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shipment_id INTEGER NOT NULL,
                audit_id INTEGER NOT NULL
            );"
        ).unwrap();
        conn
    }

    #[test]
    fn test_save_and_get_picking_audit() {
        let mut conn = setup_test_db();

        let input = PickingAuditFullInput {
            id: None,
            order_number: "0046907".to_string(),
            despatch_number: Some("00".to_string()),
            customer_code: Some("00034".to_string()),
            customer_name: Some("MINERA EL ROBLE".to_string()),
            username: Some("operador1".to_string()),
            timestamp: Some("2026-08-16 12:00:00".to_string()),
            status: Some("Completo".to_string()),
            packages: Some(1),
            items: vec![AuditItemInput {
                id: None,
                item_code: "SKU100".to_string(),
                description: "BEARING BUSHING".to_string(),
                order_line: "1".to_string(),
                qty_req: 2.0,
                qty_scan: 2.0,
                difference: Some(0.0),
                edited: Some(0),
            }],
            packages_assignment: serde_json::json!({ "SKU100:1": { "1": 2 } }),
            packages_dimensions: vec![PackageDimensionInput {
                package_number: 1,
                length: 20.0,
                width: 15.0,
                height: 10.0,
                weight: 2.5,
            }],
        };

        let audit_id = save_picking_audit_full_to_db(&mut conn, input).unwrap();
        assert_eq!(audit_id, 1);

        let audits = get_picking_audits_full_from_db(&conn).unwrap();
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].order_number, "0046907");
        assert_eq!(audits[0].items.len(), 1);
        assert_eq!(audits[0].packages_dimensions.len(), 1);

        let packing_list = get_picking_packing_list_from_db(&conn, audit_id).unwrap().unwrap();
        assert_eq!(packing_list.order_number, "0046907");
        assert_eq!(packing_list.packages.get("1").unwrap().len(), 1);
    }

    #[test]
    fn test_create_and_list_shipments() {
        let mut conn = setup_test_db();

        let input = PickingAuditFullInput {
            id: None,
            order_number: "0046907".to_string(),
            despatch_number: Some("00".to_string()),
            customer_code: Some("00034".to_string()),
            customer_name: Some("MINERA EL ROBLE".to_string()),
            username: Some("operador1".to_string()),
            timestamp: Some("2026-08-16 12:00:00".to_string()),
            status: Some("Completo".to_string()),
            packages: Some(1),
            items: vec![],
            packages_assignment: serde_json::json!({}),
            packages_dimensions: vec![],
        };
        let audit_id = save_picking_audit_full_to_db(&mut conn, input).unwrap();

        let ship_id = create_shipment_in_db(&mut conn, &[audit_id], Some("Nota de envío".to_string()), Some("Servientrega".to_string()), Some("admin".to_string())).unwrap();
        assert_eq!(ship_id, 1);

        let shipments = list_shipments_from_db(&conn).unwrap();
        assert_eq!(shipments.len(), 1);
        assert_eq!(shipments[0].carrier, "Servientrega");
        assert_eq!(shipments[0].total_orders, 1);

        let packing_list = get_consolidated_packing_list_from_db(&conn, ship_id).unwrap().unwrap();
        assert_eq!(packing_list.carrier, "Servientrega");
        assert_eq!(packing_list.total_orders, 1);
    }

    #[test]
    fn test_import_picking_orders_bulk_replaces_existing() {
        let mut conn = setup_test_db();

        let batch1 = vec![
            PickingOrderImportRow {
                shipment_id: None,
                order_number: "001".to_string(),
                despatch_number: Some("00".to_string()),
                customer_code: Some("C1".to_string()),
                customer_name: Some("Cliente 1".to_string()),
                carrier: None,
                order_line: Some("1".to_string()),
                item_code: "ITEM-A".to_string(),
                item_description: Some("Item A".to_string()),
                requested_qty: 10.0,
                picked_qty: Some(0.0),
                print_date: Some("2026-08-16".to_string()),
                time_zone_hours: Some("-05:00".to_string()),
                status: Some("PP".to_string()),
                timestamp: None,
            },
        ];

        let count1 = import_picking_orders_bulk_db(&mut conn, &batch1).unwrap();
        assert_eq!(count1, 1);

        let tracking1 = get_picking_tracking_from_db(&conn).unwrap();
        assert_eq!(tracking1.len(), 1);
        assert_eq!(tracking1[0].order_number, "001");

        let batch2 = vec![
            PickingOrderImportRow {
                shipment_id: None,
                order_number: "002".to_string(),
                despatch_number: Some("00".to_string()),
                customer_code: Some("C2".to_string()),
                customer_name: Some("Cliente 2".to_string()),
                carrier: None,
                order_line: Some("1".to_string()),
                item_code: "ITEM-B".to_string(),
                item_description: Some("Item B".to_string()),
                requested_qty: 5.0,
                picked_qty: Some(0.0),
                print_date: Some("2026-08-16".to_string()),
                time_zone_hours: Some("-05:00".to_string()),
                status: Some("PP".to_string()),
                timestamp: None,
            },
        ];

        let count2 = import_picking_orders_bulk_db(&mut conn, &batch2).unwrap();
        assert_eq!(count2, 1);

        let tracking2 = get_picking_tracking_from_db(&conn).unwrap();
        assert_eq!(tracking2.len(), 1);
        assert_eq!(tracking2[0].order_number, "002");
    }
}
