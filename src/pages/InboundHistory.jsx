import React, { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { getDB, getGRNExpectedQtyBulk } from '../utils/offlineDb';
import { isTauri, callTauriCommand } from '../utils/tauriBridge';

const InboundHistory = () => {
    const { setTitle } = useOutletContext();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [versions, setVersions] = useState([]);
    const [currentVersion, setCurrentVersion] = useState('');
    const [isSyncingNetwork, setIsSyncingNetwork] = useState(false);

    const handleNetworkSync = async () => {
        if (isSyncingNetwork) return;
        setIsSyncingNetwork(true);
        try {
            if (isTauri()) {
                await callTauriCommand('sync_inbound_logs_network');
            }
            await loadLogs(currentVersion, true);
        } catch (err) {
            console.error("Error sincronizando logs con la red:", err);
        } finally {
            setIsSyncingNetwork(false);
        }
    };

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
            const res = await fetch('/api/logs/versions', { credentials: 'include' }).catch(() => null);
            if (res && res.ok) setVersions(await res.json().catch(() => []));
        } catch (e) { console.error("Error loading versions", e); }
    };

    const loadLogs = async (version = '', isSilent = false) => {
        if (!isSilent) setLoading(true);
        setCurrentVersion(version);
        setError(null);
        try {
            let serverData = [];
            const url = version ? `/api/get_logs?version_date=${version}` : `/api/get_logs`;
            const res = await fetch(url, { credentials: 'include' }).catch(() => null);
            if (res && res.ok) {
                serverData = await res.json().catch(() => []);
            }

            // --- Cargar registros locales directos de IndexedDB ---
            let localLogs = [];
            if (!version) {
                try {
                    const db = await getDB();
                    if (db) {
                        const directInbound = await db.getAll('local_inbound') || [];
                        const allPending = await db.getAll('pending_sync') || [];
                        const legacyPending = allPending
                            .filter(p => p.collection === 'inbound')
                            .map(p => ({
                                id: p.id,
                                ...p.payload,
                                username: 'Local',
                                timestamp: p.timestamp || new Date().toISOString()
                            }));

                        localLogs = [...directInbound, ...legacyPending];
                    }
                } catch (e) {
                    console.warn("Info loading local inbound logs:", e);
                }
            }

            const rawList = Array.isArray(serverData) ? [...localLogs, ...serverData] : [...localLogs];

            // Ordenar por fecha (más reciente primero)
            const sortedData = rawList.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

            // Obtener datos de cantidades esperadas desde IndexedDB (Cache local) de forma masiva
            let grnMap = {};
            try {
                const db = await getDB();
                if (db) {
                    const itemsToQuery = sortedData.map(log => ({
                        itemCode: log.itemCode || log.item_code,
                        importRef: log.importReference || log.import_reference || log.importRef || ''
                    }));
                    grnMap = await getGRNExpectedQtyBulk(db, itemsToQuery);
                }
            } catch (e) {
                console.warn("Offline GRN expected bulk:", e);
            }

            // Calcular totales recibidos por ítem y por IR
            const totalsMap = {};
            const latestEntryMap = {};

            sortedData.forEach(log => {
                const code = log.itemCode || log.item_code || '';
                const ir = log.importReference || log.import_reference || log.importRef || '';
                const key = `${code}|${ir}`;
                const qty = parseInt(log.qtyReceived ?? log.qty_received ?? log.quantity ?? 0, 10) || 0;
                totalsMap[key] = (totalsMap[key] || 0) + qty;
                if (!latestEntryMap[key]) {
                    latestEntryMap[key] = log.id;
                }
            });

            const enrichedLogs = sortedData.map(log => {
                const code = log.itemCode || log.item_code || '';
                const ir = log.importReference || log.import_reference || log.importRef || '';
                const key = `${code}|${ir}`;
                const expected = log.qtyGrn !== undefined && log.qtyGrn !== null ? log.qtyGrn : (log.qty_grn !== undefined && log.qty_grn !== null ? log.qty_grn : (grnMap[key] || 0));
                const totalReceived = totalsMap[key] || 0;
                const isLatest = latestEntryMap[key] === log.id;

                return {
                    ...log,
                    itemCode: code,
                    itemDescription: log.itemDescription || log.item_description || log.description || '',
                    importReference: ir,
                    waybill: log.waybill || '',
                    binLocation: log.binLocation || log.bin_location || '',
                    relocatedBin: log.relocatedBin || log.relocated_bin || '',
                    qtyReceived: log.qtyReceived ?? log.qty_received ?? log.quantity ?? 0,
                    expected_qty: expected,
                    calculatedDifference: isLatest ? (totalReceived - expected) : (log.difference !== undefined ? log.difference : 0)
                };
            });

            setLogs(enrichedLogs);
        } catch (err) {
            console.error("Error al cargar historial:", err);
            setError(err.message || "Error al cargar historial de inbound");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLogs();

        let unlistenSync = null;
        let isMounted = true;
        if (isTauri()) {
            import('@tauri-apps/api/event').then(eventApi => {
                if (eventApi && typeof eventApi.listen === 'function' && isMounted) {
                    eventApi.listen('network-sync-event', (event) => {
                        const evType = event?.payload?.event_type;
                        if (!evType || evType.startsWith('INBOUND') || evType === 'WORK_FILE_UPLOAD') {
                            loadLogs(currentVersion, true);
                        }
                    }).then(fn => { unlistenSync = fn; }).catch(console.warn);
                }
            }).catch(console.warn);
        }

        const interval = setInterval(() => {
            if (!currentVersion) loadLogs('', true);
        }, 15000);
        return () => {
            isMounted = false;
            clearInterval(interval);
            if (typeof unlistenSync === 'function') unlistenSync();
        };
    }, [currentVersion]);

    const filteredLogs = logs.filter(log => {
        const search = searchTerm.trim().toLowerCase();
        if (!search) return true;
        const code = (log.itemCode || log.item_code || '').toLowerCase();
        const wb = (log.waybill || '').toLowerCase();
        const ir = (log.importReference || log.import_reference || '').toLowerCase();
        const user = (log.username || '').toLowerCase();
        const desc = (log.itemDescription || log.item_description || '').toLowerCase();
        return code.includes(search) || wb.includes(search) || ir.includes(search) || user.includes(search) || desc.includes(search);
    });

    return (
        <div className="w-full px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] font-normal tracking-normal text-[12px] text-[#1f1f1f]">
            {/* Header con Buscador y Selector de Versiones */}
            <div className="flex flex-col md:flex-row justify-end items-center mb-2 bg-white p-2 rounded border border-[#e5e5e5] shadow-sm">
                <div className="flex gap-2 items-center w-full md:w-auto">
                    <div className="relative w-full sm:w-64 flex-shrink-0">
                        <input
                            type="text"
                            placeholder="Buscar por código, IR, descripción..."
                            className="w-full h-7 px-2 pr-6 text-[12px] border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] font-normal"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#707070] hover:text-[#1f1f1f] text-[11px] cursor-pointer"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <select
                        onChange={(e) => loadLogs(e.target.value)}
                        value={currentVersion}
                        className="h-7 px-2 text-[12px] font-normal bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] w-full sm:w-44 cursor-pointer"
                    >
                        <option value="">Actual</option>
                        {versions.map(v => <option key={v} value={v}>{formatDate(v)}</option>)}
                    </select>
                    <button
                        onClick={handleNetworkSync}
                        disabled={isSyncingNetwork}
                        className={`h-7 px-2.5 font-normal bg-white hover:bg-gray-100 border border-[#d1d5db] text-[#1f1f1f] rounded shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer text-[12px] ${isSyncingNetwork ? 'opacity-70 cursor-wait' : ''}`}
                        title="Transmitir y sincronizar todos los logs de inbound con las demás máquinas en la red"
                    >
                        <svg className={`w-3.5 h-3.5 text-[#1f1f1f] ${isSyncingNetwork ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Sincronizar Red</span>
                    </button>
                    <button
                        onClick={() => window.location.href = currentVersion ? `/api/export_log?version_date=${currentVersion}` : '/api/export_log'}
                        className="h-7 px-3 font-normal bg-[#354a5f] hover:bg-[#2a3c4e] text-white rounded shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer text-[12px]"
                    >
                        Exportar
                    </button>
                </div>
            </div>

            {error && <div className="bg-[#fef2f2] border border-[#fecaca] text-[#a80000] p-2.5 mb-2 rounded text-[12px] font-normal">{error}</div>}

            {/* Tabla Enriquecida */}
            <div className="bg-white rounded border border-[#e5e5e5] overflow-hidden shadow-sm">
                <div className="overflow-x-auto max-h-[70vh]">
                    <table className="w-full text-[11.5px] border-collapse">
                        <thead className="bg-[#354a5f] text-white sticky top-0 z-10 font-normal text-[11px]">
                            <tr>
                                <th className="px-2.5 py-1.5 text-left font-normal">TIMESTAMP</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">USUARIO</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">I.R.</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">WAYBILL</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">ITEM CODE</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">DESCRIPCIÓN</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">UBICACIÓN</th>
                                <th className="px-2.5 py-1.5 text-left font-normal">REUBICACIÓN</th>
                                <th className="px-2.5 py-1.5 text-center font-normal">CANT. RECIBIDA</th>
                                <th className="px-2.5 py-1.5 text-center font-normal">CANT. ESPERADA</th>
                                <th className="px-2.5 py-1.5 text-center font-normal">DIFERENCIA</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f1f1f1]">
                            {loading && <tr><td colSpan="11" className="py-8 text-center text-[#616161]">Cargando...</td></tr>}
                            {!loading && filteredLogs.length === 0 && <tr><td colSpan="11" className="py-8 text-center text-[#616161]">No se encontraron registros.</td></tr>}
                            {filteredLogs.map((log, idx) => (
                                <tr key={log.id || idx} className={`${log.is_pending ? 'bg-[#fff4ce]' : (idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]')} hover:bg-[#edf3f9] transition-colors`}>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#616161]">{formatDate(log.timestamp)}</td>
                                    <td className={`px-2.5 py-1.5 whitespace-nowrap font-normal ${log.is_pending ? 'text-[#794e00]' : 'text-[#1f1f1f]'} uppercase`}>{log.username || 'admin'}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#1f1f1f]">{log.importReference || '-'}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#1f1f1f]">{log.waybill || '-'}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#0067c0] font-normal">{log.itemCode}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#1f1f1f] truncate max-w-md" title={log.itemDescription}>{log.itemDescription || '-'}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#1f1f1f]">{log.binLocation || '-'}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-[#1f1f1f]">{log.relocatedBin || '-'}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-center text-[#1f1f1f]">{log.qtyReceived}</td>
                                    <td className="px-2.5 py-1.5 whitespace-nowrap text-center text-[#1f1f1f]">{log.expected_qty}</td>
                                    <td className={`px-2.5 py-1.5 whitespace-nowrap text-center ${log.calculatedDifference < 0 ? 'text-[#a80000]' : log.calculatedDifference > 0 ? 'text-[#0067c0]' : 'text-[#1f1f1f]'}`}>
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
