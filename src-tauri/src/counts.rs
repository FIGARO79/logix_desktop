use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize, Deserialize)]
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

pub fn calculate_cycle_count_differences(
    system_stock: Vec<(String, String, f64, f64)>, // (item_code, location, system_qty, unit_cost)
    physical_counts: Vec<(String, String, f64, i32)>, // (item_code, location, counted_qty, stage)
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
}
