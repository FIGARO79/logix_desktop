use chrono::Local;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogInbound {
    pub id: Option<i64>,
    pub timestamp: String,
    pub import_reference: String,
    pub waybill: Option<String>,
    pub item_code: String,
    pub item_description: Option<String>,
    pub bin_location: Option<String>,
    pub relocated_bin: Option<String>,
    pub qty_received: f64,
    pub qty_grn: f64,
    pub difference: f64,
    pub username: Option<String>,
    pub client_id: Option<String>,
    pub archived_at: Option<String>,
    pub version_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpectedBreakdown {
    pub ir: String,
    pub grn: String,
    pub qty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundItemFinderResult {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub additional_bins: String,
    pub weight: f64,
    pub item_type: String,
    pub sic_code: String,
    pub default_qty_grn: f64,
    pub xdock_total: f64,
    pub xdock_pending: f64,
    pub xdock_customers: Vec<String>,
    pub expected_breakdown: Vec<ExpectedBreakdown>,
    pub suggested_bin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundAlert {
    pub id: i64,
    pub alert_type: String,
    pub import_reference: String,
    pub item_code: String,
    pub message: String,
    pub severity: String,
    pub resolved: bool,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrReconciliation {
    pub id: String,
    pub import_reference: String,
    pub waybill: Option<String>,
    pub item_code: Option<String>,
    pub item_description: Option<String>,
    pub expected_qty: f64,
    pub received_qty: f64,
    pub diff_qty: f64,
    pub status: String,
    pub user_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedGRNReconciliationItemPayload {
    pub grn_number: String,
    pub import_reference: String,
    pub waybill: Option<String>,
    pub order_line: Option<String>,
    pub item_code: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub relocated_bin: Option<String>,
    pub qty_expected: f64,
    pub qty_received: f64,
    pub difference: f64,
    pub difference_reason: Option<String>,
    pub operator_comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveGRNReconciliationPayload {
    pub grn_number: String,
    pub import_reference: String,
    pub waybill: Option<String>,
    pub items: Vec<SavedGRNReconciliationItemPayload>,
    pub username: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedGRNReconciliationHeader {
    pub id: i64,
    pub grn_number: String,
    pub import_reference: String,
    pub waybill: String,
    pub total_lines: i64,
    pub total_expected: f64,
    pub total_received: f64,
    pub total_difference: f64,
    pub status: String,
    pub reconciled_by: String,
    pub reconciled_at: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedGRNReconciliationItemRow {
    pub id: i64,
    pub reconciliation_id: i64,
    pub grn_number: String,
    pub import_reference: String,
    pub waybill: String,
    pub order_line: String,
    pub item_code: String,
    pub description: String,
    pub location: String,
    pub relocated_bin: String,
    pub qty_expected: f64,
    pub qty_received: f64,
    pub difference: f64,
    pub difference_reason: String,
    pub operator_comment: String,
    pub reconciled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedGRNReconciliationDetail {
    pub header: SavedGRNReconciliationHeader,
    pub items: Vec<SavedGRNReconciliationItemRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundIrStatsExpectedItem {
    pub item_code: String,
    pub total_expected: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundIrStatsPoItem {
    pub item_code: String,
    pub qty: f64,
    pub grn: String,
    pub customer_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundIrStatsResponse {
    pub source: String, // "280" | "po_extractor" | "none"
    pub expected_items: Vec<InboundIrStatsExpectedItem>,
    pub po_items: Vec<InboundIrStatsPoItem>,
    pub associated_grns: Vec<String>,
    pub grn_detail_expected: HashMap<String, HashMap<String, f64>>,
    pub waybill: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundExpectedQueryItem {
    pub item_code: String,
    pub import_ref: String,
}

pub fn strip_ir_prefix(s: &str) -> &str {
    let t = s.trim();
    if t.starts_with("IR-") || t.starts_with("IR_") || t.starts_with("IR ") {
        &t[3..]
    } else if t.starts_with("IR") || t.starts_with("ir") {
        &t[2..]
    } else if t.starts_with("REF-") || t.starts_with("PO-") || t.starts_with("ref-") || t.starts_with("po-") {
        &t[4..]
    } else {
        t
    }
}

pub fn match_ref_rust(val1: &str, val2: &str) -> bool {
    let s1 = val1.trim().to_uppercase();
    let s2 = val2.trim().to_uppercase();
    if s1.is_empty() || s2.is_empty() {
        return false;
    }
    if s1 == s2 {
        return true;
    }
    let p1 = strip_ir_prefix(&s1);
    let p2 = strip_ir_prefix(&s2);
    let c1: String = p1.chars().filter(|c| c.is_alphanumeric()).collect();
    let c2: String = p2.chars().filter(|c| c.is_alphanumeric()).collect();
    if !c1.is_empty() && c1 == c2 {
        return true;
    }
    let norm_parts = |s: &str| -> String {
        s.split(|c: char| !c.is_alphanumeric())
            .map(|p| p.trim_start_matches('0'))
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join("-")
    };
    let n1 = norm_parts(p1);
    let n2 = norm_parts(p2);
    !n1.is_empty() && n1 == n2
}

/// Obtiene todos los logs no archivados (o filtrados por fecha de versión)
pub fn get_logs_from_db(conn: &Connection, version_date: Option<String>) -> Result<Vec<LogInbound>> {
    let sql = if let Some(vd) = version_date {
        format!(
            "SELECT id, timestamp, import_reference, waybill, item_code, item_description,
                    bin_location, relocated_bin, qty_received, qty_grn, difference, username,
                    client_id, archived_at, version_date
             FROM inbound_logs
             WHERE (archived_at IS NULL OR archived_at = '')
               AND (version_date LIKE '{}%' OR timestamp LIKE '{}%')
             ORDER BY id DESC",
            vd, vd
        )
    } else {
        "SELECT id, timestamp, import_reference, waybill, item_code, item_description,
                bin_location, relocated_bin, qty_received, qty_grn, difference, username,
                client_id, archived_at, version_date
         FROM inbound_logs
         WHERE (archived_at IS NULL OR archived_at = '')
         ORDER BY id DESC".to_string()
    };

    let mut stmt = conn.prepare(&sql)?;
    let log_iter = stmt.query_map([], |row| {
        Ok(LogInbound {
            id: Some(row.get(0)?),
            timestamp: row.get(1)?,
            import_reference: row.get(2)?,
            waybill: row.get(3)?,
            item_code: row.get(4)?,
            item_description: row.get(5)?,
            bin_location: row.get(6)?,
            relocated_bin: row.get(7)?,
            qty_received: row.get(8)?,
            qty_grn: row.get(9)?,
            difference: row.get(10)?,
            username: row.get(11)?,
            client_id: row.get(12)?,
            archived_at: row.get(13)?,
            version_date: row.get(14)?,
        })
    })?;

    let logs: Vec<LogInbound> = log_iter.flatten().collect();
    Ok(logs)
}

/// Guarda un log de recepción con cálculo de diferencias y validaciones automáticas
pub fn save_log_to_db(
    conn: &Connection,
    mut entry: LogInbound,
    po_json_path: &str,
    grn_json_path: &str,
) -> Result<LogInbound> {
    let now = Local::now();
    let current_timestamp = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let current_date = now.format("%Y-%m-%d").to_string();

    if entry.timestamp.trim().is_empty() {
        entry.timestamp = current_timestamp.clone();
    }
    if entry.version_date.is_none() || entry.version_date.as_ref().unwrap().trim().is_empty() {
        entry.version_date = Some(current_date);
    }

    let code_clean = entry.item_code.trim().to_uppercase();
    entry.item_code = code_clean.clone();

    // 1. Completar datos de maestro si están vacíos
    if entry.item_description.is_none() || entry.bin_location.is_none() {
        let mut stmt_master = conn.prepare(
            "SELECT description, bin_location FROM inventory_items WHERE UPPER(item_code) = ?1",
        )?;
        let master_info = stmt_master
            .query_row(params![code_clean], |row| {
                let desc: Option<String> = row.get(0).ok();
                let bin: Option<String> = row.get(1).ok();
                Ok((desc, bin))
            })
            .ok();

        if let Some((d, b)) = master_info {
            if entry.item_description.is_none() || entry.item_description.as_ref().unwrap().is_empty() {
                entry.item_description = d;
            }
            if entry.bin_location.is_none() || entry.bin_location.as_ref().unwrap().is_empty() {
                entry.bin_location = b;
            }
        }
    }

    // 2. Si qty_grn viene en 0, intentar calcular desde los archivos JSON
    if entry.qty_grn <= 0.0 {
        let finder = find_item_inbound(
            conn,
            &code_clean,
            Some(&entry.import_reference),
            po_json_path,
            grn_json_path,
        ).ok();
        if let Some(f) = finder {
            entry.qty_grn = f.default_qty_grn;
        }
    }

    // 3. Diferencia = Recibida - Esperada GRN
    entry.difference = entry.qty_received - entry.qty_grn;

    // 4. Si viene client_id, comprobar idempotencia
    if let Some(ref cid) = entry.client_id {
        if !cid.trim().is_empty() {
            let mut check_stmt = conn.prepare("SELECT id FROM inbound_logs WHERE client_id = ?1")?;
            let existing_id: Option<i64> = check_stmt
                .query_row(params![cid], |r| r.get(0))
                .ok();
            if let Some(eid) = existing_id {
                entry.id = Some(eid);
                return Ok(entry);
            }
        }
    }

    // 4. Si viene id existente, actualizar en lugar de insertar
    if let Some(existing_id) = entry.id {
        if existing_id > 0 {
            conn.execute(
                "UPDATE inbound_logs SET
                    import_reference = ?1,
                    waybill = ?2,
                    item_code = ?3,
                    item_description = ?4,
                    bin_location = ?5,
                    relocated_bin = ?6,
                    qty_received = ?7,
                    qty_grn = ?8,
                    difference = ?9
                 WHERE id = ?10",
                params![
                    entry.import_reference.trim().to_uppercase(),
                    entry.waybill.as_ref().map(|s| s.trim().to_uppercase()),
                    entry.item_code,
                    entry.item_description,
                    entry.bin_location,
                    entry.relocated_bin,
                    entry.qty_received,
                    entry.qty_grn,
                    entry.difference,
                    existing_id,
                ],
            )?;
            return Ok(entry);
        }
    }

    // 5. Inserción en SQLite
    conn.execute(
        "INSERT INTO inbound_logs (
            timestamp, import_reference, waybill, item_code, item_description,
            bin_location, relocated_bin, qty_received, qty_grn, difference,
            username, client_id, archived_at, version_date
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            entry.timestamp,
            entry.import_reference.trim().to_uppercase(),
            entry.waybill.as_ref().map(|s| s.trim().to_uppercase()),
            entry.item_code,
            entry.item_description,
            entry.bin_location,
            entry.relocated_bin,
            entry.qty_received,
            entry.qty_grn,
            entry.difference,
            entry.username,
            entry.client_id,
            entry.archived_at,
            entry.version_date,
        ],
    )?;

    let inserted_id = conn.last_insert_rowid();
    entry.id = Some(inserted_id);

    // 6. Auditoría automática: si hay diferencia significativa, registrar alerta
    if entry.difference.abs() > 0.001 {
        let msg = format!(
            "Diferencia detectada en SKU {}: Recibido={}, Esperado={}, Dif={}",
            entry.item_code, entry.qty_received, entry.qty_grn, entry.difference
        );
        let _ = conn.execute(
            "INSERT INTO inbound_alerts (alert_type, import_reference, item_code, message, severity, resolved, timestamp)
             VALUES ('qty_discrepancy', ?1, ?2, ?3, 'warning', 0, ?4)",
            params![entry.import_reference, entry.item_code, msg, current_timestamp],
        );
    }

    invalidate_inbound_reconciliation_cache();
    Ok(entry)
}

/// Elimina un log
pub fn delete_log_from_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM inbound_logs WHERE id = ?1", params![id])?;
    invalidate_inbound_reconciliation_cache();
    Ok(())
}

/// Archiva todos los logs activos
pub fn archive_logs_in_db(conn: &Connection) -> Result<usize> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let rows = conn.execute(
        "UPDATE inbound_logs SET archived_at = ?1 WHERE archived_at IS NULL OR archived_at = ''",
        params![now],
    )?;
    invalidate_inbound_reconciliation_cache();
    Ok(rows)
}

/// Obtiene las distintas fechas de versión disponibles
pub fn get_versions_from_db(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT version_date FROM inbound_logs WHERE version_date IS NOT NULL AND version_date != '' ORDER BY version_date DESC",
    )?;
    let iter = stmt.query_map([], |row| row.get(0))?;
    let versions: Vec<String> = iter.flatten().collect();
    Ok(versions)
}

/// Búsqueda inteligente de ítem en recepción (Item Master + GRN Master + PO Lookup + XDock)
pub fn find_item_inbound(
    conn: &Connection,
    item_code: &str,
    import_ref: Option<&str>,
    po_json_path: &str,
    grn_json_path: &str,
) -> Result<InboundItemFinderResult> {
    let code_clean = item_code.trim().to_uppercase();
    let ir_clean = import_ref.unwrap_or("").trim().to_uppercase();

    // 1. Maestro de inventario desde SQLite
    let mut stmt = conn.prepare(
        "SELECT item_code, description, bin_location, additional_bins, weight_per_unit, sic_code, abc_code 
         FROM inventory_items 
         WHERE UPPER(item_code) = ?1",
    )?;

    let mut master_item = stmt
        .query_row(params![code_clean], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "0".to_string()),
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            ))
        })
        .ok();

    // Fallback: búsqueda sin caracteres especiales
    if master_item.is_none() {
        let alphanumeric_code: String = code_clean.chars().filter(|c| c.is_alphanumeric()).collect();
        if !alphanumeric_code.is_empty() {
            let mut stmt_all = conn.prepare("SELECT item_code, description, bin_location, additional_bins, weight_per_unit, sic_code, abc_code FROM inventory_items")?;
            let iter = stmt_all.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "0".to_string()),
                    row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ))
            })?;
            for item in iter.flatten() {
                let clean_db: String = item.0.chars().filter(|c| c.is_alphanumeric()).collect();
                if clean_db.to_uppercase() == alphanumeric_code {
                    master_item = Some(item);
                    break;
                }
            }
        }
    }

    let (found_code, description, bin_location, additional_bins, weight, sic_code, item_type) = master_item
        .unwrap_or_else(|| (code_clean.clone(), "Ítem no catalogado".to_string(), "N/A".to_string(), "".to_string(), 0.0, "0".to_string(), "".to_string()));

    // 2. Extraer Expected Breakdown y Default GRN Qty desde JSONs
    // 2. Extraer Expected Breakdown y Default GRN Qty
    // REGLA DE NEGOCIO: La cantidad esperada DEBE tomarse prioritariamente del Reporte 280 (grn_master_data.json)
    // y solo recurrir a po_lookup.json como fallback secundario si no existen registros en el 280.
    let mut expected_breakdown = Vec::new();
    let mut default_qty_grn = 0.0;
    let mut xdock_total = 0.0;
    let mut xdock_customers = Vec::new();

    let ir_stripped = ir_clean
        .trim_start_matches("IR-")
        .trim_start_matches("IR_")
        .trim_start_matches("IR ")
        .trim_start_matches("IR")
        .trim();
    let clean_ir_alphanumeric: String = ir_clean.chars().filter(|c| c.is_alphanumeric()).collect();
    let clean_ir_stripped_alphanumeric: String = ir_stripped.chars().filter(|c| c.is_alphanumeric()).collect();

    let mut associated_grns: HashSet<String> = HashSet::new();
    let mut po_fallback_qty = 0.0;
    let mut po_fallback_breakdown: Vec<ExpectedBreakdown> = Vec::new();

    // Lectura de po_lookup.json para:
    // a) Extraer los números de GRN asociados a esta Import Reference
    // b) Preparar la cantidad esperada de PO como fallback secundario
    // c) Cargar reservas XDock
    if let Ok(po_data) = std::fs::read_to_string(po_json_path) {
        if let Ok(po_json) = serde_json::from_str::<Value>(&po_data) {
            // Revisar por IR en ir_to_data
            if !ir_clean.is_empty() {
                if let Some(ir_map) = po_json.get("ir_to_data").and_then(|v| v.as_object()) {
                    for (ir_key, ir_obj) in ir_map {
                        let k_upper = ir_key.trim().to_uppercase();
                        let k_stripped = k_upper
                            .trim_start_matches("IR-")
                            .trim_start_matches("IR_")
                            .trim_start_matches("IR ")
                            .trim_start_matches("IR")
                            .trim();
                        let k_clean: String = k_upper.chars().filter(|c| c.is_alphanumeric()).collect();
                        let k_stripped_clean: String = k_stripped.chars().filter(|c| c.is_alphanumeric()).collect();

                        let is_match = k_upper == ir_clean
                            || (!ir_stripped.is_empty() && k_stripped == ir_stripped)
                            || (!clean_ir_alphanumeric.is_empty() && k_clean == clean_ir_alphanumeric)
                            || (!clean_ir_stripped_alphanumeric.is_empty() && k_stripped_clean == clean_ir_stripped_alphanumeric);

                        if is_match {
                            if let Some(items) = ir_obj.get("items").and_then(|v| v.as_array()) {
                                for it in items {
                                    if let Some(grn_val) = it.get("grn").and_then(|v| v.as_str()) {
                                        for g in grn_val.split(',') {
                                            let g_clean = g.trim().to_uppercase();
                                            if !g_clean.is_empty() && g_clean != "N/A" && g_clean != "SIN GRN" {
                                                associated_grns.insert(g_clean);
                                            }
                                        }
                                    }

                                    let c = it.get("item_code").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                                    if c == code_clean || c == found_code {
                                        let q = it.get("qty").and_then(|v| v.as_f64()).or_else(|| it.get("qty").and_then(|v| v.as_str()).and_then(|s| s.parse().ok())).unwrap_or(0.0);
                                        let grn = it.get("grn").and_then(|v| v.as_str()).unwrap_or("N/A").to_string();
                                        po_fallback_qty += q;
                                        po_fallback_breakdown.push(ExpectedBreakdown {
                                            ir: ir_key.clone(),
                                            grn,
                                            qty: q,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                // Revisar también en wb_to_data por si la IR coincide
                if let Some(wb_map) = po_json.get("wb_to_data").and_then(|v| v.as_object()) {
                    for (_wb_key, wb_obj) in wb_map {
                        let obj_ir = wb_obj.get("import_ref").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                        let obj_ir_stripped = obj_ir
                            .trim_start_matches("IR-")
                            .trim_start_matches("IR_")
                            .trim_start_matches("IR ")
                            .trim_start_matches("IR")
                            .trim();
                        let obj_ir_clean: String = obj_ir.chars().filter(|c| c.is_alphanumeric()).collect();

                        let is_match = obj_ir == ir_clean
                            || (!ir_stripped.is_empty() && obj_ir_stripped == ir_stripped)
                            || (!clean_ir_alphanumeric.is_empty() && obj_ir_clean == clean_ir_alphanumeric);

                        if is_match {
                            if let Some(items) = wb_obj.get("items").and_then(|v| v.as_array()) {
                                for it in items {
                                    if let Some(grn_val) = it.get("grn").and_then(|v| v.as_str()) {
                                        for g in grn_val.split(',') {
                                            let g_clean = g.trim().to_uppercase();
                                            if !g_clean.is_empty() && g_clean != "N/A" && g_clean != "SIN GRN" {
                                                associated_grns.insert(g_clean);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Revisar XDock Reservations en po_lookup.json
            if let Some(xdock_map) = po_json.get("xdock_reservations").and_then(|v| v.as_object()) {
                if let Some(x_obj) = xdock_map.get(&found_code).or_else(|| xdock_map.get(&code_clean)) {
                    if let Some(t) = x_obj.get("total").and_then(|v| v.as_f64()).or_else(|| x_obj.get("reserved_qty").and_then(|v| v.as_f64())) {
                        xdock_total = t;
                    }
                    if let Some(custs) = x_obj.get("customers").and_then(|v| v.as_array()) {
                        for c in custs {
                            if let Some(cs) = c.as_str() {
                                xdock_customers.push(cs.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // Revisar xdock_reservations.json dedicado
    let xdock_path = std::path::Path::new(po_json_path).parent().map(|p| p.join("xdock_reservations.json")).unwrap_or_else(|| std::path::PathBuf::from("./data/xdock_reservations.json"));
    if let Ok(xdock_data) = std::fs::read_to_string(&xdock_path) {
        if let Ok(xdock_json) = serde_json::from_str::<Value>(&xdock_data) {
            if let Some(xdock_map) = xdock_json.as_object() {
                if let Some(x_obj) = xdock_map.get(&found_code).or_else(|| xdock_map.get(&code_clean)) {
                    if let Some(t) = x_obj.get("total").and_then(|v| v.as_f64()).or_else(|| x_obj.get("reserved_qty").and_then(|v| v.as_f64())) {
                        xdock_total = t;
                    }
                    if let Some(custs) = x_obj.get("customers").and_then(|v| v.as_array()) {
                        for c in custs {
                            if let Some(cs) = c.as_str() {
                                let s = cs.to_string();
                                if !xdock_customers.contains(&s) {
                                    xdock_customers.push(s);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // PRIORIDAD 1: Buscar cantidad en el Reporte 280 (grn_master_data.json)
    // El 280 representa las cantidades recepcionadas/confirmadas en GRN por planta
    if !ir_clean.is_empty() {
        if let Ok(grn_data) = std::fs::read_to_string(grn_json_path) {
            if let Ok(grn_json) = serde_json::from_str::<Value>(&grn_data) {
                if let Some(arr) = grn_json.as_array() {
                    for row in arr {
                        let r_item = row.get("Item_Code").or_else(|| row.get("item_code")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                        if r_item == code_clean || r_item == found_code {
                            let grn = row.get("GRN_Number").or_else(|| row.get("grn_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                            let r_ir = row.get("Import_Reference").or_else(|| row.get("import_reference")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();

                            let mut matches_grn = false;
                            if !grn.is_empty() && associated_grns.contains(&grn) {
                                matches_grn = true;
                            } else if !r_ir.is_empty() {
                                let r_ir_stripped = r_ir
                                    .trim_start_matches("IR-")
                                    .trim_start_matches("IR_")
                                    .trim_start_matches("IR ")
                                    .trim_start_matches("IR")
                                    .trim();
                                if r_ir == ir_clean || (!ir_stripped.is_empty() && r_ir_stripped == ir_stripped) {
                                    matches_grn = true;
                                }
                            }

                            if matches_grn {
                                let q = row.get("Quantity").or_else(|| row.get("quantity")).and_then(|v| v.as_f64()).unwrap_or(0.0);
                                default_qty_grn += q;
                                expected_breakdown.push(ExpectedBreakdown {
                                    ir: if !r_ir.is_empty() { r_ir } else { ir_clean.clone() },
                                    grn: if !grn.is_empty() { grn } else { "N/A".to_string() },
                                    qty: q,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // PRIORIDAD 2 (FALLBACK): Solo si el ítem NO se encuentra en la GRN (280),
    // usar las cantidades esperadas provenientes de po_lookup.json
    if default_qty_grn <= 0.0 && po_fallback_qty > 0.0 {
        default_qty_grn = po_fallback_qty;
        expected_breakdown = po_fallback_breakdown;
    }

    // 3. Cantidad recibida acumulada en SQLite para calcular xdock_pending
    let mut stmt_accum = conn.prepare(
        "SELECT SUM(qty_received) FROM inbound_logs WHERE UPPER(item_code) = ?1 AND UPPER(import_reference) = ?2",
    )?;
    let cumulative_received: f64 = stmt_accum
        .query_row(params![found_code, ir_clean], |row| row.get(0))
        .unwrap_or(0.0);

    let xdock_pending = (xdock_total - cumulative_received).max(0.0);

    // 4. Calcular sugerencia de slotting si el ítem no tiene ubicación asignada o si es N/A
    let mut suggested_bin = None;
    let current_bin_clean = bin_location.trim().to_uppercase();
    let is_missing_bin = current_bin_clean.is_empty()
        || current_bin_clean == "N/A"
        || current_bin_clean == "SIN UBICACION"
        || current_bin_clean == "NONE"
        || current_bin_clean == "0"
        || current_bin_clean == "-";

    if is_missing_bin {
        let slotting_path = std::path::Path::new(po_json_path)
            .parent()
            .map(|p| p.join("slotting_parameters.json"))
            .unwrap_or_else(|| std::path::PathBuf::from("./data/slotting_parameters.json"));

        suggested_bin = crate::slotting::calculate_suggested_bin(
            conn,
            slotting_path.to_str().unwrap_or("./data/slotting_parameters.json"),
            &found_code,
            &description,
            &bin_location,
            weight,
            &sic_code,
        );
    }

    Ok(InboundItemFinderResult {
        item_code: found_code,
        description,
        bin_location,
        additional_bins,
        weight,
        item_type,
        sic_code,
        default_qty_grn,
        xdock_total,
        xdock_pending,
        xdock_customers,
        expected_breakdown,
        suggested_bin,
    })
}

/// Obtiene alertas de inbound
pub fn get_alerts_from_db(conn: &Connection) -> Result<Vec<InboundAlert>> {
    let mut stmt = conn.prepare(
        "SELECT id, alert_type, import_reference, item_code, message, severity, resolved, timestamp
         FROM inbound_alerts
         WHERE resolved = 0
         ORDER BY id DESC",
    )?;

    let iter = stmt.query_map([], |row| {
        let resolved_int: i32 = row.get(6)?;
        Ok(InboundAlert {
            id: row.get(0)?,
            alert_type: row.get(1)?,
            import_reference: row.get(2)?,
            item_code: row.get(3)?,
            message: row.get(4)?,
            severity: row.get(5)?,
            resolved: resolved_int != 0,
            timestamp: row.get(7)?,
        })
    })?;

    let alerts: Vec<InboundAlert> = iter.flatten().collect();
    Ok(alerts)
}

/// Borra o marca resueltas todas las alertas
pub fn clear_alerts_in_db(conn: &Connection) -> Result<usize> {
    let rows = conn.execute("DELETE FROM inbound_alerts", [])?;
    Ok(rows)
}

/// Resuelve una alerta específica
pub fn resolve_alert_in_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE inbound_alerts SET resolved = 1 WHERE id = ?1", params![id])?;
    Ok(())
}

/// Obtiene registros de reconciliación IR
pub fn get_ir_reconciliations_from_db(conn: &Connection) -> Result<Vec<IrReconciliation>> {
    let mut stmt = conn.prepare(
        "SELECT id, import_reference, waybill, item_code, item_description, expected_qty, received_qty, diff_qty, status, user_id, timestamp
         FROM ir_reconciliations
         ORDER BY timestamp DESC",
    )?;

    let iter = stmt.query_map([], |row| {
        Ok(IrReconciliation {
            id: row.get(0)?,
            import_reference: row.get(1)?,
            waybill: row.get(2)?,
            item_code: row.get(3)?,
            item_description: row.get(4)?,
            expected_qty: row.get(5)?,
            received_qty: row.get(6)?,
            diff_qty: row.get(7)?,
            status: row.get(8)?,
            user_id: row.get(9)?,
            timestamp: row.get(10)?,
        })
    })?;

    let mut records = Vec::new();
    for rec in iter.flatten() {
        records.push(rec);
    }
    Ok(records)
}

/// Guarda o actualiza un registro de reconciliación IR
pub fn save_ir_reconciliation_to_db(conn: &Connection, rec: IrReconciliation) -> Result<IrReconciliation> {
    conn.execute(
        "INSERT INTO ir_reconciliations (id, import_reference, waybill, item_code, item_description, expected_qty, received_qty, diff_qty, status, user_id, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
            import_reference = excluded.import_reference,
            waybill = excluded.waybill,
            item_code = excluded.item_code,
            item_description = excluded.item_description,
            expected_qty = excluded.expected_qty,
            received_qty = excluded.received_qty,
            diff_qty = excluded.diff_qty,
            status = excluded.status,
            user_id = excluded.user_id,
            timestamp = excluded.timestamp;",
        params![
            rec.id,
            rec.import_reference,
            rec.waybill,
            rec.item_code,
            rec.item_description,
            rec.expected_qty,
            rec.received_qty,
            rec.diff_qty,
            rec.status,
            rec.user_id,
            rec.timestamp,
        ],
    )?;
    Ok(rec)
}

/// Elimina un registro de reconciliación IR
pub fn delete_ir_reconciliation_from_db(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM ir_reconciliations WHERE id = ?1", params![id])?;
    Ok(())
}

/// Guarda una instantánea permanente de la conciliación de una GRN en SQLite
pub fn save_grn_reconciliation_snapshot_in_db(
    conn: &mut Connection,
    payload: SaveGRNReconciliationPayload,
) -> Result<i64> {
    let now_ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let total_lines = payload.items.len() as i64;
    let mut total_expected = 0.0;
    let mut total_received = 0.0;
    let mut total_difference = 0.0;
    let mut has_diff = false;

    for item in &payload.items {
        total_expected += item.qty_expected;
        total_received += item.qty_received;
        total_difference += item.difference;
        if item.difference.abs() > 0.0001 {
            has_diff = true;
        }
    }

    let status = if has_diff {
        "CON_DIFERENCIAS".to_string()
    } else {
        "CONCILIADO_OK".to_string()
    };

    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO saved_grn_reconciliations (
            grn_number, import_reference, waybill, total_lines, total_expected,
            total_received, total_difference, status, reconciled_by, reconciled_at, notes
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            payload.grn_number.trim().to_uppercase(),
            payload.import_reference.trim().to_uppercase(),
            payload.waybill.as_deref().unwrap_or("").trim().to_uppercase(),
            total_lines,
            total_expected,
            total_received,
            total_difference,
            status,
            payload.username.trim(),
            now_ts,
            payload.notes.as_deref().unwrap_or("").trim(),
        ],
    )?;

    let recon_id = tx.last_insert_rowid();

    for item in payload.items {
        tx.execute(
            "INSERT INTO saved_grn_reconciliation_items (
                reconciliation_id, grn_number, import_reference, waybill, order_line,
                item_code, description, location, relocated_bin, qty_expected,
                qty_received, difference, difference_reason, operator_comment, reconciled_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                recon_id,
                item.grn_number.trim().to_uppercase(),
                item.import_reference.trim().to_uppercase(),
                item.waybill.as_deref().unwrap_or("").trim().to_uppercase(),
                item.order_line.as_deref().unwrap_or("").trim(),
                item.item_code.trim().to_uppercase(),
                item.description.as_deref().unwrap_or("").trim(),
                item.location.as_deref().unwrap_or("").trim(),
                item.relocated_bin.as_deref().unwrap_or("").trim(),
                item.qty_expected,
                item.qty_received,
                item.difference,
                item.difference_reason.as_deref().unwrap_or("").trim(),
                item.operator_comment.as_deref().unwrap_or("").trim(),
                now_ts,
            ],
        )?;
    }

    tx.commit()?;
    invalidate_inbound_reconciliation_cache();
    Ok(recon_id)
}

/// UPSERT: Guarda o actualiza un comentario/justificación borrador individual en BD (replicando logix_react)
pub fn upsert_draft_comment_in_db(
    conn: &Connection,
    payload: UpsertDraftCommentPayload,
) -> Result<()> {
    let now_ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let ir = payload.import_reference.trim().to_uppercase();
    let grn = payload.grn_number.trim().to_uppercase();
    let wb = payload.waybill.as_deref().unwrap_or("").trim().to_uppercase();
    let oline = payload.order_line.as_deref().unwrap_or("").trim().to_string();
    let code = payload.item_code.trim().to_uppercase();
    let reason = payload.difference_reason.as_deref().unwrap_or("").trim().to_string();
    let comment = payload.operator_comment.as_deref().unwrap_or("").trim().to_string();
    let qty_rec = payload.qty_received.unwrap_or(0.0);

    // Buscar si existe un borrador (reconciliation_id IS NULL OR reconciliation_id = 0)
    let existing_id: Option<i64> = conn.query_row(
        "SELECT id FROM saved_grn_reconciliation_items
         WHERE (reconciliation_id IS NULL OR reconciliation_id = 0)
           AND import_reference = ?1 AND grn_number = ?2 AND item_code = ?3 AND order_line = ?4
           AND (waybill = ?5 OR ?5 = '' OR waybill = '')
         LIMIT 1",
        params![ir, grn, code, oline, wb],
        |row| row.get(0),
    ).ok();

    if let Some(id) = existing_id {
        conn.execute(
            "UPDATE saved_grn_reconciliation_items
             SET waybill = CASE WHEN ?1 != '' THEN ?1 ELSE waybill END,
                 difference_reason = ?2,
                 operator_comment = ?3,
                 qty_received = ?4,
                 reconciled_at = ?5
             WHERE id = ?6",
            params![wb, reason, comment, qty_rec, now_ts, id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO saved_grn_reconciliation_items (
                reconciliation_id, grn_number, import_reference, waybill, order_line,
                item_code, description, location, relocated_bin, qty_expected,
                qty_received, difference, difference_reason, operator_comment, reconciled_at
            ) VALUES (0, ?1, ?2, ?3, ?4, ?5, '', '', '', 0.0, ?6, 0.0, ?7, ?8, ?9)",
            params![grn, ir, wb, oline, code, qty_rec, reason, comment, now_ts],
        )?;
    }

    Ok(())
}

/// Obtiene la lista de conciliaciones históricas guardadas
pub fn get_saved_grn_reconciliations_list_from_db(
    conn: &Connection,
    grn_filter: Option<String>,
    ir_filter: Option<String>,
) -> Result<Vec<SavedGRNReconciliationHeader>> {
    let mut sql = "SELECT id, grn_number, import_reference, waybill, total_lines,
                          total_expected, total_received, total_difference, status,
                          reconciled_by, reconciled_at, notes
                   FROM saved_grn_reconciliations WHERE 1=1".to_string();

    if let Some(ref g) = grn_filter {
        if !g.trim().is_empty() {
            sql.push_str(&format!(" AND grn_number LIKE '%{}%'", g.trim().to_uppercase()));
        }
    }
    if let Some(ref ir) = ir_filter {
        if !ir.trim().is_empty() {
            sql.push_str(&format!(" AND import_reference LIKE '%{}%'", ir.trim().to_uppercase()));
        }
    }
    sql.push_str(" ORDER BY id DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(SavedGRNReconciliationHeader {
            id: row.get(0)?,
            grn_number: row.get(1)?,
            import_reference: row.get(2)?,
            waybill: row.get(3)?,
            total_lines: row.get(4)?,
            total_expected: row.get(5)?,
            total_received: row.get(6)?,
            total_difference: row.get(7)?,
            status: row.get(8)?,
            reconciled_by: row.get(9)?,
            reconciled_at: row.get(10)?,
            notes: row.get(11)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

/// Obtiene el detalle completo con todas las filas de una conciliación guardada
pub fn get_saved_grn_reconciliation_detail_from_db(
    conn: &Connection,
    id: i64,
) -> Result<Option<SavedGRNReconciliationDetail>> {
    let mut stmt_h = conn.prepare(
        "SELECT id, grn_number, import_reference, waybill, total_lines,
                total_expected, total_received, total_difference, status,
                reconciled_by, reconciled_at, notes
         FROM saved_grn_reconciliations WHERE id = ?1"
    )?;

    let header = stmt_h.query_row(params![id], |row| {
        Ok(SavedGRNReconciliationHeader {
            id: row.get(0)?,
            grn_number: row.get(1)?,
            import_reference: row.get(2)?,
            waybill: row.get(3)?,
            total_lines: row.get(4)?,
            total_expected: row.get(5)?,
            total_received: row.get(6)?,
            total_difference: row.get(7)?,
            status: row.get(8)?,
            reconciled_by: row.get(9)?,
            reconciled_at: row.get(10)?,
            notes: row.get(11)?,
        })
    }).ok();

    if let Some(h) = header {
        let mut stmt_items = conn.prepare(
            "SELECT id, reconciliation_id, grn_number, import_reference, waybill,
                    order_line, item_code, description, location, relocated_bin,
                    qty_expected, qty_received, difference, difference_reason,
                    operator_comment, reconciled_at
             FROM saved_grn_reconciliation_items
             WHERE reconciliation_id = ?1
             ORDER BY id ASC"
        )?;

        let items = stmt_items.query_map(params![id], |row| {
            Ok(SavedGRNReconciliationItemRow {
                id: row.get(0)?,
                reconciliation_id: row.get(1)?,
                grn_number: row.get(2)?,
                import_reference: row.get(3)?,
                waybill: row.get(4)?,
                order_line: row.get(5)?,
                item_code: row.get(6)?,
                description: row.get(7)?,
                location: row.get(8)?,
                relocated_bin: row.get(9)?,
                qty_expected: row.get(10)?,
                qty_received: row.get(11)?,
                difference: row.get(12)?,
                difference_reason: row.get(13)?,
                operator_comment: row.get(14)?,
                reconciled_at: row.get(15)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(Some(SavedGRNReconciliationDetail { header: h, items }))
    } else {
        Ok(None)
    }
}

/// Elimina una conciliación guardada
pub fn delete_saved_grn_reconciliation_from_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM saved_grn_reconciliations WHERE id = ?1", params![id])?;
    Ok(())
}

/// Retorna todas las referencias únicas de importación conocidas
pub fn get_unique_grn_references(
    conn: &Connection,
    po_json_path: &str,
    grn_json_path: &str,
) -> Vec<String> {
    let mut refs = HashSet::new();

    // 1. Desde logs en SQLite
    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT import_reference FROM inbound_logs WHERE import_reference IS NOT NULL AND import_reference != ''") {
        if let Ok(iter) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for r in iter.flatten() {
                let clean = r.trim().to_uppercase();
                if !clean.is_empty() {
                    refs.insert(clean);
                }
            }
        }
    }

    // 2. Desde po_lookup.json
    if let Ok(data) = std::fs::read_to_string(po_json_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&data) {
            if let Some(ir_map) = json.get("ir_to_data").and_then(|v| v.as_object()) {
                for k in ir_map.keys() {
                    let clean = k.trim().to_uppercase();
                    if !clean.is_empty() {
                        refs.insert(clean);
                    }
                }
            }
        }
    }

    // 3. Desde grn_master_data.json
    if let Ok(data) = std::fs::read_to_string(grn_json_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&data) {
            if let Some(arr) = json.as_array() {
                for row in arr {
                    if let Some(ir) = row.get("Import_Reference").or_else(|| row.get("import_reference")).and_then(|v| v.as_str()) {
                        let clean = ir.trim().to_uppercase();
                        if !clean.is_empty() {
                            refs.insert(clean);
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<String> = refs.into_iter().collect();
    result.sort();
    result
}

/// Resuelve alertas en masa
pub fn resolve_alerts_bulk_in_db(conn: &Connection, alert_ids: &[i64]) -> Result<usize> {
    let mut resolved_count = 0;
    for id in alert_ids {
        let count = conn.execute("UPDATE inbound_alerts SET resolved = 1 WHERE id = ?1", params![id])?;
        resolved_count += count;
    }
    Ok(resolved_count)
}

/// Ejecuta el auditor de inbound analizando todos los logs contra las cantidades esperadas
pub fn run_inbound_auditor_db(
    conn: &Connection,
    po_json_path: &str,
    grn_json_path: &str,
) -> Result<usize> {
    let logs = get_logs_from_db(conn, None)?;
    let mut generated_alerts = 0;
    let now_ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    for log in logs {
        if log.import_reference.is_empty() {
            continue;
        }

        // Evaluar si existe diferencia
        let finder = find_item_inbound(
            conn,
            &log.item_code,
            Some(&log.import_reference),
            po_json_path,
            grn_json_path,
        )?;

        let diff = log.qty_received - finder.default_qty_grn;
        if diff.abs() > 0.0001 && finder.default_qty_grn > 0.0 {
            let msg = if diff > 0.0 {
                format!(
                    "SOBRANTE: Recibido {} vs Esperado {} (Diferencia +{})",
                    log.qty_received, finder.default_qty_grn, diff
                )
            } else {
                format!(
                    "FALTANTE: Recibido {} vs Esperado {} (Diferencia {})",
                    log.qty_received, finder.default_qty_grn, diff
                )
            };

            let _ = conn.execute(
                "INSERT INTO inbound_alerts (alert_type, import_reference, item_code, message, severity, resolved, timestamp)
                 VALUES ('inbound_auditor', ?1, ?2, ?3, ?4, 0, ?5)",
                params![
                    log.import_reference,
                    log.item_code,
                    msg,
                    if diff < 0.0 { "HIGH" } else { "MEDIUM" },
                    now_ts
                ],
            );
            generated_alerts += 1;
        }
    }

    Ok(generated_alerts)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertDraftCommentPayload {
    pub grn_number: String,
    pub import_reference: String,
    pub waybill: Option<String>,
    pub order_line: Option<String>,
    pub item_code: String,
    pub difference_reason: Option<String>,
    pub operator_comment: Option<String>,
    pub qty_received: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundReconciliationRow {
    pub id: i64,
    #[serde(rename = "Import_Reference")]
    pub import_reference: String,
    #[serde(rename = "Waybill")]
    pub waybill: String,
    #[serde(rename = "GRN")]
    pub grn: String,
    #[serde(rename = "Order_Line")]
    pub order_line: String,
    #[serde(rename = "Codigo_Item")]
    pub codigo_item: String,
    #[serde(rename = "Descripcion")]
    pub descripcion: String,
    #[serde(rename = "Ubicacion")]
    pub ubicacion: String,
    #[serde(rename = "Reubicado")]
    pub reubicado: String,
    #[serde(rename = "Cant_Esperada")]
    pub cant_esperada: f64,
    #[serde(rename = "Cant_Recibida")]
    pub cant_recibida: f64,
    #[serde(rename = "Diferencia")]
    pub diferencia: f64,
    #[serde(rename = "Total_Esperado_IR")]
    pub total_esperado_ir: f64,
    #[serde(rename = "Diferencia_Real_IR")]
    pub diferencia_real_ir: f64,
    #[serde(rename = "Timestamp")]
    pub timestamp: String,
    #[serde(rename = "Usuario")]
    pub usuario: String,
    #[serde(rename = "Snapshot_Date")]
    pub snapshot_date: Option<String>,
    #[serde(rename = "Motivo_Diferencia")]
    pub motivo_diferencia: Option<String>,
    #[serde(rename = "Observacion_Operador")]
    pub observacion_operador: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundReconciliationResponse {
    pub data: Vec<InboundReconciliationRow>,
    pub archive_versions: Vec<String>,
    pub snapshot_versions: Vec<String>,
}

#[derive(Debug, Clone)]
struct JsonFileCache {
    path: String,
    mtime: Option<std::time::SystemTime>,
    data: Option<Value>,
}

static PO_CACHE: RwLock<Option<JsonFileCache>> = RwLock::new(None);
static GRN_CACHE: RwLock<Option<JsonFileCache>> = RwLock::new(None);
static ACTIVE_RECONCILIATION_CACHE: RwLock<Option<(Instant, InboundReconciliationResponse)>> = RwLock::new(None);

pub fn invalidate_inbound_reconciliation_cache() {
    if let Ok(mut cache) = ACTIVE_RECONCILIATION_CACHE.write() {
        *cache = None;
    }
}

fn read_json_file_fallback(path_str: &str) -> Option<Value> {
    if let Ok(data) = std::fs::read_to_string(path_str) {
        if let Ok(val) = serde_json::from_str(&data) {
            return Some(val);
        }
    }
    let fallback = format!("../{}", path_str.trim_start_matches("./"));
    if let Ok(data) = std::fs::read_to_string(&fallback) {
        if let Ok(val) = serde_json::from_str(&data) {
            return Some(val);
        }
    }
    None
}

fn read_cached_json_file(path_str: &str, cache_lock: &'static RwLock<Option<JsonFileCache>>) -> Option<Value> {
    let actual_path = if std::path::Path::new(path_str).exists() {
        path_str.to_string()
    } else {
        let fallback = format!("../{}", path_str.trim_start_matches("./"));
        if std::path::Path::new(&fallback).exists() {
            fallback
        } else {
            path_str.to_string()
        }
    };

    let current_mtime = std::fs::metadata(&actual_path).ok().and_then(|m| m.modified().ok());

    if let Ok(guard) = cache_lock.read() {
        if let Some(ref cache) = *guard {
            if cache.path == actual_path && cache.mtime == current_mtime && current_mtime.is_some() {
                return cache.data.clone();
            }
        }
    }

    let val = read_json_file_fallback(&actual_path);
    if let Ok(mut guard) = cache_lock.write() {
        *guard = Some(JsonFileCache {
            path: actual_path,
            mtime: current_mtime,
            data: val.clone(),
        });
    }
    val
}

/// Genera la vista completa de Conciliación de Inbound cruzando logs físicos con GRNs y PO Extractor
#[allow(clippy::too_many_arguments)]
pub fn get_inbound_reconciliation_view(
    conn: &Connection,
    po_json_path: &str,
    grn_json_path: &str,
    archive_date: Option<String>,
    snapshot_date: Option<String>,
    filter_grn: Option<String>,
    filter_waybill: Option<String>,
    filter_import_ref: Option<String>,
    is_history: bool,
) -> Result<InboundReconciliationResponse> {
    let is_active_view = archive_date.is_none()
        && snapshot_date.is_none()
        && filter_grn.is_none()
        && filter_waybill.is_none()
        && filter_import_ref.is_none()
        && !is_history;

    if is_active_view {
        if let Ok(guard) = ACTIVE_RECONCILIATION_CACHE.read() {
            if let Some((instant, ref cached_resp)) = *guard {
                if instant.elapsed().as_secs() < 60 {
                    return Ok(cached_resp.clone());
                }
            }
        }
    }

    // 1. Cargar JSONs de PO Extractor y GRNs usando caché en memoria
    let po_json = read_cached_json_file(po_json_path, &PO_CACHE);
    let grn_json = read_cached_json_file(grn_json_path, &GRN_CACHE);

    // 2. Extraer versiones disponibles de archivo y snapshot
    let mut archive_versions = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT version_date FROM inbound_logs WHERE version_date IS NOT NULL AND version_date != '' ORDER BY version_date DESC") {
        if let Ok(iter) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for v in iter.flatten() {
                archive_versions.push(v);
            }
        }
    }

    let mut snapshot_versions = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT archived_at FROM inbound_logs WHERE archived_at IS NOT NULL AND archived_at != '' ORDER BY archived_at DESC") {
        if let Ok(iter) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for v in iter.flatten() {
                snapshot_versions.push(v);
            }
        }
    }

    // 3. Consultar logs de SQLite y agrupar por (importReference, itemCode)
    let mut sql = "SELECT id, timestamp, import_reference, waybill, item_code, item_description,
                          bin_location, relocated_bin, qty_received, username, archived_at
                   FROM inbound_logs WHERE 1=1".to_string();

    let mut conditions = Vec::new();

    if let Some(ref snap) = snapshot_date {
        if !snap.trim().is_empty() {
            conditions.push(format!("archived_at LIKE '{}%'", snap.trim()));
        }
    } else if let Some(ref arc) = archive_date {
        if !arc.trim().is_empty() {
            conditions.push(format!("version_date LIKE '{}%'", arc.trim()));
        }
    } else if !is_history {
        // En vista activa, solo registros no archivados
        conditions.push("(archived_at IS NULL OR archived_at = '')".to_string());
    }

    for c in conditions {
        sql.push_str(&format!(" AND {}", c));
    }
    sql.push_str(" ORDER BY id ASC");

    struct LogGroup {
        id: i64,
        qty_received: f64,
        waybill_log: String,
        bin_location: String,
        relocated_bin: String,
        timestamp_log: String,
        username_log: String,
        item_description: String,
        snapshot_date: Option<String>,
    }

    let mut logs_grouped: HashMap<(String, String), LogGroup> = HashMap::new();

    if let Ok(mut stmt) = conn.prepare(&sql) {
        if let Ok(iter) = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let ts: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let ir: String = row.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_uppercase();
            let wb: String = row.get::<_, Option<String>>(3)?.unwrap_or_default().trim().to_uppercase();
            let code: String = row.get::<_, Option<String>>(4)?.unwrap_or_default().trim().to_uppercase();
            let desc: String = row.get::<_, Option<String>>(5)?.unwrap_or_default();
            let bin: String = row.get::<_, Option<String>>(6)?.unwrap_or_default();
            let reloc: String = row.get::<_, Option<String>>(7)?.unwrap_or_default();
            let qty: f64 = row.get::<_, Option<f64>>(8)?.unwrap_or(0.0);
            let user: String = row.get::<_, Option<String>>(9)?.unwrap_or_else(|| "admin".to_string());
            let snap: Option<String> = row.get(10)?;
            Ok((id, ts, ir, wb, code, desc, bin, reloc, qty, user, snap))
        }) {
            for log_res in iter.flatten() {
                let (id, ts, ir, wb, code, desc, bin, reloc, qty, user, snap) = log_res;
                let key = (ir.clone(), code.clone());
                let entry = logs_grouped.entry(key).or_insert_with(|| LogGroup {
                    id,
                    qty_received: 0.0,
                    waybill_log: wb.clone(),
                    bin_location: bin.clone(),
                    relocated_bin: reloc.clone(),
                    timestamp_log: ts.clone(),
                    username_log: user.clone(),
                    item_description: desc.clone(),
                    snapshot_date: snap,
                });
                entry.qty_received += qty;
                if !wb.is_empty() {
                    entry.waybill_log = wb;
                }
                if !bin.is_empty() {
                    entry.bin_location = bin;
                }
                if !reloc.is_empty() {
                    entry.relocated_bin = reloc;
                }
                if !ts.is_empty() {
                    entry.timestamp_log = ts;
                }
                if !user.is_empty() {
                    entry.username_log = user;
                }
                if !desc.is_empty() {
                    entry.item_description = desc;
                }
            }
        }
    }

    // 3b. Precargar descripciones de inventario en memoria para evitar miles de queries lentas a SQLite
    let mut item_descriptions: HashMap<String, String> = HashMap::new();
    if let Ok(mut stmt_desc) = conn.prepare("SELECT item_code, description FROM inventory_items WHERE description IS NOT NULL AND description != ''") {
        if let Ok(iter) = stmt_desc.query_map([], |row| {
            let code: String = row.get::<_, String>(0)?.trim().to_uppercase();
            let desc: String = row.get::<_, String>(1)?.trim().to_string();
            Ok((code, desc))
        }) {
            for (code, desc) in iter.flatten() {
                item_descriptions.insert(code, desc);
            }
        }
    }

    // 4. Construir Master Maps de PO Extractor (GRN -> IR/WB, Customer Ref / Order Number -> IR/WB)
    let mut grn_to_ir_wb: HashMap<String, (String, String)> = HashMap::new();
    let mut item_custref_to_ir_wb: HashMap<(String, String), (String, String)> = HashMap::new();
    let mut custref_to_ir_wb: HashMap<String, (String, String)> = HashMap::new();
    let mut grn_item_to_custref: HashMap<(String, String), String> = HashMap::new();
    let mut ir_item_to_custref: HashMap<(String, String), String> = HashMap::new();
    let mut wb_item_to_custref: HashMap<(String, String), String> = HashMap::new();
    let mut grn_to_custref: HashMap<String, String> = HashMap::new();
    let mut ir_item_to_order_line: HashMap<(String, String), String> = HashMap::new();
    let mut wb_item_to_order_line: HashMap<(String, String), String> = HashMap::new();

    // 4.1 Cargar GRNs confirmadas/guardadas desde la DB SQLite para NUNCA desasociarlas (replicando logix_react)
    if let Ok(mut stmt_saved) = conn.prepare("
        SELECT import_reference, grn_number, waybill
        FROM saved_grn_reconciliations
        WHERE grn_number IS NOT NULL AND grn_number != ''
    ") {
        if let Ok(iter) = stmt_saved.query_map([], |row| {
            let ir: String = row.get::<_, Option<String>>(0)?.unwrap_or_default().trim().to_uppercase();
            let grn: String = row.get::<_, Option<String>>(1)?.unwrap_or_default().trim().to_uppercase();
            let wb: String = row.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_uppercase();
            Ok((ir, grn, wb))
        }) {
            for res in iter.flatten() {
                let (ir, grn, wb) = res;
                if !ir.is_empty() && !grn.is_empty() {
                    for g in grn.split(&[',', '/'][..]) {
                        let g_clean = g.trim().to_uppercase();
                        if !g_clean.is_empty() {
                            grn_to_ir_wb.insert(g_clean, (ir.clone(), wb.clone()));
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut stmt_saved_items) = conn.prepare("
        SELECT DISTINCT import_reference, grn_number, waybill
        FROM saved_grn_reconciliation_items
        WHERE grn_number IS NOT NULL AND grn_number != ''
    ") {
        if let Ok(iter) = stmt_saved_items.query_map([], |row| {
            let ir: String = row.get::<_, Option<String>>(0)?.unwrap_or_default().trim().to_uppercase();
            let grn: String = row.get::<_, Option<String>>(1)?.unwrap_or_default().trim().to_uppercase();
            let wb: String = row.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_uppercase();
            Ok((ir, grn, wb))
        }) {
            for res in iter.flatten() {
                let (ir, grn, wb) = res;
                if !ir.is_empty() && !grn.is_empty() {
                    for g in grn.split(&[',', '/'][..]) {
                        let g_clean = g.trim().to_uppercase();
                        if !g_clean.is_empty() {
                            grn_to_ir_wb.insert(g_clean, (ir.clone(), wb.clone()));
                        }
                    }
                }
            }
        }
    }

    if let Some(ref po) = po_json {
        if let Some(wb_map) = po.get("wb_to_data").and_then(|v| v.as_object()) {
            for (wb_raw, data_obj) in wb_map {
                let ir = data_obj.get("import_ref").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                let wb = wb_raw.trim().to_uppercase();
                if !ir.is_empty() {
                    if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                        for item in items {
                            let item_code = item.get("item_code").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                            let cust_ref = item.get("customer_ref").or_else(|| item.get("order_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                            if !cust_ref.is_empty() {
                                if !item_code.is_empty() {
                                    item_custref_to_ir_wb.insert((item_code.clone(), cust_ref.clone()), (ir.clone(), wb.clone()));
                                    wb_item_to_custref.insert((wb.clone(), item_code.clone()), cust_ref.clone());
                                }
                                custref_to_ir_wb.insert(cust_ref.clone(), (ir.clone(), wb.clone()));
                            }
                            let order_line_val = item.get("order_line")
                                .or_else(|| item.get("line"))
                                .or_else(|| item.get("Order_Line"))
                                .and_then(|v| {
                                    if let Some(s) = v.as_str() {
                                        let st = s.trim();
                                        if !st.is_empty() && st != "-" { Some(st.to_string()) } else { None }
                                    } else if let Some(n) = v.as_i64() {
                                        Some(n.to_string())
                                    } else { v.as_f64().map(|f| (f as i64).to_string()) }
                                })
                                .unwrap_or_default();
                            if !order_line_val.is_empty() && !item_code.is_empty() {
                                wb_item_to_order_line.insert((wb.clone(), item_code.clone()), order_line_val.clone());
                                ir_item_to_order_line.insert((ir.clone(), item_code.clone()), order_line_val.clone());
                            }
                            if let Some(grn_val) = item.get("grn").and_then(|v| v.as_str()) {
                                for g in grn_val.split(&[',', '/'][..]) {
                                    let g_clean = g.trim().to_uppercase();
                                    if !g_clean.is_empty() {
                                        grn_to_ir_wb.insert(g_clean.clone(), (ir.clone(), wb.clone()));
                                        if !cust_ref.is_empty() {
                                            grn_to_custref.insert(g_clean.clone(), cust_ref.clone());
                                            if !item_code.is_empty() {
                                                grn_item_to_custref.insert((g_clean, item_code.clone()), cust_ref.clone());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(ir_map) = po.get("ir_to_data").and_then(|v| v.as_object()) {
            for (ir_raw, data_obj) in ir_map {
                let ir = ir_raw.trim().to_uppercase();
                let wb = data_obj.get("waybill").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                if !ir.is_empty() {
                    if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                        for item in items {
                            let item_code = item.get("item_code").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                            let cust_ref = item.get("customer_ref").or_else(|| item.get("order_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                            if !cust_ref.is_empty() {
                                if !item_code.is_empty() {
                                    item_custref_to_ir_wb.insert((item_code.clone(), cust_ref.clone()), (ir.clone(), wb.clone()));
                                    ir_item_to_custref.insert((ir.clone(), item_code.clone()), cust_ref.clone());
                                }
                                custref_to_ir_wb.insert(cust_ref.clone(), (ir.clone(), wb.clone()));
                            }
                            let order_line_val = item.get("order_line")
                                .or_else(|| item.get("line"))
                                .or_else(|| item.get("Order_Line"))
                                .and_then(|v| {
                                    if let Some(s) = v.as_str() {
                                        let st = s.trim();
                                        if !st.is_empty() && st != "-" { Some(st.to_string()) } else { None }
                                    } else if let Some(n) = v.as_i64() {
                                        Some(n.to_string())
                                    } else { v.as_f64().map(|f| (f as i64).to_string()) }
                                })
                                .unwrap_or_default();
                            if !order_line_val.is_empty() && !item_code.is_empty() {
                                ir_item_to_order_line.insert((ir.clone(), item_code.clone()), order_line_val.clone());
                                if !wb.is_empty() {
                                    wb_item_to_order_line.insert((wb.clone(), item_code.clone()), order_line_val.clone());
                                }
                            }
                            if let Some(grn_val) = item.get("grn").and_then(|v| v.as_str()) {
                                for g in grn_val.split(&[',', '/'][..]) {
                                    let g_clean = g.trim().to_uppercase();
                                    if !g_clean.is_empty() {
                                        grn_to_ir_wb.insert(g_clean.clone(), (ir.clone(), wb.clone()));
                                        if !cust_ref.is_empty() {
                                            grn_to_custref.insert(g_clean.clone(), cust_ref.clone());
                                            if !item_code.is_empty() {
                                                grn_item_to_custref.insert((g_clean, item_code.clone()), cust_ref.clone());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(cr_map) = po.get("customer_ref_to_data").and_then(|v| v.as_object()) {
            for (cr_raw, data_obj) in cr_map {
                let cr_clean = cr_raw.trim().to_uppercase();
                let ir = data_obj.get("import_ref").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                let wb = data_obj.get("waybill").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                if !cr_clean.is_empty() && !ir.is_empty() {
                    custref_to_ir_wb.insert(cr_clean.clone(), (ir.clone(), wb.clone()));
                }
                // NOTA: Nunca insertar en grn_to_ir_wb desde customer_ref_to_data porque un customer_ref
                // agrupa órdenes y GRNs de múltiples envíos/IRs diferentes a lo largo del tiempo.
            }
        }
    }

    // 5. Cargar Reporte 280 (Líneas individuales de GRN esperadas)
    struct Expected280Line {
        grn: String,
        item_code: String,
        description: String,
        quantity: f64,
        #[allow(dead_code)]
        order_number: String,
        order_line: String,
        ir_map: String,
        wb_map: String,
    }

    let mut df_280: Vec<Expected280Line> = Vec::new();

    if let Some(arr) = grn_json.as_ref().and_then(|v| v.as_array()) {
        for row in arr {
            let grn_raw = row.get("GRN_Number").or_else(|| row.get("grn_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let item_code = row.get("Item_Code").or_else(|| row.get("item_code")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let desc = row.get("Item_Description").or_else(|| row.get("description")).and_then(|v| v.as_str()).unwrap_or("No en sistema 280").trim().to_string();
            let qty = row.get("Quantity").or_else(|| row.get("quantity")).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let order_num = row.get("Order_Number").or_else(|| row.get("order_number")).or_else(|| row.get("customer_ref")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let order_line = row.get("Order_Line")
                .or_else(|| row.get("order_line"))
                .or_else(|| row.get("Line"))
                .or_else(|| row.get("line"))
                .and_then(|v| {
                    if let Some(s) = v.as_str() {
                        let st = s.trim();
                        if !st.is_empty() { Some(st.to_string()) } else { None }
                    } else if let Some(n) = v.as_i64() {
                        Some(n.to_string())
                    } else { v.as_f64().map(|f| (f as i64).to_string()) }
                })
                .unwrap_or_default();
            let explicit_ir = row.get("Import_Reference").or_else(|| row.get("import_reference")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let explicit_wb = row.get("Waybill").or_else(|| row.get("waybill")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();

            if item_code.is_empty() && grn_raw.is_empty() {
                continue;
            }

            let grn_parts: Vec<String> = if grn_raw.contains(',') || grn_raw.contains('/') {
                grn_raw.split(&[',', '/'][..])
                    .map(|s| s.trim().to_uppercase())
                    .filter(|s| !s.is_empty() && s != "N/A" && s != "SIN GRN")
                    .collect()
            } else if !grn_raw.is_empty() && grn_raw != "N/A" && grn_raw != "SIN GRN" {
                vec![grn_raw.clone()]
            } else {
                vec![if grn_raw.is_empty() { "SIN GRN".to_string() } else { grn_raw.clone() }]
            };

            for grn in grn_parts {
                // Asociación con prioridad estricta de GRN (replicando logix_react):
                // 1. IR Explícito en 280
                // 2. Mapa por GRN (la GRN es la ancla directa del envío/IR)
                // 3. Solo si la GRN es desconocida ("SIN GRN" / vacía), intentar por tríada o Customer Ref
                // 4. De lo contrario, SIN I.R. MAESTRA
                let (ir_map, wb_map) = if !explicit_ir.is_empty() {
                    let wb = if !explicit_wb.is_empty() {
                        explicit_wb.clone()
                    } else if let Some((_, w)) = grn_to_ir_wb.get(&grn) {
                        w.clone()
                    } else {
                        "SIN WAYBILL".to_string()
                    };
                    (explicit_ir.clone(), wb)
                } else if let Some((ir, wb)) = grn_to_ir_wb.get(&grn) {
                    (ir.clone(), wb.clone())
                } else if grn == "SIN GRN" || grn.is_empty() {
                    if !order_num.is_empty() && item_custref_to_ir_wb.contains_key(&(item_code.clone(), order_num.clone())) {
                        let (ir, wb) = item_custref_to_ir_wb.get(&(item_code.clone(), order_num.clone())).unwrap();
                        (ir.clone(), wb.clone())
                    } else if !order_num.is_empty() && custref_to_ir_wb.contains_key(&order_num) {
                        let (ir, wb) = custref_to_ir_wb.get(&order_num).unwrap();
                        (ir.clone(), wb.clone())
                    } else {
                        ("SIN I.R. MAESTRA".to_string(), "SIN WAYBILL".to_string())
                    }
                } else {
                    ("SIN I.R. MAESTRA".to_string(), "SIN WAYBILL".to_string())
                };

                df_280.push(Expected280Line {
                    grn,
                    item_code: item_code.clone(),
                    description: desc.clone(),
                    quantity: qty,
                    order_number: order_num.clone(),
                    order_line: order_line.clone(),
                    ir_map,
                    wb_map,
                });
            }
        }
    }

    // 5b. Fallback a PO Extractor: Si una IR existe en po_lookup.json pero NO tiene líneas en el Reporte 280,
    // agregar sus líneas esperadas desde po_lookup.json para permitir la conciliación contra la orden de compra.
    let mut irs_with_280: HashSet<String> = HashSet::new();
    let mut irs_with_280_clean: HashSet<String> = HashSet::new();
    for line in &df_280 {
        if line.ir_map != "SIN I.R. MAESTRA" && !line.ir_map.is_empty() {
            irs_with_280.insert(line.ir_map.clone());
            let stripped: String = strip_ir_prefix(&line.ir_map).chars().filter(|c| c.is_alphanumeric()).collect();
            if !stripped.is_empty() {
                irs_with_280_clean.insert(stripped);
            }
        }
    }

    if let Some(ref po) = po_json {
        let mut added_po_keys: HashSet<(String, String, String, String, String)> = HashSet::new();
        let mut add_po_items = |ir_val: &str, wb_val: &str, items: &Vec<Value>| {
            let ir_clean = ir_val.trim().to_uppercase();
            if ir_clean.is_empty() {
                return;
            }
            // Si ya existen registros del 280 para esta IR, prevalece el 280 (Prioridad 1)
            let ir_stripped: String = strip_ir_prefix(&ir_clean).chars().filter(|c| c.is_alphanumeric()).collect();
            let has_280 = irs_with_280.contains(&ir_clean)
                || (!ir_stripped.is_empty() && irs_with_280_clean.contains(&ir_stripped));
            if has_280 {
                return;
            }

            for item in items {
                let code = item.get("item_code").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                if code.is_empty() {
                    continue;
                }

                let order_line_val = item.get("order_line")
                    .or_else(|| item.get("line"))
                    .or_else(|| item.get("Order_Line"))
                    .and_then(|v| {
                        if let Some(s) = v.as_str() {
                            let st = s.trim();
                            if !st.is_empty() { Some(st.to_string()) } else { None }
                        } else if let Some(n) = v.as_i64() {
                            Some(n.to_string())
                        } else { v.as_f64().map(|f| (f as i64).to_string()) }
                    })
                    .unwrap_or_default();
                let grn_raw = item.get("grn").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                let cust_ref = item.get("customer_ref").or_else(|| item.get("order_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();

                let key = (ir_clean.clone(), code.clone(), order_line_val.clone(), grn_raw.clone(), cust_ref.clone());
                if added_po_keys.contains(&key) {
                    continue;
                }
                added_po_keys.insert(key);

                let qty = item.get("qty").and_then(|v| v.as_f64())
                    .or_else(|| item.get("qty").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
                    .unwrap_or(0.0);

                let grn_parts: Vec<String> = if grn_raw.contains(',') || grn_raw.contains('/') {
                    grn_raw.split(&[',', '/'][..])
                        .map(|s| s.trim().to_uppercase())
                        .filter(|s| !s.is_empty() && s != "N/A" && s != "SIN GRN")
                        .collect()
                } else if !grn_raw.is_empty() && grn_raw != "N/A" && grn_raw != "SIN GRN" {
                    vec![grn_raw]
                } else {
                    vec!["PO EXTRACTOR".to_string()]
                };

                let order_line_final = if !order_line_val.is_empty() && order_line_val != "-" {
                    order_line_val
                } else if let Some(ol) = ir_item_to_order_line.get(&(ir_clean.clone(), code.clone())) {
                    ol.clone()
                } else if let Some(ol) = wb_item_to_order_line.get(&(wb_val.trim().to_uppercase(), code.clone())) {
                    ol.clone()
                } else {
                    "-".to_string()
                };

                for grn in grn_parts {
                    df_280.push(Expected280Line {
                        grn,
                        item_code: code.clone(),
                        description: String::new(),
                        quantity: qty,
                        order_number: cust_ref.clone(),
                        order_line: order_line_final.clone(),
                        ir_map: ir_clean.clone(),
                        wb_map: wb_val.trim().to_uppercase(),
                    });
                }
            }
        };

        if let Some(ir_map) = po.get("ir_to_data").and_then(|v| v.as_object()) {
            for (ir_raw, data_obj) in ir_map {
                let wb = data_obj.get("waybill").and_then(|v| v.as_str()).unwrap_or("");
                if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                    add_po_items(ir_raw, wb, items);
                }
            }
        }

        if let Some(wb_map) = po.get("wb_to_data").and_then(|v| v.as_object()) {
            for (wb_raw, data_obj) in wb_map {
                let ir = data_obj.get("import_ref").and_then(|v| v.as_str()).unwrap_or("");
                if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                    add_po_items(ir, wb_raw, items);
                }
            }
        }
    }

    // 5.1 PROTECCIÓN Y RECUPERACIÓN DE GRNs COMPLETAS O RECIBIDAS (replicando logix_react):
    // Si alguna GRN no tiene I.R. maestra asignada, pero sus ítems ya están registrados
    // físicamente en los logs de bodega, autodescubrir su I.R. activa para NUNCA
    // desasociarla ni mostrar la cantidad recibida en cero.
    let mut unmapped_grns: HashSet<String> = HashSet::new();
    let mut grn_to_items_map: HashMap<String, HashSet<String>> = HashMap::new();
    for line in &df_280 {
        if (line.ir_map == "SIN I.R. MAESTRA" || line.ir_map.is_empty())
            && !line.grn.is_empty()
            && line.grn != "SIN GRN"
            && line.grn != "PO EXTRACTOR"
        {
            unmapped_grns.insert(line.grn.clone());
            if !line.item_code.is_empty() {
                grn_to_items_map.entry(line.grn.clone()).or_default().insert(line.item_code.clone());
            }
        }
    }

    if !unmapped_grns.is_empty() && !logs_grouped.is_empty() {
        let mut recovered_mappings: HashMap<String, (String, String)> = HashMap::new();

        for (u_grn, grn_item_codes) in grn_to_items_map {
            let mut ir_matches: HashMap<String, (HashSet<String>, String)> = HashMap::new();
            for ((ir, code), lg) in &logs_grouped {
                if !ir.is_empty() && ir != "SIN I.R. MAESTRA" && grn_item_codes.contains(code) {
                    let entry = ir_matches.entry(ir.clone()).or_insert_with(|| (HashSet::new(), lg.waybill_log.clone()));
                    entry.0.insert(code.clone());
                    if entry.1.is_empty() && !lg.waybill_log.is_empty() {
                        entry.1 = lg.waybill_log.clone();
                    }
                }
            }

            if let Some((best_ir, (items_set, wb))) = ir_matches.into_iter().max_by_key(|(_, (set, _))| set.len()) {
                if !items_set.is_empty() {
                    recovered_mappings.insert(u_grn, (best_ir, wb));
                }
            }
        }

        if !recovered_mappings.is_empty() {
            for line in df_280.iter_mut() {
                if line.ir_map == "SIN I.R. MAESTRA" || line.ir_map.is_empty() {
                    if let Some((rec_ir, rec_wb)) = recovered_mappings.get(&line.grn) {
                        line.ir_map = rec_ir.clone();
                        if (line.wb_map == "SIN WAYBILL" || line.wb_map.is_empty()) && !rec_wb.is_empty() {
                            line.wb_map = rec_wb.clone();
                        }
                    }
                }
            }
        }
    }

    // 6. Calcular Totales Esperados por (ir_map, item_code)
    let mut total_exp_ir_item: HashMap<(String, String), f64> = HashMap::new();
    for line in &df_280 {
        let key = (line.ir_map.clone(), line.item_code.clone());
        *total_exp_ir_item.entry(key).or_insert(0.0) += line.quantity;
    }

    // 7. Cargar comentarios guardados de saved_grn_reconciliation_items (indexación jerárquica con Guía / Waybill de logix_react)
    type CommentWbKey = (String, String, String, String, String);
    type CommentVal = (String, String);
    let mut saved_comments_with_wb: HashMap<CommentWbKey, CommentVal> = HashMap::new();
    let mut saved_comments_without_wb: HashMap<(String, String, String, String), (String, String)> = HashMap::new();
    let mut saved_comments_by_wb_it: HashMap<(String, String), (String, String)> = HashMap::new();
    let mut saved_comments_by_grn_it: HashMap<(String, String), (String, String)> = HashMap::new();
    let mut saved_comments_by_ir_it: HashMap<(String, String), (String, String)> = HashMap::new();

    if let Ok(mut stmt_comments) = conn.prepare("
        SELECT import_reference, waybill, grn_number, item_code, order_line, difference_reason, operator_comment
        FROM saved_grn_reconciliation_items
        ORDER BY id DESC
    ") {
        if let Ok(iter) = stmt_comments.query_map([], |r| {
            let ir: String = r.get::<_, Option<String>>(0)?.unwrap_or_default().trim().to_uppercase();
            let wb: String = r.get::<_, Option<String>>(1)?.unwrap_or_default().trim().to_uppercase();
            let grn: String = r.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_uppercase();
            let code: String = r.get::<_, Option<String>>(3)?.unwrap_or_default().trim().to_uppercase();
            let oline: String = r.get::<_, Option<String>>(4)?.unwrap_or_default().trim().to_string();
            let reason: String = r.get::<_, Option<String>>(5)?.unwrap_or_default().trim().to_string();
            let comment: String = r.get::<_, Option<String>>(6)?.unwrap_or_default().trim().to_string();
            Ok((ir, wb, grn, code, oline, reason, comment))
        }) {
            for item in iter.flatten() {
                let (ir, wb, grn, code, oline, reason, comment) = item;
                if reason.is_empty() && comment.is_empty() {
                    continue;
                }
                let pair = (reason, comment);
                if !wb.is_empty() {
                    saved_comments_with_wb.entry((ir.clone(), wb.clone(), grn.clone(), code.clone(), oline.clone())).or_insert_with(|| pair.clone());
                    saved_comments_with_wb.entry((ir.clone(), wb.clone(), grn.clone(), code.clone(), String::new())).or_insert_with(|| pair.clone());
                    saved_comments_by_wb_it.entry((wb.clone(), code.clone())).or_insert_with(|| pair.clone());
                }
                saved_comments_without_wb.entry((ir.clone(), grn.clone(), code.clone(), oline.clone())).or_insert_with(|| pair.clone());
                saved_comments_without_wb.entry((ir.clone(), grn.clone(), code.clone(), String::new())).or_insert_with(|| pair.clone());
                saved_comments_by_grn_it.entry((grn.clone(), code.clone())).or_insert_with(|| pair.clone());
                saved_comments_by_ir_it.entry((ir.clone(), code.clone())).or_insert_with(|| pair.clone());
            }
        }
    }

    // 8. Join Final y Distribución en Cascada (Waterfall - exactamente idéntico a logix_react):
    // Agrupar filas de df_280 por (ir_map, item_code) para distribuir Cant_Recibida en cascada línea por línea
    // respetando el orden de GRN y Order_Line para no duplicar cantidades contadas ni diferencias
    let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (idx, line) in df_280.iter().enumerate() {
        let key = (line.ir_map.clone(), line.item_code.clone());
        groups.entry(key).or_default().push(idx);
    }

    #[derive(Clone, Copy)]
    struct LineCalc {
        cant_rec: f64,
        diff: f64,
        total_exp: f64,
        diff_real_ir: f64,
    }
    let mut line_calcs: HashMap<usize, LineCalc> = HashMap::with_capacity(df_280.len());

    for (key, indices) in groups.iter_mut() {
        // Ordenar las líneas del grupo por [GRN, order_line_num]
        indices.sort_by(|&a_idx, &b_idx| {
            let a = &df_280[a_idx];
            let b = &df_280[b_idx];
            let a_line_num = a.order_line.trim().parse::<i64>().unwrap_or(0);
            let b_line_num = b.order_line.trim().parse::<i64>().unwrap_or(0);
            (&a.grn, a_line_num).cmp(&(&b.grn, b_line_num))
        });

        let total_rec = logs_grouped.get(key).map(|lg| lg.qty_received).unwrap_or(0.0);
        let total_exp = *total_exp_ir_item.get(key).unwrap_or(&0.0);
        let diff_real_ir = total_rec - total_exp;
        let group_size = indices.len();

        let mut cum_prev_exp = 0.0;
        for (pos, &idx) in indices.iter().enumerate() {
            let line = &df_280[idx];
            let is_last = pos == group_size - 1;

            let rem_rec = (total_rec - cum_prev_exp).max(0.0);
            let cant_rec_line = if !is_last {
                line.quantity.min(rem_rec)
            } else {
                rem_rec
            };
            let diff_line = cant_rec_line - line.quantity;
            cum_prev_exp += line.quantity;

            line_calcs.insert(idx, LineCalc {
                cant_rec: cant_rec_line,
                diff: diff_line,
                total_exp,
                diff_real_ir,
            });
        }
    }

    let mut rows: Vec<InboundReconciliationRow> = Vec::new();
    let mut processed_keys: HashSet<(String, String)> = HashSet::new();

    for (idx, line) in df_280.iter().enumerate() {
        let key = (line.ir_map.clone(), line.item_code.clone());
        processed_keys.insert(key.clone());

        let calc = line_calcs.get(&idx).copied().unwrap_or(LineCalc {
            cant_rec: 0.0,
            diff: -line.quantity,
            total_exp: line.quantity,
            diff_real_ir: -line.quantity,
        });

        let (wb_final, bin, reloc, ts, user, log_id, snap_d) = if let Some(lg) = logs_grouped.get(&key) {
            let wb = if line.wb_map != "SIN WAYBILL" && !line.wb_map.is_empty() {
                line.wb_map.clone()
            } else if !lg.waybill_log.is_empty() {
                lg.waybill_log.clone()
            } else {
                line.wb_map.clone()
            };
            (wb, lg.bin_location.clone(), lg.relocated_bin.clone(), lg.timestamp_log.clone(), lg.username_log.clone(), lg.id, lg.snapshot_date.clone())
        } else {
            (line.wb_map.clone(), String::new(), String::new(), String::new(), "admin".to_string(), (idx + 1) as i64, None)
        };

        // Si la descripción está vacía o es por defecto, buscar en logs o en inventory_items precargados
        let mut desc_final = line.description.clone();
        if desc_final.is_empty() || desc_final == "No en sistema 280" {
            if let Some(lg) = logs_grouped.get(&key) {
                if !lg.item_description.is_empty() && lg.item_description != "No en sistema 280" {
                    desc_final = lg.item_description.clone();
                }
            }
            if desc_final.is_empty() || desc_final == "No en sistema 280" {
                let clean_code = line.item_code.trim().to_uppercase();
                let clean_code_no_prefix = clean_code.trim_start_matches(".>").trim_start_matches('.').trim().to_string();
                let dot_prefix = format!(".>{}", clean_code_no_prefix);
                if let Some(d) = item_descriptions.get(&clean_code)
                    .or_else(|| item_descriptions.get(&clean_code_no_prefix))
                    .or_else(|| item_descriptions.get(&dot_prefix)) {
                    desc_final = d.clone();
                }
            }
        }

        let order_line_display = if !line.order_line.is_empty() && line.order_line != "-" {
            line.order_line.clone()
        } else if let Some(ol) = ir_item_to_order_line.get(&(line.ir_map.clone(), line.item_code.clone())) {
            ol.clone()
        } else if let Some(ol) = wb_item_to_order_line.get(&(line.wb_map.clone(), line.item_code.clone())) {
            ol.clone()
        } else {
            "-".to_string()
        };

        let (motivo, observacion) = saved_comments_with_wb
            .get(&(line.ir_map.clone(), wb_final.clone(), line.grn.clone(), line.item_code.clone(), order_line_display.clone()))
            .or_else(|| saved_comments_with_wb.get(&(line.ir_map.clone(), wb_final.clone(), line.grn.clone(), line.item_code.clone(), String::new())))
            .or_else(|| saved_comments_without_wb.get(&(line.ir_map.clone(), line.grn.clone(), line.item_code.clone(), order_line_display.clone())))
            .or_else(|| saved_comments_without_wb.get(&(line.ir_map.clone(), line.grn.clone(), line.item_code.clone(), String::new())))
            .or_else(|| saved_comments_by_wb_it.get(&(wb_final.clone(), line.item_code.clone())))
            .or_else(|| saved_comments_by_grn_it.get(&(line.grn.clone(), line.item_code.clone())))
            .or_else(|| saved_comments_by_ir_it.get(&(line.ir_map.clone(), line.item_code.clone())))
            .cloned()
            .map(|(r, c)| (
                if r.is_empty() { None } else { Some(r) },
                if c.is_empty() { None } else { Some(c) }
            ))
            .unwrap_or((None, None));

        rows.push(InboundReconciliationRow {
            id: log_id,
            import_reference: line.ir_map.clone(),
            waybill: wb_final,
            grn: line.grn.clone(),
            order_line: order_line_display,
            codigo_item: line.item_code.clone(),
            descripcion: desc_final,
            ubicacion: bin,
            reubicado: reloc,
            cant_esperada: line.quantity,
            cant_recibida: calc.cant_rec,
            diferencia: calc.diff,
            total_esperado_ir: calc.total_exp,
            diferencia_real_ir: calc.diff_real_ir,
            timestamp: ts,
            usuario: user,
            snapshot_date: snap_d,
            motivo_diferencia: motivo,
            observacion_operador: observacion,
        });
    }

    // 9. Agregar logs físicos que no están en el 280 (logs_sin_grn)
    for ((ir, code), lg) in &logs_grouped {
        if !processed_keys.contains(&(ir.clone(), code.clone())) {
            let mut desc_final = lg.item_description.clone();
            if desc_final.is_empty() || desc_final == "No en reporte 280" {
                let clean_code = code.trim().to_uppercase();
                let clean_code_no_prefix = clean_code.trim_start_matches(".>").trim_start_matches('.').trim().to_string();
                let dot_prefix = format!(".>{}", clean_code_no_prefix);
                if let Some(d) = item_descriptions.get(&clean_code)
                    .or_else(|| item_descriptions.get(&clean_code_no_prefix))
                    .or_else(|| item_descriptions.get(&dot_prefix)) {
                    desc_final = d.clone();
                }
                if desc_final.is_empty() {
                    desc_final = "No en reporte 280".to_string();
                }
            }

            let order_line_sin_grn = if let Some(ol) = ir_item_to_order_line.get(&(ir.clone(), code.clone())) {
                ol.clone()
            } else if let Some(ol) = wb_item_to_order_line.get(&(lg.waybill_log.clone(), code.clone())) {
                ol.clone()
            } else {
                "-".to_string()
            };

            let (motivo, observacion) = saved_comments_with_wb
                .get(&(ir.clone(), lg.waybill_log.clone(), "SIN GRN".to_string(), code.clone(), order_line_sin_grn.clone()))
                .or_else(|| saved_comments_with_wb.get(&(ir.clone(), lg.waybill_log.clone(), "SIN GRN".to_string(), code.clone(), String::new())))
                .or_else(|| saved_comments_without_wb.get(&(ir.clone(), "SIN GRN".to_string(), code.clone(), order_line_sin_grn.clone())))
                .or_else(|| saved_comments_without_wb.get(&(ir.clone(), "SIN GRN".to_string(), code.clone(), String::new())))
                .or_else(|| saved_comments_by_wb_it.get(&(lg.waybill_log.clone(), code.clone())))
                .or_else(|| saved_comments_by_grn_it.get(&("SIN GRN".to_string(), code.clone())))
                .or_else(|| saved_comments_by_ir_it.get(&(ir.clone(), code.clone())))
                .cloned()
                .map(|(r, c)| (
                    if r.is_empty() { None } else { Some(r) },
                    if c.is_empty() { None } else { Some(c) }
                ))
                .unwrap_or((None, None));

            rows.push(InboundReconciliationRow {
                id: lg.id,
                import_reference: ir.clone(),
                waybill: lg.waybill_log.clone(),
                grn: "SIN GRN".to_string(),
                order_line: order_line_sin_grn,
                codigo_item: code.clone(),
                descripcion: desc_final,
                ubicacion: lg.bin_location.clone(),
                reubicado: lg.relocated_bin.clone(),
                cant_esperada: 0.0,
                cant_recibida: lg.qty_received,
                diferencia: lg.qty_received,
                total_esperado_ir: 0.0,
                diferencia_real_ir: lg.qty_received,
                timestamp: lg.timestamp_log.clone(),
                usuario: lg.username_log.clone(),
                snapshot_date: lg.snapshot_date.clone(),
                motivo_diferencia: motivo,
                observacion_operador: observacion,
            });
        }
    }

    // 9. Filtrar y ordenar
    let filter_grn_clean = filter_grn.as_ref().map(|s| s.trim().to_uppercase()).unwrap_or_default();
    let filter_wb_clean = filter_waybill.as_ref().map(|s| s.trim().to_uppercase()).unwrap_or_default();
    let filter_ir_clean = filter_import_ref.as_ref().map(|s| s.trim().to_uppercase()).unwrap_or_default();
    let filter_ir_stripped = filter_ir_clean
        .trim_start_matches("IR-")
        .trim_start_matches("IR_")
        .trim_start_matches("IR ")
        .trim_start_matches("IR")
        .trim();

    rows.retain(|r| {
        if !filter_grn_clean.is_empty() && !r.grn.to_uppercase().contains(&filter_grn_clean) {
            return false;
        }
        if !filter_wb_clean.is_empty() && !match_ref_rust(&r.waybill, &filter_wb_clean) && !r.waybill.to_uppercase().contains(&filter_wb_clean) {
            return false;
        }
        if !filter_ir_clean.is_empty() {
            let r_ir = r.import_reference.to_uppercase();
            let r_stripped = r_ir
                .trim_start_matches("IR-")
                .trim_start_matches("IR_")
                .trim_start_matches("IR ")
                .trim_start_matches("IR")
                .trim();
            let match_clean = r_ir.contains(&filter_ir_clean);
            let match_stripped = !filter_ir_stripped.is_empty() && (r_ir.contains(filter_ir_stripped) || r_stripped.contains(filter_ir_stripped));
            let match_smart = match_ref_rust(&r.import_reference, &filter_ir_clean);
            if !match_clean && !match_stripped && !match_smart {
                return false;
            }
        }
        true
    });

    rows.sort_by(|a, b| {
        let a_num = a.order_line.trim().parse::<i64>().unwrap_or(0);
        let b_num = b.order_line.trim().parse::<i64>().unwrap_or(0);
        (&a.import_reference, &a.grn, a_num, &a.order_line, &a.codigo_item)
            .cmp(&(&b.import_reference, &b.grn, b_num, &b.order_line, &b.codigo_item))
    });

    let response = InboundReconciliationResponse {
        data: rows,
        archive_versions,
        snapshot_versions,
    };

    if is_active_view {
        if let Ok(mut guard) = ACTIVE_RECONCILIATION_CACHE.write() {
            *guard = Some((Instant::now(), response.clone()));
        }
    }

    Ok(response)
}

pub fn get_inbound_ir_stats_data_rust(
    import_ref: &str,
    po_json_path: &str,
    grn_json_path: &str,
) -> InboundIrStatsResponse {
    let ir_clean = import_ref.trim().to_uppercase();
    if ir_clean.is_empty() {
        return InboundIrStatsResponse {
            source: "none".to_string(),
            expected_items: Vec::new(),
            po_items: Vec::new(),
            associated_grns: Vec::new(),
            grn_detail_expected: HashMap::new(),
            waybill: String::new(),
        };
    }

    let po_json = read_cached_json_file(po_json_path, &PO_CACHE);
    let grn_json = read_cached_json_file(grn_json_path, &GRN_CACHE);

    let mut found_wb = String::new();
    let mut po_items = Vec::new();
    let mut associated_grns: HashSet<String> = HashSet::new();

    // 1. Extraer PO items y GRNs asociadas desde po_lookup.json
    if let Some(ref po) = po_json {
        let parse_po_items = |wb_val: &str, items_arr: &Vec<Value>, found_wb: &mut String, po_items: &mut Vec<InboundIrStatsPoItem>, associated_grns: &mut HashSet<String>| {
            if found_wb.is_empty() && !wb_val.is_empty() {
                *found_wb = wb_val.to_string();
            }
            for item in items_arr {
                let code = item.get("item_code").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                let qty = item.get("qty").and_then(|v| v.as_f64())
                    .or_else(|| item.get("qty").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
                    .unwrap_or(0.0);
                let grn = item.get("grn").and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                let cust_ref = item.get("customer_ref").or_else(|| item.get("order_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
                if !code.is_empty() {
                    if !grn.is_empty() {
                        for g in grn.split(',') {
                            let g_clean = g.trim().to_uppercase();
                            if !g_clean.is_empty() && g_clean != "N/A" && g_clean != "SIN GRN" {
                                associated_grns.insert(g_clean);
                            }
                        }
                    }
                    po_items.push(InboundIrStatsPoItem {
                        item_code: code,
                        qty,
                        grn,
                        customer_ref: cust_ref,
                    });
                }
            }
        };

        if let Some(ir_map) = po.get("ir_to_data").and_then(|v| v.as_object()) {
            for (k, data_obj) in ir_map {
                if match_ref_rust(k, &ir_clean) {
                    let wb = data_obj.get("waybill").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                        parse_po_items(wb, items, &mut found_wb, &mut po_items, &mut associated_grns);
                        break;
                    }
                }
            }
        }

        if po_items.is_empty() {
            if let Some(wb_map) = po.get("wb_to_data").and_then(|v| v.as_object()) {
                for (wb_raw, data_obj) in wb_map {
                    let ir = data_obj.get("import_ref").and_then(|v| v.as_str()).unwrap_or("");
                    if match_ref_rust(ir, &ir_clean) {
                        if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                            parse_po_items(wb_raw, items, &mut found_wb, &mut po_items, &mut associated_grns);
                            break;
                        }
                    }
                }
            }
        }
    }

    // 2. Extraer líneas del Reporte 280 (Prioridad 1)
    let mut grouped_280: HashMap<String, f64> = HashMap::new();
    let mut grn_detail_expected: HashMap<String, HashMap<String, f64>> = HashMap::new();

    if let Some(arr) = grn_json.as_ref().and_then(|v| v.as_array()) {
        for row in arr {
            let item_code = row.get("Item_Code").or_else(|| row.get("item_code")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let grn = row.get("GRN_Number").or_else(|| row.get("grn_number")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let r_ir = row.get("Import_Reference").or_else(|| row.get("import_reference")).and_then(|v| v.as_str()).unwrap_or("").trim().to_uppercase();
            let qty = row.get("Quantity").or_else(|| row.get("quantity")).and_then(|v| v.as_f64()).unwrap_or(0.0);

            if item_code.is_empty() {
                continue;
            }

            let matches = (!associated_grns.is_empty() && !grn.is_empty() && associated_grns.contains(&grn))
                || (!r_ir.is_empty() && match_ref_rust(&r_ir, &ir_clean));

            if matches {
                *grouped_280.entry(item_code.clone()).or_insert(0.0) += qty;
                if !grn.is_empty() {
                    let map_for_item = grn_detail_expected.entry(item_code).or_default();
                    *map_for_item.entry(grn).or_insert(0.0) += qty;
                }
            }
        }
    }

    // 3. Determinar fuente: 280 vs PO Extractor (Prioridad 280, Fallback PO Extractor)
    let has_280_qty = grouped_280.values().sum::<f64>() > 0.0;
    let (source, expected_items) = if has_280_qty {
        let items_vec = grouped_280.into_iter().map(|(code, qty)| InboundIrStatsExpectedItem {
            item_code: code,
            total_expected: qty,
        }).collect();
        ("280".to_string(), items_vec)
    } else if !po_items.is_empty() {
        let mut grouped_po: HashMap<String, f64> = HashMap::new();
        for it in &po_items {
            *grouped_po.entry(it.item_code.clone()).or_insert(0.0) += it.qty;
        }
        let items_vec = grouped_po.into_iter().map(|(code, qty)| InboundIrStatsExpectedItem {
            item_code: code,
            total_expected: qty,
        }).collect();
        ("po_extractor".to_string(), items_vec)
    } else {
        ("none".to_string(), Vec::new())
    };

    let associated_grns_vec: Vec<String> = associated_grns.into_iter().collect();

    InboundIrStatsResponse {
        source,
        expected_items,
        po_items,
        associated_grns: associated_grns_vec,
        grn_detail_expected,
        waybill: found_wb,
    }
}

pub fn get_inbound_expected_bulk_rust(
    items: Vec<InboundExpectedQueryItem>,
    po_json_path: &str,
    grn_json_path: &str,
) -> HashMap<String, f64> {
    let mut result: HashMap<String, f64> = HashMap::new();
    if items.is_empty() {
        return result;
    }

    let mut ir_cache: HashMap<String, InboundIrStatsResponse> = HashMap::new();

    for it in &items {
        let ir = it.import_ref.trim().to_uppercase();
        let code = it.item_code.trim().to_uppercase();
        if ir.is_empty() || code.is_empty() {
            continue;
        }

        let stats = ir_cache.entry(ir.clone()).or_insert_with(|| {
            get_inbound_ir_stats_data_rust(&ir, po_json_path, grn_json_path)
        });

        let mut expected = 0.0;
        for exp in &stats.expected_items {
            if exp.item_code == code {
                expected = exp.total_expected;
                break;
            }
        }
        let key = format!("{}|{}", code, it.import_ref);
        result.insert(key, expected);
    }

    result
}

pub fn unarchive_logs_version_db(conn: &Connection, version_date: &str) -> Result<usize> {
    let v = version_date.trim();
    let rows = conn.execute(
        "UPDATE inbound_logs SET archived_at = NULL WHERE version_date = ?1 OR archived_at LIKE ?2",
        params![v, format!("{}%", v)],
    )?;
    invalidate_inbound_reconciliation_cache();
    Ok(rows)
}

pub fn restore_inbound_rows_bulk_db(conn: &Connection, ids: &[i64]) -> Result<usize> {
    let mut count = 0;
    for id in ids {
        count += conn.execute("UPDATE inbound_logs SET archived_at = NULL WHERE id = ?1", params![id])?;
    }
    invalidate_inbound_reconciliation_cache();
    Ok(count)
}

pub fn delete_inbound_rows_bulk_db(conn: &Connection, ids: &[i64]) -> Result<usize> {
    let mut count = 0;
    for id in ids {
        count += conn.execute("DELETE FROM inbound_logs WHERE id = ?1", params![id])?;
    }
    invalidate_inbound_reconciliation_cache();
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE inbound_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                import_reference TEXT NOT NULL,
                waybill TEXT,
                item_code TEXT NOT NULL,
                item_description TEXT,
                bin_location TEXT,
                relocated_bin TEXT,
                qty_received REAL DEFAULT 0.0,
                qty_grn REAL DEFAULT 0.0,
                difference REAL DEFAULT 0.0,
                username TEXT,
                client_id TEXT UNIQUE,
                archived_at TEXT,
                version_date TEXT
            );
            CREATE TABLE inbound_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_type TEXT,
                import_reference TEXT,
                item_code TEXT,
                message TEXT,
                severity TEXT,
                resolved INTEGER DEFAULT 0,
                timestamp TEXT
            );
        ").unwrap();
        conn
    }

    #[test]
    fn test_resolve_alerts_bulk() {
        let conn = setup_test_db();
        conn.execute("INSERT INTO inbound_alerts (alert_type, resolved) VALUES ('test', 0)", []).unwrap();
        conn.execute("INSERT INTO inbound_alerts (alert_type, resolved) VALUES ('test', 0)", []).unwrap();

        let resolved = resolve_alerts_bulk_in_db(&conn, &[1, 2]).unwrap();
        assert_eq!(resolved, 2);

        let unresolved: i64 = conn.query_row("SELECT COUNT(*) FROM inbound_alerts WHERE resolved = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(unresolved, 0);
    }

    #[test]
    fn test_save_log_deduplication() {
        let conn = setup_test_db();
        let log1 = LogInbound {
            id: None,
            timestamp: "2026-08-16 10:00:00".to_string(),
            import_reference: "IR-100".to_string(),
            waybill: Some("WB-100".to_string()),
            item_code: "SKU001".to_string(),
            item_description: Some("Item 1".to_string()),
            bin_location: Some("A-01".to_string()),
            relocated_bin: None,
            qty_received: 10.0,
            qty_grn: 10.0,
            difference: 0.0,
            username: Some("admin".to_string()),
            client_id: Some("UUID-XYZ-123".to_string()),
            archived_at: None,
            version_date: None,
        };

        let res1 = save_log_to_db(&conn, log1.clone(), "", "").unwrap();
        assert!(res1.id.is_some());

        // Intento con el mismo client_id
        let res2 = save_log_to_db(&conn, log1, "", "").unwrap();
        assert_eq!(res1.id, res2.id);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM inbound_logs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_find_item_inbound_master() {
        let conn = setup_test_db();
        conn.execute("
            CREATE TABLE inventory_items (
                item_code TEXT PRIMARY KEY,
                description TEXT,
                bin_location TEXT,
                additional_bins TEXT DEFAULT '',
                system_qty REAL DEFAULT 0.0,
                unit_cost REAL DEFAULT 0.0,
                weight_per_unit REAL DEFAULT 0.0,
                sic_code TEXT DEFAULT '0',
                length_cm REAL DEFAULT 0.0,
                width_cm REAL DEFAULT 0.0,
                height_cm REAL DEFAULT 0.0,
                volume_cm3 REAL DEFAULT 0.0,
                abc_code TEXT DEFAULT '',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        ", []).unwrap();

        conn.execute("
            INSERT INTO inventory_items (item_code, description, bin_location, additional_bins, weight_per_unit, sic_code, abc_code)
            VALUES ('.>RU18278', 'CABIN RETROFIT KIT LH514 OP', 'RA81C', 'EE8E, RC51B', 4.054, 'L', 'B');
        ", []).unwrap();

        // 1. Búsqueda exacta
        let res_exact = find_item_inbound(&conn, ".>RU18278", None, "nonexistent.json", "nonexistent.json").unwrap();
        assert_eq!(res_exact.item_code, ".>RU18278");
        assert_eq!(res_exact.description, "CABIN RETROFIT KIT LH514 OP");
        assert_eq!(res_exact.bin_location, "RA81C");
        assert_eq!(res_exact.additional_bins, "EE8E, RC51B");
        assert_eq!(res_exact.item_type, "B");
        assert_eq!(res_exact.sic_code, "L");

        // 2. Búsqueda flexible (sin símbolos)
        let res_flex = find_item_inbound(&conn, "RU18278", None, "nonexistent.json", "nonexistent.json").unwrap();
        assert_eq!(res_flex.item_code, ".>RU18278");
        assert_eq!(res_flex.description, "CABIN RETROFIT KIT LH514 OP");
        assert_eq!(res_flex.bin_location, "RA81C");
        assert_eq!(res_flex.additional_bins, "EE8E, RC51B");
        assert_eq!(res_flex.item_type, "B");
        assert_eq!(res_flex.sic_code, "L");

        // 3. Ítem sin ubicación registrada (debe sugerir bin de slotting)
        conn.execute("
            INSERT INTO inventory_items (item_code, description, bin_location, additional_bins, weight_per_unit, sic_code, abc_code)
            VALUES ('NOBIN01', 'SMALL FASTENER SCREW', 'N/A', '', 0.05, 'W', 'A');
        ", []).unwrap();

        let res_nobin = find_item_inbound(&conn, "NOBIN01", None, "./data/po_lookup.json", "./data/grn_master_data.json").unwrap();
        assert_eq!(res_nobin.item_code, "NOBIN01");
        assert_eq!(res_nobin.bin_location, "N/A");
        assert!(res_nobin.suggested_bin.is_some());
    }

    #[test]
    fn test_get_inbound_reconciliation_view() {
        let conn = setup_test_db();
        conn.execute("
            INSERT INTO inbound_logs (
                timestamp, import_reference, waybill, item_code, item_description,
                bin_location, relocated_bin, qty_received, qty_grn, difference,
                username, client_id, archived_at, version_date
            ) VALUES (
                '2026-08-16 19:33:08', '26-0594', 'US107278172', 'BG00866933', 'ENGINE',
                'PISO8', '', 1.0, 1.0, 0.0, 'admin', 'client-1', NULL, '2026-08-16'
            );
        ", []).unwrap();

        let temp_dir = std::env::temp_dir().join("logix_test_inbound");
        let _ = std::fs::create_dir_all(&temp_dir);
        let po_path = temp_dir.join("po_lookup.json");
        let grn_path = temp_dir.join("grn_master_data.json");
        std::fs::write(&po_path, "{}").unwrap();
        std::fs::write(&grn_path, r#"[{"Item_Code":"BG00866933","Item_Description":"ENGINE","Quantity":1.0,"GRN_Number":"22864","Order_Number":"123","Order_Line":"1","Import_Reference":"26-0594","Waybill":"US107278172"}]"#).unwrap();

        let res = get_inbound_reconciliation_view(
            &conn,
            po_path.to_str().unwrap(),
            grn_path.to_str().unwrap(),
            None,
            None,
            Some("22864".to_string()),
            None,
            Some("26-0594".to_string()),
            false,
        ).unwrap();

        assert_eq!(res.data.len(), 1);
        let row = &res.data[0];
        assert_eq!(row.codigo_item, "BG00866933");
        assert_eq!(row.descripcion, "ENGINE");
        assert_eq!(row.import_reference, "26-0594");
        assert_eq!(row.waybill, "US107278172");
        assert_eq!(row.grn, "22864");
        assert_eq!(row.order_line, "1");
        assert_eq!(row.cant_esperada, 1.0);
        assert_eq!(row.cant_recibida, 1.0);
        assert_eq!(row.diferencia, 0.0);
        assert!(!row.grn.contains(','));
    }

    #[test]
    fn test_order_line_not_polluted_by_customer_ref_or_order_number() {
        let conn = setup_test_db();

        let temp_dir = std::env::temp_dir().join("logix_test_inbound_order_line");
        let _ = std::fs::create_dir_all(&temp_dir);
        let po_path = temp_dir.join("po_lookup.json");
        let grn_path = temp_dir.join("grn_master_data.json");

        // Reporte 280 has an item with order_number "N029180" but Order_Line is empty ""
        let grn_content = r#"[
            {
                "Item_Code": "ITEM_NO_LINE",
                "Item_Description": "VALVE",
                "Quantity": 2.0,
                "GRN_Number": "23061",
                "Order_Number": "N029180",
                "Order_Line": "",
                "Import_Reference": "26-0640",
                "Waybill": "WB999"
            }
        ]"#;
        std::fs::write(&po_path, "{}").unwrap();
        std::fs::write(&grn_path, grn_content).unwrap();

        let res = get_inbound_reconciliation_view(
            &conn,
            po_path.to_str().unwrap(),
            grn_path.to_str().unwrap(),
            None,
            None,
            Some("23061".to_string()),
            None,
            Some("26-0640".to_string()),
            false,
        ).unwrap();

        assert_eq!(res.data.len(), 1);
        let row = &res.data[0];
        assert_eq!(row.codigo_item, "ITEM_NO_LINE");
        // Must be "-" and NEVER "N029180" or customer_ref!
        assert_eq!(row.order_line, "-");
    }

    #[test]
    fn test_order_line_resolved_from_po_lookup() {
        let conn = setup_test_db();

        let temp_dir = std::env::temp_dir().join("logix_test_po_lookup_order_line");
        let _ = std::fs::create_dir_all(&temp_dir);
        let po_path = temp_dir.join("po_lookup.json");
        let grn_path = temp_dir.join("grn_master_data.json");

        // po_lookup has an item with order_line "1"
        let po_content = r#"{
            "ir_to_data": {
                "26-0599": {
                    "waybill": "3599866303",
                    "items": [
                        {
                            "item_code": "D724783.04",
                            "qty": "1",
                            "grn": "22854",
                            "order_line": "1",
                            "order_number": "R028603",
                            "customer_ref": "R028603"
                        }
                    ]
                }
            }
        }"#;
        std::fs::write(&po_path, po_content).unwrap();
        std::fs::write(&grn_path, "[]").unwrap();

        let res = get_inbound_reconciliation_view(
            &conn,
            po_path.to_str().unwrap(),
            grn_path.to_str().unwrap(),
            None,
            None,
            Some("22854".to_string()),
            None,
            Some("26-0599".to_string()),
            false,
        ).unwrap();

        assert_eq!(res.data.len(), 1);
        let row = &res.data[0];
        assert_eq!(row.codigo_item, "D724783.04");
        assert_eq!(row.order_line, "1");
    }

    #[test]
    fn test_save_and_retrieve_grn_reconciliation_snapshot() {
        let mut conn = setup_test_db();
        conn.execute_batch("
            CREATE TABLE saved_grn_reconciliations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grn_number TEXT NOT NULL,
                import_reference TEXT NOT NULL,
                waybill TEXT DEFAULT '',
                total_lines INTEGER DEFAULT 0,
                total_expected REAL DEFAULT 0.0,
                total_received REAL DEFAULT 0.0,
                total_difference REAL DEFAULT 0.0,
                status TEXT DEFAULT 'CONCILIADO',
                reconciled_by TEXT NOT NULL,
                reconciled_at TEXT NOT NULL,
                notes TEXT DEFAULT ''
            );
            CREATE TABLE saved_grn_reconciliation_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reconciliation_id INTEGER NOT NULL,
                grn_number TEXT NOT NULL,
                import_reference TEXT NOT NULL,
                waybill TEXT DEFAULT '',
                order_line TEXT DEFAULT '',
                item_code TEXT NOT NULL,
                description TEXT DEFAULT '',
                location TEXT DEFAULT '',
                relocated_bin TEXT DEFAULT '',
                qty_expected REAL DEFAULT 0.0,
                qty_received REAL DEFAULT 0.0,
                difference REAL DEFAULT 0.0,
                difference_reason TEXT DEFAULT '',
                operator_comment TEXT DEFAULT '',
                reconciled_at TEXT NOT NULL,
                FOREIGN KEY (reconciliation_id) REFERENCES saved_grn_reconciliations(id) ON DELETE CASCADE
            );
        ").unwrap();

        let payload = SaveGRNReconciliationPayload {
            grn_number: "22864".to_string(),
            import_reference: "26-0594".to_string(),
            waybill: Some("US107278172".to_string()),
            username: "operador1".to_string(),
            notes: Some("Cierre conforme sin novedades".to_string()),
            items: vec![
                SavedGRNReconciliationItemPayload {
                    grn_number: "22864".to_string(),
                    import_reference: "26-0594".to_string(),
                    waybill: Some("US107278172".to_string()),
                    order_line: Some("1".to_string()),
                    item_code: "BG00866933".to_string(),
                    description: Some("ENGINE".to_string()),
                    location: Some("PISO8".to_string()),
                    relocated_bin: None,
                    qty_expected: 1.0,
                    qty_received: 1.0,
                    difference: 0.0,
                    difference_reason: Some("Conforme".to_string()),
                    operator_comment: None,
                },
                SavedGRNReconciliationItemPayload {
                    grn_number: "22864".to_string(),
                    import_reference: "26-0594".to_string(),
                    waybill: Some("US107278172".to_string()),
                    order_line: Some("2".to_string()),
                    item_code: "BG00123456".to_string(),
                    description: Some("FILTER".to_string()),
                    location: Some("RA81C".to_string()),
                    relocated_bin: None,
                    qty_expected: 5.0,
                    qty_received: 4.0,
                    difference: -1.0,
                    difference_reason: Some("Faltante en Origen".to_string()),
                    operator_comment: Some("Caja llegó incompleta".to_string()),
                }
            ],
        };

        let recon_id = save_grn_reconciliation_snapshot_in_db(&mut conn, payload).unwrap();
        assert!(recon_id > 0);

        // Listar conciliaciones guardadas
        let list = get_saved_grn_reconciliations_list_from_db(&conn, Some("22864".to_string()), None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].grn_number, "22864");
        assert_eq!(list[0].total_lines, 2);
        assert_eq!(list[0].total_expected, 6.0);
        assert_eq!(list[0].total_received, 5.0);
        assert_eq!(list[0].total_difference, -1.0);
        assert_eq!(list[0].status, "CON_DIFERENCIAS");

        // Obtener detalle completo de la foto histórica
        let detail = get_saved_grn_reconciliation_detail_from_db(&conn, recon_id).unwrap().unwrap();
        assert_eq!(detail.header.id, recon_id);
        assert_eq!(detail.items.len(), 2);
        assert_eq!(detail.items[0].item_code, "BG00866933");
        assert_eq!(detail.items[1].difference_reason, "Faltante en Origen");
        assert_eq!(detail.items[1].operator_comment, "Caja llegó incompleta");

        // Eliminar registro
        delete_saved_grn_reconciliation_from_db(&conn, recon_id).unwrap();
        let list_after = get_saved_grn_reconciliations_list_from_db(&conn, None, None).unwrap();
        assert_eq!(list_after.len(), 0);
    }

    #[test]
    fn test_reconciliation_cascade_and_autorecovery() {
        let conn = setup_test_db();

        // Insertar logs de bodega:
        // 1) 8 unidades físicas para IR-TEST, SKU-CASCADE
        // 2) 4 unidades físicas para IR-RECOVERED, SKU-UNMAPPED
        conn.execute("
            INSERT INTO inbound_logs (
                timestamp, import_reference, waybill, item_code, item_description,
                bin_location, relocated_bin, qty_received, qty_grn, difference,
                username, client_id, archived_at, version_date
            ) VALUES
            ('2026-10-29 10:00:00', 'IR-TEST', 'WB-TEST', 'SKU-CASCADE', 'CASCADE ITEM', 'BIN-1', '', 8.0, 10.0, -2.0, 'admin', 'c1', NULL, '2026-10-29'),
            ('2026-10-29 10:05:00', 'IR-RECOVERED', 'WB-REC', 'SKU-UNMAPPED', 'RECOVERED ITEM', 'BIN-2', '', 4.0, 4.0, 0.0, 'admin', 'c2', NULL, '2026-10-29');
        ", []).unwrap();

        let temp_dir = std::env::temp_dir().join("logix_test_cascade");
        let _ = std::fs::create_dir_all(&temp_dir);
        let po_path = temp_dir.join("po_lookup.json");
        let grn_path = temp_dir.join("grn_master_data.json");
        std::fs::write(&po_path, "{}").unwrap();

        // 2 líneas para SKU-CASCADE (Exp 5 y Exp 5) + 1 línea para SKU-UNMAPPED sin IR en 280
        let grn_content = r#"[
            {"Item_Code":"SKU-CASCADE","Item_Description":"CASCADE ITEM","Quantity":5.0,"GRN_Number":"GRN-1","Order_Number":"O1","Order_Line":"1","Import_Reference":"IR-TEST","Waybill":"WB-TEST"},
            {"Item_Code":"SKU-CASCADE","Item_Description":"CASCADE ITEM","Quantity":5.0,"GRN_Number":"GRN-2","Order_Number":"O2","Order_Line":"2","Import_Reference":"IR-TEST","Waybill":"WB-TEST"},
            {"Item_Code":"SKU-UNMAPPED","Item_Description":"RECOVERED ITEM","Quantity":4.0,"GRN_Number":"GRN-UNMAPPED","Order_Number":"O3","Order_Line":"1","Import_Reference":"","Waybill":""}
        ]"#;
        std::fs::write(&grn_path, grn_content).unwrap();

        let res = get_inbound_reconciliation_view(
            &conn,
            po_path.to_str().unwrap(),
            grn_path.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
            false,
        ).unwrap();

        // 1. Verificar cascada en SKU-CASCADE:
        let r1 = res.data.iter().find(|r| r.grn == "GRN-1").expect("GRN-1 exists");
        let r2 = res.data.iter().find(|r| r.grn == "GRN-2").expect("GRN-2 exists");

        // Fila 1 debe absorber min(5.0, 8.0) = 5.0 (diferencia 0.0)
        assert_eq!(r1.cant_esperada, 5.0);
        assert_eq!(r1.cant_recibida, 5.0);
        assert_eq!(r1.diferencia, 0.0);
        assert_eq!(r1.total_esperado_ir, 10.0);
        assert_eq!(r1.diferencia_real_ir, -2.0);

        // Fila 2 (última) debe absorber el remanente 8.0 - 5.0 = 3.0 (diferencia 3.0 - 5.0 = -2.0)
        assert_eq!(r2.cant_esperada, 5.0);
        assert_eq!(r2.cant_recibida, 3.0);
        assert_eq!(r2.diferencia, -2.0);
        assert_eq!(r2.total_esperado_ir, 10.0);
        assert_eq!(r2.diferencia_real_ir, -2.0);

        // 2. Verificar auto-recuperación de GRN-UNMAPPED:
        let r3 = res.data.iter().find(|r| r.grn == "GRN-UNMAPPED").expect("GRN-UNMAPPED exists");
        assert_eq!(r3.import_reference, "IR-RECOVERED");
        assert_eq!(r3.waybill, "WB-REC");
        assert_eq!(r3.cant_esperada, 4.0);
        assert_eq!(r3.cant_recibida, 4.0);
        assert_eq!(r3.diferencia, 0.0);
    }
}
