import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

const Planner = () => {
    const { setTitle } = useOutletContext();
    // Estado de configuración y datos crudos
    const [config, setConfig] = useState({ start_date: '', end_date: '', holidays: [] });
    const [planDetails, setPlanDetails] = useState([]); // Lista plana de items
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState({ executed: {}, delta: {} }); // Placeholder para stats reales
    const [holidaysText, setHolidaysText] = useState('');

    const calculateDashboard = useCallback(() => {
        if (!planDetails.length) return;

        // 1. Conteos Únicos por Categoría (A, B, C)
        const uniqueItems = { A: new Set(), B: new Set(), C: new Set() };
        const monthly = {
            A: Array(12).fill(0),
            B: Array(12).fill(0),
            C: Array(12).fill(0)
        };

        planDetails.forEach(item => {
            // FIX: Access property with keys from JSON (with spaces)
            const cat = item["ABC Code"] || 'C';
            const code = item["Item Code"];
            const dateStr = item["Planned Date"];

            if (!dateStr) return;

            const date = new Date(dateStr);
            const month = date.getMonth(); // 0-11

            if (uniqueItems[cat]) uniqueItems[cat].add(code);
            if (monthly[cat]) monthly[cat][month]++;
        });

        const counts = {
            A: uniqueItems.A.size,
            B: uniqueItems.B.size,
            C: uniqueItems.C.size
        };

        // 2. Requeridos (Regla de negocio: A=3, B=2, C=1 ciclos al año)
        const req = {
            A: counts.A * 3,
            B: counts.B * 2,
            C: counts.C * 1
        };

        // 3. Días Hábiles
        let workingDays = 0;
        if (config.start_date && config.end_date) {
            const start = new Date(config.start_date);
            const end = new Date(config.end_date);
            const holidayFechas = holidaysText.split('\n').filter(d => d.trim()).map(d => new Date(d).toDateString());

            let cur = new Date(start);
            while (cur <= end) {
                const day = cur.getDay();
                if (day !== 0 && day !== 6 && !holidayFechas.includes(cur.toDateString())) {
                    workingDays++;
                }
                cur.setDate(cur.getDate() + 1);
            }
        }

        // 4. Totales Mensuales
        const monthlyTotal = Array(12).fill(0).map((_, i) => monthly.A[i] + monthly.B[i] + monthly.C[i]);

        setDashboardMetrics({
            counts,
            req,
            daily: {
                A: workingDays ? (req.A / workingDays).toFixed(1) : 0,
                B: workingDays ? (req.B / workingDays).toFixed(1) : 0,
                C: workingDays ? (req.C / workingDays).toFixed(1) : 0
            },
            workingDays,
            totalReq: req.A + req.B + req.C,
            totalDaily: workingDays ? ((req.A + req.B + req.C) / workingDays).toFixed(1) : 0,
            monthlyPlanned: { ...monthly, Total: monthlyTotal }
        });
    }, [planDetails, config, holidaysText]);

    useEffect(() => {
        setTitle("Planeación de Conteos");
    }, [setTitle]);

    // Estado calculado para el Dashboard
    const [dashboardMetrics, setDashboardMetrics] = useState({
        counts: { A: 0, B: 0, C: 0 },
        req: { A: 0, B: 0, C: 0 },
        daily: { A: 0, B: 0, C: 0 },
        workingDays: 0,
        totalReq: 0,
        totalDaily: 0,
        monthlyPlanned: {
            A: Array(12).fill(0),
            B: Array(12).fill(0),
            C: Array(12).fill(0),
            Total: Array(12).fill(0)
        }
    });

    // Carga inicial
    useEffect(() => {
        const loadInitialData = async () => {
            try {
                // 1. Configuración
                const resConfig = await fetch('/api/planner/config');
                if (resConfig.ok) {
                    const data = await resConfig.json();
                    setConfig(data);
                    setHolidaysText(data.holidays ? data.holidays.join('\n') : '');
                }

                // 2. Plan Actual (Items planos)
                const resPlan = await fetch('/api/planner/current_plan');
                if (resPlan.ok) {
                    const data = await resPlan.json();
                    // El endpoint devuelve objeto {details: []} usualmente si se guardó
                    const items = Array.isArray(data) ? data : (data.details || []);
                    setPlanDetails(items);
                }

                // 3. Ejecución (Stats)
                const resStats = await fetch('/api/planner/execution/stats');
                if (resStats.ok) {
                    const data = await resStats.json();
                    setStats(data);
                }

            } catch (error) {
                console.error("Error cargando datos planner:", error);
            }
        };
        loadInitialData();
    }, []);


    // Recalcular métricas cada vez que cambian los detalles del plan o las fechas
    useEffect(() => {
        calculateDashboard();
    }, [calculateDashboard]);

    const handleUpdatePlan = async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ start_date: config.start_date, end_date: config.end_date }).toString();
            const res = await fetch(`/api/planner/update_plan?${query}`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setPlanDetails(data.details || []); // FIX: data.details
                alert("Planificación actualizada correctamente.");
            } else {
                alert("Error al actualizar planificación.");
            }
        } catch (e) {
            alert("Error de conexión.");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveConfig = async () => {
        const holidaysArray = holidaysText.split('\n').map(l => l.trim()).filter(l => l);
        const newConfig = { ...config, holidays: holidaysArray };

        try {
            const res = await fetch('/api/planner/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });
            if (res.ok) {
                setConfig(newConfig);
                alert("Configuración guardada.");
                // trigger recalc via effect
            }
        } catch (e) {
            alert("Error guardando configuración.");
        }
    };

    // Helper para renderizar filas de tabla Excel
    const RenderRow = ({ label, data, isTotal = false }) => (
        <tr className={isTotal ? 'bg-[#f8f9fa]' : 'hover:bg-[#edf3f9]'}>
            <td className={`border border-[#d1d5db] px-3 py-1.5 text-left font-normal text-[11.5px] ${isTotal ? 'bg-[#f0f4f8] text-[#1f1f1f]' : 'text-[#1f1f1f]'}`}>{label}</td>
            {data && data.map((val, i) => (
                <td key={i} className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal text-[11.5px] text-[#1f1f1f]">{val}</td>
            ))}
            <td className={`border border-[#d1d5db] px-2 py-1.5 text-center font-normal text-[11.5px] ${isTotal ? 'bg-[#e2e8f0] text-[#1f1f1f]' : 'bg-[#f8f9fa] text-[#1f1f1f]'}`}>
                {data ? data.reduce((a, b) => a + b, 0) : 0}
            </td>
        </tr>
    );

    return (
        <div className="container-wrapper max-w-[1600px] mx-auto p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f] bg-[#f8f9fa] min-h-screen">

            {/* 1. Parámetros Generales */}
            <div className="bg-white p-4 rounded border border-[#d1d5db] shadow-sm mb-4">
                <div className="border-b border-[#e5e7eb] pb-2 mb-3">
                    <h2 className="text-[13px] font-normal text-[#1f1f1f] m-0">Parámetros Generales</h2>
                    <span className="text-[11px] font-normal text-[#5c5c5c]">Configuración de rango de fechas y cálculo de días hábiles</span>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Fecha Inicial</label>
                        <input
                            type="date"
                            className="h-7 px-2 border border-[#d1d5db] rounded text-[12px] font-normal text-[#1f1f1f] focus:border-[#0067c0] outline-none bg-white"
                            value={config.start_date}
                            onChange={e => setConfig({ ...config, start_date: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Fecha Final</label>
                        <input
                            type="date"
                            className="h-7 px-2 border border-[#d1d5db] rounded text-[12px] font-normal text-[#1f1f1f] focus:border-[#0067c0] outline-none bg-white"
                            value={config.end_date}
                            onChange={e => setConfig({ ...config, end_date: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Festivos (Calc)</label>
                        <input readOnly className="h-7 px-2 border border-[#d1d5db] rounded text-[12px] font-normal bg-[#f5f5f5] w-16 text-center text-[#5c5c5c]"
                            value={config.holidays ? config.holidays.length : 0} />
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            onClick={handleSaveConfig}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Guardar Fechas
                        </button>
                        <button
                            onClick={handleUpdatePlan}
                            disabled={loading}
                            className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                        >
                            {loading ? 'Calculando...' : 'Actualizar Planificación'}
                        </button>
                        <button
                            onClick={() => {
                                const params = new URLSearchParams({
                                    start_date: config.start_date,
                                    end_date: config.end_date
                                });
                                window.location.href = `/api/planner/generate_plan?${params.toString()}`;
                            }}
                            className="h-7 px-3 bg-[#354a5f] hover:bg-[#2a3c4e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Generar Excel
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. Link Ejecución */}
            <div className="bg-white p-4 rounded border border-[#d1d5db] shadow-sm mb-4 flex justify-between items-center">
                <div>
                    <h2 className="text-[13px] font-normal text-[#1f1f1f] m-0">Ejecución Diaria</h2>
                    <p className="text-[11px] text-[#5c5c5c] mt-0.5 mb-0">Accede a la interfaz de conteo ciego.</p>
                </div>
                <Link
                    to="/planner/execution"
                    className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded inline-flex items-center transition-colors shadow-sm no-underline"
                >
                    Ir a Pantalla de Conteo
                </Link>
            </div>

            {/* 3. Grid Layout: Resumen y Leyenda */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* Tabla Resumen ABC */}
                <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-sm">
                    <h3 className="text-[12px] font-normal text-[#1f1f1f] mb-2 pb-1.5 border-b border-[#e5e7eb]">Resumen Categorías (ABC)</h3>
                    <table className="w-full border-collapse text-[11.5px]">
                        <thead>
                            <tr className="bg-[#354a5f] text-white">
                                <th className="border border-[#2a3c4e] px-2 py-1.5 font-normal">Categoría</th>
                                <th className="border border-[#2a3c4e] px-2 py-1.5 font-normal">N° Items</th>
                                <th className="border border-[#2a3c4e] px-2 py-1.5 font-normal">Ciclos</th>
                                <th className="border border-[#2a3c4e] px-2 py-1.5 font-normal">Total Req</th>
                                <th className="border border-[#2a3c4e] px-2 py-1.5 font-normal">Items/Día</th>
                            </tr>
                        </thead>
                        <tbody className="text-[#1f1f1f]">
                            {['A', 'B', 'C'].map(cat => (
                                <tr key={cat} className="hover:bg-[#edf3f9]">
                                    <td className="border border-[#d1d5db] px-2 py-1 font-normal text-center">{cat}</td>
                                    <td className="border border-[#d1d5db] px-2 py-1 text-center bg-[#fafafa]">{dashboardMetrics.counts[cat]}</td>
                                    <td className="border border-[#d1d5db] px-2 py-1 text-center">{cat === 'A' ? 3 : cat === 'B' ? 2 : 1}</td>
                                    <td className="border border-[#d1d5db] px-2 py-1 text-center bg-[#fafafa]">{dashboardMetrics.req[cat]}</td>
                                    <td className="border border-[#d1d5db] px-2 py-1 text-center bg-[#fafafa]">{dashboardMetrics.daily[cat]}</td>
                                </tr>
                            ))}
                            <tr className="border-t border-[#d1d5db]">
                                <td colSpan="2" className="border border-[#d1d5db] px-2 py-1 font-normal text-right text-[#5c5c5c]">Días Útiles:</td>
                                <td colSpan="3" className="border border-[#d1d5db] px-2 py-1 font-normal bg-[#f8f9fa] text-center text-[#1f1f1f]">{dashboardMetrics.workingDays}</td>
                            </tr>
                            <tr>
                                <td colSpan="2" className="border border-[#d1d5db] px-2 py-1 font-normal text-right text-[#5c5c5c]">Total Requerido:</td>
                                <td colSpan="3" className="border border-[#d1d5db] px-2 py-1 font-normal bg-[#f8f9fa] text-center text-[#1f1f1f]">{dashboardMetrics.totalReq}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="bg-white p-3.5 rounded border border-[#d1d5db] shadow-sm">
                    <h3 className="text-[12px] font-normal text-[#1f1f1f] mb-2 pb-1.5 border-b border-[#e5e7eb]">Leyenda y Clasificación</h3>
                    <div className="flex gap-3">
                        <table className="w-auto border-collapse text-[11px] h-fit">
                            <thead>
                                <tr className="bg-[#354a5f] text-white">
                                    <th className="border border-[#2a3c4e] px-2 py-1 font-normal">Código</th>
                                    <th className="border border-[#2a3c4e] px-2 py-1 font-normal w-32">Criterio (Hits)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { c: 'W', h: 'Más de 30 hits' }, { c: 'X', h: '11-30 hits' },
                                    { c: 'Y', h: '7-10 hits' }, { c: 'K', h: '5-6 hits' },
                                    { c: 'L', h: '3-4 hits' }, { c: 'Z', h: '1-2 hits' }, { c: '0', h: 'Sin movimiento' }
                                ].map(r => (
                                    <tr key={r.c} className="hover:bg-[#edf3f9]">
                                        <td className="border border-[#d1d5db] px-2 py-0.5 font-normal text-center bg-[#fafafa]">{r.c}</td>
                                        <td className="border border-[#d1d5db] px-2 py-0.5 text-left whitespace-nowrap bg-white text-[#5c5c5c]">{r.h}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex-grow border border-[#d1d5db] rounded bg-white flex flex-col">
                            <div className="bg-[#f0f4f8] px-2 py-1 text-[11px] font-normal border-b border-[#d1d5db] text-center text-[#5c5c5c]">Festivos (AAAA-MM-DD)</div>
                            <textarea
                                className="w-full p-2 text-[11px] font-normal bg-transparent outline-none resize-none font-mono flex-grow"
                                value={holidaysText}
                                onChange={e => setHolidaysText(e.target.value)}
                                placeholder="2024-01-01&#10;2024-05-01"
                            ></textarea>
                        </div>
                    </div>
                </div>
            </div>

            {/* 4. Grids Mensuales */}
            <div className="space-y-4">
                {/* PLANEADO */}
                <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden">
                    <div className="bg-[#354a5f] text-white px-3 py-1.5">
                        <h3 className="text-[12px] font-normal text-white m-0">Planeado (Conteos Programados)</h3>
                    </div>
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full border-collapse text-[11.5px]">
                            <thead>
                                <tr className="bg-[#f0f4f8] text-[#1f1f1f]">
                                    <th className="border border-[#d1d5db] px-3 py-1.5 text-left font-normal min-w-[140px]">Categoría / Mes</th>
                                    {['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'].map(m => (
                                        <th key={m} className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal">{m}</th>
                                    ))}
                                    <th className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal">Total</th>
                                </tr>
                            </thead>
                            <tbody className="text-[#1f1f1f]">
                                <RenderRow label="A" data={dashboardMetrics.monthlyPlanned.A} />
                                <RenderRow label="B" data={dashboardMetrics.monthlyPlanned.B} />
                                <RenderRow label="C" data={dashboardMetrics.monthlyPlanned.C} />
                                <RenderRow label="TOTAL" data={dashboardMetrics.monthlyPlanned.Total} isTotal={true} />
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* EJECUTADO REAL */}
                <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden">
                    <div className="bg-[#354a5f] text-white px-3 py-1.5">
                        <h3 className="text-[12px] font-normal text-white m-0">Ejecutado (Real)</h3>
                    </div>
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full border-collapse text-[11.5px]">
                            <thead>
                                <tr className="bg-[#f0f4f8] text-[#1f1f1f]">
                                    <th className="border border-[#d1d5db] px-3 py-1.5 text-left font-normal min-w-[140px]">Categoría / Mes</th>
                                    {['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'].map(m => (
                                        <th key={m} className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal">{m}</th>
                                    ))}
                                    <th className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal">W2W</th>
                                </tr>
                            </thead>
                            <tbody className="text-[#1f1f1f]">
                                {stats.executed && (
                                    <>
                                        <RenderRow label="A" data={stats.executed.A || Array(12).fill(0)} />
                                        <RenderRow label="B" data={stats.executed.B || Array(12).fill(0)} />
                                        <RenderRow label="C" data={stats.executed.C || Array(12).fill(0)} />
                                        {/* Total Row Calculation */}
                                        <tr className="bg-[#f0f4f8]">
                                            <td className="border border-[#d1d5db] px-3 py-1.5 text-left font-normal text-[#1f1f1f]">TOTAL</td>
                                            {Array(12).fill(0).map((_, i) => {
                                                const sum = (stats.executed.A?.[i] || 0) + (stats.executed.B?.[i] || 0) + (stats.executed.C?.[i] || 0);
                                                return <td key={i} className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal text-[#1f1f1f]">{sum}</td>
                                            })}
                                            <td className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal bg-[#e2e8f0] text-[#1f1f1f]">
                                                {/* Grand Total */}
                                                {['A', 'B', 'C'].reduce((acc, cat) => acc + (stats.executed[cat] || []).reduce((a, b) => a + b, 0), 0)}
                                            </td>
                                        </tr>
                                    </>
                                )}
                                {!stats.executed && (
                                    <tr>
                                        <td colSpan="14" className="text-center py-4 italic text-[#5c5c5c] font-normal">Cargando datos de ejecución...</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* DELTA (DIFERENCIA) */}
                <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden">
                    <div className="bg-[#354a5f] text-white px-3 py-1.5">
                        <h3 className="text-[12px] font-normal text-white m-0">Delta (Diferencia)</h3>
                    </div>
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full border-collapse text-[11.5px]">
                            <thead>
                                <tr className="bg-[#f0f4f8] text-[#1f1f1f]">
                                    <th className="border border-[#d1d5db] px-3 py-1.5 text-left font-normal min-w-[140px]">Categoría / Mes</th>
                                    {['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'].map(m => (
                                        <th key={m} className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal">{m}</th>
                                    ))}
                                    <th className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal">Total</th>
                                </tr>
                            </thead>
                            <tbody className="text-[#1f1f1f]">
                                {stats.delta && (
                                    <>
                                        <RenderRow label="A" data={stats.delta.A || Array(12).fill(0)} />
                                        <RenderRow label="B" data={stats.delta.B || Array(12).fill(0)} />
                                        <RenderRow label="C" data={stats.delta.C || Array(12).fill(0)} />
                                        {/* Total Row Calculation */}
                                        <tr className="bg-[#f0f4f8]">
                                            <td className="border border-[#d1d5db] px-3 py-1.5 text-left font-normal text-[#1f1f1f]">TOTAL</td>
                                            {Array(12).fill(0).map((_, i) => {
                                                const sum = (stats.delta.A?.[i] || 0) + (stats.delta.B?.[i] || 0) + (stats.delta.C?.[i] || 0);
                                                return <td key={i} className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal text-[#1f1f1f]">{sum}</td>
                                            })}
                                            <td className="border border-[#d1d5db] px-2 py-1.5 text-center font-normal bg-[#e2e8f0] text-[#1f1f1f]">
                                                {/* Grand Total */}
                                                {['A', 'B', 'C'].reduce((acc, cat) => acc + (stats.delta[cat] || []).reduce((a, b) => a + b, 0), 0)}
                                            </td>
                                        </tr>
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Planner;