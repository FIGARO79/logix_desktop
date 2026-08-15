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
            setData(json.items || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const filterTable = useCallback(() => {
        let res = [...data];
        const search = filterItemCode.trim().toUpperCase();

        if (search) {
            res = res.filter(item =>
                (item.item_code && item.item_code.toUpperCase().includes(search)) ||
                (item.description && item.description.toUpperCase().includes(search)) ||
                (item.location && item.location.toUpperCase().includes(search)) ||
                (item.username && item.username.toUpperCase().includes(search))
            );
        }

        if (filterType === 'negative') res = res.filter(item => item.difference < 0);
        else if (filterType === 'positive') res = res.filter(item => item.difference > 0);
        else if (filterType === 'zero') res = res.filter(item => item.difference === 0);

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
        <div className="max-w-7xl mx-auto px-4 py-6">

                {/* Header Page */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-xl font-normal text-gray-800">Gestión de Diferencias</h1>
                        <p className="text-sm text-gray-500">Verifica y edita las cantidades contadas vs. sistema</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleExport} className="btn-sap btn-secondary flex items-center gap-2">
                            <span className="text-green-600 font-medium ">⬇</span> Exportar Excel
                        </button>
                        <button onClick={loadData} className="btn-sap btn-secondary flex items-center gap-2">
                            <span>↻</span> Actualizar
                        </button>
                    </div>
                </div>

                {message && <div className="bg-green-100 text-green-800 p-3 rounded mb-4 border border-green-200">{message}</div>}
                {error && <div className="bg-red-100 text-red-800 p-3 rounded mb-4 border border-red-200">{error}</div>}

                {/* Filtros */}
                <div className="bg-white p-4 rounded shadow border border-gray-200 mb-6 flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <label className="block text-xs font-medium  uppercase text-gray-500 mb-1">Filtrar por Item Code</label>
                        <input
                            type="text"
                            className="w-full border p-2 rounded text-sm uppercase"
                            placeholder="EJ: ABC123..."
                            value={filterItemCode}
                            onChange={(e) => setFilterItemCode(e.target.value)}
                        />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-medium  uppercase text-gray-500 mb-1">Mostrar</label>
                        <select
                            className="w-full border p-2 rounded text-sm"
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
                        <button onClick={() => { setFilterItemCode(''); setFilterType('all'); }} className="btn-sap btn-secondary h-[38px]">
                            Limpiar Filtros
                        </button>
                    </div>
                </div>

                {/* Tabla */}
                <div className="bg-white rounded shadow overflow-hidden border border-gray-200">
                    <div className="bg-[#f2f2f2] px-4 py-2 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 max-w-md bg-white border border-gray-300 rounded px-3 py-1 focus-within:ring-1 focus-within:ring-[#285f94]">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-gray-400">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                            <input
                                type="text"
                                className="w-full text-xs font-sans outline-none bg-transparent placeholder-gray-400 uppercase"
                                placeholder="Buscar por SKU, Descripción, Ubicación o Usuario..."
                                value={filterItemCode}
                                onChange={(e) => setFilterItemCode(e.target.value)}
                            />
                            {filterItemCode && (
                                <button onClick={() => setFilterItemCode('')} className="text-gray-400 hover:text-gray-600 text-xs font-bold">
                                    ✕
                                </button>
                            )}
                        </div>
                        <div className="text-xs text-gray-600 font-medium">
                            {filteredData.length} registros
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="uppercase font-medium  border-b">
                                <tr>
                                    <th className="p-3 w-20">Acciones</th>
                                    <th className="p-3">Item Code</th>
                                    <th className="p-3">Descripción</th>
                                    <th className="p-3">Ubicación</th>
                                    <th className="p-3 text-right">Qty Sistema</th>
                                    <th className="p-3 text-right">Qty Contada</th>
                                    <th className="p-3 text-right">Diferencia</th>
                                    <th className="p-3 text-right">% Var</th>
                                    <th className="p-3">Fecha</th>
                                    <th className="p-3">Usuario</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {loading && (
                                    <tr><td colSpan="10" className="p-6 text-center text-gray-500">Cargando datos...</td></tr>
                                )}
                                {!loading && filteredData.length === 0 && (
                                    <tr><td colSpan="10" className="p-6 text-center text-gray-500">No hay registros para mostrar.</td></tr>
                                )}
                                {filteredData.map((item) => (
                                    <tr key={item.count_id} className={`hover:bg-gray-50 ${item.difference !== 0 ? 'bg-orange-50/30' : ''}`}>
                                        <td className="p-3 flex gap-2">
                                            <button onClick={() => handleEditClick(item)} className="p-1 text-[#285f94] hover:bg-blue-50 rounded transition-colors" title="Editar">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                                </svg>
                                            </button>
                                            <button onClick={() => handleDeleteClick(item)} className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors" title="Eliminar">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            </button>
                                        </td>
                                        <td className="p-3 font-medium  text-[#1e4a74]">{item.item_code}</td>
                                        <td className="p-3 truncate max-w-xs" title={item.description}>{item.description}</td>
                                        <td className="p-3">{item.location}</td>
                                        <td className="p-3 text-right">{item.system_qty}</td>
                                        <td className="p-3 text-right font-medium ">{item.counted_qty}</td>
                                        <td className={`p-3 text-right font-medium  ${item.difference > 0 ? 'text-[#285f94]' : item.difference < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                            {item.difference > 0 ? `+${item.difference}` : item.difference}
                                        </td>
                                        <td className="p-3 text-right">{item.percentage_variance}%</td>
                                        <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                                            {item.date ? new Date(item.date).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-'}
                                        </td>
                                        <td className="p-3 text-xs text-gray-500">{item.username}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            {/* Modal Editar */}
            {editModal.open && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                        <h2 className="text-lg font-medium  mb-4">Editar Cantidad Contada</h2>
                        <div className="space-y-3 mb-6">
                            <div><span className="font-medium  text-xs text-gray-500 uppercase">Item Code:</span> <div className="font-mono">{editModal.itemCode}</div></div>
                            <div><span className="font-medium  text-xs text-gray-500 uppercase">Descripción:</span> <div className="text-sm">{editModal.desc}</div></div>
                            <div><span className="font-medium  text-xs text-gray-500 uppercase">Ubicación:</span> <div>{editModal.loc}</div></div>
                            <div><span className="font-medium  text-xs text-gray-500 uppercase">Qty Sistema:</span> <div>{editModal.system}</div></div>

                            <div>
                                <label className="block font-medium  mb-1">Nueva Cantidad Contada</label>
                                <input
                                    type="number"
                                    className="w-full border-2 border-[#285f94] rounded p-2 text-xl font-medium "
                                    value={editModal.counted}
                                    onChange={(e) => setEditModal({ ...editModal, counted: e.target.value })}
                                    autoFocus
                                    min="0"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setEditModal({ ...editModal, open: false })} className="px-4 py-2 border rounded hover:bg-gray-100">Cancelar</button>
                            <button onClick={handleSaveEdit} className="px-4 py-2 bg-[#285f94] text-white rounded hover:bg-[#1e4a74] font-medium ">Guardar Cambios</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Eliminar */}
            {deleteModal.open && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 border-t-4 border-red-600">
                        <h2 className="text-lg font-medium  mb-2 text-red-700">Confirmar Eliminación</h2>
                        <p className="mb-4 text-gray-700">
                            ¿Estás seguro de que deseas eliminar el registro del item <strong>{deleteModal.itemCode}</strong>?
                        </p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setDeleteModal({ ...deleteModal, open: false })} className="px-4 py-2 border rounded hover:bg-gray-100">Cancelar</button>
                            <button onClick={handleConfirmDelete} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-medium ">Eliminar</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default ManageCountDifferences;
