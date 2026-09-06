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
        let sortableItems = Array.isArray(data) ? [...data] : [];
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
            setData(Array.isArray(result) ? result : (result?.items || []));
        } catch (err) {
            console.error(err);
            setData([]);
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
        <div className="max-w-[1800px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f8f9fa] min-h-screen text-[#1f1f1f]">
            {/* Header y Filtros */}
            <div className="bg-white p-3 border border-[#d1d5db] rounded mb-3 flex flex-wrap gap-4 items-end shadow-sm">
                <div>
                    <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Año</label>
                    <input
                        type="number"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="h-7 border border-[#d1d5db] rounded px-2 w-20 text-[12px] font-normal text-[#1f1f1f] focus:border-[#0067c0] outline-none bg-white"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Mes</label>
                    <select
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="h-7 border border-[#d1d5db] rounded px-2 w-36 text-[12px] font-normal text-[#1f1f1f] focus:border-[#0067c0] outline-none bg-white cursor-pointer"
                    >
                        <option value="">Todos los meses</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <option key={m} value={m}>{new Date(0, m - 1).toLocaleString('es-ES', { month: 'long' })}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center pb-1">
                    <input
                        type="checkbox"
                        checked={onlyDifferences}
                        onChange={(e) => setOnlyDifferences(e.target.checked)}
                        id="onlyDiff"
                        className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#0067c0] focus:ring-[#0067c0] cursor-pointer"
                    />
                    <label htmlFor="onlyDiff" className="ml-1.5 text-[12px] font-normal text-[#1f1f1f] cursor-pointer select-none">Solo Diferencias</label>
                </div>
                <div className="flex-grow"></div>
                <div className="flex gap-2">
                    <button
                        onClick={handleExportToExcel}
                        disabled={data.length === 0}
                        className="h-7 bg-white hover:bg-[#f5f5f5] disabled:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] px-3 text-[12px] font-normal rounded disabled:text-[#8c8c8c] disabled:cursor-not-allowed transition-colors shadow-sm cursor-pointer"
                    >
                        Exportar a Excel
                    </button>
                    <button
                        onClick={() => fetchData(true)}
                        className="h-7 bg-[#0067c0] hover:bg-[#005a9e] text-white px-3 text-[12px] font-normal rounded transition-colors shadow-sm cursor-pointer"
                    >
                        Actualizar
                    </button>
                </div>
            </div>

            <div className="bg-white shadow-sm border border-[#d1d5db] rounded overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-[#354a5f] text-white select-none border-b border-[#2a3c4e]">
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
                                        className={`px-3 py-2 text-[11px] font-normal whitespace-nowrap ${alignClass} ${isSortable ? 'cursor-pointer hover:bg-[#2a3c4e] transition-colors' : ''}`}
                                    >
                                        <div className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end w-full' : col.align === 'center' ? 'justify-center w-full' : ''}`}>
                                            <span>{col.label}</span>
                                            {isSortable && (
                                                <span className="text-[10px] text-gray-300">
                                                    {isSorted ? (direction === 'asc' ? ' ▲' : ' ▼') : ''}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e5e7eb]">
                        {loading ? (
                            <tr><td colSpan="10" className="text-center py-8 text-[#5c5c5c] text-[12px] font-normal">Cargando discrepancias...</td></tr>
                        ) : sortedData.length === 0 ? (
                            <tr><td colSpan="10" className="text-center py-8 text-[#5c5c5c] text-[12px] font-normal">No se encontraron diferencias en este periodo.</td></tr>
                        ) : (
                            sortedData.map((row) => (
                                <tr key={row.id} className="hover:bg-[#edf3f9] transition-colors border-b border-[#f0f0f0] text-[11.5px] font-normal text-[#1f1f1f]">
                                    <td className="px-3 py-1.5 whitespace-nowrap text-[#5c5c5c]">{formatDate(row.executed_date)}</td>
                                    <td className="px-3 py-1.5 text-[#0067c0] whitespace-nowrap">{row.item_code}</td>
                                    <td className="px-3 py-1.5 truncate max-w-[350px] whitespace-nowrap text-[#1f1f1f]" title={row.item_description}>{row.item_description}</td>
                                    <td className="px-3 py-1.5 font-mono text-[#5c5c5c] whitespace-nowrap">{row.bin_location}</td>
                                    <td className="px-3 py-1.5 text-center text-[#1f1f1f] whitespace-nowrap">{row.abc_code}</td>
                                    <td className="px-3 py-1.5 text-right text-[#1f1f1f] whitespace-nowrap">{row.system_qty}</td>
                                    <td className="px-3 py-1.5 text-right text-[#1f1f1f] whitespace-nowrap">{row.physical_qty}</td>
                                    <td className={`px-3 py-1.5 text-right whitespace-nowrap ${row.difference !== 0 ? 'text-[#991b1b]' : 'text-[#065f46]'}`}>
                                        {row.difference > 0 ? `+${row.difference}` : row.difference}
                                    </td>
                                    <td className="px-3 py-1.5 text-[#5c5c5c] whitespace-nowrap">{row.username}</td>
                                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                                        <button
                                            onClick={() => handleEdit(row)}
                                            className="h-6 px-2 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#0067c0] text-[11px] font-normal rounded cursor-pointer transition-colors"
                                            title="Reconteo"
                                        >
                                            Reconteo
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
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded shadow-xl max-w-sm w-full overflow-hidden border border-[#d1d5db]">
                        <div className="bg-[#354a5f] text-white px-4 py-2 flex justify-between items-center">
                            <h3 className="text-[13px] font-normal text-white m-0">Actualizar Cantidad Física</h3>
                            <button onClick={() => setEditingItem(null)} className="text-white hover:text-gray-200 cursor-pointer">✕</button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="border-b border-[#f0f0f0] pb-2">
                                <span className="text-[10px] text-[#5c5c5c] block">Referencia</span>
                                <p className="text-[13px] font-normal text-[#0067c0] m-0">{editingItem.item_code}</p>
                                <p className="text-[11px] text-[#5c5c5c] m-0 truncate">{editingItem.item_description}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-2.5 bg-[#f8f9fa] border border-[#e5e7eb] rounded">
                                    <span className="text-[10px] text-[#5c5c5c] block mb-1">Stock Sistema</span>
                                    <p className="text-[16px] font-normal text-[#1f1f1f] m-0">{editingItem.system_qty}</p>
                                </div>
                                <div className="p-2.5 bg-white border border-[#0067c0] rounded">
                                    <span className="text-[10px] text-[#0067c0] block mb-1">Stock Físico</span>
                                    <input
                                        type="number"
                                        className="w-full bg-transparent text-[16px] font-normal text-[#1f1f1f] outline-none"
                                        value={newPhysicalQty}
                                        onChange={(e) => setNewPhysicalQty(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
                                <button
                                    onClick={() => setEditingItem(null)}
                                    className="h-7 px-3 border border-[#d1d5db] rounded bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors shadow-sm cursor-pointer"
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
