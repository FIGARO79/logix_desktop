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
        <tr>
            <td className={`border border-gray-300 px-3 py-1 text-left ${isTotal ? 'font-medium  bg-gray-50' : 'font-medium'}`}>{label}</td>
            {data && data.map((val, i) => (
                <td key={i} className="border border-gray-300 px-2 py-1 text-center">{val}</td>
            ))}
            <td className={`border border-gray-300 px-2 py-1 text-center ${isTotal ? 'font-medium  bg-gray-100' : 'font-medium  bg-gray-50 '}`}>
                {data ? data.reduce((a, b) => a + b, 0) : 0}
            </td>
        </tr>
    );

    return (
        <div className="container-wrapper max-w-[1600px] mx-auto p-4 font-sans text-sm text-[#32383e]">

            {/* 1. Parámetros Generales */}
            <div className="bg-white p-4 rounded shadow-sm border border-gray-200 mb-6">
                <h2 className="text-base font-medium  text-gray-800 mb-2 border-l-4 border-[#285f94] pl-2">Parámetros Generales</h2>
                <div className="flex flex-wrap items-end gap-6">
                    <div>
                        <label className="block text-xs font-medium  text-gray-700 mb-1">Fecha Inicial</label>
                        <input
                            type="date"
                            className="border border-gray-300 rounded px-2 py-1 text-sm focus:border-[#285f94] outline-none"
                            value={config.start_date}
                            onChange={e => setConfig({ ...config, start_date: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium  text-gray-700 mb-1">Fecha Final</label>
                        <input
                            type="date"
                            className="border border-gray-300 rounded px-2 py-1 text-sm focus:border-[#285f94] outline-none"
                            value={config.end_date}
                            onChange={e => setConfig({ ...config, end_date: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium  text-gray-700 mb-1">Festivos (Calc)</label>
                        <input readOnly className="border border-gray-300 rounded px-2 py-1 text-sm bg-gray-100 w-20 text-center"
                            value={config.holidays ? config.holidays.length : 0} />
                    </div>
                    <div className="ml-auto flex gap-2">
                        <button onClick={handleSaveConfig} className="bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700">Guardar Fechas</button>
                        <button onClick={handleUpdatePlan} disabled={loading} className="bg-[#285f94] text-white px-4 py-1.5 rounded text-sm hover:bg-[#1e4a74] border border-[#1e4a74]">
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
                            className="bg-[#285f94] text-white px-4 py-1.5 rounded text-sm hover:bg-[#1e4a74]"
                        >
                            Generar Excel
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. Link Ejecución */}
            <div className="bg-white p-4 rounded shadow-sm border border-gray-200 mb-6 flex justify-between items-center">
                <div>
                    <h2 className="text-base font-medium  text-[#285f94] mb-0 border-l-4 border-[#285f94] pl-2">Ejecución Diaria</h2>
                    <p className="text-xs text-gray-500 mt-1 pl-3">Accede a la interfaz de conteo ciego.</p>
                </div>
                <Link to="/planner/execution" className="bg-[#285f94] text-white px-6 py-2.5 rounded shadow hover:bg-[#1e4a74] flex items-center gap-2 font-medium  no-underline">
                    Ir a Pantalla de Conteo
                </Link>
            </div>

            {/* 3. Grid Layout: Resumen y Leyenda */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Tabla Resumen ABC */}
                <div>
                    <h3 className="text-base font-medium  text-gray-800 mb-2 border-l-4 border-[#285f94] pl-2">Resumen Categorías (ABC)</h3>
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="bg-gray-200">
                                <th className="border border-gray-400 px-2 py-1">Categoría</th>
                                <th className="border border-gray-400 px-2 py-1">N° Items</th>
                                <th className="border border-gray-400 px-2 py-1">Ciclos</th>
                                <th className="border border-gray-400 px-2 py-1">Total Req</th>
                                <th className="border border-gray-400 px-2 py-1">Items/Día</th>
                            </tr>
                        </thead>
                        <tbody>
                            {['A', 'B', 'C'].map(cat => (
                                <tr key={cat}>
                                    <td className="border border-gray-400 px-2 py-1 font-medium  text-center">{cat}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center bg-gray-50">{dashboardMetrics.counts[cat]}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center">{cat === 'A' ? 3 : cat === 'B' ? 2 : 1}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center bg-gray-50">{dashboardMetrics.req[cat]}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center bg-gray-50">{dashboardMetrics.daily[cat]}</td>
                                </tr>
                            ))}
                            <tr className="border-t-2 border-gray-400">
                                <td colSpan="2" className="border border-gray-400 px-2 py-1 font-medium  text-right">Días Útiles:</td>
                                <td colSpan="3" className="border border-gray-400 px-2 py-1 font-medium  bg-yellow-50 text-center">{dashboardMetrics.workingDays}</td>
                            </tr>
                            <tr>
                                <td colSpan="2" className="border border-gray-400 px-2 py-1 font-medium  text-right">Total Requerido:</td>
                                <td colSpan="3" className="border border-gray-400 px-2 py-1 font-medium  bg-yellow-50 text-center">{dashboardMetrics.totalReq}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div>
                    <h3 className="text-base font-medium  text-gray-800 mb-2 border-l-4 border-[#285f94] pl-2">Leyenda / Clasificación</h3>
                    <div className="flex gap-4">
                        <table className="w-auto border-collapse text-xs h-fit shadow-sm">
                            <thead>
                                <tr className="bg-[#34495e] text-white">
                                    <th className="border border-gray-400 px-2 py-1 uppercase tracking-wider text-[10px]">Código</th>
                                    <th className="border border-gray-400 px-2 py-1 uppercase tracking-wider text-[10px] w-32">Criterio (Hits)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { c: 'W', h: 'More than 30 hits' }, { c: 'X', h: '11-30 hits' },
                                    { c: 'Y', h: '7-10 hits' }, { c: 'K', h: '5-6 hits' },
                                    { c: 'L', h: '3-4 hits' }, { c: 'Z', h: '1-2 hits' }, { c: '0', h: 'Non moving item' }
                                ].map(r => (
                                    <tr key={r.c}>
                                        <td className="border border-gray-300 px-2 py-0.5 font-medium  text-center bg-gray-50">{r.c}</td>
                                        <td className="border border-gray-300 px-2 py-0.5 text-left whitespace-nowrap bg-white">{r.h}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex-grow border border-gray-300 rounded bg-white flex flex-col shadow-sm">
                            <div className="bg-gray-200 px-2 py-1 text-xs font-medium  border-b border-gray-300 text-center text-gray-700">Festivos (YYYY-MM-DD)</div>
                            <textarea
                                className="w-full p-2 text-xs bg-transparent outline-none resize-none font-mono flex-grow"
                                value={holidaysText}
                                onChange={e => setHolidaysText(e.target.value)}
                                placeholder="2024-01-01&#10;2024-05-01"
                            ></textarea>
                        </div>
                    </div>
                </div>
            </div>

            {/* 4. Grids Mensuales */}
            <div className="space-y-6">
                {/* PLANEADO */}
                <div className="bg-white rounded shadow-sm border border-gray-200 overflow-hidden">
                    <div className="border-l-4 border-[#285f94] bg-gray-50 px-4 py-2">
                        <h3 className="text-sm font-medium  text-[#1e4a74]">Planeado (Conteos Programados)</h3>
                    </div>
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr>
                                    <th className="border border-gray-300 px-3 py-1.5 text-left font-medium  min-w-[150px]">Categoria/Mes</th>
                                    {['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'].map(m => (
                                        <th key={m} className="border border-gray-300 px-2 py-1.5 text-center font-medium ">{m}</th>
                                    ))}
                                    <th className="border border-gray-300 px-2 py-1.5 text-center font-medium ">TOTAL</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-600">
                                <RenderRow label="A" data={dashboardMetrics.monthlyPlanned.A} />
                                <RenderRow label="B" data={dashboardMetrics.monthlyPlanned.B} />
                                <RenderRow label="C" data={dashboardMetrics.monthlyPlanned.C} />
                                <RenderRow label="TOTAL" data={dashboardMetrics.monthlyPlanned.Total} isTotal={true} />
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* EJECUTADO REAL */}
                <div className="bg-white rounded shadow-sm border border-gray-200 overflow-hidden">
                    <div className="border-l-4 border-green-600 bg-gray-50 px-4 py-2">
                        <h3 className="text-sm font-medium  text-green-800">Ejecutado (Real)</h3>
                    </div>
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr>
                                    <th className="border border-gray-300 px-3 py-1.5 text-left font-medium  min-w-[150px]">Categoria/Mes</th>
                                    {['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'].map(m => (
                                        <th key={m} className="border border-gray-300 px-2 py-1.5 text-center font-medium ">{m}</th>
                                    ))}
                                    <th className="border border-gray-300 px-2 py-1.5 text-center font-medium ">W2W</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-600">
                                {stats.executed && (
                                    <>
                                        <RenderRow label="A" data={stats.executed.A || Array(12).fill(0)} />
                                        <RenderRow label="B" data={stats.executed.B || Array(12).fill(0)} />
                                        <RenderRow label="C" data={stats.executed.C || Array(12).fill(0)} />
                                        {/* Total Row Calculation */}
                                        <tr>
                                            <td className="border border-gray-300 px-3 py-1 text-left font-medium  bg-gray-50">TOTAL</td>
                                            {Array(12).fill(0).map((_, i) => {
                                                const sum = (stats.executed.A?.[i] || 0) + (stats.executed.B?.[i] || 0) + (stats.executed.C?.[i] || 0);
                                                return <td key={i} className="border border-gray-300 px-2 py-1 text-center font-medium  bg-gray-50">{sum}</td>
                                            })}
                                            <td className="border border-gray-300 px-2 py-1 text-center font-medium  bg-gray-200">
                                                {/* Grand Total */}
                                                {['A', 'B', 'C'].reduce((acc, cat) => acc + (stats.executed[cat] || []).reduce((a, b) => a + b, 0), 0)}
                                            </td>
                                        </tr>
                                    </>
                                )}
                                {!stats.executed && (
                                    <tr>
                                        <td colSpan="14" className="text-center py-4 italic text-gray-400">Cargando datos de ejecución...</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* DELTA (DIFERENCIA) */}
                <div className="bg-white rounded shadow-sm border border-gray-200 overflow-hidden">
                    <div className="border-l-4 border-red-600 bg-gray-50 px-4 py-2">
                        <h3 className="text-sm font-medium  text-red-800">Delta (Diferencia)</h3>
                    </div>
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr>
                                    <th className="border border-gray-300 px-3 py-1.5 text-left font-medium  min-w-[150px]">Categoria/Mes</th>
                                    {['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'].map(m => (
                                        <th key={m} className="border border-gray-300 px-2 py-1.5 text-center font-medium ">{m}</th>
                                    ))}
                                    <th className="border border-gray-300 px-2 py-1.5 text-center font-medium ">TOTAL</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-600">
                                {stats.delta && (
                                    <>
                                        <RenderRow label="A" data={stats.delta.A || Array(12).fill(0)} />
                                        <RenderRow label="B" data={stats.delta.B || Array(12).fill(0)} />
                                        <RenderRow label="C" data={stats.delta.C || Array(12).fill(0)} />
                                        {/* Total Row Calculation */}
                                        <tr>
                                            <td className="border border-gray-300 px-3 py-1 text-left font-medium  bg-gray-50">TOTAL</td>
                                            {Array(12).fill(0).map((_, i) => {
                                                const sum = (stats.delta.A?.[i] || 0) + (stats.delta.B?.[i] || 0) + (stats.delta.C?.[i] || 0);
                                                return <td key={i} className="border border-gray-300 px-2 py-1 text-center font-medium  bg-gray-50">{sum}</td>
                                            })}
                                            <td className="border border-gray-300 px-2 py-1 text-center font-medium  bg-gray-200">
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