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
        <div className="flex items-center justify-center min-h-[60vh] bg-[#f3f3f3] font-['Segoe_UI',Tahoma,sans-serif] text-[12px]">
            <div className="flex flex-col items-center gap-2 bg-white p-6 rounded border border-[#d1d5db] shadow-xs">
                <div className="w-6 h-6 border-2 border-[#0067c0] border-t-transparent rounded-full animate-spin"></div>
                <div className="text-gray-700 font-normal">Cargando 18 Indicadores Ejecutivos...</div>
            </div>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center min-h-[50vh] font-['Segoe_UI',Tahoma,sans-serif] text-[12px]">
            <div className="bg-red-50 text-red-800 p-4 rounded border border-red-200 text-center shadow-xs max-w-md">
                <div className="flex items-center justify-center gap-2 mb-1 text-red-700 font-normal">
                    <span>Error de Conexión o Carga</span>
                </div>
                <p className="text-gray-600 font-normal">{error}</p>
            </div>
        </div>
    );

    if (!stats || stats?.empty || !stats.eri) return (
        <div className="flex items-center justify-center min-h-[50vh] font-['Segoe_UI',Tahoma,sans-serif] text-[12px]">
            <div className="text-gray-700 bg-white p-6 rounded border border-[#d1d5db] shadow-xs text-center max-w-sm">
                <h3 className="text-sm font-normal text-gray-900 mb-1">Sin Registros de Conteos Cíclicos</h3>
                <p className="text-[11px] text-gray-500 font-normal">Realice auditorías o conteos cíclicos para visualizar los 18 KPIs en tiempo real.</p>
            </div>
        </div>
    );

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f] text-[12px] antialiased leading-normal">
            {/* Top Navigation & Control Header */}
            <div className="bg-white p-3 rounded border border-[#d1d5db] shadow-xs mb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <h1 className="text-[14px] font-normal text-gray-800 tracking-normal leading-tight">Tablero de Gestión de Inventarios</h1>
                        <span className="bg-[#edf3f9] text-[#0067c0] text-[11px] font-normal px-2 py-0.5 rounded border border-[#0067c0]/20">
                            18 KPIs Activos
                        </span>
                    </div>
                    <p className="text-[11px] text-gray-500 font-normal">Control ejecutivo de exactitud, cobertura, pareto de causas y exposición de riesgos</p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Navigation Tabs */}
                    <div className="flex items-center gap-1 bg-[#f8f9fa] p-1 rounded border border-[#d1d5db]">
                        <button
                            onClick={() => setActiveSection('kpis')}
                            className={`px-3 py-1 rounded text-[12px] font-normal transition-all cursor-pointer ${
                                activeSection === 'kpis'
                                    ? 'bg-white text-[#0067c0] shadow-xs border border-[#d1d5db]'
                                    : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            1. KPIs Prioritarios
                        </button>
                        <button
                            onClick={() => setActiveSection('process')}
                            className={`px-3 py-1 rounded text-[12px] font-normal transition-all cursor-pointer ${
                                activeSection === 'process'
                                    ? 'bg-white text-[#0067c0] shadow-xs border border-[#d1d5db]'
                                    : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            2. Control & Pareto
                        </button>
                        <button
                            onClick={() => setActiveSection('risk')}
                            className={`px-3 py-1 rounded text-[12px] font-normal transition-all cursor-pointer ${
                                activeSection === 'risk'
                                    ? 'bg-white text-[#0067c0] shadow-xs border border-[#d1d5db]'
                                    : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            3. Rotación & Riesgos
                        </button>
                    </div>

                    <button
                        onClick={fetchStats}
                        title="Actualizar datos"
                        className="h-7 px-2.5 text-gray-600 hover:text-gray-900 bg-white hover:bg-[#f5f5f5] rounded border border-[#d1d5db] transition-colors cursor-pointer text-[12px] font-normal"
                    >
                        Actualizar
                    </button>
                </div>
            </div>

            {/* SECCIÓN 1: KPIs PRIORITARIOS (TOP 8) */}
            {activeSection === 'kpis' && (
                <div className="space-y-3">
                    {/* Grid Principal de 4 Tarjetas */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* 1. ERI Global y Clase ABC */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[11px] font-normal text-gray-700 uppercase">1. ERI Global</span>
                                    <span className="text-[11px] font-normal text-gray-500">{stats.total_items} ítems</span>
                                </div>
                                <div className="flex items-baseline gap-1 my-1">
                                    <span className="text-2xl font-normal text-gray-900 leading-none">{stats.eri.Global}</span>
                                    <span className="text-sm font-normal text-gray-500">%</span>
                                </div>
                                <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden my-2">
                                    <div className="bg-[#0067c0] h-full rounded-full transition-all duration-500" style={{ width: `${stats.eri.Global}%` }}></div>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-[#f0f0f0] text-center">
                                <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb]">
                                    <span className="text-[10px] text-gray-500 block font-normal">Clase A</span>
                                    <span className="text-[11.5px] font-normal text-gray-900">{stats.eri.A || 80}%</span>
                                </div>
                                <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb]">
                                    <span className="text-[10px] text-gray-500 block font-normal">Clase B</span>
                                    <span className="text-[11.5px] font-normal text-gray-900">{stats.eri.B || 78}%</span>
                                </div>
                                <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb]">
                                    <span className="text-[10px] text-gray-500 block font-normal">Clase C</span>
                                    <span className="text-[11.5px] font-normal text-gray-900">{stats.eri.C || 82}%</span>
                                </div>
                            </div>
                        </div>

                        {/* 2. Cumplimiento del Programa */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[11px] font-normal text-gray-700 uppercase">2. Cumplimiento Plan</span>
                                    <span className="text-[11px] font-normal text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                                        {stats.compliance.pct}%
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-1 my-1">
                                    <span className="text-2xl font-normal text-gray-900 leading-none">{stats.compliance.counted}</span>
                                    <span className="text-[11px] text-gray-500 font-normal">/ {stats.compliance.planned} programados</span>
                                </div>
                                <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden my-2">
                                    <div className="bg-green-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.compliance.pct}%` }}></div>
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-500 font-normal leading-relaxed">Avance real sobre el programa estipulado de auditorías.</p>
                        </div>

                        {/* 3. Cobertura del Inventario */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[11px] font-normal text-gray-700 uppercase">3. Cobertura SKU</span>
                                    <span className="text-[11px] font-normal text-[#0067c0] bg-[#edf3f9] px-1.5 py-0.5 rounded border border-[#0067c0]/20">
                                        {stats.coverage.pct}%
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-1 my-1">
                                    <span className="text-2xl font-normal text-gray-900 leading-none">{stats.coverage.unique_skus_counted}</span>
                                    <span className="text-[11px] text-gray-500 font-normal">SKUs únicos ({stats.coverage.total_active_skus} activos)</span>
                                </div>
                                <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden my-2">
                                    <div className="bg-[#0067c0] h-full rounded-full transition-all duration-500" style={{ width: `${stats.coverage.pct}%` }}></div>
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-500 font-normal leading-relaxed">Garantiza diversidad de muestra sin repetir códigos.</p>
                        </div>

                        {/* 4 & 5. Exactitud por Unidades vs Valor Económico */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="text-[11px] font-normal text-gray-700 uppercase mb-2">
                                    4 & 5. Unidades vs Valor
                                </div>
                                <div className="space-y-2">
                                    <div>
                                        <div className="flex justify-between items-center text-[11px] mb-1">
                                            <span className="text-gray-600 font-normal">Exactitud Unidades:</span>
                                            <span className="font-normal text-gray-900">{stats.units_accuracy_pct}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-amber-600 h-full" style={{ width: `${stats.units_accuracy_pct}%` }}></div>
                                        </div>
                                    </div>

                                    <div className="pt-1.5 border-t border-[#f0f0f0]">
                                        <div className="flex justify-between items-center text-[11px] mb-1">
                                            <span className="text-gray-600 font-normal">Exactitud Financiera:</span>
                                            <span className="font-normal text-[#0067c0]">{stats.financial_accuracy_pct}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-[#0067c0] h-full" style={{ width: `${stats.financial_accuracy_pct}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Fila Secundaria de Métricas e Impacto Financiero */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        {/* 6. Valor Neto y Absoluto de Ajustes */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                            <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                6. Magnitud Financiera de Ajustes
                            </h2>
                            <div className="space-y-2">
                                <div className="bg-[#f8f9fa] p-2.5 rounded border border-[#e5e7eb]">
                                    <span className="text-[11px] font-normal text-gray-600 block mb-0.5">Ajuste Neto (Efecto Contable)</span>
                                    <div className={`text-xl font-normal leading-tight ${stats.adjustments.value.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                        {formatMoney(stats.adjustments.value.net)}
                                    </div>
                                    <div className="text-[11px] text-gray-500 font-normal mt-0.5">
                                        {stats.adjustments.units.net >= 0 ? '+' : ''}{stats.adjustments.units.net} Unidades Netas
                                    </div>
                                </div>

                                <div className="bg-[#f8f9fa] p-2.5 rounded border border-[#e5e7eb]">
                                    <span className="text-[11px] font-normal text-gray-600 block mb-0.5">Ajuste Absoluto (Exposición Total)</span>
                                    <div className="text-xl font-normal text-gray-900 leading-tight">
                                        {formatMoney(stats.adjustments.value.gross)}
                                    </div>
                                    <div className="text-[11px] text-gray-500 font-normal mt-0.5">
                                        {stats.adjustments.units.gross} Unidades Totales de Diferencia
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 7 & 8. Frecuencia y Magnitud por SKU */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs flex flex-col justify-between">
                            <div>
                                <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                    7 & 8. Frecuencia y Magnitud por SKU
                                </h2>
                                <div className="grid grid-cols-2 gap-2 mb-2.5">
                                    <div className="bg-[#f8f9fa] p-2 rounded border border-[#e5e7eb]">
                                        <span className="text-[11px] font-normal text-gray-600 block mb-0.5">Tasa Discrepancias</span>
                                        <span className="text-xl font-normal text-red-600">{stats.diff_rate_pct}%</span>
                                        <span className="text-[10.5px] text-gray-500 block font-normal mt-0.5">del total SKUs</span>
                                    </div>
                                    <div className="bg-[#f8f9fa] p-2 rounded border border-[#e5e7eb]">
                                        <span className="text-[11px] font-normal text-gray-600 block mb-0.5">Diferencia Promedio</span>
                                        <span className="text-xl font-normal text-gray-900">{stats.avg_diff_per_sku}</span>
                                        <span className="text-[10.5px] text-gray-500 block font-normal mt-0.5">unid / SKU erróneo</span>
                                    </div>
                                </div>

                                <div className="border-t border-[#f0f0f0] pt-2">
                                    <div className="flex justify-between items-center text-[11.5px]">
                                        <span className="font-normal text-gray-700">7. Tasa Reincidencia:</span>
                                        <span className="font-normal text-red-600">{stats.recurrency_rate_pct}%</span>
                                    </div>
                                    <p className="text-[11px] text-gray-500 font-normal mt-0.5">Referencias con fallas en múltiples auditorías.</p>
                                </div>
                            </div>
                        </div>

                        {/* 13. Tiempo de Resolución de Diferencias */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                            <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                13. Tiempo de Resolución & Casos
                            </h2>
                            <div className="mb-2 flex items-baseline gap-2">
                                <span className="text-2xl font-normal text-[#0067c0] leading-none">{stats.resolution_time.avg_days}</span>
                                <span className="text-[11px] text-gray-500 font-normal">días promedio de cierre</span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-2.5">
                                <div className="bg-amber-50 p-2 rounded border border-amber-200">
                                    <span className="text-[11px] font-normal text-amber-900 block mb-0.5">Casos Abiertos</span>
                                    <span className="text-base font-normal text-amber-950">{stats.resolution_time.open_cases}</span>
                                </div>
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                    <span className="text-[11px] font-normal text-green-900 block mb-0.5">Casos Cerrados</span>
                                    <span className="text-base font-normal text-green-950">{stats.resolution_time.resolved_cases}</span>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <span className="text-[11px] font-normal text-gray-600 block">Antigüedad de Casos Pendientes</span>
                                <div className="grid grid-cols-4 gap-1 text-center text-[10.5px]">
                                    <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb] font-normal text-gray-800">0-2d: {stats.resolution_time.aging['0_2_days']}</div>
                                    <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb] font-normal text-gray-800">3-7d: {stats.resolution_time.aging['3_7_days']}</div>
                                    <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb] font-normal text-gray-800">8-15d: {stats.resolution_time.aging['8_15_days']}</div>
                                    <div className="bg-[#f8f9fa] p-1 rounded border border-[#e5e7eb] font-normal text-gray-800">+15d: {stats.resolution_time.aging['over_15_days']}</div>
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
                        <div className="lg:col-span-2 bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                            <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                9. Pareto de Causas de Diferencias (Impacto en USD y Conteo)
                            </h2>

                            {stats.pareto_causes.length > 0 ? (
                                <div className="space-y-2">
                                    {stats.pareto_causes.map((c, i) => (
                                        <div key={i} className="bg-[#f8f9fa] p-2.5 rounded border border-[#e5e7eb]">
                                            <div className="flex justify-between items-center mb-1 text-[11.5px]">
                                                <span className="font-normal text-gray-900">{c.root_cause}</span>
                                                <div className="text-right">
                                                    <span className="font-normal text-[#0067c0] mr-2">{formatMoney(c.impact_usd)}</span>
                                                    <span className="text-[11px] font-normal bg-white text-gray-700 border border-[#d1d5db] px-1.5 py-0.5 rounded">
                                                        {c.count} casos ({c.pct}%)
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                                <div className="bg-[#0067c0] h-full rounded-full transition-all duration-500" style={{ width: `${c.pct}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-gray-500 text-[12px] font-normal bg-[#f8f9fa] rounded border border-dashed border-[#d1d5db]">
                                    No se han registrado causas aún. Asigne causas raíz en la tabla de discrepancias.
                                </div>
                            )}
                        </div>

                        {/* 11 & 12. First Count Accuracy & Reconteos */}
                        <div className="space-y-3">
                            <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                                <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                    11 & 12. Calidad Inicial de Conteo
                                </h2>
                                <div className="space-y-2.5 text-[11.5px]">
                                    <div>
                                        <div className="flex justify-between font-normal mb-1">
                                            <span className="text-gray-600">First Count Accuracy:</span>
                                            <span className="font-normal text-[#0067c0]">{stats.first_count_accuracy_pct}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-[#0067c0] h-full" style={{ width: `${stats.first_count_accuracy_pct}%` }}></div>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-[#f0f0f0]">
                                        <div className="flex justify-between font-normal mb-1">
                                            <span className="text-gray-600">Tasa de Reconteo:</span>
                                            <span className="font-normal text-amber-700">{stats.recount_rate_pct}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-amber-600 h-full" style={{ width: `${stats.recount_rate_pct}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 14. Productividad del Conteo */}
                            <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                                <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2">
                                    14. Productividad Operativa
                                </h2>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="text-2xl font-normal text-green-700 leading-none">{stats.productivity.rate}</span>
                                    <span className="text-[11px] text-gray-500 font-normal">SKU / Hora-Persona</span>
                                </div>
                                <p className="text-[11px] text-gray-500 font-normal mt-0.5">Total horas-hombre invertidas: {stats.productivity.total_person_hours} hrs</p>
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
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                            <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                16. Exactitud por Rotación
                            </h2>
                            <div className="space-y-1.5 text-[11.5px]">
                                {Object.entries(stats.rotation_accuracy).map(([rot, acc]) => (
                                    <div key={rot} className="flex justify-between items-center py-1 border-b border-[#f0f0f0]">
                                        <span className="font-normal text-gray-700 capitalize">{rot.replace('_', ' ')}:</span>
                                        <span className="font-normal text-gray-900 bg-[#f8f9fa] px-2 py-0.5 rounded border border-[#e5e7eb]">{acc}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 17. Inventario Negativo */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                            <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                17. Saldos Negativos de Inventario
                            </h2>
                            <div className="space-y-2 text-[11.5px]">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 font-normal">Casos Registrados:</span>
                                    <span className="font-normal text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">{stats.negative_stock.cases}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 font-normal">Tasa en Catálogo:</span>
                                    <span className="font-normal text-gray-900">{stats.negative_stock.rate_pct}%</span>
                                </div>
                                <div className="flex justify-between items-center pt-1.5 border-t border-[#f0f0f0]">
                                    <span className="text-gray-600 font-normal">Impacto en Valor:</span>
                                    <span className="font-normal text-red-600">{formatMoney(stats.negative_stock.value)}</span>
                                </div>
                            </div>
                        </div>

                        {/* 18. Exactitud por Criticidad Operativa */}
                        <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-xs">
                            <h2 className="text-[12px] font-normal text-gray-800 border-b border-[#f0f0f0] pb-2 mb-2.5">
                                18. Exactitud por Criticidad Operativa
                            </h2>
                            <div className="space-y-1.5 text-[11.5px]">
                                {Object.keys(stats.criticality_accuracy).length > 0 ? (
                                    Object.entries(stats.criticality_accuracy).map(([crit, acc]) => (
                                        <div key={crit} className="flex justify-between items-center py-1 border-b border-[#f0f0f0]">
                                            <span className="font-normal text-gray-700">{crit}:</span>
                                            <span className="font-normal text-[#0067c0] bg-[#edf3f9] px-2 py-0.5 rounded border border-[#0067c0]/20">{acc}%</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-[11px] text-gray-500 font-normal py-2">Todos los materiales clasificados como Estándar.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Top Discrepancies Table */}
                    <div className="bg-white rounded border border-[#d1d5db] shadow-xs overflow-hidden mt-3">
                        <div className="px-3 py-2 border-b border-[#2a3c4e] bg-[#354a5f] text-white flex justify-between items-center">
                            <h2 className="text-[12px] font-normal text-white">
                                Top Discrepancias Financieras & Asignación de Causa Raíz
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#354a5f] text-white text-[11px] font-normal border-b border-[#2a3c4e]">
                                        <th className="px-3 py-2 font-normal">Código Item</th>
                                        <th className="px-3 py-2 font-normal">Descripción</th>
                                        <th className="px-3 py-2 text-center font-normal">Diferencia</th>
                                        <th className="px-3 py-2 text-right font-normal">Impacto USD</th>
                                        <th className="px-3 py-2 font-normal">Causa Raíz</th>
                                        <th className="px-3 py-2 text-center font-normal">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="text-[11.5px]">
                                    {stats.top_losses.map((item, i) => (
                                        <tr key={i} className={`border-b border-[#f0f0f0] ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#edf3f9] transition-colors`}>
                                            <td className="px-3 py-2 font-normal text-gray-900 font-mono">{item.code}</td>
                                            <td className="px-3 py-2 text-gray-700 font-normal truncate max-w-[260px]">{item.desc}</td>
                                            <td className={`px-3 py-2 text-center font-mono font-normal ${item.diff > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                {item.diff > 0 ? '+' : ''}{item.diff}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-normal text-gray-900">
                                                {formatMoney(item.abs_val_diff)}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="inline-block bg-[#f8f9fa] text-gray-700 text-[11px] font-normal px-2 py-0.5 rounded border border-[#d1d5db]">
                                                    {item.root_cause}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <button
                                                    onClick={() => { setCauseModalItem(item); setSelectedCause(item.root_cause !== 'Sin causa determinada' ? item.root_cause : ROOT_CAUSES_LIST[0]); }}
                                                    className="h-6 px-2.5 text-[11px] font-normal text-[#0067c0] hover:text-[#005a9e] bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded transition-colors cursor-pointer"
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
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded max-w-md w-full border border-[#d1d5db] shadow-xl overflow-hidden">
                        <div className="bg-[#354a5f] text-white px-4 py-2.5 flex justify-between items-center border-b border-[#2a3c4e]">
                            <h3 className="text-[12px] font-normal text-white">Asignar Causa Raíz de Diferencia</h3>
                            <button onClick={() => setCauseModalItem(null)} className="text-gray-300 hover:text-white text-sm cursor-pointer">✕</button>
                        </div>
                        <div className="p-4 space-y-3">
                            <p className="text-[11.5px] text-gray-600">
                                Item: <span className="font-normal text-gray-900">{causeModalItem.code}</span> — Discrepancia: <span className="font-normal text-red-600">{causeModalItem.diff} unid</span>
                            </p>

                            <div>
                                <label className="text-[11px] font-normal text-gray-700 block mb-1">Seleccionar Causa Estandarizada</label>
                                <select
                                    value={selectedCause}
                                    onChange={(e) => setSelectedCause(e.target.value)}
                                    className="w-full bg-white border border-[#d1d5db] rounded h-7 px-2 text-[12px] font-normal text-gray-900 focus:border-[#0067c0] outline-none"
                                >
                                    {ROOT_CAUSES_LIST.map((cause) => (
                                        <option key={cause} value={cause}>{cause}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="px-4 py-2.5 bg-[#f8f9fa] border-t border-[#e5e7eb] flex justify-end gap-2">
                            <button
                                onClick={() => setCauseModalItem(null)}
                                className="h-7 px-3 rounded text-[12px] font-normal text-gray-700 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAssignCause}
                                disabled={updatingCause}
                                className="h-7 px-4 rounded text-[12px] font-normal text-white bg-[#0067c0] hover:bg-[#005a9e] transition-colors cursor-pointer disabled:opacity-50"
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
