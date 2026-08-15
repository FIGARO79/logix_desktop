import React, { useState, useEffect, useMemo } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import ScannerModal from '../components/ScannerModal';
import DimensionScanner from '../components/DimensionScanner';
import { useOffline } from '../hooks/useOffline';
import { getDB, savePendingSync } from '../utils/offlineDb';
import { downloadPickingTracking, downloadPickingOrder } from '../utils/syncManager';

// Sound effects using Web Audio API
const createBeep = (frequency, duration) => {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = frequency > 600 ? 'sine' : 'square';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
        console.error("Audio error", e);
    }
};

const playSuccess = () => createBeep(800, 0.1);
const playError = () => createBeep(200, 0.2);

const formatDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const dateOnly = dateStr.split(' ')[0] || dateStr.split('T')[0];
    const parts = dateOnly.split('-');
    if (parts.length === 3) {
        const year = parts[0];
        const monthStr = parts[1]; // Mantener el mes con dos dígitos, ej. "06"
        const day = parseInt(parts[2], 10); // Día sin cero a la izquierda, ej. 7 en vez de 07
        return `${day}/${monthStr}/${year}`;
    }
    return dateStr;
};

const PickingAudit = () => {
    const { setTitle } = useOutletContext();
    const { isOnline } = useOffline();

    // -- State --
    // Load Section
    const [orderNumber, setOrderNumber] = useState('');
    const [despatchNumber, setDespatchNumber] = useState('');
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [trackingData, setTrackingData] = useState([]);
    const [sortOrder, setSortOrder] = useState('desc');
    const [selectedCustomerFilter, setSelectedCustomerFilter] = useState(null);

    // Audit Section
    const [auditActive, setAuditActive] = useState(false);
    const [customerCode, setCustomerCode] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [orderItems, setOrderItems] = useState([]);

    // Scanning
    const [itemCodeInput, setItemCodeInput] = useState('');
    const [scannerOpen, setScannerOpen] = useState(false);

    // Quantity Modal
    const [showQtyModal, setShowQtyModal] = useState(false);
    const [scannedItem, setScannedItem] = useState(null);
    const [tempQty, setTempQty] = useState(1);


    // Modals & Finalize
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [packagesCount, setPackagesCount] = useState('1');
    const [activePackage, setActivePackage] = useState(1);
    const [packageAssignments, setPackageAssignments] = useState({}); // { item_code: { pkg_index: qty } }
    const [dimensionScannerOpen, setDimensionScannerOpen] = useState(false);
    const [packageDimensions, setPackageDimensions] = useState({}); // { 1: {length, width, height, weight} }

    useEffect(() => {
        setTitle("Picking");
        loadTrackingData();
    }, [setTitle]);

    // -- Matrix Data Calculation --
    const matrixData = useMemo(() => {
        if (!trackingData || trackingData.length === 0) {
            return { dates: [], rows: [], totals: {}, grandTotal: { orders: 0, lines: 0 } };
        }

        // 1. Extraer fechas únicas en formato YYYY-MM-DD y ordenarlas cronológicamente
        const datesSet = new Set();
        trackingData.forEach(t => {
            if (!t.print_date) return;
            const datePart = t.print_date.split(' ')[0] || t.print_date.split('T')[0];
            if (datePart) {
                datesSet.add(datePart);
            }
        });
        const sortedDates = Array.from(datesSet).sort();

        // 2. Agrupar datos por cliente (usando customer_code para evitar colisiones)
        const rowsMap = {};
        trackingData.forEach(t => {
            if (!t.print_date) return;
            const datePart = t.print_date.split(' ')[0] || t.print_date.split('T')[0];
            if (!datePart) return;

            const custCode = t.customer_code || 'N/A';
            const custName = t.customer_name || 'Desconocido';
            const custKey = custCode;

            if (!rowsMap[custKey]) {
                rowsMap[custKey] = {
                    customerCode: custCode,
                    customerName: custName,
                    dates: {}
                };
            }

            if (!rowsMap[custKey].dates[datePart]) {
                rowsMap[custKey].dates[datePart] = { orders: 0, lines: 0 };
            }

            rowsMap[custKey].dates[datePart].orders += 1;
            rowsMap[custKey].dates[datePart].lines += (parseInt(t.total_lines) || 0);
        });

        // Convertir el mapa a un array y calcular totales por cliente (filas)
        const rows = Object.values(rowsMap).map(row => {
            let rowTotalOrders = 0;
            let rowTotalLines = 0;
            Object.values(row.dates).forEach(d => {
                rowTotalOrders += d.orders;
                rowTotalLines += d.lines;
            });
            return {
                ...row,
                totalOrders: rowTotalOrders,
                totalLines: rowTotalLines
            };
        });

        // 3. Calcular totales acumulados por fecha (verticales)
        const totals = {};
        sortedDates.forEach(d => {
            totals[d] = { orders: 0, lines: 0 };
        });

        rows.forEach(row => {
            sortedDates.forEach(d => {
                const cellData = row.dates[d] || { orders: 0, lines: 0 };
                totals[d].orders += cellData.orders;
                totals[d].lines += cellData.lines;
            });
        });

        // 4. Calcular gran total acumulado (horizontal + vertical)
        let grandTotalOrders = 0;
        let grandTotalLines = 0;
        rows.forEach(row => {
            grandTotalOrders += row.totalOrders;
            grandTotalLines += row.totalLines;
        });

        return {
            dates: sortedDates,
            rows,
            totals,
            grandTotal: {
                orders: grandTotalOrders,
                lines: grandTotalLines
            }
        };
    }, [trackingData]);

    const toggleCustomerFilter = (customerCode) => {
        setSelectedCustomerFilter(prev => prev === customerCode ? null : customerCode);
    };

    const filteredTracking = useMemo(() => {
        if (!selectedCustomerFilter) return trackingData;
        return trackingData.filter(t => t.customer_code === selectedCustomerFilter);
    }, [trackingData, selectedCustomerFilter]);


    // -- API Calls --

    const [loadingTracking, setLoadingTracking] = useState(false);

    const loadTrackingData = async () => {
        setLoadingTracking(true);
        try {
            const data = await downloadPickingTracking();
            if (data) {
                setTrackingData(data);
            } else {
                // Si falla (offline y no hay caché), intentar leer lo que haya en el store
                const db = await getDB();
                const cached = await db.getAll('picking_tracking');
                setTrackingData(cached || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingTracking(false);
        }
    };

    const handleLoadOrder = async () => {
        if (!orderNumber || !despatchNumber) return;
        setLoadingOrder(true);
        try {
            let data = await downloadPickingOrder(orderNumber, despatchNumber);

            if (!data) {
                // Buscar en caché local
                const db = await getDB();
                const cached = await db.get('picking_orders', `${orderNumber}_${despatchNumber}`);
                if (cached) {
                    data = cached.data;
                    console.log("Cargado pedido de caché local");
                }
            }

            if (data && data.length > 0) {
                setCustomerCode(data[0]['Customer Code'] || '');
                setCustomerName(data[0]['Customer Name']);
                const items = data.map(row => ({
                    code: row['Item Code'],
                    description: row['Item Description'],
                    order_line: row['Order Line'],
                    qty_req: parseInt(row['Qty'] || 0),
                    qty_scan: 0,
                    difference: 0
                }));
                setOrderItems(items);

                const initialAssignments = {};
                items.forEach(item => {
                    const itemKey = `${item.code}:${item.order_line || ''}`;
                    initialAssignments[itemKey] = { 1: 0 };
                });
                setPackageAssignments(initialAssignments);
                setPackagesCount('1');
                setActivePackage(1);

                setAuditActive(true);
            } else {
                alert("No se pudo cargar el pedido. Verifique la conexión o si fue cacheado previamente.");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingOrder(false);
        }
    };

    const handleReset = () => {
        setAuditActive(false);
        setOrderItems([]);
        setOrderNumber('');
        setDespatchNumber('');
        setCustomerCode('');
        setCustomerName('');
        setShowAssignmentModal(false);
        setPackageAssignments({});
        setPackageDimensions({});
        setPackagesCount('1');
        setActivePackage(1);
        setSelectedCustomerFilter(null);
        loadTrackingData();
    };

    const handleAssignmentChange = (itemKey, pkgNum, value) => {
        const val = parseInt(value) || 0;
        setPackageAssignments(prev => {
            const next = {
                ...prev,
                [itemKey]: {
                    ...prev[itemKey],
                    [pkgNum]: val
                }
            };

            // Sincronizar qty_scan en orderItems
            const [code, line] = itemKey.split(':');
            const newItems = [...orderItems];
            const itemIdx = newItems.findIndex(i => i.code === code && (i.order_line || '') === line);

            if (itemIdx > -1) {
                const totalAssigned = Object.values(next[itemKey]).reduce((a, b) => a + (parseInt(b) || 0), 0);
                newItems[itemIdx].qty_scan = totalAssigned;
                newItems[itemIdx].difference = totalAssigned - newItems[itemIdx].qty_req;
                setOrderItems(newItems);
            }

            return next;
        });
    };

    // -- Audit Logic --

    const handleScan = (code) => {
        const cleanCode = code.trim().toUpperCase();
        if (!cleanCode) return;

        // Find item in list
        // Prioridad: Buscar primero una línea que NO esté completa
        let itemIndex = orderItems.findIndex(i => i.code === cleanCode && i.qty_scan < i.qty_req);

        // Si todas están completas (o no encontró), buscar la primera coincidencia general para sumar el exceso
        if (itemIndex === -1) {
            itemIndex = orderItems.findIndex(i => i.code === cleanCode);
        }

        if (itemIndex > -1) {
            const item = orderItems[itemIndex];
            setScannedItem({ ...item, index: itemIndex });
            setTempQty(1); // Default to 1
            setShowQtyModal(true);
            setItemCodeInput('');
            playSuccess();
        } else {
            playError();
            setItemCodeInput('');
        }
    };

    const confirmQuantity = () => {
        if (!scannedItem) return;

        let qtyToAdd = parseInt(tempQty) || 0;
        if (qtyToAdd <= 0) {
            setShowQtyModal(false);
            return;
        }

        const newItems = [...orderItems];
        const packageUpdates = {};

        for (let i = 0; i < newItems.length && qtyToAdd > 0; i++) {
            if (newItems[i].code === scannedItem.code && newItems[i].qty_scan < newItems[i].qty_req) {
                const needed = newItems[i].qty_req - newItems[i].qty_scan;
                const toAdd = Math.min(needed, qtyToAdd);

                newItems[i].qty_scan += toAdd;
                newItems[i].difference = newItems[i].qty_scan - newItems[i].qty_req;
                qtyToAdd -= toAdd;

                const itemKey = `${newItems[i].code}:${newItems[i].order_line || ''}`;
                packageUpdates[itemKey] = (packageUpdates[itemKey] || 0) + toAdd;
            }
        }

        if (qtyToAdd > 0) {
            const targetIndex = scannedItem.index;
            newItems[targetIndex].qty_scan += qtyToAdd;
            newItems[targetIndex].difference = newItems[targetIndex].qty_scan - newItems[targetIndex].qty_req;

            const itemKey = `${newItems[targetIndex].code}:${newItems[targetIndex].order_line || ''}`;
            packageUpdates[itemKey] = (packageUpdates[itemKey] || 0) + qtyToAdd;
        }

        setOrderItems(newItems);

        setPackageAssignments(prev => {
            const next = { ...prev };
            Object.entries(packageUpdates).forEach(([itemKey, qtyAdded]) => {
                const currentItemAssignments = next[itemKey] || {};
                const currentPkgQty = currentItemAssignments[activePackage] || 0;
                next[itemKey] = {
                    ...currentItemAssignments,
                    [activePackage]: currentPkgQty + qtyAdded
                };
            });
            return next;
        });

        setShowQtyModal(false);
        setScannedItem(null);

        const hasOver = newItems.some(i => i.qty_scan > i.qty_req);
        if (hasOver) {
            playError();
        }
    };

    const handleFinalize = () => {
        const hasDifferences = orderItems.some(i => i.qty_scan !== i.qty_req);
        if (hasDifferences) {
            setShowConfirmModal(true);
        } else {
            setShowAssignmentModal(true);
        }
    };

    const submitAudit = async (statusOverride) => {
        const hasDifferences = orderItems.some(i => i.qty_scan !== i.qty_req);
        const payload = {
            order_number: orderNumber,
            despatch_number: despatchNumber,
            customer_code: customerCode,
            customer_name: customerName,
            status: statusOverride || (hasDifferences ? 'Con Diferencia' : 'Completo'),
            items: orderItems.map(i => ({
                code: i.code,
                description: i.description,
                order_line: i.order_line,
                qty_req: i.qty_req,
                qty_scan: i.qty_scan
            })),
            packages: parseInt(packagesCount || 0),
            packages_assignment: packageAssignments,
            packages_dimensions: Object.entries(packageDimensions).map(([num, dims]) => ({
                package_number: parseInt(num),
                ...dims
            }))
        };

        try {
            if (isOnline) {
                const res = await fetch('/api/save_picking_audit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    handleReset();
                    setShowConfirmModal(false);
                    setShowAssignmentModal(false);
                    setPackagesCount('1');
                    return;
                }
            }

            // Guardar offline si falla o no hay conexión
            await savePendingSync('picking', payload);
            alert("Guardado localmente (Offline). Se sincronizará al recuperar conexión.");
            handleReset();
            setShowConfirmModal(false);
            setShowAssignmentModal(false);
            setPackagesCount('1');

        } catch (e) {
            console.error(e);
            // Reintento offline forzado
            await savePendingSync('picking', payload);
            handleReset();
            setShowConfirmModal(false);
            setShowAssignmentModal(false);
        }
    };

    // -- Render --
    if (auditActive) {
        return (
            <div className="container-wrapper max-w-5xl mx-auto px-4 py-4">

                <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                    <div className="flex justify-between items-start mb-6 border-b pb-4">
                        <div>
                            <h1 className="text-2xl font-medium  text-gray-800">Auditoría en Curso</h1>
                            <p className="text-gray-600">Orden: <span className="font-mono font-medium  text-black">{orderNumber} / {despatchNumber}</span></p>
                            <p className="text-gray-600">Cliente: <span className="font-medium  text-black">{customerCode} - {customerName}</span></p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <button onClick={handleReset} className="btn-sap btn-secondary text-xs">Cancelar / Salir</button>
                            {!isOnline && <span className="text-[9px] font-medium  text-red-500 animate-pulse">MODO OFFLINE</span>}
                        </div>
                    </div>

                    {/* Active Package Selector Compact */}
                    <div className="mb-4 p-2 px-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center gap-3">
                        <span className="text-[10px] uppercase font-medium  text-slate-500 whitespace-nowrap">Bulto Activo:</span>
                        <div className="flex gap-1.5 flex-wrap">
                            {Array.from({ length: parseInt(packagesCount) || 1 }).map((_, i) => (
                                <div key={i + 1} className="relative">
                                    <button
                                        onClick={() => setActivePackage(i + 1)}
                                        className={`w-8 h-8 rounded-full font-medium  text-xs transition-all ${activePackage === i + 1
                                            ? 'bg-[#285f94] text-white shadow-sm'
                                            : 'bg-white text-slate-600 border border-slate-300 hover:border-[#285f94]'}`}
                                    >
                                        {i + 1}
                                    </button>
                                    {activePackage === i + 1 && (
                                        <button
                                            onClick={() => setDimensionScannerOpen(true)}
                                            className="absolute -top-1.5 -right-1.5 bg-white border border-[#285f94] rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-sm hover:bg-slate-50"
                                            title="Medir Dimensiones"
                                        >
                                            📏
                                        </button>
                                    )}
                                    {packageDimensions[i + 1] && (
                                        <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full border border-white"></div>
                                    )}
                                </div>
                            ))}

                            <div className="flex gap-1">
                                {(parseInt(packagesCount) || 1) > 1 && (
                                    <button
                                        onClick={() => {
                                            const currentTotal = parseInt(packagesCount);
                                            // Verificar si el último bulto tiene algo asignado
                                            let hasAssignments = false;
                                            Object.values(packageAssignments).forEach(itemPkgs => {
                                                if (itemPkgs[currentTotal] > 0) hasAssignments = true;
                                            });

                                            if (hasAssignments) return;

                                            const newCount = currentTotal - 1;
                                            setPackagesCount(newCount.toString());
                                            if (activePackage > newCount) setActivePackage(newCount);
                                        }}
                                        className="w-8 h-8 rounded-full border border-red-200 bg-red-50 text-red-500 font-medium  text-xs hover:bg-red-500 hover:text-white flex items-center justify-center transition-all"
                                        title="Eliminar Último Bulto"
                                    >
                                        −
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        const newCount = (parseInt(packagesCount) || 1) + 1;
                                        setPackagesCount(newCount.toString());
                                        setActivePackage(newCount);
                                        setPackageAssignments(prev => {
                                            const updated = { ...prev };
                                            Object.keys(updated).forEach(key => {
                                                updated[key] = { ...updated[key], [newCount]: 0 };
                                            });
                                            return updated;
                                        });
                                    }}
                                    className="w-8 h-8 rounded-full border border-[#285f94] bg-white text-[#285f94] font-medium  text-xs hover:bg-[#285f94] hover:text-white flex items-center justify-center transition-all"
                                    title="Añadir Bulto"
                                >
                                    +
                                </button>
                            </div>
                        </div>
                        <div className="hidden sm:block flex-grow text-[11px] text-slate-500 italic">
                            Asignando al <strong>Bulto {activePackage}</strong>.
                        </div>
                    </div>

                    {/* Scan Input */}
                    <div className="mb-6 flex gap-2">
                        <div className="flex-grow">
                            <label className="form-label">Item Code (Scan)</label>
                            <input
                                type="text"
                                value={itemCodeInput}
                                onChange={e => setItemCodeInput(e.target.value.toUpperCase())}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleScan(itemCodeInput);
                                    }
                                }}
                                className="w-full uppercase"
                                placeholder="Escanear o escribir..."
                                autoFocus
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <button
                                onClick={() => setScannerOpen(true)}
                                className="btn-sap btn-secondary h-[38px] px-3"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 .5A.5.5 0 0 1 .5 0h3a.5.5 0 0 1 0 1H1v2.5a.5.5 0 0 1-1 0zm12 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V1h-2.5a.5.5 0 0 1-.5-.5M.5 12a.5.5 0 0 1 .5.5V15h2.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H15v-2.5a.5.5 0 0 1 .5-.5M4 4h1v1H4z" /><path d="M7 2H2v5h5zM3 3h3v3H3zm2 8H4v1h1z" /><path d="M7 9H2v5h5zm-4 1h3v3H3zm8-6h1v1h-1z" /><path d="M9 2h5v5H9zm1 1v3h3V3zM8 8v2h1v1H8v1h2v-2h1v2h1v-1h2v-1h-3V8zm2 2H9V9h1zm4 2h-1v1h-2v1h3zm-4 2v-1H8v1z" /><path d="M12 9h2V8h-2z" /></svg>
                            </button>
                            <button onClick={() => handleScan(itemCodeInput)} className="btn-sap btn-secondary h-[38px]">Buscar</button>
                        </div>
                    </div>

                    {/* Table */}
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto border border-gray-300 rounded mb-6">
                        <table className="w-full text-left sap-table">
                            <thead>
                                <tr>
                                    <th className="text-center w-12">Línea</th>
                                    <th>Item</th>
                                    <th>Descripción</th>
                                    <th className="text-center w-16">Req</th>
                                    <th className="text-center w-16">Scan</th>
                                    <th className="text-center w-16">Dif</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orderItems.map((item, idx) => {
                                    const diff = item.qty_scan - item.qty_req;
                                    const isComplete = item.qty_scan === item.qty_req;
                                    const isOver = item.qty_scan > item.qty_req;

                                    return (
                                        <tr key={idx} className={isComplete ? 'bg-green-50' : isOver ? 'bg-red-50' : ''}>
                                            <td className="text-center font-mono text-xs">{item.order_line}</td>
                                            <td className="font-medium">
                                                {item.code}
                                                <div className="text-[10px] text-slate-500 flex gap-1 flex-wrap mt-1">
                                                    {Object.entries(packageAssignments[`${item.code}:${item.order_line || ''}`] || {})
                                                        .filter(([_, qty]) => qty > 0)
                                                        .map(([pkg, qty]) => (
                                                            <span key={pkg} className="bg-slate-100 px-1 rounded border">B{pkg}: {qty}</span>
                                                        ))
                                                    }
                                                </div>
                                            </td>
                                            <td className="text-sm truncate max-w-[200px]">{item.description}</td>
                                            <td className="text-center">{item.qty_req}</td>
                                            <td className="text-center font-medium ">{item.qty_scan}</td>
                                            <td className={`text-center font-medium  ${diff !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                {diff > 0 ? `+${diff}` : diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="block sm:hidden space-y-3 mb-6">
                        {orderItems.map((item, idx) => {
                            const diff = item.qty_scan - item.qty_req;
                            const isComplete = item.qty_scan === item.qty_req;
                            const isOver = item.qty_scan > item.qty_req;

                            return (
                                <div key={idx} className={`p-4 rounded-lg shadow-sm border ${isComplete ? 'bg-green-50 border-green-200' : isOver ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                                    {/* Header */}
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex flex-col">
                                            <span className="font-medium  text-lg text-gray-800">{item.code}</span>
                                            <span className="text-[10px] font-mono text-gray-500">LÍNEA {item.order_line}</span>
                                        </div>
                                        <span className={`px-2 py-0.5 text-xs font-medium  rounded ${diff === 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {diff > 0 ? `+${diff}` : diff !== 0 ? diff : 'OK'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mb-2 truncate">{item.description}</p>

                                    {/* Package Breakdown Mobile */}
                                    <div className="flex flex-wrap gap-1 mb-3">
                                        {Object.entries(packageAssignments[`${item.code}:${item.order_line || ''}`] || {})
                                            .filter(([_, qty]) => qty > 0)
                                            .map(([pkg, qty]) => (
                                                <span key={pkg} className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 shadow-sm">
                                                    B{pkg}: <span className="font-medium  text-slate-800">{qty}</span>
                                                </span>
                                            ))
                                        }
                                    </div>

                                    {/* Grid */}
                                    <div className="grid grid-cols-2 gap-4 text-sm bg-white/50 p-2 rounded">
                                        <div className="flex flex-col border-r border-gray-200">
                                            <span className="text-gray-500 text-[10px] uppercase tracking-wider">Requerido</span>
                                            <span className="font-mono font-medium text-lg">{item.qty_req}</span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-gray-500 text-[10px] uppercase tracking-wider">Escaneado</span>
                                            <span className={`font-medium  text-xl ${diff !== 0 ? 'text-[#285f94]' : 'text-green-600'}`}>{item.qty_scan}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button onClick={handleFinalize} className="btn-sap btn-primary w-full py-3 text-lg">
                        Finalizar Auditoría
                    </button>
                </div>

                {/* Modals */}
                {/* Scanner Modal */}
                {scannerOpen && (
                    <ScannerModal
                        title="Escanear Código"
                        onScan={(code) => {
                            setScannerOpen(false);
                            handleScan(code);
                        }}
                        onClose={() => setScannerOpen(false)}
                    />
                )}

                {/* Quantity Modal */}
                {showQtyModal && scannedItem && (
                    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                        <div className="bg-white p-6 rounded-lg shadow-2xl max-w-sm w-full border-t-4 border-[#285f94]">
                            <h3 className="text-xl font-medium  text-gray-800 mb-1">{scannedItem.code}</h3>
                            <p className="text-sm text-gray-500 mb-4 truncate">{scannedItem.description}</p>

                            <div className="bg-blue-50 p-3 rounded mb-4 flex justify-between text-sm">
                                <div>
                                    <span className="block text-gray-500 text-[10px] uppercase">Línea</span>
                                    <span className="font-medium  text-lg">{scannedItem.order_line}</span>
                                </div>
                                <div className="text-right">
                                    <span className="block text-gray-500 text-[10px] uppercase">Auditado</span>
                                    <span className="font-medium  text-lg text-[#285f94]">{scannedItem.qty_scan}</span>
                                </div>
                            </div>

                            <label className="form-label text-center block mb-2 font-medium ">CANTIDAD A SUMAR</label>
                            <input
                                type="number"
                                value={tempQty}
                                onChange={e => setTempQty(e.target.value)}
                                className="text-center text-3xl font-medium  w-full p-4 border-2 border-[#285f94] rounded mb-6"
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') confirmQuantity();
                                    if (e.key === 'Escape') setShowQtyModal(false);
                                }}
                            />

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setShowQtyModal(false)}
                                    className="px-4 py-3 border border-gray-300 rounded text-gray-600 font-medium  hover:bg-gray-100"
                                >
                                    CANCELAR
                                </button>
                                <button
                                    onClick={confirmQuantity}
                                    className="px-4 py-3 bg-[#285f94] text-white rounded font-medium  hover:bg-[#1e4a74] shadow-md"
                                >
                                    CONFIRMAR
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirmation Modal */}
                {showConfirmModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full">
                            <h3 className="text-lg font-medium  text-yellow-600 mb-2">Diferencias Detectadas</h3>
                            <p className="mb-4 text-gray-700">Hay ítems con diferencias. ¿Desea finalizar con errores?</p>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setShowConfirmModal(false)} className="btn-sap btn-secondary">Cancelar</button>
                                <button onClick={() => { setShowConfirmModal(false); setShowAssignmentModal(true); }} className="btn-sap btn-primary bg-yellow-500 border-yellow-600">Sí, Continuar</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Assignment Modal */}
                {showAssignmentModal && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                        <div className="bg-white p-6 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                            <h3 className="text-lg font-medium  mb-4">Distribuir Ítems en Bultos</h3>

                            {/* Desktop View */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-100">
                                            <th className="p-2 text-left border w-16">Línea</th>
                                            <th className="p-2 text-left border">Item</th>
                                            <th className="p-2 text-center border w-24">Total Scan</th>
                                            {Array.from({ length: parseInt(packagesCount) || 1 }).map((_, i) => (
                                                <th key={i} className="p-2 text-center border w-20">Bulto {i + 1}</th>
                                            ))}
                                            <th className="p-2 text-center border w-24">Asignado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orderItems.map((item, idx) => {
                                            const itemKey = `${item.code}:${item.order_line || ''}`;
                                            const assignments = packageAssignments[itemKey] || {};
                                            const totalAssigned = Object.values(assignments).reduce((a, b) => a + b, 0);
                                            const isMatch = totalAssigned === item.qty_scan;

                                            // Only show items that have been scanned
                                            if (item.qty_scan === 0) return null;

                                            return (
                                                <tr key={idx} className="border-b hover:bg-gray-50">
                                                    <td className="p-2 border text-center font-mono text-xs">{item.order_line}</td>
                                                    <td className="p-2 border font-medium">
                                                        {item.code}
                                                        <div className="text-xs text-gray-500 truncate max-w-xs">{item.description}</div>
                                                    </td>
                                                    <td className="p-2 text-center border font-medium ">{item.qty_scan}</td>
                                                    {Array.from({ length: parseInt(packagesCount) || 1 }).map((_, i) => (
                                                        <td key={i} className="p-1 border text-center">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                className="w-16 text-center border rounded p-1"
                                                                value={assignments[i + 1] || 0}
                                                                onChange={(e) => handleAssignmentChange(itemKey, i + 1, e.target.value)}
                                                                onFocus={(e) => e.target.select()}
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className={`p-2 text-center border font-medium  ${isMatch ? 'text-green-600' : 'text-red-600'}`}>
                                                        {totalAssigned}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile View */}
                            <div className="block sm:hidden space-y-4">
                                {orderItems.map((item, idx) => {
                                    if (item.qty_scan === 0) return null;

                                    const itemKey = `${item.code}:${item.order_line || ''}`;
                                    const assignments = packageAssignments[itemKey] || {};
                                    const totalAssigned = Object.values(assignments).reduce((a, b) => a + b, 0);
                                    const isMatch = totalAssigned === item.qty_scan;
                                    const pkgCount = parseInt(packagesCount) || 1;

                                    return (
                                        <div key={idx} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <div className="font-medium  text-gray-800">{item.code}</div>
                                                    <div className="text-xs text-gray-500 truncate">{item.description}</div>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[10px] font-mono text-gray-400">LÍNEA {item.order_line}</span>
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center mb-3 text-sm">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase text-gray-500">Escaneado</span>
                                                    <span className="font-medium  text-lg">{item.qty_scan}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] uppercase text-gray-500">Asignado</span>
                                                    <span className={`font-medium  text-lg ${isMatch ? 'text-green-600' : 'text-red-600'}`}>
                                                        {totalAssigned}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                {Array.from({ length: pkgCount }).map((_, i) => (
                                                    <div key={i} className="flex flex-col">
                                                        <label className="text-[10px] uppercase text-gray-500 mb-1">Bulto {i + 1}</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            className="w-full text-center border rounded p-2 text-lg font-medium  bg-white focus:ring-2 focus:ring-[#285f94]"
                                                            value={assignments[i + 1] || 0}
                                                            onChange={(e) => handleAssignmentChange(itemKey, i + 1, e.target.value)}
                                                            onFocus={(e) => e.target.select()}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex justify-end gap-2 mt-6">
                                <button onClick={() => setShowAssignmentModal(false)} className="btn-sap btn-secondary">Atrás</button>
                                <button onClick={() => submitAudit()} className="btn-sap btn-success bg-green-600 border-green-700 text-white">
                                    Guardar y Finalizar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Dimension Scanner Modal */}
                {dimensionScannerOpen && (
                    <DimensionScanner
                        packageNumber={activePackage}
                        onConfirm={(dims) => {
                            setPackageDimensions(prev => ({
                                ...prev,
                                [activePackage]: dims
                            }));
                            setDimensionScannerOpen(false);
                        }}
                        onClose={() => setDimensionScannerOpen(false)}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="container-wrapper max-w-3xl mx-auto px-2 py-2">

            <div className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-[16px] font-normal text-black">Cargar Pedido Picking</h1>
                    {!isOnline && <span className="text-[9px] font-medium  text-red-500 border border-red-200 px-2 py-0.5 rounded">MODO OFFLINE</span>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="form-label">Order Number</label>
                        <input
                            type="text"
                            value={orderNumber}
                            onChange={e => setOrderNumber(e.target.value)}
                            placeholder="Ej: 0043785"
                        />
                    </div>
                    <div>
                        <label className="form-label">Despatch Number</label>
                        <input
                            type="text"
                            value={despatchNumber}
                            onChange={e => setDespatchNumber(e.target.value)}
                            placeholder="Ej: 00"
                        />
                    </div>
                </div>

                <button
                    onClick={handleLoadOrder}
                    disabled={loadingOrder}
                    className="btn-sap btn-primary w-full py-3 mb-8 text-base shadow-sm"
                >
                    {loadingOrder ? 'Cargando...' : 'Comenzar Auditoría'}
                </button>

                {/* Tracking Table */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-medium text-gray-700">Pedidos Recientes</h3>
                        <button
                            onClick={loadTrackingData}
                            disabled={loadingTracking}
                            className={`flex items-center gap-2 text-sm transition-all ${loadingTracking ? 'text-gray-400 cursor-not-allowed' : 'text-[#285f94] hover:underline'}`}
                        >
                            <span>Actualizar</span>
                            {loadingTracking && (
                                <svg className="animate-spin h-3.5 w-3.5 text-[#285f94]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                        </button>
                    </div>
                    {/* Desktop View */}
                    <div className="hidden sm:block border border-gray-200 rounded overflow-hidden max-h-[500px] overflow-y-auto">
                        <table className="w-full text-left text-sm sap-table">
                            <thead className="sticky top-0 z-10 bg-slate-700 text-white shadow-sm">
                                <tr>
                                    <th className="py-2.5 px-3 font-medium ">Order</th>
                                    <th className="py-2.5 px-3 font-medium ">Despatch</th>
                                    <th className="py-2.5 px-3 font-medium ">Cód. Cliente</th>
                                    <th className="py-2.5 px-3 font-medium ">Cliente</th>
                                    <th className="py-2.5 px-3 font-medium  text-center">Líneas</th>
                                    <th
                                        className="py-2.5 px-3 font-medium  cursor-pointer hover:bg-slate-600 select-none flex items-center gap-1"
                                        onClick={() => {
                                            setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                                        }}
                                        title="Ordenar por fecha"
                                    >
                                        Fecha
                                        <span className="text-xs">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTracking.length === 0 ? (
                                    <tr><td colSpan="6" className="text-center p-4 text-gray-500">No hay pedidos recientes</td></tr>
                                ) : (
                                    [...filteredTracking]
                                        .sort((a, b) => {
                                            const dateA = new Date(a.print_date);
                                            const dateB = new Date(b.print_date);
                                            return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
                                        })
                                        .map((t, idx) => (
                                            <tr key={idx}
                                                className={`cursor-pointer ${t.is_audited ? 'bg-slate-100 opacity-75' : 'hover:bg-blue-50'}`}
                                                onClick={() => {
                                                    setOrderNumber(t.order_number);
                                                    setDespatchNumber(t.despatch_number);
                                                }}
                                            >
                                                <td className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        {t.order_number}
                                                        {t.is_audited && <span className="text-[10px] bg-slate-400 text-white px-1 rounded">AUDITADO</span>}
                                                    </div>
                                                </td>
                                                <td>{t.despatch_number}</td>
                                                <td>{t.customer_code}</td>
                                                <td className="truncate max-w-[150px]">{t.customer_name}</td>
                                                <td className="text-center font-medium  text-[#285f94]">{t.total_lines}</td>
                                                <td className="text-gray-500 text-xs">{t.print_date}</td>
                                            </tr>
                                        ))
                                )}
                            </tbody>
                            {filteredTracking.length > 0 && (
                                <tfoot className="sticky bottom-0 bg-slate-50 border-t-2 border-slate-200 z-10 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                                    <tr>
                                        <td colSpan="4" className="py-2.5 px-3 text-right font-medium  text-gray-600 uppercase text-[10px] tracking-wider">Total Líneas Recientes:</td>
                                        <td className="py-2.5 px-3 text-center font-black text-lg text-[#285f94]">
                                            {filteredTracking.reduce((sum, t) => sum + (t.total_lines || 0), 0)}
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="block sm:hidden space-y-2 max-h-[500px] overflow-y-auto relative">
                        {filteredTracking.length === 0 ? (
                            <div className="text-center p-4 text-gray-500 bg-gray-50 rounded">No hay pedidos recientes</div>
                        ) : (
                            <>
                                {filteredTracking.map((t, idx) => (
                                    <div key={idx}
                                        className={`${t.is_audited ? 'bg-slate-100 border-slate-200 opacity-80' : 'bg-blue-50 border-blue-100'} p-3 rounded border cursor-pointer active:bg-blue-100`}
                                        onClick={() => {
                                            setOrderNumber(t.order_number);
                                            setDespatchNumber(t.despatch_number);
                                        }}
                                    >
                                        <div className="flex justify-between items-center mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-medium  ${t.is_audited ? 'text-slate-600' : 'text-[#1e4a74]'} text-lg`}>{t.order_number}</span>
                                                <span className="text-xs font-mono text-gray-500 bg-white px-1.5 rounded border">{t.despatch_number}</span>
                                                {t.is_audited && <span className="text-[10px] bg-slate-400 text-white px-1 rounded uppercase">Auditado</span>}
                                            </div>
                                            <span className={`${t.is_audited ? 'bg-slate-500' : 'bg-[#285f94]'} text-white text-xs font-medium  px-2 py-0.5 rounded-full`}>{t.total_lines} líneas</span>
                                        </div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] font-medium  text-slate-500 uppercase">Cliente:</span>
                                            <span className="text-xs font-medium  text-gray-700">{t.customer_code}</span>
                                        </div>
                                        <div className="text-sm text-gray-800 font-medium mb-2 truncate">{t.customer_name}</div>
                                        <div className="text-right text-xs text-gray-400">
                                            {t.print_date}
                                        </div>
                                    </div>
                                ))}
                                <div className="sticky bottom-0 mt-2 p-3 bg-white border border-blue-200 rounded shadow-lg flex justify-between items-center z-10">
                                    <span className="text-[10px] font-medium  text-slate-500 uppercase">Total Líneas:</span>
                                    <span className="text-[12px] font-black text-[#285f94]">
                                        {filteredTracking.reduce((sum, t) => sum + (t.total_lines || 0), 0)}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Matriz de Resumen por Cliente y Fecha */}
                <div className="mt-8 border-t border-gray-200 pt-6 animate-fade-in">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[16px] font-normal text-black">Resumen por Cliente y Fecha</h3>
                    </div>
                    {matrixData.dates.length === 0 ? (
                        <div className="text-center p-6 text-gray-500 bg-slate-50 rounded border border-gray-200">
                            No hay información disponible para generar la matriz
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-gray-200 rounded shadow-sm max-h-[500px]">
                            <table className="w-full text-left text-sm sap-table border-collapse min-w-[750px]">
                                <thead>
                                    <tr>
                                        <th className="py-2 px-3 font-semibold border-b border-r border-slate-600 text-white" style={{ background: 'linear-gradient(180deg, #4a5f7f 0%, #3d5068 100%)', position: 'sticky', top: 0, zIndex: 12 }}>
                                            Fecha
                                        </th>
                                        {matrixData.dates.map(date => (
                                            <th
                                                key={date}
                                                className="py-2 px-3 font-semibold text-center border-b border-r border-slate-600 text-white"
                                                colSpan={2}
                                                style={{ background: 'linear-gradient(180deg, #4a5f7f 0%, #3d5068 100%)', position: 'sticky', top: 0, zIndex: 12 }}
                                            >
                                                {formatDateLabel(date)}
                                            </th>
                                        ))}
                                        {/* Columna Total General en Cabecera */}
                                        <th
                                            className="py-2 px-3 font-semibold text-center border-b border-r border-slate-600 text-white"
                                            colSpan={2}
                                            style={{ background: 'linear-gradient(180deg, #4a5f7f 0%, #3d5068 100%)', position: 'sticky', top: 0, zIndex: 12 }}
                                        >
                                            Total General
                                        </th>
                                    </tr>
                                    <tr className="bg-slate-600 text-white">
                                        <th className="py-1.5 px-3 font-medium border-b border-r border-slate-500 text-xs uppercase text-white" style={{ background: '#3d5068', position: 'sticky', top: '33px', zIndex: 12 }}>
                                            Customer
                                        </th>
                                        {matrixData.dates.map(date => (
                                            <React.Fragment key={date}>
                                                <th className="py-1.5 px-3 font-medium text-center border-b border-r border-slate-500 text-xs uppercase text-white w-24" style={{ background: '#3d5068', position: 'sticky', top: '33px', zIndex: 12 }}>
                                                    Ordenes
                                                </th>
                                                <th className="py-1.5 px-3 font-medium text-center border-b border-r border-slate-500 text-xs uppercase text-white w-24" style={{ background: '#3d5068', position: 'sticky', top: '33px', zIndex: 12 }}>
                                                    Lineas
                                                </th>
                                            </React.Fragment>
                                        ))}
                                        {/* Subcolumnas de Total en Cabecera */}
                                        <th className="py-1.5 px-3 font-medium text-center border-b border-r border-slate-500 text-xs uppercase text-white w-24" style={{ background: '#3d5068', position: 'sticky', top: '33px', zIndex: 12 }}>
                                            Ordenes
                                        </th>
                                        <th className="py-1.5 px-3 font-medium text-center border-b border-r border-slate-500 text-xs uppercase text-white w-24" style={{ background: '#3d5068', position: 'sticky', top: '33px', zIndex: 12 }}>
                                            Lineas
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrixData.rows.map((row, idx) => (
                                        <tr
                                            key={idx}
                                            className={`border-b border-gray-200 transition-colors ${selectedCustomerFilter === row.customerCode
                                                ? 'bg-blue-50/20'
                                                : 'hover:bg-slate-50'
                                                }`}
                                        >
                                            {/* Columna de Customer mostrando Código + Nombre de Cliente */}
                                            <td
                                                className={`py-1.5 px-3 border-r border-gray-200 cursor-pointer select-none transition-colors ${selectedCustomerFilter === row.customerCode
                                                    ? 'bg-blue-50/60 hover:bg-blue-100/60'
                                                    : 'hover:bg-slate-100'
                                                    }`}
                                                onClick={() => toggleCustomerFilter(row.customerCode)}
                                                title="Haga clic para filtrar pedidos de este cliente"
                                            >
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[10px] text-slate-600 font-mono font-bold bg-slate-100 px-1 py-0.5 rounded border border-slate-200 leading-none">
                                                        {row.customerCode}
                                                    </span>
                                                    <span className="text-sm font-medium text-gray-800 leading-none">
                                                        {row.customerName}
                                                    </span>
                                                    {selectedCustomerFilter === row.customerCode && (
                                                        <span className="text-[8px] bg-[#285f94] text-white px-1 py-0.5 rounded font-bold uppercase leading-none tracking-wide animate-pulse">
                                                            Filtrado
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            {matrixData.dates.map(date => {
                                                const dayData = row.dates[date] || { orders: 0, lines: 0 };
                                                return (
                                                    <React.Fragment key={date}>
                                                        <td className="py-2 px-3 text-right font-mono border-r border-gray-200 text-gray-700">
                                                            {dayData.orders > 0 ? dayData.orders : ''}
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-mono border-r border-gray-200 text-gray-700">
                                                            {dayData.lines > 0 ? dayData.lines : ''}
                                                        </td>
                                                    </React.Fragment>
                                                );
                                            })}
                                            {/* Totales Horizontales del Cliente */}
                                            <td className="py-2 px-3 text-right font-mono border-r border-gray-200 text-gray-950 font-bold bg-slate-50/50">
                                                {row.totalOrders > 0 ? row.totalOrders : ''}
                                            </td>
                                            <td className="py-2 px-3 text-right font-mono border-r border-gray-200 text-gray-950 font-bold bg-slate-50/50">
                                                {row.totalLines > 0 ? row.totalLines : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 border-t-2 border-gray-200 font-semibold sticky bottom-0 z-10 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                                    <tr className="bg-slate-50 border-b border-gray-200">
                                        <td className="py-2.5 px-3 border-r border-gray-200 text-gray-800 font-bold uppercase text-[11px] tracking-wider">
                                            Total
                                        </td>
                                        {matrixData.dates.map(date => {
                                            const totalOrders = matrixData.totals[date].orders;
                                            const totalLines = matrixData.totals[date].lines;
                                            return (
                                                <React.Fragment key={date}>
                                                    <td className="py-2.5 px-3 text-right font-mono border-r border-gray-200 text-base text-[#285f94] font-black">
                                                        {totalOrders > 0 ? totalOrders : 0}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right font-mono border-r border-gray-200 text-base text-[#285f94] font-black">
                                                        {totalLines > 0 ? totalLines : 0}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                        {/* Gran Total Acumulado en el Pie */}
                                        <td className="py-2.5 px-3 text-right font-mono border-r border-gray-200 text-base text-[#1e4a74] font-black bg-blue-50/50">
                                            {matrixData.grandTotal.orders}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono border-r border-gray-200 text-base text-[#1e4a74] font-black bg-blue-50/50">
                                            {matrixData.grandTotal.lines}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PickingAudit;