import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';

const PlannerExecution = () => {
    const { setTitle } = useOutletContext();
    const [searchParams] = useSearchParams();
    // Default to today or url param
    const today = new Date().toISOString().split('T')[0];
    const [selectedDate, setSelectedDate] = useState(searchParams.get('date') || today);

    useEffect(() => { setTitle("Ejecución Diaria de Conteos"); }, [setTitle]);

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [hasPreviousCounts, setHasPreviousCounts] = useState(false);
    const [previousCountTotal, setPreviousCountTotal] = useState(0);
    const [itemsWithDiffCount, setItemsWithDiffCount] = useState(0);
    const [isRecountMode, setIsRecountMode] = useState(false);

    // Scanner State
    const [scannerOpen, setScannerOpen] = useState(false);

    // Load items when date changes
    useEffect(() => {
        if (!selectedDate) return;
        fetchDailyItems(selectedDate);
    }, [selectedDate]);

    const handleScan = (code) => {
        setScannerOpen(false);
        const cleanCode = code.trim().toUpperCase();
        // Buscar item
        const index = items.findIndex(i => i.item_code === cleanCode);

        if (index !== -1) {
            // Found
            toast.success(`Item encontrado: ${cleanCode}`, {
                containerId: "planner-execution"
            });

            // Focus input logic - assuming we render inputs with id={`qty-${index}`}
            setTimeout(() => {
                const el = document.getElementById(`qty-${index}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.focus();
                    el.select(); // Select content for easy overwrite
                }
            }, 100);

        } else {
            toast.warning("Item no está en la lista de hoy", {
                containerId: "planner-execution"
            });
        }
    };


    const fetchDailyItems = async (date) => {
        setLoading(true);
        setError(null);
        setItems([]);
        setHasPreviousCounts(false);
        setPreviousCountTotal(0);
        setItemsWithDiffCount(0);
        setIsRecountMode(false);

        try {
            const response = await fetch(`/api/planner/execution/daily_items?date=${date}`);
            if (!response.ok) throw new Error('Error al cargar ítems planificados');

            const data = await response.json();

            // Verificar si hay conteos previos
            if (data.has_previous_counts) {
                setHasPreviousCounts(true);
                setPreviousCountTotal(data.previous_count);
                setItemsWithDiffCount(data.items_with_diff_count || 0);

                const diffMsg = data.items_with_diff_count > 0
                    ? `, ${data.items_with_diff_count} con diferencias`
                    : '';

                toast.warning(`Esta fecha ya tiene ${data.previous_count} conteo(s) previo(s)${diffMsg}`, {
                    autoClose: 5000,
                    position: "top-center",
                    containerId: "planner-execution"
                });
            }

            // Initialize input state for each item (physical_qty)
            // Restaurar cantidades guardadas en localStorage
            const storageKey = `pe_counts_${date}`;
            let savedCounts = {};
            try { savedCounts = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { /* ignore */ }

            const initializedItems = (data.items || []).map(item => {
                const localDraftQty = savedCounts[item.item_code];
                const hasLocalDraft = localDraftQty !== undefined && localDraftQty !== '';
                const isAlreadySavedInDB = item.status === 'saved' || (item.physical_qty !== "" && item.physical_qty !== null && item.physical_qty !== undefined);

                let physicalQty = '';
                let status = 'pending';
                let isSaved = false;

                if (hasLocalDraft) {
                    physicalQty = localDraftQty;
                    const qty = parseInt(localDraftQty);
                    status = !isNaN(qty) ? 'counted' : 'pending';
                } else if (isAlreadySavedInDB) {
                    physicalQty = String(item.physical_qty);
                    status = 'saved';
                    isSaved = true;
                }

                const sysQty = item.system_qty || 0;
                const qty = parseInt(physicalQty);
                const diff = !isNaN(qty) ? qty - sysQty : (item.difference ?? null);

                return {
                    ...item,
                    physical_qty: physicalQty,
                    difference: diff,
                    status: status,
                    saved: isSaved
                };
            });
            setItems(initializedItems);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadItemsWithDifferences = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/planner/execution/items_with_differences?date=${selectedDate}`);
            if (!response.ok) throw new Error('Error al cargar items con diferencias');

            const data = await response.json();

            if (data.total_items_with_diff === 0) {
                toast.info('No hay items con diferencias para esta fecha', {
                    containerId: "planner-execution"
                });
                return;
            }

            // Initialize input state for each item
            // Restaurar cantidades guardadas en localStorage
            const storageKey = `pe_counts_${selectedDate}`;
            let savedCounts = {};
            try { savedCounts = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { /* ignore */ }

            const initializedItems = data.items.map(item => {
                const localDraftQty = savedCounts[item.item_code];
                const hasLocalDraft = localDraftQty !== undefined && localDraftQty !== '';
                const isAlreadySavedInDB = item.status === 'saved' || (item.physical_qty !== "" && item.physical_qty !== null && item.physical_qty !== undefined);

                let physicalQty = '';
                let status = 'pending';
                let isSaved = false;

                if (hasLocalDraft) {
                    physicalQty = localDraftQty;
                    const qty = parseInt(localDraftQty);
                    status = !isNaN(qty) ? 'counted' : 'pending';
                } else if (isAlreadySavedInDB) {
                    physicalQty = String(item.physical_qty);
                    status = 'saved';
                    isSaved = true;
                }

                const sysQty = item.system_qty || 0;
                const qty = parseInt(physicalQty);
                const diff = !isNaN(qty) ? qty - sysQty : (item.difference ?? null);

                return {
                    ...item,
                    physical_qty: physicalQty,
                    difference: diff,
                    status: status,
                    saved: isSaved
                };
            });

            setItems(initializedItems);
            setIsRecountMode(true);
            toast.success(`Cargados ${data.total_items_with_diff} items con diferencias para reconteo`, {
                containerId: "planner-execution"
            });
        } catch (err) {
            setError(err.message);
            toast.error('Error al cargar items con diferencias', {
                containerId: "planner-execution"
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCountChange = (index, value) => {
        const newItems = [...items];
        newItems[index].physical_qty = value;
        if (newItems[index].saved) {
            newItems[index].saved = false;
        }
        setItems(newItems);

        // Persistir cantidades en localStorage por fecha
        try {
            const storageKey = `pe_counts_${selectedDate}`;
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            saved[newItems[index].item_code] = value;
            localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch (e) { /* ignore storage errors */ }
    };

    const calculateDifference = (index) => {
        const newItems = [...items];
        const item = newItems[index];
        const qty = parseInt(item.physical_qty);

        if (!isNaN(qty)) {
            // Assuming system_qty is available in the fetched item data
            // Usually 'Quantity' from CSV or DB
            const sysQty = item.system_qty || 0;
            item.difference = qty - sysQty;
            item.status = 'counted';
        }
        setItems(newItems);
    };

    const handleBulkSave = async () => {
        // Filter items that have actual counts
        const countedItems = items.filter(item => item.status === 'counted' && !item.saved);

        if (countedItems.length === 0) {
            toast.warning("No hay items nuevos para guardar.", {
                containerId: "planner-execution"
            });
            return;
        }

        if (!window.confirm(`¿Estás seguro de guardar ${countedItems.length} items?`)) {
            return;
        }

        setSubmitting(true);
        setError(null);
        setMessage(null);

        try {
            const itemsPayload = countedItems.map(item => ({
                item_code: item.item_code,
                description: item.description,
                bin_location: item.bin_location || 'N/A',
                system_qty: item.system_qty || 0,
                physical_qty: parseInt(item.physical_qty),
                abc_code: item.abc_code
            }));

            const payload = {
                date: selectedDate,
                items: itemsPayload
            };

            const response = await fetch('/api/planner/execution/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Error al guardar los conteos');

            const result = await response.json();
            toast.success(result.message || "Conteos guardados exitosamente", {
                containerId: "planner-execution"
            });
            setMessage("Guardado exitoso. Puede continuar o cambiar de fecha.");

            // Limpiar cantidades guardadas en localStorage para esta fecha
            try { localStorage.removeItem(`pe_counts_${selectedDate}`); } catch (e) { /* ignore */ }

            // Mark saved items visually
            const newItems = items.map(item => {
                const isSaved = countedItems.some(c => c.item_code === item.item_code);
                return isSaved ? { ...item, saved: true } : item;
            });
            setItems(newItems);

            // Limpiar cantidades guardadas en localStorage para esta fecha
            try { localStorage.removeItem(`pe_counts_${selectedDate}`); } catch (e) { /* ignore */ }

        } catch (err) {
            console.error(err);
            setError(err.message);
            toast.error("Error al guardar conteos", {
                containerId: "planner-execution"
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-[1400px] mx-auto px-4 py-4 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f8f9fa] min-h-screen text-[#1f1f1f]">
            <ToastContainer position="top-center" autoClose={3000} containerId="planner-execution" />

            {/* Selección de Fecha y Acciones */}
            <div className="bg-white p-3 rounded border border-[#d1d5db] shadow-sm mb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <label className="text-[12px] font-normal text-[#5c5c5c] whitespace-nowrap">Fecha de Conteo:</label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="h-7 px-2 rounded border border-[#d1d5db] text-[12px] font-normal text-[#1f1f1f] focus:border-[#0067c0] outline-none bg-white"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => fetchDailyItems(selectedDate)}
                            className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-sm"
                        >
                            Actualizar
                        </button>
                        <button
                            onClick={() => setScannerOpen(true)}
                            className="h-7 px-3 bg-[#354a5f] hover:bg-[#2a3c4e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M0 .5A.5.5 0 0 1 .5 0h3a.5.5 0 0 1 0 1H1v2.5a.5.5 0 0 1-1 0zm12 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V1h-2.5a.5.5 0 0 1-.5-.5M.5 12a.5.5 0 0 1 .5.5V15h2.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H15v-2.5a.5.5 0 0 1 .5-.5M4 4h1v1H4z" />
                                <path d="M7 2H2v5h5zM3 3h3v3H3zm2 8H4v1h1z" />
                                <path d="M7 9H2v5h5zm-4 1h3v3H3zm8-6h1v1h-1z" />
                                <path d="M9 2h5v5H9zm1 1v3h3V3zM8 8v2h1v1H8v1h2v-2h1v2h1v-1h2v-1h-3V8zm2 2H9V9h1zm4 2h-1v1h-2v1h3zm-4 2v-1H8v1z" />
                                <path d="M12 9h2V8h-2z" />
                            </svg>
                            <span>Escanear</span>
                        </button>
                    </div>
                </div>
                {message && <span className="block mt-2 text-[#0067c0] text-[12px] font-normal">{message}</span>}

                {/* Banner de advertencia para conteos previos */}
                {hasPreviousCounts && (
                    <div className="mt-3 bg-[#fffbeb] border border-[#fef3c7] p-3 rounded">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start flex-1">
                                <svg className="h-4 w-4 text-[#d97706] mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1">
                                    <p className="text-[12px] font-normal text-[#92400e] m-0">
                                        Advertencia: Esta fecha ya tiene {previousCountTotal} conteo(s) previo(s)
                                        {itemsWithDiffCount > 0 && `, ${itemsWithDiffCount} con diferencias`}
                                    </p>
                                    <p className="text-[11px] text-[#b45309] mt-1 mb-0">
                                        Los nuevos conteos se agregarán a los existentes. Verifica que no estés duplicando información.
                                    </p>
                                </div>
                            </div>
                            {itemsWithDiffCount > 0 && (
                                <button
                                    onClick={loadItemsWithDifferences}
                                    className="h-7 px-3 flex-shrink-0 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                                    title="Cargar solo los items que tuvieron diferencias"
                                >
                                    <svg className="w-3.5 h-3.5 text-[#5c5c5c]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span>Cargar Items con Diferencias</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Badge de modo reconteo */}
                {isRecountMode && (
                    <div className="mt-2 inline-flex items-center gap-1.5 bg-[#edf3f9] text-[#0067c0] border border-[#cbdcf5] px-2.5 py-1 rounded text-[11px] font-normal">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Modo Reconteo - {items.length} items con diferencias
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#0067c0]"></div>
                </div>
            ) : error ? (
                <div className="bg-[#fef2f2] border border-[#fecaca] text-[#991b1b] p-3 rounded text-[12px] font-normal">{error}</div>
            ) : items.length === 0 ? (
                <div className="text-center py-16 text-[#5c5c5c] bg-white rounded border border-[#d1d5db] text-[12px] font-normal shadow-sm">
                    No hay ítems planificados para esta fecha.
                </div>
            ) : (
                <div className="bg-white shadow-sm border border-[#d1d5db] rounded overflow-hidden">
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal border-b border-[#2a3c4e]">
                                    <th className="px-3 py-2 font-normal">Item</th>
                                    <th className="px-3 py-2 text-center font-normal w-28">Ubicación</th>
                                    <th className="px-3 py-2 text-center font-normal w-16">ABC</th>
                                    <th className="px-3 py-2 text-center font-normal w-24">Cant. Física</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e5e7eb]">
                                {items.map((item, index) => (
                                    <tr key={index} className={`hover:bg-[#edf3f9] transition-colors text-[12px] font-normal text-[#1f1f1f] ${item.saved ? "bg-[#f0fdf4]" : ""}`}>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-normal text-[#1f1f1f]">{item.item_code}</span>
                                                {item.saved && (
                                                    <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-normal bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0]">
                                                        Guardado
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-[#5c5c5c] truncate max-w-[320px]">{item.description}</div>
                                        </td>
                                        <td className="px-3 py-2 text-[12px] text-[#5c5c5c] font-mono text-center">
                                            <div>{item.bin_location || '—'}</div>
                                            {item.additional_locations && (
                                                <div className="text-[10px] text-[#8c8c8c] mt-0.5" title="Ubicaciones Adicionales">
                                                    {item.additional_locations}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-[12px] text-[#5c5c5c] text-center font-normal">{item.abc_code}</td>
                                        <td className="px-3 py-2 text-center">
                                            <input
                                                id={`qty-${index}`}
                                                type="number"
                                                className={`h-7 w-20 text-center px-2 border rounded text-[12px] font-normal outline-none focus:border-[#0067c0] ${item.saved ? 'border-[#a7f3d0] bg-[#f0fdf4] text-[#065f46]' : 'border-[#d1d5db] bg-white text-[#1f1f1f]'}`}
                                                value={item.physical_qty}
                                                onChange={(e) => handleCountChange(index, e.target.value)}
                                                onBlur={() => calculateDifference(index)}
                                                placeholder="-"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="block sm:hidden bg-[#f8f9fa] p-3 space-y-2.5">
                        {items.map((item, index) => (
                            <div key={index} className={`bg-white rounded p-3 border shadow-sm ${item.saved ? 'border-[#a7f3d0] bg-[#f0fdf4]' : 'border-[#d1d5db]'}`}>
                                <div className="flex justify-between items-start mb-1.5">
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[13px] font-normal text-[#1f1f1f]">{item.item_code}</span>
                                            {item.saved && (
                                                <span className="px-1.5 py-0.2 bg-[#ecfdf5] text-[#065f46] text-[10px] font-normal rounded border border-[#a7f3d0]">
                                                    Guardado
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-[#5c5c5c]">{item.description}</span>
                                    </div>
                                    <span className="px-2 py-0.5 rounded text-[11px] font-normal border border-[#d1d5db] bg-[#fafafa] text-[#1f1f1f]">
                                        {item.abc_code}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#f0f0f0]">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-[#5c5c5c] font-normal tracking-wider">Ubicación</span>
                                        <span className="text-[12px] font-mono font-normal text-[#1f1f1f] bg-[#f5f5f5] px-2 py-0.5 rounded border border-[#e5e7eb] self-start mt-0.5">
                                            {item.bin_location || '—'}
                                        </span>
                                        {item.additional_locations && (
                                            <span className="text-[10px] text-[#8c8c8c] mt-0.5">
                                                Adic: {item.additional_locations}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] uppercase text-[#5c5c5c] font-normal tracking-wider mb-1">Cant. Física</span>
                                        <input
                                            id={`qty-mobile-${index}`}
                                            type="number"
                                            className={`h-7 w-20 text-center px-2 border rounded text-[12px] font-normal outline-none focus:border-[#0067c0] ${item.saved ? 'border-[#a7f3d0] bg-[#f0fdf4] text-[#065f46]' : 'border-[#d1d5db] bg-white text-[#1f1f1f]'}`}
                                            value={item.physical_qty}
                                            onChange={(e) => handleCountChange(index, e.target.value)}
                                            onBlur={() => calculateDifference(index)}
                                            placeholder="0"
                                            inputMode="numeric"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Bulk Save Footer */}
                    <div className="bg-[#f8f9fa] px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[#d1d5db]">
                        <div className="text-[12px] font-normal text-[#5c5c5c] flex flex-wrap items-center gap-3">
                            <span>
                                Guardados en BD: <span className="font-normal text-[#065f46]">{items.filter(i => i.saved).length}</span>
                            </span>
                            <span className="text-[#d1d5db]">|</span>
                            <span>
                                Nuevos a guardar: <span className="font-normal text-[#0067c0]">{items.filter(i => i.status === 'counted' && !i.saved).length}</span>
                            </span>
                            <span className="text-[#d1d5db]">|</span>
                            <span>
                                Total plan: <span className="font-normal text-[#1f1f1f]">{items.length}</span>
                            </span>
                        </div>
                        <button
                            onClick={handleBulkSave}
                            disabled={submitting || items.filter(i => i.status === 'counted' && !i.saved).length === 0}
                            className="h-7 px-4 rounded text-[12px] font-normal text-white transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-[#0067c0] hover:bg-[#005a9e]"
                        >
                            {submitting ? 'Guardando...' : 'Guardar y Finalizar'}
                        </button>
                    </div>
                </div>
            )}

            {/* Scanner Modal */}
            {scannerOpen && (
                <ScannerModal
                    onScan={handleScan}
                    onClose={() => setScannerOpen(false)}
                />
            )}
        </div>
    );
};

export default PlannerExecution;
