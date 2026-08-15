import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

const ViewCounts = () => {
    const navigate = useNavigate();
    const { setTitle } = useOutletContext();
    const [counts, setCounts] = useState([]);
    const [filteredCounts, setFilteredCounts] = useState([]);
    const [loading, setLoading] = useState(true);

    const [stats, setStats] = useState({
        total_items_to_count: 0,
        total_items_counted: 0,
        counted_locations: 0,
        total_units_counted: 0,
        progress_percentage: 0
    });
    const [selectedUser, setSelectedUser] = useState("");
    const [usernames, setUsernames] = useState([]);

    useEffect(() => { setTitle("Conteos W2W"); }, [setTitle]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Counts
            const resCounts = await fetch('/api/counts/all');
            if (!resCounts.ok) throw new Error("Error cargando conteos");
            const dataCounts = await resCounts.json();
            setCounts(dataCounts);
            setFilteredCounts(dataCounts);

            // Extract unique usernames for filter
            const distinctUsers = [...new Set(dataCounts.map(c => c.username).filter(Boolean))];
            setUsernames(distinctUsers);

            // 2. Fetch Stats
            const resStats = await fetch('/api/counts/stats');
            if (resStats.ok) {
                const dataStats = await resStats.json();
                setStats(dataStats);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Filter Logic
    useEffect(() => {
        if (!selectedUser) {
            setFilteredCounts(counts);
        } else {
            setFilteredCounts(counts.filter(c => c.username === selectedUser));
        }
    }, [selectedUser, counts]);

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este registro de conteo permanentemente?")) return;
        try {
            const res = await fetch(`/api/counts/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Error al eliminar");
            fetchData(); // Reload all
        } catch (e) { alert(e.message); }
    };

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-1 font-segoe-ui text-normal text-black">

            {/* Page Header */}
            <div className="mb-1 flex justify-end items-center border-b border-gray-100 pb-1.5">
                <div className="text-right">
                    <p className="text-[8px] text-gray-400 uppercase font-medium ">Estado del Proceso</p>
                    <p className="text-base font-light text-green-600">{stats.progress_percentage}% Completado</p>
                </div>
            </div>

            {/* Stats Cards Compact */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                {[
                    { title: 'Items con Stock', val: stats.total_items_to_count, color: 'text-gray-500' },
                    { title: 'Items Contados', val: stats.total_items_counted, color: 'text-gray-600' },
                    { title: 'Progreso', val: `${stats.progress_percentage}%`, color: 'text-green-700' },
                    { title: 'Ubic. Contadas', val: stats.counted_locations, color: 'text-gray-600' },
                    { title: 'Total Unidades', val: stats.total_units_counted, color: 'text-gray-600' }
                ].map((s, idx) => (
                    <div key={idx} className="bg-white border border-gray-200 rounded p-2 shadow-sm">
                        <h3 className={`text-[10px] font-normal  uppercase tracking-tight mb-1 ${s.color}`}>{s.title}</h3>
                        <p className={`text-xl font-normal ${s.color}`}>{s.val}</p>
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div className="flex justify-between items-center mb-6 p-3 bg-white rounded border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <label className="text-xs font-medium  text-gray-400 uppercase tracking-tight">Filtrar Auditor:</label>
                    <select
                        value={selectedUser}
                        onChange={(e) => setSelectedUser(e.target.value)}
                        className="h-8 border border-gray-300 rounded px-3 bg-gray-50 text-sm outline-none focus:border-blue-500 transition-colors"
                    >
                        <option value="">Todos los auditores</option>
                        {usernames.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                </div>
                <div className="flex gap-4">
                    <a
                        href="/api/export_counts?tz=America/Bogota"
                        className="inline-flex items-center px-4 py-1 border border-gray-300 text-gray-600 bg-white text-xs font-medium  uppercase tracking-tighter rounded hover:bg-gray-50 transition-colors"
                    >
                        Exportar Reporte
                    </a>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white shadow-sm rounded border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[calc(100vh-220px)]">
                    <table className="min-w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#1e4a74] text-white">
                            <tr>
                                {['Etapa', 'Sesión', 'Auditor', 'Fecha / Hora', 'Item Code', 'Descripción', 'Ubicación', 'Cant. Física', 'Cant. Sistema', 'Diferencia'].map((h, i) => (
                                    <th key={i} className={`px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider whitespace-nowrap ${['Cant. Física', 'Cant. Sistema', 'Diferencia'].includes(h) ? 'text-right' : 'text-left'}`}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan="10" className="py-2 px-2 text-center text-gray-400 font-normal text-xs">Cargando registros...</td></tr>
                            ) : filteredCounts.length === 0 ? (
                                <tr>
                                    <td colSpan="10" className="py-4 px-2 text-center text-gray-400 uppercase text-xs tracking-widest font-normal">
                                        No hay registros de conteo físico
                                    </td>
                                </tr>
                            ) : (
                                filteredCounts.map((c) => {
                                    const diff = c.difference ?? ((c.counted_qty ?? 0) - (c.system_qty ?? 0));
                                    return (
                                        <tr key={c.id} className="hover:bg-[#f5f8fc] transition-colors leading-none border-b border-gray-100 h-5">
                                            <td className="px-1.5 py-0 text-[10px] font-normal text-blue-600">E{c.inventory_stage || '1'}</td>
                                            <td className="px-1.5 py-0 text-[10px] font-normal text-gray-500">#{c.session_id}</td>
                                            <td className="px-1.5 py-0 text-[11px] font-normal text-slate-800">{c.username || 'N/A'}</td>
                                            <td className="px-1.5 py-0 text-[10px] font-normal text-gray-500 whitespace-nowrap">
                                                {c.timestamp ? new Date(c.timestamp).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                                            </td>
                                            <td className="px-1.5 py-0 text-[11px] font-normal text-slate-900 tracking-tight uppercase">{c.item_code}</td>
                                            <td className="px-1.5 py-0 text-[11px] text-gray-600 font-normal truncate max-w-[300px]" title={c.item_description}>{c.item_description}</td>
                                            <td className="px-1.5 py-0 text-[11px] font-normal text-slate-700 uppercase">{c.counted_location}</td>
                                            <td className="px-1.5 py-0 text-[11px] font-normal text-[#1e4a74] text-right">{c.counted_qty}</td>
                                            <td className="px-1.5 py-0 text-[11px] font-normal text-slate-700 text-right">{c.system_qty ?? 0}</td>
                                            <td className={`px-1.5 py-0 text-[11px] font-medium text-right ${
                                                diff < 0 ? 'text-red-600' : diff > 0 ? 'text-green-700' : 'text-gray-400'
                                            }`}>
                                                {diff > 0 ? `+${diff}` : diff}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ViewCounts;
