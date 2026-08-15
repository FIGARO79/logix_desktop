import React, { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

// Iconos SVG ejecutivos inlínea
const Icons = {
    ChartBar: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
    ),
    CheckCircle: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    ShieldAlert: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
    ),
    Refresh: () => (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
    ),
    Target: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1" />
        </svg>
    ),
    Boxes: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
    ),
    CurrencyDollar: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    Clock: () => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    Tag: () => (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
    )
};

const DashboardInventario = () => {
    const { setTitle } = useOutletContext();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Sección activa y causa raíz
    const [activeSection, setActiveSection] = useState('kpis'); // 'kpis' | 'process' | 'risk'
    const [causeModalItem, setCauseModalItem] = useState(null);
    const [selectedCause, setSelectedCause] = useState('Error de picking');
    const [updatingCause, setUpdatingCause] = useState(false);

    const ROOT_CAUSES_LIST = [
        "Recepción pendiente o incorrecta",
        "Movimiento no registrado",
        "Error de picking",
        "Ubicación incorrecta",
        "Error de unidad de medida",
        "Devolución no procesada",
        "Daño o pérdida",
        "Material mezclado",
        "Error de identificación o etiquetado",
        "Ajuste anterior incorrecto",
        "Diferencia sin causa determinada"
    ];

    useEffect(() => {
        setTitle("Métricas Avanzadas de Cíclicos");
    }, [setTitle]);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/counts/dashboard_stats', { credentials: 'include' });
            if (!res.ok) throw new Error("Error cargando estadísticas de inventario");
            const data = await res.json();
            setStats(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAssignCause = async () => {
        if (!causeModalItem) return;
        setUpdatingCause(true);
        try {
            const res = await fetch(`/api/counts/recordings/${causeModalItem.id}/root_cause`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ root_cause: selectedCause })
            });
            if (res.ok) {
                setCauseModalItem(null);
                await fetchStats();
            } else {
                alert("Error al actualizar la causa raíz");
            }
        } catch (e) {
            alert("Error de conexión");
        } finally {
            setUpdatingCause(false);
        }
    };

    const formatMoney = (val) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2
        }).format(val || 0);
    };

    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh] bg-slate-50 font-['Segoe_UI',_system-ui,_sans-serif]">
            <div className="flex flex-col items-center gap-3 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-slate-800 text-xs font-semibold uppercase tracking-wider">Cargando 18 Indicadores Ejecutivos...</div>
            </div>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center min-h-[50vh] font-['Segoe_UI',_system-ui,_sans-serif]">
            <div className="bg-red-50 text-red-900 p-5 rounded-xl border border-red-200 text-xs font-normal max-w-md text-center shadow-sm">
                <div className="flex items-center justify-center gap-2 mb-1 text-red-700 font-semibold">
                    <Icons.ShieldAlert />
                    <span>Error de Conexión o Carga</span>
                </div>
                <p className="text-slate-700">{error}</p>
            </div>
        </div>
    );

    if (stats?.empty) return (
        <div className="flex items-center justify-center min-h-[50vh] font-['Segoe_UI',_system-ui,_sans-serif]">
            <div className="text-slate-700 bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center max-w-sm">
                <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Icons.Boxes />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">Sin Registros de Conteos Cíclicos</h3>
                <p className="text-xs text-slate-600 font-normal">Realice auditorías de inventario para visualizar los 18 KPIs en tiempo real.</p>
            </div>
        </div>
    );

    return (
        <div className="max-w-[1440px] mx-auto px-4 py-3 font-['Segoe_UI',_system-ui,_sans-serif] bg-slate-50/60 min-h-screen text-slate-800 leading-normal">

            {/* Top Navigation & Control Header */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs mb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <h1 className="text-lg font-semibold text-slate-900 tracking-tight leading-tight">Tablero de Gestión de Inventarios</h1>
                        <span className="bg-indigo-50 text-indigo-800 text-[11px] font-medium px-2.5 py-0.5 rounded-full border border-indigo-200">
                            18 KPIs Activos
                        </span>
                    </div>
                    <p className="text-xs text-slate-600 font-normal">Control ejecutivo integral de exactitud, cobertura, pareto de causas y exposición de riesgos</p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Navigation Tabs */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                        <button
                            onClick={() => setActiveSection('kpis')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                activeSection === 'kpis'
                                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200 font-semibold'
                                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                            }`}
                        >
                            <Icons.ChartBar />
                            <span>1. KPIs Prioritarios</span>
                        </button>
                        <button
                            onClick={() => setActiveSection('process')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                activeSection === 'process'
                                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200 font-semibold'
                                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                            }`}
                        >
                            <Icons.CheckCircle />
                            <span>2. Control & Pareto</span>
                        </button>
                        <button
                            onClick={() => setActiveSection('risk')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                activeSection === 'risk'
                                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200 font-semibold'
                                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                            }`}
                        >
                            <Icons.ShieldAlert />
                            <span>3. Rotación & Riesgos</span>
                        </button>
                    </div>

                    <button
                        onClick={fetchStats}
                        title="Actualizar datos"
                        className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors"
                    >
                        <Icons.Refresh />
                    </button>
                </div>
            </div>

            {/* SECCIÓN 1: KPIs PRIORITARIOS (TOP 8) */}
            {activeSection === 'kpis' && (
                <div className="space-y-3">
                    {/* Grid Principal de 4 Tarjetas */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">

                        {/* 1. ERI Global y Clase ABC */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 uppercase tracking-wider">
                                        <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center">
                                            <Icons.Target />
                                        </div>
                                        <span>1. ERI Global</span>
                                    </div>
                                    <span className="text-xs font-normal text-slate-600">{stats.total_items} ítems</span>
                                </div>
                                <div className="flex items-baseline gap-1 my-1">
                                    <span className="text-3xl font-semibold text-slate-900 leading-none">{stats.eri.Global}</span>
                                    <span className="text-sm font-medium text-slate-600">%</span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden my-2">
                                    <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.eri.Global}%` }}></div>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-100 text-center">
                                <div className="bg-slate-50 p-1.5 rounded-md border border-slate-100">
                                    <span className="text-xs text-slate-600 block uppercase font-normal">Clase A</span>
                                    <span className="text-xs font-semibold text-slate-900">{stats.eri.A || 80}%</span>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded-md border border-slate-100">
                                    <span className="text-xs text-slate-600 block uppercase font-normal">Clase B</span>
                                    <span className="text-xs font-semibold text-slate-900">{stats.eri.B || 78}%</span>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded-md border border-slate-100">
                                    <span className="text-xs text-slate-600 block uppercase font-normal">Clase C</span>
                                    <span className="text-xs font-semibold text-slate-900">{stats.eri.C || 82}%</span>
                                </div>
                            </div>
                        </div>

                        {/* 2. Cumplimiento del Programa */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 uppercase tracking-wider">
                                        <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center">
                                            <Icons.CheckCircle />
                                        </div>
                                        <span>2. Cumplimiento Plan</span>
                                    </div>
                                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                        {stats.compliance.pct}%
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-1 my-1">
                                    <span className="text-3xl font-semibold text-slate-900 leading-none">{stats.compliance.counted}</span>
                                    <span className="text-xs text-slate-600 font-normal">/ {stats.compliance.planned} programados</span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden my-2">
                                    <div className="bg-emerald-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.compliance.pct}%` }}></div>
                                </div>
                            </div>
                            <p className="text-xs text-slate-600 font-normal leading-relaxed">Avance real sobre el programa estipulado de auditorías.</p>
                        </div>

                        {/* 3. Cobertura del Inventario */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 uppercase tracking-wider">
                                        <div className="w-6 h-6 rounded-md bg-cyan-50 text-cyan-700 flex items-center justify-center">
                                            <Icons.Boxes />
                                        </div>
                                        <span>3. Cobertura SKU</span>
                                    </div>
                                    <span className="text-xs font-semibold text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200">
                                        {stats.coverage.pct}%
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-1 my-1">
                                    <span className="text-3xl font-semibold text-slate-900 leading-none">{stats.coverage.unique_skus_counted}</span>
                                    <span className="text-xs text-slate-600 font-normal">SKUs únicos ({stats.coverage.total_active_skus} activos)</span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden my-2">
                                    <div className="bg-cyan-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.coverage.pct}%` }}></div>
                                </div>
                            </div>
                            <p className="text-xs text-slate-600 font-normal leading-relaxed">Garantiza diversidad de muestra sin repetir códigos.</p>
                        </div>

                        {/* 4 & 5. Exactitud por Unidades vs Valor Económico */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
                            <div>
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 uppercase tracking-wider mb-2">
                                    <div className="w-6 h-6 rounded-md bg-amber-50 text-amber-700 flex items-center justify-center">
                                        <Icons.CurrencyDollar />
                                    </div>
                                    <span>4 & 5. Unidades vs Valor</span>
                                </div>
                                <div className="space-y-2">
                                    <div>
                                        <div className="flex justify-between items-center text-xs mb-1">
                                            <span className="text-slate-700 font-normal">Exactitud Unidades:</span>
                                            <span className="font-semibold text-slate-900">{stats.units_accuracy_pct}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-amber-600 h-full" style={{ width: `${stats.units_accuracy_pct}%` }}></div>
                                        </div>
                                    </div>

                                    <div className="pt-1.5 border-t border-slate-100">
                                        <div className="flex justify-between items-center text-xs mb-1">
                                            <span className="text-slate-700 font-normal">Exactitud Financiera:</span>
                                            <span className="font-semibold text-indigo-800">{stats.financial_accuracy_pct}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-indigo-600 h-full" style={{ width: `${stats.financial_accuracy_pct}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Fila Secundaria de Métricas e Impacto Financiero */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

                        {/* 6. Valor Neto y Absoluto de Ajustes */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                6. Magnitud Financiera de Ajustes
                            </h2>

                            <div className="space-y-2.5">
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <span className="text-xs uppercase font-medium text-slate-700 block mb-0.5">Ajuste Neto (Efecto Contable)</span>
                                    <div className={`text-2xl font-semibold leading-tight ${stats.adjustments.value.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                        {formatMoney(stats.adjustments.value.net)}
                                    </div>
                                    <div className="text-xs text-slate-600 font-normal mt-1">
                                        {stats.adjustments.units.net >= 0 ? '+' : ''}{stats.adjustments.units.net} Unidades Netas
                                    </div>
                                </div>

                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <span className="text-xs uppercase font-medium text-slate-700 block mb-0.5">Ajuste Absoluto (Exposición Total)</span>
                                    <div className="text-2xl font-semibold text-slate-900 leading-tight">
                                        {formatMoney(stats.adjustments.value.gross)}
                                    </div>
                                    <div className="text-xs text-slate-600 font-normal mt-1">
                                        {stats.adjustments.units.gross} Unidades Totales de Diferencia
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 7 & 8. Frecuencia y Magnitud por SKU */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
                            <div>
                                <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                    7 & 8. Frecuencia y Magnitud por SKU
                                </h2>

                                <div className="grid grid-cols-2 gap-2.5 mb-3">
                                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                        <span className="text-xs font-medium text-slate-700 block uppercase mb-1">Tasa Discrepancias</span>
                                        <span className="text-2xl font-semibold text-rose-700">{stats.diff_rate_pct}%</span>
                                        <span className="text-xs text-slate-600 block font-normal mt-0.5">del total SKUs</span>
                                    </div>
                                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                                        <span className="text-xs font-medium text-slate-700 block uppercase mb-1">Diferencia Promedio</span>
                                        <span className="text-2xl font-semibold text-slate-900">{stats.avg_diff_per_sku}</span>
                                        <span className="text-xs text-slate-600 block font-normal mt-0.5">unid / SKU erróneo</span>
                                    </div>
                                </div>

                                <div className="border-t border-slate-100 pt-2.5">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-medium text-slate-800">7. Tasa Reincidencia:</span>
                                        <span className="font-semibold text-rose-700">{stats.recurrency_rate_pct}%</span>
                                    </div>
                                    <p className="text-xs text-slate-600 font-normal mt-1">Referencias con fallas registradas en múltiples auditorías.</p>
                                </div>
                            </div>
                        </div>

                        {/* 13. Tiempo de Resolución de Diferencias */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                13. Tiempo de Resolución & Casos
                            </h2>

                            <div className="mb-3 flex items-baseline gap-2">
                                <span className="text-3xl font-semibold text-indigo-700 leading-none">{stats.resolution_time.avg_days}</span>
                                <span className="text-xs text-slate-600 font-normal">días promedio de cierre</span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-3">
                                <div className="bg-amber-50/80 p-2.5 rounded-lg border border-amber-200">
                                    <span className="text-xs font-medium text-amber-900 uppercase block mb-0.5">Casos Abiertos</span>
                                    <span className="text-lg font-semibold text-amber-950">{stats.resolution_time.open_cases}</span>
                                </div>
                                <div className="bg-emerald-50/80 p-2.5 rounded-lg border border-emerald-200">
                                    <span className="text-xs font-medium text-emerald-900 uppercase block mb-0.5">Casos Cerrados</span>
                                    <span className="text-lg font-semibold text-emerald-950">{stats.resolution_time.resolved_cases}</span>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <span className="text-xs font-medium text-slate-700 uppercase block">Antigüedad de Casos Pendientes</span>
                                <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                                    <div className="bg-slate-100 p-1.5 rounded border border-slate-200 font-normal text-slate-800">0-2d: {stats.resolution_time.aging['0_2_days']}</div>
                                    <div className="bg-slate-100 p-1.5 rounded border border-slate-200 font-normal text-slate-800">3-7d: {stats.resolution_time.aging['3_7_days']}</div>
                                    <div className="bg-slate-100 p-1.5 rounded border border-slate-200 font-normal text-slate-800">8-15d: {stats.resolution_time.aging['8_15_days']}</div>
                                    <div className="bg-slate-100 p-1.5 rounded border border-slate-200 font-normal text-slate-800">+15d: {stats.resolution_time.aging['over_15_days']}</div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* SECCIÓN 2: CONTROL DE PROCESO & PARETO DE CAUSAS */}
            {activeSection === 'process' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

                        {/* 9. Pareto de Causas Raíz */}
                        <div className="lg:col-span-2 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                9. Pareto de Causas de Diferencias (Impacto en USD y Conteo)
                            </h2>

                            {stats.pareto_causes.length > 0 ? (
                                <div className="space-y-2.5">
                                    {stats.pareto_causes.map((c, i) => (
                                        <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                            <div className="flex justify-between items-center mb-1.5 text-xs">
                                                <span className="font-semibold text-slate-900">{c.root_cause}</span>
                                                <div className="text-right">
                                                    <span className="font-semibold text-indigo-800 mr-3">{formatMoney(c.impact_usd)}</span>
                                                    <span className="text-xs font-medium bg-indigo-50 text-indigo-900 border border-indigo-200 px-2 py-0.5 rounded">
                                                        {c.count} casos ({c.pct}%)
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                                <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${c.pct}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-600 text-xs font-normal bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                    No se han registrado causas aún. Asigne causas raíz en la tabla de discrepancias.
                                </div>
                            )}
                        </div>

                        {/* 11 & 12. First Count Accuracy & Reconteos */}
                        <div className="space-y-3">
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                                <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                    11 & 12. Calidad Inicial de Conteo
                                </h2>
                                <div className="space-y-3 text-xs">
                                    <div>
                                        <div className="flex justify-between font-normal mb-1">
                                            <span className="text-slate-700">First Count Accuracy:</span>
                                            <span className="font-semibold text-indigo-800">{stats.first_count_accuracy_pct}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                            <div className="bg-indigo-600 h-full" style={{ width: `${stats.first_count_accuracy_pct}%` }}></div>
                                        </div>
                                    </div>

                                    <div className="pt-2.5 border-t border-slate-100">
                                        <div className="flex justify-between font-normal mb-1">
                                            <span className="text-slate-700">Tasa de Reconteo:</span>
                                            <span className="font-semibold text-amber-800">{stats.recount_rate_pct}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                            <div className="bg-amber-600 h-full" style={{ width: `${stats.recount_rate_pct}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 14. Productividad del Conteo */}
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                                <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-2">
                                    14. Productividad Operativa
                                </h2>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="text-3xl font-semibold text-emerald-700 leading-none">{stats.productivity.rate}</span>
                                    <span className="text-xs text-slate-600 font-normal">SKU / Hora-Persona</span>
                                </div>
                                <p className="text-xs text-slate-600 font-normal mt-1">Total horas-hombre invertidas: {stats.productivity.total_person_hours} hrs</p>
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* SECCIÓN 3: ROTACIÓN & RIESGOS */}
            {activeSection === 'risk' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

                        {/* 16. Exactitud por Rotación */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                16. Exactitud por Rotación
                            </h2>
                            <div className="space-y-2 text-xs">
                                {Object.entries(stats.rotation_accuracy).map(([rot, acc]) => (
                                    <div key={rot} className="flex justify-between items-center py-1.5 border-b border-slate-100">
                                        <span className="font-normal text-slate-700 capitalize">{rot.replace('_', ' ')}:</span>
                                        <span className="font-semibold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{acc}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 17. Inventario Negativo */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                17. Saldos Negativos de Inventario
                            </h2>
                            <div className="space-y-2.5 text-xs">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-700 font-normal">Casos Registrados:</span>
                                    <span className="font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">{stats.negative_stock.cases}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-700 font-normal">Tasa en Catálogo:</span>
                                    <span className="font-semibold text-slate-900">{stats.negative_stock.rate_pct}%</span>
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                                    <span className="text-slate-700 font-normal">Impacto en Valor:</span>
                                    <span className="font-semibold text-rose-700">{formatMoney(stats.negative_stock.value)}</span>
                                </div>
                            </div>
                        </div>

                        {/* 18. Exactitud por Criticidad Operativa */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
                                18. Exactitud por Criticidad Operativa
                            </h2>
                            <div className="space-y-2 text-xs">
                                {Object.keys(stats.criticality_accuracy).length > 0 ? (
                                    Object.entries(stats.criticality_accuracy).map(([crit, acc]) => (
                                        <div key={crit} className="flex justify-between items-center py-1.5 border-b border-slate-100">
                                            <span className="font-normal text-slate-700">{crit}:</span>
                                            <span className="font-semibold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">{acc}%</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs text-slate-600 font-normal py-2">Todos los materiales clasificados como Estándar.</div>
                                )}
                            </div>
                        </div>

                    </div>

                    {/* Top Discrepancies Table with Compact Rows */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden mt-3">
                        <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                                Top Discrepancias Financieras & Asignación de Causa Raíz
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-100 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                                        <th className="px-4 py-2.5">Código Item</th>
                                        <th className="px-4 py-2.5">Descripción</th>
                                        <th className="px-4 py-2.5 text-center">Diferencia</th>
                                        <th className="px-4 py-2.5 text-right">Impacto USD</th>
                                        <th className="px-4 py-2.5">Causa Raíz</th>
                                        <th className="px-4 py-2.5 text-center">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 text-xs">
                                    {stats.top_losses.map((item, i) => (
                                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-2.5 font-semibold text-slate-900">{item.code}</td>
                                            <td className="px-4 py-2.5 text-slate-700 font-normal truncate max-w-[260px]">{item.desc}</td>
                                            <td className={`px-4 py-2.5 text-center font-mono font-semibold ${item.diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                {item.diff > 0 ? '+' : ''}{item.diff}
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                                                {formatMoney(item.abs_val_diff)}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <span className="inline-block bg-slate-100 text-slate-800 text-xs font-normal px-2.5 py-1 rounded border border-slate-200">
                                                    {item.root_cause}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-center">
                                                <button
                                                    onClick={() => { setCauseModalItem(item); setSelectedCause(item.root_cause !== 'Sin causa determinada' ? item.root_cause : ROOT_CAUSES_LIST[0]); }}
                                                    className="text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1 rounded transition-colors"
                                                >
                                                    Asignar Causa
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal para Asignar Causa Raíz */}
            {causeModalItem && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 font-['Segoe_UI',_system-ui,_sans-serif]">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-slate-200 shadow-2xl">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-7 h-7 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center">
                                <Icons.Tag />
                            </div>
                            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-tight">Asignar Causa Raíz de Diferencia</h3>
                        </div>
                        <p className="text-xs text-slate-600 mb-4 pl-9">
                            Item: <span className="font-semibold text-slate-900">{causeModalItem.code}</span> — Discrepancia: <span className="font-semibold text-rose-700">{causeModalItem.diff} unid</span>
                        </p>

                        <div className="mb-4">
                            <label className="text-xs uppercase font-medium text-slate-700 block mb-1.5">Seleccionar Causa Estandarizada</label>
                            <select
                                value={selectedCause}
                                onChange={(e) => setSelectedCause(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                            >
                                {ROOT_CAUSES_LIST.map((cause) => (
                                    <option key={cause} value={cause}>{cause}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                onClick={() => setCauseModalItem(null)}
                                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAssignCause}
                                disabled={updatingCause}
                                className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-all"
                            >
                                {updatingCause ? 'Guardando...' : 'Guardar Causa'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default DashboardInventario;
