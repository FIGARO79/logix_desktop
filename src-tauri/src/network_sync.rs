use chrono::{Local, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEnvironment {
    pub is_network: bool,
    pub exe_path: String,
    pub network_root: Option<String>,
    pub local_data_dir: String,
    pub cargas_dir: Option<String>,
    pub eventos_dir: Option<String>,
    pub machine_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub event_id: String,
    pub machine_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub payload: serde_json::Value,
}

/// Comprueba si una ruta corresponde a una ubicación de red (UNC o unidad mapeada)
pub fn is_network_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    if path_str.starts_with(r"\\") || path_str.starts_with("//") {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        if let Some(std::path::Component::Prefix(prefix)) = path.components().next() {
            match prefix.kind() {
                std::path::Prefix::Disk(_) => {
                    let mut os_str = prefix.as_os_str().to_os_string();
                    os_str.push(std::ffi::OsStr::new("\\\0"));
                    let wide: Vec<u16> = os_str.encode_wide().collect();
                    unsafe {
                        extern "system" {
                            fn GetDriveTypeW(lpRootPathName: *const u16) -> u32;
                        }
                        // DRIVE_REMOTE = 4 en Windows
                        if GetDriveTypeW(wide.as_ptr()) == 4 {
                            return true;
                        }
                    }
                }
                std::path::Prefix::UNC(_, _) => return true,
                _ => {}
            }
        }
    }
    false
}

/// Obtiene o genera un identificador único de máquina
pub fn get_machine_id() -> String {
    if let Ok(comp_name) = std::env::var("COMPUTERNAME") {
        if !comp_name.trim().is_empty() {
            return comp_name.trim().to_uppercase();
        }
    }
    if let Ok(user) = std::env::var("USERNAME") {
        if !user.trim().is_empty() {
            return format!("PC-{}", user.trim().to_uppercase());
        }
    }
    "PC-LOCAL".to_string()
}

/// Detecta el entorno de ejecución actual (Red o Local)
pub fn detect_environment() -> NetworkEnvironment {
    let exe_path_buf =
        std::env::current_exe().unwrap_or_else(|_| PathBuf::from("Logix_Portable.exe"));
    let exe_dir = exe_path_buf.parent().unwrap_or_else(|| Path::new("."));

    // Determinar si es red o si ya existen las carpetas compartidas de sincronización
    let has_sync_folders = exe_dir.join("cargas").exists() && exe_dir.join("eventos").exists();
    let is_net = is_network_path(exe_dir) || has_sync_folders;

    let local_data = if is_net {
        let local_app =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
        PathBuf::from(local_app).join("LogixData").join("data")
    } else {
        exe_dir.join("data")
    };
    let _ = fs::create_dir_all(&local_data);

    let (network_root, cargas_dir, eventos_dir) = if is_net {
        let root = exe_dir.to_path_buf();
        let cargas = root.join("cargas");
        let eventos = root.join("eventos");
        let _ = fs::create_dir_all(&cargas);
        let _ = fs::create_dir_all(&eventos);

        (
            Some(root.to_string_lossy().to_string()),
            Some(cargas.to_string_lossy().to_string()),
            Some(eventos.to_string_lossy().to_string()),
        )
    } else {
        (None, None, None)
    };

    let machine_id = get_machine_id();

    NetworkEnvironment {
        is_network: is_net,
        exe_path: exe_path_buf.to_string_lossy().to_string(),
        network_root,
        local_data_dir: local_data.to_string_lossy().to_string(),
        cargas_dir,
        eventos_dir,
        machine_id,
    }
}

/// Crea el acceso directo en el Escritorio del usuario sin requerir permisos de administrador
pub fn ensure_desktop_shortcut() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Ok(user_profile) = std::env::var("USERPROFILE") {
                let desktop = PathBuf::from(user_profile).join("Desktop");
                let shortcut = desktop.join("Logix WMS.lnk");
                if !shortcut.exists() && desktop.exists() {
                    let ps_cmd = format!(
                        "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{}'); $s.TargetPath = '{}'; $s.Description = 'Logix WMS Portable'; $s.Save()",
                        shortcut.to_string_lossy().replace('\'', "''"),
                        exe_path.to_string_lossy().replace('\'', "''")
                    );
                    let res = std::process::Command::new("powershell")
                        .args([
                            "-NoProfile",
                            "-NonInteractive",
                            "-WindowStyle",
                            "Hidden",
                            "-Command",
                            &ps_cmd,
                        ])
                        .output();
                    match res {
                        Ok(out) => {
                            if out.status.success() {
                                eprintln!(
                                    "[network_sync] Acceso directo creado en: {}",
                                    shortcut.display()
                                );
                                return Ok(true);
                            } else {
                                let err_str = String::from_utf8_lossy(&out.stderr);
                                return Err(format!(
                                    "Error de PowerShell al crear acceso directo: {}",
                                    err_str
                                ));
                            }
                        }
                        Err(e) => return Err(e.to_string()),
                    }
                } else if shortcut.exists() {
                    return Ok(false); // Ya existe
                }
            }
        }
    }
    Ok(false)
}

/// Publica un evento atómico en la carpeta de eventos de la red
pub fn publish_event(
    conn: &Connection,
    event_type: &str,
    payload: serde_json::Value,
) -> Result<String, String> {
    let env = detect_environment();
    let eventos_dir_str = match env.eventos_dir {
        Some(ref dir) => dir.clone(),
        None => return Ok("Modo local: evento no publicado en red".to_string()),
    };

    let today = Local::now().format("%Y-%m-%d").to_string();
    let day_dir = PathBuf::from(&eventos_dir_str).join(&today);
    let _ = fs::create_dir_all(&day_dir);

    let event_id = format!(
        "evt_{}_{}_{}",
        Local::now().format("%Y%m%d_%H%M%S_%3f"),
        env.machine_id,
        uuid_fast()
    );

    let sync_event = SyncEvent {
        event_id: event_id.clone(),
        machine_id: env.machine_id.clone(),
        event_type: event_type.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        payload,
    };

    let json_bytes = serde_json::to_vec_pretty(&sync_event).map_err(|e| e.to_string())?;

    let final_file = day_dir.join(format!("{}.json", event_id));
    let tmp_file = day_dir.join(format!(".tmp_{}.json", event_id));

    // Escritura atómica compatible con SMB de Windows (reintentos ante bloqueo oportunista y fallback directo)
    let mut written = false;
    if fs::write(&tmp_file, &json_bytes).is_ok() {
        for _ in 0..5 {
            if fs::rename(&tmp_file, &final_file).is_ok() {
                written = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
    if !written {
        // Fallback confiable: escritura directa en ruta final sobre carpetas de red
        fs::write(&final_file, &json_bytes)
            .map_err(|e| format!("Error guardando archivo de evento en red: {}", e))?;
        let _ = fs::remove_file(&tmp_file);
    }

    // Registrar en SQLite local para no auto-procesar nuestro propio evento
    let now_str = Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT OR IGNORE INTO sync_processed_events (event_id, event_type, machine_id, processed_at) VALUES (?1, ?2, ?3, ?4)",
        params![event_id, event_type, env.machine_id, now_str],
    );

    Ok(event_id)
}

/// Generador de sufijo aleatorio rápido para UUID sin colisiones
pub fn uuid_fast() -> String {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("{:08x}", nanos)
}

/// Gestor del hilo en segundo plano que vigila y procesa eventos de la red
#[derive(Clone)]
pub struct NetworkSyncWatcher {
    is_running: Arc<AtomicBool>,
    app_handle: Arc<Mutex<Option<tauri::AppHandle>>>,
}

impl NetworkSyncWatcher {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut lock) = self.app_handle.lock() {
            *lock = Some(handle);
        }
    }

    pub fn start(&self, db_path: PathBuf) {
        if self.is_running.load(Ordering::SeqCst) {
            return;
        }

        self.is_running.store(true, Ordering::SeqCst);
        let running_flag = Arc::clone(&self.is_running);
        let app_handle_ref = Arc::clone(&self.app_handle);

        std::thread::spawn(move || {
            eprintln!(
                "[network_sync] Iniciando observador en segundo plano para replicación de red..."
            );

            while running_flag.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_secs(3));

                let env = detect_environment();
                let eventos_dir_str = match env.eventos_dir {
                    Some(ref dir) => dir.clone(),
                    None => continue,
                };

                let eventos_dir = PathBuf::from(eventos_dir_str);
                if !eventos_dir.exists() {
                    continue;
                }

                // Abrir conexión SQLite para esta pasada
                let conn = match Connection::open(&db_path) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[network_sync] Error abriendo conexión SQLite: {}", e);
                        continue;
                    }
                };

                // Escanear carpetas de fecha en eventos/ (ordenadas cronológicamente para no perder eventos)
                let mut day_dirs: Vec<PathBuf> = Vec::new();
                if let Ok(entries) = fs::read_dir(&eventos_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            let d_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                            if d_name.len() == 10 && d_name.chars().nth(4) == Some('-') && d_name.chars().nth(7) == Some('-') {
                                day_dirs.push(p);
                            }
                        }
                    }
                }
                day_dirs.sort();
                let start_idx = if day_dirs.len() > 60 { day_dirs.len() - 60 } else { 0 };
                let target_dirs = &day_dirs[start_idx..];

                for day_dir in target_dirs {
                    if let Ok(entries) = fs::read_dir(day_dir) {
                        let mut files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
                        files.sort();

                        for path in files {
                            if !path.is_file() {
                                continue;
                            }

                            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                            if fname.starts_with(".tmp") || !fname.ends_with(".json") {
                                continue;
                            }

                            // Verificar si ya fue procesado
                            let event_id_guess = fname.trim_end_matches(".json");
                            let already_processed: bool = conn
                                .query_row(
                                    "SELECT COUNT(1) FROM sync_processed_events WHERE event_id = ?1",
                                    params![event_id_guess],
                                    |r| r.get::<_, i64>(0),
                                )
                                .map(|c| c > 0)
                                .unwrap_or(false);

                            if already_processed {
                                continue;
                            }

                            // Leer el archivo de evento
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(event) = serde_json::from_str::<SyncEvent>(&content) {
                                    // Ignorar si lo emitió esta misma máquina
                                    if event.machine_id == env.machine_id {
                                        let now_str = Utc::now().to_rfc3339();
                                        let _ = conn.execute(
                                            "INSERT OR IGNORE INTO sync_processed_events (event_id, event_type, machine_id, processed_at) VALUES (?1, ?2, ?3, ?4)",
                                            params![event.event_id, event.event_type, event.machine_id, now_str],
                                        );
                                        continue;
                                    }

                                    // Procesar el evento
                                    match process_incoming_event(&conn, &event, &env) {
                                        Ok(_) => {
                                            let now_str = Utc::now().to_rfc3339();
                                            let _ = conn.execute(
                                                "INSERT OR IGNORE INTO sync_processed_events (event_id, event_type, machine_id, processed_at) VALUES (?1, ?2, ?3, ?4)",
                                                params![event.event_id, event.event_type, event.machine_id, now_str],
                                            );
                                            eprintln!(
                                                "[network_sync] Evento procesado exitosamente: {} ({}) desde {}",
                                                event.event_id, event.event_type, event.machine_id
                                            );

                                            if let Ok(guard) = app_handle_ref.lock() {
                                                if let Some(ref handle) = *guard {
                                                    use tauri::Manager;
                                                    let _ = handle.emit_all("network-sync-event", &event);
                                                }
                                            }
                                        }
                                        Err(err) => {
                                            eprintln!(
                                                "[network_sync] Error procesando evento {}: {}",
                                                event.event_id, err
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

/// Aplica un evento entrante de otra máquina en la base de datos local SQLite y archivos de caché locales
fn process_incoming_event(
    conn: &Connection,
    event: &SyncEvent,
    env: &NetworkEnvironment,
) -> Result<(), String> {
    match event.event_type.as_str() {
        // 1. Replicación de Archivos Maestros y de Trabajo (250, 240, 280, 0006, PO Extractor)
        "WORK_FILE_UPLOAD" => {
            let data_file_name = event
                .payload
                .get("data_file")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let file_type = event
                .payload
                .get("file_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if let Some(ref cargas_str) = env.cargas_dir {
                let data_file_path = PathBuf::from(cargas_str).join(data_file_name);
                if data_file_path.exists() {
                    let raw_json =
                        fs::read_to_string(&data_file_path).map_err(|e| e.to_string())?;
                    let json_val: serde_json::Value =
                        serde_json::from_str(&raw_json).map_err(|e| e.to_string())?;

                    match file_type {
                        "250" => {
                            // Maestro de Ítems
                            if let Some(items) = json_val.as_array() {
                                let mut stmt = conn
                                    .prepare(
                                        "INSERT INTO inventory_items (item_code, description, bin_location, additional_bins, system_qty, unit_cost, weight_per_unit, sic_code, abc_code)
                                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                                         ON CONFLICT(item_code) DO UPDATE SET
                                            description=excluded.description,
                                            bin_location=excluded.bin_location,
                                            additional_bins=excluded.additional_bins,
                                            system_qty=excluded.system_qty,
                                            unit_cost=excluded.unit_cost,
                                            weight_per_unit=excluded.weight_per_unit,
                                            sic_code=excluded.sic_code,
                                            abc_code=excluded.abc_code",
                                    )
                                    .map_err(|e| e.to_string())?;

                                for it in items {
                                    let code =
                                        it.get("item_code").and_then(|v| v.as_str()).unwrap_or("");
                                    let desc = it
                                        .get("description")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let bin = it
                                        .get("bin_location")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let add_bins = it
                                        .get("additional_bins")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let qty = it
                                        .get("system_qty")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);
                                    let cost =
                                        it.get("unit_cost").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                    let weight = it
                                        .get("weight_per_unit")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);
                                    let sic =
                                        it.get("sic_code").and_then(|v| v.as_str()).unwrap_or("");
                                    let abc =
                                        it.get("abc_code").and_then(|v| v.as_str()).unwrap_or("");

                                    if !code.is_empty() {
                                        let _ = stmt.execute(params![
                                            code, desc, bin, add_bins, qty, cost, weight, sic, abc
                                        ]);
                                    }
                                }

                                let now_ts = chrono::Utc::now().timestamp();
                                let _ = conn.execute(
                                    "INSERT INTO sync_metadata (key, timestamp) VALUES ('master_items', ?1)
                                     ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
                                    params![now_ts],
                                );
                            }
                        }
                        "240" => {
                            // Pedidos de Picking
                            if let Some(orders) = json_val.as_array() {
                                let _ = conn.execute("DELETE FROM picking_orders", []);

                                let mut stmt = conn
                                    .prepare(
                                        "INSERT INTO picking_orders (
                                            shipment_id, order_number, despatch_number, customer_code, customer_name,
                                            carrier, order_line, item_code, item_description, requested_qty,
                                            picked_qty, print_date, time_zone_hours, status, timestamp
                                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                                    )
                                    .map_err(|e| e.to_string())?;

                                let now_fmt = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

                                for ord in orders {
                                    let s_id = ord.get("shipment_id").and_then(|v| v.as_str()).unwrap_or("");
                                    let o_num = ord.get("order_number").and_then(|v| v.as_str()).unwrap_or("");
                                    let d_num = ord.get("despatch_number").and_then(|v| v.as_str()).unwrap_or("00");
                                    let c_code = ord.get("customer_code").and_then(|v| v.as_str()).unwrap_or("");
                                    let c_name = ord.get("customer_name").and_then(|v| v.as_str()).unwrap_or("");
                                    let carrier = ord.get("carrier").and_then(|v| v.as_str()).unwrap_or("N/A");
                                    let line = ord.get("order_line").and_then(|v| v.as_str()).unwrap_or("1");
                                    let code = ord.get("item_code").and_then(|v| v.as_str()).unwrap_or("");
                                    let desc = ord.get("item_description")
                                        .or_else(|| ord.get("description"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let qty = ord.get("requested_qty")
                                        .or_else(|| ord.get("qty_req"))
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);
                                    let picked_qty = ord.get("picked_qty").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                    let p_date = ord.get("print_date").and_then(|v| v.as_str()).unwrap_or("");
                                    let tz = ord.get("time_zone_hours").and_then(|v| v.as_str()).unwrap_or("-05:00");
                                    let status = ord.get("status").and_then(|v| v.as_str()).unwrap_or("PP");
                                    let ts = ord.get("timestamp").and_then(|v| v.as_str()).unwrap_or(&now_fmt);

                                    if !o_num.is_empty() && !code.is_empty() {
                                        let _ = stmt.execute(params![
                                            s_id, o_num, d_num, c_code, c_name, carrier, line, code, desc,
                                            qty, picked_qty, p_date, tz, status, ts
                                        ]);
                                    }
                                }

                                let now_ts = chrono::Utc::now().timestamp();
                                let _ = conn.execute(
                                    "INSERT INTO sync_metadata (key, timestamp) VALUES ('picking', ?1)
                                     ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
                                    params![now_ts],
                                );
                            }
                        }
                        "280" => {
                            // Entradas GRN (grn_master_data.json)
                            let grn_local_path = crate::db::get_app_data_dir().join("grn_master_data.json");
                            if let Some(parent) = grn_local_path.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            fs::write(&grn_local_path, &raw_json)
                                .map_err(|e| format!("Error guardando grn_master_data.json: {}", e))?;
                            let now_ts = chrono::Utc::now().timestamp();
                            let _ = conn.execute(
                                "INSERT INTO sync_metadata (key, timestamp) VALUES ('grn_pending', ?1)
                                 ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
                                params![now_ts],
                            );
                        }
                        "0006" => {
                            // Reservas Xdock (xdock_reservations.json)
                            let xdock_local_path = crate::db::get_app_data_dir().join("xdock_reservations.json");
                            if let Some(parent) = xdock_local_path.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            fs::write(&xdock_local_path, &raw_json)
                                .map_err(|e| format!("Error guardando xdock_reservations.json: {}", e))?;
                            let now_ts = chrono::Utc::now().timestamp();
                            let _ = conn.execute(
                                "INSERT INTO sync_metadata (key, timestamp) VALUES ('xdock_reservations', ?1)
                                 ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
                                params![now_ts],
                            );
                        }
                        "po_extractor" => {
                            // PO Extractor (po_lookup.json)
                            let po_local_path = crate::db::get_app_data_dir().join("po_lookup.json");
                            if let Some(parent) = po_local_path.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            fs::write(&po_local_path, &raw_json)
                                .map_err(|e| format!("Error guardando po_lookup.json: {}", e))?;
                            let now_ts = chrono::Utc::now().timestamp();
                            let _ = conn.execute(
                                "INSERT INTO sync_metadata (key, timestamp) VALUES ('po_extractor', ?1)
                                 ON CONFLICT(key) DO UPDATE SET timestamp = excluded.timestamp",
                                params![now_ts],
                            );
                        }
                        _ => {}
                    }
                }
            }
        }

        // 2. Conteo Cíclico
        "CYCLE_COUNT_ENTRY" => {
            let session_id = event
                .payload
                .get("session_id")
                .and_then(|v| v.as_i64())
                .unwrap_or(1);
            let item_code = event
                .payload
                .get("item_code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let location = event
                .payload
                .get("location")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let qty = event
                .payload
                .get("quantity")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let username = event
                .payload
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("remoto");
            let count_type = event
                .payload
                .get("count_type")
                .and_then(|v| v.as_str())
                .unwrap_or("general");
            let stage = event
                .payload
                .get("stage")
                .and_then(|v| v.as_str())
                .unwrap_or("1");
            let timestamp = event
                .payload
                .get("timestamp")
                .and_then(|v| v.as_str())
                .unwrap_or(&event.timestamp);

            if !item_code.is_empty() && !location.is_empty() {
                let _ = conn.execute(
                    "INSERT INTO counts (session_id, item_code, location, quantity, username, count_type, stage, timestamp)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![session_id, item_code, location, qty, username, count_type, stage, timestamp],
                );
            }
        }

        // 3. Auditoría de Picking
        "PICKING_AUDIT_ENTRY" => {
            let order_number = event
                .payload
                .get("order_number")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let despatch_number = event
                .payload
                .get("despatch_number")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let customer_code = event
                .payload
                .get("customer_code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let customer_name = event
                .payload
                .get("customer_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let status = event
                .payload
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("Completo");
            let packages = event
                .payload
                .get("packages")
                .and_then(|v| v.as_i64())
                .unwrap_or(1);
            let packages_assignment = event
                .payload
                .get("packages_assignment")
                .map(|v| v.to_string())
                .unwrap_or_default();
            let packages_dimensions = event
                .payload
                .get("packages_dimensions")
                .map(|v| v.to_string())
                .unwrap_or_default();
            let audit_date = event
                .payload
                .get("audit_date")
                .and_then(|v| v.as_str())
                .unwrap_or(&event.timestamp);

            if !order_number.is_empty() {
                let _ = conn.execute(
                    "INSERT INTO picking_audits (order_number, despatch_number, customer_code, customer_name, status, packages, packages_assignment, packages_dimensions, audit_date)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![order_number, despatch_number, customer_code, customer_name, status, packages, packages_assignment, packages_dimensions, audit_date],
                );
            }
        }

        // 4. Recepción Inbound (Creación o edición de un log)
        "INBOUND_LOG_SAVE" => {
            apply_inbound_log_json(conn, &event.payload, &event.timestamp)?;
            crate::inbound::invalidate_inbound_reconciliation_cache();
        }

        // 5. Eliminación de Inbound Log
        "INBOUND_LOG_DELETE" => {
            let client_id = event
                .payload
                .get("client_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !client_id.is_empty() {
                let _ = conn.execute(
                    "DELETE FROM inbound_logs WHERE client_id = ?1",
                    params![client_id],
                );
                crate::inbound::invalidate_inbound_reconciliation_cache();
            }
        }

        // 6. Eliminación múltiple de Inbound Logs
        "INBOUND_LOGS_DELETE_BULK" => {
            if let Some(cids) = event.payload.get("client_ids").and_then(|v| v.as_array()) {
                for cid_val in cids {
                    if let Some(cid) = cid_val.as_str() {
                        let _ = conn.execute(
                            "DELETE FROM inbound_logs WHERE client_id = ?1",
                            params![cid],
                        );
                    }
                }
                crate::inbound::invalidate_inbound_reconciliation_cache();
            }
        }

        // 7. Restauración múltiple de Inbound Logs
        "INBOUND_LOGS_RESTORE_BULK" => {
            if let Some(cids) = event.payload.get("client_ids").and_then(|v| v.as_array()) {
                for cid_val in cids {
                    if let Some(cid) = cid_val.as_str() {
                        let _ = conn.execute(
                            "UPDATE inbound_logs SET archived_at = NULL WHERE client_id = ?1",
                            params![cid],
                        );
                    }
                }
                crate::inbound::invalidate_inbound_reconciliation_cache();
            }
        }

        // 8. Archivado de Inbound Logs
        "INBOUND_LOGS_ARCHIVE" => {
            let archived_at = event
                .payload
                .get("archived_at")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !archived_at.is_empty() {
                let _ = conn.execute(
                    "UPDATE inbound_logs SET archived_at = ?1 WHERE archived_at IS NULL OR archived_at = ''",
                    params![archived_at],
                );
                crate::inbound::invalidate_inbound_reconciliation_cache();
            }
        }

        // 9. Desarchivado de versión de Inbound
        "INBOUND_LOGS_UNARCHIVE" => {
            let version_date = event
                .payload
                .get("version_date")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !version_date.is_empty() {
                let pattern = format!("{}%", version_date);
                let _ = conn.execute(
                    "UPDATE inbound_logs SET archived_at = NULL WHERE version_date LIKE ?1 OR timestamp LIKE ?2",
                    params![pattern, pattern],
                );
                crate::inbound::invalidate_inbound_reconciliation_cache();
            }
        }

        // 10. Replicación por lotes de Inbound Logs
        "INBOUND_LOGS_BATCH_SYNC" => {
            let mut logs_vec: Vec<serde_json::Value> = Vec::new();

            if let Some(logs) = event.payload.get("logs").and_then(|v| v.as_array()) {
                logs_vec = logs.clone();
            } else if let Some(file_name) = event.payload.get("data_file").and_then(|v| v.as_str()) {
                if let Some(ref cargas_str) = env.cargas_dir {
                    let file_path = PathBuf::from(cargas_str).join(file_name);
                    if file_path.exists() {
                        if let Ok(raw_json) = fs::read_to_string(&file_path) {
                            if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str(&raw_json) {
                                logs_vec = arr;
                            }
                        }
                    }
                }
            }

            for item in &logs_vec {
                let _ = apply_inbound_log_json(conn, item, &event.timestamp);
            }
            crate::inbound::invalidate_inbound_reconciliation_cache();
        }

        _ => {
            eprintln!(
                "[network_sync] Tipo de evento desconocido o no manejado: {}",
                event.event_type
            );
        }
    }

    Ok(())
}

/// Aplica un registro individual de inbound con semántica UPSERT en la base de datos local SQLite
fn apply_inbound_log_json(
    conn: &Connection,
    item: &serde_json::Value,
    fallback_ts: &str,
) -> Result<(), String> {
    let client_id = item
        .get("client_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if client_id.is_empty() {
        return Ok(());
    }

    let timestamp = item
        .get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or(fallback_ts);
    let import_ref = item
        .get("import_reference")
        .or_else(|| item.get("importReference"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let waybill = item.get("waybill").and_then(|v| v.as_str());
    let item_code = item
        .get("item_code")
        .or_else(|| item.get("itemCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let item_description = item
        .get("item_description")
        .or_else(|| item.get("itemDescription"))
        .and_then(|v| v.as_str());
    let bin_location = item
        .get("bin_location")
        .or_else(|| item.get("binLocation"))
        .and_then(|v| v.as_str());
    let relocated_bin = item
        .get("relocated_bin")
        .or_else(|| item.get("relocatedBin"))
        .and_then(|v| v.as_str());
    let qty_received = item
        .get("qty_received")
        .or_else(|| item.get("qtyReceived"))
        .or_else(|| item.get("quantity"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let qty_grn = item
        .get("qty_grn")
        .or_else(|| item.get("qtyGrn"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let difference = item
        .get("difference")
        .and_then(|v| v.as_f64())
        .unwrap_or(qty_received - qty_grn);
    let username = item.get("username").and_then(|v| v.as_str());
    let archived_at = item
        .get("archived_at")
        .or_else(|| item.get("archivedAt"))
        .and_then(|v| v.as_str());
    let version_date = item
        .get("version_date")
        .or_else(|| item.get("versionDate"))
        .and_then(|v| v.as_str());

    conn.execute(
        "INSERT INTO inbound_logs (
            timestamp, import_reference, waybill, item_code, item_description,
            bin_location, relocated_bin, qty_received, qty_grn, difference,
            username, client_id, archived_at, version_date
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(client_id) DO UPDATE SET
            timestamp = excluded.timestamp,
            import_reference = excluded.import_reference,
            waybill = excluded.waybill,
            item_code = excluded.item_code,
            item_description = excluded.item_description,
            bin_location = excluded.bin_location,
            relocated_bin = excluded.relocated_bin,
            qty_received = excluded.qty_received,
            qty_grn = excluded.qty_grn,
            difference = excluded.difference,
            username = excluded.username,
            archived_at = excluded.archived_at,
            version_date = excluded.version_date",
        params![
            timestamp,
            import_ref.trim().to_uppercase(),
            waybill.map(|s| s.trim().to_uppercase()),
            item_code.trim().to_uppercase(),
            item_description,
            bin_location,
            relocated_bin,
            qty_received,
            qty_grn,
            difference,
            username,
            client_id,
            archived_at,
            version_date,
        ],
    )
    .map_err(|e| format!("Error replicando inbound log: {}", e))?;

    Ok(())
}

/// Transmite y sincroniza todos los logs locales de inbound hacia la red
pub fn broadcast_all_inbound_logs(conn: &Connection) -> Result<usize, String> {
    let env = detect_environment();
    let cargas_dir_str = match env.cargas_dir {
        Some(ref dir) => dir.clone(),
        None => return Ok(0),
    };

    // Asegurar que cualquier registro antiguo sin client_id tenga uno asignado
    let _ = conn.execute(
        "UPDATE inbound_logs SET client_id = 'gen_' || id || '_' || hex(randomblob(8)) WHERE client_id IS NULL OR client_id = '';",
        [],
    );

    // Leer todos los logs no archivados
    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, import_reference, waybill, item_code, item_description,
                    bin_location, relocated_bin, qty_received, qty_grn, difference,
                    username, client_id, archived_at, version_date
             FROM inbound_logs
             WHERE (archived_at IS NULL OR archived_at = '')
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let log_iter = stmt
        .query_map([], |row| {
            Ok(crate::inbound::LogInbound {
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
        })
        .map_err(|e| e.to_string())?;

    let logs: Vec<crate::inbound::LogInbound> = log_iter.flatten().collect();
    let count = logs.len();

    if count == 0 {
        return Ok(0);
    }

    let cargas_dir = PathBuf::from(cargas_dir_str);
    let _ = fs::create_dir_all(&cargas_dir);

    let now_prefix = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let json_filename = format!("{}_inbound_ledger_{}.json", now_prefix, env.machine_id);
    let json_path = cargas_dir.join(&json_filename);

    let json_val = serde_json::to_value(&logs).map_err(|e| e.to_string())?;
    let json_bytes = serde_json::to_vec_pretty(&json_val).map_err(|e| e.to_string())?;
    let _ = fs::write(&json_path, &json_bytes);

    // Publicar evento en la red
    let payload = serde_json::json!({
        "data_file": json_filename,
        "logs": json_val,
        "count": count,
        "machine_id": env.machine_id
    });

    publish_event(conn, "INBOUND_LOGS_BATCH_SYNC", payload)?;

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS inbound_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                import_reference TEXT NOT NULL DEFAULT '',
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
            );",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_processed_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT,
                machine_id TEXT,
                processed_at TEXT
            );",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_inbound_log_save_and_update_replication() {
        let conn = setup_test_db();
        let env = detect_environment();

        let event = SyncEvent {
            event_id: "evt_test_1".to_string(),
            machine_id: "REMOTE_PC_1".to_string(),
            event_type: "INBOUND_LOG_SAVE".to_string(),
            timestamp: "2026-11-06T18:00:00Z".to_string(),
            payload: serde_json::json!({
                "client_id": "UUID-NET-001",
                "timestamp": "2026-11-06 18:00:00",
                "import_reference": "IR-9999",
                "waybill": "WB-8888",
                "item_code": "SKU-TEST-01",
                "item_description": "Broca Test",
                "bin_location": "A-01-01",
                "relocated_bin": "A-01-02",
                "qty_received": 15.0,
                "qty_grn": 10.0,
                "difference": 5.0,
                "username": "operador1",
                "archived_at": null,
                "version_date": "2026-11-06"
            }),
        };

        // Procesar evento entrante
        process_incoming_event(&conn, &event, &env).unwrap();

        let (code, qty, bin): (String, f64, Option<String>) = conn
            .query_row(
                "SELECT item_code, qty_received, relocated_bin FROM inbound_logs WHERE client_id = 'UUID-NET-001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();

        assert_eq!(code, "SKU-TEST-01");
        assert_eq!(qty, 15.0);
        assert_eq!(bin.as_deref(), Some("A-01-02"));

        // Actualizar el mismo log desde otra máquina
        let update_event = SyncEvent {
            event_id: "evt_test_2".to_string(),
            machine_id: "REMOTE_PC_2".to_string(),
            event_type: "INBOUND_LOG_SAVE".to_string(),
            timestamp: "2026-11-06T18:05:00Z".to_string(),
            payload: serde_json::json!({
                "client_id": "UUID-NET-001",
                "timestamp": "2026-11-06 18:05:00",
                "import_reference": "IR-9999",
                "waybill": "WB-8888",
                "item_code": "SKU-TEST-01",
                "item_description": "Broca Test",
                "bin_location": "A-01-01",
                "relocated_bin": "B-02-01",
                "qty_received": 20.0,
                "qty_grn": 10.0,
                "difference": 10.0,
                "username": "operador2",
                "archived_at": null,
                "version_date": "2026-11-06"
            }),
        };

        process_incoming_event(&conn, &update_event, &env).unwrap();

        let total_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbound_logs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_count, 1);

        let (new_qty, new_bin): (f64, Option<String>) = conn
            .query_row(
                "SELECT qty_received, relocated_bin FROM inbound_logs WHERE client_id = 'UUID-NET-001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();

        assert_eq!(new_qty, 20.0);
        assert_eq!(new_bin.as_deref(), Some("B-02-01"));
    }

    #[test]
    fn test_inbound_log_delete_replication() {
        let conn = setup_test_db();
        let env = detect_environment();

        conn.execute(
            "INSERT INTO inbound_logs (timestamp, import_reference, item_code, client_id) VALUES ('2026-11-06', 'IR-1', 'SKU-1', 'DEL-UUID-001')",
            [],
        ).unwrap();

        let event = SyncEvent {
            event_id: "evt_del_1".to_string(),
            machine_id: "REMOTE_PC_1".to_string(),
            event_type: "INBOUND_LOG_DELETE".to_string(),
            timestamp: "2026-11-06T18:10:00Z".to_string(),
            payload: serde_json::json!({
                "client_id": "DEL-UUID-001"
            }),
        };

        process_incoming_event(&conn, &event, &env).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbound_logs WHERE client_id = 'DEL-UUID-001'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_inbound_batch_sync_replication() {
        let conn = setup_test_db();
        let env = detect_environment();

        let batch_event = SyncEvent {
            event_id: "evt_batch_1".to_string(),
            machine_id: "REMOTE_PC_1".to_string(),
            event_type: "INBOUND_LOGS_BATCH_SYNC".to_string(),
            timestamp: "2026-11-06T18:15:00Z".to_string(),
            payload: serde_json::json!({
                "logs": [
                    {
                        "client_id": "BATCH-001",
                        "timestamp": "2026-11-06 10:00:00",
                        "import_reference": "IR-A",
                        "item_code": "SKU-A",
                        "qty_received": 5.0
                    },
                    {
                        "client_id": "BATCH-002",
                        "timestamp": "2026-11-06 10:05:00",
                        "import_reference": "IR-B",
                        "item_code": "SKU-B",
                        "qty_received": 12.0
                    }
                ]
            }),
        };

        process_incoming_event(&conn, &batch_event, &env).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbound_logs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}
