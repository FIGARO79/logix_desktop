use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuración embebida de slotting (compilada en el binario como fallback)
const DEFAULT_SLOTTING_JSON: &str = include_str!("../../data/slotting_parameters.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinInfo {
    pub zone: Option<String>,
    pub aisle: Option<String>,
    pub level: i32,
    pub score: i32,
    pub spot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnoverInfo {
    pub spot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneRules {
    pub cantilever_keywords: String,
    pub minuteria_weight_max: String,
    pub heavy_weight_min: String,
    pub heavy_levels: String,
    pub high_rotation_levels: String,
    pub high_rotation_min_score: String,
    pub high_rotation_max_score: String,
    pub medium_rotation_levels: String,
    pub medium_rotation_min_score: String,
    pub medium_rotation_max_score: String,
    pub default_levels: String,
    pub exile_rack_levels: String,
    pub exile_sic_codes: String,
    pub minuteria_zone: String,
    pub exile_max_score: String,
}

impl Default for ZoneRules {
    fn default() -> Self {
        Self {
            cantilever_keywords: "ROD, INTEGRAL STEEL".to_string(),
            minuteria_weight_max: "0.1".to_string(),
            heavy_weight_min: "10".to_string(),
            heavy_levels: "3, 4, 5".to_string(),
            high_rotation_levels: "0, 1".to_string(),
            high_rotation_min_score: "1".to_string(),
            high_rotation_max_score: "10".to_string(),
            medium_rotation_levels: "2".to_string(),
            medium_rotation_min_score: "4".to_string(),
            medium_rotation_max_score: "6".to_string(),
            default_levels: "2".to_string(),
            exile_rack_levels: "2".to_string(),
            exile_sic_codes: "0, Z, L".to_string(),
            minuteria_zone: "Minuteria".to_string(),
            exile_max_score: "3".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MixLimits {
    pub minuteria_max_skus: String,
    pub nivel2_max_skus: String,
    pub otros_niveles_max_skus: String,
}

impl Default for MixLimits {
    fn default() -> Self {
        Self {
            minuteria_max_skus: "3".to_string(),
            nivel2_max_skus: "6".to_string(),
            otros_niveles_max_skus: "4".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDetails {
    pub bin_1: String,
    pub item_code: String,
    pub item_description: String,
    pub weight_per_unit: String,
}

#[derive(Debug)]
pub struct Candidate {
    pub bin: String,
    pub occupancy: i32,
    pub spot: String,
    pub score: i32,
}

pub fn get_suggested_bin_rust(
    storage: &HashMap<String, BinInfo>,
    turnover: &HashMap<String, TurnoverInfo>,
    zone_rules: &ZoneRules,
    mix_limits: &MixLimits,
    item_details: &ItemDetails,
    occupancy: &HashMap<String, i32>,
    sic_code_val: &str,
) -> Option<String> {
    let current_bin = item_details.bin_1.trim().to_uppercase();
    let sic_code = sic_code_val.trim().to_uppercase();

    let mut ideal_spot = turnover
        .get(&sic_code)
        .and_then(|t| t.spot.as_ref())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "cold".to_string());

    if sic_code == "W" || sic_code == "X" {
        ideal_spot = "hot".to_string();
    } else if sic_code == "Y" || sic_code == "K" {
        ideal_spot = "warm".to_string();
    } else if sic_code == "L" || sic_code == "Z" || sic_code == "0" {
        ideal_spot = "cold".to_string();
    }

    let description = item_details.item_description.to_uppercase();
    let cantilever_kw: Vec<String> = zone_rules.cantilever_keywords.split(',').map(|k| k.trim().to_uppercase()).filter(|k| !k.is_empty()).collect();
    let is_cantilever = cantilever_kw.iter().any(|kw| description.contains(kw));

    let minuteria_weight_max: f64 = zone_rules.minuteria_weight_max.parse().unwrap_or(0.1);
    let heavy_weight_min: f64 = zone_rules.heavy_weight_min.parse().unwrap_or(10.0);
    let heavy_levels: Vec<i32> = zone_rules.heavy_levels.split(',').map(|lvl| lvl.trim().parse().unwrap_or(0)).filter(|&lvl| lvl > 0).collect();

    let high_rotation_levels: Vec<i32> = zone_rules.high_rotation_levels.split(',').map(|lvl| lvl.trim().parse().unwrap_or(-1)).filter(|&lvl| lvl >= 0).collect();
    let high_rotation_min_score: i32 = zone_rules.high_rotation_min_score.parse().unwrap_or(1);
    let high_rotation_max_score: i32 = zone_rules.high_rotation_max_score.parse().unwrap_or(10);

    let default_levels: Vec<i32> = zone_rules.default_levels.split(',').map(|lvl| lvl.trim().parse().unwrap_or(0)).filter(|&lvl| lvl > 0).collect();

    let weight_val_clean = item_details.weight_per_unit.replace(',', "");
    let weight: f64 = weight_val_clean.parse().unwrap_or(0.0);

    let mut target_levels: Option<Vec<i32>> = None;
    let mut forbidden_zones: Vec<String> = Vec::new();
    let mut target_score_min: Option<i32> = None;
    let mut target_score_max: Option<i32> = None;

    let target_zone = if is_cantilever {
        Some("Cantilever".to_string())
    } else if weight > 0.0 && weight <= minuteria_weight_max {
        Some(zone_rules.minuteria_zone.trim().to_string())
    } else if weight > heavy_weight_min {
        target_levels = Some(heavy_levels);
        Some("Rack".to_string())
    } else if sic_code == "W" || sic_code == "X" {
        target_levels = Some(high_rotation_levels);
        target_score_min = Some(high_rotation_min_score);
        target_score_max = Some(high_rotation_max_score);
        Some("Rack".to_string())
    } else {
        target_levels = Some(default_levels);
        Some("Rack".to_string())
    };

    if target_zone.is_none() {
        forbidden_zones.push("Cantilever".to_string());
        forbidden_zones.push("Minuteria".to_string());
    }

    // Verificar si la ubicación actual ya es óptima
    if !current_bin.is_empty() {
        if let Some(info) = storage.get(&current_bin) {
            let current_zone = info.zone.as_deref().unwrap_or("Unknown").trim().to_uppercase();
            let matches_zone = target_zone.as_ref().map(|tz| tz.trim().to_uppercase() == current_zone).unwrap_or(true);
            let matches_levels = target_levels.as_ref().map(|tl| tl.contains(&info.level)).unwrap_or(true);

            if matches_zone && matches_levels {
                let current_spot = info.spot.as_ref().map(|s| s.to_lowercase()).unwrap_or_else(|| "cold".to_string());
                let current_score = info.score;
                let exile_max_score_val: i32 = zone_rules.exile_max_score.parse().unwrap_or(3);

                if current_spot == ideal_spot {
                    if ideal_spot == "hot" && current_score >= 8 {
                        return None;
                    } else if ideal_spot == "cold" && current_score <= exile_max_score_val {
                        return None;
                    } else if ideal_spot == "warm" {
                        return None;
                    }
                }
            }
        }
    }

    let limit_minuteria: i32 = mix_limits.minuteria_max_skus.parse().unwrap_or(3);
    let limit_n2: i32 = mix_limits.nivel2_max_skus.parse().unwrap_or(6);
    let limit_others: i32 = mix_limits.otros_niveles_max_skus.parse().unwrap_or(4);
    let minuteria_zone_upper = zone_rules.minuteria_zone.trim().to_uppercase();

    let mut candidates: Vec<Candidate> = Vec::new();

    for (bin_code, info) in storage {
        let zone = info.zone.as_deref().unwrap_or("Unknown");
        let zone_upper = zone.trim().to_uppercase();
        let level = info.level;
        let score = info.score;

        if forbidden_zones.iter().any(|fz| fz.trim().to_uppercase() == zone_upper) {
            continue;
        }

        if let Some(tz) = &target_zone {
            if tz.trim().to_uppercase() != zone_upper {
                continue;
            }
        }

        if let Some(tl) = &target_levels {
            if !tl.contains(&level) {
                continue;
            }
        }

        if let Some(s_min) = target_score_min {
            if score < s_min {
                continue;
            }
        }

        if let Some(s_max) = target_score_max {
            if score > s_max {
                continue;
            }
        }

        let current_items = *occupancy.get(&bin_code.to_uppercase()).unwrap_or(&0);

        let limit: i32 = if zone_upper == "MINUTERIA" || zone_upper == minuteria_zone_upper {
            limit_minuteria
        } else if level == 2 {
            limit_n2
        } else {
            limit_others
        };

        if current_items < limit {
            candidates.push(Candidate {
                bin: bin_code.clone(),
                occupancy: current_items,
                spot: info.spot.as_ref().map(|s| s.to_lowercase()).unwrap_or_else(|| "cold".to_string()),
                score,
            });
        }
    }

    if candidates.is_empty() {
        return None;
    }

    if ideal_spot == "hot" {
        candidates.sort_by(|a, b| {
            let a_is_hot = a.spot == "hot";
            let b_is_hot = b.spot == "hot";
            (!a_is_hot, -a.score, a.occupancy, &a.bin)
                .partial_cmp(&(!b_is_hot, -b.score, b.occupancy, &b.bin))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    } else if ideal_spot == "warm" {
        candidates.sort_by(|a, b| {
            let a_is_warm = a.spot == "warm";
            let b_is_warm = b.spot == "warm";
            (!a_is_warm, -a.score, a.occupancy, &a.bin)
                .partial_cmp(&(!b_is_warm, -b.score, b.occupancy, &b.bin))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    } else {
        candidates.sort_by(|a, b| {
            let a_is_cold = a.spot == "cold";
            let b_is_cold = b.spot == "cold";
            (!a_is_cold, a.score, a.occupancy, &a.bin)
                .partial_cmp(&(!b_is_cold, b.score, b.occupancy, &b.bin))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    Some(candidates[0].bin.clone())
}

pub fn load_slotting_config(path_str: &str) -> (
    HashMap<String, BinInfo>,
    HashMap<String, TurnoverInfo>,
    ZoneRules,
    MixLimits,
) {
    let mut storage = HashMap::new();
    let mut turnover = HashMap::new();
    let mut zone_rules = ZoneRules::default();
    let mut mix_limits = MixLimits::default();

    let content = std::fs::read_to_string(path_str).ok().or_else(|| {
        let fallback = format!("../{}", path_str.trim_start_matches("./"));
        std::fs::read_to_string(&fallback).ok()
    }).or_else(|| {
        eprintln!("[slotting] Archivo '{}' no encontrado en disco, usando configuración embebida por defecto.", path_str);
        Some(DEFAULT_SLOTTING_JSON.to_string())
    });

    if let Some(json_str) = content {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
            // 1. Storage bins
            if let Some(storage_obj) = val.get("storage").and_then(|v| v.as_object()) {
                for (bin_code, b_val) in storage_obj {
                    let zone = b_val.get("zone").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let aisle = b_val.get("aisle").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let spot = b_val.get("spot").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let level = b_val.get("level")
                        .and_then(|v| v.as_i64().map(|n| n as i32))
                        .or_else(|| b_val.get("level").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
                        .unwrap_or(0);
                    let score = b_val.get("score")
                        .and_then(|v| v.as_i64().map(|n| n as i32))
                        .or_else(|| b_val.get("score").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
                        .unwrap_or(0);

                    storage.insert(
                        bin_code.to_uppercase(),
                        BinInfo {
                            zone,
                            aisle,
                            level,
                            score,
                            spot,
                        },
                    );
                }
            }

            // 2. Turnover
            if let Some(turnover_obj) = val.get("turnover").and_then(|v| v.as_object()) {
                for (sic, t_val) in turnover_obj {
                    let spot = t_val.get("spot").and_then(|v| v.as_str()).map(|s| s.to_string());
                    turnover.insert(sic.to_uppercase(), TurnoverInfo { spot });
                }
            }

            // 3. Zone rules
            if let Some(zr) = val.get("zone_rules").and_then(|v| v.as_object()) {
                let get_str = |key: &str, def: &str| -> String {
                    zr.get(key)
                        .map(|v| {
                            if let Some(s) = v.as_str() {
                                s.to_string()
                            } else if let Some(n) = v.as_f64() {
                                n.to_string()
                            } else if let Some(i) = v.as_i64() {
                                i.to_string()
                            } else {
                                def.to_string()
                            }
                        })
                        .unwrap_or_else(|| def.to_string())
                };

                zone_rules.cantilever_keywords = get_str("cantilever_keywords", &zone_rules.cantilever_keywords);
                zone_rules.minuteria_weight_max = get_str("minuteria_weight_max", &zone_rules.minuteria_weight_max);
                zone_rules.heavy_weight_min = get_str("heavy_weight_min", &zone_rules.heavy_weight_min);
                zone_rules.heavy_levels = get_str("heavy_levels", &zone_rules.heavy_levels);
                zone_rules.high_rotation_levels = get_str("high_rotation_levels", &zone_rules.high_rotation_levels);
                zone_rules.high_rotation_min_score = get_str("high_rotation_min_score", &zone_rules.high_rotation_min_score);
                zone_rules.high_rotation_max_score = get_str("high_rotation_max_score", &zone_rules.high_rotation_max_score);
                zone_rules.medium_rotation_levels = get_str("medium_rotation_levels", &zone_rules.medium_rotation_levels);
                zone_rules.medium_rotation_min_score = get_str("medium_rotation_min_score", &zone_rules.medium_rotation_min_score);
                zone_rules.medium_rotation_max_score = get_str("medium_rotation_max_score", &zone_rules.medium_rotation_max_score);
                zone_rules.default_levels = get_str("default_levels", &zone_rules.default_levels);
                zone_rules.exile_rack_levels = get_str("exile_rack_levels", &zone_rules.exile_rack_levels);
                zone_rules.exile_sic_codes = get_str("exile_sic_codes", &zone_rules.exile_sic_codes);
                zone_rules.minuteria_zone = get_str("minuteria_zone", &zone_rules.minuteria_zone);
                zone_rules.exile_max_score = get_str("exile_max_score", &zone_rules.exile_max_score);
            }

            // 4. Mix limits
            if let Some(ml) = val.get("mix_limits").and_then(|v| v.as_object()) {
                let get_str = |key: &str, def: &str| -> String {
                    ml.get(key)
                        .map(|v| {
                            if let Some(s) = v.as_str() {
                                s.to_string()
                            } else if let Some(i) = v.as_i64() {
                                i.to_string()
                            } else {
                                def.to_string()
                            }
                        })
                        .unwrap_or_else(|| def.to_string())
                };
                mix_limits.minuteria_max_skus = get_str("minuteria_max_skus", &mix_limits.minuteria_max_skus);
                mix_limits.nivel2_max_skus = get_str("nivel2_max_skus", &mix_limits.nivel2_max_skus);
                mix_limits.otros_niveles_max_skus = get_str("otros_niveles_max_skus", &mix_limits.otros_niveles_max_skus);
            }
        }
    }

    (storage, turnover, zone_rules, mix_limits)
}

pub fn get_occupancy_from_db(conn: &rusqlite::Connection) -> HashMap<String, i32> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT UPPER(TRIM(bin_location)), COUNT(DISTINCT UPPER(TRIM(item_code)))
         FROM inventory_items
         WHERE bin_location IS NOT NULL
           AND bin_location != ''
           AND UPPER(bin_location) != 'N/A'
           AND UPPER(bin_location) != 'SIN UBICACION'
           AND system_qty > 0
         GROUP BY UPPER(TRIM(bin_location))"
    ) {
        if let Ok(iter) = stmt.query_map([], |row| {
            let bin: String = row.get(0)?;
            let count: i32 = row.get(1)?;
            Ok((bin, count))
        }) {
            for item in iter.flatten() {
                map.insert(item.0, item.1);
            }
        }
    }
    map
}

pub fn calculate_suggested_bin(
    conn: &rusqlite::Connection,
    slotting_json_path: &str,
    item_code: &str,
    description: &str,
    bin_location: &str,
    weight: f64,
    sic_code: &str,
) -> Option<String> {
    let (storage, turnover, zone_rules, mix_limits) = load_slotting_config(slotting_json_path);
    if storage.is_empty() {
        return None;
    }

    let occupancy = get_occupancy_from_db(conn);
    let item_details = ItemDetails {
        bin_1: bin_location.to_string(),
        item_code: item_code.to_string(),
        item_description: description.to_string(),
        weight_per_unit: weight.to_string(),
    };

    get_suggested_bin_rust(
        &storage,
        &turnover,
        &zone_rules,
        &mix_limits,
        &item_details,
        &occupancy,
        sic_code,
    )
}

/// Llena la tabla `storage_locations` con datos embebidos si está vacía.
/// Se invoca al iniciar la aplicación para garantizar datos de ocupación
/// incluso en instalaciones limpias del .exe.
pub fn seed_storage_locations_if_empty(conn: &rusqlite::Connection) {
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM storage_locations", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        return;
    }

    eprintln!("[slotting] storage_locations vacía, inicializando con datos embebidos...");
    let (storage, _, _, _) = load_slotting_config_from_str(DEFAULT_SLOTTING_JSON);

    if storage.is_empty() {
        eprintln!("[slotting] WARNING: La configuración embebida no contiene bins de storage.");
        return;
    }

    let _ = conn.execute("BEGIN", []);
    if let Ok(mut stmt) = conn.prepare(
        "INSERT OR IGNORE INTO storage_locations (bin_code, zone, aisle, level, spot, score) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ) {
        for (bin_code, info) in &storage {
            let _ = stmt.execute(rusqlite::params![
                bin_code,
                info.zone.as_deref().unwrap_or("General"),
                info.aisle.as_deref().unwrap_or(""),
                info.level,
                info.spot.as_deref().unwrap_or("cold"),
                info.score,
            ]);
        }
    }
    let _ = conn.execute("COMMIT", []);
    eprintln!("[slotting] Se insertaron {} ubicaciones en storage_locations.", storage.len());
}

/// Versión interna que parsea directamente desde un string JSON.
fn load_slotting_config_from_str(json_str: &str) -> (
    HashMap<String, BinInfo>,
    HashMap<String, TurnoverInfo>,
    ZoneRules,
    MixLimits,
) {
    let mut storage = HashMap::new();
    let mut turnover = HashMap::new();
    let mut zone_rules = ZoneRules::default();
    let mut mix_limits = MixLimits::default();

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
        if let Some(storage_obj) = val.get("storage").and_then(|v| v.as_object()) {
            for (bin_code, b_val) in storage_obj {
                let zone = b_val.get("zone").and_then(|v| v.as_str()).map(|s| s.to_string());
                let aisle = b_val.get("aisle").and_then(|v| v.as_str()).map(|s| s.to_string());
                let spot = b_val.get("spot").and_then(|v| v.as_str()).map(|s| s.to_string());
                let level = b_val.get("level")
                    .and_then(|v| v.as_i64().map(|n| n as i32))
                    .or_else(|| b_val.get("level").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
                    .unwrap_or(0);
                let score = b_val.get("score")
                    .and_then(|v| v.as_i64().map(|n| n as i32))
                    .or_else(|| b_val.get("score").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
                    .unwrap_or(0);
                storage.insert(bin_code.to_uppercase(), BinInfo { zone, aisle, level, score, spot });
            }
        }
        if let Some(turnover_obj) = val.get("turnover").and_then(|v| v.as_object()) {
            for (sic, t_val) in turnover_obj {
                let spot = t_val.get("spot").and_then(|v| v.as_str()).map(|s| s.to_string());
                turnover.insert(sic.to_uppercase(), TurnoverInfo { spot });
            }
        }
        if let Some(zr) = val.get("zone_rules").and_then(|v| v.as_object()) {
            let get_str = |key: &str, def: &str| -> String {
                zr.get(key).map(|v| {
                    if let Some(s) = v.as_str() { s.to_string() }
                    else if let Some(n) = v.as_f64() { n.to_string() }
                    else if let Some(i) = v.as_i64() { i.to_string() }
                    else { def.to_string() }
                }).unwrap_or_else(|| def.to_string())
            };
            zone_rules.cantilever_keywords = get_str("cantilever_keywords", &zone_rules.cantilever_keywords);
            zone_rules.minuteria_weight_max = get_str("minuteria_weight_max", &zone_rules.minuteria_weight_max);
            zone_rules.heavy_weight_min = get_str("heavy_weight_min", &zone_rules.heavy_weight_min);
            zone_rules.heavy_levels = get_str("heavy_levels", &zone_rules.heavy_levels);
            zone_rules.high_rotation_levels = get_str("high_rotation_levels", &zone_rules.high_rotation_levels);
            zone_rules.high_rotation_min_score = get_str("high_rotation_min_score", &zone_rules.high_rotation_min_score);
            zone_rules.high_rotation_max_score = get_str("high_rotation_max_score", &zone_rules.high_rotation_max_score);
            zone_rules.medium_rotation_levels = get_str("medium_rotation_levels", &zone_rules.medium_rotation_levels);
            zone_rules.medium_rotation_min_score = get_str("medium_rotation_min_score", &zone_rules.medium_rotation_min_score);
            zone_rules.medium_rotation_max_score = get_str("medium_rotation_max_score", &zone_rules.medium_rotation_max_score);
            zone_rules.default_levels = get_str("default_levels", &zone_rules.default_levels);
            zone_rules.exile_rack_levels = get_str("exile_rack_levels", &zone_rules.exile_rack_levels);
            zone_rules.exile_sic_codes = get_str("exile_sic_codes", &zone_rules.exile_sic_codes);
            zone_rules.minuteria_zone = get_str("minuteria_zone", &zone_rules.minuteria_zone);
            zone_rules.exile_max_score = get_str("exile_max_score", &zone_rules.exile_max_score);
        }
        if let Some(ml) = val.get("mix_limits").and_then(|v| v.as_object()) {
            let get_str = |key: &str, def: &str| -> String {
                ml.get(key).map(|v| {
                    if let Some(s) = v.as_str() { s.to_string() }
                    else if let Some(i) = v.as_i64() { i.to_string() }
                    else { def.to_string() }
                }).unwrap_or_else(|| def.to_string())
            };
            mix_limits.minuteria_max_skus = get_str("minuteria_max_skus", &mix_limits.minuteria_max_skus);
            mix_limits.nivel2_max_skus = get_str("nivel2_max_skus", &mix_limits.nivel2_max_skus);
            mix_limits.otros_niveles_max_skus = get_str("otros_niveles_max_skus", &mix_limits.otros_niveles_max_skus);
        }
    }

    (storage, turnover, zone_rules, mix_limits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slotting_heavy_item() {
        let mut storage = HashMap::new();
        storage.insert("A-01-01".to_string(), BinInfo { zone: Some("Rack".to_string()), aisle: Some("01".to_string()), level: 1, score: 5, spot: Some("hot".to_string()) });
        storage.insert("A-01-03".to_string(), BinInfo { zone: Some("Rack".to_string()), aisle: Some("01".to_string()), level: 3, score: 5, spot: Some("warm".to_string()) });

        let turnover = HashMap::new();
        let zone_rules = ZoneRules::default();
        let mix_limits = MixLimits::default();
        let occupancy = HashMap::new();

        let item = ItemDetails {
            bin_1: "A-01-01".to_string(),
            item_code: "HEAVY01".to_string(),
            item_description: "Heavy Motor".to_string(),
            weight_per_unit: "25.0".to_string(),
        };

        let suggested = get_suggested_bin_rust(&storage, &turnover, &zone_rules, &mix_limits, &item, &occupancy, "X");
        assert_eq!(suggested, Some("A-01-03".to_string()));
    }

    #[test]
    fn test_slotting_minuteria_item() {
        let mut storage = HashMap::new();
        storage.insert("M-01-01".to_string(), BinInfo { zone: Some("Minuteria".to_string()), aisle: Some("01".to_string()), level: 1, score: 8, spot: Some("hot".to_string()) });
        storage.insert("A-01-01".to_string(), BinInfo { zone: Some("Rack".to_string()), aisle: Some("01".to_string()), level: 1, score: 8, spot: Some("hot".to_string()) });

        let turnover = HashMap::new();
        let zone_rules = ZoneRules::default();
        let mix_limits = MixLimits::default();
        let occupancy = HashMap::new();

        let item = ItemDetails {
            bin_1: "A-01-01".to_string(),
            item_code: "TORNILLO01".to_string(),
            item_description: "Small screw".to_string(),
            weight_per_unit: "0.05".to_string(),
        };

        let suggested = get_suggested_bin_rust(&storage, &turnover, &zone_rules, &mix_limits, &item, &occupancy, "W");
        assert_eq!(suggested, Some("M-01-01".to_string()));
    }
}
