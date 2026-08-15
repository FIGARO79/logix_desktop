import React, { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

const InboundAudit = () => {
    const { setTitle } = useOutletContext();
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [runningAudit, setRunningAudit] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('pending'); // pending, history
    
    // Modal states
    const [selectedEmail, setSelectedEmail] = useState(null); // Borrador de correo
    const [resolveModalAlert, setResolveModalAlert] = useState(null); // Alerta para resolver
    const [resolutionNotes, setResolutionNotes] = useState('');
    const [resolveStatus, setResolveStatus] = useState('resolved'); // resolved, dismissed
    const [selectedAlertIds, setSelectedAlertIds] = useState([]);
    const [isBulkResolve, setIsBulkResolve] = useState(false);
    const [showClearModal, setShowClearModal] = useState(false);
    const [clearing, setClearing] = useState(false);


    useEffect(() => {
        setTitle("Auditoría de Inbound");
        loadAlerts();
    }, [setTitle]);

    const loadAlerts = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/inbound/auditor/alerts', { credentials: 'include' });
            if (!res.ok) throw new Error("Error cargando alertas de auditoría.");
            const data = await res.json();
            setAlerts(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRunAudit = async () => {
        setRunningAudit(true);
        setError(null);
        try {
            const res = await fetch('/api/inbound/auditor/run', { 
                method: 'POST', 
                credentials: 'include' 
            });
            if (!res.ok) throw new Error("Error al ejecutar la auditoría.");
            const result = await res.json();
            alert(`Auditoría ejecutada con éxito.\nNuevas alertas: ${result.new_alerts}\nAlertas eliminadas (conciliadas): ${result.auto_resolved || 0}`);
            loadAlerts();
        } catch (err) {
            setError(err.message);
        } finally {
            setRunningAudit(false);
        }
    };

    const handleClearAlerts = async (target) => {
        setClearing(true);
        setError(null);
        try {
            const res = await fetch(`/api/inbound/auditor/clear?target=${target}`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) throw new Error("Error al limpiar las alertas de auditoría.");
            const data = await res.json();
            alert(data.message || "Limpieza realizada con éxito.");
            setShowClearModal(false);
            loadAlerts();
        } catch (err) {
            setError(err.message);
        } finally {
            setClearing(false);
        }
    };

    const handleResolveSubmit = async (e) => {
        e.preventDefault();
        if (!isBulkResolve && !resolveModalAlert) return;
        if (isBulkResolve && selectedAlertIds.length === 0) return;

        try {
            const url = isBulkResolve 
                ? '/api/inbound/auditor/alerts/resolve-bulk'
                : `/api/inbound/auditor/alerts/${resolveModalAlert.id}/resolve`;
                
            const body = isBulkResolve
                ? { alert_ids: selectedAlertIds, status: resolveStatus, resolution_notes: resolutionNotes }
                : { status: resolveStatus, resolution_notes: resolutionNotes };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'include'
            });

            if (!res.ok) throw new Error(isBulkResolve ? "No se pudieron resolver las alertas." : "No se pudo resolver la alerta.");
            
            setResolveModalAlert(null);
            setIsBulkResolve(false);
            setResolutionNotes('');
            setSelectedAlertIds([]);
            loadAlerts();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const visiblePendingIds = filteredAlerts
                .filter(a => a.status === 'pending')
                .map(a => a.id);
            setSelectedAlertIds(visiblePendingIds);
        } else {
            setSelectedAlertIds([]);
        }
    };

    const handleSelectRow = (alertId) => {
        setSelectedAlertIds(prev => 
            prev.includes(alertId) 
                ? prev.filter(id => id !== alertId)
                : [...prev, alertId]
        );
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert("¡Copiado al portapapeles!");
    };

    // Filtrar y agrupar alertas
    const filteredAlerts = alerts.filter(alert => {
        const matchesSearch = 
            alert.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            alert.import_reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
            alert.grn.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (alert.description && alert.description.toLowerCase().includes(searchTerm.toLowerCase()));
        
        if (activeTab === 'pending') {
            return matchesSearch && alert.status === 'pending';
        } else {
            return matchesSearch && alert.status !== 'pending';
        }
    });

    // Contadores
    const countPending = alerts.filter(a => a.status === 'pending').length;
    const countResolved = alerts.filter(a => a.status === 'resolved').length;
    const countDismissed = alerts.filter(a => a.status === 'dismissed').length;

    const formatDate = (isoString) => {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="w-full px-6 py-6 font-sans">
            {/* KPI Banner */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Total Alertas Detectadas</span>
                    <span className="text-3xl font-medium text-slate-800 mt-2">{alerts.length}</span>
                </div>
                <div className="bg-amber-50/60 p-4 rounded-lg shadow-sm border border-amber-200 flex flex-col justify-between">
                    <span className="text-[10px] text-amber-700 uppercase tracking-widest font-semibold">Pendientes Auditoría</span>
                    <span className="text-3xl font-medium text-amber-600 mt-2">{countPending}</span>
                </div>
                <div className="bg-emerald-50/60 p-4 rounded-lg shadow-sm border border-emerald-200 flex flex-col justify-between">
                    <span className="text-[10px] text-emerald-700 uppercase tracking-widest font-semibold">Resueltas</span>
                    <span className="text-3xl font-medium text-emerald-600 mt-2">{countResolved}</span>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Descartadas</span>
                    <span className="text-3xl font-medium text-gray-500 mt-2">{countDismissed}</span>
                </div>
            </div>

            {/* Header / Control Bar */}
            <div className="flex flex-col sm:flex-row justify-end items-center mb-3 bg-white p-2 rounded-lg shadow-sm border border-gray-200 gap-4">
                <div className="flex gap-2 items-center w-full sm:w-auto">
                    <div className="relative flex-grow sm:w-64">
                        <input
                            type="text"
                            placeholder="Buscar por item, I.R. o GRN..."
                            className="px-3 py-1.5 text-xs border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-[#285f94] focus:border-[#285f94] focus:outline-none w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                &#215;
                            </button>
                        )}
                    </div>
                    <button
                        onClick={() => setShowClearModal(true)}
                        className="px-4 py-1.5 text-xs font-medium rounded-md shadow-sm text-slate-700 bg-white border border-gray-300 hover:bg-gray-50 transition-all flex items-center gap-1.5"
                    >
                        <svg className="w-3.5 h-3.5 text-gray-550" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Limpiar Alertas
                    </button>
                    <button
                        onClick={handleRunAudit}
                        disabled={runningAudit}
                        className={`px-4 py-1.5 text-xs font-medium rounded-md shadow-sm text-white transition-all ${
                            runningAudit ? 'bg-slate-400' : 'bg-[#285f94] hover:bg-[#1e4a74]'
                        }`}
                    >
                        {runningAudit ? "Analizando..." : "Ejecutar Auditoría"}
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-100 text-red-700 p-3 mb-6 rounded text-sm">{error}</div>}

            {/* Tab Navigation */}
            <div className="flex border-b border-gray-200 mb-4 bg-white px-4 pt-2 rounded-t-lg shadow-sm">
                <button
                    onClick={() => setActiveTab('pending')}
                    className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all border-b-2 ${
                        activeTab === 'pending'
                            ? 'border-[#285f94] text-[#285f94]'
                            : 'border-transparent text-gray-500 hover:text-slate-800'
                    }`}
                >
                    Alertas Activas ({countPending})
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all border-b-2 ${
                        activeTab === 'history'
                            ? 'border-[#285f94] text-[#285f94]'
                            : 'border-transparent text-gray-500 hover:text-slate-800'
                    }`}
                >
                    Historial Resueltas ({countResolved + countDismissed})
                </button>
            </div>

            {/* Bulk Action Bar */}
            {activeTab === 'pending' && selectedAlertIds.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 p-3 mb-4 rounded-lg flex justify-between items-center animate-fade-in shadow-sm">
                    <span className="text-xs text-blue-700 font-semibold">
                        {selectedAlertIds.length} alertas seleccionadas
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setIsBulkResolve(true);
                                setResolveStatus('resolved');
                                setResolutionNotes('');
                            }}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-sm transition-all"
                        >
                            Resolver Selección
                        </button>
                        <button
                            onClick={() => setSelectedAlertIds([])}
                            className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs font-semibold transition-all"
                        >
                            Desmarcar Todo
                        </button>
                    </div>
                </div>
            )}

            {/* Alertas Table */}
            <div className="bg-white shadow-sm rounded-b-lg overflow-hidden border border-gray-200">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                        <thead className="bg-slate-700 text-white">
                            <tr>
                                {activeTab === 'pending' && (
                                    <th className="px-4 py-2 text-center font-medium w-10">
                                        <input
                                            type="checkbox"
                                            checked={filteredAlerts.length > 0 && selectedAlertIds.length === filteredAlerts.filter(a => a.status === 'pending').length}
                                            onChange={handleSelectAll}
                                            className="rounded border-gray-300 text-[#285f94] focus:ring-[#285f94] cursor-pointer"
                                        />
                                    </th>
                                )}
                                <th className="px-4 py-2 text-left font-medium">FECHA DETECCIÓN</th>
                                <th className="px-4 py-2 text-left font-medium">I.R.</th>
                                <th className="px-4 py-2 text-left font-medium">GRN / BULTO</th>
                                <th className="px-4 py-2 text-left font-medium">CÓDIGO ITEM</th>
                                <th className="px-4 py-2 text-left font-medium">DESCRIPCIÓN</th>
                                <th className="px-4 py-2 text-center font-medium">ESPERADO</th>
                                <th className="px-4 py-2 text-center font-medium">RECIBIDO</th>
                                <th className="px-4 py-2 text-center font-medium">DIFERENCIA</th>
                                <th className="px-4 py-2 text-right font-medium">COSTO UNIT.</th>
                                <th className="px-4 py-2 text-right font-medium">VALOR IMPACTO</th>
                                <th className="px-4 py-2 text-center font-medium">TIPO ALERTA</th>
                                {activeTab === 'history' && <th className="px-4 py-2 text-left font-medium">RESOLUCIÓN</th>}
                                <th className="px-4 py-2 text-center font-medium">ACCIONES</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan={activeTab === 'pending' ? 14 : 13} className="py-8 text-center text-gray-500">Cargando alertas...</td></tr>
                            ) : filteredAlerts.length === 0 ? (
                                <tr>
                                    <td colSpan={activeTab === 'pending' ? 14 : 13} className="py-8 text-center text-gray-500 italic">
                                        No hay alertas registradas en esta sección.
                                    </td>
                                </tr>
                            ) : (
                                filteredAlerts.map(alert => (
                                    <tr key={alert.id} className={`hover:bg-slate-50 transition-colors ${selectedAlertIds.includes(alert.id) ? 'bg-blue-50/40 hover:bg-blue-50/60' : ''}`}>
                                        {activeTab === 'pending' && (
                                            <td className="px-4 py-3 text-center whitespace-nowrap">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedAlertIds.includes(alert.id)}
                                                    onChange={() => handleSelectRow(alert.id)}
                                                    className="rounded border-gray-300 text-[#285f94] focus:ring-[#285f94] cursor-pointer"
                                                />
                                            </td>
                                        )}
                                        <td className="px-4 py-3 whitespace-nowrap text-gray-500">{formatDate(alert.created_at)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-850">{alert.import_reference}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-gray-650">{alert.grn}</td>
                                        <td className="px-4 py-3 whitespace-nowrap font-mono font-medium text-[#285f94]">{alert.item_code}</td>
                                        <td className="px-4 py-3 text-gray-750 max-w-xs truncate" title={alert.description}>{alert.description}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-center text-gray-700 font-semibold">{alert.qty_expected}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-center text-gray-700 font-semibold">{alert.qty_received}</td>
                                        <td className={`px-4 py-3 whitespace-nowrap text-center font-bold ${alert.difference > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {alert.difference > 0 ? `+${alert.difference}` : alert.difference}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600 font-mono">
                                            {alert.cost_per_unit !== undefined ? `$${alert.cost_per_unit.toFixed(2)}` : '-'}
                                        </td>
                                        <td className={`px-4 py-3 whitespace-nowrap text-right font-mono font-bold ${alert.difference > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {alert.financial_impact !== undefined ? `$${alert.financial_impact.toFixed(2)}` : '-'}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-center">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                                alert.alert_type === 'recurrent_shortage'
                                                    ? 'bg-red-100 text-red-700 border border-red-200'
                                                    : alert.alert_type === 'surplus'
                                                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                                        : 'bg-amber-100 text-amber-700 border border-amber-200'
                                            }`}>
                                                {alert.alert_type === 'recurrent_shortage'
                                                    ? 'Faltante Recurrente'
                                                    : alert.alert_type === 'surplus'
                                                        ? 'Sobrante / Excedente'
                                                        : 'Faltante Inicial'}
                                            </span>
                                        </td>
                                        {activeTab === 'history' && (
                                            <td className="px-4 py-3 text-gray-650 max-w-xs">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[10px] uppercase font-semibold text-gray-500">
                                                        {alert.status === 'resolved' ? 'Resuelta' : 'Descartada'} - {formatDate(alert.resolved_at)}
                                                    </span>
                                                    <span className="text-gray-700 italic truncate" title={alert.resolution_notes}>
                                                        "{alert.resolution_notes || 'Sin comentarios'}"
                                                    </span>
                                                </div>
                                            </td>
                                        )}
                                        <td className="px-4 py-3 whitespace-nowrap text-center">
                                            <div className="flex justify-center gap-1.5">
                                                <button
                                                    onClick={() => setSelectedEmail(alert.draft_claim_email)}
                                                    className="px-2 py-1 bg-sky-50 text-[#285f94] border border-[#285f94]/30 rounded hover:bg-[#285f94]/10 transition-colors"
                                                    title="Ver correo de reclamo"
                                                >
                                                    Reclamar
                                                </button>
                                                {alert.status === 'pending' && (
                                                    <button
                                                        onClick={() => setResolveModalAlert(alert)}
                                                        className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-500/30 rounded hover:bg-emerald-500/10 transition-colors"
                                                        title="Resolver alerta"
                                                    >
                                                        Resolver
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODAL: Correo de Reclamo */}
            {selectedEmail && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center z-[2000] p-4">
                    <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full border border-gray-100 overflow-hidden">
                        <div className="bg-[#285f94] text-white px-5 py-3 flex justify-between items-center">
                            <span className="text-sm font-semibold uppercase tracking-wider">Borrador de Reclamo Automático</span>
                            <button onClick={() => setSelectedEmail(null)} className="text-xl hover:text-gray-200 focus:outline-none">&times;</button>
                        </div>
                        <div className="p-5">
                            <p className="text-xs text-gray-500 mb-3">
                                Este correo fue redactado localmente por el **Agente Inbound Auditor**. Puedes copiarlo para enviarlo a tu proveedor.
                            </p>
                            <textarea
                                readOnly
                                className="w-full h-80 text-xs font-mono p-3 border border-gray-300 rounded bg-gray-50 text-gray-700 focus:outline-none"
                                value={selectedEmail}
                            ></textarea>
                        </div>
                        <div className="bg-gray-50 px-5 py-3 flex justify-end gap-2 border-t">
                            <button
                                onClick={() => setSelectedEmail(null)}
                                className="px-4 py-1.5 text-xs font-medium text-gray-650 hover:bg-gray-200 rounded transition-colors"
                            >
                                Cerrar
                            </button>
                            <button
                                onClick={() => copyToClipboard(selectedEmail)}
                                className="px-4 py-1.5 text-xs font-medium bg-[#285f94] text-white rounded hover:bg-[#1e4a74] transition-colors"
                            >
                                Copiar Texto
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: Resolver Alerta */}
            {(resolveModalAlert || isBulkResolve) && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center z-[2000] p-4">
                    <form onSubmit={handleResolveSubmit} className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-gray-100 overflow-hidden">
                        <div className="bg-[#285f94] text-white px-5 py-3 flex justify-between items-center">
                            <span className="text-sm font-semibold uppercase tracking-wider">{isBulkResolve ? "Resolución Masiva" : "Resolver Alerta"}</span>
                            <button type="button" onClick={() => { setResolveModalAlert(null); setIsBulkResolve(false); }} className="text-xl hover:text-gray-200 focus:outline-none">&times;</button>
                        </div>
                        <div className="p-5 flex flex-col gap-4">
                            {isBulkResolve ? (
                                <div className="text-xs bg-slate-50 p-3 rounded border">
                                    <p className="font-semibold text-gray-700">Resolución masiva de alertas</p>
                                    <p className="text-gray-500 mt-1">Se marcarán {selectedAlertIds.length} alertas seleccionadas como resueltas o descartadas simultáneamente.</p>
                                </div>
                            ) : (
                                <div className="text-xs bg-slate-50 p-3 rounded border">
                                    <p className="font-semibold text-gray-700">Ítem: {resolveModalAlert.item_code} - {resolveModalAlert.description}</p>
                                    <p className="text-gray-500 mt-1">Ref. Importación: {resolveModalAlert.import_reference} | Faltante: {resolveModalAlert.difference} un.</p>
                                </div>
                            )}
                            
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500">Acción de Resolución</label>
                                <select
                                    className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#285f94]"
                                    value={resolveStatus}
                                    onChange={(e) => setResolveStatus(e.target.value)}
                                >
                                    <option value="resolved">Marcar como Resuelto (Se concilio / Reclamo enviado)</option>
                                    <option value="dismissed">Descartar (Diferencia aceptada / Error de conteo)</option>
                                </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500">Notas de Resolución / Causa Raíz</label>
                                <textarea
                                    required
                                    placeholder="Ingresa los comentarios de resolución..."
                                    className="w-full h-24 text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-[#285f94] outline-none"
                                    value={resolutionNotes}
                                    onChange={(e) => setResolutionNotes(e.target.value)}
                                ></textarea>
                            </div>
                        </div>
                        <div className="bg-gray-50 px-5 py-3 flex justify-end gap-2 border-t">
                            <button
                                type="button"
                                onClick={() => { setResolveModalAlert(null); setIsBulkResolve(false); }}
                                className="px-4 py-1.5 text-xs font-medium text-gray-650 hover:bg-gray-200 rounded transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                            >
                                Confirmar
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* MODAL: Limpiar Alertas / Base de datos */}
            {showClearModal && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center z-[2000] p-4">
                    <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-gray-100 overflow-hidden">
                        <div className="bg-slate-800 text-white px-5 py-3 flex justify-between items-center">
                            <span className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                Limpiar Base de Datos de Alertas
                            </span>
                            <button type="button" onClick={() => setShowClearModal(false)} className="text-xl hover:text-gray-200 focus:outline-none">&times;</button>
                        </div>
                        <div className="p-5 flex flex-col gap-4">
                            <p className="text-xs text-gray-600 leading-relaxed">
                                Selecciona una opción para depurar la base de datos de auditorías. Esto ayuda a eliminar falsos positivos de ítems que ya han sido recibidos o limpiar el historial de alertas inactivas.
                            </p>
                            
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => handleClearAlerts('history')}
                                    disabled={clearing}
                                    className="p-3 text-left border border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 rounded-lg transition-all flex flex-col gap-1 group"
                                >
                                    <span className="text-xs font-semibold text-slate-850 group-hover:text-[#285f94]">
                                        Limpiar Historial (Resueltas / Descartadas)
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                        Mantiene las alertas activas (Pendientes) pero elimina de forma permanente todos los registros del historial.
                                    </span>
                                </button>

                                <button
                                    onClick={() => handleClearAlerts('all')}
                                    disabled={clearing}
                                    className="p-3 text-left border border-gray-200 hover:border-red-400 hover:bg-red-50/40 rounded-lg transition-all flex flex-col gap-1 group"
                                >
                                    <span className="text-xs font-semibold text-slate-850 group-hover:text-red-650">
                                        Reiniciar Base de Datos (Eliminar Todo)
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                        Elimina absolutamente todas las alertas de auditoría. Al ejecutar una nueva auditoría posteriormente, se volverán a generar solo las discrepancias activas reales.
                                    </span>
                                </button>
                            </div>
                        </div>
                        <div className="bg-gray-50 px-5 py-3 flex justify-end gap-2 border-t">
                            <button
                                type="button"
                                onClick={() => setShowClearModal(false)}
                                className="px-4 py-1.5 text-xs font-medium text-gray-650 hover:bg-gray-200 rounded transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InboundAudit;
