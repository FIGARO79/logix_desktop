import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import ScannerModal from '../components/ScannerModal';
import PackageDimensionsModal from '../components/PackageDimensionsModal';
import { useOffline } from '../hooks/useOffline';
import { useLanguage } from '../context/LanguageContext';
import { getDB, savePendingSync } from '../utils/offlineDb';
import { downloadPickingTracking, downloadPickingOrder } from '../utils/syncManager';
import { savePickingAudit as tauriSavePickingAudit } from '../utils/tauriApi';

// Efectos de sonido utilizando Web Audio API nativo
const createBeep = (frequency, duration) => {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = frequency > 600 ? 'sine' : 'square';

        gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
        console.error("Audio error", e);
    }
};

const playSuccess = () => createBeep(800, 0.1);
const playError = () => createBeep(220, 0.2);

const formatDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const dateOnly = dateStr.split(' ')[0] || dateStr.split('T')[0];
    const parts = dateOnly.split('-');
    if (parts.length === 3) {
        const year = parts[0];
        const monthStr = parts[1];
        const day = parseInt(parts[2], 10);
        return `${day}/${monthStr}/${year}`;
    }
    return dateStr;
};

const PickingAudit = () => {
    const { setTitle } = useOutletContext();
    const { isOnline } = useOffline();
    const { t, language } = useLanguage();
    const navigate = useNavigate();

    useEffect(() => {
        if (setTitle) setTitle(t('nav.picking', 'Picking'));
    }, [setTitle, t, language]);

    // -- Estados de Carga y Tracking --
    const [orderNumber, setOrderNumber] = useState('');
    const [despatchNumber, setDespatchNumber] = useState('');
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [trackingData, setTrackingData] = useState([]);
    const [sortOrder, setSortOrder] = useState('desc');
    const [selectedCustomerFilter, setSelectedCustomerFilter] = useState(null);

    // -- Estados de Auditoría en Curso --
    const [auditActive, setAuditActive] = useState(false);
    const [customerCode, setCustomerCode] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [orderItems, setOrderItems] = useState([]);

    // -- Estados de Escaneo --
    const [itemCodeInput, setItemCodeInput] = useState('');
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanFeedback, setScanFeedback] = useState({ text: '', type: '' });
    const scanFeedbackTimer = useRef(null);

    // -- Modal de Cantidad --
    const [showQtyModal, setShowQtyModal] = useState(false);
    const [scannedItem, setScannedItem] = useState(null);
    const [tempQty, setTempQty] = useState(1);

    // -- Modales de Finalización y Bultos --
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [packagesCount, setPackagesCount] = useState('1');
    const [activePackage, setActivePackage] = useState(1);
    const [packageAssignments, setPackageAssignments] = useState({}); // { item_key: { pkg_num: qty } }
    const [dimensionModalOpen, setDimensionModalOpen] = useState(false);
    const [packageDimensions, setPackageDimensions] = useState({}); // { 1: {length, width, height, weight} }

    // -- Modal de Éxito Post-Guardado --
    const [successModalData, setSuccessModalData] = useState(null); // { auditId, orderNumber, despatchNumber, status }

    const [loadingTracking, setLoadingTracking] = useState(false);

    useEffect(() => {
        loadTrackingData();
    }, []);

    const setFeedback = (text, type = 'info') => {
        if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
        setScanFeedback({ text, type });
        scanFeedbackTimer.current = setTimeout(() => {
            setScanFeedback({ text: '', type: '' });
        }, 3500);
    };

    // -- Matriz de Tracking por Cliente y Fecha --
    const matrixData = useMemo(() => {
        if (!trackingData || trackingData.length === 0) {
            return { dates: [], rows: [], totals: {}, grandTotal: { orders: 0, lines: 0 } };
        }

        const datesSet = new Set();
        trackingData.forEach(t => {
            if (!t.print_date) return;
            const datePart = t.print_date.split(' ')[0] || t.print_date.split('T')[0];
            if (datePart) datesSet.add(datePart);
        });
        const sortedDates = Array.from(datesSet).sort();

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
            rowsMap[custKey].dates[datePart].lines += (parseInt(t.total_lines, 10) || 0);
        });

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

        rows.sort((a, b) => b.totalLines - a.totalLines);

        const totals = {};
        sortedDates.forEach(d => {
            totals[d] = { orders: 0, lines: 0 };
        });

        let grandTotalOrders = 0;
        let grandTotalLines = 0;

        rows.forEach(r => {
            sortedDates.forEach(d => {
                if (r.dates[d]) {
                    totals[d].orders += r.dates[d].orders;
                    totals[d].lines += r.dates[d].lines;
                }
            });
            grandTotalOrders += r.totalOrders;
            grandTotalLines += r.totalLines;
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

    // -- Carga de Datos --
    const loadTrackingData = async () => {
        setLoadingTracking(true);
        try {
            const data = await downloadPickingTracking();
            if (data && Array.isArray(data)) {
                setTrackingData(data);
            } else {
                const db = await getDB();
                const cached = db ? (await db.getAll('picking_tracking') || []) : [];
                setTrackingData(cached);
            }
        } catch (e) {
            console.error("Error al cargar tracking de picking:", e);
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
                const db = await getDB();
                const cached = db ? await db.get('picking_orders', `${orderNumber}_${despatchNumber}`) : null;
                if (cached && cached.data) {
                    data = cached.data;
                }
            }

            if (data && data.length > 0) {
                setCustomerCode(data[0]['Customer Code'] || data[0].customer_code || '');
                setCustomerName(data[0]['Customer Name'] || data[0].customer_name || 'Cliente General');

                const items = data.map(row => {
                    const unitWeight = parseFloat(row['Item Weight'] || row.item_weight || row.weight || 0) || 0;
                    const reqQty = parseInt(row['Qty'] || row.requested_qty || row.qty_req || 0, 10);
                    return {
                        code: String(row['Item Code'] || row.item_code || row.code || '').trim(),
                        description: String(row['Item Description'] || row.item_description || row.description || '').trim(),
                        order_line: String(row['Order Line'] || row.order_line || '1').trim(),
                        qty_req: reqQty,
                        qty_scan: 0,
                        difference: -reqQty,
                        item_weight: unitWeight
                    };
                });
                setOrderItems(items);

                const initialAssignments = {};
                items.forEach(item => {
                    const itemKey = `${item.code}:${item.order_line || ''}`;
                    initialAssignments[itemKey] = { 1: 0 };
                });
                setPackageAssignments(initialAssignments);
                setPackagesCount('1');
                setActivePackage(1);
                setPackageDimensions({});

                setAuditActive(true);
                playSuccess();
            } else {
                playError();
                alert("No se pudo cargar el pedido. Verifique la orden y secuencia de despacho.");
            }
        } catch (e) {
            console.error("Error cargando pedido de picking:", e);
            playError();
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
        setShowConfirmModal(false);
        setPackageAssignments({});
        setPackageDimensions({});
        setPackagesCount('1');
        setActivePackage(1);
        setSelectedCustomerFilter(null);
        setScanFeedback({ text: '', type: '' });
        loadTrackingData();
    };

    // -- Lógica de Escaneo y Cantidades --
    const handleScan = (code) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        if (!cleanCode) return;

        // Prioridad 1: Buscar línea del SKU que aún no esté completa
        let itemIndex = orderItems.findIndex(i => i.code === cleanCode && i.qty_scan < i.qty_req);

        // Prioridad 2: Buscar cualquier línea con ese SKU para sumar exceso
        if (itemIndex === -1) {
            itemIndex = orderItems.findIndex(i => i.code === cleanCode);
        }

        if (itemIndex > -1) {
            const item = orderItems[itemIndex];
            setScannedItem({ ...item, index: itemIndex });
            setTempQty(1);
            setShowQtyModal(true);
            setItemCodeInput('');
            setFeedback(`Artículo localizado: ${cleanCode}`, 'success');
            playSuccess();
        } else {
            playError();
            setFeedback(`Artículo no encontrado: ${cleanCode}`, 'error');
            setItemCodeInput('');
        }
    };

    const confirmQuantity = () => {
        if (!scannedItem) return;

        let qtyToAdd = parseInt(tempQty, 10) || 0;
        if (qtyToAdd <= 0) {
            setShowQtyModal(false);
            return;
        }

        const newItems = [...orderItems];
        const packageUpdates = {};

        // Distribuir primero en líneas incompletas del mismo SKU
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

        // Si aún sobra cantidad, sumarla como exceso en la línea objetivo
        if (qtyToAdd > 0) {
            const targetIndex = scannedItem.index;
            newItems[targetIndex].qty_scan += qtyToAdd;
            newItems[targetIndex].difference = newItems[targetIndex].qty_scan - newItems[targetIndex].qty_req;

            const itemKey = `${newItems[targetIndex].code}:${newItems[targetIndex].order_line || ''}`;
            packageUpdates[itemKey] = (packageUpdates[itemKey] || 0) + qtyToAdd;
        }

        setOrderItems(newItems);

        // Asignar al bulto activo en este momento
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
            setFeedback("Precaución: Cantidad escaneada superior a la requerida.", 'warning');
        } else {
            playSuccess();
            setFeedback(`Asignado al Bulto ${activePackage}.`, 'success');
        }
    };

    const handleAssignmentChange = (itemKey, pkgNum, value) => {
        const val = parseInt(value, 10) || 0;
        setPackageAssignments(prev => {
            const next = {
                ...prev,
                [itemKey]: {
                    ...prev[itemKey],
                    [pkgNum]: val
                }
            };

            const [code, line] = itemKey.split(':');
            const newItems = [...orderItems];
            const itemIdx = newItems.findIndex(i => i.code === code && (i.order_line || '') === line);

            if (itemIdx > -1) {
                const totalAssigned = Object.values(next[itemKey]).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
                newItems[itemIdx].qty_scan = totalAssigned;
                newItems[itemIdx].difference = totalAssigned - newItems[itemIdx].qty_req;
                setOrderItems(newItems);
            }

            return next;
        });
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
        const emptyCodeItems = orderItems.filter(i => !i.code || i.code.trim() === '');
        if (emptyCodeItems.length > 0) {
            alert(`Error: ${emptyCodeItems.length} ítem(s) no tienen código de artículo.`);
            return;
        }

        const hasDifferences = orderItems.some(i => i.qty_scan !== i.qty_req);
        const auditStatus = statusOverride || (hasDifferences ? 'Con Diferencia' : 'Completo');

        const payload = {
            order_number: orderNumber,
            despatch_number: despatchNumber,
            customer_code: customerCode,
            customer_name: customerName,
            status: auditStatus,
            items: orderItems.map(i => ({
                item_code: i.code,
                code: i.code,
                description: i.description,
                order_line: i.order_line,
                qty_req: i.qty_req,
                qty_scan: i.qty_scan,
                item_weight: i.item_weight || 0.0
            })),
            packages: parseInt(packagesCount, 10) || 1,
            packages_assignment: packageAssignments,
            packages_dimensions: Object.entries(packageDimensions).map(([num, dims]) => ({
                package_number: parseInt(num, 10),
                ...dims
            }))
        };

        try {
            const auditId = await tauriSavePickingAudit(payload);

            setShowConfirmModal(false);
            setShowAssignmentModal(false);
            playSuccess();

            // Abrir modal de éxito post-guardado
            setSuccessModalData({
                auditId: auditId || payload.order_number,
                orderNumber,
                despatchNumber,
                status: auditStatus,
                totalPackages: packagesCount
            });
        } catch (e) {
            console.error("Error al guardar auditoría de picking:", e);
            playError();
            alert(`Ocurrió un error al guardar la auditoría: ${e.message || e}`);
        }
    };

    // Cálculos en vivo para la pantalla activa
    const totalScanQty = useMemo(() => orderItems.reduce((acc, i) => acc + (i.qty_scan || 0), 0), [orderItems]);
    const totalReqQty = useMemo(() => orderItems.reduce((acc, i) => acc + (i.qty_req || 0), 0), [orderItems]);
    const totalScanWeight = useMemo(() => orderItems.reduce((acc, i) => acc + ((i.item_weight || 0) * (i.qty_scan || 0)), 0), [orderItems]);
    const totalReqWeight = useMemo(() => orderItems.reduce((acc, i) => acc + ((i.item_weight || 0) * (i.qty_req || 0)), 0), [orderItems]);

    // -- RENDERIZADO: AUDITORÍA EN CURSO --
    if (auditActive) {
        return (
            <div className="picking-audit-page container-wrapper max-w-5xl mx-auto px-4 py-4 font-['Segoe_UI',Tahoma,sans-serif] font-normal text-[12px] text-[#1f1f1f] bg-[#f3f3f3] min-h-screen">
                <div className="bg-white p-5 rounded border border-[#d1d5db] shadow-xs">
                    {/* Cabecera de la Auditoría */}
                    <div className="flex justify-between items-start mb-4 border-b border-[#e5e5e5] pb-3">
                        <div>
                            <h1 className="text-[16px] font-normal text-[#1f1f1f] m-0">Auditoría de Picking en Curso</h1>
                            <div className="flex flex-wrap gap-4 text-[12px] text-[#5c5c5c] mt-1">
                                <span>Pedido: <strong className="text-[#1f1f1f] font-normal">{orderNumber} / {despatchNumber}</strong></span>
                                <span>Cliente: <strong className="text-[#1f1f1f] font-normal">{customerCode ? `[${customerCode}] ` : ''}{customerName}</strong></span>
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                            <button
                                type="button"
                                onClick={handleReset}
                                className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer"
                            >
                                Salir / Cancelar
                            </button>
                            {!isOnline && <span className="text-[10px] text-[#a80000]">MODO OFFLINE</span>}
                        </div>
                    </div>

                    {/* Resumen de Métricas en Vivo (Cantidades y Pesos) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 p-2.5 bg-[#fafafa] border border-[#e5e5e5] rounded text-[11px]">
                        <div>
                            <span className="block text-[#5c5c5c] uppercase text-[9.5px]">Artículos Escaneados</span>
                            <span className="text-[13px] text-[#1f1f1f]">
                                <strong>{totalScanQty}</strong> / {totalReqQty} uds
                            </span>
                        </div>
                        <div>
                            <span className="block text-[#5c5c5c] uppercase text-[9.5px]">Peso Neto Escaneado</span>
                            <span className="text-[13px] text-[#1f1f1f]">
                                <strong>{totalScanWeight.toFixed(3)}</strong> / {totalReqWeight.toFixed(3)} kg
                            </span>
                        </div>
                        <div>
                            <span className="block text-[#5c5c5c] uppercase text-[9.5px]">Bulto Activo</span>
                            <span className="text-[13px] text-[#0067c0]">
                                Bulto #{activePackage} de {packagesCount}
                            </span>
                        </div>
                        <div className="text-right sm:text-left">
                            <span className="block text-[#5c5c5c] uppercase text-[9.5px]">Estado Actual</span>
                            <span className={`text-[12px] ${totalScanQty === totalReqQty ? 'text-[#107c41]' : 'text-[#a80000]'}`}>
                                {totalScanQty === totalReqQty ? 'Completo' : 'Pendiente / Diferencia'}
                            </span>
                        </div>
                    </div>

                    {/* Selector de Bulto Activo y Medidas */}
                    <div className="mb-4 p-2 px-3 bg-[#fafafa] rounded border border-[#e5e5e5] flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10.5px] uppercase text-[#5c5c5c] whitespace-nowrap">Asignar al Bulto:</span>
                            <div className="flex gap-1.5 flex-wrap">
                                {Array.from({ length: parseInt(packagesCount, 10) || 1 }).map((_, i) => (
                                    <div key={i + 1} className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setActivePackage(i + 1)}
                                            className={`w-7 h-7 rounded text-[12px] font-normal transition-colors cursor-pointer ${activePackage === i + 1
                                                ? 'bg-[#0067c0] text-white'
                                                : 'bg-white text-[#1f1f1f] border border-[#d1d5db] hover:bg-[#f5f5f5]'}`}
                                        >
                                            {i + 1}
                                        </button>
                                        {packageDimensions[i + 1] && (
                                            <div
                                                className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#107c41] rounded-full"
                                                title="Medidas registradas"
                                            />
                                        )}
                                    </div>
                                ))}

                                <div className="flex gap-1">
                                    {(parseInt(packagesCount, 10) || 1) > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const currentTotal = parseInt(packagesCount, 10);
                                                let hasAssignments = false;
                                                Object.values(packageAssignments).forEach(itemPkgs => {
                                                    if (itemPkgs[currentTotal] > 0) hasAssignments = true;
                                                });

                                                if (hasAssignments) {
                                                    alert("No se puede eliminar un bulto que ya tiene artículos asignados. Reasígnelos primero.");
                                                    return;
                                                }

                                                const newCount = currentTotal - 1;
                                                setPackagesCount(newCount.toString());
                                                if (activePackage > newCount) setActivePackage(newCount);
                                            }}
                                            className="w-7 h-7 rounded border border-[#fca5a5] bg-white text-[#a80000] text-[12px] font-normal hover:bg-[#fef2f2] flex items-center justify-center transition-colors cursor-pointer"
                                            title="Eliminar Último Bulto"
                                        >
                                            −
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newCount = (parseInt(packagesCount, 10) || 1) + 1;
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
                                        className="w-7 h-7 rounded border border-[#0067c0] bg-white text-[#0067c0] text-[12px] font-normal hover:bg-[#f0f7ff] flex items-center justify-center transition-colors cursor-pointer"
                                        title="Añadir Bulto"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Botón de Medidas y Peso Bruto del Bulto Activo */}
                        <div className="flex items-center gap-2 text-[11px] text-[#5c5c5c]">
                            <button
                                type="button"
                                onClick={() => setDimensionModalOpen(true)}
                                className="h-6 px-2.5 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[11px] font-normal transition-colors cursor-pointer inline-flex items-center gap-1.5"
                                title="Ingresar o editar medidas del bulto actual"
                            >
                                <svg className="w-3.5 h-3.5 text-[#0067c0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                                <span>
                                    {packageDimensions[activePackage]
                                        ? `${packageDimensions[activePackage].length}×${packageDimensions[activePackage].width}×${packageDimensions[activePackage].height} cm (${packageDimensions[activePackage].weight || 0} kg)`
                                        : 'Medidas / Peso Bruto del Bulto'}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Campo de Escaneo de Códigos */}
                    <div className="mb-4 flex gap-2">
                        <div className="flex-grow">
                            <label className="text-[10px] uppercase text-[#5c5c5c] block mb-0.5">Código de Artículo (Escanear o Escribir)</label>
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
                                className="w-full h-8 px-2.5 text-[12px] border border-[#d1d5db] rounded outline-none uppercase focus:border-[#0067c0] font-normal font-mono"
                                placeholder="Escanear código de barras..."
                                autoFocus
                            />
                        </div>
                        <div className="flex items-end gap-1.5">
                            <button
                                type="button"
                                onClick={() => setScannerOpen(true)}
                                className="h-8 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer"
                            >
                                Escáner
                            </button>
                            <button
                                type="button"
                                onClick={() => handleScan(itemCodeInput)}
                                className="h-8 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal transition-colors cursor-pointer"
                            >
                                Buscar
                            </button>
                        </div>
                    </div>

                    {/* Mensajes de Feedback de Escaneo */}
                    {scanFeedback.text && (
                        <div className={`mb-3 p-2 rounded text-[11.5px] border ${scanFeedback.type === 'error'
                            ? 'bg-[#fef2f2] text-[#a80000] border-[#fca5a5]'
                            : scanFeedback.type === 'warning'
                                ? 'bg-[#fffbeb] text-[#92400e] border-[#fde68a]'
                                : 'bg-[#f0fdf4] text-[#107c41] border-[#bbf7d0]'}`}>
                            {scanFeedback.text}
                        </div>
                    )}

                    {/* Tabla de Artículos del Pedido */}
                    <div className="overflow-x-auto border border-[#e5e5e5] rounded mb-4">
                        <table className="w-full text-left text-[11.5px] border-collapse">
                            <thead className="bg-[#f3f3f3] text-[#1f1f1f] border-b border-[#d2d0ce] text-[11.5px] font-normal">
                                <tr>
                                    <th className="px-2.5 py-1.5 text-center w-12 font-normal">Línea</th>
                                    <th className="px-2.5 py-1.5 font-normal w-32">Código</th>
                                    <th className="px-2.5 py-1.5 font-normal">Descripción</th>
                                    <th className="px-2.5 py-1.5 text-right w-20 font-normal">Req.</th>
                                    <th className="px-2.5 py-1.5 text-right w-20 font-normal">Scan</th>
                                    <th className="px-2.5 py-1.5 text-right w-20 font-normal">Dif.</th>
                                    <th className="px-2.5 py-1.5 text-right w-24 font-normal">Peso Unit.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f1f1f1]">
                                {orderItems.map((item, idx) => {
                                    const diff = item.qty_scan - item.qty_req;
                                    const isComplete = item.qty_scan === item.qty_req;
                                    const isOver = item.qty_scan > item.qty_req;

                                    return (
                                        <tr key={idx} className={isComplete ? 'bg-[#f0fdf4]' : isOver ? 'bg-[#fef2f2]' : 'hover:bg-[#edf3f9]'}>
                                            <td className="text-center text-[#5c5c5c] px-2.5 py-1.5">{item.order_line}</td>
                                            <td className="px-2.5 py-1.5 font-normal font-mono">
                                                <span className="text-[#0067c0]">{item.code}</span>
                                                <div className="text-[10px] text-[#5c5c5c] flex gap-1 flex-wrap mt-0.5">
                                                    {Object.entries(packageAssignments[`${item.code}:${item.order_line || ''}`] || {})
                                                        .filter(([_, qty]) => qty > 0)
                                                        .map(([pkg, qty]) => (
                                                            <span key={pkg} className="bg-white px-1 rounded border border-[#d1d5db]">
                                                                B{pkg}: {qty}
                                                            </span>
                                                        ))}
                                                </div>
                                            </td>
                                            <td className="px-2.5 py-1.5 truncate max-w-[240px] text-[#1f1f1f]">{item.description}</td>
                                            <td className="px-2.5 py-1.5 text-right text-[#1f1f1f] font-mono">{item.qty_req}</td>
                                            <td className="px-2.5 py-1.5 text-right text-[#1f1f1f] font-mono">{item.qty_scan}</td>
                                            <td className={`px-2.5 py-1.5 text-right font-mono ${diff === 0 ? 'text-[#107c41]' : 'text-[#a80000]'}`}>
                                                {diff > 0 ? `+${diff}` : diff}
                                            </td>
                                            <td className="px-2.5 py-1.5 text-right text-[#5c5c5c] font-mono">
                                                {item.item_weight ? `${item.item_weight.toFixed(3)} kg` : '0.000 kg'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <button
                        type="button"
                        onClick={handleFinalize}
                        className="w-full h-8 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs"
                    >
                        Finalizar y Distribuir Bultos
                    </button>
                </div>

                {/* MODALES */}

                {/* Modal de Escáner de Cámara */}
                {scannerOpen && (
                    <ScannerModal
                        title="Escanear Código de Barras"
                        onScan={(code) => {
                            setScannerOpen(false);
                            handleScan(code);
                        }}
                        onClose={() => setScannerOpen(false)}
                    />
                )}

                {/* Modal de Ingreso de Cantidad */}
                {showQtyModal && scannedItem && (
                    <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4">
                        <div className="bg-white p-5 rounded max-w-sm w-full border border-[#d1d5db] shadow-md">
                            <h3 className="text-[14px] font-normal text-[#1f1f1f] mb-1 font-mono">{scannedItem.code}</h3>
                            <p className="text-[12px] text-[#5c5c5c] mb-3 truncate">{scannedItem.description}</p>

                            <div className="bg-[#f0f7ff] p-2.5 rounded border border-[#cce4ff] mb-3 flex justify-between text-[12px]">
                                <div>
                                    <span className="block text-[#0067c0] text-[10px] uppercase">Línea</span>
                                    <span className="text-[13px] text-[#1f1f1f]">{scannedItem.order_line}</span>
                                </div>
                                <div className="text-right">
                                    <span className="block text-[#0067c0] text-[10px] uppercase">Auditado</span>
                                    <span className="text-[13px] text-[#0067c0]">{scannedItem.qty_scan} / {scannedItem.qty_req}</span>
                                </div>
                            </div>

                            <label className="text-center block mb-1 text-[10px] uppercase text-[#5c5c5c]">
                                Cantidad a Sumar al Bulto #{activePackage}
                            </label>
                            <input
                                type="number"
                                min="1"
                                value={tempQty}
                                onChange={e => setTempQty(e.target.value)}
                                className="text-center text-2xl font-normal w-full p-2 border border-[#0067c0] rounded mb-4 outline-none font-mono"
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') confirmQuantity();
                                    if (e.key === 'Escape') setShowQtyModal(false);
                                }}
                            />

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowQtyModal(false)}
                                    className="h-7 border border-[#d1d5db] rounded text-[#1f1f1f] font-normal hover:bg-[#f5f5f5] transition-colors cursor-pointer text-[12px]"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmQuantity}
                                    className="h-7 bg-[#0067c0] text-white rounded font-normal hover:bg-[#005a9e] transition-colors cursor-pointer text-[12px]"
                                >
                                    Confirmar
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal de Advertencia de Diferencias */}
                {showConfirmModal && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                        <div className="bg-white p-5 rounded max-w-sm w-full border border-[#d1d5db] shadow-md">
                            <h3 className="text-[14px] font-normal text-[#92400e] mb-2">Diferencias Detectadas</h3>
                            <p className="mb-4 text-[#5c5c5c] text-[12px]">
                                Existen artículos con cantidades que no coinciden con las requeridas. ¿Desea continuar y finalizar con discrepancias?
                            </p>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmModal(false)}
                                    className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal cursor-pointer"
                                >
                                    Revisar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowConfirmModal(false);
                                        setShowAssignmentModal(true);
                                    }}
                                    className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal cursor-pointer"
                                >
                                    Continuar a Bultos
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal de Distribución en Bultos */}
                {showAssignmentModal && (
                    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
                        <div className="bg-white p-5 rounded max-w-4xl w-full max-h-[90vh] flex flex-col border border-[#d1d5db] shadow-md">
                            <div className="flex-shrink-0 flex justify-between items-center pb-2 border-b border-[#e5e5e5] mb-3">
                                <div>
                                    <h3 className="text-[14px] font-normal text-[#1f1f1f] m-0">Distribución de Artículos en Bultos</h3>
                                    <p className="text-[11px] text-[#5c5c5c] m-0">Verifique las cantidades asignadas a cada bulto antes de generar el Packing List</p>
                                </div>
                                <span className="bg-[#f0f7ff] text-[#0067c0] text-[11px] font-normal px-2.5 py-0.5 rounded border border-[#cce4ff]">
                                    Total Bultos: {packagesCount}
                                </span>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-1">
                                <table className="w-full text-[11.5px] border-collapse">
                                    <thead className="bg-[#f3f3f3] text-[#1f1f1f] border-b border-[#d2d0ce] text-[11.5px] font-normal sticky top-0">
                                        <tr>
                                            <th className="p-1.5 text-center border border-[#d2d0ce] w-12 font-normal">Línea</th>
                                            <th className="p-1.5 text-left border border-[#d2d0ce] font-normal">Código / Descripción</th>
                                            <th className="p-1.5 text-center border border-[#d2d0ce] w-20 font-normal">Total Scan</th>
                                            {Array.from({ length: parseInt(packagesCount, 10) || 1 }).map((_, i) => (
                                                <th key={i} className="p-1.5 text-center border border-[#d2d0ce] w-18 font-normal">
                                                    Bulto {i + 1}
                                                </th>
                                            ))}
                                            <th className="p-1.5 text-center border border-[#d2d0ce] w-20 font-normal">Asignado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#f1f1f1]">
                                        {orderItems.map((item, idx) => {
                                            const itemKey = `${item.code}:${item.order_line || ''}`;
                                            const assignments = packageAssignments[itemKey] || {};
                                            const totalAssigned = Object.values(assignments).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
                                            const isMatch = totalAssigned === item.qty_scan;

                                            return (
                                                <tr key={idx} className="border-b border-[#e5e5e5] hover:bg-[#f9f9f9]">
                                                    <td className="p-1.5 border border-[#e5e5e5] text-center text-[#5c5c5c]">{item.order_line}</td>
                                                    <td className="p-1.5 border border-[#e5e5e5] font-normal">
                                                        <span className="text-[#0067c0] font-mono">{item.code}</span>
                                                        <div className="text-[11px] text-[#5c5c5c] truncate max-w-xs">{item.description}</div>
                                                    </td>
                                                    <td className="p-1.5 text-center border border-[#e5e5e5] text-[#1f1f1f] font-mono">{item.qty_scan}</td>
                                                    {Array.from({ length: parseInt(packagesCount, 10) || 1 }).map((_, i) => (
                                                        <td key={i} className="p-1 border border-[#e5e5e5] text-center">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                className="w-14 text-center border border-[#d1d5db] rounded h-6 text-[12px] outline-none focus:border-[#0067c0] font-mono"
                                                                value={assignments[i + 1] || 0}
                                                                onChange={(e) => handleAssignmentChange(itemKey, i + 1, e.target.value)}
                                                                onFocus={(e) => e.target.select()}
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className={`p-1.5 text-center border border-[#e5e5e5] font-mono ${isMatch ? 'text-[#107c41]' : 'text-[#a80000]'}`}>
                                                        {totalAssigned}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex-shrink-0 flex justify-end gap-2 pt-3 mt-3 border-t border-[#e5e5e5] bg-white">
                                <button
                                    type="button"
                                    onClick={() => setShowAssignmentModal(false)}
                                    className="h-7 px-3 border border-[#d1d5db] rounded text-[#1f1f1f] hover:bg-[#f5f5f5] text-[12px] font-normal cursor-pointer"
                                >
                                    Atrás
                                </button>
                                <button
                                    type="button"
                                    onClick={() => submitAudit()}
                                    className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white font-normal rounded text-[12px] transition-colors cursor-pointer"
                                >
                                    Guardar y Finalizar Auditoría
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal de Medidas y Dimensiones de Bulto */}
                {dimensionModalOpen && (
                    <PackageDimensionsModal
                        isOpen={dimensionModalOpen}
                        packageNumber={activePackage}
                        initialDimensions={packageDimensions[activePackage] || null}
                        onConfirm={(dims) => {
                            setPackageDimensions(prev => ({
                                ...prev,
                                [activePackage]: dims
                            }));
                            setDimensionModalOpen(false);
                            setFeedback(`Medidas del Bulto #${activePackage} guardadas.`, 'success');
                        }}
                        onClear={() => {
                            setPackageDimensions(prev => {
                                const updated = { ...prev };
                                delete updated[activePackage];
                                return updated;
                            });
                            setDimensionModalOpen(false);
                        }}
                        onClose={() => setDimensionModalOpen(false)}
                    />
                )}

                {/* Modal de Éxito Post-Guardado con opción directa a Packing List */}
                {successModalData && (
                    <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center p-4">
                        <div className="bg-white p-6 rounded max-w-md w-full border border-[#d1d5db] shadow-lg text-center">
                            <div className="w-10 h-10 mx-auto mb-3 bg-[#f0fdf4] text-[#107c41] rounded-full flex items-center justify-center border border-[#bbf7d0]">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-[16px] font-normal text-[#1f1f1f] mb-1">
                                Auditoría Guardada con Éxito
                            </h3>
                            <p className="text-[12px] text-[#5c5c5c] mb-4">
                                Pedido #{successModalData.orderNumber} / {successModalData.despatchNumber} guardado correctamente con estado <strong className="text-[#1f1f1f] font-normal">{successModalData.status}</strong> y {successModalData.totalPackages} bulto(s).
                            </p>

                            <div className="flex flex-col sm:flex-row gap-2 justify-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const aid = successModalData.auditId;
                                        setSuccessModalData(null);
                                        handleReset();
                                        navigate(`/packing_list/${aid}`);
                                    }}
                                    className="h-8 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                    </svg>
                                    <span>Imprimir Packing List</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSuccessModalData(null);
                                        handleReset();
                                    }}
                                    className="h-8 px-4 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] text-[12px] font-normal rounded transition-colors cursor-pointer"
                                >
                                    Auditar Otro Pedido
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // -- RENDERIZADO: LISTA DE PEDIDOS Y TRACKING --
    return (
        <div className="picking-audit-page container-wrapper max-w-3xl mx-auto px-2 py-2 font-['Segoe_UI',Tahoma,sans-serif] font-normal text-[12px] text-[#1f1f1f] bg-[#f3f3f3] min-h-screen">
            <div className="bg-white p-4 rounded border border-[#d1d5db] shadow-xs">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-[15px] font-normal text-[#1f1f1f] m-0">Cargar Pedido Picking</h1>
                    {!isOnline && (
                        <span className="text-[10px] text-[#a80000] border border-[#fecaca] px-2 py-0.5 rounded bg-[#fef2f2]">
                            MODO OFFLINE
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div>
                        <label className="text-[10px] uppercase text-[#5c5c5c] block mb-0.5">Order Number</label>
                        <input
                            type="text"
                            value={orderNumber}
                            onChange={e => setOrderNumber(e.target.value)}
                            className="w-full h-7 px-2 text-[12px] border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] font-normal font-mono"
                            placeholder="Ej: 0043785"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase text-[#5c5c5c] block mb-0.5">Despatch Number</label>
                        <input
                            type="text"
                            value={despatchNumber}
                            onChange={e => setDespatchNumber(e.target.value)}
                            className="w-full h-7 px-2 text-[12px] border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] font-normal font-mono"
                            placeholder="Ej: 00"
                        />
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleLoadOrder}
                    disabled={loadingOrder}
                    className="w-full h-8 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs mb-6 disabled:opacity-50"
                >
                    {loadingOrder ? 'Cargando Pedido...' : 'Comenzar Auditoría'}
                </button>

                {/* Tabla de Pedidos Recientes */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-[13px] font-normal text-[#1f1f1f] m-0">Pedidos Recientes</h3>
                        <button
                            type="button"
                            onClick={loadTrackingData}
                            disabled={loadingTracking}
                            className={`flex items-center gap-1.5 text-[11.5px] transition-colors cursor-pointer ${loadingTracking ? 'text-[#a1a1aa] cursor-not-allowed' : 'text-[#0067c0] hover:underline'}`}
                        >
                            <span>Actualizar</span>
                            {loadingTracking && (
                                <svg className="animate-spin h-3 w-3 text-[#0067c0]" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                        </button>
                    </div>

                    <div className="border border-[#e5e5e5] rounded overflow-hidden max-h-[480px] overflow-y-auto">
                        <table className="w-full text-left text-[11.5px] border-collapse">
                            <thead className="sticky top-0 z-10 bg-[#f3f3f3] text-[#1f1f1f] border-b border-[#d2d0ce] text-[11.5px] font-normal">
                                <tr>
                                    <th className="py-2 px-2.5 font-normal">Order</th>
                                    <th className="py-2 px-2.5 font-normal">Despatch</th>
                                    <th className="py-2 px-2.5 font-normal">Cód. Cliente</th>
                                    <th className="py-2 px-2.5 font-normal">Cliente</th>
                                    <th className="py-2 px-2.5 font-normal text-center">Líneas</th>
                                    <th
                                        className="py-2 px-2.5 font-normal cursor-pointer select-none"
                                        onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                                        title="Ordenar por fecha"
                                    >
                                        Fecha {sortOrder === 'asc' ? '▲' : '▼'}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f1f1f1]">
                                {filteredTracking.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-6 text-[#5c5c5c]">
                                            No hay pedidos recientes
                                        </td>
                                    </tr>
                                ) : (
                                    [...filteredTracking]
                                        .sort((a, b) => {
                                            const dateA = new Date(a.print_date);
                                            const dateB = new Date(b.print_date);
                                            return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
                                        })
                                        .map((t, idx) => {
                                            const isAudited = Boolean(t.is_audited) || t.status === 'AUDITADO' || t.status === 'Completo' || t.status === 'Con Diferencia';
                                            return (
                                                <tr
                                                    key={idx}
                                                    className={`cursor-pointer transition-colors ${isAudited ? 'bg-[#f5f5f5] hover:bg-[#eaeaea]' : 'hover:bg-[#edf3f9]'}`}
                                                    onClick={() => {
                                                        setOrderNumber(t.order_number);
                                                        setDespatchNumber(t.despatch_number);
                                                    }}
                                                >
                                                    <td className="py-1.5 px-2.5 font-mono">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={isAudited ? 'text-[#1f1f1f]' : 'text-[#0067c0]'}>{t.order_number}</span>
                                                            {isAudited && (
                                                                <span className="text-[9.5px] bg-[#dff6dd] text-[#107c41] px-1.5 py-0.2 rounded border border-[#a1e59e]">
                                                                    AUDITADO
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-[#1f1f1f] font-mono">{t.despatch_number}</td>
                                                    <td className="py-1.5 px-2.5 text-[#1f1f1f] font-mono">{t.customer_code}</td>
                                                    <td className="py-1.5 px-2.5 truncate max-w-[160px] text-[#1f1f1f]">{t.customer_name}</td>
                                                    <td className="py-1.5 px-2.5 text-center text-[#0067c0] font-mono">{t.total_lines}</td>
                                                    <td className="py-1.5 px-2.5 text-[#5c5c5c] text-[11px]">{t.print_date}</td>
                                                </tr>
                                            );
                                        })
                                )}
                            </tbody>
                            {filteredTracking.length > 0 && (
                                <tfoot className="sticky bottom-0 bg-[#fafafa] border-t border-[#e5e5e5] z-10">
                                    <tr>
                                        <td colSpan="4" className="py-2 px-2.5 text-right text-[#5c5c5c] uppercase text-[10px]">
                                            Total Líneas Recientes:
                                        </td>
                                        <td className="py-2 px-2.5 text-center text-[#0067c0] text-[12px] font-normal font-mono">
                                            {filteredTracking.reduce((sum, t) => sum + (t.total_lines || 0), 0)}
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>

                {/* Matriz de Resumen por Cliente y Fecha */}
                <div className="mt-8 border-t border-[#e5e5e5] pt-6">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[14px] font-normal text-[#1f1f1f] m-0">Resumen por Cliente y Fecha</h3>
                    </div>
                    {matrixData.dates.length === 0 ? (
                        <div className="text-center p-6 text-[#5c5c5c] bg-[#fafafa] rounded border border-[#e5e5e5]">
                            No hay información disponible para generar la matriz
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-[#e5e5e5] rounded shadow-xs max-h-[500px]">
                            <table className="w-full text-left text-[11.5px] border-collapse min-w-[750px]">
                                <thead>
                                    <tr>
                                        <th className="py-2 px-3 font-normal border-b border-r border-[#d2d0ce] text-[#1f1f1f] bg-[#f3f3f3] sticky top-0 z-12">
                                            Fecha
                                        </th>
                                        {matrixData.dates.map(date => (
                                            <th
                                                key={date}
                                                className="py-2 px-3 font-normal text-center border-b border-r border-[#d2d0ce] text-[#1f1f1f] bg-[#f3f3f3] sticky top-0 z-12"
                                                colSpan={2}
                                            >
                                                {formatDateLabel(date)}
                                            </th>
                                        ))}
                                        <th
                                            className="py-2 px-3 font-normal text-center border-b border-r border-[#d2d0ce] text-[#1f1f1f] bg-[#f3f3f3] sticky top-0 z-12"
                                            colSpan={2}
                                        >
                                            Total General
                                        </th>
                                    </tr>
                                    <tr className="bg-[#edebe9] text-[#1f1f1f]">
                                        <th className="py-1.5 px-3 font-normal border-b border-r border-[#d2d0ce] text-[10.5px] uppercase text-[#1f1f1f] bg-[#edebe9] sticky top-[33px] z-12">
                                            Customer
                                        </th>
                                        {matrixData.dates.map(date => (
                                            <React.Fragment key={date}>
                                                <th className="py-1.5 px-3 font-normal text-center border-b border-r border-[#d2d0ce] text-[10.5px] uppercase text-[#1f1f1f] w-24 bg-[#edebe9] sticky top-[33px] z-12">
                                                    Órdenes
                                                </th>
                                                <th className="py-1.5 px-3 font-normal text-center border-b border-r border-[#d2d0ce] text-[10.5px] uppercase text-[#1f1f1f] w-24 bg-[#edebe9] sticky top-[33px] z-12">
                                                    Líneas
                                                </th>
                                            </React.Fragment>
                                        ))}
                                        <th className="py-1.5 px-3 font-normal text-center border-b border-r border-[#d2d0ce] text-[10.5px] uppercase text-[#1f1f1f] w-24 bg-[#edebe9] sticky top-[33px] z-12">
                                            Órdenes
                                        </th>
                                        <th className="py-1.5 px-3 font-normal text-center border-b border-r border-[#d2d0ce] text-[10.5px] uppercase text-[#1f1f1f] w-24 bg-[#edebe9] sticky top-[33px] z-12">
                                            Líneas
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrixData.rows.map((row, idx) => (
                                        <tr
                                            key={idx}
                                            className={`border-b border-[#e5e5e5] transition-colors ${selectedCustomerFilter === row.customerCode
                                                ? 'bg-[#f0f7ff]'
                                                : 'hover:bg-[#edf3f9]'}`}
                                        >
                                            <td
                                                className={`py-1.5 px-3 border-r border-[#e5e5e5] cursor-pointer select-none transition-colors ${selectedCustomerFilter === row.customerCode
                                                    ? 'bg-[#e0f0ff]'
                                                    : 'hover:bg-[#f5f5f5]'}`}
                                                onClick={() => toggleCustomerFilter(row.customerCode)}
                                                title="Filtrar pedidos de este cliente"
                                            >
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[10px] text-[#5c5c5c] bg-[#f5f5f5] px-1 py-0.5 rounded border border-[#d1d5db] font-mono leading-none">
                                                        {row.customerCode}
                                                    </span>
                                                    <span className="text-[12px] text-[#1f1f1f] leading-none">
                                                        {row.customerName}
                                                    </span>
                                                    {selectedCustomerFilter === row.customerCode && (
                                                        <span className="text-[9px] bg-[#0067c0] text-white px-1.5 py-0.5 rounded uppercase leading-none">
                                                            Filtrado
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            {matrixData.dates.map(date => {
                                                const dayData = row.dates[date] || { orders: 0, lines: 0 };
                                                return (
                                                    <React.Fragment key={date}>
                                                        <td className="py-1.5 px-3 text-right border-r border-[#e5e5e5] text-[#1f1f1f] font-mono">
                                                            {dayData.orders > 0 ? dayData.orders : ''}
                                                        </td>
                                                        <td className="py-1.5 px-3 text-right border-r border-[#e5e5e5] text-[#1f1f1f] font-mono">
                                                            {dayData.lines > 0 ? dayData.lines : ''}
                                                        </td>
                                                    </React.Fragment>
                                                );
                                            })}
                                            <td className="py-1.5 px-3 text-right border-r border-[#e5e5e5] text-[#1f1f1f] bg-[#fafafa] font-mono">
                                                {row.totalOrders > 0 ? row.totalOrders : ''}
                                            </td>
                                            <td className="py-1.5 px-3 text-right border-r border-[#e5e5e5] text-[#1f1f1f] bg-[#fafafa] font-mono">
                                                {row.totalLines > 0 ? row.totalLines : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-[#fafafa] border-t-2 border-[#e5e5e5] font-normal sticky bottom-0 z-10">
                                    <tr className="border-b border-[#e5e5e5]">
                                        <td className="py-2 px-3 border-r border-[#e5e5e5] text-[#1f1f1f] uppercase text-[10.5px]">
                                            Total
                                        </td>
                                        {matrixData.dates.map(date => {
                                            const totalOrders = matrixData.totals[date].orders;
                                            const totalLines = matrixData.totals[date].lines;
                                            return (
                                                <React.Fragment key={date}>
                                                    <td className="py-2 px-3 text-right border-r border-[#e5e5e5] text-[12px] text-[#0067c0] font-mono">
                                                        {totalOrders > 0 ? totalOrders : 0}
                                                    </td>
                                                    <td className="py-2 px-3 text-right border-r border-[#e5e5e5] text-[12px] text-[#0067c0] font-mono">
                                                        {totalLines > 0 ? totalLines : 0}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                        <td className="py-2 px-3 text-right border-r border-[#e5e5e5] text-[12px] text-[#0067c0] bg-[#f0f7ff] font-mono">
                                            {matrixData.grandTotal.orders}
                                        </td>
                                        <td className="py-2 px-3 text-right border-r border-[#e5e5e5] text-[12px] text-[#0067c0] bg-[#f0f7ff] font-mono">
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
