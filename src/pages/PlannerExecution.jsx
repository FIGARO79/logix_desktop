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

                toast.warning(`⚠️ Esta fecha ya tiene ${data.previous_count} conteo(s) previo(s)${diffMsg}`, {
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
            toast.success(`✅ Cargados ${data.total_items_with_diff} items con diferencias para reconteo`, {
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
        <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
            <ToastContainer position="top-center" autoClose={3000} containerId="planner-execution" />

            {/* Date Selection - Mobile Optimized */}
            <div className="bg-white p-3 sm:p-4 rounded-lg shadow mb-4 sm:mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 flex-1">
                        <label className="font-medium  text-gray-700 text-sm whitespace-nowrap">Fecha:</label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="flex-1 rounded border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => fetchDailyItems(selectedDate)}
                            className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded text-sm font-medium transition-colors"
                        >
                            Actualizar
                        </button>
                        <button
                            onClick={() => setScannerOpen(true)}
                            className="flex-1 sm:flex-none bg-gray-700 hover:bg-gray-800 text-white px-4 py-2.5 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M0 .5A.5.5 0 0 1 .5 0h3a.5.5 0 0 1 0 1H1v2.5a.5.5 0 0 1-1 0zm12 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V1h-2.5a.5.5 0 0 1-.5-.5M.5 12a.5.5 0 0 1 .5.5V15h2.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H15v-2.5a.5.5 0 0 1 .5-.5M4 4h1v1H4z" />
                                <path d="M7 2H2v5h5zM3 3h3v3H3zm2 8H4v1h1z" />
                                <path d="M7 9H2v5h5zm-4 1h3v3H3zm8-6h1v1h-1z" />
                                <path d="M9 2h5v5H9zm1 1v3h3V3zM8 8v2h1v1H8v1h2v-2h1v2h1v-1h2v-1h-3V8zm2 2H9V9h1zm4 2h-1v1h-2v1h3zm-4 2v-1H8v1z" />
                                <path d="M12 9h2V8h-2z" />
                            </svg>
                            <span className="hidden sm:inline">Escanear</span>
                            <span className="sm:hidden">Scan</span>
                        </button>
                    </div>
                </div>
                {message && <span className="block mt-2 text-green-600 text-sm font-medium">{message}</span>}

                {/* Banner de advertencia para conteos previos */}
                {hasPreviousCounts && (
                    <div className="mt-3 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start flex-1">
                                <svg className="h-5 w-5 text-yellow-400 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1">
                                    <p className="text-sm font-medium  text-yellow-800">
                                        ⚠️ Advertencia: Esta fecha ya tiene {previousCountTotal} conteo(s) previo(s)
                                        {itemsWithDiffCount > 0 && `, ${itemsWithDiffCount} con diferencias`}
                                    </p>
                                    <p className="text-xs text-yellow-700 mt-1">
                                        Los nuevos conteos se agregarán a los existentes. Verifica que no estés duplicando información.
                                    </p>
                                </div>
                            </div>
                            {itemsWithDiffCount > 0 && (
                                <button
                                    onClick={loadItemsWithDifferences}
                                    className="flex-shrink-0 bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1.5 rounded text-xs font-medium  transition-colors shadow-sm flex items-center gap-1.5"
                                    title="Cargar solo los items que tuvieron diferencias"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span className="hidden sm:inline">Cargar Items con Diferencias</span>
                                    <span className="sm:hidden">Reconteo</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Badge de modo reconteo */}
                {isRecountMode && (
                    <div className="mt-2 inline-flex items-center gap-1.5 bg-blue-100 text-[#1e4a74] px-3 py-1 rounded-full text-xs font-medium ">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Modo Reconteo - {items.length} items con diferencias
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
                </div>
            ) : error ? (
                <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded">{error}</div>
            ) : items.length === 0 ? (
                <div className="text-center py-12 text-gray-500 bg-white rounded shadow">
                    No hay ítems planificados para esta fecha.
                </div>
            ) : (
                <div className="bg-white shadow overflow-hidden rounded-lg">
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-[#34495e] text-white">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium  uppercase tracking-wider w-auto">Item</th>
                                    <th className="px-2 py-3 text-center text-xs font-medium  uppercase tracking-wider w-24">Ubicación</th>
                                    <th className="px-2 py-3 text-center text-xs font-medium  uppercase tracking-wider w-16">ABC</th>
                                    <th className="px-1 py-3 text-center text-xs font-medium  uppercase tracking-wider w-16">Físico</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {items.map((item, index) => (
                                    <tr key={index} className={item.saved ? "bg-emerald-50/70" : ""}>
                                        <td className="px-2 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <div className="text-sm font-medium text-indigo-600">{item.item_code}</div>
                                                {item.saved && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                        ✓ Guardado
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate max-w-[150px] sm:max-w-xs">{item.description}</div>
                                        </td>
                                        <td className="px-1 py-2 text-sm text-gray-500 font-mono text-center">
                                            <div>{item.bin_location || 'N/A'}</div>
                                            {item.additional_locations && (
                                                <div className="text-[10px] text-gray-400 mt-0.5" title="Ubicaciones Adicionales">
                                                    {item.additional_locations}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-1 py-2 text-sm text-gray-500 text-center">{item.abc_code}</td>
                                        <td className="px-0 py-2 text-center">
                                            <input
                                                id={`qty-${index}`}
                                                type="number"
                                                className={`w-16 text-center p-1 border rounded text-sm no-spinner ${item.saved ? 'border-emerald-400 bg-emerald-50 font-semibold text-emerald-900' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
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
                    <div className="block sm:hidden bg-gray-50 p-2 space-y-3">
                        {items.map((item, index) => (
                            <div key={index} className={`bg-white rounded-lg shadow-sm p-3 border ${item.saved ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg font-medium text-indigo-700">{item.item_code}</span>
                                            {item.saved && (
                                                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-semibold rounded border border-emerald-200">
                                                    ✓ Guardado
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500">{item.description}</span>
                                    </div>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${item.abc_code === 'A' ? 'bg-red-100 text-red-800' :
                                        item.abc_code === 'B' ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-blue-100 text-[#1e4a74]'
                                        }`}>
                                        {item.abc_code}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center mt-3">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">Ubicación</span>
                                        <span className="text-sm font-mono font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded self-start">
                                            {item.bin_location || 'N/A'}
                                        </span>
                                        {item.additional_locations && (
                                            <span className="text-[10px] text-gray-500 mt-1 pl-1">
                                                <span className="font-medium">Adic:</span> {item.additional_locations}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider mb-1">Cant. Física</span>
                                        <input
                                            id={`qty-mobile-${index}`}
                                            type="number"
                                            className={`w-24 text-center p-2 border rounded-lg text-lg font-medium shadow-sm ${item.saved ? 'border-emerald-400 bg-emerald-50 font-bold text-emerald-900' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                                            value={item.physical_qty}
                                            onChange={(e) => handleCountChange(index, e.target.value)}
                                            onBlur={() => calculateDifference(index)}
                                            placeholder="0"
                                            inputMode="numeric"
                                        />
                                    </div>
                                </div>
                                {item.saved && (
                                    <div className="mt-2 text-right">
                                        <span className="text-xs font-medium text-emerald-700 flex items-center justify-end gap-1">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                            Conteos guardados previamente en BD
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Bulk Save Footer */}
                    <div className="bg-gray-50 px-4 py-3 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-gray-200">
                        <div className="text-sm text-gray-700 flex flex-wrap items-center gap-3">
                            <span>
                                Guardados en BD: <span className="font-semibold text-emerald-700">{items.filter(i => i.saved).length}</span>
                            </span>
                            <span className="text-gray-300">|</span>
                            <span>
                                Nuevos a guardar: <span className="font-semibold text-indigo-600">{items.filter(i => i.status === 'counted' && !i.saved).length}</span>
                            </span>
                            <span className="text-gray-300">|</span>
                            <span>
                                Total plan: <span className="font-semibold text-gray-900">{items.length}</span>
                            </span>
                        </div>
                        <button
                            onClick={handleBulkSave}
                            disabled={submitting || items.filter(i => i.status === 'counted' && !i.saved).length === 0}
                            className={`w-full sm:w-auto px-6 py-2.5 rounded-md text-sm font-medium text-white shadow-sm transition-colors ${submitting || items.filter(i => i.status === 'counted' && !i.saved).length === 0
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500'
                                }`}
                        >
                            {submitting ? 'Guardando...' : 'Guardar y Finalizar'}
                        </button>
                    </div>
                </div>
            )}

            {/* Scanner Modal */}
            {
                scannerOpen && (
                    <ScannerModal
                        onScan={handleScan}
                        onClose={() => setScannerOpen(false)}
                    />
                )
            }
        </div >
    );
};

export default PlannerExecution;
