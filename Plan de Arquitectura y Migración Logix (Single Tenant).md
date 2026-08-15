# **Plan de Arquitectura: Logix Desktop Portable (100% Local)**

## **1. Resumen Ejecutivo**

El presente documento consolida la propuesta técnica para el desarrollo y despliegue del sistema **Logix** como una solución de escritorio nativa, portable y **100% local** (standalone). La aplicación operará sin necesidad de servidores remotos, dominios en internet (`api.logixapp.dev`), ni infraestructura VPS. 

Todo el almacenamiento, lógica de negocio y procesamiento de inventario/cálculos pesados residirá en el equipo local del usuario utilizando **Tauri (Rust + React)** y un motor de base de datos embebido.

---

## **2. Arquitectura de la Aplicación de Escritorio (Logix Desktop)**

### **2.1. Selección Tecnológica**
* **Framework GUI:** **Tauri** (Backend local en Rust + Frontend en React / Vite / Tailwind CSS).
* **Core de Cómputo Local:** Módulo `rust_core` para cálculos de inventario, *slotting* y algoritmos pesados ejecutados directamente en la CPU local.
* **Motor de Base de Datos Local:** **SQLite** embebido (gestionado desde Rust con `sqlx` o `rusqlite`), guardando la información en la carpeta de la aplicación o en modo portable junto al ejecutable.
* **Motor Web Nativo:** Microsoft Edge WebView2 (incorporado en Windows 10/11).

### **2.2. Ventajas del Enfoque Local / Portable**
* **Portabilidad Total:** Un único ejecutable standalone (`.exe` portable) de 10–15 MB que se puede llevar en una memoria USB y ejecutar sin instalar nada.
* **Cero Dependencia de Red:** Funciona 100% offline, sin requerir conexión a internet ni configuración de certificados SSL, Nginx o servidores VPS.
* **Privacidad y Velocidad:** Los datos no salen del equipo local. Las consultas a la base de datos local toman menos de 1 ms.
* **Bajo Consumo de Recursos:** Consumo de memoria RAM optimizado (30–50 MB).

---

## **3. Persistencia de Datos y Comunicación Interna**

### **3.1. Base de Datos Embebida (SQLite)**
* La base de datos (`logix_local.db`) se almacena localmente.
* Al ser un sistema portable, la base de datos residirá junto al binario ejecutable (ej. `./data/logix_local.db`) o en el directorio local de datos del usuario.
* Las migraciones de esquemas de tablas se ejecutan automáticamente desde Rust al iniciar la aplicación.

### **3.2. Comunicación Frontend - Backend (IPC / Tauri Commands)**
En lugar de peticiones HTTP a endpoints externos, el frontend React interactúa directamente con el núcleo Rust mediante la capa IPC (*Inter-Process Communication*) nativa de Tauri:

```
[ Frontend React / UI ]  <--- (Tauri IPC / invoke) --->  [ Core Rust / rust_core ]  <--->  [ SQLite (logix_local.db) ]
```

* **Llamadas Directas:** Se eliminan proxies, latencias de red, cabeceras HTTP y configuraciones de CORS.
* **Seguridad:** Los métodos expuestos por Rust están fuertemente tipados y controlados.

---

## **4. Sincronización Local con Dispositivos Móviles / Colectoras (Opcional por Wi-Fi LAN)**

Si en el futuro se requiere conectar colectoras de datos o dispositivos móviles en bodega:
* La aplicación de escritorio puede iniciar opcionalmente un servidor HTTP liviano local en Rust (`Axum` o `Actix`) escuchando únicamente en la **red local (WLAN/LAN)** (ej. `http://192.168.1.X:8080`).
* Las colectoras se conectan directamente a la dirección IP local del equipo dentro de la misma red local sin salir a internet.

---

## **5. Esquema de Portabilidad y Respaldos**

### **5.1. Ejecución Standalone**
* El ejecutable de Logix Desktop no requiere proceso de instalación.
* Al abrir `logix.exe`, se verifica la presencia de la base de datos local y los archivos de configuración en su mismo directorio. Si no existen, los genera automáticamente.

### **5.2. Respaldos (Backups) Locales**
* Función integrada en la interfaz para exportar/importar copias de seguridad de la base de datos SQLite en formato `.db` o `.zip` comprimido hacia cualquier ubicación local o almacenamiento externo.

---

## **6. Hoja de Ruta e Implementación (Roadmap Local)**

| Fase | Tarea Principal | Entregable |
| :--- | :--- | :--- |
| **Fase 1** | **Inicialización de Tauri en frontend/** | Configuración de `src-tauri`, integración con `rust_core` y generación de binario `.exe` portable. |
| **Fase 2** | **Integración de Base de Datos Embebida (SQLite)** | Configuración de `SQLx` / `rusqlite` en Rust con migraciones automáticas al iniciar. |
| **Fase 3** | **Implementación de Tauri Commands (IPC)** | Sustitución de clientes HTTP (Axios/Fetch) por invocaciones IPC de Tauri (`invoke('guardar_producto')`). |
| **Fase 4** | **Sistema de Copias de Seguridad Locales** | Módulo en Rust para exportación e importación de base de datos `.db`. |
| **Fase 5** | **Empaquetado y Distribución Portable** | Configuración de compilación para binario `.exe` standalone sin instalador. |

