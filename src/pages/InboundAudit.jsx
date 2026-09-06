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
        <div className="w-full px-6 py-4 font-['Segoe_UI',Tahoma,sans-serif] font-normal tracking-normal text-[12px] text-[#1f1f1f]">
            {/* KPI Banner */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-white p-3 rounded border border-[#e5e5e5] shadow-sm flex flex-col justify-between">
                    <span className="text-[10px] text-[#616161] uppercase tracking-normal">Total Alertas Detectadas</span>
                    <span className="text-2xl text-[#1f1f1f] mt-1">{alerts.length}</span>
                </div>
                <div className="bg-[#fffdf5] p-3 rounded border border-[#fde79a] shadow-sm flex flex-col justify-between">
                    <span className="text-[10px] text-[#794e00] uppercase tracking-normal">Pendientes Auditoría</span>
                    <span className="text-2xl text-[#794e00] mt-1">{countPending}</span>
                </div>
                <div className="bg-[#f6fcf7] p-3 rounded border border-[#a1e59e] shadow-sm flex flex-col justify-between">
                    <span className="text-[10px] text-[#107c41] uppercase tracking-normal">Resueltas</span>
                    <span className="text-2xl text-[#107c41] mt-1">{countResolved}</span>
                </div>
                <div className="bg-[#fafafa] p-3 rounded border border-[#e5e5e5] shadow-sm flex flex-col justify-between">
                    <span className="text-[10px] text-[#616161] uppercase tracking-normal">Descartadas</span>
                    <span className="text-2xl text-[#616161] mt-1">{countDismissed}</span>
                </div>
            </div>

            {/* Header / Control Bar */}
            <div className="flex flex-col sm:flex-row justify-end items-center mb-3 bg-white p-2 rounded border border-[#e5e5e5] shadow-sm gap-2">
                <div className="flex gap-2 items-center w-full sm:w-auto">
                    <div className="relative flex-grow sm:w-64">
                        <input
                            type="text"
                            placeholder="Buscar por ítem, I.R. o GRN..."
                            className="w-full h-7 px-2 text-[12px] border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] font-normal"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#707070] hover:text-[#1f1f1f] text-[11px] cursor-pointer"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <button
                        onClick={() => setShowClearModal(true)}
                        className="h-7 px-3 text-[12px] font-normal rounded border border-[#d1d5db] bg-white text-[#1f1f1f] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                    >
                        Limpiar Alertas
                    </button>
                    <button
                        onClick={handleRunAudit}
                        disabled={runningAudit}
                        className={`h-7 px-3 text-[12px] font-normal rounded text-white transition-colors cursor-pointer ${
                            runningAudit ? 'bg-[#cccccc] text-[#666666]' : 'bg-[#0067c0] hover:bg-[#005a9e]'
                        }`}
                    >
                        {runningAudit ? "Analizando..." : "Ejecutar Auditoría"}
                    </button>
                </div>
            </div>

            {error && <div className="bg-[#fef2f2] border border-[#fecaca] text-[#a80000] p-2.5 mb-3 rounded text-[12px] font-normal">{error}</div>}

            {/* Tab Navigation */}
            <div className="flex border-b border-[#e5e5e5] mb-3 bg-white px-2 pt-1">
                <button
                    onClick={() => setActiveTab('pending')}
                    className={`px-3 py-1.5 text-[12px] font-normal tracking-normal transition-colors border-b-2 cursor-pointer ${
                        activeTab === 'pending'
                            ? 'border-[#0067c0] text-[#0067c0]'
                            : 'border-transparent text-[#616161] hover:text-[#1f1f1f]'
                    }`}
                >
                    Alertas Activas ({countPending})
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-3 py-1.5 text-[12px] font-normal tracking-normal transition-colors border-b-2 cursor-pointer ${
                        activeTab === 'history'
                            ? 'border-[#0067c0] text-[#0067c0]'
                            : 'border-transparent text-[#616161] hover:text-[#1f1f1f]'
                    }`}
                >
                    Historial Resueltas ({countResolved + countDismissed})
                </button>
            </div>

            {/* Bulk Action Bar */}
            {activeTab === 'pending' && selectedAlertIds.length > 0 && (
                <div className="bg-[#f0f7ff] border border-[#cce4ff] p-2.5 mb-3 rounded flex justify-between items-center text-[12px]">
                    <span className="text-[#0067c0] font-normal">
                        {selectedAlertIds.length} alertas seleccionadas
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setIsBulkResolve(true);
                                setResolveStatus('resolved');
                                setResolutionNotes('');
                            }}
                            className="h-7 px-3 bg-[#107c41] hover:bg-[#0b5a2f] text-white rounded text-[12px] font-normal transition-colors cursor-pointer"
                        >
                            Resolver Selección
                        </button>
                        <button
                            onClick={() => setSelectedAlertIds([])}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer"
                        >
                            Desmarcar Todo
                        </button>
                    </div>
                </div>
            )}

            {/* Alertas Table */}
            <div className="bg-white rounded border border-[#e5e5e5] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-[11.5px] border-collapse">
                        <thead className="bg-[#354a5f] text-white font-normal">
                            <tr>
                                {activeTab === 'pending' && (
                                    <th className="px-3 py-2 text-center font-normal w-10">
                                        <input
                                            type="checkbox"
                                            checked={filteredAlerts.length > 0 && selectedAlertIds.length === filteredAlerts.filter(a => a.status === 'pending').length}
                                            onChange={handleSelectAll}
                                            className="cursor-pointer"
                                        />
                                    </th>
                                )}
                                <th className="px-3 py-2 text-left font-normal">FECHA DETECCIÓN</th>
                                <th className="px-3 py-2 text-left font-normal">I.R.</th>
                                <th className="px-3 py-2 text-left font-normal">GRN / BULTO</th>
                                <th className="px-3 py-2 text-left font-normal">CÓDIGO ITEM</th>
                                <th className="px-3 py-2 text-left font-normal">DESCRIPCIÓN</th>
                                <th className="px-3 py-2 text-center font-normal">ESPERADO</th>
                                <th className="px-3 py-2 text-center font-normal">RECIBIDO</th>
                                <th className="px-3 py-2 text-center font-normal">DIFERENCIA</th>
                                <th className="px-3 py-2 text-right font-normal">COSTO UNIT.</th>
                                <th className="px-4 py-2 text-right font-normal">VALOR IMPACTO</th>
                                <th className="px-3 py-2 text-center font-normal">TIPO ALERTA</th>
                                {activeTab === 'history' && <th className="px-3 py-2 text-left font-normal">RESOLUCIÓN</th>}
                                <th className="px-3 py-2 text-center font-normal">ACCIONES</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f1f1f1]">
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
                                     <tr key={alert.id} className={`hover:bg-[#edf3f9] transition-colors ${selectedAlertIds.includes(alert.id) ? 'bg-[#f0f7ff]' : ''}`}>
                                         {activeTab === 'pending' && (
                                             <td className="px-3 py-2 text-center whitespace-nowrap">
                                                 <input
                                                     type="checkbox"
                                                     checked={selectedAlertIds.includes(alert.id)}
                                                     onChange={() => handleSelectRow(alert.id)}
                                                     className="cursor-pointer"
                                                 />
                                             </td>
                                         )}
                                         <td className="px-3 py-2 whitespace-nowrap text-[#616161]">{formatDate(alert.created_at)}</td>
                                         <td className="px-3 py-2 whitespace-nowrap text-[#1f1f1f]">{alert.import_reference}</td>
                                         <td className="px-3 py-2 whitespace-nowrap text-[#1f1f1f]">{alert.grn}</td>
                                         <td className="px-3 py-2 whitespace-nowrap text-[#0067c0]">{alert.item_code}</td>
                                         <td className="px-3 py-2 text-[#1f1f1f] max-w-xs truncate" title={alert.description}>{alert.description}</td>
                                         <td className="px-3 py-2 whitespace-nowrap text-center text-[#1f1f1f]">{alert.qty_expected}</td>
                                         <td className="px-3 py-2 whitespace-nowrap text-center text-[#1f1f1f]">{alert.qty_received}</td>
                                         <td className={`px-3 py-2 whitespace-nowrap text-center ${alert.difference > 0 ? 'text-[#107c41]' : 'text-[#a80000]'}`}>
                                             {alert.difference > 0 ? `+${alert.difference}` : alert.difference}
                                         </td>
                                         <td className="px-3 py-2 whitespace-nowrap text-right text-[#616161]">
                                             {alert.cost_per_unit !== undefined ? `$${alert.cost_per_unit.toFixed(2)}` : '-'}
                                         </td>
                                         <td className={`px-4 py-2 whitespace-nowrap text-right ${alert.difference > 0 ? 'text-[#107c41]' : 'text-[#a80000]'}`}>
                                             {alert.financial_impact !== undefined ? `$${alert.financial_impact.toFixed(2)}` : '-'}
                                         </td>
                                         <td className="px-3 py-2 whitespace-nowrap text-center">
                                             <span className={`px-2 py-0.5 rounded text-[10px] font-normal ${
                                                 alert.alert_type === 'recurrent_shortage'
                                                     ? 'bg-[#fef2f2] text-[#a80000] border border-[#fecaca]'
                                                     : alert.alert_type === 'surplus'
                                                         ? 'bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0]'
                                                         : 'bg-[#fffdf5] text-[#794e00] border border-[#fde79a]'
                                             }`}>
                                                 {alert.alert_type === 'recurrent_shortage'
                                                     ? 'Faltante Recurrente'
                                                     : alert.alert_type === 'surplus'
                                                         ? 'Sobrante / Excedente'
                                                         : 'Faltante Inicial'}
                                             </span>
                                         </td>
                                         {activeTab === 'history' && (
                                             <td className="px-3 py-2 text-[#616161] max-w-xs">
                                                 <div className="flex flex-col gap-0.5">
                                                     <span className="text-[10px] text-[#616161]">
                                                         {alert.status === 'resolved' ? 'Resuelta' : 'Descartada'} - {formatDate(alert.resolved_at)}
                                                     </span>
                                                     <span className="text-[#1f1f1f] truncate" title={alert.resolution_notes}>
                                                         "{alert.resolution_notes || 'Sin comentarios'}"
                                                     </span>
                                                 </div>
                                             </td>
                                         )}
                                         <td className="px-3 py-2 whitespace-nowrap text-center">
                                             <div className="flex justify-center gap-1.5">
                                                 <button
                                                     onClick={() => setSelectedEmail(alert.draft_claim_email)}
                                                     className="h-6 px-2 text-[11px] font-normal rounded border border-[#d1d5db] bg-white text-[#1f1f1f] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                                                     title="Ver correo de reclamo"
                                                 >
                                                     Reclamar
                                                 </button>
                                                 {alert.status === 'pending' && (
                                                     <button
                                                         onClick={() => setResolveModalAlert(alert)}
                                                         className="h-6 px-2 text-[11px] font-normal rounded border border-[#a1e59e] bg-white text-[#107c41] hover:bg-[#f0fdf4] transition-colors cursor-pointer"
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
                 <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[2000] p-4">
                     <div className="bg-white rounded shadow-lg max-w-2xl w-full border border-[#d1d5db] overflow-hidden font-['Segoe_UI',Tahoma,sans-serif]">
                         <div className="bg-[#354a5f] text-white px-4 py-2 flex justify-between items-center border-b border-[#2a3c4d]">
                             <span className="text-[12px] font-normal uppercase tracking-normal">Borrador de Reclamo Automático</span>
                             <button onClick={() => setSelectedEmail(null)} className="text-white hover:text-gray-200 text-sm cursor-pointer">&times;</button>
                         </div>
                         <div className="p-4">
                             <p className="text-[11.5px] text-[#616161] mb-2 font-normal">
                                 Este correo fue redactado localmente por el Agente Inbound Auditor. Puedes copiarlo para enviarlo a tu proveedor.
                             </p>
                             <textarea
                                 readOnly
                                 className="w-full h-72 text-[11.5px] font-normal p-2.5 border border-[#d1d5db] rounded bg-[#fafafa] text-[#1f1f1f] outline-none"
                                 value={selectedEmail}
                             ></textarea>
                         </div>
                         <div className="bg-[#f9f9f9] px-4 py-2 flex justify-end gap-2 border-t border-[#e5e5e5]">
                             <button
                                 onClick={() => setSelectedEmail(null)}
                                 className="h-7 px-3 text-[12px] font-normal text-[#1f1f1f] hover:bg-[#f0f0f0] border border-[#d1d5db] rounded transition-colors cursor-pointer"
                             >
                                 Cerrar
                             </button>
                             <button
                                 onClick={() => copyToClipboard(selectedEmail)}
                                 className="h-7 px-3 text-[12px] font-normal bg-[#0067c0] hover:bg-[#005a9e] text-white rounded transition-colors cursor-pointer"
                             >
                                 Copiar Texto
                             </button>
                         </div>
                     </div>
                 </div>
             )}

             {/* MODAL: Resolver Alerta */}
             {(resolveModalAlert || isBulkResolve) && (
                 <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[2000] p-4">
                     <form onSubmit={handleResolveSubmit} className="bg-white rounded shadow-lg max-w-md w-full border border-[#d1d5db] overflow-hidden font-['Segoe_UI',Tahoma,sans-serif]">
                         <div className="bg-[#354a5f] text-white px-4 py-2 flex justify-between items-center border-b border-[#2a3c4d]">
                             <span className="text-[12px] font-normal uppercase tracking-normal">{isBulkResolve ? "Resolución Masiva" : "Resolver Alerta"}</span>
                             <button type="button" onClick={() => { setResolveModalAlert(null); setIsBulkResolve(false); }} className="text-white hover:text-gray-200 text-sm cursor-pointer">&times;</button>
                         </div>
                         <div className="p-4 flex flex-col gap-3 text-[12px] font-normal">
                             {isBulkResolve ? (
                                 <div className="bg-[#f9f9f9] p-2.5 rounded border border-[#e5e5e5]">
                                     <p className="text-[#1f1f1f]">Resolución masiva de alertas</p>
                                     <p className="text-[#616161] text-[11px] mt-0.5">Se marcarán {selectedAlertIds.length} alertas seleccionadas como resueltas o descartadas simultáneamente.</p>
                                 </div>
                             ) : (
                                 <div className="bg-[#f9f9f9] p-2.5 rounded border border-[#e5e5e5]">
                                     <p className="text-[#1f1f1f]">Ítem: {resolveModalAlert.item_code} - {resolveModalAlert.description}</p>
                                     <p className="text-[#616161] text-[11px] mt-0.5">Ref. Importación: {resolveModalAlert.import_reference} | Faltante: {resolveModalAlert.difference} un.</p>
                                 </div>
                             )}
                             
                             <div className="flex flex-col gap-1">
                                 <label className="text-[10px] uppercase text-[#616161]">Acción de Resolución</label>
                                 <select
                                     className="h-7 px-2 text-[12px] border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white font-normal"
                                     value={resolveStatus}
                                     onChange={(e) => setResolveStatus(e.target.value)}
                                 >
                                     <option value="resolved">Marcar como Resuelto (Se concilió / Reclamo enviado)</option>
                                     <option value="dismissed">Descartar (Diferencia aceptada / Error de conteo)</option>
                                 </select>
                             </div>

                             <div className="flex flex-col gap-1">
                                 <label className="text-[10px] uppercase text-[#616161]">Notas de Resolución / Causa Raíz</label>
                                 <textarea
                                     required
                                     placeholder="Ingresa los comentarios de resolución..."
                                     className="w-full h-20 text-[12px] p-2 border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] font-normal"
                                     value={resolutionNotes}
                                     onChange={(e) => setResolutionNotes(e.target.value)}
                                 ></textarea>
                             </div>
                         </div>
                         <div className="bg-[#f9f9f9] px-4 py-2 flex justify-end gap-2 border-t border-[#e5e5e5]">
                             <button
                                 type="button"
                                 onClick={() => { setResolveModalAlert(null); setIsBulkResolve(false); }}
                                 className="h-7 px-3 text-[12px] font-normal text-[#1f1f1f] hover:bg-[#f0f0f0] border border-[#d1d5db] rounded transition-colors cursor-pointer"
                             >
                                 Cancelar
                             </button>
                             <button
                                 type="submit"
                                 className="h-7 px-3 text-[12px] font-normal bg-[#0067c0] text-white rounded hover:bg-[#005a9e] transition-colors cursor-pointer"
                             >
                                 Confirmar
                             </button>
                         </div>
                     </form>
                 </div>
             )}

             {/* MODAL: Limpiar Alertas / Base de datos */}
             {showClearModal && (
                 <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[2000] p-4">
                     <div className="bg-white rounded shadow-lg max-w-md w-full border border-[#d1d5db] overflow-hidden font-['Segoe_UI',Tahoma,sans-serif]">
                         <div className="bg-[#354a5f] text-white px-4 py-2 flex justify-between items-center border-b border-[#2a3c4d]">
                             <span className="text-[12px] font-normal uppercase tracking-normal">
                                 Limpiar Base de Datos de Alertas
                             </span>
                             <button type="button" onClick={() => setShowClearModal(false)} className="text-white hover:text-gray-200 text-sm cursor-pointer">&times;</button>
                         </div>
                         <div className="p-4 flex flex-col gap-3 text-[12px] font-normal">
                             <p className="text-[#616161] text-[11.5px] leading-relaxed">
                                 Selecciona una opción para depurar la base de datos de auditorías. Esto ayuda a eliminar falsos positivos de ítems que ya han sido recibidos o limpiar el historial de alertas inactivas.
                             </p>
                             
                             <div className="flex flex-col gap-2">
                                 <button
                                     onClick={() => handleClearAlerts('history')}
                                     disabled={clearing}
                                     className="p-2.5 text-left border border-[#e5e5e5] hover:border-[#0067c0] hover:bg-[#f0f7ff] rounded transition-colors flex flex-col gap-0.5 cursor-pointer"
                                 >
                                     <span className="text-[12px] text-[#1f1f1f]">
                                         Limpiar Historial (Resueltas / Descartadas)
                                     </span>
                                     <span className="text-[10.5px] text-[#616161]">
                                         Mantiene las alertas activas (Pendientes) pero elimina los registros del historial.
                                     </span>
                                 </button>

                                 <button
                                     onClick={() => handleClearAlerts('all')}
                                     disabled={clearing}
                                     className="p-2.5 text-left border border-[#e5e5e5] hover:border-[#a80000] hover:bg-[#fef2f2] rounded transition-colors flex flex-col gap-0.5 cursor-pointer"
                                 >
                                     <span className="text-[12px] text-[#a80000]">
                                         Reiniciar Base de Datos (Eliminar Todo)
                                     </span>
                                     <span className="text-[10.5px] text-[#616161]">
                                         Elimina todas las alertas. Al ejecutar una nueva auditoría, se volverán a calcular las discrepancias reales.
                                     </span>
                                 </button>
                             </div>
                         </div>
                         <div className="bg-[#f9f9f9] px-4 py-2 flex justify-end gap-2 border-t border-[#e5e5e5]">
                             <button
                                 type="button"
                                 onClick={() => setShowClearModal(false)}
                                 className="h-7 px-3 text-[12px] font-normal text-[#1f1f1f] hover:bg-[#f0f0f0] border border-[#d1d5db] rounded transition-colors cursor-pointer"
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
