/**
 * Utilidades centralizadas para gestión de permisos y control de acceso por módulos individuales.
 * Cada opción del panel lateral cuenta con su propia clave de autorización individual.
 */

export const SIDEBAR_MODULES = [
    // 1. Principal
    { key: 'stock', name: 'Consultar Stock', category: 'Principal', path: '/stock' },

    // 2. Operaciones Inbound
    { key: 'inbound', name: 'Recepción', category: 'Operaciones Inbound', path: '/inbound' },
    { key: 'reconciliation', name: 'Conciliación', category: 'Operaciones Inbound', path: '/reconciliation' },
    { key: 'view_logs', name: 'Registros', category: 'Operaciones Inbound', path: '/view_logs' },

    // 3. Operaciones Outbound
    { key: 'picking', name: 'Picking', category: 'Operaciones Outbound', path: '/picking' },
    { key: 'view_picking_audits', name: 'Empaque', category: 'Operaciones Outbound', path: '/view_picking_audits' },
    { key: 'shipments', name: 'Despacho', category: 'Operaciones Outbound', path: '/shipments' },
    { key: 'label', name: 'Etiquetado', category: 'Operaciones Outbound', path: '/label' },

    // 4. Control Inventario
    { key: 'planner', name: 'Plan Cíclico', category: 'Control Inventario', path: '/planner' },
    { key: 'inventory_dashboard', name: 'Métricas', category: 'Control Inventario', path: '/inventory-dashboard' },
    { key: 'view_counts_recordings', name: 'Históricos', category: 'Control Inventario', path: '/view_counts/recordings' },
    { key: 'planner_differences', name: 'Diferencias', category: 'Control Inventario', path: '/planner/manage_differences' },
    { key: 'counts', name: 'Inventario W2W', category: 'Control Inventario', path: '/counts' },
    { key: 'counts_manage', name: 'Edición Conteos', category: 'Control Inventario', path: '/counts/manage' },
    { key: 'view_counts', name: 'Conteo General', category: 'Control Inventario', path: '/view_counts' },
    { key: 'express_audit', name: 'Ciclo Manual', category: 'Control Inventario', path: '/express-audit' },
    { key: 'spot_check', name: 'Spot Check', category: 'Control Inventario', path: '/spot-check' },

    // 5. Sistema
    { key: 'admin_inventory', name: 'Adm. Inventario', category: 'Sistema', path: '/admin/inventory' },
    { key: 'admin_slotting', name: 'Config. Slotting', category: 'Sistema', path: '/admin/slotting' },
    { key: 'occupancy', name: 'Ocupación Bodega', category: 'Sistema', path: '/occupancy' },
    { key: 'update', name: 'Carga de Datos', category: 'Sistema', path: '/update' },
    { key: 'admin_users', name: 'Gestión Usuarios', category: 'Sistema', path: '/admin/users', adminOnly: true },
];

export const MODULES = SIDEBAR_MODULES.map(m => m.key);

export const MODULE_NAMES = SIDEBAR_MODULES.reduce((acc, m) => {
    acc[m.key] = m.name;
    return acc;
}, {});

export const MODULE_CATEGORIES = [
    'Principal',
    'Operaciones Inbound',
    'Operaciones Outbound',
    'Control Inventario',
    'Sistema'
];

/**
 * Mapeo de compatibilidad hacia atrás para bloques heredados.
 * Si un usuario antiguo tiene 'inbound', 'picking', etc., mantiene acceso a sus submódulos.
 */
const LEGACY_BLOCKS = {
    stock: ['stock'],
    inbound: ['inbound', 'reconciliation', 'view_logs'],
    picking: ['picking', 'view_picking_audits', 'shipments', 'label'],
    inventory: ['inventory_dashboard', 'occupancy', 'spot_check', 'admin_inventory', 'admin_slotting'],
    planner: ['planner', 'planner_differences'],
    counts: ['counts', 'counts_manage', 'view_counts', 'express_audit', 'view_counts_recordings'],
    admin: ['update', 'admin_users', 'admin_inventory', 'admin_slotting']
};

/**
 * Mapeo estricto de rutas a permisos individuales requeridos.
 * null o undefined significa público / para cualquier usuario autenticado (ej. /dashboard).
 */
export const ROUTE_PERMISSIONS = {
    '/dashboard': null,
    '/stock': 'stock',
    '/inbound': 'inbound',
    '/reconciliation': 'reconciliation',
    '/view_logs': 'view_logs',
    '/picking': 'picking',
    '/view_picking_audits': 'view_picking_audits',
    '/shipments': 'shipments',
    '/shipments/print/:id': 'shipments',
    '/packing_list': 'view_picking_audits',
    '/packing_list/:id': 'view_picking_audits',
    '/packing_list/print/:id': 'view_picking_audits',
    '/label': 'label',
    '/planner': 'planner',
    '/planner/execution': 'planner',
    '/planner/manage_differences': 'planner_differences',
    '/inventory-dashboard': 'inventory_dashboard',
    '/view_counts/recordings': 'view_counts_recordings',
    '/counts': 'counts',
    '/counts/manage': 'counts_manage',
    '/counts/manage_differences': 'counts_manage',
    '/counts/edit/:id': 'counts_manage',
    '/view_counts': 'view_counts',
    '/express-audit': 'express_audit',
    '/spot-check': 'spot_check',
    '/admin/inventory': 'admin_inventory',
    '/admin/slotting': 'admin_slotting',
    '/occupancy': 'occupancy',
    '/update': 'update',
    '/admin/users': 'admin_users',
    '/admin/login': null,
};

/**
 * Extrae los permisos del usuario de forma uniforme (array de strings en minúsculas).
 */
export const getUserPermissions = (user) => {
    if (!user) return [];
    const raw = user.permissions;
    if (Array.isArray(raw)) {
        return raw.map(p => String(p).toLowerCase().trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map(p => String(p).toLowerCase().trim()).filter(Boolean);
                }
            } catch (e) {}
        }
        return trimmed.split(',').map(p => p.toLowerCase().trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    return [];
};

/**
 * Determina si el usuario es administrador global.
 */
export const isUserAdmin = (user) => {
    if (!user) return false;
    const role = String(user.role || '').toLowerCase().trim();
    const username = String(user.username || '').toLowerCase().trim();
    return username === 'admin' || role === 'admin' || role === 'administrador';
};

/**
 * Comprueba si un usuario tiene autorización para cargar o actualizar archivos maestros.
 * Se autoriza si es Administrador o si tiene asignado el módulo individual de Carga de Datos ('update').
 */
export const canUserUploadFiles = (user) => {
    if (!user) return false;
    if (isUserAdmin(user)) return true;
    return hasUserPermission(user, 'update');
};

/**
 * Comprueba si un usuario tiene permiso para un módulo específico o lista de permisos.
 */
export const hasUserPermission = (user, requiredPermission) => {
    if (!user) return false;
    if (isUserAdmin(user)) return true;
    if (!requiredPermission) return true; // ruta libre para cualquier autenticado

    const reqList = Array.isArray(requiredPermission)
        ? requiredPermission.map(p => String(p).toLowerCase().trim())
        : [String(requiredPermission).toLowerCase().trim()];

    const userPerms = getUserPermissions(user);

    // Expandir con bloques heredados si existen en el perfil del usuario
    const expandedUserPerms = new Set(userPerms);
    for (const p of userPerms) {
        if (LEGACY_BLOCKS[p]) {
            LEGACY_BLOCKS[p].forEach(sub => expandedUserPerms.add(sub));
        }
    }

    return reqList.some(req => expandedUserPerms.has(req));
};

/**
 * Comprueba si un usuario tiene permiso para una ruta específica.
 */
export const canUserAccessPath = (user, path) => {
    if (!user) return false;
    if (isUserAdmin(user)) return true;
    if (!path || path === '/' || path === '/dashboard' || path === '/admin/login') return true;

    const baseCleanPath = path.split('?')[0];

    // Buscar coincidencia exacta
    if (ROUTE_PERMISSIONS[baseCleanPath] !== undefined) {
        return hasUserPermission(user, ROUTE_PERMISSIONS[baseCleanPath]);
    }

    // Buscar en patrones con parámetros o subrutas
    for (const [routePattern, required] of Object.entries(ROUTE_PERMISSIONS)) {
        if (!required) continue;
        if (routePattern.includes(':')) {
            const patternParts = routePattern.split('/');
            const pathParts = baseCleanPath.split('/');
            if (patternParts.length === pathParts.length) {
                const match = patternParts.every((part, idx) => part.startsWith(':') || part === pathParts[idx]);
                if (match) {
                    return hasUserPermission(user, required);
                }
            }
        }
        if (routePattern !== '/' && routePattern !== '/admin' && baseCleanPath.startsWith(routePattern + '/')) {
            return hasUserPermission(user, required);
        }
    }

    return true;
};
