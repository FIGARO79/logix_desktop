import React, { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLocation } from 'react-router-dom';
import { getDB, getGRNExpectedQtyBulk } from '../utils/offlineDb';

const InboundHistory = () => {
    const { setTitle } = useOutletContext();
    const location = useLocation();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [versions, setVersions] = useState([]);
    const [currentVersion, setCurrentVersion] = useState('');

    const normalizeDate = (dateString) => {
        if (!dateString) return null;
        let normalized = dateString.trim().replace(' ', 'T');
        if (normalized.length === 10 && normalized.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return `${normalized}T00:00:00`;
        }
        const hasTimeZone = normalized.includes('Z') || normalized.match(/[+-]\d{2}:\d{2}$/);
        if (!hasTimeZone) normalized = `${normalized}Z`;
        return normalized;
    };

    const formatDate = (dateString) => {
        const normalized = normalizeDate(dateString);
        if (!normalized) return '-';
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return 'Fecha Inválida';
        return date.toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    };

    useEffect(() => {
        setTitle("Historial de Inbound");
        loadVersions();
    }, [setTitle]);

    const loadVersions = async () => {
        try {
            const res = await fetch('/api/logs/versions', { credentials: 'include' });
            if (res.ok) setVersions(await res.json());
        } catch (e) { console.error("Error loading versions", e); }
    };

    const loadLogs = async (version = '', isSilent = false) => {
        if (!isSilent) setLoading(true);
        setCurrentVersion(version);
        try {
            const url = version ? `/api/get_logs?version_date=${version}` : `/api/get_logs`;
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error("Error loading logs");
            const serverData = await res.json();

            // --- Cargar registros pendientes de IndexedDB ---
            let pendingLogs = [];
            if (!version) { // Solo mostrar pendientes en la versión actual
                try {
                    const db = await getDB();
                    const allPending = await db.getAll('pending_sync');
                    pendingLogs = allPending
                        .filter(p => p.collection === 'inbound')
                        .map(p => ({
                            id: p.id,
                            ...p.payload,
                            username: 'TÚ (Pendiente)',
                            is_pending: true
                        }));
                } catch (e) { console.error("Error loading pending logs", e); }
            }

            const combinedData = [...pendingLogs, ...serverData];

            // Ordenar por fecha (más reciente primero)
            const sortedData = combinedData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Obtener datos de cantidades esperadas desde IndexedDB (Cache local) de forma masiva
            let grnMap = {};
            try {
                const db = await getDB();
                const itemsToQuery = sortedData.map(log => ({
                    itemCode: log.itemCode,
                    importRef: log.importReference || log.importRef || ''
                }));
                grnMap = await getGRNExpectedQtyBulk(db, itemsToQuery);
            } catch (e) { console.error("Offline GRN error", e); }

            // Calcular totales recibidos por ítem y por IR
            const totalsMap = {};
            const latestEntryMap = {};

            sortedData.forEach(log => {
                const code = log.itemCode;
                const ir = log.importReference || log.importRef || '';
                const key = `${code}|${ir}`;
                const qty = parseInt(log.qtyReceived) || 0;
                totalsMap[key] = (totalsMap[key] || 0) + qty;
                if (!latestEntryMap[key]) {
                    latestEntryMap[key] = log.id;
                }
            });

            const enrichedLogs = sortedData.map(log => {
                const code = log.itemCode;
                const ir = log.importReference || log.importRef || '';
                const key = `${code}|${ir}`;
                const expected = log.qtyGrn || grnMap[key] || 0;
                const totalReceived = totalsMap[key] || 0;
                const isLatest = latestEntryMap[key] === log.id;

                return {
                    ...log,
                    expected_qty: expected,
                    calculatedDifference: isLatest ? (totalReceived - expected) : 0
                };
            });

            setLogs(enrichedLogs);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLogs();
        // Intervalo para refrescar y ver si los pendientes ya se sincronizaron
        const interval = setInterval(() => {
            // Solo si no estamos viendo una versión archivada
            if (!currentVersion) loadLogs('', true);
        }, 15000);
        return () => clearInterval(interval);
    }, [currentVersion]);

    // Recargar datos automáticamente cuando la pestaña de Historial/Registros vuelve a estar activa
    useEffect(() => {
        if (location.pathname === '/view_logs' && !currentVersion) {
            loadLogs('', true); // Recarga silenciosa (sin loader) conservando filtros de búsqueda
        }
    }, [location.pathname, currentVersion]);

    const filteredLogs = logs.filter(log =>
        (log.itemCode && log.itemCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.waybill && log.waybill.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.importReference && log.importReference.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.username && log.username.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="w-full px-4 py-3">
            {/* Header con Buscador y Selector de Versiones */}
            <div className="flex flex-col md:flex-row justify-end items-center mb-2 bg-white p-1.5 rounded shadow-sm border border-gray-200">
                <div className="flex gap-2 items-center">
                    <div className="relative w-full sm:w-64 flex-shrink-0">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            style={{ height: '32px', paddingTop: '4px', paddingBottom: '4px' }}
                            className="px-2 pr-7 text-xs border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-[#285f94] focus:border-[#285f94] focus:outline-none w-full transition-all duration-150"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="absolute right-1 top-1/2 -translate-y-1/2 text-black/60 hover:text-black focus:outline-none"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                </svg>
                            </button>
                        )}
                    </div>
                    <select
                        onChange={(e) => loadLogs(e.target.value)}
                        style={{ height: '32px', paddingTop: '4px', paddingBottom: '4px' }}
                        className="p-1 text-[12px] font-normal bg-white border border-gray-300 rounded-md shadow-sm outline-none focus:border-[#285f94] w-full sm:w-40"
                    >
                        <option value="">Actual</option>
                        {versions.map(v => <option key={v} value={v}>{formatDate(v)}</option>)}
                    </select>
                    <button
                        onClick={() => window.location.href = currentVersion ? `/api/export_log?version_date=${currentVersion}` : '/api/export_log'}
                        style={{ height: '32px', paddingTop: '4px', paddingBottom: '4px' }}
                        className="p-1 font-normal bg-emerald-600 text-white rounded-md shadow-sm hover:bg-emerald-700 flex items-center gap-1.5 transition-all"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l2.914 2.914a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" /></svg>
                        Exportar
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-100 text-red-700 p-3 mb-4 rounded text-sm">{error}</div>}

            {/* Tabla Enriquecida */}
            <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
                <div className="overflow-x-auto max-h-[70vh]">
                    <table className="w-full text-xs border-collapse">
                        <thead className="bg-slate-700 text-white sticky top-0 z-10">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium">TIMESTAMP</th>
                                <th className="px-2 py-1.5 text-left font-medium">USUARIO</th>
                                <th className="px-2 py-1.5 text-left font-medium">I.R.</th>
                                <th className="px-2 py-1.5 text-left font-medium">WAYBILL</th>
                                <th className="px-2 py-1.5 text-left font-medium">ITEM CODE</th>
                                <th className="px-2 py-1.5 text-left font-medium">DESCRIPCIÓN</th>
                                <th className="px-2 py-1.5 text-left font-medium">UBICACIÓN</th>
                                <th className="px-2 py-1.5 text-left font-medium">REUBICACIÓN</th>
                                <th className="px-2 py-1.5 text-center font-medium">CANT. RECIBIDA</th>
                                <th className="px-2 py-1.5 text-center font-medium">CANT. ESPERADA</th>
                                <th className="px-2 py-1.5 text-center font-medium">DIFERENCIA</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {loading && <tr><td colSpan="11" className="py-4 text-center text-black/60">Cargando...</td></tr>}
                            {!loading && filteredLogs.length === 0 && <tr><td colSpan="11" className="py-4 text-center text-black/60">No se encontraron registros.</td></tr>}
                            {filteredLogs.map((log, idx) => (
                                <tr key={log.id} className={`${log.is_pending ? 'bg-amber-50 animate-pulse' : (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')} hover:bg-blue-50 transition-colors`}>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black">{formatDate(log.timestamp)}</td>
                                    <td className={`px-2 py-1.5 whitespace-nowrap font-normal text-sm ${log.is_pending ? 'text-amber-700' : 'text-black'} uppercase`}>{log.username}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black">{log.importReference}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black">{log.waybill}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black font-normal">{log.itemCode}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black truncate max-w-md" title={log.itemDescription}>{log.itemDescription}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black">{log.binLocation}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-black">{log.relocatedBin}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-center font-normal">{log.qtyReceived}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-sm text-center text-black font-normal">{log.expected_qty}</td>
                                    <td className={`px-2 py-1.5 whitespace-nowrap text-sm text-center font-normal ${log.calculatedDifference < 0 ? 'text-red-600' : log.calculatedDifference > 0 ? 'text-blue-600' : ''}`}>
                                        {log.calculatedDifference > 0 ? `+${log.calculatedDifference}` : log.calculatedDifference}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default InboundHistory;
