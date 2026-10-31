use chrono::Local;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Instant;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::db::Database;
use crate::general_inventory;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub running: bool,
    pub port: u16,
    pub local_ips: Vec<String>,
    pub server_name: String,
    pub active_requests: usize,
    pub uptime_seconds: u64,
}

pub struct HostServerManager {
    is_running: Arc<AtomicBool>,
    active_requests: Arc<AtomicUsize>,
    port: Arc<Mutex<u16>>,
    start_time: Arc<Mutex<Option<Instant>>>,
    server_instance: Arc<Mutex<Option<Arc<Server>>>>,
    worker_thread: Mutex<Option<JoinHandle<()>>>,
}

impl HostServerManager {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            active_requests: Arc::new(AtomicUsize::new(0)),
            port: Arc::new(Mutex::new(8088)),
            start_time: Arc::new(Mutex::new(None)),
            server_instance: Arc::new(Mutex::new(None)),
            worker_thread: Mutex::new(None),
        }
    }

    pub fn get_local_ips() -> Vec<String> {
        let mut ips = Vec::new();
        if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
            for (_name, ip) in interfaces {
                if !ip.is_loopback() {
                    if let IpAddr::V4(ipv4) = ip {
                        let ip_str = ipv4.to_string();
                        if !ips.contains(&ip_str) {
                            ips.push(ip_str);
                        }
                    }
                }
            }
        }
        if ips.is_empty() {
            if let Ok(IpAddr::V4(ipv4)) = local_ip_address::local_ip() {
                ips.push(ipv4.to_string());
            }
        }
        ips
    }

    pub fn get_info(&self) -> ServerInfo {
        let running = self.is_running.load(Ordering::SeqCst);
        let port = *self.port.lock().unwrap();
        let uptime = self
            .start_time
            .lock()
            .unwrap()
            .map(|t| t.elapsed().as_secs())
            .unwrap_or(0);

        ServerInfo {
            running,
            port,
            local_ips: Self::get_local_ips(),
            server_name: "Logix Central Host".to_string(),
            active_requests: self.active_requests.load(Ordering::SeqCst),
            uptime_seconds: uptime,
        }
    }

    pub fn start(&self, db: Database, port: u16) -> Result<ServerInfo, String> {
        if self.is_running.load(Ordering::SeqCst) {
            return Ok(self.get_info());
        }

        let address = format!("0.0.0.0:{}", port);
        let server = match Server::http(&address) {
            Ok(s) => Arc::new(s),
            Err(e) => return Err(format!("No se pudo abrir el puerto {}: {}", port, e)),
        };

        *self.port.lock().unwrap() = port;
        *self.start_time.lock().unwrap() = Some(Instant::now());
        self.is_running.store(true, Ordering::SeqCst);
        *self.server_instance.lock().unwrap() = Some(Arc::clone(&server));

        let is_running = Arc::clone(&self.is_running);
        let active_requests = Arc::clone(&self.active_requests);
        let server_clone = Arc::clone(&server);

        let handle = thread::spawn(move || {
            eprintln!("[HostServer] Servidor iniciado en {}", address);
            while is_running.load(Ordering::SeqCst) {
                match server_clone.recv() {
                    Ok(mut request) => {
                        active_requests.fetch_add(1, Ordering::SeqCst);
                        let response = handle_request(&mut request, &db);
                        let _ = request.respond(response);
                        active_requests.fetch_sub(1, Ordering::SeqCst);
                    }
                    Err(_) => break,
                }
            }
            eprintln!("[HostServer] Servidor detenido.");
        });

        *self.worker_thread.lock().unwrap() = Some(handle);
        Ok(self.get_info())
    }

    pub fn stop(&self) -> Result<ServerInfo, String> {
        if !self.is_running.load(Ordering::SeqCst) {
            return Ok(self.get_info());
        }

        self.is_running.store(false, Ordering::SeqCst);
        *self.start_time.lock().unwrap() = None;

        if let Some(server) = self.server_instance.lock().unwrap().take() {
            server.unblock();
        }

        if let Some(handle) = self.worker_thread.lock().unwrap().take() {
            let _ = handle.join();
        }

        Ok(self.get_info())
    }
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS, PUT, DELETE"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type, Authorization, X-Requested-With"[..]).unwrap(),
        Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap(),
    ]
}

fn json_response(status_code: u16, data: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&data).unwrap_or_else(|_| b"{}".to_vec());
    Response::new(
        StatusCode(status_code),
        cors_headers(),
        std::io::Cursor::new(body),
        None,
        None,
    )
}

fn handle_request(request: &mut tiny_http::Request, db: &Database) -> Response<std::io::Cursor<Vec<u8>>> {
    if request.method() == &Method::Options {
        return json_response(200, json!({ "status": "ok" }));
    }

    let url_raw = request.url().to_string();
    let path = url_raw.split('?').next().unwrap_or("/");

    match (request.method(), path) {
        (&Method::Get, "/api/status") => {
            json_response(200, json!({
                "status": "online",
                "server_name": "Logix Desktop Central Host",
                "version": "0.0.1",
                "timestamp": Local::now().to_rfc3339()
            }))
        }

        (&Method::Get, "/api/operators") => {
            match db.get_connection() {
                Ok(conn) => {
                    let stmt = conn.prepare(
                        "SELECT DISTINCT user_id FROM counts WHERE user_id IS NOT NULL AND user_id != '' 
                         UNION 
                         SELECT username FROM users WHERE is_approved = 1"
                    );
                    match stmt {
                        Ok(mut s) => {
                            let ops: Vec<String> = s.query_map([], |row| row.get(0))
                                .unwrap()
                                .flatten()
                                .collect();
                            json_response(200, json!({ "success": true, "operators": ops }))
                        }
                        Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
                    }
                }
                Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
            }
        }

        (&Method::Get, "/api/reconciliation") => {
            match db.get_connection() {
                Ok(conn) => {
                    match general_inventory::get_reconciliation_from_db(&conn, None, None) {
                        Ok(rows) => json_response(200, json!({ "success": true, "data": rows })),
                        Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
                    }
                }
                Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
            }
        }

        (&Method::Get, "/api/reconciliation/stats") => {
            match db.get_connection() {
                Ok(conn) => {
                    match general_inventory::get_reconciliation_stats_from_db(&conn) {
                        Ok(stats) => json_response(200, json!({ "success": true, "stats": stats })),
                        Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
                    }
                }
                Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
            }
        }

        (&Method::Get, "/api/counts") => {
            // Filtrado opcional por operador ?operator=...
            let operator = url_raw.split("operator=").nth(1)
                .map(|s| s.split('&').next().unwrap_or("").to_string());

            match db.get_connection() {
                Ok(conn) => {
                    let query = if let Some(ref op) = operator {
                        if !op.is_empty() && op != "all" {
                            format!("SELECT id, session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp FROM counts WHERE user_id = '{}' ORDER BY id DESC LIMIT 1000", op)
                        } else {
                            "SELECT id, session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp FROM counts ORDER BY id DESC LIMIT 1000".to_string()
                        }
                    } else {
                        "SELECT id, session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp FROM counts ORDER BY id DESC LIMIT 1000".to_string()
                    };

                    match conn.prepare(&query) {
                        Ok(mut stmt) => {
                            let records: Vec<Value> = stmt.query_map([], |row| {
                                Ok(json!({
                                    "id": row.get::<_, Option<i64>>(0)?,
                                    "session_id": row.get::<_, Option<i64>>(1)?,
                                    "count_type": row.get::<_, String>(2)?,
                                    "item_code": row.get::<_, String>(3)?,
                                    "description": row.get::<_, Option<String>>(4)?,
                                    "location": row.get::<_, String>(5)?,
                                    "counted_qty": row.get::<_, f64>(6)?,
                                    "stage": row.get::<_, i32>(7)?,
                                    "user_id": row.get::<_, String>(8)?,
                                    "status": row.get::<_, String>(9)?,
                                    "unit_cost": row.get::<_, Option<f64>>(10)?,
                                    "timestamp": row.get::<_, String>(11)?,
                                }))
                            }).unwrap().flatten().collect();

                            json_response(200, json!({ "success": true, "counts": records }))
                        }
                        Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
                    }
                }
                Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
            }
        }

        (&Method::Post, "/api/counts") => {
            let mut body_str = String::new();
            if let Err(e) = request.as_reader().read_to_string(&mut body_str) {
                return json_response(400, json!({ "success": false, "error": e.to_string() }));
            }

            let payload: Value = match serde_json::from_str(&body_str) {
                Ok(v) => v,
                Err(e) => return json_response(400, json!({ "success": false, "error": format!("JSON inválido: {}", e) })),
            };

            match db.get_connection() {
                Ok(mut conn) => {
                    let tx = match conn.transaction() {
                        Ok(t) => t,
                        Err(e) => return json_response(500, json!({ "success": false, "error": e.to_string() })),
                    };

                    let counts_array = if let Some(arr) = payload.get("counts").and_then(|c| c.as_array()) {
                        arr.clone()
                    } else if payload.is_array() {
                        payload.as_array().unwrap().clone()
                    } else {
                        vec![payload]
                    };

                    let mut inserted = 0;
                    for c in counts_array {
                        let item_code = c.get("item_code").and_then(|v| v.as_str()).unwrap_or("");
                        if item_code.is_empty() {
                            continue;
                        }
                        let location = c.get("location").and_then(|v| v.as_str()).unwrap_or("N/A");
                        let counted_qty = c.get("counted_qty").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let user_id = c.get("user_id").and_then(|v| v.as_str()).unwrap_or("remote_operator");
                        let count_type = c.get("count_type").and_then(|v| v.as_str()).unwrap_or("cycle_count");
                        let description = c.get("description").and_then(|v| v.as_str()).unwrap_or("");
                        let stage = c.get("stage").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                        let status = c.get("status").and_then(|v| v.as_str()).unwrap_or("completed");
                        let unit_cost = c.get("unit_cost").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                        let timestamp = c.get("timestamp").and_then(|v| v.as_str()).unwrap_or(&now_str);

                        let res = tx.execute(
                            "INSERT INTO counts (session_id, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                            params![1, count_type, item_code, description, location, counted_qty, stage, user_id, status, unit_cost, timestamp],
                        );

                        if res.is_ok() {
                            inserted += 1;
                        }
                    }

                    if let Err(e) = tx.commit() {
                        return json_response(500, json!({ "success": false, "error": e.to_string() }));
                    }

                    json_response(200, json!({ "success": true, "inserted": inserted }))
                }
                Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
            }
        }

        (&Method::Get, "/api/inventory/items") => {
            match db.get_connection() {
                Ok(conn) => {
                    match conn.prepare("SELECT item_code, description, bin_location, system_qty, unit_cost FROM inventory_items LIMIT 5000") {
                        Ok(mut stmt) => {
                            let items: Vec<Value> = stmt.query_map([], |row| {
                                Ok(json!({
                                    "item_code": row.get::<_, String>(0)?,
                                    "description": row.get::<_, Option<String>>(1)?,
                                    "bin_location": row.get::<_, Option<String>>(2)?,
                                    "system_qty": row.get::<_, Option<f64>>(3)?,
                                    "unit_cost": row.get::<_, Option<f64>>(4)?,
                                }))
                            }).unwrap().flatten().collect();

                            json_response(200, json!({ "success": true, "items": items }))
                        }
                        Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
                    }
                }
                Err(e) => json_response(500, json!({ "success": false, "error": e.to_string() })),
            }
        }

        _ => json_response(404, json!({ "success": false, "error": "Endpoint no encontrado" })),
    }
}
