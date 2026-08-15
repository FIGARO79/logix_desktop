import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const PickingAuditHistory = () => {
    const { setTitle } = useOutletContext();
    const [audits, setAudits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedAuditId, setExpandedAuditId] = useState(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingAudit, setEditingAudit] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [showShipmentModal, setShowShipmentModal] = useState(false);
    const [shipmentNote, setShipmentNote] = useState('');
    const [shipmentCarrier, setShipmentCarrier] = useState('');
    const [creatingShipment, setCreatingShipment] = useState(false);
    const [newItemCode, setNewItemCode] = useState('');
    const [newItemLine, setNewItemLine] = useState('');
    const [newItemDesc, setNewItemDesc] = useState('');
    const [newItemQtyReq, setNewItemQtyReq] = useState('');
    const [isAddingItem, setIsAddingItem] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        setTitle("Pickings Empacados");
    }, [setTitle]);

    useEffect(() => {
        fetchAudits();
    }, []);

    const fetchAudits = async () => {
        try {
            const response = await fetch('/api/views/view_picking_audits', { credentials: 'include' });
            if (!response.ok) throw new Error('Error al cargar auditorías');
            const data = await response.json();
            setAudits(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleExpand = (id) => setExpandedAuditId(expandedAuditId === id ? null : id);

    const normalizeDate = (dateString) => {
        if (!dateString) return null;
        let normalized = dateString.trim().replace(' ', 'T');
        if (normalized.length === 10 && normalized.match(/^\d{4}-\d{2}-\d{2}$/)) return `${normalized}T00:00:00`;
        const hasTimeZone = normalized.includes('Z') || normalized.match(/[+-]\d{2}:\d{2}$/) || (normalized.includes('-') && normalized.split('T')[1]?.includes('-'));
        if (!hasTimeZone) normalized = `${normalized}Z`;
        return normalized;
    };

    const isToday = (dateString) => {
        const normalized = normalizeDate(dateString);
        if (!normalized) return false;
        const date = new Date(normalized);
        const today = new Date();
        return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
    };

    const formatDate = (dateString) => {
        const normalized = normalizeDate(dateString);
        if (!normalized) return '';
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return 'Fecha Inválida';
        return date.toLocaleString(undefined, {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    };

    const handleEditClick = (audit) => {
        setEditingAudit({ ...audit, items: audit.items.map(item => ({ ...item })) });
        setIsEditModalOpen(true);
    };


    const handleSaveEdit = async () => {
        setIsSubmitting(true);
        try {
            const payload = {
                order_number: editingAudit.order_number,
                despatch_number: editingAudit.despatch_number,
                customer_code: editingAudit.customer_code || '',
                customer_name: editingAudit.customer_name || 'N/A',
                status: editingAudit.status,
                items: editingAudit.items.map(item => ({
                    id: item.id || null,
                    code: item.item_code || item.code,
                    description: item.description,
                    order_line: item.order_line || '',
                    qty_req: item.qty_req,
                    qty_scan: item.qty_scan
                })),
                packages: parseInt(editingAudit.packages) || 0,
                packages_assignment: editingAudit.packages_assignment || {}
            };
            const response = await fetch(`/api/update_picking_audit/${editingAudit.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Error al actualizar');
            }
            await fetchAudits();
            setIsEditModalOpen(false);
            toast.success("Auditoría actualizada exitosamente");
        } catch (err) {
            toast.error(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddNewPackage = () => setEditingAudit(prev => ({ ...prev, packages: (parseInt(prev.packages) || 0) + 1 }));
    const handleRemoveLastPackage = () => {
        if (!editingAudit.packages || editingAudit.packages <= 0) return;
        const lastPkg = editingAudit.packages.toString();
        let hasAssignments = false;
        if (editingAudit.packages_assignment) {
            for (let key in editingAudit.packages_assignment) {
                if (editingAudit.packages_assignment[key][lastPkg] > 0) { hasAssignments = true; break; }
            }
        }
        if (hasAssignments) { toast.warning(`El bulto ${lastPkg} tiene ítems asignados.`); return; }
        setEditingAudit(prev => ({ ...prev, packages: Math.max(0, prev.packages - 1) }));
    };

    const handleItemCodeLookup = async (code) => {
        if (!code || code.length < 3) return;
        try {
            const res = await fetch(`/api/search_items?q=${code}`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data && data.length > 0) {
                    const match = data.find(item => item.itemCode.toUpperCase() === code.toUpperCase());
                    if (match) {
                        setNewItemDesc(match.description);
                    } else if (data[0]) {
                        setNewItemDesc(data[0].description);
                    }
                }
            }
        } catch (err) {
            console.error("Error looking up item code", err);
        }
    };

    const handleConfirmAddItem = () => {
        if (!newItemCode.trim()) {
            toast.error("El código de artículo es requerido");
            return;
        }
        const qtyReq = parseInt(newItemQtyReq) || 0;
        if (qtyReq <= 0) {
            toast.error("La cantidad requerida debe ser mayor a 0");
            return;
        }

        const itemCodeClean = newItemCode.trim().toUpperCase();
        
        const exists = editingAudit.items.some(
            item => (item.item_code || item.code || '').toUpperCase() === itemCodeClean &&
                    (item.order_line || '') === (newItemLine.trim())
        );
        if (exists) {
            toast.error("Este artículo ya existe en esta línea");
            return;
        }

        const newItem = {
            id: null,
            item_code: itemCodeClean,
            code: itemCodeClean,
            description: newItemDesc.trim() || "Item manual",
            order_line: newItemLine.trim(),
            qty_req: qtyReq,
            qty_scan: 0,
            edited: 1
        };

        setEditingAudit(prev => {
            const updatedItems = [...prev.items, newItem];
            const key = `${newItem.item_code}:${newItem.order_line || ''}`;
            const updatedAssignments = {
                ...prev.packages_assignment,
                [key]: {}
            };
            return {
                ...prev,
                items: updatedItems,
                packages_assignment: updatedAssignments
            };
        });

        setIsAddingItem(false);
        resetNewItemForm();
        toast.success("Artículo agregado a la auditoría");
    };

    const resetNewItemForm = () => {
        setNewItemCode('');
        setNewItemLine('');
        setNewItemDesc('');
        setNewItemQtyReq('');
    };

    const handlePkgQtyChange = (itemIdx, pkgNum, value) => {
        const val = parseInt(value) || 0;
        const newAudit = { ...editingAudit };
        const item = newAudit.items[itemIdx];
        const key = `${item.item_code}:${item.order_line || ''}`;
        if (!newAudit.packages_assignment) newAudit.packages_assignment = {};
        if (!newAudit.packages_assignment[key]) newAudit.packages_assignment[key] = {};
        newAudit.packages_assignment[key][pkgNum] = val;
        item.qty_scan = Object.values(newAudit.packages_assignment[key]).reduce((a, b) => a + (parseInt(b) || 0), 0);
        item.difference = item.qty_scan - item.qty_req;
        setEditingAudit(newAudit);
    };

    const handleAssignToPackage = (itemIdx, pkgNum) => {
        if (!pkgNum) return;
        if (pkgNum === "NEW") {
            const newPkg = (editingAudit.packages || 0) + 1;
            setEditingAudit(prev => {
                const next = { ...prev, packages: newPkg };
                const item = next.items[itemIdx];
                const key = `${item.item_code}:${item.order_line || ''}`;
                if (!next.packages_assignment) next.packages_assignment = {};
                if (!next.packages_assignment[key]) next.packages_assignment[key] = {};
                next.packages_assignment[key][newPkg] = 1;
                item.qty_scan = Object.values(next.packages_assignment[key]).reduce((a, b) => a + (parseInt(b) || 0), 0);
                item.difference = item.qty_scan - item.qty_req;
                return next;
            });
        } else {
            const newAudit = { ...editingAudit };
            const item = newAudit.items[itemIdx];
            const key = `${item.item_code}:${item.order_line || ''}`;
            if (!newAudit.packages_assignment) newAudit.packages_assignment = {};
            if (!newAudit.packages_assignment[key]) newAudit.packages_assignment[key] = {};
            if (!newAudit.packages_assignment[key][pkgNum]) {
                newAudit.packages_assignment[key][pkgNum] = 1;
                item.qty_scan = Object.values(newAudit.packages_assignment[key]).reduce((a, b) => a + (parseInt(b) || 0), 0);
                item.difference = item.qty_scan - item.qty_req;
                setEditingAudit(newAudit);
            }
        }
    };

    const removePackageAssignment = (itemIdx, pkgNum) => {
        const newAudit = { ...editingAudit };
        const item = newAudit.items[itemIdx];
        const key = `${item.item_code}:${item.order_line || ''}`;
        if (newAudit.packages_assignment?.[key]) {
            delete newAudit.packages_assignment[key][pkgNum];
            item.qty_scan = Object.values(newAudit.packages_assignment[key]).reduce((a, b) => a + (parseInt(b) || 0), 0);
            item.difference = item.qty_scan - item.qty_req;
            setEditingAudit(newAudit);
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleCreateShipment = async () => {
        setCreatingShipment(true);
        try {
            const res = await fetch('/api/shipments/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audit_ids: [...selectedIds], note: shipmentNote || null, carrier: shipmentCarrier || null }),
                credentials: 'include'
            });
            if (!res.ok) throw new Error((await res.json()).detail || 'Error al crear envío');
            toast.success("Envío creado exitosamente");
            setShowShipmentModal(false);
            setSelectedIds(new Set());
            setTimeout(() => navigate('/shipments'), 1500);
        } catch (err) { toast.error(err.message); }
        finally { setCreatingShipment(false); }
    };

    const handleDeleteSelected = async () => {
        if (selectedIds.size === 0) return;
        const confirmMsg = selectedIds.size === 1
            ? "¿Está seguro que desea eliminar la auditoría seleccionada? Esta acción es irreversible."
            : `¿Está seguro que desea eliminar las ${selectedIds.size} auditorías seleccionadas? Esta acción es irreversible.`;
        
        if (!window.confirm(confirmMsg)) return;
        
        try {
            const res = await fetch('/api/delete_picking_audits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audit_ids: [...selectedIds] }),
                credentials: 'include'
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Error al eliminar auditorías');
            }
            toast.success("Auditorías eliminadas correctamente");
            setSelectedIds(new Set());
            await fetchAudits();
        } catch (err) {
            toast.error(err.message);
        }
    };

    return (
        <div className="max-w-[1400px] mx-auto px-6 py-6 font-sans bg-[#fcfcfc] min-h-screen text-zinc-800">
            <ToastContainer position="top-right" autoClose={3000} />

            {loading && (
                <div className="flex justify-center items-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900"></div>
                </div>
            )}

            {error && (
                <div className="mb-6 bg-red-50 text-red-600 px-4 py-3 border border-red-100 text-[10px] font-medium  uppercase tracking-widest">
                    {error}
                </div>
            )}

            {!loading && !error && (
                <div className="bg-white border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full leading-normal">
                            <thead>
                                <tr className="bg-zinc-50 border-b border-zinc-200">
                                    <th className="px-4 py-1.5 text-center w-10">
                                        <input
                                            type="checkbox"
                                            checked={audits.length > 0 && audits.every(a => selectedIds.has(a.id))}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedIds(new Set(audits.map(a => a.id)));
                                                } else {
                                                    setSelectedIds(new Set());
                                                }
                                            }}
                                            className="w-3.5 h-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 cursor-pointer animate-all"
                                            title="Seleccionar todo"
                                        />
                                    </th>
                                    <th className="px-4 py-1.5 text-center w-8"></th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-left">ID</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-left">Orden</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-left">Despacho</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-left">Cliente</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-left">Usuario</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-left">Fecha</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-center">Estado</th>
                                    <th className="px-4 py-1.5 text-[12px] font-medium text-white uppercase tracking-widest text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {audits.map((audit) => (
                                    <React.Fragment key={audit.id}>
                                        <tr
                                            className={`border-b border-zinc-100 hover:bg-zinc-50/50 transition-colors cursor-pointer
                                                ${expandedAuditId === audit.id ? 'bg-zinc-50' : ''}
                                                ${selectedIds.has(audit.id) ? 'bg-blue-50/50' : ''}`}
                                            onClick={() => toggleExpand(audit.id)}
                                        >
                                            <td className="px-4 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(audit.id)}
                                                    onChange={() => toggleSelect(audit.id)}
                                                    className="w-3.5 h-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 cursor-pointer"
                                                />
                                            </td>
                                            <td className="px-4 py-1.5 text-center">
                                                <svg
                                                    className={`w-3 h-3 text-zinc-700 transform transition-transform duration-200 ${expandedAuditId === audit.id ? 'rotate-90' : ''}`}
                                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </td>
                                            <td className="px-4 py-1.5 text-[11px] font-normal text-black">{audit.id}</td>
                                            <td className="px-4 py-1.5 text-[11px] font-normal text-black">{audit.order_number}</td>
                                            <td className="px-4 py-1.5 text-[11px] text-black font-normal uppercase">{audit.despatch_number}</td>
                                            <td className="px-4 py-1.5 text-[10px] text-black truncate max-w-[200px] uppercase font-normal ">
                                                 {audit.customer_code && audit.customer_code.trim() !== "" && (
                                                     <span className="text-black mr-2">[{audit.customer_code}]</span>
                                                 )}
                                                {audit.customer_name || 'N/A'}
                                            </td>
                                            <td className="px-4 py-1.5 text-[10px] text-black uppercase font-normal">{audit.username}</td>
                                            <td className="px-4 py-1.5 text-[10px] text-black font-normal">{formatDate(audit.timestamp)}</td>
                                            <td className="px-4 py-1.5 text-center">
                                                <span className={`px-2 py-0.5 inline-flex text-[9px] font-normal  uppercase tracking-tight rounded border ${
                                                    audit.status === 'Completado' || audit.status === 'Completo'
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                                                }`}>
                                                    {audit.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-center items-center gap-4">
                                                    {isToday(audit.timestamp) && (
                                                        <span
                                                            onClick={() => handleEditClick(audit)}
                                                            className="text-[9px] font-medium uppercase tracking-widest text-zinc-700 hover:text-zinc-900 transition-colors leading-none cursor-pointer"
                                                            role="button"
                                                            title="Editar"
                                                        >
                                                            Editar
                                                        </span>
                                                    )}
                                                    <Link
                                                        to={`/packing_list/print/${audit.id}`}
                                                        className="text-[9px] font-normal uppercase tracking-tight text-black hover:text-[#285f94] transition-colors leading-none"
                                                        title="Imprimir"
                                                    >
                                                        Print
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>

                                        {expandedAuditId === audit.id && (
                                            <tr className="bg-zinc-50/50">
                                                <td colSpan="10" className="px-10 py-4 border-b border-zinc-100">
                                                    <div className="bg-white border border-zinc-200 p-4 shadow-sm">
                                                        <h4 className="text-[9px] font-medium  text-zinc-600 uppercase tracking-[0.2em] mb-4 border-b border-zinc-50 pb-2">Detalle de Contenido</h4>
                                                        <table className="w-full">
                                                            <thead>
                                                                <tr className="text-[8px] font-medium  text-zinc-600 uppercase tracking-widest">
                                                                    <th className="pb-2 text-left w-12">Lín.</th>
                                                                    <th className="pb-2 text-left">SKU</th>
                                                                    <th className="pb-2 text-left">Descripción</th>
                                                                    <th className="pb-2 text-right">Req.</th>
                                                                    <th className="pb-2 text-right">Esc.</th>
                                                                    <th className="pb-2 text-right">Dif.</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="text-[10px]">
                                                                {audit.items.map((item, idx) => (
                                                                    <tr key={idx} className="border-t border-zinc-50 hover:bg-zinc-50/30">
                                                                        <td className="py-2 font-mono text-zinc-600">{item.order_line}</td>
                                                                        <td className="py-2 font-medium  text-zinc-800">{item.item_code}</td>
                                                                        <td className="py-2 text-zinc-700 uppercase text-[9px]">{item.description}</td>
                                                                        <td className="py-2 text-right font-mono">{item.qty_req}</td>
                                                                        <td className="py-2 text-right font-mono font-medium ">{item.qty_scan}</td>
                                                                        <td className={`py-2 text-right font-mono font-medium  ${item.difference !== 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                                                            {item.difference > 0 ? `+${item.difference}` : item.difference}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile View */}
                    <div className="block sm:hidden bg-zinc-50 p-2 space-y-3">
                        {audits.map((audit) => (
                            <div key={audit.id} className="bg-white border border-zinc-200 p-4 shadow-sm" onClick={() => toggleExpand(audit.id)}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-medium  text-[#285f94] tracking-tight">{audit.order_number}</span>
                                        <span className="text-[8px] text-zinc-600 uppercase tracking-widest">{audit.despatch_number}</span>
                                    </div>
                                    <span className={`px-2 py-0.5 text-[8px] font-medium  uppercase tracking-tight rounded border ${audit.status === 'Completo' || audit.status === 'Completado' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700'}`}>
                                        {audit.status}
                                    </span>
                                </div>
                                <div className="text-[10px] font-medium  text-zinc-700 uppercase mb-3 truncate">
                                    {audit.customer_code && audit.customer_code.trim() !== "" && (
                                         <span className="text-zinc-600 mr-1">[{audit.customer_code}]</span>
                                     )}
                                    {audit.customer_name}
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-zinc-50">
                                    <span className="text-[8px] font-mono text-zinc-600">{formatDate(audit.timestamp)}</span>
                                    <div className="flex gap-4">
                                        <Link to={`/packing_list/print/${audit.id}`} className="text-[9px] font-medium  uppercase text-zinc-600 hover:text-zinc-900" onClick={e => e.stopPropagation()}>Print</Link>
                                    </div>
                                </div>
                                {expandedAuditId === audit.id && (
                                    <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                                        {audit.items.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center text-[9px] bg-zinc-50 p-2 rounded">
                                                <div className="flex flex-col">
                                                    <span className="font-medium  text-zinc-800">{item.item_code}</span>
                                                    <span className="text-zinc-600 text-[8px]">L: {item.order_line}</span>
                                                </div>
                                                <div className="font-mono">
                                                    <span className="text-zinc-600">{item.qty_req}</span>
                                                    <span className="mx-1">/</span>
                                                    <span className="font-medium ">{item.qty_scan}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Selection Bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-zinc-900 text-white px-8 py-3 rounded-full shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-4 duration-300">
                    <span className="text-[10px] font-medium  uppercase tracking-[0.2em]">{selectedIds.size} Auditorías</span>
                    <button 
                        onClick={() => setShowShipmentModal(true)} 
                        className="bg-white text-zinc-900 px-6 py-1.5 rounded-full text-[10px] font-medium  uppercase tracking-widest hover:bg-zinc-200 transition-colors"
                    >
                        Consolidar Envío
                    </button>
                    <button 
                        onClick={handleDeleteSelected} 
                        className="bg-red-600 text-white px-6 py-1.5 rounded-full text-[10px] font-medium  uppercase tracking-widest hover:bg-red-700 transition-colors"
                    >
                        Eliminar
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-zinc-700 hover:text-white transition-colors">✕</button>
                </div>
            )}

            {/* Shipment Modal */}
            {showShipmentModal && (
                <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white border border-zinc-200 shadow-2xl w-full max-w-md p-8">
                        <h3 className="text-[12px] font-medium  text-zinc-900 uppercase tracking-tight mb-6">Crear Envío Consolidado</h3>
                        <div className="space-y-6">
                            <div className="space-y-1">
                                <label className="text-[9px] font-medium  text-zinc-600 uppercase tracking-widest">Transportadora</label>
                                <input type="text" value={shipmentCarrier} onChange={e => setShipmentCarrier(e.target.value)} className="w-full h-10 border border-zinc-200 px-4 text-xs outline-none focus:ring-1 focus:ring-zinc-900 bg-zinc-50" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[9px] font-medium  text-zinc-600 uppercase tracking-widest">Observaciones</label>
                                <textarea value={shipmentNote} onChange={e => setShipmentNote(e.target.value)} className="w-full border border-zinc-200 p-4 text-xs outline-none focus:ring-1 focus:ring-zinc-900 bg-zinc-50" rows={3} />
                            </div>
                        </div>
                        <div className="mt-8 flex justify-end gap-4">
                            <button onClick={() => setShowShipmentModal(false)} className="px-6 py-2 text-[10px] font-medium  uppercase tracking-widest text-zinc-600 hover:text-zinc-900">Cancelar</button>
                            <button onClick={handleCreateShipment} className="px-8 py-2 bg-zinc-900 text-white text-[10px] font-medium  uppercase tracking-widest hover:bg-zinc-800">
                                {creatingShipment ? 'Procesando...' : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {isEditModalOpen && editingAudit && (
                <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white border border-zinc-200 shadow-2xl w-full max-w-5xl p-8 flex flex-col max-h-[90vh]">
                        <div className="flex justify-between items-start mb-8 border-b border-zinc-100 pb-6">
                            <div className="flex flex-col gap-1">
                                <h3 className="text-sm font-medium  text-zinc-900 uppercase tracking-tight">Editar Auditoría ID #{editingAudit.id}</h3>
                                <div className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-4">
                                    <span>Orden: <span className="text-zinc-900 font-medium ">{editingAudit.order_number}</span></span>
                                    <span>Cliente: <span className="text-zinc-900 font-medium ">{editingAudit.customer_name}</span></span>
                                </div>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-4 bg-zinc-50 px-4 py-2 rounded border border-zinc-100">
                                    <span className="text-[10px] font-medium  text-zinc-600 uppercase tracking-widest">Bultos: {editingAudit.packages || 0}</span>
                                    <div className="flex gap-2">
                                        <button onClick={handleRemoveLastPackage} className="w-6 h-6 flex items-center justify-center bg-white border border-zinc-200 text-zinc-900 hover:bg-zinc-100 rounded text-sm font-medium  transition-all shadow-sm">−</button>
                                        <button onClick={handleAddNewPackage} className="w-6 h-6 flex items-center justify-center bg-zinc-900 text-white hover:bg-zinc-800 rounded text-sm font-medium  transition-all shadow-sm">+</button>
                                    </div>
                                </div>
                                <button onClick={() => setIsEditModalOpen(false)} className="text-zinc-500 hover:text-zinc-900 text-xl transition-colors px-2">✕</button>
                            </div>
                        </div>

                        <div className="overflow-y-auto mb-8 pr-2">
                            <table className="min-w-full">
                                <thead>
                                    <tr className="bg-[#4A5D73] text-white text-[10px] font-medium  uppercase tracking-widest">
                                        <th className="p-4 text-left w-12">Lín.</th>
                                        <th className="p-4 text-left w-32">Código</th>
                                        <th className="p-4 text-left">Descripción</th>
                                        <th className="p-4 text-center w-20">Req.</th>
                                        <th className="p-4 text-left">Distribución en Bultos</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {editingAudit.items.map((item, idx) => {
                                        const key = `${item.item_code}:${item.order_line || ''}`;
                                        const assignments = editingAudit.packages_assignment?.[key] || {};
                                        const packageKeys = Object.keys(assignments);
                                        const isUsingPackages = editingAudit.packages > 0;

                                        return (
                                            <tr key={idx} className="border-b border-zinc-50 hover:bg-zinc-50/20 transition-colors">
                                                <td className="p-4 font-mono text-[10px] text-zinc-600">{item.order_line}</td>
                                                <td className="p-4 text-[12px] font-medium  text-zinc-900">{item.item_code}</td>
                                                <td className="p-4 text-[10px] text-zinc-800 uppercase truncate max-w-xs">{item.description}</td>
                                                <td className="p-4 text-center text-[12px] font-mono text-zinc-800">{item.qty_req}</td>
                                                <td className="p-4">
                                                    {isUsingPackages ? (
                                                        <div className="flex flex-wrap items-center gap-3">
                                                            {packageKeys
                                                                .filter(pkgNum => (parseInt(assignments[pkgNum]) || 0) > 0)
                                                                .map(pkgNum => {
                                                                    const qty = parseInt(assignments[pkgNum]) || 0;
                                                                    return (
                                                                        <div key={pkgNum} className="flex items-center gap-2 bg-zinc-50 border border-zinc-100 p-1.5 rounded">
                                                                            <span className="text-[9px] font-medium  text-zinc-700 uppercase px-1">B{pkgNum}</span>
                                                                            <div className="flex items-center border border-zinc-200 bg-white rounded overflow-hidden h-6">
                                                                                <button onClick={() => qty - 1 <= 0 ? removePackageAssignment(idx, pkgNum) : handlePkgQtyChange(idx, pkgNum, qty - 1)} className="w-6 h-full flex items-center justify-center text-zinc-600 hover:bg-zinc-50 transition-colors text-sm">−</button>
                                                                                <span className="w-8 text-center text-[12px] font-medium  font-mono text-zinc-900">{qty}</span>
                                                                                <button onClick={() => handlePkgQtyChange(idx, pkgNum, qty + 1)} className="w-6 h-full flex items-center justify-center text-zinc-600 hover:bg-zinc-50 transition-colors text-sm">+</button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            <select
                                                                onChange={(e) => { handleAssignToPackage(idx, e.target.value); e.target.value = ''; }}
                                                                className="w-auto min-w-[130px] h-7 px-2 text-[9px] font-medium uppercase tracking-widest bg-white border border-dashed border-zinc-400 rounded cursor-pointer outline-none hover:border-zinc-900 hover:text-zinc-900 transition-all text-zinc-700"
                                                                defaultValue=""
                                                            >
                                                                <option value="" disabled>+ Añadir Bulto</option>
                                                                {Array.from({ length: editingAudit.packages || 0 }, (_, i) => i + 1)
                                                                    .filter(p => !packageKeys.includes(p.toString()))
                                                                    .map(p => <option key={p} value={p}>Bulto {p}</option>)
                                                                }
                                                                <option value="NEW">＋ Nuevo Bulto</option>
                                                            </select>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-zinc-600 uppercase italic tracking-widest">Sin asignación de bultos</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Formulario para agregar artículo no escaneado */}
                            <div className="mt-6 border-t border-zinc-100 pt-6">
                                {!isAddingItem ? (
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingItem(true)}
                                        className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded transition-all hover:bg-blue-100"
                                    >
                                        ＋ Agregar Artículo no Escaneado
                                    </button>
                                ) : (
                                    <div className="bg-zinc-50 p-5 border border-zinc-200 rounded flex flex-wrap gap-4 items-end transition-all">
                                        <div className="flex flex-col gap-1 w-24">
                                            <label className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">Línea</label>
                                            <input
                                                type="text"
                                                value={newItemLine}
                                                onChange={e => setNewItemLine(e.target.value)}
                                                className="border border-zinc-200 p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 bg-white"
                                                placeholder="Ej: 60"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1 w-44">
                                            <label className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">Código</label>
                                            <input
                                                type="text"
                                                value={newItemCode}
                                                onChange={e => {
                                                    setNewItemCode(e.target.value);
                                                    handleItemCodeLookup(e.target.value);
                                                }}
                                                className="border border-zinc-200 p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 bg-white font-mono"
                                                placeholder="Ej: 73411217"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                                            <label className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">Descripción</label>
                                            <input
                                                type="text"
                                                value={newItemDesc}
                                                onChange={e => setNewItemDesc(e.target.value)}
                                                className="border border-zinc-200 p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 bg-white"
                                                placeholder="Descripción del artículo"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1 w-24">
                                            <label className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">Cant. Req.</label>
                                            <input
                                                type="number"
                                                value={newItemQtyReq}
                                                onChange={e => setNewItemQtyReq(e.target.value)}
                                                className="border border-zinc-200 p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 bg-white font-mono"
                                                placeholder="Ej: 5"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleConfirmAddItem}
                                                className="px-5 py-2 bg-zinc-900 text-white text-[10px] font-medium uppercase tracking-widest hover:bg-zinc-800 h-9 transition-colors"
                                            >
                                                Confirmar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsAddingItem(false);
                                                    resetNewItemForm();
                                                }}
                                                className="px-4 py-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600 hover:text-zinc-900 h-9 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-4 pt-8 border-t border-zinc-100">
                            <button onClick={() => setIsEditModalOpen(false)} className="px-8 py-2 text-[11px] font-medium  uppercase tracking-widest text-zinc-600 hover:text-zinc-900">Cancelar</button>
                            <button onClick={handleSaveEdit} className="px-10 py-2 bg-zinc-900 text-white text-[11px] font-medium  uppercase tracking-widest hover:bg-zinc-800 disabled:bg-zinc-100" disabled={isSubmitting}>
                                {isSubmitting ? 'Guardando...' : 'Publicar Cambios'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PickingAuditHistory;
