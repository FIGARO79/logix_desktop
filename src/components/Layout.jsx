import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { useOffline } from '../hooks/useOffline';
import { checkAndSyncIfNeeded } from '../utils/syncManager';
import '../styles/Layout.css';
import { TabProvider } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';

// Importación de componentes para Keep-Alive
import Dashboard from '../pages/Dashboard';
import Reconciliation from '../pages/Reconciliation';
import StockSearch from '../pages/StockSearch';
import PickingAuditHistory from '../pages/PickingAuditHistory';
import Inbound from '../pages/Inbound';
import CycleCounts from '../pages/CycleCounts';
import ExpressAudit from '../pages/ExpressAudit';
import SpotCheck from '../pages/SpotCheck';
import LabelPrinting from '../pages/LabelPrinting';
import Planner from '../pages/Planner';
import PlannerExecution from '../pages/PlannerExecution';
import PickingAudit from '../pages/PickingAudit';
import AdminLogin from '../pages/AdminLogin';
import AdminInventory from '../pages/AdminInventory';
import AdminUsers from '../pages/AdminUsers';
import SlottingConfig from '../pages/SlottingConfig';
import ManageCounts from '../pages/ManageCounts';
import ViewCounts from '../pages/ViewCounts';
import EditCount from '../pages/EditCount';
import InboundHistory from '../pages/InboundHistory';
import Update from '../pages/Update';
import CycleCountHistory from '../pages/CycleCountHistory';
import DashboardInventario from './../pages/DashboardInventario';
import OccupancyDashboard from '../pages/OccupancyDashboard';
import ManageCountDifferences from '../pages/ManageCountDifferences';
import ManageCycleCountDifferences from '../pages/ManageCycleCountDifferences';
import Shipments from '../pages/Shipments';
import PackingListPrint from '../pages/PackingListPrint';
import InboundAudit from '../pages/InboundAudit';
import IRReconciliation from '../pages/IRReconciliation';

// Mapeo de rutas a componentes
const ROUTE_MAP = [
    { path: '/dashboard', component: Dashboard },
    { path: '/inbound', component: Inbound },
    { path: '/reconciliation', component: Reconciliation },
    { path: '/ir-reconciliation', component: IRReconciliation },
    { path: '/stock', component: StockSearch },
    { path: '/spot-check', component: SpotCheck },
    { path: '/view_picking_audits', component: PickingAuditHistory },
    { path: '/label', component: LabelPrinting },
    { path: '/planner', component: Planner },
    { path: '/planner/execution', component: PlannerExecution },
    { path: '/planner/manage_differences', component: ManageCycleCountDifferences },
    { path: '/picking', component: PickingAudit },
    { path: '/view_logs', component: InboundHistory },
    { path: '/counts', component: CycleCounts },
    { path: '/express-audit', component: ExpressAudit },
    { path: '/counts/manage', component: ManageCounts },
    { path: '/view_counts', component: ViewCounts },
    { path: '/counts/manage_differences', component: ManageCountDifferences },
    { path: '/view_counts/recordings', component: CycleCountHistory },
    { path: '/inventory-dashboard', component: DashboardInventario },
    { path: '/occupancy', component: OccupancyDashboard },
    { path: '/admin/inventory', component: AdminInventory },
    { path: '/admin/slotting', component: SlottingConfig },
    { path: '/shipments', component: Shipments },
    { path: '/update', component: Update },
    { path: '/admin/users', component: AdminUsers },
    { path: '/admin/login', component: AdminLogin },
    { path: '/counts/edit/:id', component: EditCount },
    { path: '/packing_list/print/:id', component: PackingListPrint },
    { path: '/inbound/audit', component: InboundAudit },
];

const MenuItem = ({ to, label, desc, categoryId, onClick }) => {
    const location = useLocation();
    const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

    const itemData = {
        href: to,
        text: label.toUpperCase(),
        desc: desc || `Módulo de ${label}`,
        categoryId: categoryId || 'recepcion'
    };

    const handleDragStart = (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(itemData));
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleQuickPin = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('logix_dashboard_pin_item', { detail: itemData }));
    };

    return (
        <div className="group/item flex items-center justify-between pr-2 hover:bg-white/5 transition-all">
            <Link
                to={to}
                draggable
                onDragStart={handleDragStart}
                className={`flex-grow flex items-center px-4 py-1 text-white leading-tight transition-all border-l-[4px] cursor-grab active:cursor-grabbing
                ${isActive ? 'bg-white/10 border-blue-400 font-medium text-gray-900' : 'border-transparent hover:border-blue-400/40'}`}
                onClick={onClick}
                title="Arrastra esta opción al Dashboard para fijarla"
            >
                <span className="text-[12px] uppercase select-none">{label}</span>
            </Link>

            <button
                onClick={handleQuickPin}
                className="opacity-0 group-hover/item:opacity-100 p-1 text-slate-400 hover:text-amber-400 hover:bg-white/10 rounded transition-all"
                title="Fijar en Dashboard"
                aria-label="Fijar en Dashboard"
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
            </button>
        </div>
    );
};

const MAX_TABS = 10;

const resolveComponent = (path) => {
    for (const route of ROUTE_MAP) {
        const match = matchPath(route.path, path);
        if (match) {
            return { Component: route.component, params: match.params };
        }
    }
    return null;
};

const TabContentWrapper = React.memo(({ tab, isActive, onTitleChange }) => {
    const [initialized, setInitialized] = useState(isActive);
    const lastRefreshKey = useRef(tab.refreshKey || 0);
    const resolved = useMemo(() => resolveComponent(tab.path), [tab.path]);

    // Activar inicialización si la pestaña se vuelve activa y no lo estaba
    useEffect(() => {
        if (isActive && !initialized) {
            setInitialized(true);
        }
    }, [isActive, initialized]);

    // Manejar el refresco forzado solo si el refreshKey aumenta (evita disparos en el mount si ya era > 0)
    useEffect(() => {
        if (tab.refreshKey > lastRefreshKey.current) {
            setInitialized(false);
            // El useEffect de arriba se encargará de volver a ponerlo en true si isActive es true
            lastRefreshKey.current = tab.refreshKey;
        }
    }, [tab.refreshKey]);

    const tabSetTitle = useCallback((newTitle) => {
        onTitleChange(tab.id, newTitle);
    }, [tab.id, onTitleChange]);

    const contextValue = useMemo(() => ({ setTitle: tabSetTitle }), [tabSetTitle]);

    // Retorno anticipado DESPUÉS de que todos los hooks han sido declarados
    if (!resolved) {
        return <div className="p-4 text-white">Módulo no encontrado: {tab.path}</div>;
    }

    const { Component } = resolved;

    return (
        <div
            className={`tab-content-container ${isActive ? 'block' : 'hidden'}`}
            style={{ height: '100%', width: '100%' }}
        >
            <TabProvider value={contextValue}>
                {/* Solo renderizar el componente si ha sido inicializado (Lazy Load) */}
                {initialized ? (
                    <Component setTitle={tabSetTitle} {...resolved.params} />
                ) : (
                    <div className="flex items-center justify-center h-full text-segoe-ui text-normal uppercase tracking-tight bg-[#fafafa]">
                        <span>Cargando módulo...</span>
                    </div>
                )}
            </TabProvider>
        </div>
    );
});

const Layout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [title, setTitle] = useState('Inicio');
    const { isOnline, pendingCount, syncPendingData, refreshPendingCount } = useOffline();
    const { language, setLanguage, t } = useLanguage();
    const [showPendingModal, setShowPendingModal] = useState(false);
    const [pendingList, setPendingList] = useState([]);

    const loadPendingRecords = async () => {
        try {
            const db = await getDB();
            const records = await db.getAll('pending_sync') || [];
            setPendingList(records);
        } catch (e) {
            console.error("Error al cargar lista de pendientes", e);
        }
    };

    useEffect(() => {
        if (showPendingModal) {
            loadPendingRecords();
        }
    }, [showPendingModal]);

    const handleManualSync = async () => {
        // Desktop app: always available, no need to check navigator.onLine
        toast.info("Sincronizando datos...");
        await syncPendingData();
        await refreshPendingCount();
        await loadPendingRecords();
    };

    const handleClearPendingRecord = async (id) => {
        if (!confirm("¿Desea eliminar este registro pendiente de la cola local?")) return;
        try {
            const db = await getDB();
            await db.delete('pending_sync', id);
            toast.success("Registro eliminado de la cola local");
            await refreshPendingCount();
            await loadPendingRecords();
        } catch (e) {
            toast.error("Error al eliminar registro local");
        }
    };

    const handleClearAllPending = async () => {
        if (!confirm("¿Desea vaciar todos los registros guardados localmente en la cola?")) return;
        try {
            const db = await getDB();
            await db.clear('pending_sync');
            toast.success("Cola de registros locales vaciada");
            await refreshPendingCount();
            await loadPendingRecords();
            setShowPendingModal(false);
        } catch (e) {
            toast.error("Error al vaciar la cola local");
        }
    };

    const [tabs, setTabs] = useState(() => {
        const saved = localStorage.getItem('logix_tabs');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            } catch (e) {
                console.error("Error parsing tabs from localStorage", e);
            }
        }
        return [{ id: 'dashboard-' + Date.now(), path: '/dashboard', label: 'Inicio' }];
    });

    const [draggedTabIndex, setDraggedTabIndex] = useState(null);
    const [dragOverTabIndex, setDragOverTabIndex] = useState(null);

    const [activeTabId, setActiveTabId] = useState(() => {
        const savedActive = localStorage.getItem('logix_active_tab');
        if (savedActive && Array.isArray(tabs) && tabs.some(t => t.id === savedActive)) {
            return savedActive;
        }
        return Array.isArray(tabs) && tabs.length > 0 ? tabs[0].id : null;
    });

    // Auto-recuperación garantizada de pestañas en caso de array vacío o nulo
    useEffect(() => {
        if (!Array.isArray(tabs) || tabs.length === 0) {
            const defaultTab = { id: 'dashboard-' + Date.now(), path: '/dashboard', label: 'Inicio' };
            setTabs([defaultTab]);
            setActiveTabId(defaultTab.id);
        } else if (!activeTabId || !tabs.some(t => t.id === activeTabId)) {
            setActiveTabId(tabs[0].id);
        }
    }, [tabs, activeTabId]);

    useEffect(() => {
        if (Array.isArray(tabs) && tabs.length > 0) {
            localStorage.setItem('logix_tabs', JSON.stringify(tabs));
        }
    }, [tabs]);

    useEffect(() => {
        if (activeTabId) {
            localStorage.setItem('logix_active_tab', activeTabId);
        }
    }, [activeTabId]);

    const activeTabIdRef = useRef(activeTabId);
    useEffect(() => {
        activeTabIdRef.current = activeTabId;
    }, [activeTabId]);

    const updateTabLabel = useCallback((tabId, newLabel) => {
        setTabs(prev => {
            const existingTab = prev.find(tab => tab.id === tabId);
            if (existingTab && existingTab.label === newLabel) {
                return prev;
            }
            return prev.map(tab =>
                tab.id === tabId ? { ...tab, label: newLabel } : tab
            );
        });
        if (tabId === activeTabIdRef.current) {
            setTitle(prevTitle => prevTitle !== newLabel ? newLabel : prevTitle);
        }
    }, []);

    const lastActiveTabId = useRef(activeTabId);
    const targetTabIdRef = useRef(null);

    useEffect(() => {
        // Si estamos cambiando de pestaña, esperar a que activeTabId se sincronice
        // con la pestaña de destino (targetTabIdRef) para evitar sobrescribir el path
        // de la pestaña inactiva en renders intermedios desalineados.
        if (targetTabIdRef.current !== null) {
            const targetTab = tabs.find(t => t.id === targetTabIdRef.current);
            if (activeTabId !== targetTabIdRef.current || (targetTab && location.pathname !== targetTab.path)) {
                return;
            }
            targetTabIdRef.current = null; // Sincronización completada, limpiar
        }

        if (lastActiveTabId.current !== activeTabId) {
            lastActiveTabId.current = activeTabId;
            return;
        }
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && activeTab.path !== location.pathname) {
            setTabs(prev => prev.map(tab =>
                tab.id === activeTabId ? { ...tab, path: location.pathname } : tab
            ));
        }
    }, [location.pathname, activeTabId, tabs]);

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

    const addTab = () => {
        if (tabs.length >= MAX_TABS) {
            alert(`Límite de ${MAX_TABS} pestañas alcanzado.`);
            return;
        }
        const newId = 'tab-' + Date.now();
        const newTab = { id: newId, path: '/dashboard', label: 'Inicio' };
        setTabs([...tabs, newTab]);
        targetTabIdRef.current = newId;
        setActiveTabId(newId);
        navigate('/dashboard');
    };

    const closeTab = (e, id) => {
        e.stopPropagation();
        if (tabs.length === 1) {
            const newId = 'tab-' + Date.now();
            setTabs([{ id: newId, path: '/dashboard', label: 'Inicio' }]);
            targetTabIdRef.current = newId;
            setActiveTabId(newId);
            navigate('/dashboard');
            return;
        }
        const newTabs = tabs.filter(t => t.id !== id);
        setTabs(newTabs);
        if (activeTabId === id) {
            const lastTab = newTabs[newTabs.length - 1];
            targetTabIdRef.current = lastTab.id;
            setActiveTabId(lastTab.id);
            navigate(lastTab.path);
        }
    };

    const switchTab = (id) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) {
            targetTabIdRef.current = id;
            setActiveTabId(id);
            navigate(tab.path);
        }
    };

    const refreshTab = (e, id) => {
        e.stopPropagation();
        setTabs(prev => prev.map(tab =>
            tab.id === id ? { ...tab, refreshKey: (tab.refreshKey || 0) + 1 } : tab
        ));
    };

    const pointerDragRef = useRef(null);

    const handleTabPointerDown = (e, index) => {
        if (e.button !== 0) return;
        if (e.target.closest('.tab-close-btn') || e.target.closest('.tab-refresh-btn')) return;

        pointerDragRef.current = {
            currentIndex: index,
            startX: e.clientX,
            hasMoved: false
        };

        const onPointerMove = (moveEvent) => {
            if (!pointerDragRef.current) return;
            const diffX = moveEvent.clientX - pointerDragRef.current.startX;

            if (Math.abs(diffX) > 4 && !pointerDragRef.current.hasMoved) {
                pointerDragRef.current.hasMoved = true;
                setDraggedTabIndex(pointerDragRef.current.currentIndex);
            }

            if (!pointerDragRef.current.hasMoved) return;

            const curIdx = pointerDragRef.current.currentIndex;
            const threshold = 60;

            if (diffX > threshold && curIdx < tabs.length - 1) {
                const targetIdx = curIdx + 1;
                setTabs(prev => {
                    const newTabs = [...prev];
                    const [moved] = newTabs.splice(curIdx, 1);
                    newTabs.splice(targetIdx, 0, moved);
                    return newTabs;
                });
                pointerDragRef.current.currentIndex = targetIdx;
                pointerDragRef.current.startX = moveEvent.clientX;
                setDraggedTabIndex(targetIdx);
            } else if (diffX < -threshold && curIdx > 0) {
                const targetIdx = curIdx - 1;
                setTabs(prev => {
                    const newTabs = [...prev];
                    const [moved] = newTabs.splice(curIdx, 1);
                    newTabs.splice(targetIdx, 0, moved);
                    return newTabs;
                });
                pointerDragRef.current.currentIndex = targetIdx;
                pointerDragRef.current.startX = moveEvent.clientX;
                setDraggedTabIndex(targetIdx);
            }
        };

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            setTimeout(() => {
                pointerDragRef.current = null;
                setDraggedTabIndex(null);
            }, 50);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    useEffect(() => {
        document.title = title;
        checkAndSyncIfNeeded();
    }, [title]);

    const userJson = localStorage.getItem('user');
    let hasAdminPerm = false;
    if (userJson) {
        try {
            const u = JSON.parse(userJson);
            const rawPerms = u.permissions;
            let perms = [];
            if (Array.isArray(rawPerms)) {
                perms = rawPerms;
            } else if (typeof rawPerms === 'string') {
                const trimmed = rawPerms.trim();
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    try { perms = JSON.parse(trimmed); } catch(e) { perms = []; }
                } else {
                    perms = trimmed.split(',').map(p => p.trim()).filter(Boolean);
                }
            }
            if (u.username === 'admin' || perms.includes('admin')) {
                hasAdminPerm = true;
            }
        } catch (e) {}
    }

    return (
        <div className="flex flex-col min-h-screen bg-[var(--sap-bg)] text-[var(--sap-text)] font-sans print:block print:h-auto print:overflow-visible">
            {/* Header / Shell Bar */}
            <header className="top-header bg-[var(--sap-shell-bg)] text-white h-[48px] px-4 flex items-center gap-4 shadow-lg sticky top-0 z-50 print:hidden no-print border-none">
                <button
                    className="p-2 rounded hover:bg-white/10 transition-all cursor-pointer z-[1001]"
                    onClick={toggleMenu}
                    aria-label="Menú"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                </button>

                <div className="tabs-wrapper flex-grow mr-4 min-w-0">
                    <div className="tabs-scroll-container overflow-x-auto no-scrollbar scroll-smooth">
                        {tabs.map((tab, index) => {
                            const isDragging = draggedTabIndex === index;

                            return (
                                <div
                                    key={tab.id}
                                    onPointerDown={(e) => handleTabPointerDown(e, index)}
                                    onClick={() => {
                                        if (!pointerDragRef.current?.hasMoved) {
                                            switchTab(tab.id);
                                        }
                                    }}
                                    className={`tab-item ${activeTabId === tab.id ? 'active' : ''} ${isDragging ? 'dragging shadow-2xl bg-white/25 scale-[1.02] z-20 cursor-grabbing' : ''}`}
                                >
                                    <span className="tab-label">{t(tab.label)}</span>
                                    <div className="tab-actions flex items-center gap-1 ml-2">
                                        <button
                                            onClick={(e) => refreshTab(e, tab.id)}
                                            className={`tab-refresh-btn p-1 rounded hover:bg-white/10 transition-all ${activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                            title={t('header.refresh_data', 'Refrescar datos')}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                                            </svg>
                                        </button>
                                        {tabs.length > 1 && (
                                            <button onClick={(e) => closeTab(e, tab.id)} className="tab-close-btn">
                                                <span>&#215;</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <button onClick={addTab} className="add-tab-btn">+</button>
                </div>

                <div className="header-actions flex items-center gap-3">
                    <Link to="/admin/login" className="text-[11px] font-medium text-white uppercase tracking-tight px-3 py-1 border border-white/20 rounded hover:bg-white/10 transition-all opacity-0 hover:opacity-100 duration-200">Admin</Link>
                </div>
            </header>

            {/* Sidebar Menu Sincronizado a 48px */}
            <div
                className={`fixed left-0 w-64 bg-[var(--sap-shell-bg)] shadow-2xl z-[999] overflow-y-auto transform transition-transform duration-300 ease-in-out print:hidden no-print ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
                style={{ top: '48px', height: 'calc(100vh - 48px)' }}
            >
                <nav className="py-2 flex flex-col min-h-full">
                    <div className="flex-grow">
                        <div className="px-4 mb-2">
                            <div className="px-2 text-[12px] font-medium text-slate-500 uppercase tracking-tight mb-1">{t('menu.main', 'Principal')}</div>
                            <MenuItem to="/dashboard" label={t('nav.home', 'Inicio')} desc={t('nav.home_desc', 'Panel principal y accesos rápidos')} categoryId="recepcion" onClick={toggleMenu} />
                            <MenuItem to="/stock" label={t('nav.stock', 'Consultar Stock')} desc={t('nav.stock_desc', 'Búsqueda global de inventario y saldos')} categoryId="recepcion" onClick={toggleMenu} />
                        </div>
                        <div className="px-4 mb-2">
                            <div className="px-2 text-[12px] font-medium text-slate-500 uppercase tracking-tight mb-1 border-t border-white/5 pt-2">{t('menu.inbound', 'Operaciones Inbound')}</div>
                            <MenuItem to="/inbound" label={t('nav.inbound', 'Recepción')} desc={t('nav.inbound_desc', 'Entrada de mercancía y referencias')} categoryId="recepcion" onClick={toggleMenu} />
                            <MenuItem to="/reconciliation" label={t('nav.reconciliation', 'Conciliación')} desc={t('nav.reconciliation_desc', 'Cruce de documentos y discrepancias')} categoryId="recepcion" onClick={toggleMenu} />
                            <MenuItem to="/inbound/audit" label={t('nav.inbound_audit', 'Auditoría Agente')} desc={t('nav.inbound_audit_desc', 'Control de calidad y recepción física')} categoryId="recepcion" onClick={toggleMenu} />
                            <MenuItem to="/view_logs" label={t('nav.view_logs', 'Registros')} desc={t('nav.view_logs_desc', 'Consulta de registros históricos')} categoryId="recepcion" onClick={toggleMenu} />
                            <MenuItem to="/ir-reconciliation" label={t('nav.ir_dashboard', 'Dashboard IR')} desc={t('nav.ir_dashboard_desc', 'Estado general de Import References')} categoryId="recepcion" onClick={toggleMenu} />
                        </div>
                        <div className="px-4 mb-2">
                            <div className="px-2 text-[12px] font-medium text-slate-500 uppercase tracking-tight mb-1 border-t border-white/5 pt-2">{t('menu.outbound', 'Operaciones Outbound')}</div>
                            <MenuItem to="/picking" label={t('nav.picking', 'Picking')} desc={t('nav.picking_desc', 'Verificación de pedidos y empaque')} categoryId="despacho" onClick={toggleMenu} />
                            <MenuItem to="/view_picking_audits" label={t('nav.packing', 'Empaque')} desc={t('nav.packing_desc', 'Listas de empaque y auditorías')} categoryId="despacho" onClick={toggleMenu} />
                            <MenuItem to="/shipments" label={t('nav.shipments', 'Despacho')} desc={t('nav.shipments_desc', 'Gestión de despachos y embarques')} categoryId="despacho" onClick={toggleMenu} />
                            <MenuItem to="/label" label={t('nav.label', 'Etiquetado')} desc={t('nav.label_desc', 'Impresión de etiquetas operativas')} categoryId="despacho" onClick={toggleMenu} />
                        </div>
                        <div className="px-4 mb-2">
                            <div className="px-2 text-[12px] font-medium text-slate-500 uppercase tracking-tight mb-1 border-t border-white/5 pt-2">{t('menu.inventory', 'Control Inventario')}</div>
                            <MenuItem to="/planner" label={t('nav.planner', 'Plan Cíclico')} desc={t('nav.planner_desc', 'Programación de conteos cíclicos')} categoryId="inventario" onClick={toggleMenu} />
                            <MenuItem to="/inventory-dashboard" label={t('nav.metrics', 'Métricas')} desc={t('nav.metrics_desc', 'Indicadores de exactitud')} categoryId="inventario" onClick={toggleMenu} />
                            <MenuItem to="/view_counts/recordings" label={t('nav.recordings', 'Históricos')} desc={t('nav.recordings_desc', 'Grabaciones y trazabilidad')} categoryId="inventario" onClick={toggleMenu} />
                            <MenuItem to="/planner/manage_differences" label={t('nav.differences', 'Diferencias')} desc={t('nav.differences_desc', 'Gestión de ajustes y discrepancias')} categoryId="inventario" onClick={toggleMenu} />
                            <MenuItem to="/counts" label={t('nav.w2w', 'Inventario W2W')} desc={t('nav.w2w_desc', 'Conteo masivo wall-to-wall')} categoryId="inventario" onClick={toggleMenu} />
                            {hasAdminPerm && <MenuItem to="/counts/manage" label={t('nav.manage_counts', 'Edición Conteos')} desc={t('nav.manage_counts_desc', 'Gestión de registros de conteo')} categoryId="inventario" onClick={toggleMenu} />}
                            {hasAdminPerm && <MenuItem to="/view_counts" label={t('nav.general_count', 'Conteo General')} desc={t('nav.general_count_desc', 'Consolidado de conteos')} categoryId="inventario" onClick={toggleMenu} />}
                            <MenuItem to="/express-audit" label={t('nav.manual_cycle', 'Ciclo Manual')} desc={t('nav.manual_cycle_desc', 'Conteo ciego y auditoría rápida')} categoryId="inventario" onClick={toggleMenu} />  
                            <MenuItem to="/spot-check" label={t('nav.spot_check', 'Spot Check')} desc={t('nav.spot_check_desc', 'Auditorías rápidas en piso')} categoryId="inventario" onClick={toggleMenu} />
                        </div>
                        <div className="px-4 mb-2">
                            <div className="px-2 text-[12px] font-medium text-slate-500 uppercase tracking-tight mb-1 border-t border-white/5 pt-2">{t('menu.system', 'Sistema')}</div>
                            <MenuItem to="/admin/inventory" label={t('nav.admin_inventory', 'Adm. Inventario')} desc={t('nav.admin_inventory_desc', 'Control de ciclos de conteo')} categoryId="admin" onClick={toggleMenu} />
                            <MenuItem to="/admin/slotting" label={t('nav.slotting_config', 'Config. Slotting')} desc={t('nav.slotting_config_desc', 'Parámetros de ubicaciones')} categoryId="admin" onClick={toggleMenu} />
                            <MenuItem to="/occupancy" label={t('nav.occupancy', 'Ocupación Bodega')} desc={t('nav.occupancy_desc', 'Análisis de espacio y ubicaciones')} categoryId="admin" onClick={toggleMenu} />
                            <MenuItem to="/update" label={t('nav.update_data', 'Carga de Datos')} desc={t('nav.update_data_desc', 'Actualización masiva vía ficheros')} categoryId="admin" onClick={toggleMenu} />
                        </div>
                    </div>

                    {/* Selector de Idioma Simplificado */}
                    <div className="px-4 py-2 border-t border-white/10 bg-black/15 mt-2">
                        <div className="grid grid-cols-2 gap-2 px-1">
                            <button
                                type="button"
                                onClick={() => setLanguage('es')}
                                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[12px] font-bold transition-all cursor-pointer ${
                                    language === 'es'
                                        ? 'bg-blue-600 text-white border border-blue-400 shadow-md scale-[1.02]'
                                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-transparent'
                                }`}
                                title="Español"
                            >
                                <span className="text-base leading-none">🇪🇸</span>
                                <span>Español</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setLanguage('pt')}
                                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[12px] font-bold transition-all cursor-pointer ${
                                    language === 'pt'
                                        ? 'bg-emerald-600 text-white border border-emerald-400 shadow-md scale-[1.02]'
                                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-transparent'
                                }`}
                                title="Português"
                            >
                                <span className="text-base leading-none">🇧🇷</span>
                                <span>Português</span>
                            </button>
                        </div>

                        <button
                            className="w-full flex items-center justify-start !justify-start px-2 py-1.5 mt-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-all uppercase text-[11px] font-semibold tracking-tight text-left cursor-pointer"
                            style={{ justifyContent: 'flex-start' }}
                            onClick={async () => {
                                localStorage.removeItem('user');
                                localStorage.removeItem('admin_authenticated');
                                try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); }
                                finally { navigate('/login'); }
                            }}
                        >
                            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            {t('menu.logout', 'Cerrar Sesión')}
                        </button>
                    </div>
                </nav>
            </div>

            {/* Overlay Sincronizado a 48px */}
            <div
                className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity z-[998] print:hidden no-print ${isMenuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
                style={{ top: '48px' }}
                onClick={toggleMenu}
            ></div>

            {/* Main Content */}
            <main className="main-content flex-grow overflow-y-auto overflow-x-hidden print:overflow-visible print:h-auto bg-[#fafafa]">
                <div className="w-full h-full">
                    {tabs.map(tab => (
                        <TabContentWrapper
                            key={tab.id}
                            tab={tab}
                            isActive={activeTabId === tab.id}
                            onTitleChange={updateTabLabel}
                        />
                    ))}
                </div>
            </main>
        </div>
    );
};

export default Layout;
