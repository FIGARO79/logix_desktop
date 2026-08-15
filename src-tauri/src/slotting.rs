use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinInfo {
    pub zone: Option<String>,
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

    if !current_bin.is_empty() {
        if let Some(info) = storage.get(&current_bin) {
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
