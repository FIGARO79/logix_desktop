import React, { useState, useEffect, useCallback } from 'react';
import { useTabContext } from '../hooks/useTabContext';

const ManageCountDifferences = () => {
    const { setTitle } = useTabContext();
    const [data, setData] = useState([]);
    const [filteredData, setFilteredData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);

    // Filtros
    const [filterItemCode, setFilterItemCode] = useState('');
    const [filterType, setFilterType] = useState('all'); // all, negative, positive, zero

    // Modales
    const [editModal, setEditModal] = useState({ open: false, id: null, itemCode: '', desc: '', loc: '', system: 0, counted: 0 });
    const [deleteModal, setDeleteModal] = useState({ open: false, id: null, itemCode: '' });

    useEffect(() => {
        if (setTitle) setTitle("Gestión de Diferencias");
        loadData();
    }, [setTitle]);

    useEffect(() => {
        filterTable();
    }, [filterTable]);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/counts/differences');
            if (!res.ok) throw new Error('Error al cargar datos');
            const json = await res.json();
            setData(Array.isArray(json) ? json : (json?.items || []));
        } catch (err) {
            setError(err.message);
            setData([]);
        } finally {
            setLoading(false);
        }
    };

    const filterTable = useCallback(() => {
        let res = Array.isArray(data) ? [...data] : [];
        const search = filterItemCode.trim().toUpperCase();

        if (search) {
            res = res.filter(item =>
                (item.item_code && item.item_code.toUpperCase().includes(search)) ||
                (item.description && item.description.toUpperCase().includes(search)) ||
                (item.location && item.location.toUpperCase().includes(search)) ||
                (item.username && item.username.toUpperCase().includes(search))
            );
        }

        if (filterType === 'negative') res = res.filter(item => item.difference < 0 || item.diff_qty < 0);
        else if (filterType === 'positive') res = res.filter(item => item.difference > 0 || item.diff_qty > 0);
        else if (filterType === 'zero') res = res.filter(item => item.difference === 0 || item.diff_qty === 0);

        setFilteredData(res);
    }, [data, filterItemCode, filterType]);

    // --- Acciones de Edición ---
    const handleEditClick = (item) => {
        setEditModal({
            open: true,
            id: item.count_id,
            itemCode: item.item_code,
            desc: item.description,
            loc: item.location,
            system: item.system_qty,
            counted: item.counted_qty
        });
    };

    const handleSaveEdit = async () => {
        const qty = parseInt(editModal.counted);
        if (isNaN(qty) || qty < 0) {
            alert("Cantidad inválida");
            return;
        }

        try {
            const res = await fetch(`/api/counts/${editModal.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ counted_qty: qty })
            });
            if (!res.ok) throw new Error("Error al guardar");

            setMessage("Cantidad actualizada exitosamente");
            setEditModal({ ...editModal, open: false });
            loadData();
            setTimeout(() => setMessage(null), 3000);
        } catch (err) {
            alert(err.message);
        }
    };

    // --- Acciones de Eliminación ---
    const handleDeleteClick = (item) => {
        setDeleteModal({ open: true, id: item.count_id, itemCode: item.item_code });
    };

    const handleConfirmDelete = async () => {
        try {
            const res = await fetch(`/api/counts/${deleteModal.id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error("Error al eliminar");

            setMessage("Registro eliminado");
            setDeleteModal({ ...deleteModal, open: false });
            loadData();
            setTimeout(() => setMessage(null), 3000);
        } catch (err) {
            alert(err.message);
        }
    };

    // Exportar a Excel (reutiliza endpoint backend)
    const handleExport = () => {
        const params = new URLSearchParams();
        window.location.href = `/api/export_counts?${params.toString()}`;
    };

    return (
        <div className="max-w-[1600px] mx-auto px-4 py-4 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f] bg-[#f3f3f3] min-h-screen">

            {/* Header Page */}
            <div className="flex justify-between items-center mb-3 bg-white px-4 py-2.5 rounded border border-[#d1d5db] shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Gestión de Diferencias</h1>
                    <p className="text-[11px] text-[#5c5c5c] mt-0.5 mb-0">Verifica y edita las cantidades contadas vs. sistema</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleExport}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                        <svg className="w-3.5 h-3.5 text-[#5c5c5c]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l2.914 2.914a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>Exportar Excel</span>
                    </button>
                    <button
                        onClick={loadData}
                        className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {message && <div className="bg-[#ecfdf5] text-[#065f46] p-2.5 rounded mb-3 border border-[#a7f3d0] text-[12px] font-normal">{message}</div>}
            {error && <div className="bg-[#fef2f2] text-[#991b1b] p-2.5 rounded mb-3 border border-[#fecaca] text-[12px] font-normal">{error}</div>}

            {/* Filtros */}
            <div className="bg-white p-3 rounded border border-[#d1d5db] shadow-sm mb-3 flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Filtrar por Código</label>
                    <input
                        type="text"
                        className="h-7 w-full border border-[#d1d5db] px-2 rounded text-[12px] font-normal uppercase outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                        placeholder="EJ: ABC123..."
                        value={filterItemCode}
                        onChange={(e) => setFilterItemCode(e.target.value)}
                    />
                </div>
                <div className="flex-1 min-w-[180px]">
                    <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Mostrar</label>
                    <select
                        className="h-7 w-full border border-[#d1d5db] px-2 rounded text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                    >
                        <option value="all">Todas las diferencias</option>
                        <option value="negative">Solo negativas ( - )</option>
                        <option value="positive">Solo positivas ( + )</option>
                        <option value="zero">Diferencia 0</option>
                    </select>
                </div>
                <div>
                    <button
                        onClick={() => { setFilterItemCode(''); setFilterType('all'); }}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                    >
                        Limpiar Filtros
                    </button>
                </div>
            </div>

            {/* Tabla */}
            <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden">
                <div className="bg-[#f8f9fa] px-3 py-2 border-b border-[#d1d5db] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 max-w-md bg-white border border-[#d1d5db] rounded px-2 py-0.5 focus-within:border-[#0067c0]">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-[#5c5c5c]">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            className="w-full text-[12px] font-normal outline-none bg-transparent placeholder-[#8c8c8c] text-[#1f1f1f]"
                            placeholder="Buscar por SKU, descripción, ubicación o usuario..."
                            value={filterItemCode}
                            onChange={(e) => setFilterItemCode(e.target.value)}
                        />
                        {filterItemCode && (
                            <button onClick={() => setFilterItemCode('')} className="text-[#5c5c5c] hover:text-[#1f1f1f] text-[11px] font-normal px-1 cursor-pointer">
                                ✕
                            </button>
                        )}
                    </div>
                    <div className="text-[11px] text-[#5c5c5c] font-normal">
                        {filteredData.length} registros
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
                    <table className="min-w-full text-left border-collapse">
                        <thead className="bg-[#354a5f] text-white sticky top-0 z-10 border-b border-[#2a3c4e]">
                            <tr>
                                <th className="px-3 py-2 text-[11px] font-normal w-20 text-center">Acciones</th>
                                <th className="px-3 py-2 text-[11px] font-normal">Código</th>
                                <th className="px-3 py-2 text-[11px] font-normal">Descripción</th>
                                <th className="px-3 py-2 text-[11px] font-normal">Ubicación</th>
                                <th className="px-3 py-2 text-[11px] font-normal text-right">Qty Sistema</th>
                                <th className="px-3 py-2 text-[11px] font-normal text-right">Qty Contada</th>
                                <th className="px-3 py-2 text-[11px] font-normal text-right">Diferencia</th>
                                <th className="px-3 py-2 text-[11px] font-normal text-right">% Var</th>
                                <th className="px-3 py-2 text-[11px] font-normal">Fecha</th>
                                <th className="px-3 py-2 text-[11px] font-normal">Usuario</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e5e7eb]">
                            {loading && (
                                <tr><td colSpan="10" className="p-6 text-center text-[#5c5c5c] text-[12px] font-normal">Cargando datos...</td></tr>
                            )}
                            {!loading && filteredData.length === 0 && (
                                <tr><td colSpan="10" className="p-6 text-center text-[#5c5c5c] text-[12px] font-normal">No hay registros para mostrar.</td></tr>
                            )}
                            {filteredData.map((item) => (
                                <tr key={item.count_id} className={`hover:bg-[#edf3f9] transition-colors border-b border-[#f0f0f0] text-[11.5px] font-normal text-[#1f1f1f] ${item.difference !== 0 ? 'bg-[#fffdf5]' : ''}`}>
                                    <td className="px-3 py-1.5 text-center">
                                        <div className="flex gap-1 justify-center items-center">
                                            <button onClick={() => handleEditClick(item)} className="p-1 text-[#0067c0] hover:bg-[#eef3fc] border border-[#d1d5db] rounded transition-colors cursor-pointer" title="Editar">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                                </svg>
                                            </button>
                                            <button onClick={() => handleDeleteClick(item)} className="p-1 text-[#991b1b] hover:bg-[#fef2f2] border border-[#d1d5db] rounded transition-colors cursor-pointer" title="Eliminar">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-3 py-1.5 font-normal text-[#0067c0]">{item.item_code}</td>
                                    <td className="px-3 py-1.5 truncate max-w-xs text-[#1f1f1f]" title={item.description}>{item.description}</td>
                                    <td className="px-3 py-1.5 font-mono text-[#5c5c5c]">{item.location}</td>
                                    <td className="px-3 py-1.5 text-right text-[#1f1f1f]">{item.system_qty}</td>
                                    <td className="px-3 py-1.5 text-right font-normal text-[#0067c0]">{item.counted_qty}</td>
                                    <td className={`px-3 py-1.5 text-right font-normal ${item.difference > 0 ? 'text-[#065f46]' : item.difference < 0 ? 'text-[#991b1b]' : 'text-[#8c8c8c]'}`}>
                                        {item.difference > 0 ? `+${item.difference}` : item.difference}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-[#5c5c5c]">{item.percentage_variance}%</td>
                                    <td className="px-3 py-1.5 text-[11px] text-[#5c5c5c] whitespace-nowrap">
                                        {item.date ? new Date(item.date).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[11px] text-[#5c5c5c]">{item.username}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Editar */}
            {editModal.open && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded shadow-xl w-full max-w-md overflow-hidden border border-[#d1d5db]">
                        <div className="bg-[#354a5f] text-white px-4 py-2 flex justify-between items-center">
                            <h2 className="text-[13px] font-normal text-white m-0">Editar Cantidad Contada</h2>
                            <button onClick={() => setEditModal({ ...editModal, open: false })} className="text-white hover:text-gray-200 cursor-pointer">✕</button>
                        </div>
                        <div className="p-4 space-y-2.5">
                            <div className="flex justify-between border-b border-[#f0f0f0] pb-1.5 text-[11.5px]">
                                <span className="text-[#5c5c5c]">Código:</span>
                                <span className="text-[#1f1f1f] font-mono">{editModal.itemCode}</span>
                            </div>
                            <div className="flex justify-between border-b border-[#f0f0f0] pb-1.5 text-[11.5px]">
                                <span className="text-[#5c5c5c]">Descripción:</span>
                                <span className="text-[#1f1f1f] truncate max-w-[240px]">{editModal.desc}</span>
                            </div>
                            <div className="flex justify-between border-b border-[#f0f0f0] pb-1.5 text-[11.5px]">
                                <span className="text-[#5c5c5c]">Ubicación:</span>
                                <span className="text-[#1f1f1f] font-mono">{editModal.loc}</span>
                            </div>
                            <div className="flex justify-between border-b border-[#f0f0f0] pb-1.5 text-[11.5px]">
                                <span className="text-[#5c5c5c]">Qty Sistema:</span>
                                <span className="text-[#1f1f1f]">{editModal.system}</span>
                            </div>

                            <div className="pt-2">
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">Nueva Cantidad Contada</label>
                                <input
                                    type="number"
                                    className="h-8 w-full border border-[#0067c0] rounded px-3 text-[14px] font-normal outline-none"
                                    value={editModal.counted}
                                    onChange={(e) => setEditModal({ ...editModal, counted: e.target.value })}
                                    autoFocus
                                    min="0"
                                />
                            </div>
                        </div>
                        <div className="bg-[#f8f9fa] px-4 py-2.5 flex justify-end gap-2 border-t border-[#d1d5db]">
                            <button onClick={() => setEditModal({ ...editModal, open: false })} className="h-7 px-3 border border-[#d1d5db] rounded bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal cursor-pointer">Cancelar</button>
                            <button onClick={handleSaveEdit} className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal cursor-pointer shadow-sm">Guardar Cambios</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Eliminar */}
            {deleteModal.open && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded shadow-xl w-full max-w-sm overflow-hidden border border-[#d1d5db]">
                        <div className="bg-[#354a5f] text-white px-4 py-2 flex justify-between items-center">
                            <h2 className="text-[13px] font-normal text-white m-0">Confirmar Eliminación</h2>
                            <button onClick={() => setDeleteModal({ ...deleteModal, open: false })} className="text-white hover:text-gray-200 cursor-pointer">✕</button>
                        </div>
                        <div className="p-4">
                            <p className="m-0 text-[12px] font-normal text-[#1f1f1f]">
                                ¿Estás seguro de que deseas eliminar el registro del item <span className="font-normal text-[#0067c0]">{deleteModal.itemCode}</span>?
                            </p>
                        </div>
                        <div className="bg-[#f8f9fa] px-4 py-2.5 flex justify-end gap-2 border-t border-[#d1d5db]">
                            <button onClick={() => setDeleteModal({ ...deleteModal, open: false })} className="h-7 px-3 border border-[#d1d5db] rounded bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal cursor-pointer">Cancelar</button>
                            <button onClick={handleConfirmDelete} className="h-7 px-3 bg-[#c42b1c] hover:bg-[#a82315] text-white rounded text-[12px] font-normal cursor-pointer shadow-sm">Eliminar</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default ManageCountDifferences;
