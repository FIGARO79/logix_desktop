import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { getDB } from '../utils/offlineDb';
import { getPickingPackingList, getPickingAudits, getPickingAuditById } from '../utils/tauriApi';
import { isTauri } from '../utils/tauriBridge';
import '../styles/PackingList.css';

const DEFAULT_CONFIGS_BY_COUNTRY = {
    CO: {
        country: 'CO',
        country_name: 'Colombia',
        warehouse_name: 'Girardota',
        warehouses: ['Girardota'],
        carriers: ['Pickup']
    },
    CL: {
        country: 'CL',
        country_name: 'Chile',
        warehouse_name: 'Santiago',
        warehouses: ['Santiago', 'Copiapo'],
        carriers: ['Pickup']
    },
    BR: {
        country: 'BR',
        country_name: 'Brasil',
        warehouse_name: 'Vespaciano',
        warehouses: ['Vespaciano', 'Parauapebas'],
        carriers: ['Pickup']
    },
    AR: {
        country: 'AR',
        country_name: 'Argentina',
        warehouse_name: 'San Justo',
        warehouses: ['San Justo'],
        carriers: ['Pickup']
    },
    PE: {
        country: 'PE',
        country_name: 'Perú',
        warehouse_name: 'Lima',
        warehouses: ['Lima'],
        carriers: ['Pickup']
    }
};

const normalizeOrderData = (raw) => {
    if (!raw) return null;

    const orderNumber = raw.order_number || raw.orderNumber || '';
    const despatchNumber = raw.despatch_number || raw.despatchNumber || '00';
    const customerCode = raw.customer_code || raw.customerCode || '';
    const customerName = raw.customer_name || raw.customerName || 'Cliente General';
    const carrier = raw.carrier || '';
    const timestamp = raw.timestamp
        ? new Date(raw.timestamp).toLocaleString('es-CO', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        })
        : new Date().toLocaleString('es-CO');

    // 1. Normalizar bultos (diccionario de bulto -> lista de ítems)
    let pkgs = {};
    if (raw.packages && typeof raw.packages === 'object' && !Array.isArray(raw.packages) && Object.keys(raw.packages).length > 0) {
        Object.entries(raw.packages).forEach(([pkgNum, itemsList]) => {
            if (Array.isArray(itemsList)) {
                pkgs[String(pkgNum)] = itemsList.map(it => {
                    const q = parseFloat(it.quantity ?? it.qty ?? it.qty_scan ?? 0) || 0;
                    const unitWt = parseFloat(it.item_weight ?? it.weight ?? 0) || 0;
                    const lineWt = it.line_weight != null ? parseFloat(it.line_weight) : (unitWt * q);
                    return {
                        item_code: it.item_code || it.code || '',
                        description: it.description || '',
                        order_line: it.order_line || it.line || '1',
                        quantity: q,
                        item_weight: unitWt,
                        line_weight: lineWt
                    };
                });
            }
        });
    } else if (raw.packages_assignment && typeof raw.packages_assignment === 'object' && Object.keys(raw.packages_assignment).length > 0) {
        Object.entries(raw.packages_assignment).forEach(([itemKey, pkgMap]) => {
            const [itemCode, line] = itemKey.split(':');
            if (pkgMap && typeof pkgMap === 'object') {
                Object.entries(pkgMap).forEach(([pkgNum, qty]) => {
                    const q = parseFloat(qty) || 0;
                    if (q > 0) {
                        const strPkg = String(pkgNum);
                        if (!pkgs[strPkg]) pkgs[strPkg] = [];
                        const matchingItem = (raw.items || []).find(it => (it.code || it.item_code) === itemCode);
                        const unitWt = parseFloat(matchingItem?.item_weight || matchingItem?.weight || 0) || 0;
                        pkgs[strPkg].push({
                            item_code: itemCode,
                            description: matchingItem ? matchingItem.description : '',
                            order_line: line || matchingItem?.order_line || '1',
                            quantity: q,
                            item_weight: unitWt,
                            line_weight: unitWt * q
                        });
                    }
                });
            }
        });
    }

    // Fallback: si no hay asignación pero hay items, asignar todo al Bulto 1
    if (Object.keys(pkgs).length === 0 && raw.items && Array.isArray(raw.items) && raw.items.length > 0) {
        pkgs["1"] = raw.items.map(it => {
            const q = parseFloat(it.qty_scan ?? it.quantity ?? it.qty ?? it.qty_req ?? 0) || 0;
            const unitWt = parseFloat(it.item_weight ?? it.weight ?? 0) || 0;
            const lineWt = it.line_weight != null ? parseFloat(it.line_weight) : (unitWt * q);
            return {
                item_code: it.code || it.item_code || '',
                description: it.description || '',
                order_line: it.order_line || '1',
                quantity: q,
                item_weight: unitWt,
                line_weight: lineWt
            };
        });
    }

    // 2. Número total de bultos
    const totalPackages = raw.total_packages || (typeof raw.packages === 'number' ? raw.packages : Object.keys(pkgs).length) || 1;

    // 3. Normalizar mapa de dimensiones de bultos
    const dimensionsMap = {};
    if (raw.packages_dimensions) {
        if (Array.isArray(raw.packages_dimensions)) {
            raw.packages_dimensions.forEach(d => {
                const num = String(d.package_number || d.packageNumber || 1);
                dimensionsMap[num] = {
                    length: parseFloat(d.length) || 0,
                    width: parseFloat(d.width) || 0,
                    height: parseFloat(d.height) || 0,
                    weight: parseFloat(d.weight) || 0
                };
            });
        } else if (typeof raw.packages_dimensions === 'object') {
            Object.entries(raw.packages_dimensions).forEach(([num, d]) => {
                dimensionsMap[String(num)] = {
                    length: parseFloat(d?.length) || 0,
                    width: parseFloat(d?.width) || 0,
                    height: parseFloat(d?.height) || 0,
                    weight: parseFloat(d?.weight) || 0
                };
            });
        }
    }

    return {
        audit_id: raw.id || raw.audit_id,
        order_number: orderNumber,
        despatch_number: despatchNumber,
        customer_code: customerCode,
        customer_name: customerName,
        carrier,
        status: raw.status || 'Completo',
        timestamp,
        total_packages: totalPackages,
        packages: pkgs,
        dimensionsMap
    };
};

const PackingListPrint = ({ setTitle, id: propId }) => {
    const { id: paramId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const activeId = propId || paramId;
    const isConsolidatedParam = searchParams.get('consolidated') === 'true';

    const [data, setData] = useState(null);
    const [isConsolidated, setIsConsolidated] = useState(isConsolidatedParam);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Estados de configuración de Bodega y Transportadora
    const [selectedCountry, setSelectedCountry] = useState('CO');
    const [warehousesList, setWarehousesList] = useState(DEFAULT_CONFIGS_BY_COUNTRY.CO.warehouses);
    const [selectedWarehouse, setSelectedWarehouse] = useState(DEFAULT_CONFIGS_BY_COUNTRY.CO.warehouses[0]);
    const [carriersList, setCarriersList] = useState(DEFAULT_CONFIGS_BY_COUNTRY.CO.carriers);
    const [selectedCarrier, setSelectedCarrier] = useState('');

    // Modal de Configuración de CEDI / Transportadoras / Países
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [modalCountry, setModalCountry] = useState('CO');
    const [modalWarehouses, setModalWarehouses] = useState([]);
    const [modalCarriers, setModalCarriers] = useState([]);
    const [newWarehouseInput, setNewWarehouseInput] = useState('');
    const [newCarrierInput, setNewCarrierInput] = useState('');

    const printContainerRef = useRef(null);

    const triggerReactPrint = useReactToPrint({
        contentRef: printContainerRef,
        documentTitle: data
            ? (isConsolidated ? `Packing_List_Consolidado_${activeId}` : `Packing_List_${data.order_number}_${data.despatch_number}`)
            : 'Packing_List',
        pageStyle: `
            @page {
                size: auto;
                margin: 0mm;
            }
            @media print {
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #ffffff !important;
                    color: #000000 !important;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                .no-print, .print-control-bar {
                    display: none !important;
                }
            }
        `
    });

    const handlePrint = () => {
        try {
            if (typeof triggerReactPrint === 'function') {
                triggerReactPrint();
            } else {
                setTimeout(() => window.print(), 250);
            }
        } catch (e) {
            console.warn("useReactToPrint omitido, recurriendo a window.print:", e);
            setTimeout(() => window.print(), 250);
        }
    };

    // Cargar configuración activa desde el servidor local / bridge
    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/config/');
            if (res && res.ok) {
                const cfg = await res.json();
                if (cfg.country) setSelectedCountry(cfg.country);
                if (cfg.warehouses && Array.isArray(cfg.warehouses) && cfg.warehouses.length > 0) {
                    setWarehousesList(cfg.warehouses);
                    setSelectedWarehouse(prev => cfg.warehouses.includes(prev) ? prev : cfg.warehouses[0]);
                }
                if (cfg.carriers && Array.isArray(cfg.carriers) && cfg.carriers.length > 0) {
                    setCarriersList(cfg.carriers);
                }
            }
        } catch (e) {
            // Usar listas por defecto
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    // Abrir modal de configuración sincronizando los valores actuales
    const handleOpenConfigModal = () => {
        setModalCountry(selectedCountry);
        setModalWarehouses([...warehousesList]);
        setModalCarriers([...carriersList]);
        setNewWarehouseInput('');
        setNewCarrierInput('');
        setShowConfigModal(true);
    };

    // Cambiar preset al seleccionar otro país en el modal
    const handleCountryPresetChange = (countryCode) => {
        setModalCountry(countryCode);
        const preset = DEFAULT_CONFIGS_BY_COUNTRY[countryCode];
        if (preset) {
            setModalWarehouses([...preset.warehouses]);
            setModalCarriers([...preset.carriers]);
        }
    };

    const handleAddModalWarehouse = (e) => {
        e.preventDefault();
        const clean = newWarehouseInput.trim();
        if (clean && !modalWarehouses.includes(clean)) {
            setModalWarehouses([...modalWarehouses, clean]);
            setNewWarehouseInput('');
        }
    };

    const handleRemoveModalWarehouse = (idx) => {
        setModalWarehouses(modalWarehouses.filter((_, i) => i !== idx));
    };

    const handleAddModalCarrier = (e) => {
        e.preventDefault();
        const clean = newCarrierInput.trim();
        if (clean && !modalCarriers.includes(clean)) {
            setModalCarriers([...modalCarriers, clean]);
            setNewCarrierInput('');
        }
    };

    const handleRemoveModalCarrier = (idx) => {
        setModalCarriers(modalCarriers.filter((_, i) => i !== idx));
    };

    const handleSaveConfig = async () => {
        if (modalWarehouses.length === 0) {
            alert("Debe haber al menos un Centro de Distribución (CEDI).");
            return;
        }

        const payload = {
            country: modalCountry,
            warehouse_name: modalWarehouses[0],
            warehouses: modalWarehouses,
            carriers: modalCarriers
        };

        try {
            await fetch('/api/config/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            setSelectedCountry(modalCountry);
            setWarehousesList(modalWarehouses);
            setSelectedWarehouse(modalWarehouses[0]);
            setCarriersList(modalCarriers);
            setShowConfigModal(false);
        } catch (err) {
            console.error("Error al guardar configuración:", err);
            alert("Error al guardar la configuración.");
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                let rawData = null;
                const numId = activeId ? parseInt(activeId, 10) : null;

                // Nivel 0: Consolidado explícito
                if (isConsolidatedParam && activeId) {
                    try {
                        const res = await fetch(`/api/shipments/${activeId}/packing_list`, { credentials: 'include' });
                        if (res && res.ok) {
                            rawData = await res.json();
                            setIsConsolidated(true);
                        }
                    } catch (e) {
                        console.warn("Nivel 0 consolidado omitido:", e);
                    }
                }

                // Nivel 1: Consulta localApiBridge
                if (!rawData && activeId && activeId !== 'undefined') {
                    try {
                        const res = await fetch(`/api/picking/packing_list/${activeId}`, { credentials: 'include' });
                        if (res && res.ok) {
                            rawData = await res.json();
                        }
                    } catch (e) {
                        console.warn("Nivel 1 fetch packing_list omitido:", e);
                    }
                }

                // Nivel 2: Invocación nativa getPickingPackingList en Tauri
                if (!rawData && isTauri() && numId && !isNaN(numId) && numId > 0) {
                    try {
                        rawData = await getPickingPackingList(numId);
                    } catch (e) {
                        console.warn("Nivel 2 nativo getPickingPackingList omitido:", e);
                    }
                }

                // Nivel 3: Invocación nativa getPickingAuditById en Tauri
                if (!rawData && isTauri() && numId && !isNaN(numId) && numId > 0) {
                    try {
                        rawData = await getPickingAuditById(numId);
                    } catch (e) {
                        console.warn("Nivel 3 nativo getPickingAuditById omitido:", e);
                    }
                }

                // Nivel 4: Lista general de auditorías SQLite
                if (!rawData) {
                    try {
                        let allAudits = [];
                        if (isTauri()) {
                            allAudits = await getPickingAudits();
                        } else {
                            const res = await fetch('/api/views/view_picking_audits', { credentials: 'include' });
                            if (res.ok) allAudits = await res.json();
                        }

                        if (Array.isArray(allAudits) && allAudits.length > 0) {
                            if (activeId && activeId !== 'undefined') {
                                rawData = allAudits.find(a =>
                                    String(a.id) === String(activeId) ||
                                    String(a.order_number) === String(activeId) ||
                                    (numId && a.id === numId)
                                );
                            } else {
                                rawData = allAudits[0];
                            }
                        }
                    } catch (e) {
                        console.warn("Nivel 4 lista general de auditorías omitido:", e);
                    }
                }

                // Nivel 5: IndexedDB para modo offline
                if (!rawData) {
                    try {
                        const db = await getDB();
                        const directAudits = db ? (await db.getAll('picking_audits') || []) : [];
                        const pendingList = db ? (await db.getAll('pending_sync') || []) : [];

                        if (activeId && activeId !== 'undefined') {
                            const foundDirect = directAudits.find(item => String(item.id) === String(activeId) || String(item.order_number) === String(activeId));
                            const foundPending = pendingList.find(item => String(item.id) === String(activeId) || String(item.payload?.order_number) === String(activeId));
                            rawData = foundDirect || (foundPending ? foundPending.payload : null);
                        } else if (directAudits.length > 0) {
                            rawData = directAudits[directAudits.length - 1];
                        }
                    } catch (e) {
                        console.warn("Nivel 5 IndexedDB omitido:", e);
                    }
                }

                if (!rawData) {
                    throw new Error(activeId ? `No se encontraron datos para la auditoría o pedido #${activeId}.` : "No hay auditorías registradas para generar el Packing List.");
                }

                // Detectar si la respuesta es un consolidado con múltiples órdenes
                if (rawData.orders && Array.isArray(rawData.orders)) {
                    setIsConsolidated(true);
                    setData({
                        id: rawData.id || activeId,
                        carrier: rawData.carrier || '',
                        note: rawData.note || '',
                        created_at: rawData.created_at || rawData.timestamp || '',
                        orders: rawData.orders.map(normalizeOrderData)
                    });
                    if (rawData.carrier) setSelectedCarrier(rawData.carrier);
                } else {
                    const normalized = normalizeOrderData(rawData);
                    setData(normalized);
                    if (normalized.carrier) setSelectedCarrier(normalized.carrier);
                    if (setTitle && normalized) {
                        setTitle(`Packing List #${normalized.order_number}`);
                    }
                }
            } catch (err) {
                console.error("Error cargando packing list:", err);
                setError(err.message || 'Error desconocido');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [activeId, isConsolidatedParam, setTitle]);

    if (loading) {
        return (
            <div className="print-loading">
                Generando Packing List...
            </div>
        );
    }

    if (error) {
        return (
            <div className="print-error">
                <p>Error: {error}</p>
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="print-btn-secondary"
                    style={{ marginTop: '1rem' }}
                >
                    Volver
                </button>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="print-loading">
                No se encontraron datos para imprimir.
            </div>
        );
    }

    const ordersToRender = isConsolidated && data.orders ? data.orders : [data];

    return (
        <div className="packing-list-wrapper">
            {/* Barra de control superior — NO se imprime */}
            <div className="no-print print-control-bar">
                <div className="print-control-inner">
                    <div className="print-control-title">
                        <h2>
                            {isConsolidated ? `Packing List Consolidado #${activeId}` : `Packing List — Pedido #${data.order_number} / ${data.despatch_number}`}
                        </h2>
                        <p>
                            {isConsolidated
                                ? `${ordersToRender.length} pedido(s) en este despacho`
                                : `Cliente: ${data.customer_name || 'N/A'} · ${data.total_packages} bulto(s)`}
                        </p>
                    </div>

                    <div className="print-control-selectors">
                        <div className="print-control-group">
                            <span className="print-control-label">Transportadora:</span>
                            {isConsolidated && data.carrier ? (
                                <strong style={{ fontSize: '11.5px', textTransform: 'uppercase' }}>{data.carrier}</strong>
                            ) : (
                                <select
                                    value={selectedCarrier}
                                    onChange={(e) => setSelectedCarrier(e.target.value)}
                                    className="print-control-select"
                                >
                                    <option value="">Ninguna (Directo)</option>
                                    {carriersList.map((c, idx) => (
                                        <option key={idx} value={c}>{c}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div className="print-control-group">
                            <span className="print-control-label">CEDI:</span>
                            <select
                                value={selectedWarehouse}
                                onChange={(e) => setSelectedWarehouse(e.target.value)}
                                className="print-control-select"
                            >
                                {warehousesList.map((w, idx) => (
                                    <option key={idx} value={w}>{w}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="print-control-actions">
                        <button
                            type="button"
                            onClick={handleOpenConfigModal}
                            className="print-btn-secondary"
                            title="Configurar CEDIs, Transportadoras y Países"
                        >
                            Configurar País / CEDIs
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate(-1)}
                            className="print-btn-secondary"
                        >
                            Cerrar
                        </button>
                        <button
                            type="button"
                            onClick={handlePrint}
                            className="print-btn-primary"
                        >
                            Imprimir
                        </button>
                    </div>
                </div>
            </div>

            {/* Contenedor físico imprimible */}
            <div ref={printContainerRef} className="print-pages-container">
                {ordersToRender.map((order, orderIdx) => {
                    const packages = order.packages || {};
                    const sortedKeys = Object.keys(packages).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

                    if (sortedKeys.length === 0) {
                        return (
                            <div key={orderIdx} className="print-page">
                                <div className="text-center py-8 text-[#5c5c5c] italic">
                                    El pedido #{order.order_number} no registra bultos asignados.
                                </div>
                            </div>
                        );
                    }

                    return sortedKeys.map((pkgNum, pkgIdx) => {
                        const items = packages[pkgNum] || [];

                        // Totales del bulto
                        const pkgTotalQty = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
                        const pkgTotalNetWeight = items.reduce((acc, it) => {
                            const lineWt = it.line_weight != null ? Number(it.line_weight) : ((Number(it.item_weight) || 0) * (Number(it.quantity) || 0));
                            return acc + lineWt;
                        }, 0);

                        // Dimensiones y peso bruto del bulto
                        const dims = order.dimensionsMap?.[String(pkgNum)] || {};
                        const grossWeight = dims.weight != null ? Number(dims.weight) : 0;
                        const length = dims.length != null ? Number(dims.length) : 0;
                        const width = dims.width != null ? Number(dims.width) : 0;
                        const height = dims.height != null ? Number(dims.height) : 0;
                        const hasDims = length > 0 && width > 0 && height > 0;
                        const volumeDm3 = hasDims ? ((length * width * height) / 1000).toFixed(2) : null;

                        return (
                            <div key={`${orderIdx}-${pkgNum}`} className="print-page">
                                {/* Cabecera del Packing List */}
                                <div className="print-header">
                                    <div className="header-top">
                                        <h1>PACKING LIST</h1>
                                        <div className="header-page-number">
                                            PÁG {pkgIdx + 1} / {sortedKeys.length}
                                        </div>
                                    </div>
                                    <div className="header-carrier-row">
                                        <span className="header-carrier-lbl">Transportadora:</span>
                                        <span className="header-carrier-val">{selectedCarrier || order.carrier || 'Directo (Propio)'}</span>
                                    </div>
                                    <div className="header-meta">
                                        <span>Fecha: {order.timestamp || new Date().toLocaleDateString('es-CO')}</span>
                                        {isConsolidated && <span>Despacho Consolidado: <strong>#{activeId}</strong></span>}
                                    </div>
                                </div>

                                {/* Resumen Comercial */}
                                <div className="print-meta-grid">
                                    <div className="meta-block">
                                        <span className="meta-lbl">Cliente</span>
                                        <span className="meta-val">
                                            {order.customer_code ? `[${order.customer_code}] ` : ''}
                                            {order.customer_name}
                                        </span>
                                    </div>
                                    <div className="meta-block" style={{ textAlign: 'right' }}>
                                        <span className="meta-lbl">Pedido / Despacho</span>
                                        <span className="meta-val">{order.order_number} / {order.despatch_number}</span>
                                    </div>
                                </div>

                                {/* Cabecera del Bulto */}
                                <div className="print-pkg-header">
                                    <div className="pkg-title-group">
                                        <h3>Bulto #{pkgNum}</h3>
                                        <span className="pkg-total-lbl">Total Bultos: {order.total_packages}</span>
                                    </div>
                                    <div className="pkg-tag-badge">
                                        BULTO {pkgIdx + 1} DE {sortedKeys.length}
                                    </div>
                                </div>

                                {/* Tabla de Artículos del Bulto */}
                                <table className="print-items-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '45px' }} className="text-center">Línea</th>
                                            <th style={{ width: '120px' }}>Código / SKU</th>
                                            <th>Descripción</th>
                                            <th style={{ width: '60px' }} className="text-right">Cant.</th>
                                            <th style={{ width: '95px' }} className="text-right">Peso Neto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="text-center py-4 italic text-[#5c5c5c]">
                                                    Bulto sin artículos asignados
                                                </td>
                                            </tr>
                                        ) : (
                                            items.map((item, iIdx) => {
                                                const lineWt = item.line_weight != null ? Number(item.line_weight) : ((Number(item.item_weight) || 0) * (Number(item.quantity) || 0));
                                                return (
                                                    <tr key={iIdx}>
                                                        <td className="text-center text-mono text-[#5c5c5c]">{item.order_line}</td>
                                                        <td className="text-mono">{item.item_code}</td>
                                                        <td className="sku-desc">{item.description}</td>
                                                        <td className="text-right text-mono">{item.quantity}</td>
                                                        <td className="text-right text-mono">{lineWt.toFixed(3)} kg</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                    <tfoot>
                                        <tr className="print-table-total-row">
                                            <td colSpan="3" style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '10px', paddingRight: '12px' }}>
                                                Total (Bulto #{pkgNum}):
                                            </td>
                                            <td className="text-right text-mono" style={{ fontSize: '11.5px' }}>
                                                {pkgTotalQty}
                                            </td>
                                            <td className="text-right text-mono" style={{ fontSize: '11.5px' }}>
                                                {pkgTotalNetWeight.toFixed(3)} kg
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>

                                {/* Resumen de Pesos y Medidas */}
                                <div className="print-weights-summary-card">
                                    {/* Fila 1: Peso Neto */}
                                    <div className="weights-row net-row">
                                        <div className="weights-label-group">
                                            <span className="weights-label-main">Peso Neto del Bulto</span>
                                        </div>
                                        <strong className="weights-value text-mono">{pkgTotalNetWeight.toFixed(3)} kg</strong>
                                    </div>

                                    {/* Fila 2: Peso Bruto y Medidas */}
                                    <div className="weights-row gross-row">
                                        <div className="gross-left-col">
                                            <div className="weights-label-group">
                                                <span className="weights-label-main">Peso Bruto</span>
                                            </div>
                                            <strong className="weights-value text-mono">
                                                {grossWeight > 0 ? `${grossWeight.toFixed(3)} kg` : '0.000 kg'}
                                            </strong>
                                        </div>

                                        <div className="dims-right-col">
                                            <div className="weights-label-group" style={{ justifyContent: 'flex-end' }}>
                                                <span className="weights-label-main">Medidas del Bulto</span>
                                                <span className="weights-subtext">(L × A × A)</span>
                                            </div>
                                            <div className="dims-content text-mono">
                                                {hasDims ? (
                                                    <span>
                                                        {length} × {width} × {height} cm
                                                        {volumeDm3 && <span className="dims-volume-tag"> ({volumeDm3} dm³)</span>}
                                                    </span>
                                                ) : (
                                                    <span className="text-[#5c5c5c] italic">Medidas no registradas</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Pie de Página de Firma / CEDI */}
                                <div className="print-footer">
                                    <div className="signature-area">
                                        <span className="signature-line"></span>
                                        <span className="signature-lbl">Firma del Auditor</span>
                                        {selectedWarehouse && (
                                            <span className="warehouse-lbl">{selectedWarehouse}</span>
                                        )}
                                    </div>
                                    <div className="print-app-tag">
                                        <span>LOGIX - WMS</span>
                                        <p>Embalaje y Despacho</p>
                                    </div>
                                </div>
                            </div>
                        );
                    });
                })}
            </div>

            {/* Modal de Configuración de CEDIs y Transportadoras por País */}
            {showConfigModal && (
                <div className="fixed inset-0 bg-black/40 z-[110] flex items-center justify-center p-4">
                    <div className="bg-white rounded p-6 max-w-2xl w-full border border-[#d1d5db] shadow-lg font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f]">
                        <div className="flex justify-between items-center pb-2.5 border-b border-[#e5e5e5] mb-4">
                            <h3 className="text-[15px] font-normal text-[#1f1f1f] m-0">Configuración de CEDIs y Transportadoras</h3>
                            <button
                                type="button"
                                onClick={() => setShowConfigModal(false)}
                                className="text-[#5c5c5c] hover:text-[#1f1f1f] text-[18px] cursor-pointer"
                            >
                                ×
                            </button>
                        </div>

                        {/* Selector de País (solo nombres de países, sin nombres de CEDIs) */}
                        <div className="mb-4">
                            <label className="block text-[10.5px] uppercase text-[#5c5c5c] mb-1">
                                País Preconfigurado
                            </label>
                            <select
                                value={modalCountry}
                                onChange={(e) => handleCountryPresetChange(e.target.value)}
                                className="w-full h-8 px-3 border border-[#d1d5db] rounded outline-none text-[12px] bg-white cursor-pointer font-normal text-[#1f1f1f] focus:border-[#0067c0]"
                            >
                                <option value="CO">Colombia</option>
                                <option value="CL">Chile</option>
                                <option value="BR">Brasil</option>
                                <option value="AR">Argentina</option>
                                <option value="PE">Perú</option>
                            </select>
                        </div>

                        {/* Columnas ampliadas: CEDIs a la izquierda, Transportadoras a la derecha */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            {/* Lista de CEDIs / Centros de Distribución */}
                            <div className="flex flex-col">
                                <label className="block text-[10.5px] uppercase text-[#5c5c5c] mb-1">
                                    Centros de Distribución (CEDIs / Bodegas)
                                </label>
                                <div className="flex gap-1.5 mb-2">
                                    <input
                                        type="text"
                                        value={newWarehouseInput}
                                        onChange={(e) => setNewWarehouseInput(e.target.value)}
                                        placeholder="Nuevo CEDI..."
                                        className="flex-1 h-7 px-2 border border-[#d1d5db] rounded outline-none text-[11.5px]"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddModalWarehouse(e);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddModalWarehouse}
                                        className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[11.5px] cursor-pointer"
                                    >
                                        Añadir
                                    </button>
                                </div>
                                <div className="max-h-48 overflow-y-auto border border-[#e5e5e5] rounded p-1.5 space-y-1 bg-[#fafafa]">
                                    {modalWarehouses.map((w, idx) => (
                                        <div key={idx} className="flex justify-between items-center px-2 py-1 bg-white border border-[#e5e5e5] rounded text-[11px]">
                                            <span className="truncate pr-1">{w}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveModalWarehouse(idx)}
                                                className="text-[#a80000] hover:underline cursor-pointer text-[11px] flex-shrink-0"
                                                title="Eliminar CEDI"
                                            >
                                                Eliminar
                                            </button>
                                        </div>
                                    ))}
                                    {modalWarehouses.length === 0 && (
                                        <div className="text-center py-4 text-[#5c5c5c] italic text-[11px]">
                                            Sin CEDIs registrados
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Lista de Transportadoras */}
                            <div className="flex flex-col">
                                <label className="block text-[10.5px] uppercase text-[#5c5c5c] mb-1">
                                    Transportadoras de Carga
                                </label>
                                <div className="flex gap-1.5 mb-2">
                                    <input
                                        type="text"
                                        value={newCarrierInput}
                                        onChange={(e) => setNewCarrierInput(e.target.value)}
                                        placeholder="Nueva transportadora..."
                                        className="flex-1 h-7 px-2 border border-[#d1d5db] rounded outline-none text-[11.5px]"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddModalCarrier(e);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddModalCarrier}
                                        className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[11.5px] cursor-pointer"
                                    >
                                        Añadir
                                    </button>
                                </div>
                                <div className="max-h-48 overflow-y-auto border border-[#e5e5e5] rounded p-1.5 space-y-1 bg-[#fafafa]">
                                    {modalCarriers.map((c, idx) => (
                                        <div key={idx} className="flex justify-between items-center px-2 py-1 bg-white border border-[#e5e5e5] rounded text-[11px]">
                                            <span className="truncate pr-1">{c}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveModalCarrier(idx)}
                                                className="text-[#a80000] hover:underline cursor-pointer text-[11px] flex-shrink-0"
                                                title="Eliminar transportadora"
                                            >
                                                Eliminar
                                            </button>
                                        </div>
                                    ))}
                                    {modalCarriers.length === 0 && (
                                        <div className="text-center py-4 text-[#5c5c5c] italic text-[11px]">
                                            Sin transportadoras registradas
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Acciones del Modal */}
                        <div className="flex justify-end gap-2 pt-3 border-t border-[#e5e5e5]">
                            <button
                                type="button"
                                onClick={() => setShowConfigModal(false)}
                                className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[11.5px] cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveConfig}
                                className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[11.5px] cursor-pointer"
                            >
                                Guardar Configuración
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PackingListPrint;
