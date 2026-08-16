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

        // Optimización de SQLite (WAL Mode y Busy Timeout)
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;")?;

        // 1. Tabla de usuarios local
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'operator',
                permissions TEXT DEFAULT 'stock,inbound,picking,inventory,planner,counts,admin',
                assigned_zones TEXT DEFAULT '',
                is_approved INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // Migración automática de columnas para usuarios
        Self::add_column_if_not_exists(&conn, "users", "permissions", "TEXT DEFAULT 'stock,inbound,picking,inventory,planner,counts,admin'")?;
        Self::add_column_if_not_exists(&conn, "users", "assigned_zones", "TEXT DEFAULT ''")?;
        Self::add_column_if_not_exists(&conn, "users", "is_approved", "INTEGER DEFAULT 1")?;
        Self::add_column_if_not_exists(&conn, "users", "created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP")?;

        // Insertar usuario admin predeterminado si no existe
        conn.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, role, permissions, is_approved) 
             VALUES ('admin', 'admin123', 'admin', 'stock,inbound,picking,inventory,planner,counts,admin', 1);",
            [],
        )?;

        // 2. Tabla de maestro de inventario (Inventory Items)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS inventory_items (
                item_code TEXT PRIMARY KEY,
                description TEXT,
                bin_location TEXT,
                additional_bins TEXT DEFAULT '',
                system_qty REAL DEFAULT 0.0,
                unit_cost REAL DEFAULT 0.0,
                weight_per_unit REAL DEFAULT 0.0,
                sic_code TEXT DEFAULT '0',
                length_cm REAL DEFAULT 0.0,
                width_cm REAL DEFAULT 0.0,
                height_cm REAL DEFAULT 0.0,
                volume_cm3 REAL DEFAULT 0.0,
                abc_code TEXT DEFAULT '',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            [],
        )?;

        // 3. Tabla de ubicaciones de bodega (Storage Locations)
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

        // 4. Inbound Logs (Recepciones físicas)
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
        )?;

        // 5. Inbound Alerts (Auditoría de Inbound)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS inbound_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_type TEXT NOT NULL,
                import_reference TEXT DEFAULT '',
                item_code TEXT DEFAULT '',
                message TEXT NOT NULL,
                severity TEXT DEFAULT 'warning',
                resolved INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 6. IR Reconciliations
        conn.execute(
            "CREATE TABLE IF NOT EXISTS ir_reconciliations (
                id TEXT PRIMARY KEY,
                import_reference TEXT NOT NULL,
                waybill TEXT,
                item_code TEXT,
                item_description TEXT,
                expected_qty REAL DEFAULT 0.0,
                received_qty REAL DEFAULT 0.0,
                diff_qty REAL DEFAULT 0.0,
                status TEXT DEFAULT 'pending',
                user_id TEXT,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 6.1. Tablas de Conciliación de GRN guardadas (Snapshot fotográfico permanente)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS saved_grn_reconciliations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grn_number TEXT NOT NULL,
                import_reference TEXT NOT NULL,
                waybill TEXT DEFAULT '',
                total_lines INTEGER DEFAULT 0,
                total_expected REAL DEFAULT 0.0,
                total_received REAL DEFAULT 0.0,
                total_difference REAL DEFAULT 0.0,
                status TEXT DEFAULT 'CONCILIADO',
                reconciled_by TEXT NOT NULL,
                reconciled_at TEXT NOT NULL,
                notes TEXT DEFAULT ''
            );",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS saved_grn_reconciliation_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reconciliation_id INTEGER NOT NULL,
                grn_number TEXT NOT NULL,
                import_reference TEXT NOT NULL,
                waybill TEXT DEFAULT '',
                order_line TEXT DEFAULT '',
                item_code TEXT NOT NULL,
                description TEXT DEFAULT '',
                location TEXT DEFAULT '',
                relocated_bin TEXT DEFAULT '',
                qty_expected REAL DEFAULT 0.0,
                qty_received REAL DEFAULT 0.0,
                difference REAL DEFAULT 0.0,
                difference_reason TEXT DEFAULT '',
                operator_comment TEXT DEFAULT '',
                reconciled_at TEXT NOT NULL,
                FOREIGN KEY (reconciliation_id) REFERENCES saved_grn_reconciliations(id) ON DELETE CASCADE
            );",
            [],
        )?;

        // 7. Sesiones de conteo cíclico / general
        conn.execute(
            "CREATE TABLE IF NOT EXISTS count_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                user_username TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                status TEXT NOT NULL DEFAULT 'in_progress',
                inventory_stage INTEGER NOT NULL DEFAULT 1
            );",
            [],
        )?;

        // 8. Ubicaciones por sesión de conteo
        conn.execute(
            "CREATE TABLE IF NOT EXISTS session_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                location_code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                closed_at TEXT,
                count_stage INTEGER DEFAULT 1,
                FOREIGN KEY (session_id) REFERENCES count_sessions(id) ON DELETE CASCADE
            );",
            [],
        )?;

        // 9. Tabla de conteos físicos (Counts)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS counts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER DEFAULT 1,
                count_type TEXT NOT NULL DEFAULT 'cycle_count',
                item_code TEXT NOT NULL,
                description TEXT DEFAULT '',
                location TEXT NOT NULL,
                counted_qty REAL NOT NULL,
                stage INTEGER DEFAULT 1,
                user_id TEXT DEFAULT 'local_user',
                status TEXT DEFAULT 'completed',
                unit_cost REAL DEFAULT 0.0,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 10. Recount List
        conn.execute(
            "CREATE TABLE IF NOT EXISTS recount_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_code TEXT NOT NULL,
                stage_to_count INTEGER DEFAULT 2,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL
            );",
            [],
        )?;

        // 11. Picking Orders & Audits
        conn.execute(
            "CREATE TABLE IF NOT EXISTS picking_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shipment_id TEXT NOT NULL,
                order_number TEXT,
                customer_name TEXT,
                carrier TEXT,
                item_code TEXT NOT NULL,
                item_description TEXT,
                requested_qty REAL DEFAULT 0.0,
                picked_qty REAL DEFAULT 0.0,
                status TEXT DEFAULT 'Pendiente',
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS picking_audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shipment_id TEXT NOT NULL,
                order_number TEXT,
                item_code TEXT NOT NULL,
                item_description TEXT,
                requested_qty REAL DEFAULT 0.0,
                audited_qty REAL DEFAULT 0.0,
                difference REAL DEFAULT 0.0,
                auditor_user TEXT,
                status TEXT DEFAULT 'Auditado',
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 12. Spot Checks & Express Audits
        conn.execute(
            "CREATE TABLE IF NOT EXISTS spot_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_code TEXT NOT NULL,
                description TEXT,
                location TEXT NOT NULL,
                system_qty REAL DEFAULT 0.0,
                counted_qty REAL DEFAULT 0.0,
                diff_qty REAL DEFAULT 0.0,
                user_id TEXT,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS express_audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_code TEXT NOT NULL,
                description TEXT,
                location TEXT NOT NULL,
                system_qty REAL DEFAULT 0.0,
                audited_qty REAL DEFAULT 0.0,
                diff_qty REAL DEFAULT 0.0,
                user_id TEXT,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 13. Planner & Ejecuciones
        conn.execute(
            "CREATE TABLE IF NOT EXISTS planner_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS planner_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_date TEXT NOT NULL,
                item_code TEXT NOT NULL,
                description TEXT,
                bin_location TEXT,
                status TEXT DEFAULT 'Pendiente',
                user_id TEXT,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 14. Reglas de Slotting & Configuración general
        conn.execute(
            "CREATE TABLE IF NOT EXISTS slotting_rules (
                rule_key TEXT PRIMARY KEY,
                rule_value TEXT NOT NULL
            );",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
            [],
        )?;

        // Migración automática de columnas para compatibilidad y actualizaciones de esquema
        Self::add_column_if_not_exists(&conn, "inventory_items", "additional_bins", "TEXT DEFAULT ''")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "length_cm", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "width_cm", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "height_cm", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "volume_cm3", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "abc_code", "TEXT DEFAULT ''")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "sic_code", "TEXT DEFAULT '0'")?;
        Self::add_column_if_not_exists(&conn, "inventory_items", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP")?;

        Self::add_column_if_not_exists(&conn, "inbound_logs", "client_id", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "inbound_logs", "archived_at", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "inbound_logs", "version_date", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "inbound_logs", "qty_grn", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "inbound_logs", "difference", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "inbound_logs", "relocated_bin", "TEXT")?;

        Self::add_column_if_not_exists(&conn, "inbound_alerts", "resolved", "INTEGER DEFAULT 0")?;
        Self::add_column_if_not_exists(&conn, "inbound_alerts", "severity", "TEXT DEFAULT 'warning'")?;

        Self::add_column_if_not_exists(&conn, "session_locations", "count_stage", "INTEGER DEFAULT 1")?;
        Self::add_column_if_not_exists(&conn, "session_locations", "closed_at", "TEXT")?;

        Self::add_column_if_not_exists(&conn, "counts", "notes", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "counts", "unit_cost", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "counts", "stage", "INTEGER DEFAULT 1")?;
        Self::add_column_if_not_exists(&conn, "counts", "status", "TEXT DEFAULT 'completed'")?;
        Self::add_column_if_not_exists(&conn, "counts", "description", "TEXT DEFAULT ''")?;

        Self::add_column_if_not_exists(&conn, "recount_list", "stage_to_count", "INTEGER DEFAULT 2")?;
        Self::add_column_if_not_exists(&conn, "recount_list", "status", "TEXT DEFAULT 'pending'")?;
        Self::add_column_if_not_exists(&conn, "recount_list", "approved", "INTEGER DEFAULT 0")?;
        Self::add_column_if_not_exists(&conn, "recount_list", "created_at", "TEXT DEFAULT ''")?;

        Self::add_column_if_not_exists(&conn, "picking_orders", "order_number", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "picking_orders", "customer_name", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "picking_orders", "carrier", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "picking_orders", "item_description", "TEXT")?;
        Self::add_column_if_not_exists(&conn, "picking_orders", "picked_qty", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "picking_orders", "status", "TEXT DEFAULT 'Pendiente'")?;

        Self::add_column_if_not_exists(&conn, "picking_audits", "difference", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "picking_audits", "status", "TEXT DEFAULT 'Auditado'")?;

        Self::add_column_if_not_exists(&conn, "spot_checks", "diff_qty", "REAL DEFAULT 0.0")?;
        Self::add_column_if_not_exists(&conn, "express_audits", "diff_qty", "REAL DEFAULT 0.0")?;

        // Índices clave para acelerar consultas a < 1ms
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_inventory_bin ON inventory_items(bin_location);
             CREATE INDEX IF NOT EXISTS idx_counts_item ON counts(item_code);
             CREATE INDEX IF NOT EXISTS idx_counts_loc ON counts(location);
             CREATE INDEX IF NOT EXISTS idx_inbound_ir ON inbound_logs(import_reference);
             CREATE INDEX IF NOT EXISTS idx_inbound_item ON inbound_logs(item_code);
             CREATE INDEX IF NOT EXISTS idx_picking_shipment ON picking_orders(shipment_id);
             CREATE INDEX IF NOT EXISTS idx_picking_audits_shipment ON picking_audits(shipment_id);"
        )?;

        Ok(())
    }

    pub fn add_column_if_not_exists(conn: &Connection, table: &str, column: &str, col_type_def: &str) -> Result<()> {
        let query = format!("PRAGMA table_info({})", table);
        let mut stmt = conn.prepare(&query)?;
        let mut exists = false;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name.eq_ignore_ascii_case(column) {
                exists = true;
                break;
            }
        }
        if !exists {
            let alter = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, col_type_def);
            let _ = conn.execute(&alter, []);
        }
        Ok(())
    }
}

