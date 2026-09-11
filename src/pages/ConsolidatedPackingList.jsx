import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const ConsolidatedPackingList = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch(`/api/shipments/${id}/packing_list`, { credentials: 'include' });
                if (!res.ok) throw new Error("Error al cargar datos del envío");
                setData(await res.json());
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    useEffect(() => {
        // Desactivar temporalmente estilos de SAP Fiori para evitar interferencias con el print
        const fioriLink = document.querySelector('link[href*="sap_fiori_3"]');
        if (fioriLink) fioriLink.disabled = true;
        return () => {
            if (fioriLink) fioriLink.disabled = false;
        };
    }, []);

    const handlePrint = () => {
        // Timeout para dar tiempo al navegador a aplicar el reset de estilos global y asentar el DOM
        setTimeout(() => {
            window.print();
        }, 500);
    };

    if (loading) return <div className="p-8">Generando Packing List Consolidado...</div>;
    if (error) return <div className="p-8 text-red-600">Error: {error}</div>;
    if (!data) return <div className="p-8">No hay datos.</div>;

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleString('es-CO', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false
            });
        } catch { return dateStr; }
    };

    // Encabezado del envío reutilizable
    const ShipmentHeader = ({ pageLabel, customerInfo }) => (
        <div className="text-center mb-4 border-b border-black pb-3 print:mb-3">
            <h1 className="text-3xl uppercase tracking-tight mb-1 print:text-2xl text-black">
                Packing List Consolidado
            </h1>
            {customerInfo && (
                <div className="text-lg font-medium  text-black mb-1 uppercase">
                    Cliente: {customerInfo}
                </div>
            )}
            <div className="text-xs text-gray-500 print:text-black">
                {formatDate(data.created_at)}
                {data.carrier && (
                    <span className="ml-3 border-l border-black pl-3 text-sm">
                        {data.carrier}
                    </span>
                )}
                <span className="ml-3 border-l border-black pl-3 text-sm">
                    {pageLabel}
                </span>
            </div>
            {data.note && (
                <div className="text-[10px] text-gray-500 mt-1 print:text-black">
                    Nota: {data.note}
                </div>
            )}
        </div>
    );

    // Info del pedido individual
    const OrderInfo = ({ order }) => {
        let w = 0;
        if (order.packages_dimensions && Array.isArray(order.packages_dimensions)) {
            order.packages_dimensions.forEach(d => {
                w += parseFloat(d.weight) || 0;
            });
        }

        return (
            <div className="flex justify-between items-end mb-3 text-sm print:gap-2 print:mb-2 border-b border-zinc-100 pb-1">
                <div className="flex-1">
                    <span className="text-gray-500 uppercase text-[9px] print:text-black mr-2">Pedido / Despacho:</span>
                    <span className="text-lg text-black font-medium ">
                        {order.order_number} <span className="mx-1 text-gray-300">/</span> {order.despatch_number}
                    </span>
                </div>
                <div className="text-right">
                    <div className="flex items-baseline justify-end gap-1.5">
                        <span className="text-gray-500 uppercase text-[9px] print:text-black mr-2">Total Bultos:</span>
                        <span className="text-2xl font-medium  text-[#285f94] print:text-black leading-none">{order.total_packages}</span>
                    </div>
                    {w > 0 && (
                        <div className="text-[10px] text-black font-mono mt-0.5">
                            <span className="text-gray-500 uppercase text-[8px] print:text-black mr-1">Peso Total:</span>
                            <span>{w.toFixed(2)} kg</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Tabla de un bulto
    const PackageTable = ({ keyName, packageData, packageDimensions = null, hideHeader = false }) => {
        const numL = parseFloat(packageDimensions?.length) || 0;
        const numW = parseFloat(packageDimensions?.width) || 0;
        const numH = parseFloat(packageDimensions?.height) || 0;
        const numWeight = parseFloat(packageDimensions?.weight) || 0;
        const hasDims = numL > 0 && numW > 0 && numH > 0;
        const hasWeight = numWeight > 0;

        return (
            <div className="border border-black overflow-hidden print:border-black mb-2 last:mb-0">
                {!hideHeader && (
                    <div className="bg-white text-black px-4 py-1 border-b border-black flex justify-between items-center print:py-0.5">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium  uppercase">Bulto #{keyName}</h3>
                            {(hasDims || hasWeight) && (
                                <span className="text-[10px] font-normal text-black print:text-[9px]">
                                    {hasDims && `${numL} × ${numW} × ${numH} cm`}
                                    {hasDims && hasWeight && ' • '}
                                    {hasWeight && `${numWeight.toFixed(2)} kg`}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] font-mono border border-black px-1.5 rounded">BOX-{keyName.padStart(3, '0')}</span>
                    </div>
                )}
            <table className="min-w-full text-sm table-fixed">
                <thead className="bg-white text-black border-b border-black">
                    <tr>
                        <th className="px-2 py-0.5 text-left w-10 uppercase text-[9px]">Línea</th>
                        <th className="px-2 py-0.5 text-left w-20 uppercase text-[9px]">Código</th>
                        <th className="px-2 py-0.5 text-left uppercase text-[9px]">Descripción</th>
                        <th className="px-2 py-0.5 text-right w-14 uppercase text-[9px]">Cant.</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 print:divide-black">
                    {packageData && packageData.length > 0 ? (
                        packageData.map((item, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 print:bg-transparent">
                                <td className="px-2 py-0.5 font-mono text-black text-[9px] font-medium ">{item.order_line}</td>
                                <td className="px-2 py-0.5 font-mono text-black text-[9px] break-all">{item.item_code}</td>
                                <td className="px-2 py-0.5 text-black text-[9px] leading-tight break-words">{item.description}</td>
                                <td className="px-2 py-0.5 text-right text-[10px] font-medium  whitespace-nowrap">{item.quantity ?? item.qty}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="4" className="px-3 py-2 text-center text-[10px] text-gray-500 italic">Sin ítems</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

    // Calcular total de páginas (1 por pedido)
    const totalPages = data.orders.length;

    // Obtener información única de clientes para el encabezado
    const uniqueClients = data.orders.reduce((acc, o) => {
        const clientLabel = o.customer_code 
            ? `${o.customer_code} - ${o.customer_name}` 
            : (o.customer_name || 'CLIENTE DESCONOCIDO');
        
        if (!acc.includes(clientLabel)) acc.push(clientLabel);
        return acc;
    }, []);

    const commonCustomerHeader = uniqueClients.join(' / ');

    return (
        <div className="bg-white min-h-screen text-[#1f1f1f] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] print:p-0 print:bg-white print:min-h-0 print:block">
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    @page { margin: 0.5cm; }
                    body { -webkit-print-color-adjust: exact; color: #000 !important; background: #fff !important; }
                    thead, th, tr, td { background-color: transparent !important; background-image: none !important; color: #000 !important; }
                    .no-print, .print-hidden { display: none !important; }
                }
            `}} />

            {/* Barra de control — NO se imprime */}
            <div className="no-print mb-4 sticky top-0 bg-white border-b border-[#d1d5db] shadow-xs z-10 print:hidden">
                <div className="max-w-4xl mx-auto flex justify-between items-center py-2 px-4">
                    <div>
                        <h1 className="text-[14px] font-normal text-gray-800">Packing List Consolidado — Envío #{data.shipment_id}</h1>
                        <p className="text-[11px] text-gray-500 font-normal">{data.total_orders} pedido(s) · {data.carrier || 'Sin transportadora'}</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => navigate(-1)}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Cerrar
                        </button>
                        <button
                            onClick={handlePrint}
                            className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Imprimir Todo
                        </button>
                    </div>
                </div>
            </div>

            {/* Contenido: Diseño compacto sin saltos de página obligatorios */}
            <div className="max-w-4xl mx-auto print:max-w-none print:w-full">
                {data.orders.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-[#d1d5db] rounded bg-[#f8f9fa]">
                        <h3 className="text-base text-gray-400 mb-1 font-normal">Sin Pedidos</h3>
                        <p className="text-gray-500 text-[12px] font-normal">Este envío no tiene pedidos asociados.</p>
                    </div>
                ) : (
                    <div className="border border-[#d1d5db] p-6 bg-white shadow-xs rounded print:border-none print:shadow-none print:p-0 print:m-0 print:rounded-none">
                        <ShipmentHeader 
                            pageLabel={`CONSOLIDADO DE ${totalPages} PEDIDO(S)`} 
                            customerInfo={commonCustomerHeader}
                        />

                        {/* La información del cliente se mostrará por cada pedido a continuación si hay múltiples clientes */}

                        {data.orders.map((order) => {
                            const sortedPkgKeys = order.packages
                                ? Object.keys(order.packages).sort((a, b) => parseInt(a) - parseInt(b))
                                : [];

                            return (
                                <div key={order.audit_id} className="mb-4 last:mb-0 print:mb-2 break-inside-avoid">
                                    <OrderInfo order={order} />

                                    <div className="space-y-1">
                                        {sortedPkgKeys.length > 0 ? (
                                            sortedPkgKeys.map(key => {
                                                const bultoDim = (order.packages_dimensions || []).find(d => String(d.package_number) === String(key));
                                                return (
                                                    <PackageTable
                                                        key={key}
                                                        keyName={key}
                                                        packageData={order.packages[key]}
                                                        packageDimensions={bultoDim}
                                                        hideHeader={sortedPkgKeys.length === 1 && !bultoDim}
                                                    />
                                                );
                                            })
                                        ) : (
                                            <div className="text-center py-2 text-gray-400 italic border border-dashed border-[#d1d5db] rounded text-[11px] font-normal">
                                                Sin bultos registrados para este pedido
                                            </div>
                                        )}
                                    </div>

                                    {/* New table for order lines */}
                                    {order.items && order.items.length > 0 && (
                                        <div className="border border-black overflow-hidden print:border-black mt-2">
                                            <div className="bg-white text-black px-3 py-1 border-b border-black flex justify-between items-center print:py-0.5">
                                                <h3 className="text-[12px] font-normal uppercase leading-tight">
                                                    Detalle del Pedido #{order.order_number}
                                                </h3>
                                            </div>
                                            <table className="min-w-full text-xs">
                                                <thead>
                                                    <tr className="bg-gray-100 text-gray-700 font-normal border-b border-gray-300">
                                                        <th className="p-1 px-2 text-left w-12 text-[10px] font-normal">LÍNEA</th>
                                                        <th className="p-1 px-2 text-left text-[10px] font-normal">CÓDIGO</th>
                                                        <th className="p-1 text-left text-[10px] font-normal">DESCRIPCIÓN</th>
                                                        <th className="p-1 text-center w-16 text-[10px] font-normal">CANT.</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {order.items.map((item, idx) => (
                                                        <tr key={idx} className="border-b border-gray-200 last:border-0 hover:bg-gray-50">
                                                            <td className="p-1 px-2 font-mono text-[10px] text-gray-500 font-normal">{item.order_line}</td>
                                                            <td className="p-1 px-2 font-mono text-[11px] font-normal text-gray-800">{item.item_code}</td>
                                                            <td className="p-1 text-[11px] text-gray-600 truncate max-w-[150px] font-normal" title={item.description}>
                                                                {item.description}
                                                            </td>
                                                            <td className="p-1 text-center font-normal text-gray-800 text-[11px]">{item.quantity}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        <div className="mt-8 pt-2 border-t border-gray-200 flex justify-center items-center text-[10px] text-gray-500 print:mt-10 print:border-gray-300 print:text-black font-normal">
                            <p className="tracking-widest uppercase">LOGIX - WMS</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConsolidatedPackingList;
