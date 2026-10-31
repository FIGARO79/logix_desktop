import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { getDB, cacheData, getCachedData } from '../utils/offlineDb';

const CycleCountHistory = () => {
    const navigate = useNavigate();
    const { setTitle } = useOutletContext();
    const [recordings, setRecordings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    const normalizeDate = (dateString) => {
        if (!dateString) return null;
        let normalized = dateString.trim().replace(' ', 'T');

        if (normalized.length === 10 && normalized.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return `${normalized}T00:00:00`;
        }

        const hasTimeZone = normalized.includes('Z') ||
            normalized.match(/[+-]\d{2}:\d{2}$/) ||
            (normalized.includes('-') && normalized.split('T')[1]?.includes('-'));
        if (!hasTimeZone) normalized = `${normalized}Z`;
        return normalized;
    };

    const formatDate = (dateString) => {
        const normalized = normalizeDate(dateString);
        if (!normalized) return '-';
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return 'Fecha Inválida';
        return date.toLocaleString(undefined, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    // LAZY LOADING: Solo renderizar las primeras N filas
    const [displayCount, setDisplayCount] = useState(50);
    const observerTarget = useRef(null);

    useEffect(() => {
        setTitle("Conteos Cíclicos");
    }, [setTitle]);

    useEffect(() => {
        const fetchRecordings = async () => {
            setLoading(true);
            setError(null);
            try {
                let data = [];
                const res = await fetch('/api/counts/recordings').catch(() => null);
                if (res && res.ok) {
                    data = await res.json().catch(() => []);
                    if (data.length > 0) {
                        await cacheData('cycle_count_recordings', data);
                    }
                }

                const db = await getDB();
                const directCounts = await db.getAll('local_counts') || [];
                const cached = await getCachedData('cycle_count_recordings') || [];
                const pending = await db.getAll('pending_sync') || [];
                const legacyPendingCounts = pending
                    .filter(p => p.collection === 'cycle_count' || p.collection === 'counts')
                    .map((p, idx) => ({
                        id: p.id || idx,
                        item_code: p.payload?.item_code || 'N/A',
                        description: p.payload?.description || 'N/A',
                        bin_location: p.payload?.bin_location || 'N/A',
                        system_qty: p.payload?.system_qty || 0,
                        physical_qty: p.payload?.counted_qty || 0,
                        difference: (p.payload?.counted_qty || 0) - (p.payload?.system_qty || 0),
                        username: 'Local',
                        executed_date: p.timestamp || new Date().toISOString()
                    }));

                const combined = [...directCounts, ...cached, ...legacyPendingCounts];
                setRecordings(combined);
            } catch (err) {
                console.error("Error al cargar grabaciones de conteo:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchRecordings();
    }, []);

    // Format currency
    const formatMoney = (amount) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    const handleExport = () => {
        if (recordings.length === 0) return alert("No hay datos de conteos para exportar.");
        const filtered = recordings.filter(rec =>
            (rec.item_code && rec.item_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (rec.description && rec.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (rec.username && rec.username.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        const headers = ['ID', 'Item Code', 'Description', 'Bin Location', 'System Qty', 'Counted Qty', 'Difference', 'Cost', 'User', 'Timestamp'];
        const csvRows = [headers.join(',')];

        filtered.forEach(rec => {
            const row = [
                `"${rec.id || ''}"`,
                `"${rec.item_code || ''}"`,
                `"${(rec.description || '').replace(/"/g, '""')}"`,
                `"${rec.bin_location || ''}"`,
                rec.system_qty || 0,
                rec.physical_qty || 0,
                rec.difference || 0,
                rec.cost || 0,
                `"${rec.username || ''}"`,
                `"${rec.executed_date || ''}"`
            ];
            csvRows.push(row.join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Reporte_Conteos_Ciclicos_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const filteredRecordings = recordings.filter(rec =>
        (rec.item_code && rec.item_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (rec.description && rec.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (rec.username && rec.username.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    // LAZY LOADING: Cargar más filas cuando el usuario hace scroll
    const loadMore = useCallback(() => {
        if (displayCount < filteredRecordings.length) {
            setDisplayCount(prev => Math.min(prev + 50, filteredRecordings.length));
        }
    }, [displayCount, filteredRecordings.length]);

    // LAZY LOADING: Intersection Observer para detectar scroll
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        const currentTarget = observerTarget.current;
        if (currentTarget) {
            observer.observe(currentTarget);
        }

        return () => {
            if (currentTarget) {
                observer.unobserve(currentTarget);
            }
        };
    }, [loadMore]);

    // Reset display count cuando cambia el filtro
    useEffect(() => {
        setDisplayCount(50);
    }, [searchTerm]);

    // Solo renderizar las primeras displayCount filas
    const visibleRecordings = filteredRecordings.slice(0, displayCount);

    return (
        <div className="w-full h-[calc(100vh-110px)] flex flex-col font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f] bg-[#f8f9fa]">
            {/* Header bar con controles Fluent UI */}
            <div className="bg-white border-b border-[#d1d5db] px-4 py-2 flex justify-between items-center z-20 shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Historial de Conteos Cíclicos</h1>
                    <span className="text-[11px] font-normal text-[#5c5c5c]">Registro histórico y auditoría de grabaciones de inventario</span>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        placeholder="Buscar por código, descripción o usuario..."
                        className="h-7 px-2 border border-[#d1d5db] rounded text-[12px] font-normal text-[#1f1f1f] w-72 focus:outline-none focus:border-[#0067c0] bg-white"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <button
                        onClick={handleExport}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                        <svg className="w-3.5 h-3.5 text-[#5c5c5c]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l2.914 2.914a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>Exportar</span>
                    </button>
                    <button
                        onClick={() => navigate('/counts')}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#5c5c5c] hover:text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                    >
                        Volver
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-4 pb-4 pt-2 relative">
                {loading && <div className="text-center p-8 text-[12px] font-normal text-[#5c5c5c]">Cargando datos...</div>}
                {error && <div className="bg-[#fef2f2] border border-[#fecaca] text-[#991b1b] p-3 rounded text-[12px] font-normal mb-4">{error}</div>}

                {!loading && !error && (
                    <table className="min-w-max text-left border-collapse bg-white shadow-sm text-[11.5px]">
                        <thead className="bg-[#354a5f] text-white sticky top-0 z-20">
                            <tr className="border-b border-[#2a3c4e]">
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">SR</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">Código</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap max-w-xs">Descripción</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">Tipo</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">Clase</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">Grupo</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">SIC (CO)</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">SIC (SR)</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Peso</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-center">ABC</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">Ubicación</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Stock Sis</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Físico</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Dif</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Valor Dif</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Costo Item</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Valor Conteo</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap text-right">Fecha</th>
                                <th className="px-3 py-2 text-[11px] font-normal whitespace-nowrap">Usuario</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e5e7eb]">
                            {visibleRecordings.map((rec, idx) => (
                                <tr key={`rec-${rec.id || idx}`} className={`hover:bg-[#edf3f9] transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.stockroom}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap">
                                        <span className="text-[#0067c0] hover:underline cursor-pointer">{rec.item_code}</span>
                                    </td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap truncate max-w-xs text-[#1f1f1f]" title={rec.description}>{rec.description}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.item_type}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.item_class}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.item_group}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.sic_company}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.sic_stockroom}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#5c5c5c]">{rec.weight}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-center text-[#1f1f1f]">{rec.abc_code}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-left font-mono text-[#5c5c5c]">{rec.bin_location}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#1f1f1f]">{rec.system_qty}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#1f1f1f]">{rec.physical_qty}</td>
                                    <td className={`px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right ${rec.difference !== 0 ? 'text-[#991b1b]' : 'text-[#8c8c8c]'}`}>
                                        {rec.difference}
                                    </td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#1f1f1f]">{formatMoney(rec.value_diff)}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#5c5c5c]">{formatMoney(rec.cost)}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#1f1f1f]">{formatMoney(rec.count_value)}</td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-right text-[#5c5c5c]">
                                        {formatDate(rec.executed_date)}
                                    </td>
                                    <td className="px-3 py-1.5 text-[11.5px] font-normal whitespace-nowrap text-[#5c5c5c]">{rec.username}</td>
                                </tr>
                            ))}
                            {/* Sentinel element para detectar scroll */}
                            {displayCount < filteredRecordings.length && (
                                <tr ref={observerTarget}>
                                    <td colSpan="19" className="px-4 py-3 text-center text-[#5c5c5c] text-[11px] font-normal">
                                        Cargando más registros... ({displayCount} de {filteredRecordings.length})
                                    </td>
                                </tr>
                            )}
                            {filteredRecordings.length === 0 && (
                                <tr>
                                    <td colSpan="19" className="px-4 py-8 text-center text-[#5c5c5c] text-[12px] font-normal">
                                        No se encontraron registros que coincidan con la búsqueda.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default CycleCountHistory;
