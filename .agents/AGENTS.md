# Directivas de Desarrollo y Uso Obligatorio de MCP (Codebase Memory Graph)

Este documento establece las directivas, reglas de arquitectura y el catálogo de skills que **todo asistente de IA / agente de código** debe seguir obligatoriamente antes y durante la propuesta de cambios, optimizaciones o refactorizaciones en este proyecto.

---

## 1. Regla Principal: Consulta Obligatoria del Grafo MCP

> **IMPORTANTE:** Antes de realizar cualquier modificación de código, adición de características o refactorización arquitectónica, el agente **DEBE consultar el servidor MCP de memoria de código (`codebase-memory-mcp`)** para inspeccionar las dependencias, conexiones, rutas de llamadas y jerarquía del grafo.

---

## 2. Orden de Prioridad de Herramientas MCP

| Prioridad | Herramienta | Propósito y Cuándo Usarla |
| :--- | :--- | :--- |
| **1** | `search_graph` | Buscar componentes, funciones, clases, rutas y hooks por patrón de nombre. |
| **2** | `trace_path` | Trazar conexiones entrantes y salientes (*inbound / outbound*) para entender quién llama a qué y medir impacto antes de editar. |
| **3** | `get_code_snippet` | Obtener el código fuente de funciones o componentes específicos indexados. |
| **4** | `query_graph` | Ejecutar consultas Cypher personalizadas para relaciones complejas entre módulos. |
| **5** | `get_architecture` | Obtener el mapa de arquitectura general y resumen del proyecto. |
| **6** | `detect_changes` / `index_repository` | Verificar sincronización del grafo e indexar cambios recientes en el código. |

*Nota: Solo recurrir a búsquedas tradicionales (grep / búsqueda por texto) para cadenas literales, mensajes de error específicos o archivos de configuración no incluidos en el grafo.*

---

## 3. Catálogo de Skills Instaladas (`.agents/skills/`)

El agente debe aplicar las guías y mejores prácticas de las siguientes skills ubicadas en `.agents/skills/`:

| Skill | Directorio | Cuándo Aplicarla / Propósito |
| :--- | :--- | :--- |
| **`tauri-v2`** | `.agents/skills/tauri-v2` | Desarrollo y configuración de Tauri v2+, backend en Rust, comandos `#[tauri::command]`, IPC (`invoke`, `emit`, channels) y capabilities/permisos. |
| **`react-best-practices`** | `.agents/skills/react-best-practices` | Directrices de rendimiento, optimización de renderizado, hooks y buenas prácticas de React (Vercel Engineering). |
| **`composition-patterns`** | `.agents/skills/composition-patterns` | Patrones de composición en React, componentes compuestos, render props, context providers y arquitectura limpia de componentes. |
| **`frontend-design`** | `.agents/skills/frontend-design` | Creación de interfaces modernas, atractivas, micro-interacciones, diseño visual de alto nivel y estética pulida. |
| **`tailwind-css-patterns`** | `.agents/skills/tailwind-css-patterns` | Patrones de diseño utility-first con Tailwind CSS, layouts responsivos, flexbox, grid y tokens de diseño. |
| **`vite`** | `.agents/skills/vite` | Configuración de bundler, plugins, optimización de construcción y desarrollo rápido con Vite. |
| **`nodejs-backend-patterns`** | `.agents/skills/nodejs-backend-patterns` | Arquitectura de servicios backend, middlewares, manejo de errores, autenticación e integración con base de datos. |
| **`nodejs-best-practices`** | `.agents/skills/nodejs-best-practices` | Principios de diseño asíncrono, seguridad y decisiones estructurales en Node.js. |
| **`playwright-best-practices`** | `.agents/skills/playwright-best-practices` | Creación y mantenimiento de tests E2E, Page Object Model, pruebas de accesibilidad (axe-core) y estabilidad de suites. |
| **`accessibility`** | `.agents/skills/accessibility` | Auditoría y accesibilidad web siguiendo directrices WCAG 2.2, navegación por teclado y lectores de pantalla. |
| **`seo`** | `.agents/skills/seo` | Optimización de etiquetas semánticas, metadatos estructurados y jerarquía accesible. |

---

## 4. Flujo de Trabajo para Optimización y Mejoras

1. **Inspección de Dependencias y Conexiones (MCP):**
   - Antes de modificar un componente (ej. en `src/components/`, `src/pages/` o `src-tauri/`), ejecutar `trace_path` para identificar todas las dependencias dependientes.
   - Analizar el flujo de datos y estados compartidos para evitar efectos secundarios (*side effects*).

2. **Selección y Aplicación de Skills:**
   - Según el tipo de tarea (UI, React, Tauri, Backend, Tests, CSS), consultar y seguir las pautas de la skill correspondiente en `.agents/skills/`.

3. **Evaluación de Impacto:**
   - Validar cómo la mejora afectará a los componentes consumidores y al backend en Tauri/Rust si aplica.
   - Proponer cambios modulares y reutilizables basados en la estructura del grafo existente.

4. **Verificación Post-Cambio:**
   - Actualizar o verificar el estado del índice con `detect_changes` tras modificaciones significativas para mantener la coherencia del grafo de conocimiento.

---

## 5. Ejemplos de Uso Rápido (MCP)

- **Buscar un componente o función:**
  ```cypher
  search_graph(name_pattern=".*Layout.*")
  ```
- **Ver quién consume un hook o función antes de refactorizar:**
  ```cypher
  trace_path(function_name="useAuth", direction="inbound")
  ```
- **Ver qué llama una función:**
  ```cypher
  trace_path(function_name="fetchOrders", direction="outbound")
  ```

---

## 6. Directivas Estrictas de Diseño UI / UX (Windows 11 Fluent UI)

Todo agente o asistente que proponga, cree o modifique componentes de interfaz visual debe adherirse obligatoriamente a las siguientes directrices:

1. **Tipografía y Legibilidad:**
   - **Fuente obligatoria:** Segoe UI (`font-['Segoe_UI',Tahoma,sans-serif]` o clase personalizada de proyecto).
   - **Peso tipográfico:** Estrictamente normal (`font-normal`, evitar negritas o `font-semibold`/`font-bold` salvo encabezados muy específicos de sección).
   - **Color de texto:** Los textos y encabezados deben usar color negro pleno (`text-black` / `#000000` o `#1f1f1f`) en reemplazo de tonos tenues o zinc descolorido.
   - **Cero emojis:** Queda estrictamente prohibido el uso de emojis decorativos (🚀, 📦, ⚙️, etc.) en interfaces, tablas, botones o títulos. Utilizar texto sobrio o iconos SVG monocromáticos discretos cuando sea indispensable.

2. **Interacciones y Punteros (Cursores):**
   - **Navegación y clics:** El cursor en enlaces, menús y opciones de navegación (incluido el panel lateral / Sidebar) debe ser siempre el puntero estándar de selección / dedo señalando (`cursor-pointer`). Evitar cursores de mano abierta/cerrada (`cursor-grab` / `cursor-grabbing`) para elementos de navegación simple.
   - **Arrastre y soltar (Drag & Drop):**
     - En entornos de escritorio Tauri / WebView2 sobre Windows, implementar drag & drop mediante **Pointer Events** nativos (`onPointerDown`, `pointermove`, `pointerup`) o librerías basadas en eventos de puntero, para evitar la interferencia del hook OLE `IDropTarget` que congela o torna transparente el cursor.
     - Las tarjetas u opciones no deben mostrar indicadores invasivos (flechas o puntos innecesarios) que puedan tapar o comprometer el texto.
     - Botones de acción complementarios (como "Restablecer Orden" o mensajes explicativos) deben ubicarse al pie de la página o en zonas no invasivas, manteniendo despejadas las cabeceras principales.

3. **Excepción Intocable - Estándar de Etiqueta Industrial:**
   - **Componentes de etiqueta:** [`SandvikLabel.jsx`](src/components/SandvikLabel.jsx) y su hoja de estilos [`Label.css`](src/styles/Label.css) representan un estándar milimétrico de empaque de planta industrial y **NUNCA deben modificarse** bajo ninguna directriz de rediseño de UI general.
