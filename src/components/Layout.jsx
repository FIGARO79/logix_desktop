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
import IRReconciliation from '../pages/IRReconciliation';
import PackingListPrint from '../pages/PackingListPrint';
import ConsolidatedPackingList from '../pages/ConsolidatedPackingList';
import NetworkSettingsModal from './NetworkSettingsModal';
import PrinterSettingsModal from './PrinterSettingsModal';
import DesktopMenuBar from './DesktopMenuBar';

// Mapeo de rutas a componentes
const ROUTE_MAP = [
    { path: '/dashboard', component: Dashboard },
    { path: '/inbound', component: Inbound },
    { path: '/reconciliation', component: Reconciliation },
    { path: '/ir-reconciliation', component: IRReconciliation },
    { path: '/stock', component: StockSearch },
    { path: '/spot-check', component: SpotCheck },
    { path: '/view_picking_audits', component: PickingAuditHistory },
    { path: '/packing_list/print/:id', component: PackingListPrint },
    { path: '/packing_list/:id', component: PackingListPrint },
    { path: '/packing_list', component: PackingListPrint },
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
    { path: '/shipments/print/:id', component: ConsolidatedPackingList },
    { path: '/update', component: Update },
    { path: '/admin/users', component: AdminUsers },
    { path: '/admin/login', component: AdminLogin },
    { path: '/counts/edit/:id', component: EditCount },
];

const MenuItem = React.memo(({ to, label, desc, categoryId, onClick }) => {
    const location = useLocation();
    const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

    const itemData = useMemo(() => ({
        href: to,
        text: label.toUpperCase(),
        desc: desc || `Módulo de ${label}`,
        categoryId: categoryId || 'recepcion'
    }), [to, label, desc, categoryId]);

    const handleDragStart = useCallback((e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(itemData));
        e.dataTransfer.effectAllowed = 'copyMove';
    }, [itemData]);

    const handleQuickPin = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('logix_dashboard_pin_item', { detail: itemData }));
    }, [itemData]);

    return (
        <div className="group/item flex items-center justify-between pr-2 transition-all hover:bg-[#f0f0f0]">
            <Link
                to={to}
                draggable
                onDragStart={handleDragStart}
                className={`flex-grow flex cursor-pointer items-center border-l-[4px] px-4 py-1 leading-tight transition-all
                ${isActive ? 'border-[#0078d4] bg-[#eaeaea] font-semibold text-[#0078d4]' : 'border-transparent text-[#323130] hover:border-[#0078d4]/40'}`}
                onClick={onClick}
                title="Arrastra esta opción al Dashboard para fijarla"
            >
                <span className="text-[12px] uppercase select-none font-normal">{label}</span>
            </Link>

            <button
                type="button"
                onClick={handleQuickPin}
                className="inline-flex h-[22px] w-[22px] min-w-[22px] cursor-pointer items-center justify-center rounded text-[#8a8886] opacity-0 transition-all hover:bg-[#eaeaea] hover:text-[#0078d4] group-hover/item:opacity-100 !p-0"
                style={{ width: '22px', height: '22px', minWidth: '22px', padding: 0 }}
                title="Fijar en Dashboard"
                aria-label="Fijar en Dashboard"
            >
                <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '14px', height: '14px', minWidth: '14px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            </button>
        </div>
    );
});

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

    // Inicializar inmediatamente si la pestaña se vuelve activa para evitar parpadeo
    if (isActive && !initialized) {
        setInitialized(true);
    }

    // Manejar el refresco forzado solo si el refreshKey aumenta (evita disparos en el mount si ya era > 0)
    useEffect(() => {
        if (tab.refreshKey > lastRefreshKey.current) {
            setInitialized(false);
            lastRefreshKey.current = tab.refreshKey;
        }
    }, [tab.refreshKey]);

    const tabSetTitle = useCallback((newTitle) => {
        onTitleChange(tab.id, newTitle);
    }, [tab.id, onTitleChange]);

    const contextValue = useMemo(() => ({ setTitle: tabSetTitle }), [tabSetTitle]);

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
    const { pendingCount, syncPendingData, refreshPendingCount } = useOffline();
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
        return localStorage.getItem('logix_active_tab') || null;
    });

    const [isNetworkModalOpen, setIsNetworkModalOpen] = useState(false);
    const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);

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

    const tabsRef = useRef(tabs);
    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    const lastActiveTabId = useRef(activeTabId);
    const targetTabIdRef = useRef(null);

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

    useEffect(() => {
        // Si estamos cambiando de pestaña, esperar a que activeTabId se sincronice
        // con la pestaña de destino (targetTabIdRef) para evitar sobrescribir el path
        // de la pestaña inactiva en renders intermedios desalineados.
        if (targetTabIdRef.current !== null) {
            const targetTab = tabs.find(t => t.id === targetTabIdRef.current);
            if (!targetTab || activeTabId !== targetTabIdRef.current || location.pathname !== targetTab.path) {
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

    const toggleMenu = useCallback(() => setIsMenuOpen(prev => !prev), []);

    const addTab = useCallback(() => {
        if (tabs.length >= MAX_TABS) {
            alert(`Límite de ${MAX_TABS} pestañas alcanzado.`);
            return;
        }
        const newId = 'tab-' + Date.now();
        const newTab = { id: newId, path: '/dashboard', label: 'Inicio' };
        setTabs(prev => [...prev, newTab]);
        targetTabIdRef.current = newId;
        setActiveTabId(newId);
        navigate('/dashboard');
    }, [tabs.length, navigate]);

    const closeTab = useCallback((e, id) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const currentTabs = tabsRef.current;
        if (currentTabs.length <= 1) {
            const newId = 'tab-' + Date.now();
            targetTabIdRef.current = newId;
            setTabs([{ id: newId, path: '/dashboard', label: 'Inicio' }]);
            setActiveTabId(newId);
            navigate('/dashboard');
            return;
        }

        const newTabs = currentTabs.filter(t => t.id !== id);
        setTabs(newTabs);

        if (activeTabIdRef.current === id) {
            const lastTab = newTabs[newTabs.length - 1];
            targetTabIdRef.current = lastTab.id;
            setActiveTabId(lastTab.id);
            navigate(lastTab.path);
        }
    }, [navigate]);

    const switchTab = useCallback((id) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) {
            targetTabIdRef.current = id;
            setActiveTabId(id);
            navigate(tab.path);
        }
    }, [tabs, navigate]);

    const refreshTab = useCallback((e, id) => {
        if (e && e.stopPropagation) e.stopPropagation();
        setTabs(prev => prev.map(tab =>
            tab.id === id ? { ...tab, refreshKey: (tab.refreshKey || 0) + 1 } : tab
        ));
    }, []);

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

            if (Math.abs(diffX) > 14 && !pointerDragRef.current.hasMoved) {
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
    }, [title]);

    useEffect(() => {
        checkAndSyncIfNeeded();
        const syncInterval = setInterval(() => {
            checkAndSyncIfNeeded();
        }, 15 * 60 * 1000);
        return () => clearInterval(syncInterval);
    }, []);

    const handleCloseActiveTab = useCallback(() => {
        closeTab(null, activeTabIdRef.current);
    }, [closeTab]);

    const handleOpenNetworkModal = useCallback(() => setIsNetworkModalOpen(true), []);
    const handleOpenPrinterModal = useCallback(() => setIsPrinterModalOpen(true), []);
    const handleDesktopNavigate = useCallback((path) => {
        navigate(path);
    }, [navigate]);
    const handleLogout = useCallback(async () => {
        localStorage.removeItem('user');
        localStorage.removeItem('admin_authenticated');
        try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); }
        finally { navigate('/login'); }
    }, [navigate]);

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
        <div className="flex flex-col min-h-screen bg-[#f3f3f3] text-[#201f1e] font-sans print:block print:h-auto print:overflow-visible">
            {/* Barra Superior Completa: Menubar de Escritorio + Shell de Pestañas */}
            <div className="sticky top-0 z-50 print:hidden no-print">
                <DesktopMenuBar
                    onNewTab={addTab}
                    onCloseCurrentTab={handleCloseActiveTab}
                    onOpenNetworkModal={handleOpenNetworkModal}
                    onOpenPrinterModal={handleOpenPrinterModal}
                    onNavigate={handleDesktopNavigate}
                    language={language}
                    setLanguage={setLanguage}
                    onLogout={handleLogout}
                />

                <header className="top-header flex h-[48px] items-center gap-4 border-b border-[#d2d0ce] bg-white px-4 text-[#201f1e] shadow-none">
                    <button
                        type="button"
                        className="z-[1001] cursor-pointer rounded p-2 text-[#605e5c] transition-all hover:bg-[#f3f3f3] hover:text-[#201f1e]"
                        onClick={toggleMenu}
                        aria-label="Menú"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>

                    <div className="tabs-wrapper self-stretch flex-grow mr-4 min-w-0">
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
                                        className={`tab-item group ${activeTabId === tab.id ? 'active' : ''} ${isDragging ? 'dragging shadow-2xl bg-[#edebe9] scale-[1.02] z-20 cursor-grabbing' : ''}`}
                                    >
                                        <span className="tab-label font-normal tracking-normal">{t(tab.label)}</span>
                                        <div className="tab-actions flex items-center gap-1 ml-2">
                                            <button
                                                onClick={(e) => refreshTab(e, tab.id)}
                                                className={`tab-refresh-btn ${activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                                title={t('header.refresh_data', 'Refrescar datos')}
                                                aria-label={t('header.refresh_data', 'Refrescar datos')}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                                                </svg>
                                            </button>
                                            {tabs.length > 1 && (
                                                <button onClick={(e) => closeTab(e, tab.id)} className="tab-close-btn" title={t('tabs.close', 'Cerrar pestaña')} aria-label={t('tabs.close', 'Cerrar pestaña')}>
                                                    <span>&#215;</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button onClick={addTab} className="add-tab-btn" title={t('tabs.new', 'Nueva pestaña')} aria-label={t('tabs.new', 'Nueva pestaña')}>+</button>
                    </div>

                    <div className="header-actions flex items-center gap-3">
                        {pendingCount > 0 && (
                            <div className="hidden cursor-pointer items-center gap-1.5 rounded border border-[#f7c948] bg-[#fff4ce] px-2 py-1 text-[10px] font-medium text-[#323130] sm:flex" onClick={handleManualSync}>
                                {pendingCount} {t('header.pending', 'PENDIENTES')}
                            </div>
                        )}
                    </div>
                </header>
            </div>

            {/* Sidebar Menu Sincronizado a 76px (Menubar 28px + Shell 48px) */}
            <div
                className={`fixed left-0 z-[999] w-64 overflow-y-auto border-r border-[#e1dfdd] bg-[#f9f9f9] shadow-xl transition-transform duration-300 ease-in-out print:hidden no-print ${
                    isMenuOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                style={{ top: '76px', height: 'calc(100vh - 76px)' }}
            >
                <nav className="py-2">
                    <div className="px-4 mb-2">
                        <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#605e5c]">{t('menu.main', 'Principal')}</div>
                        <MenuItem to="/dashboard" label={t('nav.home', 'Inicio')} desc={t('nav.home_desc', 'Panel principal y accesos rápidos')} categoryId="recepcion" onClick={toggleMenu} />
                        <MenuItem to="/stock" label={t('nav.stock', 'Consultar Stock')} desc={t('nav.stock_desc', 'Búsqueda global de inventario y saldos')} categoryId="recepcion" onClick={toggleMenu} />
                    </div>
                    <div className="px-4 mb-2">
                        <div className="mb-1 border-t border-[#e1dfdd] px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#605e5c]">{t('menu.inbound', 'Operaciones Inbound')}</div>
                        <MenuItem to="/inbound" label={t('nav.inbound', 'Recepción')} desc={t('nav.inbound_desc', 'Entrada de mercancía y referencias')} categoryId="recepcion" onClick={toggleMenu} />
                        <MenuItem to="/reconciliation" label={t('nav.reconciliation', 'Conciliación')} desc={t('nav.reconciliation_desc', 'Cruce de documentos y discrepancias')} categoryId="recepcion" onClick={toggleMenu} />
                        <MenuItem to="/view_logs" label={t('nav.view_logs', 'Registros')} desc={t('nav.view_logs_desc', 'Consulta de registros históricos')} categoryId="recepcion" onClick={toggleMenu} />
                        <MenuItem to="/ir-reconciliation" label={t('nav.ir_dashboard', 'Dashboard IR')} desc={t('nav.ir_dashboard_desc', 'Estado general de Import References')} categoryId="recepcion" onClick={toggleMenu} />
                    </div>
                    <div className="px-4 mb-2">
                        <div className="mb-1 border-t border-[#e1dfdd] px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#605e5c]">{t('menu.outbound', 'Operaciones Outbound')}</div>
                        <MenuItem to="/picking" label={t('nav.picking', 'Picking')} desc={t('nav.picking_desc', 'Verificación de pedidos y empaque')} categoryId="despacho" onClick={toggleMenu} />
                        <MenuItem to="/view_picking_audits" label={t('nav.packing', 'Empaque')} desc={t('nav.packing_desc', 'Listas de empaque y auditorías')} categoryId="despacho" onClick={toggleMenu} />
                        <MenuItem to="/shipments" label={t('nav.shipments', 'Despacho')} desc={t('nav.shipments_desc', 'Gestión de despachos y embarques')} categoryId="despacho" onClick={toggleMenu} />
                        <MenuItem to="/label" label={t('nav.label', 'Etiquetado')} desc={t('nav.label_desc', 'Impresión de etiquetas operativas')} categoryId="despacho" onClick={toggleMenu} />
                    </div>
                    <div className="px-4 mb-2">
                        <div className="mb-1 border-t border-[#e1dfdd] px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#605e5c]">{t('menu.inventory', 'Control Inventario')}</div>
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
                        <div className="mb-1 border-t border-[#e1dfdd] px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#605e5c]">{t('menu.system', 'Sistema')}</div>
                        <MenuItem to="/admin/inventory" label={t('nav.admin_inventory', 'Adm. Inventario')} desc={t('nav.admin_inventory_desc', 'Control de ciclos de conteo')} categoryId="admin" onClick={toggleMenu} />
                        <MenuItem to="/admin/slotting" label={t('nav.slotting_config', 'Config. Slotting')} desc={t('nav.slotting_config_desc', 'Parámetros de ubicaciones')} categoryId="admin" onClick={toggleMenu} />
                        <MenuItem to="/occupancy" label={t('nav.occupancy', 'Ocupación Bodega')} desc={t('nav.occupancy_desc', 'Análisis de espacio y ubicaciones')} categoryId="admin" onClick={toggleMenu} />
                        <MenuItem to="/update" label={t('nav.update_data', 'Carga de Datos')} desc={t('nav.update_data_desc', 'Actualización masiva vía ficheros')} categoryId="admin" onClick={toggleMenu} />
                        <button
                            className="mt-2 flex w-full cursor-pointer items-center justify-start !justify-start border-l-[4px] border-transparent px-4 py-1 text-left text-[12px] font-semibold uppercase text-[#a4262c] transition-all hover:bg-[#fde7e9]"
                            style={{ justifyContent: 'flex-start' }}
                            onClick={handleLogout}
                        >
                            {t('menu.logout', 'Cerrar Sesión')}
                        </button>
                    </div>
                </nav>
            </div>

            {/* Overlay Sincronizado a 76px */}
            <div
                className={`fixed inset-0 z-[998] bg-black/20 backdrop-blur-sm transition-opacity duration-300 print:hidden no-print ${
                    isMenuOpen ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
                }`}
                style={{ top: '76px' }}
                onClick={toggleMenu}
            ></div>
            {/* Main Content */}
            <main className="main-content flex-grow overflow-y-auto overflow-x-hidden print:overflow-visible print:h-auto bg-[#f3f3f3]">
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

            {/* Modal de Configuración de Red y Modo Host/Cliente */}
            <NetworkSettingsModal
                isOpen={isNetworkModalOpen}
                onClose={() => setIsNetworkModalOpen(false)}
            />

            {/* Modal de Configuración de Impresión Silenciosa */}
            <PrinterSettingsModal
                isOpen={isPrinterModalOpen}
                onClose={() => setIsPrinterModalOpen(false)}
            />
        </div>
    );
};

export default Layout;
