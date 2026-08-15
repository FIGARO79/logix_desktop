import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

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
            try {
                const res = await fetch('/api/counts/recordings');
                if (!res.ok) throw new Error("Error loading recordings");
                const data = await res.json();
                setRecordings(data);
            } catch (err) {
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
        const params = new URLSearchParams();
        window.location.href = `/api/counts/export_recordings?${params.toString()}`;
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
        <div className="w-full h-[calc(100vh-110px)] flex flex-col font-sans text-[#333] gap-1 mt-2">
            {/* Header bar similiar to screenshot */}
            <div className="bg-white border-b border-gray-100 px-6 py-2 flex justify-end items-center z-20">
                <div className="flex gap-3">
                    <input
                        type="text"
                        placeholder="Buscar..."
                        className="border border-gray-300 px-3 py-1.5 rounded text-sm w-64 focus:outline-none focus:border-[#285f94]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <button
                        onClick={handleExport}
                        className="bg-white border border-[#285f94] text-[#285f94] hover:bg-blue-50 px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l2.914 2.914a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" /></svg>
                        Exportar
                    </button>
                    {/* Add Back button just in case */}
                    <button onClick={() => navigate('/counts')} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-6 pb-4 pt-0 relative">
                {loading && <div className="text-center p-8 text-sm text-gray-500">Cargando datos...</div>}
                {error && <div className="bg-red-100 text-red-700 p-3 rounded text-sm mb-4">{error}</div>}

                {!loading && !error && (
                    <table className="min-w-max text-left border-collapse bg-white shadow-sm text-[11px] leading-tight">
                        <thead className="bg-[#34495e] text-white sticky top-0 z-20 shadow">
                            <tr>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">SR</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">ITEM CODE</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap max-w-xs">DESCRIPTION</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">ITEM TYPE</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">CLASS</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">GROUP</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">SIC (CO)</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">SIC (SR)</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">WEIGHT</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center">ABC</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">BIN</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">SYS STOCK</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">COUNTED</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">DIFF</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">VALUE (DIFF)</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">ITEM COST</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">COUNT VALUE</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">DATE</th>
                                <th className="px-3 py-3 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">USER</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleRecordings.map((rec, idx) => (
                                <tr key={`rec-${rec.id || idx}`} className={`hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">{rec.stockroom}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">
                                        <span className="text-[#285f94] font-medium hover:underline cursor-pointer">{rec.item_code}</span>
                                    </td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap truncate max-w-xs" title={rec.description}>{rec.description}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">{rec.item_type}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">{rec.item_class}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">{rec.item_group}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">{rec.sic_company}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap">{rec.sic_stockroom}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">{rec.weight}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center">{rec.abc_code}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-left">{rec.bin_location}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center">{rec.system_qty}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center">{rec.physical_qty}</td>
                                    <td className={`px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center ${rec.difference !== 0 ? 'text-red-600' : 'text-gray-300'}`}>
                                        {rec.difference}
                                    </td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">{formatMoney(rec.value_diff)}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">{formatMoney(rec.cost)}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-right">{formatMoney(rec.count_value)}</td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center">
                                        {formatDate(rec.executed_date)}
                                    </td>
                                    <td className="px-3 py-2 text-[12px] font-normal  uppercase tracking-wider whitespace-nowrap text-center">{rec.username}</td>
                                </tr>
                            ))}
                            {/* Sentinel element para detectar scroll */}
                            {displayCount < filteredRecordings.length && (
                                <tr ref={observerTarget}>
                                    <td colSpan="19" className="px-4 py-4 text-center text-gray-400 text-xs">
                                        Cargando más registros... ({displayCount} de {filteredRecordings.length})
                                    </td>
                                </tr>
                            )}
                            {filteredRecordings.length === 0 && (
                                <tr>
                                    <td colSpan="19" className="px-4 py-12 text-center text-gray-400">
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
