import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

const AdminInventory = () => {
    const navigate = useNavigate();
    const { setTitle } = useOutletContext();
    const [activeTab, setActiveTab] = useState('cycle');

    // --- Cycle Control State ---
    const [stats, setStats] = useState(null);
    const [stage, setStage] = useState(0);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    // --- Manage Counts State ---
    const [counts, setCounts] = useState([]);
    const [filteredCounts, setFilteredCounts] = useState([]);
    const [countStats, setCountStats] = useState(null);
    const [usernames, setUsernames] = useState([]);
    const [selectedUser, setSelectedUser] = useState('');

    // Reopen Location Form State
    const [reopenSessionId, setReopenSessionId] = useState('');
    const [reopenLocationCode, setReopenLocationCode] = useState('');
    const [adminMsg, setAdminMsg] = useState('');

    // --- Reconciliation State ---
    const [reconItems, setReconItems] = useState([]);
    const [reconLoading, setReconLoading] = useState(false);
    const [reconFilter, setReconFilter] = useState('counted'); // 'counted' | 'all' | 'pending'
    const [searchQuery, setSearchQuery] = useState('');
    const [settings, setSettings] = useState({ w2w_qty_tolerance: 0.02, w2w_val_tolerance: 10.00 });
    const [settingsLoading, setSettingsLoading] = useState(false);

    const fetchReconciliation = useCallback(async () => {
        setReconLoading(true);
        try {
            const res = await fetch('/api/admin/inventory/reconciliation');
            if (!res.ok) throw new Error("Error cargando conciliación");
            const data = await res.json();
            setReconItems(data.items || []);
            if (data.settings) {
                setSettings(data.settings);
            }
        } catch (err) {
            setReconItems([]);
        } finally {
            setReconLoading(false);
        }
    }, []);

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setSettingsLoading(true);
        try {
            const res = await fetch('/api/admin/inventory/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    w2w_qty_tolerance: settings.w2w_qty_tolerance.toString(),
                    w2w_val_tolerance: settings.w2w_val_tolerance.toString()
                })
            });
            if (!res.ok) throw new Error("Error actualizando configuraciones");
            alert("Tolerancias guardadas correctamente.");
            fetchReconciliation();
            fetchStats();
        } catch (err) {
            alert(err.message);
        } finally {
            setSettingsLoading(false);
        }
    };

    const handleApproveItem = async (itemCode) => {
        if (!window.confirm(`¿Aprobar manualmente la diferencia de ${itemCode}?`)) return;
        try {
            const res = await fetch('/api/admin/inventory/approve_item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_code: itemCode })
            });
            if (!res.ok) throw new Error("Error aprobando item");
            fetchReconciliation();
            fetchStats();
        } catch (err) {
            alert(err.message);
        }
    };

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/inventory/summary');
            if (!res.ok) throw new Error("Error al cargar estadísticas");
            const data = await res.json();
            const currentStage = typeof data.stage === 'number'
                ? data.stage
                : (typeof data.current_stage === 'number' ? data.current_stage : 0);
            setStage(currentStage);

            const resolvedStats = data.stats || {
                items_count: data.total_skus || data.items_count || 0,
                total_counts: data.total_counted || data.total_counts || 0,
                current_stage: currentStage,
                stages: data.stages || {}
            };
            setStats(resolvedStats);

            if (data.settings) {
                setSettings(data.settings);
            }
        } catch (err) {
            setStats({
                items_count: 0,
                total_counts: 0,
                current_stage: 0,
                stages: {}
            });
            setStage(0);
        }
    }, []);

    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', actionUrl: null });
    const [processingAction, setProcessingAction] = useState(null);

    const openConfirmModal = (actionUrl, title, message) => {
        setConfirmModal({ open: true, title, message, actionUrl });
    };

    const executeAction = async (actionUrl) => {
        setLoading(true);
        setProcessingAction(actionUrl);
        setMessage(null);
        setError(null);
        try {
            const res = await fetch(actionUrl, { method: 'POST' });
            if (!res.ok) {
                let errorMsg = "Error en la operación";
                try {
                    const data = await res.json();
                    errorMsg = data.detail || data.message || errorMsg;
                } catch {
                    const text = await res.text();
                    errorMsg = text || `Error HTTP ${res.status} al ejecutar acción.`;
                }
                throw new Error(errorMsg);
            }
            const data = await res.json();
            
            // Reactividad inmediata en memoria
            if (typeof data.stage === 'number') {
                setStage(data.stage);
            }
            setMessage(data.message);
            setConfirmModal({ open: false, title: '', message: '', actionUrl: null });

            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('logix_events');
                bc.postMessage({ type: 'CYCLE_COUNT_MUTATED' });
                if (data.stage !== undefined) {
                    bc.postMessage({ type: 'INVENTORY_STAGE_CHANGED', stage: data.stage });
                }
                bc.close();
            }

            // Sincronizar estadísticas en segundo plano sin congelar la interfaz
            fetchStats();
            if (activeTab === 'reconciliation') {
                fetchReconciliation();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
            setProcessingAction(null);
        }
    };

    const fetchCounts = useCallback(async () => {
        try {
            const [resAll, resStats] = await Promise.all([
                fetch('/api/counts/all'),
                fetch('/api/counts/stats')
            ]);
            if (!resAll.ok) throw new Error("Error cargando conteos");
            const data = await resAll.json();
            setCounts(data);
            setFilteredCounts(selectedUser ? data.filter(c => c.username === selectedUser) : data);
            const distinctUsers = [...new Set(data.map(c => c.username).filter(Boolean))].sort();
            setUsernames(distinctUsers);
            if (resStats.ok) setCountStats(await resStats.json());
        } catch (err) {
            setError(err.message);
        }
    }, [selectedUser]);

    const [auditorZones, setAuditorZones] = useState([]);
    const [editedZones, setEditedZones] = useState({});
    const [availableAisles, setAvailableAisles] = useState(['CA', 'EB', 'EC', 'ED', 'EE', 'Piso', 'RA', 'RB', 'RC', 'RD', 'RE']);

    const fetchAvailableAisles = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/inventory/available_aisles');
            if (res.ok) {
                const data = await res.json();
                if (data.aisles && Array.isArray(data.aisles) && data.aisles.length > 0) {
                    setAvailableAisles(data.aisles);
                }
            }
        } catch (e) { console.error(e); }
    }, []);

    const fetchAuditorZones = useCallback(async (forceReset = false) => {
        fetchAvailableAisles();
        try {
            const res = await fetch('/api/admin/inventory/auditor_zones');
            if (res.ok) {
                const data = await res.json();
                setAuditorZones(Array.isArray(data) ? data : []);
                setEditedZones(prev => {
                    const newEdited = { ...prev };
                    if (Array.isArray(data)) {
                        data.forEach(u => {
                            if (forceReset || newEdited[u.id] === undefined) {
                                newEdited[u.id] = u.assigned_zones || '';
                            }
                        });
                    }
                    return newEdited;
                });
            }
        } catch (e) { console.error(e); }
    }, [fetchAvailableAisles]);

    const handleSaveZones = async (userId) => {
        const zonesString = editedZones[userId] || '';
        try {
            const res = await fetch('/api/admin/inventory/assign_zones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, assigned_zones: zonesString })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Error guardando zonas");
            }
            setMessage(`Pasillos actualizados correctamente.`);
            fetchAuditorZones(true);
        } catch (err) {
            setError(err.message);
        }
    };

    useEffect(() => {
        if (setTitle) setTitle("Adm. Inventario");
    }, [setTitle]);

    useEffect(() => {
        fetchStats();
        if (activeTab === 'counts') fetchCounts();
        if (activeTab === 'cycle') {
            fetchCounts();
        } else if (activeTab === 'reconciliation') {
            fetchReconciliation();
        } else if (activeTab === 'zones') {
            fetchAuditorZones();
        }

        let interval = setInterval(() => {
            // Desktop: no onLine check, always available - only skip if tab is hidden
            if (!document.hidden) {
                fetchStats();
                if (activeTab === 'cycle') fetchCounts();
            }
        }, 5000);

        let bc;
        if (typeof BroadcastChannel !== 'undefined') {
            bc = new BroadcastChannel('logix_events');
            bc.onmessage = (event) => {
                if (
                    event.data?.type === 'CYCLE_COUNT_MUTATED' ||
                    event.data?.type === 'INVENTORY_STAGE_CHANGED' ||
                    event.data?.type === 'INVENTORY_FINALIZED'
                ) {
                    fetchStats();
                    fetchCounts();
                    fetchReconciliation();
                    fetchAuditorZones();
                }
            };
        }

        return () => {
            clearInterval(interval);
            if (bc) bc.close();
        };
    }, [activeTab, fetchStats, fetchCounts, fetchReconciliation, fetchAuditorZones]);

    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => setMessage(null), 20000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 20000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este registro?")) return;
        try {
            const res = await fetch(`/api/counts/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Error");
            fetchCounts();
        } catch (e) { alert(e.message); }
    };

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f] bg-[#f3f3f3] min-h-screen">

            {/* Header & Barra de Acciones */}
            <div className="mb-3 flex justify-between items-center bg-white px-4 py-2.5 rounded border border-[#d1d5db] shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Administración de Inventario</h1>
                    <p className="text-[11px] font-normal text-[#5c5c5c] mt-0.5 mb-0">Control de fases de conteo, conciliación y asignación de zonas</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => window.location.href = `/admin/inventory/report`}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer shadow-sm"
                    >
                        Exportar Conciliación
                    </button>
                </div>
            </div>

            {/* Barra de progreso de operación */}
            {loading && (
                <div className="mb-3 bg-[#eff6fc] border border-[#c7e0f4] text-[#0067c0] px-3.5 py-2 rounded text-[12px] font-normal flex items-center justify-between shadow-2xs">
                    <div className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4 text-[#0067c0] shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Procesando operación de ciclo de inventario en base de datos...</span>
                    </div>
                    <span className="text-[11px] text-[#5c5c5c]">Por favor espere un momento</span>
                </div>
            )}

            {message && (
                <div className="bg-[#ecfdf5] border border-[#a7f3d0] text-[#065f46] px-3 py-2 mb-3 rounded shadow-xs text-[12px] font-normal flex justify-between items-center">
                    <span>{message}</span>
                    <button onClick={() => setMessage(null)} className="ml-4 text-[#065f46] hover:text-[#047857] cursor-pointer">✕</button>
                </div>
            )}
            {error && (
                <div className="bg-[#fef2f2] border border-[#fecaca] text-[#991b1b] px-3 py-2 mb-3 rounded shadow-xs text-[12px] font-normal flex justify-between items-center">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-4 text-[#991b1b] hover:text-[#7f1d1d] cursor-pointer">✕</button>
                </div>
            )}

            {/* Tab Navigation */}
            <div className="flex border-b border-[#d1d5db] mb-4 bg-white px-2 pt-1 rounded-t border-t border-l border-r">
                <button
                    onClick={() => setActiveTab('cycle')}
                    className={`px-4 py-2 text-[12px] font-normal border-b-2 transition-colors cursor-pointer ${activeTab === 'cycle' ? 'border-[#0067c0] text-[#0067c0] bg-white' : 'border-transparent text-[#5c5c5c] hover:text-[#1f1f1f] hover:border-[#d1d5db]'}`}
                >
                    Fases del Inventario
                </button>
                <button
                    onClick={() => setActiveTab('reconciliation')}
                    className={`px-4 py-2 text-[12px] font-normal border-b-2 transition-colors cursor-pointer ${activeTab === 'reconciliation' ? 'border-[#0067c0] text-[#0067c0] bg-white' : 'border-transparent text-[#5c5c5c] hover:text-[#1f1f1f] hover:border-[#d1d5db]'}`}
                >
                    Estado de Inventario y Conciliación
                </button>
                <button
                    onClick={() => setActiveTab('zones')}
                    className={`px-4 py-2 text-[12px] font-normal border-b-2 transition-colors cursor-pointer ${activeTab === 'zones' ? 'border-[#0067c0] text-[#0067c0] bg-white' : 'border-transparent text-[#5c5c5c] hover:text-[#1f1f1f] hover:border-[#d1d5db]'}`}
                >
                    Asignación de Zonas por Auditor
                </button>
            </div>

            {activeTab === 'cycle' && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    <div className="lg:col-span-3 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {[
                                {
                                    s: 1,
                                    t: 'FASE 1: CONTEO GENERAL',
                                    d: 'Apertura del ciclo. Reseteo de bases de datos y captura inicial física wall-to-wall.',
                                    actionUrl: stage === 0 ? '/api/admin/inventory/start_stage_1' : '/api/admin/inventory/advance_stage/2',
                                    title: stage === 0 ? '¿Iniciar Fase 1 (Conteo General)?' : '¿Concluir Fase 1 y Avanzar a Reconteo R1?',
                                    message: stage === 0
                                        ? 'Al iniciar el ciclo se resetearán las capturas previas para comenzar el nuevo conteo general.'
                                        : 'Al concluir la Fase 1 se consolidarán las capturas actuales y se generará automáticamente la lista de reconteo (R1) para los ítems con diferencias o faltantes.',
                                    label: stage === 0 ? 'Iniciar Fase 1' : stage === 1 ? 'Concluir Fase 1' : 'Fase Completada',
                                    enabled: stage === 0 || stage === 1
                                },
                                {
                                    s: 2,
                                    t: 'FASE 2: RECONTEO R1',
                                    d: 'Cálculo de diferencias de Fase 1 y verificación de discrepancias en campo.',
                                    actionUrl: '/api/admin/inventory/advance_stage/3',
                                    title: '¿Concluir Fase 2 (Reconteo R1)?',
                                    message: 'Al concluir la Fase 2 se evaluarán las diferencias persistentes y se generará la lista de reconteo R2 para la Fase 3.',
                                    label: stage < 2 ? 'En Espera' : stage === 2 ? 'Concluir Fase 2' : 'Fase Completada',
                                    enabled: stage === 2
                                },
                                {
                                    s: 3,
                                    t: 'FASE 3: RECONTEO R2',
                                    d: 'Segunda validación enfocada en discrepancias persistentes.',
                                    actionUrl: '/api/admin/inventory/advance_stage/4',
                                    title: '¿Concluir Fase 3 (Reconteo R2)?',
                                    message: 'Al concluir la Fase 3 se pasará a la Fase 4 de Auditoría y Cierre Final.',
                                    label: stage < 3 ? 'En Espera' : stage === 3 ? 'Concluir Fase 3' : 'Fase Completada',
                                    enabled: stage === 3
                                },
                                {
                                    s: 4,
                                    t: 'FASE 4: AUDITORÍA FINAL',
                                    d: 'Validación técnica final e informe consolidado previa al cierre del ejercicio.',
                                    actionUrl: '/admin/inventory/report',
                                    isDownload: true,
                                    title: '¿Generar Informe de Cierre (Fase 4)?',
                                    message: 'Se consolidará y descargará el informe final maestro W2W en Excel con los conteos y diferencias de todas las etapas.',
                                    label: stage < 4 ? 'En Espera' : stage === 4 ? 'Informe de Cierre' : 'Fase Completada',
                                    enabled: stage === 4
                                }
                            ].map((item) => {
                                const isItemProcessing = loading && processingAction === item.actionUrl;
                                return (
                                <div key={item.s} className={`p-4 rounded border bg-white shadow-sm transition-all ${stage === item.s ? 'border-[#0067c0] ring-1 ring-[#0067c0]' : 'border-[#d1d5db] opacity-80'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="text-[12px] font-normal text-[#1f1f1f] m-0">{item.t}</h3>
                                         <span className={`text-[11px] font-normal px-2 py-0.5 rounded ${
                                             stage === item.s
                                                 ? 'bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0]'
                                                 : stage > item.s
                                                 ? 'bg-[#f3f4f6] text-[#1f1f1f] border border-[#d1d5db]'
                                                 : 'bg-[#f9fafb] text-[#8c8c8c] border border-[#e5e7eb]'
                                         }`}>
                                             {stage === item.s ? 'Activo' : stage > item.s ? 'Completado' : `Fase 0${item.s}`}
                                         </span>
                                    </div>
                                    <p className="text-[11.5px] text-[#5c5c5c] mb-4 leading-relaxed font-normal">{item.d}</p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (item.isDownload) {
                                                    window.location.href = item.actionUrl;
                                                } else {
                                                    openConfirmModal(item.actionUrl, item.title, item.message);
                                                }
                                            }}
                                            disabled={loading || !item.enabled}
                                            className={`flex-1 h-7 text-[12px] font-normal rounded transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                                                isItemProcessing
                                                    ? 'bg-[#005a9e] text-white shadow-xs cursor-wait'
                                                    : stage === item.s
                                                    ? 'bg-[#0067c0] text-white hover:bg-[#005a9e] shadow-xs'
                                                    : 'bg-[#f3f4f6] text-[#8c8c8c] border border-[#d1d5db] disabled:opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            {isItemProcessing ? (
                                                <>
                                                    <svg className="animate-spin h-3.5 w-3.5 text-white shrink-0" viewBox="0 0 24 24" fill="none">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                    <span>Procesando...</span>
                                                </>
                                            ) : (
                                                item.label
                                            )}
                                        </button>
                                        {stage >= item.s && !item.isDownload && (
                                            <button
                                                onClick={() => {
                                                    if (item.s === 1) {
                                                        window.location.href = '/api/export_counts?stage=1';
                                                    } else {
                                                        window.location.href = `/api/export_recount_list/${item.s}`;
                                                    }
                                                }}
                                                title={`Descargar Listado / Registro de Fase ${item.s}`}
                                                className="h-7 px-2.5 border border-[#d1d5db] rounded bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] font-normal text-[11.5px] shadow-xs cursor-pointer"
                                            >
                                                Excel
                                            </button>
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                        </div>

                        <div className={`p-4 rounded border border-dashed transition-all ${stage === 4 ? 'border-[#0067c0] bg-white' : 'border-[#d1d5db] bg-white opacity-60'}`}>
                             <div className="flex flex-col items-center text-center">
                                <h3 className="text-[13px] font-normal text-[#1f1f1f] mb-1">Finalización y Cierre del Ejercicio</h3>
                                <p className="text-[11.5px] text-[#5c5c5c] font-normal mb-3">Cierre definitivo de registros y reinicio para un nuevo ciclo</p>
                                <div className="flex gap-3 w-full max-w-sm">
                                    <button
                                        onClick={() => window.location.href = `/admin/inventory/report`}
                                        disabled={stage !== 4 || loading}
                                        className="flex-1 h-7 bg-white border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded hover:bg-[#f5f5f5] disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
                                    >
                                        Reporte Excel
                                    </button>
                                    <button
                                        onClick={() => openConfirmModal(
                                            '/api/admin/inventory/finalize',
                                            '¿Cerrar y Reiniciar Ciclo de Inventario?',
                                            'ATENCIÓN: Esta acción finalizará el ejercicio activo, congelará la base de datos actual y reiniciará el sistema a estado inicial (Fase 0) para un nuevo inventario. ¿Desea proceder?'
                                        )}
                                        disabled={loading || stage !== 4}
                                        className="flex-1 h-7 bg-[#0067c0] text-white text-[12px] font-normal rounded hover:bg-[#005a9e] disabled:opacity-50 transition-colors shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        {loading && processingAction === '/api/admin/inventory/finalize' ? (
                                            <>
                                                <svg className="animate-spin h-3.5 w-3.5 text-white shrink-0" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                <span>Cerrando Ciclo...</span>
                                            </>
                                        ) : (
                                            'Cerrar Ciclo'
                                        )}
                                    </button>
                                </div>
                             </div>
                        </div>
                    </div>

                    {/* Resumen Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white p-4 rounded shadow-sm border border-[#d1d5db] sticky top-4">
                            <h2 className="text-[13px] font-normal text-[#1f1f1f] mb-3 border-b border-[#e5e7eb] pb-2">Estado del Inventario</h2>
                            {!stats ? (
                                <div className="text-center py-4 text-[#5c5c5c] text-[12px]">Cargando estadísticas...</div>
                            ) : (
                                <div className="space-y-3">
                                    <div>
                                        <div className="text-[11px] text-[#5c5c5c] font-normal mb-0.5">Items Registrados</div>
                                        <div className="text-[20px] font-normal text-[#1f1f1f] font-mono">{stats.items_count}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-[#5c5c5c] font-normal mb-0.5">Registros de Campo</div>
                                        <div className="text-[20px] font-normal text-[#1f1f1f] font-mono">{stats.total_counts}</div>
                                    </div>
                                    <div className="pt-3 border-t border-[#e5e7eb]">
                                        <div className="text-[11px] text-[#5c5c5c] font-normal mb-0.5">Fase Activa</div>
                                        <div className="text-[13px] font-normal text-[#0067c0]">
                                            {stats.current_stage === 0 ? 'Sin Iniciar' : `Fase ${stats.current_stage}`}
                                        </div>
                                    </div>
                                    <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                                        {stats?.stages && Object.entries(stats.stages).map(([sNum, sStats]) => (
                                            <div key={sNum} className="flex justify-between items-center text-[11.5px] py-0.5 border-b border-[#f3f4f6]">
                                                <span className="text-[#5c5c5c] font-normal">Stage 0{sNum} Precisión</span>
                                                <span className="font-mono font-normal text-[#1f1f1f]">{sStats.accuracy}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}



            {activeTab === 'reconciliation' && (
                <div className="space-y-4">
                    <div>
                        {/* Panel de Conciliación Principal */}
                        <div className="w-full">
                            <div className="bg-white shadow-sm rounded border border-[#d1d5db] overflow-hidden">
                                <div className="bg-[#f8f9fa] px-3 py-2 border-b border-[#d1d5db] flex flex-col md:flex-row md:justify-between md:items-center gap-2">
                                    <div className="flex gap-2 flex-1 items-center">
                                        <input
                                            type="text"
                                            placeholder="Buscar SKU, descripción o ubicación..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="h-7 flex-1 max-w-[350px] border border-[#d1d5db] rounded px-2 text-[12px] bg-white outline-none focus:border-[#0067c0] text-[#1f1f1f] placeholder-[#8c8c8c]"
                                        />
                                        <div className="flex gap-1.5">
                                            <button
                                                onClick={() => setReconFilter('counted')}
                                                className={`h-7 px-2.5 text-[11.5px] font-normal rounded border transition-colors cursor-pointer ${
                                                    reconFilter === 'counted'
                                                        ? 'bg-[#354a5f] border-[#354a5f] text-white'
                                                        : 'bg-white border-[#d1d5db] text-[#5c5c5c] hover:bg-[#f5f5f5]'
                                                }`}
                                            >
                                                Solo Contados ({reconItems.filter(i => i.is_counted || i.c1 !== null || i.c2 !== null || i.c3 !== null || i.c4 !== null).length})
                                            </button>
                                            <button
                                                onClick={() => setReconFilter('pending')}
                                                className={`h-7 px-2.5 text-[11.5px] font-normal rounded border transition-colors cursor-pointer ${
                                                    reconFilter === 'pending'
                                                        ? 'bg-[#354a5f] border-[#354a5f] text-white'
                                                        : 'bg-white border-[#d1d5db] text-[#5c5c5c] hover:bg-[#f5f5f5]'
                                                }`}
                                            >
                                                Con Diferencia ({reconItems.filter(i => i.status === 'PENDING' || i.status === 'PENDING_RECOUNT').length})
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={fetchReconciliation}
                                        disabled={reconLoading}
                                        className="h-7 px-3 border border-[#d1d5db] bg-white text-[#1f1f1f] hover:bg-[#f5f5f5] text-[12px] font-normal rounded transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                                    >
                                        {reconLoading ? 'Actualizando...' : 'Refrescar'}
                                    </button>
                                </div>

                                <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal sticky top-0 z-10 border-b border-[#2a3c4e]">
                                            <tr>
                                                {[
                                                    'Ítem',
                                                    'Descripción',
                                                    'Ubicación',
                                                    'Costo',
                                                    'Sist',
                                                    'Etapa 1',
                                                    'Etapa 2',
                                                    'Etapa 3',
                                                    'Etapa 4',
                                                    'Contado',
                                                    'Diff',
                                                    'Valor Diff',
                                                ].map((h, i) => (
                                                    <th
                                                        key={i}
                                                        className={`px-2.5 py-1.5 font-normal ${['Ítem', 'Descripción', 'Ubicación'].includes(h) ? 'text-left' : 'text-center'}`}
                                                    >
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#e5e7eb]">
                                            {reconItems
                                                .filter((item) => {
                                                    const matchQuery =
                                                        item.item_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                        item.bin_location.toLowerCase().includes(searchQuery.toLowerCase());

                                                    if (!matchQuery) return false;

                                                    if (reconFilter === 'pending') {
                                                        return item.status === 'PENDING' || item.status === 'PENDING_RECOUNT';
                                                    }
                                                    if (reconFilter === 'counted') {
                                                        return item.is_counted || item.c1 !== null || item.c2 !== null || item.c3 !== null || item.c4 !== null;
                                                    }
                                                    return true;
                                                })
                                                .map((item, idx) => (
                                                    <tr
                                                        key={item.item_code}
                                                        className={`hover:bg-[#edf3f9] transition-colors leading-none h-7 ${idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}
                                                    >
                                                        <td className="px-2.5 py-1 text-left text-[11.5px] font-normal text-[#0067c0] whitespace-nowrap">
                                                            {item.item_code}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-left text-[11.5px] font-normal text-[#5c5c5c] truncate max-w-[200px]" title={item.description}>
                                                            {item.description}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-left text-[11.5px] font-mono text-[#5c5c5c] whitespace-nowrap">
                                                            {item.bin_location}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#1f1f1f]">
                                                            ${item.cost.toFixed(2)}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#1f1f1f]">
                                                            {item.system_qty}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#5c5c5c]">
                                                            {item.c1 !== null ? item.c1 : '-'}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#5c5c5c]">
                                                            {item.c2 !== null ? item.c2 : '-'}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#5c5c5c]">
                                                            {item.c3 !== null ? item.c3 : '-'}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#5c5c5c]">
                                                            {item.c4 !== null ? item.c4 : '-'}
                                                        </td>
                                                        <td className="px-2.5 py-1 text-center font-normal text-[11.5px] text-[#0067c0]">
                                                            {item.final_counted}
                                                        </td>
                                                        <td
                                                            className={`px-2.5 py-1 text-center font-normal text-[11.5px] ${
                                                                item.diff_qty > 0
                                                                    ? 'text-[#065f46]'
                                                                    : item.diff_qty < 0
                                                                    ? 'text-[#991b1b]'
                                                                    : 'text-[#8c8c8c]'
                                                            }`}
                                                        >
                                                            {item.diff_qty > 0 ? `+${item.diff_qty}` : item.diff_qty}
                                                        </td>
                                                        <td
                                                            className={`px-2.5 py-1 text-center font-normal text-[11.5px] ${
                                                                item.diff_val > 0
                                                                    ? 'text-[#065f46]'
                                                                    : item.diff_val < 0
                                                                    ? 'text-[#991b1b]'
                                                                    : 'text-[#8c8c8c]'
                                                            }`}
                                                        >
                                                            {item.diff_val > 0 ? `+$${item.diff_val.toFixed(2)}` : `$${item.diff_val.toFixed(2)}`}
                                                        </td>
                                                    </tr>
                                                ))}
                                            {reconItems.length === 0 && (
                                                <tr>
                                                    <td colSpan={12} className="text-center py-6 text-[#8c8c8c] italic text-[12px]">
                                                        No hay datos para mostrar en la etapa actual.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tab Asignación de Zonas */}
            {activeTab === 'zones' && (
                <div className="bg-white rounded border border-[#d1d5db] p-4 shadow-sm text-[#1f1f1f]">
                    <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#e5e7eb]">
                        <div>
                            <h2 className="text-[13px] font-normal text-[#1f1f1f] m-0">
                                Asignación de Zonas y Pasillos a Auditores
                            </h2>
                            <p className="text-[11px] text-[#5c5c5c] font-normal mt-0.5 mb-2">
                                Seleccione los pasillos autorizados para cada auditor en la matriz inferior.
                            </p>
                            <div className="p-2 bg-white border border-[#bae0ff] rounded text-[11px] text-[#0067c0] font-normal">
                                Nota: Si no se marca ningún pasillo, el auditor mantiene acceso a todos los pasillos.
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal sticky top-0 z-10 border-b border-[#2a3c4e]">
                                <tr>
                                    <th className="px-3 py-1.5 font-normal">ID</th>
                                    <th className="px-3 py-1.5 font-normal">Usuario Auditor</th>
                                    <th className="px-3 py-1.5 font-normal">Pasillos Asignados</th>
                                    <th className="px-3 py-1.5 font-normal text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e5e7eb]">
                                {(auditorZones || []).map((userItem, idx) => {
                                    const currentStr = editedZones[userItem.id] ?? userItem.assigned_zones ?? '';
                                    const activeList = currentStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

                                    return (
                                        <tr key={userItem.id} className={`hover:bg-[#edf3f9] transition-colors ${idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}>
                                            <td className="px-3 py-2 font-mono text-[11.5px] text-[#5c5c5c]">{userItem.id}</td>
                                            <td className="px-3 py-2 font-normal text-[#1f1f1f] text-[12px]">{userItem.username}</td>
                                            <td className="px-3 py-2 space-y-1.5">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {availableAisles.map(aisle => {
                                                        const isChecked = activeList.includes(aisle.toUpperCase());
                                                        const toggleAisle = () => {
                                                            let newList;
                                                            if (isChecked) {
                                                                newList = activeList.filter(a => a !== aisle.toUpperCase());
                                                            } else {
                                                                newList = [...activeList, aisle.toUpperCase()];
                                                            }
                                                            setEditedZones({ ...editedZones, [userItem.id]: newList.join(', ') });
                                                        };

                                                        return (
                                                            <label
                                                                key={aisle}
                                                                className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors cursor-pointer text-[11px] font-mono select-none ${
                                                                    isChecked
                                                                        ? 'border-[#0067c0] bg-[#0067c0] text-white font-normal shadow-2xs'
                                                                        : 'border-[#d1d5db] bg-white text-[#1f1f1f] hover:bg-[#f5f5f5] font-normal'
                                                                }`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={toggleAisle}
                                                                    className="w-3 h-3 rounded border-[#d1d5db] text-[#0067c0] focus:ring-[#0067c0] cursor-pointer shrink-0"
                                                                />
                                                                <span className="whitespace-nowrap">{aisle}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <button
                                                    onClick={() => handleSaveZones(userItem.id)}
                                                    className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[11.5px] font-normal rounded shadow-xs transition-colors cursor-pointer"
                                                >
                                                    Guardar Pasillos
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {(auditorZones || []).length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="text-center py-6 text-[#8c8c8c] italic font-normal text-[12px]">
                                            No se encontraron usuarios auditores en el sistema.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {confirmModal.open && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white max-w-md w-full rounded border border-[#d1d5db] shadow-xl overflow-hidden text-[#1f1f1f]">
                        <div className="bg-[#354a5f] px-4 py-2.5 text-white flex justify-between items-center">
                            <h3 className="text-[13px] font-normal m-0 text-white">
                                {confirmModal.title}
                            </h3>
                            <button
                                onClick={() => !loading && setConfirmModal({ open: false, title: '', message: '', actionUrl: null })}
                                disabled={loading}
                                className="text-white hover:text-[#d1d5db] cursor-pointer disabled:opacity-40"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-[12px] text-[#1f1f1f] leading-relaxed mb-4 bg-[#f8f9fa] p-3 rounded border border-[#e5e7eb] font-normal">
                                {confirmModal.message}
                            </p>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setConfirmModal({ open: false, title: '', message: '', actionUrl: null })}
                                    disabled={loading}
                                    className="h-7 px-3 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => executeAction(confirmModal.actionUrl)}
                                    disabled={loading}
                                    className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded shadow-xs transition-colors cursor-pointer disabled:opacity-75 flex items-center justify-center gap-1.5 min-w-[120px]"
                                >
                                    {loading ? (
                                        <>
                                            <svg className="animate-spin h-3.5 w-3.5 text-white shrink-0" viewBox="0 0 24 24" fill="none">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span>Procesando...</span>
                                        </>
                                    ) : (
                                        <span>Confirmar y Concluir</span>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminInventory;
