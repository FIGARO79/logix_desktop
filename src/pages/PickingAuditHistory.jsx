import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { getDB } from '../utils/offlineDb';
import { getPickingAudits, updatePickingAudit, deletePickingAudits } from '../utils/tauriApi';

const PickingAuditHistory = () => {
    const tabContext = useOutletContext();
    const setTitle = tabContext?.setTitle || (() => {});
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
        if (typeof setTitle === 'function') {
            setTitle("Pickings Empacados");
        }
    }, [setTitle]);

    useEffect(() => {
        fetchAudits();
    }, []);

    const fetchAudits = async () => {
        setLoading(true);
        setError(null);
        try {
            let serverAudits = [];
            try {
                serverAudits = await getPickingAudits();
            } catch (e) {
                const response = await fetch('/api/views/view_picking_audits', { credentials: 'include' });
                if (response.ok) {
                    serverAudits = await response.json();
                }
            }

            if (Array.isArray(serverAudits) && serverAudits.length > 0) {
                setAudits(serverAudits);
                return;
            }

            // Fallback para IndexedDB solo si no vinieron del servidor/SQLite
            const db = await getDB();
            const directAudits = db ? (await db.getAll('picking_audits') || []) : [];
            const pendingList = db ? (await db.getAll('pending_sync') || []) : [];
            
            const legacyLocalAudits = pendingList
                .filter(item => item.collection === 'picking' && item.payload)
                .map((item, idx) => ({
                    id: item.id || `local_${idx}`,
                    order_number: item.payload?.order_number || 'N/A',
                    despatch_number: item.payload?.despatch_number || '00',
                    customer_code: item.payload?.customer_code || '',
                    customer_name: item.payload?.customer_name || 'Cliente General',
                    username: item.payload?.username || 'Local',
                    timestamp: item.timestamp || new Date().toISOString(),
                    status: item.payload?.status || 'Completo',
                    packages: item.payload?.packages || 1,
                    packages_assignment: item.payload?.packages_assignment || {},
                    items: (item.payload?.items || []).map(it => ({
                        id: it.id || null,
                        item_code: it.code || it.item_code || '',
                        code: it.code || it.item_code || '',
                        description: it.description || '',
                        order_line: it.order_line || '',
                        qty_req: parseFloat(it.qty_req || 0),
                        qty_scan: parseFloat(it.qty_scan || 0),
                        difference: (parseFloat(it.qty_scan || 0)) - (parseFloat(it.qty_req || 0))
                    }))
                }));

            const combinedMap = new Map();
            directAudits.forEach(a => {
                const key = a.id ? String(a.id) : `${a.order_number}_${a.despatch_number}`;
                combinedMap.set(key, a);
            });
            legacyLocalAudits.forEach(a => {
                const key = a.id ? String(a.id) : `${a.order_number}_${a.despatch_number}`;
                if (!combinedMap.has(key)) combinedMap.set(key, a);
            });

            setAudits(Array.from(combinedMap.values()));
        } catch (err) {
            console.error("Error al cargar auditorías de picking:", err);
            setError("Error al cargar las auditorías de alistamiento.");
        } finally {
            setLoading(false);
        }
    };

    const toggleExpand = (id) => setExpandedAuditId(expandedAuditId === id ? null : id);

    const normalizeDate = (dateString) => {
        if (!dateString) return null;
        if (typeof dateString !== 'string') {
            try {
                return new Date(dateString).toISOString();
            } catch (e) {
                return null;
            }
        }
        let normalized = dateString.trim().replace(' ', 'T');
        if (normalized.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
            return `${normalized}T00:00:00Z`;
        }
        const hasTimeZone = normalized.includes('Z') || /[+-]\d{2}:\d{2}$/.test(normalized);
        if (!hasTimeZone && normalized.includes('T')) {
            normalized = `${normalized}Z`;
        }
        return normalized;
    };

    const isToday = (dateString) => {
        try {
            const normalized = normalizeDate(dateString);
            if (!normalized) return false;
            const date = new Date(normalized);
            if (isNaN(date.getTime())) return false;
            const today = new Date();
            return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
        } catch (e) {
            return false;
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const normalized = normalizeDate(dateString);
            const date = normalized ? new Date(normalized) : new Date(dateString);
            if (isNaN(date.getTime())) return String(dateString);
            return date.toLocaleString(undefined, {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false
            });
        } catch (e) {
            return String(dateString);
        }
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
            try {
                await updatePickingAudit(editingAudit.id, payload);
            } catch (err) {
                const response = await fetch(`/api/update_picking_audit/${editingAudit.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'include'
                });
                if (!response.ok) {
                    const resErr = await response.json();
                    throw new Error(resErr.detail || 'Error al actualizar');
                }
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
            const numericIds = [...selectedIds].map(Number).filter(n => !isNaN(n));
            try {
                await deletePickingAudits(numericIds);
            } catch (err) {
                const res = await fetch('/api/delete_picking_audits', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ audit_ids: numericIds }),
                    credentials: 'include'
                });
                if (!res.ok) {
                    const resErr = await res.json();
                    throw new Error(resErr.detail || 'Error al eliminar auditorías');
                }
            }
            toast.success("Auditorías eliminadas correctamente");
            setSelectedIds(new Set());
            await fetchAudits();
        } catch (err) {
            toast.error(err.message);
        }
    };

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f] text-[12px]">
            <ToastContainer position="top-right" autoClose={3000} />

            {/* Header */}
            <div className="mb-3 flex justify-between items-center bg-white px-4 py-2.5 rounded border border-[#d1d5db] shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Pickings Empacados</h1>
                    <p className="text-[11px] font-normal text-[#5c5c5c] mt-0.5 mb-0">Historial y auditoría de órdenes de picking despachadas</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={fetchAudits}
                        className="h-7 px-3 border border-[#d1d5db] text-[#1f1f1f] bg-white text-[12px] font-normal rounded hover:bg-[#f5f5f5] transition-colors shadow-xs cursor-pointer"
                    >
                        Refrescar
                    </button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center items-center py-16">
                    <div className="text-[#5c5c5c] text-[12px] font-normal">Cargando registros de auditoría...</div>
                </div>
            )}

            {error && (
                <div className="mb-3 bg-[#fef2f2] text-[#991b1b] px-3 py-2 border border-[#fecaca] rounded text-[11px] font-normal">
                    {error}
                </div>
            )}

            {!loading && !error && (
                <div className="bg-white border border-[#d1d5db] rounded shadow-sm overflow-hidden">
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full leading-normal border-collapse">
                            <thead>
                                <tr className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal border-b border-[#2a3c4e] sticky top-0 z-10">
                                    <th className="px-3 py-1.5 text-center w-10">
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
                                            className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#0067c0] focus:ring-[#0067c0] cursor-pointer"
                                            title="Seleccionar todo"
                                        />
                                    </th>
                                    <th className="px-2 py-1.5 text-center w-6"></th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-left">ID</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-left">Orden</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-left">Despacho</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-left">Cliente</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-left">Usuario</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-left">Fecha</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-center">Estado</th>
                                    <th className="px-3 py-1.5 text-[11px] font-normal text-white text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e5e7eb]">
                                {audits.length === 0 ? (
                                    <tr>
                                        <td colSpan="10" className="px-4 py-8 text-center text-[#8c8c8c] text-[12px] italic font-normal">
                                            No se han registrado auditorías de picking todavía.
                                        </td>
                                    </tr>
                                ) : (
                                    audits.map((audit, idx) => (
                                        <React.Fragment key={audit.id}>
                                            <tr
                                                className={`border-b border-[#e5e7eb] hover:bg-[#edf3f9] transition-colors cursor-pointer leading-none h-7
                                                    ${expandedAuditId === audit.id ? 'bg-[#f0f7ff]' : (idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white')}
                                                    ${selectedIds.has(audit.id) ? 'bg-[#e5f0fb]' : ''}`}
                                                onClick={() => toggleExpand(audit.id)}
                                            >
                                            <td className="px-3 py-1 text-center" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(audit.id)}
                                                    onChange={() => toggleSelect(audit.id)}
                                                    className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#0067c0] focus:ring-[#0067c0] cursor-pointer"
                                                />
                                            </td>
                                            <td className="px-2 py-1 text-center">
                                                <span className={`text-[10px] text-[#5c5c5c] inline-block transition-transform duration-200 ${expandedAuditId === audit.id ? 'rotate-90' : ''}`}>
                                                    ▶
                                                </span>
                                            </td>
                                            <td className="px-3 py-1 text-[11.5px] font-normal text-[#5c5c5c] font-mono">{audit.id}</td>
                                            <td className="px-3 py-1 text-[11.5px] font-normal text-[#0067c0]">{audit.order_number}</td>
                                            <td className="px-3 py-1 text-[11.5px] text-[#1f1f1f] font-normal uppercase">{audit.despatch_number}</td>
                                            <td className="px-3 py-1 text-[11.5px] text-[#5c5c5c] truncate max-w-[200px] font-normal">
                                                 {audit.customer_code && audit.customer_code.trim() !== "" && (
                                                     <span className="text-[#1f1f1f] mr-1 font-mono">[{audit.customer_code}]</span>
                                                 )}
                                                {audit.customer_name || 'N/A'}
                                            </td>
                                            <td className="px-3 py-1 text-[11.5px] text-[#5c5c5c] uppercase font-normal">{audit.username}</td>
                                            <td className="px-3 py-1 text-[11px] text-[#5c5c5c] font-normal whitespace-nowrap">{formatDate(audit.timestamp)}</td>
                                            <td className="px-3 py-1 text-center">
                                                <span className={`px-2 py-0.5 inline-flex text-[10px] font-normal rounded border ${
                                                    audit.status === 'Completado' || audit.status === 'Completo'
                                                    ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]' : 'bg-[#fffbeb] text-[#92400e] border-[#fde68a]'
                                                }`}>
                                                    {audit.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-center items-center gap-2">
                                                    {isToday(audit.timestamp) && (
                                                        <button
                                                            onClick={() => handleEditClick(audit)}
                                                            className="h-6 px-2 text-[11px] font-normal text-[#0067c0] hover:bg-[#f0f7ff] rounded transition-colors cursor-pointer"
                                                            title="Editar"
                                                        >
                                                            Editar
                                                        </button>
                                                    )}
                                                    <Link
                                                        to={`/packing_list/print/${audit.id}`}
                                                        className="h-6 px-2 text-[11px] font-normal text-[#0067c0] hover:bg-[#f0f7ff] rounded transition-colors inline-flex items-center"
                                                        title="Imprimir"
                                                    >
                                                        Imprimir
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>

                                        {expandedAuditId === audit.id && (
                                            <tr className="bg-[#f8f9fa]">
                                                <td colSpan="10" className="px-6 py-3 border-b border-[#e5e7eb]">
                                                    <div className="bg-white border border-[#d1d5db] rounded p-3 shadow-xs">
                                                        <h4 className="text-[11px] font-normal text-[#5c5c5c] mb-2 border-b border-[#e5e7eb] pb-1">Detalle de Contenido</h4>
                                                        <table className="w-full text-[11.5px] border-collapse">
                                                            <thead>
                                                                <tr className="text-[10px] font-normal text-[#5c5c5c] border-b border-[#e5e7eb]">
                                                                    <th className="pb-1 text-left w-12 font-normal">Lín.</th>
                                                                    <th className="pb-1 text-left font-normal">SKU</th>
                                                                    <th className="pb-1 text-left font-normal">Descripción</th>
                                                                    <th className="pb-1 text-right font-normal">Req.</th>
                                                                    <th className="pb-1 text-right font-normal">Esc.</th>
                                                                    <th className="pb-1 text-right font-normal">Dif.</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-[#f3f4f6]">
                                                                {(audit.items || []).map((item, idx) => (
                                                                    <tr key={idx} className="hover:bg-[#edf3f9]">
                                                                        <td className="py-1 font-mono text-[#5c5c5c]">{item.order_line}</td>
                                                                        <td className="py-1 font-normal text-[#0067c0]">{item.item_code}</td>
                                                                        <td className="py-1 text-[#5c5c5c] text-[11px]">{item.description}</td>
                                                                        <td className="py-1 text-right font-mono font-normal text-[#1f1f1f]">{item.qty_req}</td>
                                                                        <td className="py-1 text-right font-mono font-normal text-[#0067c0]">{item.qty_scan}</td>
                                                                        <td className={`py-1 text-right font-mono font-normal ${item.difference !== 0 ? 'text-[#991b1b]' : 'text-[#065f46]'}`}>
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
                                ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile View */}
                    <div className="block sm:hidden bg-[#f8f9fa] p-2 space-y-3 font-['Segoe_UI',Tahoma,sans-serif]">
                        {audits.length === 0 ? (
                            <div className="bg-white border border-[#e5e7eb] p-8 text-center text-black text-[12px] font-normal tracking-normal">
                                No se han registrado auditorías de picking todavía.
                            </div>
                        ) : (
                            audits.map((audit) => (
                                <div key={audit.id} className="bg-white border border-[#e5e7eb] p-3 shadow-xs" onClick={() => toggleExpand(audit.id)}>
                                <div className="flex justify-between items-start mb-1.5">
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-normal text-[#0067c0]">{audit.order_number}</span>
                                        <span className="text-[9px] text-black uppercase tracking-normal font-normal">{audit.despatch_number}</span>
                                    </div>
                                    <span className={`px-2 py-0.5 text-[8px] font-normal uppercase tracking-normal rounded border ${audit.status === 'Completo' || audit.status === 'Completado' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700'}`}>
                                        {audit.status}
                                    </span>
                                </div>
                                <div className="text-[10px] font-normal text-black uppercase mb-2 truncate">
                                    {audit.customer_code && audit.customer_code.trim() !== "" && (
                                         <span className="text-black mr-1">[{audit.customer_code}]</span>
                                     )}
                                    {audit.customer_name}
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-[#f3f4f6]">
                                    <span className="text-[9px] font-mono text-black font-normal">{formatDate(audit.timestamp)}</span>
                                    <div className="flex gap-4">
                                        <Link to={`/packing_list/print/${audit.id}`} className="text-[10px] font-normal uppercase text-black hover:underline" onClick={e => e.stopPropagation()}>Print</Link>
                                    </div>
                                </div>
                                {expandedAuditId === audit.id && (
                                    <div className="mt-3 pt-3 border-t border-[#f3f4f6] space-y-2">
                                        {(audit.items || []).map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center text-[10px] bg-[#f8f9fa] p-2 rounded">
                                                <div className="flex flex-col">
                                                    <span className="font-normal text-black">{item.item_code}</span>
                                                    <span className="text-black text-[9px] font-normal">L: {item.order_line}</span>
                                                </div>
                                                <div className="font-mono text-black font-normal">
                                                    <span>{item.qty_req}</span>
                                                    <span className="mx-1">/</span>
                                                    <span>{item.qty_scan}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Selection Bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[#354a5f] text-white px-5 py-2 rounded shadow-lg flex items-center gap-4 border border-[#2a3c4e] animate-in slide-in-from-bottom-2 duration-200">
                    <span className="text-[12px] font-normal">{selectedIds.size} seleccionadas</span>
                    <button 
                        onClick={() => setShowShipmentModal(true)} 
                        className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer"
                    >
                        Consolidar Envío
                    </button>
                    <button 
                        onClick={handleDeleteSelected} 
                        className="h-7 px-3 bg-red-600 hover:bg-red-700 text-white text-[12px] font-normal rounded transition-colors cursor-pointer"
                    >
                        Eliminar
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-gray-300 hover:text-white transition-colors cursor-pointer text-sm px-1">✕</button>
                </div>
            )}

            {/* Shipment Modal */}
            {showShipmentModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white border border-[#d1d5db] shadow-xl w-full max-w-md rounded overflow-hidden">
                        <div className="bg-[#354a5f] text-white px-4 py-2.5 flex items-center justify-between border-b border-[#2a3c4e]">
                            <h3 className="text-[12px] font-normal">Crear Envío Consolidado</h3>
                            <button onClick={() => setShowShipmentModal(false)} className="text-gray-300 hover:text-white text-sm cursor-pointer">✕</button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div className="space-y-1">
                                <label className="text-[11px] font-normal text-gray-700">Transportadora</label>
                                <input type="text" value={shipmentCarrier} onChange={e => setShipmentCarrier(e.target.value)} className="w-full h-7 border border-[#d1d5db] px-2 text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white rounded" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-normal text-gray-700">Observaciones</label>
                                <textarea value={shipmentNote} onChange={e => setShipmentNote(e.target.value)} className="w-full border border-[#d1d5db] p-2 text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white rounded" rows={3} />
                            </div>
                        </div>
                        <div className="px-4 py-3 bg-[#f8f9fa] border-t border-[#e5e7eb] flex justify-end gap-2">
                            <button onClick={() => setShowShipmentModal(false)} className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer">Cancelar</button>
                            <button onClick={handleCreateShipment} className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer disabled:opacity-50" disabled={creatingShipment}>
                                {creatingShipment ? 'Procesando...' : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {isEditModalOpen && editingAudit && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white border border-[#d1d5db] shadow-xl w-full max-w-5xl rounded overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="bg-[#354a5f] text-white px-4 py-2.5 flex justify-between items-center border-b border-[#2a3c4e]">
                            <div className="flex items-center gap-4">
                                <h3 className="text-[12px] font-normal">Editar Auditoría ID #{editingAudit.id}</h3>
                                <span className="text-[11px] text-gray-300">Orden: {editingAudit.order_number}</span>
                                <span className="text-[11px] text-gray-300">Cliente: {editingAudit.customer_name}</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 bg-[#2a3c4e] px-2 py-1 rounded">
                                    <span className="text-[11px] font-normal text-white">Bultos: {editingAudit.packages || 0}</span>
                                    <div className="flex gap-1">
                                        <button onClick={handleRemoveLastPackage} className="w-5 h-5 flex items-center justify-center bg-white border border-[#d1d5db] text-[#1f1f1f] hover:bg-[#f5f5f5] rounded text-xs font-normal transition-all cursor-pointer">−</button>
                                        <button onClick={handleAddNewPackage} className="w-5 h-5 flex items-center justify-center bg-[#0067c0] text-white hover:bg-[#005a9e] rounded text-xs font-normal transition-all cursor-pointer">+</button>
                                    </div>
                                </div>
                                <button onClick={() => setIsEditModalOpen(false)} className="text-gray-300 hover:text-white text-base transition-colors cursor-pointer px-1">✕</button>
                            </div>
                        </div>

                        <div className="overflow-y-auto p-4 flex-1">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal sticky top-0 border-b border-[#2a3c4e]">
                                        <th className="py-2 px-3 text-left w-12 font-normal">Lín.</th>
                                        <th className="py-2 px-3 text-left w-32 font-normal">Código</th>
                                        <th className="py-2 px-3 text-left font-normal">Descripción</th>
                                        <th className="py-2 px-3 text-center w-20 font-normal">Req.</th>
                                        <th className="py-2 px-3 text-left font-normal">Distribución en Bultos</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {editingAudit.items.map((item, idx) => {
                                        const key = `${item.item_code}:${item.order_line || ''}`;
                                        const assignments = editingAudit.packages_assignment?.[key] || {};
                                        const packageKeys = Object.keys(assignments);
                                        const isUsingPackages = editingAudit.packages > 0;

                                        return (
                                            <tr key={idx} className={`border-b border-[#f0f0f0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#edf3f9] transition-colors`}>
                                                <td className="py-2 px-3 font-mono text-[11px] text-gray-600">{item.order_line}</td>
                                                <td className="py-2 px-3 text-[12px] font-normal text-gray-900">{item.item_code}</td>
                                                <td className="py-2 px-3 text-[11.5px] text-gray-700 truncate max-w-xs">{item.description}</td>
                                                <td className="py-2 px-3 text-center text-[12px] font-mono text-gray-800">{item.qty_req}</td>
                                                <td className="py-2 px-3">
                                                    {isUsingPackages ? (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            {packageKeys
                                                                .filter(pkgNum => (parseInt(assignments[pkgNum]) || 0) > 0)
                                                                .map(pkgNum => {
                                                                    const qty = parseInt(assignments[pkgNum]) || 0;
                                                                    return (
                                                                        <div key={pkgNum} className="flex items-center gap-1.5 bg-white border border-[#d1d5db] px-2 py-0.5 rounded">
                                                                            <span className="text-[11px] font-normal text-gray-700">B{pkgNum}</span>
                                                                            <div className="flex items-center border border-[#d1d5db] bg-white rounded overflow-hidden h-5">
                                                                                <button onClick={() => qty - 1 <= 0 ? removePackageAssignment(idx, pkgNum) : handlePkgQtyChange(idx, pkgNum, qty - 1)} className="w-5 h-full flex items-center justify-center text-gray-600 hover:bg-[#f5f5f5] transition-colors text-xs cursor-pointer">−</button>
                                                                                <span className="w-6 text-center text-[11px] font-normal font-mono text-gray-900">{qty}</span>
                                                                                <button onClick={() => handlePkgQtyChange(idx, pkgNum, qty + 1)} className="w-5 h-full flex items-center justify-center text-gray-600 hover:bg-[#f5f5f5] transition-colors text-xs cursor-pointer">+</button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            <select
                                                                onChange={(e) => { handleAssignToPackage(idx, e.target.value); e.target.value = ''; }}
                                                                className="h-6 px-2 text-[11px] font-normal bg-white border border-[#d1d5db] rounded cursor-pointer outline-none hover:border-[#0067c0] text-gray-700"
                                                                defaultValue=""
                                                            >
                                                                <option value="" disabled>+ Añadir Bulto</option>
                                                                {Array.from({ length: editingAudit.packages || 0 }, (_, i) => i + 1)
                                                                    .filter(p => !packageKeys.includes(p.toString()))
                                                                    .map(p => <option key={p} value={p}>Bulto {p}</option>)
                                                                }
                                                                <option value="NEW">+ Nuevo Bulto</option>
                                                            </select>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[11px] text-gray-500 italic">Sin asignación de bultos</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Formulario para agregar artículo no escaneado */}
                            <div className="mt-4 border-t border-[#e5e7eb] pt-4">
                                {!isAddingItem ? (
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingItem(true)}
                                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#0067c0] hover:text-[#005a9e] text-[12px] font-normal rounded transition-colors cursor-pointer"
                                    >
                                        + Agregar Artículo no Escaneado
                                    </button>
                                ) : (
                                    <div className="bg-[#f8f9fa] p-3 border border-[#d1d5db] rounded flex flex-wrap gap-3 items-end transition-all">
                                        <div className="flex flex-col gap-1 w-24">
                                            <label className="text-[11px] font-normal text-gray-600">Línea</label>
                                            <input
                                                type="text"
                                                value={newItemLine}
                                                onChange={e => setNewItemLine(e.target.value)}
                                                className="h-7 border border-[#d1d5db] px-2 text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white rounded"
                                                placeholder="Ej: 60"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1 w-36">
                                            <label className="text-[11px] font-normal text-gray-600">Código</label>
                                            <input
                                                type="text"
                                                value={newItemCode}
                                                onChange={e => {
                                                    setNewItemCode(e.target.value);
                                                    handleItemCodeLookup(e.target.value);
                                                }}
                                                className="h-7 border border-[#d1d5db] px-2 text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white font-mono rounded"
                                                placeholder="Ej: 73411217"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                                            <label className="text-[11px] font-normal text-gray-600">Descripción</label>
                                            <input
                                                type="text"
                                                value={newItemDesc}
                                                onChange={e => setNewItemDesc(e.target.value)}
                                                className="h-7 border border-[#d1d5db] px-2 text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white rounded"
                                                placeholder="Descripción del artículo"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1 w-24">
                                            <label className="text-[11px] font-normal text-gray-600">Cant. Req.</label>
                                            <input
                                                type="number"
                                                value={newItemQtyReq}
                                                onChange={e => setNewItemQtyReq(e.target.value)}
                                                className="h-7 border border-[#d1d5db] px-2 text-[12px] font-normal outline-none focus:border-[#0067c0] bg-white font-mono rounded"
                                                placeholder="Ej: 5"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleConfirmAddItem}
                                                className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer"
                                            >
                                                Confirmar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsAddingItem(false);
                                                    resetNewItemForm();
                                                }}
                                                className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="px-4 py-3 bg-[#f8f9fa] border-t border-[#e5e7eb] flex justify-end gap-2">
                            <button onClick={() => setIsEditModalOpen(false)} className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer">Cancelar</button>
                            <button onClick={handleSaveEdit} className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer disabled:opacity-50" disabled={isSubmitting}>
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
