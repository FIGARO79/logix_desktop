use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;

pub struct Database {
    db_path: PathBuf,
}

impl Database {
    pub fn new() -> Self {
        let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        // Si la aplicación se ejecuta dentro de src-tauri en tauri dev, subimos al directorio raíz
        if path.ends_with("src-tauri") {
            path.pop();
        }
        path.push("data");
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        path.push("logix_local.db");
        Self { db_path: path }
    }

    pub fn get_connection(&self) -> Result<Connection> {
        Connection::open(&self.db_path)
    }

    pub fn init(&self) -> Result<()> {
        let conn = self.get_connection()?;

        // Tabla de usuarios local
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'operator',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // Insertar usuario admin predeterminado si no existe
        conn.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES ('admin', 'admin123', 'admin');",
            [],
        )?;

        // Tabla de maestro de inventario
        conn.execute(
            "CREATE TABLE IF NOT EXISTS inventory_items (
                item_code TEXT PRIMARY KEY,
                description TEXT,
                bin_location TEXT,
                system_qty REAL DEFAULT 0.0,
                unit_cost REAL DEFAULT 0.0,
                weight_per_unit REAL DEFAULT 0.0,
                sic_code TEXT DEFAULT '0',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // Tabla de ubicaciones de bodega (Storage Locations)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS storage_locations (
                bin_code TEXT PRIMARY KEY,
                zone TEXT,
                level INTEGER DEFAULT 0,
                spot TEXT DEFAULT 'cold',
                score INTEGER DEFAULT 0
            );",
            [],
        )?;

        // Tabla de conteos físicos y auditorías
        conn.execute(
            "CREATE TABLE IF NOT EXISTS counts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                count_type TEXT NOT NULL,
                item_code TEXT NOT NULL,
                location TEXT NOT NULL,
                counted_qty REAL NOT NULL,
                stage INTEGER DEFAULT 1,
                user_id TEXT DEFAULT 'local_user',
                status TEXT DEFAULT 'completed',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // Tabla de Inbound (Recepciones de mercancía)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS inbound_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                po_number TEXT NOT NULL,
                item_code TEXT NOT NULL,
                expected_qty REAL DEFAULT 0.0,
                received_qty REAL DEFAULT 0.0,
                status TEXT DEFAULT 'pending',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // Tabla de Picking (Auditorías de alistamiento)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS picking_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT NOT NULL,
                item_code TEXT NOT NULL,
                requested_qty REAL DEFAULT 0.0,
                picked_qty REAL DEFAULT 0.0,
                status TEXT DEFAULT 'pending',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // Reglas de Slotting (Configuración)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS slotting_rules (
                rule_key TEXT PRIMARY KEY,
                rule_value TEXT NOT NULL
            );",
            [],
        )?;

        Ok(())
    }
}
