use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize, Deserialize)]
pub struct ReconciliationRow {
    pub item_code: String,
    pub description: String,
    pub bin_location: String,
    pub system_qty: f64,
    pub cost: f64,
    pub c1: Option<f64>,
    pub c2: Option<f64>,
    pub c3: Option<f64>,
    pub c4: Option<f64>,
    pub final_counted: f64,
    pub diff_qty: f64,
    pub diff_val: f64,
    pub status: String,
    pub is_counted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneralInventoryStats {
    pub total_items: i64,
    pub counted_items_count: usize,
    pub progress_percentage: f64,
    pub total_system_units: f64,
    pub total_counted_units: f64,
    pub total_system_value: f64,
    pub total_counted_value: f64,
    pub net_variance_value: f64,
    pub abs_variance_value: f64,
    pub accuracy_percentage: f64,
}

pub fn calculate_reconciliation(
    master_items: Vec<(String, String, String, f64, f64)>, // (item_code, description, bin_location, system_qty, unit_cost)
    count_records: Vec<(String, f64, i32)>,                // (item_code, counted_qty, stage)
    recount_statuses: HashMap<String, String>,
    qty_tolerance: f64,
    val_tolerance: f64,
) -> Vec<ReconciliationRow> {
    let mut counts_by_item: HashMap<String, HashMap<i32, f64>> = HashMap::new();
    for (item_code, counted_qty, stage) in count_records {
        let code = item_code.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        counts_by_item
            .entry(code)
            .or_insert_with(HashMap::new)
            .entry(stage)
            .and_modify(|q| *q += counted_qty)
            .or_insert(counted_qty);
    }

    let mut master_map: HashMap<String, (String, String, f64, f64)> = HashMap::new();
    for (item_code, description, bin_location, system_qty, unit_cost) in master_items {
        let code = item_code.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        master_map.insert(code, (description, bin_location, system_qty, unit_cost));
    }

    let mut all_keys: HashSet<String> = HashSet::new();
    for k in master_map.keys() {
        all_keys.insert(k.clone());
    }
    for k in counts_by_item.keys() {
        all_keys.insert(k.clone());
    }

    let mut rows: Vec<ReconciliationRow> = Vec::with_capacity(all_keys.len());

    for code in all_keys {
        let (desc, bin, sys_qty, cost) = master_map
            .get(&code)
            .cloned()
            .unwrap_or(("ITEM NO CATALOGADO".to_string(), "N/A".to_string(), 0.0, 0.0));

        let stage_counts = counts_by_item.get(&code);
        let c1 = stage_counts.and_then(|m| m.get(&1)).copied();
        let c2 = stage_counts.and_then(|m| m.get(&2)).copied();
        let c3 = stage_counts.and_then(|m| m.get(&3)).copied();
        let c4 = stage_counts.and_then(|m| m.get(&4)).copied();

        let mut final_counted: Option<f64> = None;
        if let Some(m) = stage_counts {
            for stg in [4, 3, 2, 1] {
                if let Some(&qty) = m.get(&stg) {
                    final_counted = Some(qty);
                    break;
                }
            }
        }

        let is_counted = final_counted.is_some();
        let final_counted_val = final_counted.unwrap_or(0.0);
        let diff_qty = final_counted_val - sys_qty;
        let abs_diff_qty = diff_qty.abs();
        let diff_val = diff_qty * cost;
        let abs_diff_val = diff_val.abs();

        let mut status = "OK".to_string();
        if !is_counted {
            status = "NOT_COUNTED".to_string();
        } else if abs_diff_qty > 0.0001 {
            if let Some(st) = recount_statuses.get(&code) {
                if st == "manually_approved" {
                    status = "APPROVED_MANUAL".to_string();
                } else {
                    status = "PENDING_RECOUNT".to_string();
                }
            } else {
                let exceeds_qty = if sys_qty > 0.0 {
                    (abs_diff_qty / sys_qty) > qty_tolerance
                } else {
                    false
                };
                let exceeds_val = abs_diff_val > val_tolerance;
                if exceeds_qty || exceeds_val {
                    status = "PENDING".to_string();
                } else {
                    status = "APPROVED_AUTO".to_string();
                }
            }
        }

        rows.push(ReconciliationRow {
            item_code: code,
            description: desc,
            bin_location: bin,
            system_qty: sys_qty,
            cost,
            c1,
            c2,
            c3,
            c4,
            final_counted: final_counted_val,
            diff_qty,
            diff_val,
            status,
            is_counted,
        });
    }

    let get_status_order = |s: &str| -> i32 {
        match s {
            "PENDING_RECOUNT" => 0,
            "PENDING" => 1,
            "APPROVED_MANUAL" => 2,
            "APPROVED_AUTO" => 3,
            "OK" => 4,
            _ => 5,
        }
    };

    rows.sort_by(|a, b| {
        let order_a = get_status_order(&a.status);
        let order_b = get_status_order(&b.status);
        if order_a != order_b {
            order_a.cmp(&order_b)
        } else {
            b.diff_val.abs().partial_cmp(&a.diff_val.abs()).unwrap_or(std::cmp::Ordering::Equal)
        }
    });

    rows
}

pub fn calculate_general_inventory_stats(
    master_qty_cost: Vec<(String, f64, f64)>,
    count_records: Vec<(String, f64, i32)>,
) -> GeneralInventoryStats {
    let mut total_master_items = 0i64;
    let mut total_system_units = 0.0f64;
    let mut total_system_value = 0.0f64;

    let mut master_map: HashMap<String, (f64, f64)> = HashMap::new();
    for (code_raw, sys_qty, cost) in master_qty_cost {
        let code = code_raw.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        total_master_items += 1;
        total_system_units += sys_qty;
        total_system_value += sys_qty * cost;
        master_map.insert(code, (sys_qty, cost));
    }

    let mut counted_items: HashSet<String> = HashSet::new();
    let mut counts_by_item: HashMap<String, HashMap<i32, f64>> = HashMap::new();

    for (code_raw, qty, stage) in count_records {
        let code = code_raw.trim().to_uppercase();
        if code.is_empty() {
            continue;
        }
        counted_items.insert(code.clone());
        counts_by_item
            .entry(code)
            .or_insert_with(HashMap::new)
            .entry(stage)
            .and_modify(|q| *q += qty)
            .or_insert(qty);
    }

    let mut total_counted_units = 0.0f64;
    let mut total_counted_value = 0.0f64;
    let mut total_abs_diff_value = 0.0f64;
    let mut total_net_diff_value = 0.0f64;

    let mut all_keys: HashSet<String> = HashSet::new();
    for k in master_map.keys() {
        all_keys.insert(k.clone());
    }
    for k in counts_by_item.keys() {
        all_keys.insert(k.clone());
    }

    for code in all_keys {
        let (sys_qty, cost) = master_map.get(&code).copied().unwrap_or((0.0, 0.0));
        let stage_counts = counts_by_item.get(&code);
        let mut final_counted = 0.0f64;

        if let Some(m) = stage_counts {
            for stg in [4, 3, 2, 1] {
                if let Some(&q) = m.get(&stg) {
                    final_counted = q;
                    break;
                }
            }
        }

        total_counted_units += final_counted;
        let c_val = final_counted * cost;
        total_counted_value += c_val;

        let diff_qty = final_counted - sys_qty;
        let diff_val = diff_qty * cost;
        total_net_diff_value += diff_val;
        total_abs_diff_value += diff_val.abs();
    }

    let progress_pct = if total_master_items > 0 {
        (counted_items.len() as f64 / total_master_items as f64) * 100.0
    } else {
        0.0
    };

    let accuracy_pct = if total_system_value > 0.0 {
        ((1.0 - (total_abs_diff_value / total_system_value)).max(0.0)) * 100.0
    } else {
        100.0
    };

    GeneralInventoryStats {
        total_items: total_master_items,
        counted_items_count: counted_items.len(),
        progress_percentage: progress_pct,
        total_system_units,
        total_counted_units,
        total_system_value,
        total_counted_value,
        net_variance_value: total_net_diff_value,
        abs_variance_value: total_abs_diff_value,
        accuracy_percentage: accuracy_pct,
    }
}
