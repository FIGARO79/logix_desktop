import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { getDB, cacheData, getCachedData } from '../utils/offlineDb';

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
            let dataCounts = [];
            let dataStats = null;

            const resCounts = await fetch('/api/counts/all').catch(() => null);
            if (resCounts && resCounts.ok) {
                dataCounts = await resCounts.json().catch(() => []);
                if (dataCounts.length > 0) {
                    await cacheData('last_w2w_counts', dataCounts);
                }
            }

            const resStats = await fetch('/api/counts/stats').catch(() => null);
            if (resStats && resStats.ok) {
                dataStats = await resStats.json().catch(() => null);
            }

            if (!dataCounts || dataCounts.length === 0) {
                const cached = await getCachedData('last_w2w_counts');
                if (cached) {
                    dataCounts = cached;
                } else {
                    const db = await getDB();
                    const pending = await db.getAll('pending_sync') || [];
                    dataCounts = pending
                        .filter(p => p.collection === 'w2w' || p.collection === 'counts')
                        .map((p, idx) => ({
                            id: p.id || idx,
                            item_code: p.payload?.item_code || 'N/A',
                            description: p.payload?.description || 'N/A',
                            bin_location: p.payload?.bin_location || 'N/A',
                            counted_qty: p.payload?.counted_qty || 0,
                            username: p.payload?.username || 'Local',
                            timestamp: p.timestamp || new Date().toISOString()
                        }));
                }
            }

            setCounts(dataCounts);
            setFilteredCounts(dataCounts);

            const distinctUsers = [...new Set(dataCounts.map(c => c.username).filter(Boolean))];
            setUsernames(distinctUsers);

            if (dataStats) setStats(dataStats);
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
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f] bg-[#f8f9fa] min-h-screen">

            {/* Page Header */}
            <div className="mb-3 flex justify-between items-center bg-white px-4 py-2.5 rounded border border-[#d1d5db] shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Conteos W2W - Vista Agrupada</h1>
                    <p className="text-[11px] font-normal text-[#5c5c5c] mt-0.5 mb-0">Resumen y avance global de inventario wall-to-wall</p>
                </div>
                <div className="text-right">
                    <span className="text-[10px] text-[#5c5c5c] block">Estado del Proceso</span>
                    <span className="text-[13px] font-normal text-[#065f46]">{stats.progress_percentage}% Completado</span>
                </div>
            </div>

            {/* Stats Cards Compact */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                {[
                    { title: 'Items con Stock', val: stats.total_items_to_count, color: 'text-[#1f1f1f]' },
                    { title: 'Items Contados', val: stats.total_items_counted, color: 'text-[#0067c0]' },
                    { title: 'Progreso', val: `${stats.progress_percentage}%`, color: 'text-[#065f46]' },
                    { title: 'Ubic. Contadas', val: stats.counted_locations, color: 'text-[#1f1f1f]' },
                    { title: 'Total Unidades', val: stats.total_units_counted, color: 'text-[#1f1f1f]' }
                ].map((s, idx) => (
                    <div key={idx} className="bg-white border border-[#d1d5db] rounded p-2.5 shadow-sm">
                        <h3 className="text-[11px] font-normal text-[#5c5c5c] mb-1">{s.title}</h3>
                        <p className={`text-[16px] font-normal m-0 ${s.color}`}>{s.val}</p>
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div className="flex justify-between items-center mb-3 p-3 bg-white rounded border border-[#d1d5db] shadow-sm">
                <div className="flex items-center gap-2">
                    <label className="text-[11px] font-normal text-[#5c5c5c]">Filtrar Auditor:</label>
                    <select
                        value={selectedUser}
                        onChange={(e) => setSelectedUser(e.target.value)}
                        className="h-7 border border-[#d1d5db] rounded px-2 bg-white text-[12px] font-normal outline-none focus:border-[#0067c0] text-[#1f1f1f] cursor-pointer"
                    >
                        <option value="">Todos los auditores</option>
                        {usernames.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                </div>
                <div className="flex gap-2">
                    <a
                        href="/api/export_counts?tz=America/Bogota"
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded inline-flex items-center gap-1.5 transition-colors no-underline"
                    >
                        <svg className="w-3.5 h-3.5 text-[#5c5c5c]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l2.914 2.914a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>Exportar Reporte</span>
                    </a>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white shadow-sm rounded border border-[#d1d5db] overflow-hidden">
                <div className="overflow-x-auto max-h-[calc(100vh-220px)]">
                    <table className="min-w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#354a5f] text-white border-b border-[#2a3c4e]">
                            <tr>
                                {['Etapa', 'Sesión', 'Auditor', 'Fecha / Hora', 'Item Code', 'Descripción', 'Ubicación', 'Cant. Física', 'Cant. Sistema', 'Diferencia'].map((h, i) => (
                                    <th key={i} className={`px-2.5 py-1.5 text-[11px] font-normal whitespace-nowrap ${['Cant. Física', 'Cant. Sistema', 'Diferencia'].includes(h) ? 'text-right' : 'text-left'}`}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e5e7eb]">
                            {loading ? (
                                <tr><td colSpan="10" className="py-4 px-2 text-center text-[#5c5c5c] font-normal text-[12px]">Cargando registros...</td></tr>
                            ) : filteredCounts.length === 0 ? (
                                <tr>
                                    <td colSpan="10" className="py-6 px-2 text-center text-[#5c5c5c] text-[12px] font-normal">
                                        No hay registros de conteo físico
                                    </td>
                                </tr>
                            ) : (
                                filteredCounts.map((c) => {
                                    const diff = c.difference ?? ((c.counted_qty ?? 0) - (c.system_qty ?? 0));
                                    return (
                                        <tr key={c.id} className="hover:bg-[#edf3f9] transition-colors border-b border-[#f0f0f0] h-7 text-[11.5px] font-normal text-[#1f1f1f]">
                                            <td className="px-2.5 py-1 text-[11px] font-normal text-[#0067c0]">E{c.inventory_stage || '1'}</td>
                                            <td className="px-2.5 py-1 text-[11px] font-normal text-[#5c5c5c]">#{c.session_id}</td>
                                            <td className="px-2.5 py-1 text-[11.5px] font-normal text-[#1f1f1f]">{c.username || 'N/A'}</td>
                                            <td className="px-2.5 py-1 text-[11px] font-normal text-[#5c5c5c] whitespace-nowrap">
                                                {c.timestamp ? new Date(c.timestamp).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                                            </td>
                                            <td className="px-2.5 py-1 text-[11.5px] font-normal text-[#0067c0]">{c.item_code}</td>
                                            <td className="px-2.5 py-1 text-[11.5px] text-[#5c5c5c] font-normal truncate max-w-[300px]" title={c.item_description}>{c.item_description}</td>
                                            <td className="px-2.5 py-1 text-[11.5px] font-mono text-[#5c5c5c]">{c.counted_location}</td>
                                            <td className="px-2.5 py-1 text-[11.5px] font-normal text-[#0067c0] text-right">{c.counted_qty}</td>
                                            <td className="px-2.5 py-1 text-[11.5px] font-normal text-[#1f1f1f] text-right">{c.system_qty ?? 0}</td>
                                            <td className={`px-2.5 py-1 text-[11.5px] font-normal text-right ${
                                                diff < 0 ? 'text-[#991b1b]' : diff > 0 ? 'text-[#065f46]' : 'text-[#8c8c8c]'
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
