# Guía de Conexión y Migración: App Móvil (React / Android) ➔ Logix Desktop

Este documento consolida la arquitectura, el análisis técnico y los pasos de migración para desconectar la aplicación móvil Android (escrita en React) del VPS de producción en la nube y conectarla directamente al sistema **Logix Desktop** (Rust + SQLite) en red local.

---

## 1. Resumen de Arquitectura

Actualmente, **Logix Desktop** funciona bajo un modelo **100% offline, portable y autónomo**, con una base de datos local SQLite (`logix_local.db`) y lógica de alto rendimiento procesada en Rust.

Para permitir que dispositivos móviles y colectoras de datos (Zebra, Honeywell, tablets y smartphones Android) interactúen con el sistema sin requerir internet ni VPS, la aplicación cuenta con un **Servidor Central Integrado (Host Server)** implementado en Rust (`src-tauri/src/server.rs`) utilizando `tiny_http`.

```
┌───────────────────────────────────────────┐
│     Dispositivos Móviles / Colectoras     │
│   (App React: Inbound, Picking, etc.)    │
└─────────────────────┬─────────────────────┘
                      │  Peticiones REST HTTP / JSON
                      │  (Wi-Fi LAN / WLAN de Bodega)
                      ▼
┌───────────────────────────────────────────┐
│         Logix Desktop (Modo Host)         │
│   Host Server en Rust (0.0.0.0:8088)      │
│   - CORS abierto (*)                      │
│   - Transacciones atómicas                │
└─────────────────────┬─────────────────────┘
                      │  rusqlite nativo (< 1 ms)
                      ▼
┌───────────────────────────────────────────┐
│        Base de Datos SQLite Local         │
│             (logix_local.db)              │
└───────────────────────────────────────────┘
```

---

## 2. Los 5 Módulos Operativos y Mapeo de Endpoints

La aplicación móvil gestiona cinco flujos operativos de almacén. A continuación se detalla cómo se mapean estos procesos a los módulos nativos en Rust:

### 2.1. Inbound (Recepción y Auditoría)
* **Funcionalidad móvil:** Registro de recepciones por bulto/GRN, verificación contra órdenes de compra (PO) y alertas de discrepancias.
* **Módulo Rust:** `src-tauri/src/inbound.rs`
* **Endpoints:**
  * `GET /api/inbound/logs`: Consulta el historial de recepciones y versiones.
  * `POST /api/inbound/logs`: Registra un nuevo ítem o bulto recibido en planta.
  * `GET /api/inbound/alerts`: Consulta alertas de inconsistencias o sobre-recepciones.

### 2.2. Consulta de Inventario
* **Funcionalidad móvil:** Escaneo de códigos de barra (SKU, EAN, GS1) o consulta por bin/ubicación física para ver stock, dimensiones y ficha de producto.
* **Módulo Rust:** `src-tauri/src/stock.rs`
* **Endpoints:**
  * `GET /api/stock/search?q={query}`: Búsqueda rápida por código, descripción o EAN.
  * `GET /api/stock/by_location?loc={bin}`: Lista de productos alojados en una ubicación específica.
  * `GET /api/stock/item/{item_code}`: Ficha técnica completa, dimensiones y estado de rotación.
  * `GET /api/inventory/items`: Descarga del catálogo completo para almacenamiento offline en el móvil.

### 2.3. Conteos Cíclicos
* **Funcionalidad móvil:** Asignación de pasillos o bins a operarios, captura de cantidades contadas y detección inmediata de diferencias.
* **Módulo Rust:** `src-tauri/src/counts.rs`
* **Endpoints:**
  * `GET /api/counts/active_session`: Obtiene la sesión activa de conteo cíclico.
  * `POST /api/counts`: Inserta lecturas de conteo atómicamente en la tabla `counts` *(ya implementado en `server.rs`)*.
  * `GET /api/counts/recounts`: Lista de ítems pendientes de segundo conteo o recuento por diferencia.

### 2.4. Inventario General (Wall-to-Wall / W2W)
* **Funcionalidad móvil:** Conteos ciegos masivos por zonas/pasillos organizados por etapas (Etapa 1, Etapa 2 y Etapa 3).
* **Módulo Rust:** `src-tauri/src/general_inventory.rs`
* **Endpoints:**
  * `POST /api/counts`: Registro de conteo enviando el campo `"stage": 1|2|3` y `"count_type": "w2w"`.
  * `GET /api/reconciliation`: Consulta la tabla de reconciliación y estado de avance *(ya implementado en `server.rs`)*.
  * `GET /api/reconciliation/stats`: Métricas de discrepancia, precisión y porcentaje completado *(ya implementado en `server.rs`)*.

### 2.5. Picking (Preparación y Auditoría de Pedidos)
* **Funcionalidad móvil:** Descarga de listas de empaque / órdenes de despacho, validación de ítems escaneados y confirmación de bultos.
* **Módulo Rust:** `src-tauri/src/picking.rs`
* **Endpoints:**
  * `GET /api/picking/tracking`: Lista de órdenes de picking pendientes y su estado de preparación.
  * `GET /api/picking/order/{order_number}`: Detalle de líneas a preparar para una orden.
  * `POST /api/picking/audit`: Guarda la auditoría completa de packing list y confirmación de despacho.

---

## 3. Guía de Cambios Técnicos en la App Móvil (React / Android)

### Paso 1: Permitir Tráfico HTTP en Android (`usesCleartextTraffic`)
Las versiones recientes de Android rechazan conexiones sin cifrado SSL (`http://`). Debido a que el servidor de escritorio corre en una IP privada local (ej. `http://192.168.1.50:8088`), es indispensable habilitar el tráfico de texto plano.

En el archivo `android/app/src/main/AndroidManifest.xml`:
```xml
<application
    android:name=".MainApplication"
    android:label="@string/app_name"
    android:icon="@mipmap/ic_launcher"
    android:usesCleartextTraffic="true"
    android:theme="@style/AppTheme">
    ...
</application>
```

---

### Paso 2: Reemplazo de la URL Base Fija por una URL Configurable
Sustituir la variable fija del VPS por un gestor de configuración persistente (`AsyncStorage` en React Native o `localStorage` en Capacitor):

```javascript
// src/services/apiConfig.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'LOGIX_SERVER_BASE_URL';
const DEFAULT_URL = 'http://192.168.1.50:8088';

export const getServerUrl = async () => {
    try {
        const savedUrl = await AsyncStorage.getItem(STORAGE_KEY);
        return savedUrl ? savedUrl.trim().replace(/\/+$/, '') : DEFAULT_URL;
    } catch (e) {
        return DEFAULT_URL;
    }
};

export const setServerUrl = async (newUrl) => {
    const cleanUrl = newUrl.trim().replace(/\/+$/, '');
    await AsyncStorage.setItem(STORAGE_KEY, cleanUrl);
};

export const apiFetch = async (endpoint, options = {}) => {
    const baseUrl = await getServerUrl();
    const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    
    return fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers || {})
        }
    });
};
```

---

### Paso 3: Emparejamiento por Escaneo de Código QR
Para evitar que los operarios introduzcan direcciones IP manualmente en los teléfonos:

1. **En Logix Desktop:** La ventana de configuración muestra un código QR generado con la URL del host (ej. `http://192.168.1.45:8088`).
2. **En la App Móvil:** Se incluye una pantalla de vinculación con la cámara para leer el código QR:

```javascript
// Pantalla de Vinculación en React
const onScanServerQR = async (scannedText) => {
    try {
        // Validar conexión con el endpoint de salud
        const response = await fetch(`${scannedText}/api/status`);
        const data = await response.json();
        
        if (data.status === 'online') {
            await setServerUrl(scannedText);
            alert(`Conectado exitosamente a: ${data.server_name}`);
        } else {
            alert('El servidor no respondió correctamente.');
        }
    } catch (err) {
        alert('No se pudo conectar a la IP indicada. Verifique que estén en la misma red Wi-Fi.');
    }
};
```

---

### Paso 4: Arquitectura Offline-First (Resiliencia en Zonas Ciegas de Bodega)
En bodegas metálicas o pasillos lejanos es común perder señal Wi-Fi. La aplicación móvil debe seguir la siguiente estrategia:

1. **Caché inicial:** Al iniciar el turno o al conectarse, la app sincroniza el catálogo general de ítems (`GET /api/inventory/items`) y lo almacena localmente en SQLite / WatermelonDB / IndexedDB en el móvil.
2. **Lectura local:** Las consultas de código de barras y validación de ubicaciones se resuelven contra la base de datos interna del móvil en menos de 1 milisegundo.
3. **Cola de envío:** Cada conteo, picking o bulto recibido se guarda en una tabla local `pending_queue`.
4. **Despacho atómico:** En segundo plano o mediante un botón "Sincronizar", la app envía los registros acumulados en lote hacia `POST /api/counts` o los endpoints correspondientes.

---

## 4. Activación del Servidor en Logix Desktop

1. Iniciar **Logix Desktop** en la PC principal de bodega.
2. Ir a **Configuración de Red Local** (accesible desde el menú de opciones).
3. Seleccionar el modo **"Servidor Central (Compartir base de datos)"**.
4. Confirmar el puerto (por defecto `8088`) y pulsar **"Iniciar servidor"**.
5. Asegurarse de que en la alerta del Firewall de Windows se haya autorizado el acceso a **Redes privadas**.
6. Conectar los teléfonos móviles a la misma red Wi-Fi que la PC.

---

## 5. Comparativa de Rendimiento y Beneficios

| Aspecto | Modelo Anterior (VPS en la Nube) | Nuevo Modelo Local (Logix Desktop) |
| :--- | :--- | :--- |
| **Dependencia de Internet** | Crítica. Si se cae el enlace de internet, la bodega se detiene. | **Cero**. Funciona 100% offline a través de la red Wi-Fi local. |
| **Latencia de Consulta** | 150 – 400 ms por escaneo (dependiendo de la conexión 4G/WAN). | **1 – 5 ms** (tráfico directo en LAN por Rust y SQLite). |
| **Costos Recurrentes** | Pago mensual de hosting VPS, dominio y mantenimiento de certificados SSL. | **$0**. La propia máquina de bodega actúa de servidor. |
| **Seguridad de Datos** | La información viaja por la web pública hacia servidores externos. | Los datos nunca salen de la infraestructura física del cliente. |

