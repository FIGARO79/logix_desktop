import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

// Diccionario completo de traducciones (Español y Portugués de Brasil)
export const TRANSLATIONS = {
    es: {
        // Menú Lateral - Secciones
        'menu.main': 'Principal',
        'menu.inbound': 'Operaciones Inbound',
        'menu.outbound': 'Operaciones Outbound',
        'menu.inventory': 'Control Inventario',
        'menu.system': 'Sistema',
        'menu.language': 'Idioma de Aplicación',
        'menu.logout': 'Cerrar Sesión',

        // Menú Lateral - Ítems y descripciones
        'nav.home': 'Inicio',
        'nav.home_desc': 'Panel principal y accesos rápidos',
        'nav.stock': 'Consultar Stock',
        'nav.stock_desc': 'Búsqueda global de inventario y saldos',
        'nav.inbound': 'Recepción',
        'nav.inbound_desc': 'Entrada de mercancía y referencias',
        'nav.reconciliation': 'Conciliación',
        'nav.reconciliation_desc': 'Cruce de documentos y discrepancias',
        'nav.inbound_audit': 'Auditoría Agente',
        'nav.inbound_audit_desc': 'Control de calidad y recepción física',
        'nav.view_logs': 'Registros',
        'nav.view_logs_desc': 'Consulta de registros históricos',
        'nav.ir_dashboard': 'Dashboard IR',
        'nav.ir_dashboard_desc': 'Estado general de Import References',
        'nav.picking': 'Picking',
        'nav.picking_desc': 'Verificación de pedidos y empaque',
        'nav.packing': 'Empaque',
        'nav.packing_desc': 'Listas de empaque y auditorías',
        'nav.shipments': 'Despacho',
        'nav.shipments_desc': 'Gestión de despachos y embarques',
        'nav.label': 'Etiquetado',
        'nav.label_desc': 'Impresión de etiquetas operativas',
        'nav.planner': 'Plan Cíclico',
        'nav.planner_desc': 'Programación de conteos cíclicos',
        'nav.metrics': 'Métricas',
        'nav.metrics_desc': 'Indicadores de exactitud',
        'nav.recordings': 'Históricos',
        'nav.recordings_desc': 'Grabaciones y trazabilidad',
        'nav.differences': 'Diferencias',
        'nav.differences_desc': 'Gestión de ajustes y discrepancias',
        'nav.w2w': 'Inventario W2W',
        'nav.w2w_desc': 'Conteo masivo wall-to-wall',
        'nav.manage_counts': 'Edición Conteos',
        'nav.manage_counts_desc': 'Gestión de registros de conteo',
        'nav.general_count': 'Conteo General',
        'nav.general_count_desc': 'Consolidado de conteos',
        'nav.manual_cycle': 'Ciclo Manual',
        'nav.manual_cycle_desc': 'Conteo ciego y auditoría rápida',
        'nav.spot_check': 'Spot Check',
        'nav.spot_check_desc': 'Auditorías rápidas en piso',
        'nav.admin_inventory': 'Adm. Inventario',
        'nav.admin_inventory_desc': 'Control de ciclos de conteo',
        'nav.slotting_config': 'Config. Slotting',
        'nav.slotting_config_desc': 'Parámetros de ubicaciones',
        'nav.occupancy': 'Ocupación Bodega',
        'nav.occupancy_desc': 'Análisis de espacio y ubicaciones',
        'nav.update_data': 'Carga de Datos',
        'nav.update_data_desc': 'Actualización masiva vía ficheros',

        // Encabezado / Header
        'header.online': 'En línea',
        'header.offline': 'Sin conexión',
        'header.sync': 'Sincronizar',
        'header.pin_tooltip': 'Fijar en Dashboard',
        'header.drag_tooltip': 'Arrastra esta opción al Dashboard para fijarla',
        'header.close_tab': 'Cerrar pestaña',

        // Login
        'login.title': 'Iniciar Sesión',
        'login.username': 'Usuario',
        'login.password': 'Contraseña',
        'login.username_placeholder': 'Ingrese su usuario',
        'login.password_placeholder': 'Ingrese su contraseña',
        'login.remember': 'Recordar usuario y autocompletar clave',
        'login.enter': 'Entrar',
        'login.loading': 'Cargando...',
        'login.register': 'Registrarse',
        'login.error_credentials': 'Usuario o contraseña incorrectos',
        'login.error_local': 'Error al iniciar sesión localmente',

        // General / Botones
        'common.save': 'Guardar',
        'common.cancel': 'Cancelar',
        'common.search': 'Buscar',
        'common.export': 'Exportar',
        'common.print': 'Imprimir',
        'common.delete': 'Eliminar',
        'common.edit': 'Editar',
        'common.actions': 'Acciones',
        'common.loading': 'Cargando datos...',
        'common.no_data': 'No hay datos disponibles',

        // Stock
        'stock.title': 'Consulta de Stock',
        'stock.search_placeholder': 'Escanear o ingresar Código de Artículo...',
        'stock.search_btn': 'Buscar',
    },
    pt: {
        // Menú Lateral - Secciones
        'menu.main': 'Principal',
        'menu.inbound': 'Operações Inbound',
        'menu.outbound': 'Operações Outbound',
        'menu.inventory': 'Controle de Estoque',
        'menu.system': 'Sistema',
        'menu.language': 'Idioma da Aplicação',
        'menu.logout': 'Encerrar Sessão',

        // Menú Lateral - Ítems y descripciones
        'nav.home': 'Início',
        'nav.home_desc': 'Painel principal e atalhos rápidos',
        'nav.stock': 'Consultar Estoque',
        'nav.stock_desc': 'Pesquisa global de estoque e saldos',
        'nav.inbound': 'Recebimento',
        'nav.inbound_desc': 'Entrada de mercadorias e referências',
        'nav.reconciliation': 'Reconciliação',
        'nav.reconciliation_desc': 'Cruzamento de documentos e divergências',
        'nav.inbound_audit': 'Auditoria Agente',
        'nav.inbound_audit_desc': 'Controle de qualidade e conferência física',
        'nav.view_logs': 'Registros',
        'nav.view_logs_desc': 'Consulta de registros históricos',
        'nav.ir_dashboard': 'Painel IR',
        'nav.ir_dashboard_desc': 'Status geral de Import References',
        'nav.picking': 'Picking',
        'nav.picking_desc': 'Separação de pedidos e conferência',
        'nav.packing': 'Embalagem',
        'nav.packing_desc': 'Listas de embalagem e auditorias',
        'nav.shipments': 'Expedição',
        'nav.shipments_desc': 'Gestão de despachos e embarques',
        'nav.label': 'Etiquetagem',
        'nav.label_desc': 'Impressão de etiquetas operacionais',
        'nav.planner': 'Plano Cíclico',
        'nav.planner_desc': 'Programação de contagens cíclicas',
        'nav.metrics': 'Métricas',
        'nav.metrics_desc': 'Indicadores de acuracidade',
        'nav.recordings': 'Históricos',
        'nav.recordings_desc': 'Gravações e rastreabilidade',
        'nav.differences': 'Divergências',
        'nav.differences_desc': 'Gestão de ajustes e discrepâncias',
        'nav.w2w': 'Inventário W2W',
        'nav.w2w_desc': 'Contagem massiva wall-to-wall',
        'nav.manage_counts': 'Edição de Contagens',
        'nav.manage_counts_desc': 'Gestão de registros de contagem',
        'nav.general_count': 'Contagem Geral',
        'nav.general_count_desc': 'Consolidado de contagens',
        'nav.manual_cycle': 'Ciclo Manual',
        'nav.manual_cycle_desc': 'Contagem cega e auditoria rápida',
        'nav.spot_check': 'Spot Check',
        'nav.spot_check_desc': 'Auditorias rápidas em piso',
        'nav.admin_inventory': 'Adm. Inventário',
        'nav.admin_inventory_desc': 'Controle de ciclos de contagem',
        'nav.slotting_config': 'Config. Slotting',
        'nav.slotting_config_desc': 'Parâmetros de endereçamento',
        'nav.occupancy': 'Ocupação de Depósito',
        'nav.occupancy_desc': 'Análise de espaço e posições',
        'nav.update_data': 'Carga de Dados',
        'nav.update_data_desc': 'Atualização massiva via arquivos',

        // Encabezado / Header
        'header.online': 'Online',
        'header.offline': 'Sem conexão',
        'header.sync': 'Sincronizar',
        'header.pin_tooltip': 'Fixar no Painel',
        'header.drag_tooltip': 'Arraste esta opção para o Painel para fixá-la',
        'header.close_tab': 'Fechar aba',

        // Login
        'login.title': 'Iniciar Sessão',
        'login.username': 'Usuário',
        'login.password': 'Senha',
        'login.username_placeholder': 'Digite seu usuário',
        'login.password_placeholder': 'Digite sua senha',
        'login.remember': 'Lembrar usuário e preencher senha',
        'login.enter': 'Entrar',
        'login.loading': 'Carregando...',
        'login.register': 'Cadastrar-se',
        'login.error_credentials': 'Usuário ou senha incorretos',
        'login.error_local': 'Erro ao iniciar sessão localmente',

        // General / Botones
        'common.save': 'Salvar',
        'common.cancel': 'Cancelar',
        'common.search': 'Pesquisar',
        'common.export': 'Exportar',
        'common.print': 'Imprimir',
        'common.delete': 'Excluir',
        'common.edit': 'Editar',
        'common.actions': 'Ações',
        'common.loading': 'Carregando dados...',
        'common.no_data': 'Não há dados disponíveis',

        // Stock
        'stock.title': 'Consulta de Estoque',
        'stock.search_placeholder': 'Escanear ou digitar Código do Item...',
        'stock.search_btn': 'Pesquisar',
    }
};

// Mapa de frases directas en español -> portugués para traducción instantánea de texto en páginas
export const PHRASE_MAP_PT = {
    // Categorías y títulos
    'Gestión de Recepción': 'Gestão de Recebimento',
    'Operaciones de Despacho': 'Operações de Expedição',
    'Control de Inventario': 'Controle de Estoque',
    'Administración del Sistema': 'Administração do Sistema',
    'Panel Principal': 'Painel Principal',
    'Dashboard': 'Painel Principal',
    'Inicio': 'Início',
    'Ocupación de Bodega': 'Ocupação de Depósito',
    'Consulta de Stock': 'Consulta de Estoque',
    'Consultar Stock': 'Consultar Estoque',
    'Recepción': 'Recebimento',
    'Conciliación': 'Reconciliação',
    'Auditoría Agente': 'Auditoria Agente',
    'Registros': 'Registros',
    'Dashboard IR': 'Painel IR',
    'Picking': 'Separação',
    'Empaque': 'Embalagem',
    'Despacho': 'Expedição',
    'Etiquetado': 'Etiquetagem',
    'Plan Cíclico': 'Plano Cíclico',
    'Métricas': 'Métricas',
    'Históricos': 'Históricos',
    'Diferencias': 'Divergências',
    'Inventario W2W': 'Inventário W2W',
    'Edición Conteos': 'Edição de Contagens',
    'Conteo General': 'Contagem Geral',
    'Ciclo Manual': 'Ciclo Manual',
    'Spot Check': 'Spot Check',
    'Adm. Inventario': 'Adm. Inventário',
    'Config. Slotting': 'Config. Slotting',
    'Carga de Datos': 'Carga de Datos',
    'Cerrar Sesión': 'Encerrar Sessão',
    'Idioma': 'Idioma',
    'Idioma de Aplicación': 'Idioma da Aplicação',

    // Tiles en Mayúsculas (Dashboard)
    'REGISTRO INBOUND': 'REGISTRO INBOUND',
    'CONCILIACIÓN': 'RECONCILIAÇÃO',
    'HISTORIAL': 'HISTÓRICO',
    'CONSULTAR STOCK': 'CONSULTAR ESTOQUE',
    'AUDITORÍA PICKING': 'AUDITORIA PICKING',
    'REPORTES EMPAQUE': 'RELATÓRIOS EMBALAGEM',
    'CONSOLIDACIÓN': 'CONSOLIDAÇÃO',
    'ETIQUETADO': 'ETIQUETAGEM',
    'PLANIFICACIÓN': 'PLANEJAMENTO',
    'MÉTRICAS ERI': 'MÉTRICAS ERI',
    'DIFERENCIAS CICLICOS': 'DIVERGÊNCIAS CÍCLICOS',
    'DIFERENCIAS CÍCLICOS': 'DIVERGÊNCIAS CÍCLICOS',
    'INVENTARIO W2W': 'INVENTÁRIO W2W',
    'CICLO MANUAL': 'CICLO MANUAL',
    'ADMINISTRACIÓN INVENTARIO': 'ADMINISTRAÇÃO ESTOQUE',
    'REGLAS SLOTTING': 'REGRAS SLOTTING',
    'OCUPACIÓN BODEGA': 'OCUPAÇÃO DEPÓSITO',
    'CARGA DE DATOS': 'CARGA DE DADOS',

    // Descripciones de Dashboard
    'Entrada de mercancía y referencias': 'Entrada de mercadorias e referências',
    'Cruce de documentos y discrepancias': 'Cruzamento de documentos e divergências',
    'Consulta de registros históricos': 'Consulta de registros históricos',
    'Búsqueda global de inventario y saldos': 'Pesquisa global de estoque e saldos',
    'Verificación de pedidos y empaque': 'Conferência de pedidos e embalagem',
    'Listas de empaque y auditorías': 'Listas de embalagem e auditorias',
    'Gestión de despachos y embarques': 'Gestão de despachos e embarques',
    'Impresión de etiquetas operativas': 'Impressão de etiquetas operacionais',
    'Programación de conteos cíclicos': 'Programação de contagens cíclicas',
    'Indicadores de exactitud': 'Indicadores de acuracidade',
    'Gestión de ajustes y discrepancias': 'Gestão de ajustes e discrepâncias',
    'Conteo masivo wall-to-wall': 'Contagem massiva wall-to-wall',
    'Conteo ciego y auditoría rápida': 'Contagem cega e auditoria rápida',
    'Control de ciclos de conteo': 'Controle de ciclos de contagem',
    'Parámetros de ubicaciones': 'Parâmetros de endereçamento',
    'Análisis de espacio y ubicaciones': 'Análise de espaço e posições',
    'Actualización masiva vía ficheros': 'Atualização massiva via arquivos',
    'Arrastra opciones aquí para fijarlas': 'Arraste opções aqui para fixá-las',

    // Métricas y Ocupación
    'Total Bins': 'Total de Posições',
    'Filled Capacity': 'Capacidade Ocupada',
    'Available': 'Disponíveis',
    'Utilization %': '% de Ocupação',
    'Active SKUs': 'SKUs Ativos',
    'Density (SKU/Bin)': 'Densidade (SKU/Posição)',
    'Actualizar Datos': 'Atualizar Datos',
    'Matriz de Saturación de Bins (Nivel vs Zona)': 'Matriz de Ocupação de Posições (Nível vs Zona)',
    'Identificador de Zona': 'Identificador de Zona',
    'Densidad de SKUs por Zona': 'Densidade de SKUs por Zona',
    'Densidad Crítica (Pasillos Principales)': 'Densidade Crítica (Corredores Principais)',
    'Detalle de Ubicaciones': 'Detalhes das Posições',
    'Pasillo': 'Corredor',
    'Nivel': 'Nível',
    'Zona': 'Zona',

    // Acciones y formularios comunes
    'Buscar': 'Pesquisar',
    'Guardar': 'Salvar',
    'Cancelar': 'Cancelar',
    'Eliminar': 'Excluir',
    'Editar': 'Editar',
    'Limpiar': 'Limpar',
    'Exportar': 'Exportar',
    'Exportar a Excel': 'Exportar para Excel',
    'Imprimir': 'Imprimir',
    'Cargando...': 'Carregando...',
    'Cargando datos...': 'Carregando dados...',
    'Usuario': 'Usuário',
    'Contraseña': 'Senha',
    'Entrar': 'Entrar',
    'Registrarse': 'Cadastrar-se',
    'Código': 'Código',
    'Descripción': 'Descrição',
    'Cantidad': 'Quantidade',
    'Ubicación': 'Posição',
    'Fecha': 'Data',
    'Estado': 'Status',
    'Código de Artículo': 'Código do Item',
    'Ubicación Primaria': 'Posição Principal',
    'Ubicaciones Adicionales': 'Posições Adicionais',
    'Cantidad Disponible': 'Quantidade Disponível',
    'Costo Unitario': 'Custo Unitário',
    'Peso Unitario': 'Peso Unitário',
    'Dimensiones': 'Dimensões',
    'Volumen': 'Volume',
    'Código SIC': 'Código SIC (Giro)',
    'Clasificación ABC': 'Classificação ABC',
    'Escanear Código': 'Escanear Código',
    'Copiar Código': 'Copiar Código',

    // Inbound y GRN
    'Referencia de Importación': 'Referência de Importação',
    'Referencia de Importación (IR)': 'Referência de Importação (IR)',
    'Guía Aérea (Waybill)': 'Conhecimento Aéreo (Waybill)',
    'Guía Aérea / Waybill (WB)': 'Conhecimento Aéreo / Waybill (WB)',
    'Guía Aérea': 'Conhecimento Aéreo',
    'Número GRN': 'Número GRN',
    'Cantidad Recibida': 'Quantidade Recebida',
    'Cantidad Esperada': 'Quantidade Esperada',
    'Cantidad GRN': 'Quantidade GRN',
    'Cantidad Física': 'Quantidade Física',
    'Ubicación Sugerida': 'Posição Sugerida',
    'Ubicación Sugerida (Slotting)': 'Posição Sugerida (Slotting)',
    'Ubicación Física': 'Posição Física',
    'Ubicación Real': 'Posição Real',
    'Ubicación Física Real': 'Posição Física Real',
    'Ubicación Reubicada': 'Posição Reubicada',
    'Discrepancia': 'Divergência',
    'Discrepancias': 'Divergências',
    'Sin Discrepancia': 'Sem Divergência',
    'Líneas Completadas': 'Linhas Concluídas',
    'Líneas Iniciadas': 'Linhas Iniciadas',
    'Líneas Totales': 'Linhas Totais',
    'Unidades Esperadas': 'Unidades Esperadas',
    'Unidades Recibidas': 'Unidades Recebidas',
    'GRNs Totales': 'GRNs Totais',
    'GRNs Completados': 'GRNs Concluídos',
    'Progreso GRN': 'Progresso GRN',
    'Recepciones Recientes': 'Recebimentos Recentes',
    'Historial de Recepciones': 'Histórico de Recebimentos',
    'Estado de Conciliación': 'Status da Reconciliação',
    'Descargar Plantilla': 'Baixar Modelo',
    'Descargar Plantilla Excel': 'Baixar Modelo Excel',
    'Subir Archivo': 'Enviar Arquivo',
    'Subir Archivo CSV': 'Enviar Arquivo CSV',
    'Guardar Recepción': 'Salvar Recebimento',
    'Guardar Registro': 'Salvar Registro',
    'Registrar Entrada': 'Registrar Entrada',
    'Buscar Referencia': 'Pesquisar Referência',
    'Escaneo de Código de Barras': 'Leitura de Código de Barras',
    'Escanear GS1': 'Escanear GS1',
    'Cámara / Escáner': 'Câmera / Leitor',

    // Picking, Despacho y Empaque
    'Auditoría de Picking': 'Auditoria de Picking',
    'Número de Orden': 'Número do Pedido',
    'Número de Pedido': 'Número do Pedido',
    'Número de Orden / Pedido': 'Número do Pedido',
    'Nota de Entrega': 'Nota de Entrega',
    'Nota de Entrega / Despacho': 'Nota de Entrega / Despacho',
    'Cliente': 'Cliente',
    'Línea': 'Linha',
    'Líneas': 'Linhas',
    'Cantidad Solicitada': 'Quantidade Solicitada',
    'Cantidad Picada': 'Quantidade Separada',
    'Cantidad Auditada': 'Quantidade Auditada',
    'Verificar Ítem': 'Verificar Item',
    'Verificar Artículo': 'Verificar Item',
    'Finalizar Auditoría': 'Finalizar Auditoria',
    'Lista de Empaque': 'Lista de Embalagem',
    'Listas de Empaque': 'Listas de Embalagem',
    'Generar Packing List': 'Gerar Packing List',
    'Consolidar Despacho': 'Consolidar Despacho',
    'Imprimir Etiquetas': 'Imprimir Etiquetas',
    'Imprimir Etiqueta': 'Imprimir Etiqueta',
    'Tipo de Etiqueta': 'Tipo de Etiqueta',
    'Etiqueta Sandvik': 'Etiqueta Sandvik',
    'Etiqueta Genérica': 'Etiqueta Genérica',
    'Bultos': 'Volumes',
    'Número de Bulto': 'Número do Volume',
    'Peso Total (kg)': 'Peso Total (kg)',
    'Largo': 'Comprimento',
    'Ancho': 'Largura',
    'Alto': 'Altura',

    // Conteos y Ciclos
    'Conteo Cíclico': 'Contagem Cíclica',
    'Conteo Ciego': 'Contagem Cega',
    'Programación de Conteos': 'Programação de Contagens',
    'Diferencias de Conteo': 'Divergências de Contagem',
    'Ajuste de Inventario': 'Ajuste de Estoque',
    'Causa Raíz': 'Causa Raiz',
    'Justificación': 'Justificativa',
    'Aprobar Ítem': 'Aprovar Item',
    'Recontar': 'Recontar',
    'Finalizar Conteo': 'Finalizar Contagem',
    'Conteo por Ubicación': 'Contagem por Posição',
    'Conteo por Artículo': 'Contagem por Item',
    'Grabaciones y Trazabilidad': 'Gravações e Rastreabilidade',
    'Exactitud de Registro (ERI)': 'Acuracidade de Registro (ERI)',

    // Estados
    'En línea': 'Online',
    'Sin conexión': 'Sem conexão',
    'Online': 'Online',
    'Offline': 'Offline',
    'Pendiente': 'Pendente',
    'Pendientes': 'Pendentes',
    'Completado': 'Concluído',
    'Completada': 'Concluída',
    'Completados': 'Concluídos',
    'Completadas': 'Concluídas',
    'En Proceso': 'Em Processamento',
    'En proceso': 'Em processamento',
    'Aprobado': 'Aprovado',
    'Aprobada': 'Aprovada',
    'Rechazado': 'Rejeitado',
    'Rechazada': 'Rejeitada',
    'Conciliado': 'Reconciliado',
    'Conciliada': 'Reconciliada',
    'Diferencia Positiva': 'Divergência Positiva',
    'Diferencia Negativa': 'Divergência Negativa',
    'Sin Diferencia': 'Sem Divergência',
    'Correcto': 'Correto',
    'Correcta': 'Correta',
    'Alerta': 'Alerta',
    'Alertas': 'Alertas',
    'Error': 'Erro',
    'Errores': 'Erros',
    'Éxito': 'Sucesso',
    'Advertencia': 'Aviso',
    'No hay datos disponibles': 'Não há dados disponíveis',

    // Adicionales UI y Header
    'Tablero de Control IR': 'Painel de Controle IR',
    'Auditoría de Inbound': 'Auditoria de Inbound',
    'Ejecutar Auditoría': 'Executar Auditoria',
    'Ejecutando...': 'Executando...',
    'Refrescar datos': 'Atualizar dados',
    'Cargar datos': 'Carregar dados',
    'Configuración de Impresora': 'Configuração de Impressora',
    'Español (ES)': 'Espanhol (ES)',
    'Português (BR)': 'Português (BR)',
    'Español': 'Espanhol',
    'Português': 'Português',

    // Slotting y Ubicaciones
    'Nivel de Recolección (N2)': 'Nível de Coleta (N2)',
    'Nivel de Recolección': 'Nível de Coleta',
    'Picking manual intensivo': 'Separação manual intensiva',
    'Separação (Separação)': 'Separação',
    'Picking (Separação)': 'Separação'
};

// Mapa inverso automático portugués -> español para traducción bidireccional completa
export const PHRASE_MAP_ES = Object.entries(PHRASE_MAP_PT).reduce((acc, [esKey, ptVal]) => {
    if (!acc[ptVal]) {
        acc[ptVal] = esKey;
    }
    return acc;
}, {});

const LanguageContext = createContext({
    language: 'es',
    setLanguage: () => {},
    t: (key, fallback) => fallback || key,
    isPortuguese: false,
    isSpanish: true,
});

export const LanguageProvider = ({ children }) => {
    const [language, setLanguageState] = useState(() => {
        const saved = localStorage.getItem('logix_language');
        if (saved === 'pt' || saved === 'es') return saved;
        if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('pt')) {
            return 'pt';
        }
        return 'es';
    });

    const setLanguage = useCallback((lang) => {
        const target = lang === 'pt' ? 'pt' : 'es';
        setLanguageState(target);
        try {
            localStorage.setItem('logix_language', target);
        } catch (e) {
            console.warn("Error saving language preference to localStorage", e);
        }
    }, []);

    const t = useCallback((keyOrPhrase, fallback) => {
        if (!keyOrPhrase) return fallback !== undefined ? fallback : '';

        const currentDict = TRANSLATIONS[language] || TRANSLATIONS.es;

        // 1. Búsqueda directa por clave en el diccionario
        if (currentDict && currentDict[keyOrPhrase] !== undefined) {
            return currentDict[keyOrPhrase];
        }

        // 2. Si el idioma es portugués, buscar en el mapa directo de frases
        if (language === 'pt') {
            if (PHRASE_MAP_PT[keyOrPhrase] !== undefined) {
                return PHRASE_MAP_PT[keyOrPhrase];
            }
            const trimmed = String(keyOrPhrase).trim();
            for (const [esPhrase, ptPhrase] of Object.entries(PHRASE_MAP_PT)) {
                if (esPhrase.toLowerCase() === trimmed.toLowerCase()) {
                    return ptPhrase;
                }
            }
        }

        // 3. Fallback al diccionario en español si existe la clave
        const fallbackDict = TRANSLATIONS.es;
        if (fallbackDict && fallbackDict[keyOrPhrase] !== undefined) {
            return fallbackDict[keyOrPhrase];
        }

        return fallback !== undefined ? fallback : keyOrPhrase;
    }, [language]);

const preserveCase = (original, replacement) => {
    if (!original || !replacement) return replacement;
    if (original === original.toUpperCase()) {
        return replacement.toUpperCase();
    }
    if (original === original.toLowerCase()) {
        return replacement.toLowerCase();
    }
    if (original[0] === original[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
};

// Motor de traducción reactiva bidireccional del DOM para todas las páginas internas
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const activeMap = language === 'pt' ? PHRASE_MAP_PT : PHRASE_MAP_ES;
        const mapEntries = Object.entries(activeMap).sort((a, b) => b[0].length - a[0].length);

        const translateNode = (node) => {
            if (!node || node.nodeType !== Node.TEXT_NODE) return;
            const parent = node.parentElement;
            if (!parent) return;
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE' || tag === 'NOSCRIPT') return;

            const val = node.nodeValue;
            if (!val || !val.trim()) return;

            const source = val;
            const trimmed = source.trim();

            // 1. Coincidencia exacta
            if (activeMap[trimmed]) {
                const translated = activeMap[trimmed];
                const leading = source.match(/^\s*/)[0];
                const trailing = source.match(/\s*$/)[0];
                const finalVal = leading + preserveCase(trimmed, translated) + trailing;
                if (node.nodeValue !== finalVal) {
                    node.nodeValue = finalVal;
                }
                return;
            }

            // 2. Coincidencia insensible a mayúsculas/minúsculas
            const lower = trimmed.toLowerCase();
            for (const [key, targetVal] of mapEntries) {
                if (key.toLowerCase() === lower) {
                    const leading = source.match(/^\s*/)[0];
                    const trailing = source.match(/\s*$/)[0];
                    const finalVal = leading + preserveCase(trimmed, targetVal) + trailing;
                    if (node.nodeValue !== finalVal) {
                        node.nodeValue = finalVal;
                    }
                    return;
                }
            }

            // 3. Reemplazo de frases contenidas en párrafos u oraciones compuestas (preservando estilo de caja)
            let current = source;
            let replaced = false;
            for (const [key, targetVal] of mapEntries) {
                if (key.length >= 3 && current.toLowerCase().includes(key.toLowerCase())) {
                    if (current.toLowerCase().includes(targetVal.toLowerCase()) && key.toLowerCase() !== targetVal.toLowerCase()) {
                        continue;
                    }
                    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(escapedKey, 'gi');
                    const next = current.replace(regex, (match) => preserveCase(match, targetVal));
                    if (next !== current) {
                        current = next;
                        replaced = true;
                    }
                }
            }
            if (replaced && node.nodeValue !== current) {
                node.nodeValue = current;
            }
        };

        const translateAttributes = (el) => {
            if (!el || !el.getAttribute) return;
            if (el.placeholder) {
                const pTrim = el.placeholder.trim();
                if (activeMap[pTrim]) {
                    el.placeholder = activeMap[pTrim];
                } else {
                    for (const [key, targetVal] of mapEntries) {
                        if (key.length >= 3 && el.placeholder.toLowerCase().includes(key.toLowerCase())) {
                            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(escapedKey, 'gi');
                            el.placeholder = el.placeholder.replace(regex, targetVal);
                        }
                    }
                }
            }
            if (el.title) {
                const tTrim = el.title.trim();
                if (activeMap[tTrim]) {
                    el.title = activeMap[tTrim];
                }
            }
        };

        const scanAndTranslate = (rootNode = document.body) => {
            if (!rootNode) return;
            const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walker.nextNode())) {
                translateNode(node);
            }
            const elements = rootNode.querySelectorAll ? rootNode.querySelectorAll('input, textarea, button, a, [title]') : [];
            elements.forEach(translateAttributes);
        };

        // Escaneo inmediato al cambiar de idioma o montar
        scanAndTranslate();

        // Observer para capturar cambios dinámicos de DOM (pestañas, modales, tablas)
        let rafId = null;
        const observer = new MutationObserver((mutations) => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const addedNode of mutation.addedNodes) {
                            if (addedNode.nodeType === Node.TEXT_NODE) {
                                translateNode(addedNode);
                            } else if (addedNode.nodeType === Node.ELEMENT_NODE) {
                                scanAndTranslate(addedNode);
                            }
                        }
                    } else if (mutation.type === 'characterData') {
                        translateNode(mutation.target);
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        return () => {
            observer.disconnect();
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [language]);

    const contextValue = useMemo(() => ({
        language,
        setLanguage,
        t,
        isPortuguese: language === 'pt',
        isSpanish: language === 'es',
    }), [language, setLanguage, t]);

    return (
        <LanguageContext.Provider value={contextValue}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        return {
            language: 'es',
            setLanguage: () => {},
            t: (key, fallback) => fallback || key,
            isPortuguese: false,
            isSpanish: true,
        };
    }
    return context;
};

export default LanguageContext;
