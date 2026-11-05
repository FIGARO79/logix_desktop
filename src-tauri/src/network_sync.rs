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
fn uuid_fast() -> String {
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

                // Escanear carpetas de fecha en eventos/ (últimos 7 días para no perder eventos entre días o tras fines de semana)
                for day_offset in 0..7 {
                    let date_str = (Local::now() - chrono::Duration::days(day_offset))
                        .format("%Y-%m-%d")
                        .to_string();
                    let day_dir = eventos_dir.join(&date_str);
                    if !day_dir.exists() {
                        continue;
                    }

                    if let Ok(entries) = fs::read_dir(&day_dir) {
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

        _ => {
            eprintln!(
                "[network_sync] Tipo de evento desconocido o no manejado: {}",
                event.event_type
            );
        }
    }

    Ok(())
}
