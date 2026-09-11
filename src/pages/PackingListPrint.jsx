import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { getDB } from '../utils/offlineDb';
import { getPickingPackingList, getPickingAudits, getPickingAuditById } from '../utils/tauriApi';
import { isTauri } from '../utils/tauriBridge';

const normalizePackingListData = (raw) => {
    if (!raw) return null;

    const orderNumber = raw.order_number || '';
    const despatchNumber = raw.despatch_number || '00';
    const customerCode = raw.customer_code || '';
    const customerName = raw.customer_name || 'Cliente General';
    const timestamp = raw.timestamp ? new Date(raw.timestamp).toLocaleString('es-CO') : new Date().toLocaleString('es-CO');

    // 1. Normalizar bultos (diccionario de bulto -> lista de ítems)
    let pkgs = {};
    if (raw.packages && typeof raw.packages === 'object' && !Array.isArray(raw.packages) && Object.keys(raw.packages).length > 0) {
        pkgs = raw.packages;
    } else if (raw.packages_assignment && typeof raw.packages_assignment === 'object' && Object.keys(raw.packages_assignment).length > 0) {
        Object.entries(raw.packages_assignment).forEach(([itemKey, pkgMap]) => {
            const [itemCode, line] = itemKey.split(':');
            if (pkgMap && typeof pkgMap === 'object') {
                Object.entries(pkgMap).forEach(([pkgNum, qty]) => {
                    const q = parseFloat(qty) || 0;
                    if (q > 0) {
                        if (!pkgs[pkgNum]) pkgs[pkgNum] = [];
                        const matchingItem = (raw.items || []).find(it => (it.code || it.item_code) === itemCode);
                        pkgs[pkgNum].push({
                            item_code: itemCode,
                            description: matchingItem ? matchingItem.description : '',
                            order_line: line || '',
                            qty: q,
                            quantity: q
                        });
                    }
                });
            }
        });
    }

    // Fallback: si aún no hay bultos asignados pero hay items, asignar todo al Bulto 1
    if (Object.keys(pkgs).length === 0 && raw.items && Array.isArray(raw.items) && raw.items.length > 0) {
        pkgs["1"] = raw.items.map(it => {
            const q = parseFloat(it.qty_scan ?? it.quantity ?? it.qty ?? it.qty_req ?? 0);
            return {
                item_code: it.code || it.item_code || '',
                description: it.description || '',
                order_line: it.order_line || '1',
                qty: q,
                quantity: q
            };
        });
    }

    // 2. Número total de bultos
    const totalPackages = raw.total_packages || (typeof raw.packages === 'number' ? raw.packages : Object.keys(pkgs).length) || 1;

    // 3. Dimensiones de bultos
    let dimensions = [];
    if (raw.packages_dimensions && Array.isArray(raw.packages_dimensions)) {
        dimensions = raw.packages_dimensions;
    }

    return {
        audit_id: raw.id || raw.audit_id,
        order_number: orderNumber,
        despatch_number: despatchNumber,
        customer_code: customerCode,
        customer_name: customerName,
        status: raw.status || 'Completo',
        timestamp,
        total_packages: totalPackages,
        packages: pkgs,
        packages_dimensions: dimensions
    };
};

const PackingListPrint = ({ setTitle, id: propId }) => {
    const { id: paramId } = useParams();
    const navigate = useNavigate();
    const activeId = propId || paramId;

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const printComponentRef = useRef(null);

    // Configuración de react-to-print (renderizado en iframe aislado para no alterar WebView2 ni heredar estilos térmicos)
    const triggerReactPrint = useReactToPrint({
        contentRef: printComponentRef,
        documentTitle: data ? `Packing_List_${data.order_number}_${data.despatch_number}` : 'Packing_List',
        pageStyle: `
            @page {
                size: auto;
                margin: 0.5cm;
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
                .no-print, .print-hidden {
                    display: none !important;
                }
                * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                table {
                    width: 100% !important;
                    border-collapse: collapse !important;
                    page-break-inside: auto;
                }
                tr {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                thead {
                    display: table-header-group !important;
                }
            }
        `
    });

    const handlePrint = () => {
        try {
            if (typeof triggerReactPrint === 'function') {
                triggerReactPrint();
            } else {
                window.print();
            }
        } catch (e) {
            console.warn("useReactToPrint omitido, recurriendo a window.print:", e);
            window.print();
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                let rawData = null;
                const numId = activeId ? parseInt(activeId, 10) : null;

                // Nivel 1: Consulta fetch local interceptada por localApiBridge
                if (activeId && activeId !== 'undefined') {
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

                // Nivel 4: Búsqueda en la lista general de auditorías SQLite
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
                                // Si no se especificó ID, cargar la auditoría más reciente
                                rawData = allAudits[0];
                            }
                        }
                    } catch (e) {
                        console.warn("Nivel 4 lista general de auditorías omitido:", e);
                    }
                }

                // Nivel 5: Respaldo IndexedDB para modo offline
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
                    throw new Error(activeId ? `No se encontraron datos para la orden o auditoría #${activeId}.` : "No hay auditorías registradas para generar el Packing List.");
                }

                const normalized = normalizePackingListData(rawData);
                setData(normalized);

                if (setTitle && normalized) {
                    setTitle(`Packing List #${normalized.order_number}`);
                }
            } catch (err) {
                console.error("Error cargando packing list:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [activeId, setTitle]);

    // Mapeo de dimensiones por número de bulto
    const dimensionsMap = useMemo(() => {
        const map = {};
        if (data?.packages_dimensions && Array.isArray(data.packages_dimensions)) {
            data.packages_dimensions.forEach(d => {
                map[String(d.package_number)] = d;
            });
        }
        return map;
    }, [data]);

    // Cálculo de peso total y volumen total del pedido
    const { totalWeight, totalVolume } = useMemo(() => {
        let w = 0;
        let v = 0;
        if (data?.packages_dimensions && Array.isArray(data.packages_dimensions)) {
            data.packages_dimensions.forEach(d => {
                w += parseFloat(d.weight) || 0;
                const l = parseFloat(d.length) || 0;
                const wi = parseFloat(d.width) || 0;
                const h = parseFloat(d.height) || 0;
                if (l > 0 && wi > 0 && h > 0) {
                    v += (l * wi * h) / 1000000;
                }
            });
        }
        return { totalWeight: w, totalVolume: v };
    }, [data]);

    if (loading) {
        return (
            <div className="p-8 text-[#1f1f1f] font-normal font-['Segoe_UI',Tahoma,sans-serif] bg-white min-h-screen">
                Generando Packing List...
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-[#991b1b] font-normal font-['Segoe_UI',Tahoma,sans-serif] bg-white min-h-screen">
                <div className="mb-4">Error: {error}</div>
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                >
                    Volver
                </button>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="p-8 text-[#1f1f1f] font-normal font-['Segoe_UI',Tahoma,sans-serif] bg-white min-h-screen">
                No hay datos disponibles para este pedido.
            </div>
        );
    }

    const { packages } = data;
    const sortedPackageKeys = packages ? Object.keys(packages).sort((a, b) => parseInt(a) - parseInt(b)) : [];

    return (
        <div className="bg-white min-h-screen text-[#1f1f1f] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] print:p-0 print:m-0 print:bg-white print:min-h-0 print:block print:w-full">
            {/* Estilos para impresión directa con Ctrl+P */}
            <style dangerouslySetInnerHTML={{
                __html: `
                @page {
                    size: auto;
                    margin: 0.5cm;
                }
                @media print {
                    @page {
                        size: auto;
                        margin: 0.5cm;
                    }
                    html, body, #root {
                        width: 100% !important;
                        height: auto !important;
                        min-height: 0 !important;
                        max-height: none !important;
                        overflow: visible !important;
                        display: block !important;
                        position: static !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: #ffffff !important;
                        color: #000000 !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .no-print, .print-hidden {
                        display: none !important;
                    }
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    table {
                        page-break-inside: auto;
                        border-collapse: collapse !important;
                        width: 100% !important;
                    }
                    tr {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }
                    thead {
                        display: table-header-group !important;
                    }
                }
            `}} />

            {/* Barra de control — NO se imprime */}
            <div className="no-print mb-4 sticky top-0 bg-white border-b border-[#d1d5db] shadow-xs z-10 print:hidden">
                <div className="max-w-4xl mx-auto flex justify-between items-center py-2 px-4">
                    <div>
                        <h1 className="text-[14px] font-normal text-[#1f1f1f]">
                            Packing List — Pedido #{data.order_number} / {data.despatch_number}
                        </h1>
                        <p className="text-[11px] text-[#5c5c5c] font-normal">
                            Cliente: {data.customer_name || 'N/A'} · {data.total_packages} bulto(s)
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => navigate(-1)}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Cerrar
                        </button>
                        <button
                            type="button"
                            onClick={handlePrint}
                            className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Imprimir
                        </button>
                    </div>
                </div>
            </div>

            {/* Contenedor imprimible aislado referenciado por useReactToPrint */}
            <div ref={printComponentRef} className="max-w-4xl mx-auto print:max-w-none print:w-full">
                <div className="border border-[#d1d5db] p-6 bg-white shadow-xs rounded print:border-none print:shadow-none print:p-0 print:m-0 print:rounded-none">
                    
                    {/* Encabezado */}
                    <div className="text-center mb-4 border-b border-black pb-3 print:mb-3">
                        <h1 className="text-3xl uppercase tracking-tight mb-1 print:text-2xl text-black font-normal">
                            Packing List
                        </h1>
                        <div className="text-lg font-normal text-black mb-1 uppercase">
                            Cliente: {data.customer_code ? `${data.customer_code} - ` : ''}{data.customer_name || 'N/A'}
                        </div>
                        <div className="text-xs text-[#5c5c5c] print:text-black font-normal">
                            {data.timestamp || ''}
                            <span className="ml-3 border-l border-black pl-3 text-sm">
                                Pedido / Despacho: {data.order_number} / {data.despatch_number}
                            </span>
                            <span className="ml-3 border-l border-black pl-3 text-sm">
                                Total Bultos: {data.total_packages}
                            </span>
                        </div>
                        {(totalWeight > 0 || totalVolume > 0) && (
                            <div className="text-[11px] text-black font-mono mt-1 font-normal">
                                {totalWeight > 0 && <span className="mr-3">Peso Total: {totalWeight.toFixed(2)} kg</span>}
                                {totalVolume > 0 && <span>Vol. Total: {totalVolume.toFixed(3)} m³</span>}
                            </div>
                        )}
                    </div>

                    {/* Tablas de Bultos */}
                    {sortedPackageKeys.length === 0 ? (
                        <div className="text-center py-8 text-[#5c5c5c] italic border border-dashed border-[#d1d5db] rounded text-[11px] font-normal">
                            Sin bultos registrados para este pedido
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {sortedPackageKeys.map((key) => {
                                const bultoDims = dimensionsMap[String(key)];
                                const numL = parseFloat(bultoDims?.length) || 0;
                                const numW = parseFloat(bultoDims?.width) || 0;
                                const numH = parseFloat(bultoDims?.height) || 0;
                                const numWeight = parseFloat(bultoDims?.weight) || 0;
                                const hasDims = numL > 0 && numW > 0 && numH > 0;
                                const hasWeight = numWeight > 0;
                                const pkgItems = data.packages[key] || [];

                                return (
                                    <div key={key} className="border border-black overflow-hidden print:border-black mb-2 last:mb-0 break-inside-avoid">
                                        <div className="bg-white text-black px-4 py-1 border-b border-black flex justify-between items-center print:py-0.5">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-sm font-normal uppercase">Bulto #{key}</h3>
                                                {(hasDims || hasWeight) && (
                                                    <span className="text-[10px] font-normal text-black print:text-[9px]">
                                                        {hasDims && `${numL} × ${numW} × ${numH} cm`}
                                                        {hasDims && hasWeight && ' • '}
                                                        {hasWeight && `${numWeight.toFixed(2)} kg`}
                                                        {hasDims && ((numL * numW * numH) / 1000000 >= 0.001) && ` (${((numL * numW * numH) / 1000000).toFixed(3)} m³)`}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[10px] font-mono border border-black px-1.5 rounded">BOX-{String(key).padStart(3, '0')}</span>
                                        </div>
                                        <table className="min-w-full text-sm table-fixed">
                                            <thead className="bg-white text-black border-b border-black">
                                                <tr>
                                                    <th className="px-2 py-0.5 text-left w-10 uppercase text-[9px] font-normal">Línea</th>
                                                    <th className="px-2 py-0.5 text-left w-24 uppercase text-[9px] font-normal">Código</th>
                                                    <th className="px-2 py-0.5 text-left uppercase text-[9px] font-normal">Descripción</th>
                                                    <th className="px-2 py-0.5 text-right w-14 uppercase text-[9px] font-normal">Cant.</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#e5e7eb] print:divide-black">
                                                {pkgItems.length > 0 ? (
                                                    pkgItems.map((item, idx) => (
                                                        <tr key={idx} className="hover:bg-gray-50 print:bg-transparent">
                                                            <td className="px-2 py-0.5 font-mono text-black text-[9px] font-normal">{item.order_line}</td>
                                                            <td className="px-2 py-0.5 font-mono text-black text-[9px] font-normal break-all">{item.item_code}</td>
                                                            <td className="px-2 py-0.5 text-black text-[9px] font-normal leading-tight break-words">{item.description}</td>
                                                            <td className="px-2 py-0.5 text-right text-[10px] font-normal whitespace-nowrap">{item.quantity ?? item.qty}</td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan="4" className="px-3 py-2 text-center text-[10px] text-[#5c5c5c] italic font-normal">Sin ítems</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Pie de página */}
                    <div className="mt-8 pt-2 border-t border-[#e5e7eb] flex justify-center items-center text-[10px] text-[#5c5c5c] print:mt-10 print:border-black print:text-black font-normal">
                        <p className="tracking-widest uppercase">LOGIX - WMS</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PackingListPrint;
