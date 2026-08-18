# Logix Desktop

> Sistema de Gestión de Almacén (WMS) portable y 100% offline, construido con **Tauri + React + Rust + SQLite**.

---

## Descripción

Logix Desktop es una aplicación de escritorio nativa diseñada para la gestión integral de operaciones de almacén (Warehouse Management System). Funciona completamente offline sin necesidad de servidores remotos, conexión a internet ni infraestructura externa. Toda la lógica de negocio y persistencia de datos reside localmente en el equipo del usuario.

### Características principales

- **100% Offline** — Sin dependencia de red, servidores o APIs externas.
- **Portable** — Ejecutable standalone que puede llevarse en USB.
- **Alto rendimiento** — Cálculos pesados ejecutados nativamente en Rust; consultas SQLite en menos de 1 ms.
- **Bajo consumo** — ~30–50 MB de RAM en uso típico.

---

## Stack Tecnológico

| Capa | Tecnología |
| :--- | :--- |
| **Framework Desktop** | [Tauri v1.8](https://v2.tauri.app/) (WebView2) |
| **Backend / Core** | Rust (cálculos, IPC, base de datos) |
| **Base de datos** | SQLite embebido (`rusqlite`) |
| **Frontend** | React 18, React Router v6 |
| **Bundler** | Vite 5 |
| **Estilos** | Tailwind CSS 3 |
| **Herramientas** | PostCSS, ESLint |

---

## Estructura del Proyecto

```
logix_desktop/
├── public/                     # Assets estáticos (iconos, manifest PWA)
├── src/                        # Frontend React
│   ├── App.jsx                 # Router principal y rutas protegidas
│   ├── main.jsx                # Entry point React
│   ├── components/             # Componentes reutilizables
│   │   ├── Layout.jsx          # Layout principal con navegación
│   │   ├── AdminLayout.jsx     # Layout de administración
│   │   ├── DimensionScanner.jsx# Scanner de dimensiones con cámara
│   │   ├── ScannerModal.jsx    # Modal de escaneo QR/barcode
│   │   └── labels/             # Componentes de etiquetas para impresión
│   ├── pages/                  # Páginas de la aplicación (35 vistas)
│   ├── hooks/                  # Custom hooks (useOffline, useTabContext)
│   ├── utils/                  # Utilidades y bridges
│   │   ├── tauriBridge.js      # Bridge principal Tauri IPC → invoke()
│   │   ├── tauriApi.js         # API wrapper sobre tauriBridge
│   │   ├── localApiBridge.js   # Interceptor de /api/* → Tauri commands
│   │   ├── syncManager.js      # Sincronización de datos maestros
│   │   ├── offlineDb.js        # IndexedDB para caché offline
│   │   └── gs1Parser.js        # Parser de códigos de barras GS1
│   └── styles/                 # Hojas de estilo CSS
├── src-tauri/                  # Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs             # Entry point, Builder y comandos IPC
│   │   ├── db.rs               # Conexión y migraciones SQLite
│   │   ├── stock.rs            # Búsqueda y medición de stock
│   │   ├── inbound.rs          # Recepción, alertas y conciliación GRN
│   │   ├── counts.rs           # Conteos cíclicos y sesiones
│   │   ├── picking.rs          # Auditoría de picking y embarques
│   │   ├── slotting.rs         # Algoritmo de slotting y ocupación
│   │   ├── planner.rs          # Planificador de conteos diarios
│   │   ├── general_inventory.rs# Inventario general wall-to-wall
│   │   ├── master_maps.rs      # Mapas maestros GRN/PO/IR
│   │   ├── spot_check.rs       # Spot checks y auditorías express
│   │   └── printer.rs          # Impresión silenciosa ZPL/Sandvik
│   ├── icons/                  # Iconos para todas las plataformas
│   ├── capabilities/           # Permisos Tauri (si aplica)
│   ├── tauri.conf.json         # Configuración de Tauri
│   ├── Cargo.toml              # Dependencias Rust
│   └── build.rs                # Script de compilación
├── data/                       # Datos locales (DB, caches JSON)
├── index.html                  # HTML raíz
├── vite.config.js              # Configuración de Vite
├── tailwind.config.js          # Configuración de Tailwind CSS
└── package.json                # Dependencias y scripts npm
```

---

## Módulos Funcionales

| Módulo | Descripción |
| :--- | :--- |
| **Stock** | Búsqueda de ítems, detalle de producto, medición de dimensiones, bins válidos y estadísticas de ocupación. |
| **Inbound** | Registro de recepciones, auditoría de inbound, conciliación GRN vs. PO, alertas automáticas, historial y archivado de logs. |
| **Cycle Counts** | Sesiones de conteo cíclico por ubicación, recuentos, diferencias, historial y gestión de causas raíz. |
| **Picking** | Auditoría de picking, packing lists, creación de embarques y consolidación de listas. |
| **Spot Check / Express Audit** | Verificaciones rápidas de inventario y auditorías express. |
| **Planner** | Planificador de conteos diarios, ejecución de planes y seguimiento de diferencias. |
| **Slotting** | Configuración de algoritmo de slotting, sugerencias de ubicación, reportes de ocupación por pasillo. |
| **Inventario General** | Proceso wall-to-wall: etapas, reconciliación, aprobación y archivado. |
| **Impresión** | Impresión silenciosa de etiquetas Sandvik/ZPL directamente a impresoras térmicas. |
| **Administración** | Gestión de usuarios, permisos por módulo, zonas de auditor y reset de contraseñas. |
| **Sincronización** | Descarga de datos maestros, picking tracking y sync de datos pendientes. |

---

## Requisitos Previos

- **Node.js** ≥ 18
- **Rust** ≥ 1.70 (con `cargo`)
- **Windows 10/11** con WebView2 (incluido por defecto)
- **npm** ≥ 9

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd logix_desktop

# 2. Instalar dependencias de Node.js
npm install

# 3. Las dependencias de Rust se instalan automáticamente al compilar
```

---

## Scripts Disponibles

| Script | Comando | Descripción |
| :--- | :--- | :--- |
| **Desarrollo** | `npm run tauri:dev` | Inicia la app en modo desarrollo con hot-reload. |
| **Compilación** | `npm run tauri:build` | Compila el ejecutable de producción (.exe / instalador). |
| **Frontend dev** | `npm run dev` | Inicia solo el servidor Vite (sin Tauri). |
| **Build frontend** | `npm run build` | Compila solo el frontend a `dist/`. |
| **Tests Rust** | `npm run test:rust` | Ejecuta tests unitarios del backend Rust. |
| **Tests E2E** | `npm run test:e2e` | Ejecuta tests end-to-end con Playwright. |
| **Lint** | `npm run lint` | Análisis estático de código JavaScript/JSX. |

---

## Compilación de Producción

```bash
# Compilar ejecutable limpio (recomendado para release)
cargo clean --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

El ejecutable resultante se encuentra en:
```
src-tauri/target/release/LogixDesktop.exe
```

Los instaladores (`.msi`, `.nsis`) se generan en:
```
src-tauri/target/release/bundle/
```

---

## Arquitectura IPC

La comunicación entre el frontend React y el backend Rust se realiza mediante la capa IPC nativa de Tauri, sin peticiones HTTP:

```
[ React UI ]  ←─ invoke() ─→  [ Rust Commands ]  ←→  [ SQLite ]
```

- **`tauriBridge.js`** — Wrapper que traduce las llamadas `fetch('/api/...')` del frontend a comandos `invoke()` de Tauri.
- **`localApiBridge.js`** — Interceptor que captura todas las peticiones a `/api/*` y las redirige a los Tauri commands correspondientes.
- **`tauriApi.js`** — Capa de API tipada sobre el bridge.

---

## Datos y Persistencia

- **SQLite** (`logix_local.db`) — Base de datos principal almacenada junto al ejecutable en `./data/`.
- **JSON caches** — Archivos de caché local para PO Lookup, GRN Master Data y reservaciones XDock en `./data/`.
- **IndexedDB** — Caché del lado del navegador para modo offline del frontend.

Las migraciones de esquema se ejecutan automáticamente al iniciar la aplicación desde [`db.rs`](src-tauri/src/db.rs).

---

## Licencia

Proyecto privado — Todos los derechos reservados.
