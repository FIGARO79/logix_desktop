import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const Shipments = () => {
    const { setTitle } = useOutletContext();
    const [shipments, setShipments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        setTitle("Envíos Consolidados");
    }, [setTitle]);

    useEffect(() => {
        fetchShipments();
    }, []);

    const fetchShipments = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/shipments/', { credentials: 'include' });
            if (!res.ok) throw new Error('Error al cargar envíos');
            setShipments(await res.json());
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async (id) => {
        if (!confirm(`¿CANCELAR ENVÍO #${id}?`)) return;
        try {
            const res = await fetch(`/api/shipments/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!res.ok) throw new Error('Error al cancelar');
            toast.success(`Envío #${id} cancelado`);
            fetchShipments();
        } catch (err) {
            toast.error(err.message);
        }
    };

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

    return (
        <div className="max-w-[1400px] mx-auto px-6 py-6 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f]">
            <ToastContainer position="top-right" autoClose={3000} />

            {/* Barra de Acciones Superior */}
            <div className="mb-4 pb-3 border-b border-[#d1d5db] flex justify-between items-center bg-white px-4 py-2.5 rounded border shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Envíos Consolidados</h1>
                    <span className="text-[11px] font-normal text-[#5c5c5c]">Gestión y consulta de remesas de despacho</span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchShipments}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                    >
                        Sincronizar
                    </button>
                    <div className="text-[12px] font-normal text-[#5c5c5c] border-l border-[#d1d5db] pl-3">
                        {shipments.length} Envíos
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#0067c0]"></div>
                </div>
            ) : shipments.length === 0 ? (
                <div className="text-center py-16 bg-white border border-[#d1d5db] rounded shadow-sm">
                    <h3 className="text-[13px] font-normal text-[#1f1f1f] mb-1">No se encontraron registros</h3>
                    <p className="text-[12px] font-normal text-[#5c5c5c]">
                        Inicia una consolidación desde el{' '}
                        <Link to="/view_picking_audits" className="text-[#0067c0] hover:underline">
                            Historial de Auditorías
                        </Link>
                    </p>
                </div>
            ) : (
                <div className="bg-white border border-[#d1d5db] rounded shadow-sm overflow-hidden">
                    {/* Desktop Table */}
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal border-b border-[#2a3c4e]">
                                    <th className="px-3 py-2 text-center w-8"></th>
                                    <th className="px-3 py-2 font-normal">ID</th>
                                    <th className="px-3 py-2 font-normal">Fecha</th>
                                    <th className="px-3 py-2 font-normal">Cliente Principal</th>
                                    <th className="px-3 py-2 font-normal">Usuario</th>
                                    <th className="px-3 py-2 font-normal">Transporte</th>
                                    <th className="px-3 py-2 font-normal text-center">Items</th>
                                    <th className="px-3 py-2 font-normal text-center">Estado</th>
                                    <th className="px-3 py-2 font-normal text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e5e7eb]">
                                {shipments.map(s => (
                                    <React.Fragment key={s.id}>
                                        <tr
                                            className={`hover:bg-[#edf3f9] transition-colors cursor-pointer text-[12px] font-normal text-[#1f1f1f]
                                                ${s.status === 'cancelled' ? 'opacity-60 bg-gray-50' : ''}
                                                ${expandedId === s.id ? 'bg-[#f0f4f9]' : ''}`}
                                            onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                                        >
                                            <td className="px-3 py-2 text-center text-[#5c5c5c]">
                                                <svg
                                                    className={`w-3 h-3 mx-auto transform transition-transform duration-200 ${expandedId === s.id ? 'rotate-90' : ''}`}
                                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </td>
                                            <td className="px-3 py-2 font-normal text-[#1f1f1f]">#{s.id}</td>
                                            <td className="px-3 py-2 text-[#5c5c5c]">{formatDate(s.created_at)}</td>
                                            <td className="px-3 py-2 text-[#1f1f1f] truncate max-w-[220px]">
                                                {s.audits.length > 0 && (
                                                    <>
                                                        <span className="text-[#5c5c5c] mr-1.5">[{s.audits[0].customer_code}]</span>
                                                        {s.audits[0].customer_name}
                                                        {s.audits.length > 1 && (
                                                            <span className="text-[10px] bg-[#f0f0f0] border border-[#d1d5db] px-1 ml-1.5 rounded text-[#5c5c5c]">
                                                                +{s.audits.length - 1}
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-[#5c5c5c]">{s.username}</td>
                                            <td className="px-3 py-2 text-[#5c5c5c]">{s.carrier || '—'}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-[11px] font-normal text-[#1f1f1f] bg-[#f5f5f5] border border-[#e5e7eb] px-2 py-0.5 rounded">
                                                    {s.total_orders}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`px-2 py-0.5 text-[11px] font-normal rounded border ${s.status === 'active'
                                                    ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]'
                                                    : 'bg-[#fef2f2] text-[#991b1b] border-[#fecaca]'
                                                    }`}>
                                                    {s.status === 'active' ? 'Activo' : 'Cancelado'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-center items-center gap-2">
                                                    {s.status === 'active' && (
                                                        <>
                                                            <Link
                                                                to={`/shipments/print/${s.id}`}
                                                                className="h-6 px-2.5 inline-flex items-center bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#0067c0] text-[11px] font-normal rounded transition-colors"
                                                                title="Imprimir"
                                                            >
                                                                Imprimir
                                                            </Link>
                                                            <button
                                                                onClick={() => handleCancel(s.id)}
                                                                className="h-6 px-2.5 inline-flex items-center bg-white hover:bg-[#fef2f2] border border-[#d1d5db] text-[#991b1b] text-[11px] font-normal rounded transition-colors cursor-pointer"
                                                                title="Anular"
                                                            >
                                                                Anular
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Detalle expandido */}
                                        {expandedId === s.id && (
                                            <tr className="bg-[#f9fafb]">
                                                <td colSpan="9" className="px-8 py-3 border-b border-[#e5e7eb]">
                                                    <div className="bg-white border border-[#d1d5db] p-4 rounded shadow-sm">
                                                        <div className="flex justify-between items-start mb-4 border-b border-[#f0f0f0] pb-2">
                                                            <div>
                                                                <h4 className="text-[11px] font-normal text-[#5c5c5c] uppercase tracking-wider mb-1">Observaciones del Envío</h4>
                                                                <p className="text-[12px] text-[#1f1f1f] font-normal italic">
                                                                    {s.note || "Sin observaciones registradas"}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <span className="text-[10px] font-normal text-[#5c5c5c] block">Consolidado por</span>
                                                                <span className="text-[12px] font-normal text-[#1f1f1f]">{s.username}</span>
                                                            </div>
                                                        </div>

                                                        <h4 className="text-[11px] font-normal text-[#5c5c5c] uppercase tracking-wider mb-2">Pedidos Agrupados</h4>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                                            {s.audits.map(a => (
                                                                <div key={a.audit_id} className="bg-[#fafafa] border border-[#e5e7eb] p-2.5 rounded hover:border-[#d1d5db] transition-all">
                                                                    <div className="flex justify-between items-center mb-1">
                                                                        <span className="text-[12px] font-normal text-[#1f1f1f]">Orden: {a.order_number}</span>
                                                                        <span className="text-[11px] font-mono text-[#5c5c5c] bg-white px-1.5 border border-[#e5e7eb] rounded">{a.despatch_number}</span>
                                                                    </div>
                                                                    <div className="text-[11px] text-[#5c5c5c] truncate mb-1">
                                                                        <span className="mr-1">[{a.customer_code}]</span>
                                                                        {a.customer_name}
                                                                    </div>
                                                                    <div className="text-[11px] font-normal text-[#1f1f1f]">
                                                                        Contenido: {a.packages} bultos
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="block sm:hidden bg-[#f9fafb] p-3 space-y-3">
                        {shipments.map(s => (
                            <div key={s.id} className={`bg-white border border-[#d1d5db] p-3 rounded shadow-sm ${s.status === 'cancelled' ? 'opacity-60' : ''}`} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-normal text-[#1f1f1f]">Envío #{s.id}</span>
                                        <span className="text-[10px] text-[#5c5c5c]">{formatDate(s.created_at)}</span>
                                    </div>
                                    <span className={`px-2 py-0.5 text-[10px] font-normal rounded border ${s.status === 'active'
                                        ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]'
                                        : 'bg-[#fef2f2] text-[#991b1b] border-[#fecaca]'
                                        }`}>
                                        {s.status === 'active' ? 'Activo' : 'Cancelado'}
                                    </span>
                                </div>

                                <div className="text-[11px] font-normal text-[#1f1f1f] mb-2 truncate">
                                    {s.audits.length > 0 && (
                                        <>
                                            <span className="text-[#5c5c5c] mr-1">[{s.audits[0].customer_code}]</span>
                                            {s.audits[0].customer_name}
                                        </>
                                    )}
                                </div>

                                <div className="flex justify-between items-center pt-2 border-t border-[#f0f0f0]">
                                    <span className="text-[11px] font-normal text-[#5c5c5c]">{s.total_orders} Pedidos</span>
                                    {s.status === 'active' && (
                                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                            <Link to={`/shipments/print/${s.id}`} className="h-6 px-2 inline-flex items-center text-[11px] font-normal text-[#0067c0] border border-[#d1d5db] rounded bg-white">Imprimir</Link>
                                            <button onClick={() => handleCancel(s.id)} className="h-6 px-2 inline-flex items-center text-[11px] font-normal text-[#991b1b] border border-[#d1d5db] rounded bg-white">Anular</button>
                                        </div>
                                    )}
                                </div>

                                {expandedId === s.id && (
                                    <div className="mt-3 pt-3 border-t border-[#e5e7eb] space-y-2">
                                        {s.audits.map(a => (
                                            <div key={a.audit_id} className="flex justify-between items-center text-[11px] bg-[#f9fafb] p-2 rounded border border-[#e5e7eb]">
                                                <div className="flex flex-col">
                                                    <span className="font-normal text-[#1f1f1f]">{a.order_number}</span>
                                                    <span className="text-[#5c5c5c] text-[10px]">{a.despatch_number}</span>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-normal text-[#1f1f1f]">{a.packages} bultos</div>
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
        </div>
    );
};

export default Shipments;
