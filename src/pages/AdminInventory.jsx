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
            setStats(data.stats);
            setStage(data.stage);
            if (data.settings) {
                setSettings(data.settings);
            }
        } catch (err) {
            setStats({
                total_items: 0,
                counted_items_count: 0,
                progress_percentage: 0,
                accuracy_percentage: 100
            });
            setStage(1);
        }
    }, []);

    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', actionUrl: null });

    const openConfirmModal = (actionUrl, title, message) => {
        setConfirmModal({ open: true, title, message, actionUrl });
    };

    const executeAction = async (actionUrl) => {
        setConfirmModal({ open: false, title: '', message: '', actionUrl: null });
        setLoading(true); setMessage(null); setError(null);
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
            setMessage(data.message);
            fetchStats();
            fetchReconciliation();
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('logix_events');
                bc.postMessage({ type: 'CYCLE_COUNT_MUTATED' });
                bc.close();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
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
                if (event.data?.type === 'CYCLE_COUNT_MUTATED') {
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
        <div className="max-w-[1400px] mx-auto px-6 pt-3 pb-6 font-sans bg-[#fcfcfc] min-h-screen text-black text-[12px]">

            {/* Barra de Acciones */}
            <div className="flex justify-end items-center mb-2 border-b border-zinc-100 pb-1.5 text-black">
                <div className="flex gap-3">
                    <button
                        onClick={() => window.location.href = `/admin/inventory/report`}
                        className="bg-white border border-black text-black text-[12px] px-2 py-1 rounded hover:bg-zinc-50 transition-colors font-normal shadow-sm cursor-pointer"
                    >
                        Exportar Conciliación
                    </button>
                </div>
            </div>

            {message && (
                <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-6 rounded-r shadow-sm text-[12px] font-normal uppercase tracking-tight flex justify-between items-center">
                    <span>{message}</span>
                    <button onClick={() => setMessage(null)} className="ml-4 font-bold text-green-800 hover:text-green-950 cursor-pointer">✕</button>
                </div>
            )}
            {error && (
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-r shadow-sm text-[12px] font-normal uppercase tracking-tight flex justify-between items-center">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-4 font-bold text-red-800 hover:text-red-950 cursor-pointer">✕</button>
                </div>
            )}

            {/* Tab Navigation */}
            <div className="flex border-b border-zinc-200 mb-6">
                <button
                    onClick={() => setActiveTab('cycle')}
                    className={`px-6 py-3 text-[12px] font-normal border-b-2 transition-colors ${activeTab === 'cycle' ? 'border-black text-black' : 'border-transparent text-black hover:text-black hover:border-zinc-300'}`}
                >
                    Fases del Inventario
                </button>
                <button
                    onClick={() => setActiveTab('reconciliation')}
                    className={`px-6 py-3 text-[12px] font-normal border-b-2 transition-colors ${activeTab === 'reconciliation' ? 'border-black text-black' : 'border-transparent text-black hover:text-black hover:border-zinc-300'}`}
                >
                    Estado de Inventario y Conciliación
                </button>
                <button
                    onClick={() => setActiveTab('zones')}
                    className={`px-6 py-3 text-[12px] font-normal border-b-2 transition-colors ${activeTab === 'zones' ? 'border-black text-black' : 'border-transparent text-black hover:text-black hover:border-zinc-300'}`}
                >
                    Asignación de Zonas por Auditor
                </button>
            </div>

            {activeTab === 'cycle' && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-3 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                    label: stage === 0 ? 'INICIAR FASE 1' : stage === 1 ? 'CONCLUIR FASE 1' : 'FASE COMPLETADA',
                                    enabled: stage === 0 || stage === 1
                                },
                                {
                                    s: 2,
                                    t: 'FASE 2: RECONTEO R1',
                                    d: 'Cálculo de diferencias de Fase 1 y verificación de discrepancias en campo.',
                                    actionUrl: '/api/admin/inventory/advance_stage/3',
                                    title: '¿Concluir Fase 2 (Reconteo R1)?',
                                    message: 'Al concluir la Fase 2 se evaluarán las diferencias persistentes y se generará la lista de reconteo R2 para la Fase 3.',
                                    label: stage < 2 ? 'EN ESPERA' : stage === 2 ? 'CONCLUIR FASE 2' : 'FASE COMPLETADA',
                                    enabled: stage === 2
                                },
                                {
                                    s: 3,
                                    t: 'FASE 3: RECONTEO R2',
                                    d: 'Segunda validación enfocada en discrepancias persistentes.',
                                    actionUrl: '/api/admin/inventory/advance_stage/4',
                                    title: '¿Concluir Fase 3 (Reconteo R2)?',
                                    message: 'Al concluir la Fase 3 se pasará a la Fase 4 de Auditoría y Cierre Final.',
                                    label: stage < 3 ? 'EN ESPERA' : stage === 3 ? 'CONCLUIR FASE 3' : 'FASE COMPLETADA',
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
                                    label: stage < 4 ? 'EN ESPERA' : stage === 4 ? 'INFORME DE CIERRE' : 'FASE COMPLETADA',
                                    enabled: stage === 4
                                }
                            ].map((item) => (
                                <div key={item.s} className={`p-6 border bg-white shadow-sm transition-all ${stage === item.s ? 'border-black ring-1 ring-black' : 'border-zinc-200 opacity-60'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <h3 className="text-[12px] font-normal text-black uppercase tracking-tight">{item.t}</h3>
                                         <span className={`text-[10px] font-normal px-2 py-0.5 rounded uppercase tracking-wider ${
                                             stage === item.s
                                                 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                                 : stage > item.s
                                                 ? 'bg-slate-100 text-black border border-slate-300'
                                                 : 'bg-zinc-50 text-zinc-500 border border-zinc-200'
                                         }`}>
                                             {stage === item.s ? '● ACTIVO' : stage > item.s ? '✓ COMPLETADO' : `FASE 0${item.s}`}
                                         </span>
                                    </div>
                                    <p className="text-[12px] text-black mb-6 leading-relaxed uppercase font-normal tracking-tight">{item.d}</p>
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
                                            className={`flex-1 h-8 text-[11px] font-normal uppercase tracking-widest rounded transition-colors cursor-pointer ${
                                                stage === item.s
                                                    ? 'bg-black text-white hover:bg-zinc-900 shadow-xs'
                                                    : 'bg-zinc-100 text-zinc-400 border border-zinc-200 disabled:opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            {item.label}
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
                                                className="px-3 border border-zinc-300 rounded bg-white hover:bg-zinc-100 text-black font-normal text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer"
                                            >
                                                ↓ Excel
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className={`p-8 border-2 border-dashed transition-all ${stage === 4 ? 'border-black bg-zinc-50/50' : 'border-zinc-100 bg-transparent opacity-40'}`}>
                             <div className="flex flex-col items-center text-center">
                                <h3 className="text-[12px] font-normal text-black mb-2 uppercase tracking-tight">Finalización y Cierre del Ejercicio</h3>
                                <p className="text-[12px] text-black uppercase font-normal tracking-widest mb-6">Cierre definitivo de registros y reinicio para un nuevo ciclo</p>
                                <div className="flex gap-4 w-full max-w-md">
                                    <button
                                        onClick={() => window.location.href = `/admin/inventory/report`}
                                        disabled={stage !== 4}
                                        className="flex-1 h-10 bg-white border border-zinc-300 text-black text-[11px] font-normal uppercase tracking-widest rounded hover:bg-zinc-50 disabled:opacity-50 transition-all shadow-xs cursor-pointer"
                                    >
                                        Reporte Excel
                                    </button>
                                    <button
                                        onClick={() => openConfirmModal(
                                            '/api/admin/inventory/finalize',
                                            '¿Cerrar y Reiniciar Ciclo de Inventario?',
                                            '⚠️ ATENCIÓN: Esta acción finalizará el ejercicio activo, congelará la base de datos actual y reiniciará el sistema a estado inicial (Fase 0) para un nuevo inventario. ¿Desea proceder?'
                                        )}
                                        disabled={loading || stage !== 4}
                                        className="flex-1 h-10 bg-black text-white text-[11px] font-normal uppercase tracking-widest rounded hover:bg-zinc-900 disabled:opacity-50 transition-all shadow-md cursor-pointer"
                                    >
                                        Cerrar Ciclo
                                    </button>
                                </div>
                             </div>
                        </div>
                    </div>

                    {/* Resumen Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded shadow-sm border border-zinc-200 sticky top-20">
                            <h2 className="text-[12px] font-normal text-black mb-4 border-b pb-2">Estado del Inventario</h2>
                            {!stats ? (
                                <div className="text-center py-6 text-black text-[12px]">Cargando estadísticas...</div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-[12px] text-black uppercase font-normal mb-1">Items Registrados</div>
                                        <div className="text-2xl font-normal text-black font-mono">{stats.items_count}</div>
                                    </div>
                                    <div>
                                        <div className="text-[12px] text-black uppercase font-normal mb-1">Registros de Campo</div>
                                        <div className="text-2xl font-normal text-black font-mono">{stats.total_counts}</div>
                                    </div>
                                    <div className="pt-4 border-t border-zinc-100">
                                        <div className="text-[12px] text-black uppercase font-normal mb-1">Fase Activa</div>
                                        <div className="text-sm font-normal text-black uppercase tracking-tight">
                                            {stats.current_stage === 0 ? 'Sin Iniciar' : `Fase ${stats.current_stage}`}
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-zinc-50 space-y-4">
                                        {stats?.stages && Object.entries(stats.stages).map(([sNum, sStats]) => (
                                            <div key={sNum} className="flex justify-between items-center text-[12px] group py-0.5 border-b border-transparent hover:border-zinc-100">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 group-hover:bg-black transition-colors"></span>
                                                    <span className="text-black group-hover:text-black transition-colors uppercase font-normal text-[12px]">Stage 0{sNum} Accuracy</span>
                                                </div>
                                                <span className="font-mono font-normal text-black text-[12px]">{sStats.accuracy}</span>
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
                <div className="space-y-6">
                    <div>
                        {/* Panel de Conciliación Principal */}
                        <div className="w-full">
                            <div className="bg-white shadow-sm rounded border border-zinc-200 overflow-hidden">
                                <div className="bg-[#f2f2f2] px-4 py-3 border-b border-zinc-200 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                                    <div className="flex gap-4 flex-1 items-center">
                                        <input
                                            type="text"
                                            placeholder="Buscar SKU, descripción o ubicación..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="h-8 flex-1 max-w-[400px] border border-zinc-300 rounded px-3 text-[12px] bg-white outline-none focus:ring-1 focus:ring-black placeholder-zinc-400 font-sans"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setReconFilter('counted')}
                                                className={`px-3 py-1 text-[10px] font-normal uppercase tracking-wider rounded border transition-colors ${
                                                    reconFilter === 'counted'
                                                        ? 'bg-zinc-800 border-zinc-800 text-white'
                                                        : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                                                }`}
                                            >
                                                Solo Contados ({reconItems.filter(i => i.is_counted || i.c1 !== null || i.c2 !== null || i.c3 !== null || i.c4 !== null).length})
                                            </button>
                                            <button
                                                onClick={() => setReconFilter('pending')}
                                                className={`px-3 py-1 text-[10px] font-normal uppercase tracking-wider rounded border transition-colors ${
                                                    reconFilter === 'pending'
                                                        ? 'bg-zinc-800 border-zinc-800 text-white'
                                                        : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                                                }`}
                                            >
                                                Con Diferencia ({reconItems.filter(i => i.status === 'PENDING' || i.status === 'PENDING_RECOUNT').length})
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={fetchReconciliation}
                                        disabled={reconLoading}
                                        className="h-8 px-4 border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 text-[10px] uppercase font-normal tracking-wider rounded transition-colors disabled:opacity-50"
                                    >
                                        {reconLoading ? 'ACTUALIZANDO...' : 'REFRESCAR'}
                                    </button>
                                </div>

                                <div className="overflow-x-auto max-h-[calc(100vh-320px)]">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-[#1e4a74] sticky top-0 z-10 shadow-sm text-white">
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
                                                        className={`px-2 py-1 text-[10px] font-normal uppercase tracking-wider ${['Ítem', 'Descripción', 'Ubicación'].includes(h) ? 'text-left' : 'text-center'}`}
                                                    >
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100">
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
                                                .map((item) => (
                                                    <tr
                                                        key={item.item_code}
                                                        className="hover:bg-[#f5f8fc] transition-colors leading-none h-6"
                                                    >
                                                        <td className="px-2 py-0.5 text-left text-[11px] font-normal text-zinc-900 tracking-tight uppercase whitespace-nowrap">
                                                            {item.item_code}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-left text-[11px] font-normal text-zinc-600 truncate max-w-[200px]" title={item.description}>
                                                            {item.description}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-left text-[11px] font-normal text-zinc-700 uppercase whitespace-nowrap">
                                                            {item.bin_location}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px]">
                                                            ${item.cost.toFixed(2)}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px] text-zinc-600 bg-zinc-50/50">
                                                            {item.system_qty}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px] text-zinc-500">
                                                            {item.c1 !== null ? item.c1 : '-'}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px] text-zinc-500">
                                                            {item.c2 !== null ? item.c2 : '-'}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px] text-zinc-500">
                                                            {item.c3 !== null ? item.c3 : '-'}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px] text-zinc-500">
                                                            {item.c4 !== null ? item.c4 : '-'}
                                                        </td>
                                                        <td className="px-2 py-0.5 text-center font-normal text-[10px] bg-zinc-50/50">
                                                            {item.final_counted}
                                                        </td>
                                                        <td
                                                            className={`px-2 py-0.5 text-center font-normal text-[10px] ${
                                                                item.diff_qty > 0
                                                                    ? 'text-green-600'
                                                                    : item.diff_qty < 0
                                                                    ? 'text-red-600'
                                                                    : 'text-zinc-400'
                                                            }`}
                                                        >
                                                            {item.diff_qty > 0 ? `+${item.diff_qty}` : item.diff_qty}
                                                        </td>
                                                        <td
                                                            className={`px-2 py-0.5 text-center font-normal text-[10px] ${
                                                                item.diff_val > 0
                                                                    ? 'text-green-600'
                                                                    : item.diff_val < 0
                                                                    ? 'text-red-600'
                                                                    : 'text-zinc-400'
                                                            }`}
                                                        >
                                                            {item.diff_val > 0 ? `+$${item.diff_val.toFixed(2)}` : `$${item.diff_val.toFixed(2)}`}
                                                        </td>
                                                    </tr>
                                                ))}
                                            {reconItems.length === 0 && (
                                                <tr>
                                                    <td colSpan={12} className="text-center py-8 text-zinc-400 italic">
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
                <div className="bg-white rounded-lg border border-zinc-200 p-6 shadow-xs text-black">
                    <div className="flex justify-between items-center mb-4 pb-3 border-b border-zinc-100">
                        <div>
                            <h2 className="text-sm font-normal text-black uppercase tracking-tight">
                                Asignación de Zonas y Pasillos a Auditores
                            </h2>
                            <p className="text-[11px] text-zinc-500 font-normal">
                                Seleccione los pasillos autorizados para cada auditor en la matriz inferior.
                            </p>
                            <div className="mt-2 p-2 bg-amber-50/80 border border-amber-200 rounded text-[11px] text-amber-900 font-normal">
                                📌 <strong>Nota:</strong> Si no se marca ningún pasillo, el auditor mantiene acceso a todos los pasillos.
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] text-black uppercase font-normal">
                                    <th className="p-3">ID</th>
                                    <th className="p-3">Usuario Auditor</th>
                                    <th className="p-3">Pasillos Asignados</th>
                                    <th className="p-3 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {(auditorZones || []).map((userItem) => {
                                    const currentStr = editedZones[userItem.id] ?? userItem.assigned_zones ?? '';
                                    const activeList = currentStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

                                    return (
                                        <tr key={userItem.id} className="hover:bg-zinc-50/60 transition-colors">
                                            <td className="p-3 font-mono text-[11px] text-zinc-500">{userItem.id}</td>
                                            <td className="p-3 font-normal text-black text-xs uppercase font-medium">{userItem.username}</td>
                                            <td className="p-3 space-y-2">
                                                {/* Lista compacta de pasillos oficiales con Checkboxes en una sola fila */}
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
                                                                className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors cursor-pointer text-[10px] font-mono select-none ${
                                                                    isChecked
                                                                        ? 'border-black bg-black text-white font-normal shadow-2xs'
                                                                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 font-normal'
                                                                }`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={toggleAisle}
                                                                    className="w-3 h-3 rounded border-zinc-300 text-black focus:ring-black cursor-pointer accent-black shrink-0"
                                                                />
                                                                <span className="whitespace-nowrap">{aisle}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </td>
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={() => handleSaveZones(userItem.id)}
                                                    className="px-4 py-1.5 bg-black hover:bg-zinc-800 text-white text-[11px] font-normal uppercase tracking-wider rounded shadow-2xs transition-all cursor-pointer"
                                                >
                                                    Guardar Pasillos
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {(auditorZones || []).length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="text-center py-8 text-zinc-400 italic font-normal">
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
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white max-w-md w-full rounded-xl shadow-xl border border-slate-200 p-5 text-black">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-base font-normal shrink-0">
                                ⚠️
                            </div>
                            <div>
                                <h3 className="text-xs font-normal text-black uppercase tracking-tight">
                                    {confirmModal.title}
                                </h3>
                                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">
                                    Confirmación de Transición de Fase
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-black leading-relaxed mb-5 bg-slate-50 p-3 rounded border border-slate-200 font-normal">
                            {confirmModal.message}
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmModal({ open: false, title: '', message: '', actionUrl: null })}
                                className="px-4 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-black text-[10px] font-normal uppercase tracking-wider rounded transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => executeAction(confirmModal.actionUrl)}
                                className="px-5 py-1.5 bg-black hover:bg-zinc-800 text-white text-[10px] font-normal uppercase tracking-wider rounded shadow-xs transition-all cursor-pointer"
                            >
                                Sí, Concluir Fase
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminInventory;
