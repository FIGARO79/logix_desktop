import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

const COLUMNS = [
    { label: 'Fecha', key: 'executed_date', align: 'left' },
    { label: 'Item Code', key: 'item_code', align: 'left' },
    { label: 'Descripción', key: 'item_description', align: 'left' },
    { label: 'Ubicación', key: 'bin_location', align: 'left' },
    { label: 'ABC', key: 'abc_code', align: 'center' },
    { label: 'Sistema', key: 'system_qty', align: 'right' },
    { label: 'Física', key: 'physical_qty', align: 'right' },
    { label: 'Diff', key: 'difference', align: 'right' },
    { label: 'Usuario', key: 'username', align: 'left' },
    { label: 'Acciones', key: null, align: 'center' }
];

const ManageCycleCountDifferences = () => {
    const { setTitle } = useOutletContext();
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);


    // Filtros
    const [year, setYear] = useState(new Date().getFullYear());
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [onlyDifferences, setOnlyDifferences] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const [editingItem, setEditingItem] = useState(null);
    const [newPhysicalQty, setNewPhysicalQty] = useState('');

    // Ordenamiento
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData = useMemo(() => {
        let sortableItems = [...data];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let valA = a[sortConfig.key];
                let valB = b[sortConfig.key];

                if (valA === undefined || valA === null) valA = '';
                if (valB === undefined || valB === null) valB = '';

                if (typeof valA === 'number' && typeof valB === 'number') {
                    return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
                }

                if (sortConfig.key === 'executed_date') {
                    const dateA = new Date(valA);
                    const dateB = new Date(valB);
                    return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
                }

                const strA = String(valA).toLowerCase();
                const strB = String(valB).toLowerCase();
                if (strA < strB) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (strA > strB) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [data, sortConfig]);

    useEffect(() => {
        setTitle("Gestión de Diferencias");
    }, [setTitle]);

    const fetchData = useCallback(async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const params = {
                year: year,
                only_differences: onlyDifferences
            };
            if (month) params.month = month;

            const queryParams = new URLSearchParams(params);
            const res = await fetch(`/api/planner/cycle_count_differences?${queryParams}`);
            if (!res.ok) throw new Error("Error cargando datos");
            const result = await res.json();
            setData(result);
        } catch (err) {
            console.error(err);
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [year, month, onlyDifferences]);

    useEffect(() => {
        fetchData(true);

        // Listener en tiempo real entre pestañas/pantallas sin hacer polling periódico por timer
        let bc;
        if (typeof BroadcastChannel !== 'undefined') {
            bc = new BroadcastChannel('logix_events');
            bc.onmessage = (event) => {
                if (event.data?.type === 'CYCLE_COUNT_MUTATED' || event.data?.type === 'INBOUND_MUTATED') {
                    fetchData(false);
                }
            };
        }

        return () => {
            if (bc) bc.close();
        };
    }, [fetchData, refreshTrigger]);


    const handleEdit = (item) => {
        setEditingItem(item);
        setNewPhysicalQty(item.physical_qty);
    };

    const handleSaveEdit = async () => {
        if (!editingItem) return;

        try {
            const res = await fetch(`/api/planner/cycle_count_differences/${editingItem.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ physical_qty: parseInt(newPhysicalQty) })
            });

            if (res.ok) {
                setEditingItem(null);
                fetchData(false);
                if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('logix_events');
                    bc.postMessage({ type: 'CYCLE_COUNT_MUTATED' });
                    bc.close();
                }
                alert("Cantidad actualizada correctamente");
            } else {
                const err = await res.json();
                alert(err.detail || "Error al actualizar");
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    // Helper para formatear fecha
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });
        } catch (e) {
            return dateStr;
        }
    };

    const handleExportToExcel = () => {
        if (!data || data.length === 0) {
            alert("No hay datos para exportar");
            return;
        }

        const headers = ['Fecha', 'Item Code', 'Descripción', 'Ubicación', 'ABC', 'Sistema', 'Física', 'Diferencia', 'Usuario'];
        
        const rows = data.map(row => [
            formatDate(row.executed_date),
            row.item_code,
            `"${(row.item_description || '').replace(/"/g, '""')}"`,
            row.bin_location,
            row.abc_code,
            row.system_qty,
            row.physical_qty,
            row.difference,
            row.username
        ]);

        const csvContent = [
            headers.join(';'),
            ...rows.map(e => e.join(';'))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `diferencias_conteo_${year}_${month || 'todos'}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };


    return (
        <div className="max-w-[1800px] mx-auto px-6 pt-3 pb-6 font-sans bg-[#fcfcfc] min-h-screen text-zinc-800">
            {/* Filtros */}
            <div className="bg-white p-4 border border-zinc-200 mb-6 flex flex-wrap gap-6 items-end shadow-sm">
                <div>
                    <label className="block text-[12px] uppercase font-medium  text-black tracking-tight mb-1.5">Año</label>
                    <input
                        type="number"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="h-8 border border-zinc-200 rounded px-3 w-24 text-xs focus:ring-1 focus:ring-zinc-900 outline-none transition-all"
                    />
                </div>
                <div>
                    <label className="block text-[12px] uppercase font-medium  text-black tracking-tight mb-1.5">Mes</label>
                    <select
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="h-8 border border-zinc-200 rounded px-3 w-36 text-xs focus:ring-1 focus:ring-zinc-900 outline-none transition-all cursor-pointer"
                    >
                        <option value="">Todos los meses</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <option key={m} value={m}>{new Date(0, m - 1).toLocaleString('es-ES', { month: 'long' })}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center pb-2">
                    <input
                        type="checkbox"
                        checked={onlyDifferences}
                        onChange={(e) => setOnlyDifferences(e.target.checked)}
                        id="onlyDiff"
                        className="w-3.5 h-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 cursor-pointer"
                    />
                    <label htmlFor="onlyDiff" className="ml-2 text-[12px] uppercase font-medium  text-black tracking-tight cursor-pointer select-none">Solo Diferencias</label>
                </div>
                <div className="flex-grow"></div>
                <div className="flex gap-2">
                    <button
                        onClick={handleExportToExcel}
                        disabled={data.length === 0}
                        className="h-8 bg-emerald-700 disabled:bg-zinc-200 text-white px-6 text-[10px] font-medium uppercase tracking-widest rounded hover:bg-emerald-800 disabled:text-zinc-400 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                        Exportar a Excel
                    </button>
                    <button
                        onClick={() => fetchData(true)}
                        className="h-8 bg-zinc-900 text-white px-6 text-[10px] font-medium uppercase tracking-widest rounded hover:bg-black transition-all shadow-sm"
                    >
                        Actualizar Vista
                    </button>
                </div>
            </div>

            <div className="bg-white shadow-sm border border-zinc-200 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-900 text-white select-none">
                        <tr>
                            {COLUMNS.map((col, i) => {
                                const isSortable = col.key !== null;
                                const isSorted = sortConfig.key === col.key;
                                const direction = sortConfig.direction;

                                let alignClass = 'text-left';
                                if (col.align === 'right') alignClass = 'text-right';
                                if (col.align === 'center') alignClass = 'text-center';

                                return (
                                    <th
                                        key={i}
                                        onClick={() => isSortable && handleSort(col.key)}
                                        className={`px-4 py-1.5 text-[12px] font-normal uppercase tracking-tight whitespace-nowrap ${alignClass} ${isSortable ? 'cursor-pointer hover:bg-zinc-800 transition-colors' : ''}`}
                                    >
                                        <div className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end w-full' : col.align === 'center' ? 'justify-center w-full' : ''}`}>
                                            <span>{col.label}</span>
                                            {isSortable && (
                                                <span className="text-[10px] text-zinc-400">
                                                    {isSorted ? (direction === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                        {loading ? (
                            <tr><td colSpan="10" className="text-center py-8 text-zinc-400 text-[10px] uppercase font-medium  tracking-widest">Analizando discrepancias...</td></tr>
                        ) : sortedData.length === 0 ? (
                            <tr><td colSpan="10" className="text-center py-8 text-zinc-400 text-[10px] uppercase font-medium  tracking-widest">No se encontraron diferencias en este periodo.</td></tr>
                        ) : (
                            sortedData.map((row) => (
                                <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors leading-none">
                                    <td className="px-4 py-1.5 whitespace-nowrap text-black font-normal">{formatDate(row.executed_date)}</td>
                                    <td className="px-4 py-1.5 font-normal text-black whitespace-nowrap">{row.item_code}</td>
                                    <td className="px-4 py-1.5 truncate max-w-[350px] text-black font-normal whitespace-nowrap" title={row.item_description}>{row.item_description}</td>
                                    <td className="px-4 py-1.5 text-black font-normal whitespace-nowrap">{row.bin_location}</td>
                                    <td className="px-4 py-1.5 text-center text-black font-normal whitespace-nowrap">{row.abc_code}</td>
                                    <td className="px-4 py-1.5 text-right text-black font-normal whitespace-nowrap">{row.system_qty}</td>
                                    <td className="px-4 py-1.5 text-right text-black font-normal whitespace-nowrap">{row.physical_qty}</td>
                                    <td className={`px-4 py-1.5 text-right whitespace-nowrap ${row.difference !== 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {row.difference > 0 ? `+${row.difference}` : row.difference}
                                    </td>
                                    <td className="px-4 py-1.5 text-black font-normal whitespace-nowrap">{row.username}</td>
                                    <td className="px-4 py-1.5 text-center whitespace-nowrap">
                                        <button
                                            onClick={() => handleEdit(row)}
                                            className="text-[12px] font-normal  uppercase tracking-tight text-[#285f94] hover:text-black transition-colors leading-none"
                                            title="Recuento"
                                        >
                                            RECOUNT
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal Editar */}
            {editingItem && (
                <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white border border-zinc-200 shadow-2xl max-w-sm w-full overflow-hidden">
                        <div className="bg-zinc-900 px-6 py-3">
                            <h3 className="text-[10px] font-medium text-white uppercase tracking-widest">Actualizar Cantidad Física</h3>
                        </div>
                        <div className="p-6">
                            <div className="mb-6 space-y-1">
                                <label className="text-[8px] uppercase font-medium  text-zinc-400 tracking-widest block">Referencia</label>
                                <p className="text-sm font-medium  text-zinc-900 tracking-tight">{editingItem.item_code}</p>
                                <p className="text-[10px] text-zinc-500 uppercase">{editingItem.item_description}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-8">
                                <div className="p-3 bg-zinc-50 border border-zinc-100">
                                    <label className="text-[8px] uppercase font-medium  text-zinc-400 tracking-widest block mb-1">Stock Sistema</label>
                                    <p className="text-xl font-light text-zinc-900">{editingItem.system_qty}</p>
                                </div>
                                <div className="p-3 bg-blue-50/30 border border-blue-100">
                                    <label className="text-[8px] uppercase font-medium  text-blue-400 tracking-widest block mb-1">Stock Físico</label>
                                    <input
                                        type="number"
                                        className="w-full bg-transparent text-xl font-medium  text-[#285f94] focus:outline-none"
                                        value={newPhysicalQty}
                                        onChange={(e) => setNewPhysicalQty(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setEditingItem(null)}
                                    className="px-4 py-2 text-[10px] font-medium  text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    className="px-6 py-2 bg-zinc-900 text-white text-[10px] font-medium  uppercase tracking-widest rounded hover:bg-black transition-all shadow-md"
                                >
                                    Confirmar Ajuste
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageCycleCountDifferences;
