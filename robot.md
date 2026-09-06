### Enfoque 2: Bot de Automatización Web / RPA (Scraping de portal web)

  Si los reportes solo se pueden obtener navegando a una página web en Azure, completando un formulario de usuario/contraseña y presionando un botón de "Exportar a CSV":

  • Headless Bot (Playwright / Puppeteer / Rust): Se puede integrar un módulo que abra un navegador en segundo plano (invisible), inicie sesión, navegue a la URL del reporte, ejecute la descarga del CSV y lo
  guarde en la carpeta local de Logix.
  • Ventana de Autenticación Integrada (para empresas con MFA / 2FA): Si el portal de Azure exige autenticación en dos pasos (código al teléfono o Microsoft Authenticator), Tauri puede abrir una pequeña ventana
  de inicio de sesión de Microsoft una sola vez; el bot captura la cookie/token de sesión y las siguientes descargas se ejecutan de forma 100% automática en segundo plano.
  ──────
  ### ¿Cómo funcionaría el flujo en Logix Desktop?

  ┌────────────────────┐                         ┌───────────────────────────┐                ┌────────────────────┐                   ┌────────────────────────────────────────┐
  │                    │                         │                           │                │                    │                   │                                        │
  │ Azure / Portal Web ├─"Bot─/─API─Programada"─►│ Descarga en segundo plano ├─"CSV─Reporte"─►│ Parseo e inserción ├─"logix_local.db"─►│ Actualización instantánea en Pantallas │
  │                    │                         │                           │                │                    │                   │                                        │
  └────────────────────┘                         └───────────────────────────┘                └────────────────────┘                   └────────────────────────────────────────┘

  1. Tarea programada (Background Timer / Cron):
      • En el backend de Rust se define una tarea que se ejecute a intervalos regulares (ej. cada hora, o cada vez que inicies la aplicación).
  2. Descarga y Validación:
      • El bot descarga el archivo CSV más reciente y verifica su integridad.
  3. Ingesta Automática a SQLite:
      • Los datos del CSV se insertan directamente en las tablas correspondientes (inbound_master, inventarios, ubicaciones, etc.) sin que el usuario tenga que cargarlo a mano.
  4. Notificación en la Interfaz:
      • En la barra superior o en un aviso sutil de Windows 11 Fluent se informa: "Reporte sincronizado automáticamente desde Azure a las HH:MM".
