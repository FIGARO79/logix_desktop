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
        <div className="max-w-[1400px] mx-auto px-6 py-6 font-sans bg-[#fcfcfc] min-h-screen text-black">
            <ToastContainer position="top-right" autoClose={3000} />

            {/* Barra de Acciones */}
            <div className="mb-1 border-b border-zinc-100 pb-1 flex justify-end items-center">
                <div className="flex items-center gap-6">
                    <button
                        onClick={fetchShipments}
                        className="text-[9px] font-normal uppercase tracking-widest text-black hover:text-blue-750 transition-colors"
                    >
                        Sincronizar
                    </button>
                    <div className="text-[9px] font-normal text-black uppercase tracking-widest border-l border-zinc-200 pl-6">
                        {shipments.length} Envíos
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900"></div>
                </div>
            ) : shipments.length === 0 ? (
                <div className="text-center py-20 bg-white border border-zinc-200 shadow-sm">
                    <h3 className="text-[10px] font-normal text-black uppercase tracking-[0.2em] mb-2">No se encontraron registros</h3>
                    <p className="text-[9px] text-black uppercase">
                        Inicia una consolidación desde el{' '}
                        <Link to="/view_picking_audits" className="text-black underline hover:text-blue-750">
                            Historial de Auditorías
                        </Link>
                    </p>
                </div>
            ) : (
                <div className="bg-white border border-zinc-200 shadow-sm overflow-hidden">
                    {/* Desktop Table */}
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full leading-normal">
                            <thead>
                                <tr className="bg-zinc-900 border-b border-zinc-800 text-white">
                                    <th className="px-4 py-1.5 text-center w-10"></th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-left">ID</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-left">Fecha</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-left">Cliente Principal</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-left">Usuario</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-left">Transporte</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-center">Items</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-center">Estado</th>
                                    <th className="px-4 py-1.5 text-[12px] font-normal text-white uppercase tracking-widest text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shipments.map(s => (
                                    <React.Fragment key={s.id}>
                                        <tr
                                            className={`border-b border-zinc-100 hover:bg-zinc-50/50 transition-colors cursor-pointer
                                                ${s.status === 'cancelled' ? 'opacity-50' : ''}
                                                ${expandedId === s.id ? 'bg-zinc-50' : ''}`}
                                            onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                                        >
                                            <td className="px-4 py-1.5 text-center">
                                                <svg
                                                    className={`w-3 h-3 text-black transform transition-transform duration-200 ${expandedId === s.id ? 'rotate-90' : ''}`}
                                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </td>
                                            <td className="px-4 py-1.5 text-[12px] font-normal text-black">#{s.id}</td>
                                            <td className="px-4 py-1.5 text-[12px] font-normal text-black">{formatDate(s.created_at)}</td>
                                            <td className="px-4 py-1.5 text-[12px] text-black truncate max-w-[200px] uppercase font-normal">
                                                {s.audits.length > 0 && (
                                                    <>
                                                        <span className="text-black mr-2">[{s.audits[0].customer_code}]</span>
                                                        {s.audits[0].customer_name}
                                                        {s.audits.length > 1 && <span className="text-[12px] bg-zinc-100 px-1 ml-2 text-black">+{s.audits.length - 1}</span>}
                                                    </>
                                                )}
                                            </td>
                                            <td className="px-4 py-1.5 text-[12px] text-black uppercase font-normal">{s.username}</td>
                                            <td className="px-4 py-1.5 text-[12px] text-black uppercase tracking-tight font-normal">{s.carrier || '—'}</td>
                                            <td className="px-4 py-1.5 text-center">
                                                <span className="text-[12px] font-normal text-black bg-zinc-100 px-2 py-0.5 rounded">
                                                    {s.total_orders}
                                                </span>
                                            </td>
                                            <td className="px-4 py-1.5 text-center">
                                                <span className={`px-2 py-0.5 text-[9px] font-normal uppercase tracking-tight rounded border ${s.status === 'active'
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                                    : 'bg-red-50 text-red-800 border-red-200'
                                                    }`}>
                                                    {s.status === 'active' ? 'Activo' : 'Cancelado'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-center items-center gap-6">
                                                    {s.status === 'active' && (
                                                        <>
                                                            <Link
                                                                to={`/shipments/print/${s.id}`}
                                                                className="text-[9px] font-normal uppercase tracking-widest text-black hover:text-blue-750 transition-colors leading-none"
                                                                title="Imprimir"
                                                            >
                                                                Print
                                                            </Link>
                                                            <button
                                                                onClick={() => handleCancel(s.id)}
                                                                className="text-[9px] font-normal uppercase tracking-widest text-black hover:text-red-650 transition-colors leading-none"
                                                                title="Anular"
                                                            >
                                                                Anular
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Expanded detail */}
                                        {expandedId === s.id && (
                                            <tr className="bg-zinc-50/50">
                                                <td colSpan="9" className="px-10 py-4 border-b border-zinc-100">
                                                    <div className="bg-white border border-zinc-200 p-6 shadow-sm">
                                                        <div className="flex justify-between items-start mb-6 border-b border-zinc-50 pb-4">
                                                            <div>
                                                                <h4 className="text-[9px] font-normal text-black uppercase tracking-[0.2em] mb-2">Observaciones del Envío</h4>
                                                                <p className="text-[11px] text-black font-normal italic">
                                                                    {s.note || "SIN OBSERVACIONES REGISTRADAS"}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <span className="text-[8px] font-normal text-black uppercase tracking-widest block">Consolidado por</span>
                                                                <span className="text-[10px] font-normal text-black uppercase">{s.username}</span>
                                                            </div>
                                                        </div>

                                                        <h4 className="text-[9px] font-normal text-black uppercase tracking-[0.2em] mb-4">Pedidos Agrupados</h4>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                            {s.audits.map(a => (
                                                                <div key={a.audit_id} className="bg-zinc-50 border border-zinc-100 p-3 hover:border-zinc-200 transition-all">
                                                                    <div className="flex justify-between items-center mb-2">
                                                                        <span className="text-[11px] font-normal text-black">{a.order_number}</span>
                                                                        <span className="text-[9px] font-mono text-black bg-white px-1.5 border border-zinc-100">{a.despatch_number}</span>
                                                                    </div>
                                                                    <div className="text-[9px] text-black uppercase font-normal truncate mb-1">
                                                                        <span className="text-black mr-2">[{a.customer_code}]</span>
                                                                        {a.customer_name}
                                                                    </div>
                                                                    <div className="text-[8px] font-normal text-black uppercase tracking-tighter">
                                                                        CONTENIDO: {a.packages} BULTOS
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
                    <div className="block sm:hidden bg-zinc-50 p-2 space-y-3">
                        {shipments.map(s => (
                            <div key={s.id} className={`bg-white border border-zinc-200 p-4 shadow-sm ${s.status === 'cancelled' ? 'opacity-60' : ''}`} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-normal text-black tracking-tight">ENVÍO #{s.id}</span>
                                        <span className="text-[8px] text-black uppercase tracking-widest">{formatDate(s.created_at)}</span>
                                    </div>
                                    <span className={`px-2 py-0.5 text-[8px] font-normal uppercase tracking-tight rounded border ${s.status === 'active'
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                                        : 'bg-red-50 text-red-800 border-red-100'
                                        }`}>
                                        {s.status === 'active' ? 'ACTIVO' : 'ANULADO'}
                                    </span>
                                </div>

                                <div className="text-[10px] font-normal text-black uppercase mb-3 truncate">
                                    {s.audits.length > 0 && (
                                        <>
                                            <span className="text-black mr-2">[{s.audits[0].customer_code}]</span>
                                            {s.audits[0].customer_name}
                                        </>
                                    )}
                                </div>

                                <div className="flex justify-between items-center pt-2 border-t border-zinc-50">
                                    <span className="text-[8px] font-normal text-black uppercase tracking-widest">{s.total_orders} PEDIDOS</span>
                                    {s.status === 'active' && (
                                        <div className="flex gap-4" onClick={e => e.stopPropagation()}>
                                            <Link to={`/shipments/print/${s.id}`} className="text-[9px] font-normal uppercase text-black hover:text-blue-700">Print</Link>
                                            <button onClick={() => handleCancel(s.id)} className="text-[9px] font-normal uppercase text-black hover:text-red-500">Anular</button>
                                        </div>
                                    )}
                                </div>

                                {expandedId === s.id && (
                                    <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                                        {s.audits.map(a => (
                                            <div key={a.audit_id} className="flex justify-between items-center text-[9px] bg-zinc-50 p-2 rounded">
                                                <div className="flex flex-col">
                                                    <span className="font-normal text-black">{a.order_number}</span>
                                                    <span className="text-black text-[8px]">{a.despatch_number}</span>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-normal text-black">{a.packages} BULTOS</div>
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
