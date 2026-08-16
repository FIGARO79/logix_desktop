use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockItemResult {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub additional_bins: String,
    pub system_qty: f64,
    pub unit_cost: f64,
    pub weight_per_unit: f64,
    pub sic_code: String,
    pub abc_code: String,
    pub length_cm: f64,
    pub width_cm: f64,
    pub height_cm: f64,
    pub volume_cm3: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OccupancyStats {
    pub total_bins: usize,
    pub occupied_bins: usize,
    pub occupancy_rate: f64,
    pub total_skus: usize,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemMeasurementInput {
    pub item_code: String,
    pub length_cm: Option<f64>,
    pub width_cm: Option<f64>,
    pub height_cm: Option<f64>,
    pub volume_cm3: Option<f64>,
    pub weight_kg: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementResponse {
    pub success: bool,
    pub length_cm: f64,
    pub width_cm: f64,
    pub height_cm: f64,
    pub volume_cm3: f64,
    pub confidence: f64,
}

/// Búsqueda de stock con coincidencia parcial en código, descripción o ubicación
pub fn search_stock_items(conn: &Connection, query: &str) -> Result<Vec<StockItemResult>> {
    let clean_query = query.trim().to_uppercase();
    let q = format!("%{}%", clean_query);
    let exact = clean_query.clone();
    let starts_with = format!("{}%", clean_query);

    let mut stmt = conn.prepare(
        "SELECT item_code, description, bin_location, additional_bins, system_qty, unit_cost, weight_per_unit, sic_code, abc_code, length_cm, width_cm, height_cm, volume_cm3, updated_at
         FROM inventory_items
         WHERE UPPER(item_code) LIKE ?1 
            OR UPPER(description) LIKE ?1 
            OR UPPER(bin_location) LIKE ?1
            OR UPPER(additional_bins) LIKE ?1
         ORDER BY 
            CASE 
                WHEN UPPER(item_code) = ?2 THEN 1
                WHEN UPPER(item_code) LIKE ?3 THEN 2
                ELSE 3
            END,
            item_code ASC
         LIMIT 100",
    )?;

    let iter = stmt.query_map(params![q, exact, starts_with], |row| {
        Ok(StockItemResult {
            item_code: row.get(0)?,
            description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            bin_location: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
            additional_bins: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            system_qty: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
            unit_cost: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
            weight_per_unit: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
            sic_code: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "0".to_string()),
            abc_code: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            length_cm: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
            width_cm: row.get::<_, Option<f64>>(10)?.unwrap_or(0.0),
            height_cm: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
            volume_cm3: row.get::<_, Option<f64>>(12)?.unwrap_or(0.0),
            updated_at: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }

    if list.is_empty() {
        let alpha_query: String = clean_query.chars().filter(|c| c.is_alphanumeric()).collect();
        if !alpha_query.is_empty() {
            let mut stmt_all = conn.prepare(
                "SELECT item_code, description, bin_location, additional_bins, system_qty, unit_cost, weight_per_unit, sic_code, abc_code, length_cm, width_cm, height_cm, volume_cm3, updated_at
                 FROM inventory_items",
            )?;
            let all_iter = stmt_all.query_map([], |row| {
                Ok(StockItemResult {
                    item_code: row.get(0)?,
                    description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    bin_location: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
                    additional_bins: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    system_qty: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    unit_cost: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    weight_per_unit: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                    sic_code: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "0".to_string()),
                    abc_code: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    length_cm: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                    width_cm: row.get::<_, Option<f64>>(10)?.unwrap_or(0.0),
                    height_cm: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                    volume_cm3: row.get::<_, Option<f64>>(12)?.unwrap_or(0.0),
                    updated_at: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                })
            })?;
            for item in all_iter.flatten() {
                let item_alpha: String = item.item_code.chars().filter(|c| c.is_alphanumeric()).collect();
                if item_alpha.to_uppercase().contains(&alpha_query) {
                    list.push(item);
                    if list.len() >= 50 {
                        break;
                    }
                }
            }
        }
    }

    Ok(list)
}

/// Obtiene todas las ubicaciones físicas registradas en el inventario local
pub fn get_valid_bins(conn: &Connection) -> Result<Vec<String>> {
    let mut bins = HashSet::new();

    // 1. Desde inventory_items
    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT bin_location FROM inventory_items WHERE bin_location IS NOT NULL AND bin_location != ''") {
        if let Ok(iter) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for b in iter.flatten() {
                let clean = b.trim().to_uppercase();
                if clean != "N/A" && clean != "SIN UBICACION" && !clean.is_empty() {
                    bins.insert(clean);
                }
            }
        }
    }

    // 2. Desde storage_locations
    if let Ok(mut stmt) = conn.prepare("SELECT bin_code FROM storage_locations") {
        if let Ok(iter) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for b in iter.flatten() {
                let clean = b.trim().to_uppercase();
                if !clean.is_empty() {
                    bins.insert(clean);
                }
            }
        }
    }

    let mut result: Vec<String> = bins.into_iter().collect();
    result.sort();
    Ok(result)
}

/// Calcula estadísticas de ocupación de bodega
pub fn get_occupancy_stats(conn: &Connection) -> Result<OccupancyStats> {
    let valid_bins = get_valid_bins(conn)?;
    let mut stmt_skus = conn.prepare("SELECT COUNT(*) FROM inventory_items")?;
    let total_skus: usize = stmt_skus.query_row([], |row| row.get(0)).unwrap_or(0);

    let occupied_bins = valid_bins.len();
    let total_bins = occupied_bins.max(100);
    let occupancy_rate = if total_bins > 0 {
        (occupied_bins as f64 / total_bins as f64) * 100.0
    } else {
        0.0
    };

    Ok(OccupancyStats {
        total_bins,
        occupied_bins,
        occupancy_rate,
        total_skus,
        categories: vec!["General".to_string(), "Alta Rotación".to_string(), "Pesados".to_string()],
    })
}

/// Guarda dimensiones y peso de un producto
pub fn save_item_measurement(conn: &Connection, input: ItemMeasurementInput) -> Result<MeasurementResponse> {
    let code = input.item_code.trim().to_uppercase();
    let length = input.length_cm.unwrap_or(20.0);
    let width = input.width_cm.unwrap_or(15.0);
    let height = input.height_cm.unwrap_or(10.0);
    let volume = input.volume_cm3.unwrap_or(length * width * height);
    let weight = input.weight_kg.unwrap_or(0.0);

    conn.execute(
        "UPDATE inventory_items SET
            length_cm = ?1,
            width_cm = ?2,
            height_cm = ?3,
            volume_cm3 = ?4,
            weight_per_unit = CASE WHEN ?5 > 0 THEN ?5 ELSE weight_per_unit END
         WHERE UPPER(item_code) = ?6",
        params![length, width, height, volume, weight, code],
    )?;

    Ok(MeasurementResponse {
        success: true,
        length_cm: length,
        width_cm: width,
        height_cm: height,
        volume_cm3: volume,
        confidence: 0.95,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditorZoneInfo {
    pub id: i64,
    pub username: String,
    pub assigned_zones: String,
    pub is_approved: bool,
}

/// Obtiene todos los pasillos configurados o inferidos de las ubicaciones
pub fn get_available_aisles_db(conn: &Connection) -> Result<Vec<String>> {
    let bins = get_valid_bins(conn)?;
    let mut aisles = HashSet::new();

    for b in bins {
        let parts: Vec<&str> = b.split('-').collect();
        if !parts.is_empty() {
            let aisle = parts[0].trim().to_uppercase();
            if !aisle.is_empty() {
                aisles.insert(aisle);
            }
        }
    }

    let mut result: Vec<String> = aisles.into_iter().collect();
    result.sort();
    if result.is_empty() {
        result = vec!["A".to_string(), "B".to_string(), "C".to_string(), "D".to_string(), "E".to_string()];
    }
    Ok(result)
}

/// Obtiene la lista de auditores con sus zonas asignadas
pub fn get_auditor_zones_db(conn: &Connection) -> Result<Vec<AuditorZoneInfo>> {
    let mut stmt = conn.prepare("SELECT id, username, assigned_zones, is_approved FROM users ORDER BY username")?;
    let iter = stmt.query_map([], |row| {
        let is_appr: i32 = row.get(3)?;
        Ok(AuditorZoneInfo {
            id: row.get(0)?,
            username: row.get(1)?,
            assigned_zones: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            is_approved: is_appr != 0,
        })
    })?;

    let mut list = Vec::new();
    for it in iter.flatten() {
        list.push(it);
    }
    Ok(list)
}

/// Asigna zonas/pasillos a un auditor
pub fn assign_auditor_zones_db(conn: &Connection, user_id: i64, assigned_zones: &str) -> Result<String> {
    let clean = assigned_zones.trim().to_uppercase();
    conn.execute(
        "UPDATE users SET assigned_zones = ?1 WHERE id = ?2",
        params![clean, user_id],
    )?;
    Ok(format!("Zonas/pasillos actualizados exitosamente."))
}
