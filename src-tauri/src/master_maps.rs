use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct MasterMapEntry {
    pub grn_number: String,
    pub import_reference: String,
    pub waybill: String,
}

/// Lee archivos de configuración local (JSON) y registros de SQLite para construir el mapa maestro GRN -> I.R. / Waybill
pub fn build_master_maps_rust(
    db_grns: Vec<(Option<String>, Option<String>, Option<String>)>,
    grn_json_path: &str,
    po_lookup_path: &str,
) -> Vec<MasterMapEntry> {
    let mut master_maps: Vec<MasterMapEntry> = Vec::new();

    // 1. Desde grn_master_data.json local
    if let Ok(data) = std::fs::read_to_string(grn_json_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&data) {
            if let Some(arr) = json.as_array() {
                for row in arr {
                    let ir = row.get("Import_Reference")
                        .or_else(|| row.get("import_reference"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim().to_uppercase();
                    let grn = row.get("GRN_Number")
                        .or_else(|| row.get("grn_number"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim().to_uppercase();
                    let wb = row.get("Waybill")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !ir.is_empty() && !grn.is_empty() {
                        master_maps.push(MasterMapEntry {
                            grn_number: grn,
                            import_reference: ir,
                            waybill: wb,
                        });
                    }
                }
            }
        }
    }

    // 2. Desde DB GRN Master en SQLite
    for (ir_raw, grn_raw, wb_raw) in db_grns {
        let ir = ir_raw.unwrap_or_default().trim().to_uppercase();
        let grns = grn_raw.unwrap_or_default();
        let wb = wb_raw.unwrap_or_default();
        if !ir.is_empty() && !grns.is_empty() {
            for g in grns.split(',') {
                let g_clean = g.trim().to_uppercase();
                if !g_clean.is_empty() {
                    master_maps.push(MasterMapEntry {
                        grn_number: g_clean,
                        import_reference: ir.clone(),
                        waybill: wb.clone(),
                    });
                }
            }
        }
    }

    // 3. Desde po_lookup.json local
    if let Ok(data) = std::fs::read_to_string(po_lookup_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&data) {
            if let Some(wb_to_data) = json.get("wb_to_data").and_then(|v| v.as_object()) {
                for (wb_raw, data_obj) in wb_to_data {
                    let ir = data_obj.get("import_ref")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim().to_uppercase();
                    let wb = wb_raw.trim().to_uppercase();
                    if !ir.is_empty() && !wb.is_empty() {
                        master_maps.push(MasterMapEntry {
                            grn_number: "".to_string(),
                            import_reference: ir.clone(),
                            waybill: wb.clone(),
                        });
                        if let Some(items) = data_obj.get("items").and_then(|v| v.as_array()) {
                            for item in items {
                                if let Some(grn_val) = item.get("grn").and_then(|v| v.as_str()) {
                                    for g in grn_val.split(',') {
                                        let g_clean = g.trim().to_uppercase();
                                        if !g_clean.is_empty() {
                                            master_maps.push(MasterMapEntry {
                                                grn_number: g_clean,
                                                import_reference: ir.clone(),
                                                waybill: wb.clone(),
                                            });
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

    master_maps
}
