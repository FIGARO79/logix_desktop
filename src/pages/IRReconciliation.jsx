import { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const IRReconciliation = () => {
    const { setTitle } = useOutletContext();
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState('');

    const normalizeDate = (dateString) => {
        if (!dateString) return null;
        let normalized = dateString.trim().replace(' ', 'T');
        if (normalized.length === 10 && normalized.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return `${normalized}T00:00:00`;
        }
        const hasTimeZone = normalized.includes('Z') || normalized.match(/[+-]\d{2}:\d{2}$/);
        if (!hasTimeZone) normalized = `${normalized}Z`;
        return normalized;
    };

    const formatDate = (dateString) => {
        const normalized = normalizeDate(dateString);
        if (!normalized) return '-';
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return 'Fecha Inválida';
        return date.toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    };

    const { data: reconciliations = [], isLoading: loading, error, refetch } = useQuery({
        queryKey: ['ir_reconciliations'],
        queryFn: async () => {
            const res = await fetch('/api/inbound/ir_reconciliation', { credentials: 'include' });
            if (!res.ok) throw new Error("No se pudo cargar el historial de conciliaciones");
            return res.json();
        },
        refetchInterval: 15000,
        refetchOnWindowFocus: false
    });

    useEffect(() => {
        setTitle("Tablero de Control IR");
    }, [setTitle]);

    const handleDelete = async (id) => {
        if (!confirm("¿Está seguro de eliminar este registro de conciliación del historial?")) return;
        try {
            const res = await fetch(`/api/inbound/ir_reconciliation/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (res.ok) {
                queryClient.invalidateQueries({ queryKey: ['ir_reconciliations'] });
            } else {
                alert("Error al eliminar el registro");
            }
        } catch (e) {
            console.error("Error deleting IR reconciliation", e);
            alert("Error de conexión");
        }
    };

    const filteredReconciliations = reconciliations.filter(r =>
        (r.import_reference && r.import_reference.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (r.username && r.username.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="container-wrapper px-4 pt-4 pb-4">
            <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden flex flex-col">
                <div className="bg-zinc-50/50 p-4 border-b border-zinc-100 flex flex-col md:flex-row justify-between items-center gap-3">
                    <div>
                        <h1 className="text-base font-semibold text-black uppercase tracking-wider">Historial de Conciliaciones de Contenedores (IR)</h1>
                        <p className="text-xs text-zinc-500 mt-0.5">Avance general de las Import References conciliadas en el sistema</p>
                    </div>
                    
                    <div className="flex gap-2 items-center justify-end w-full md:w-auto">
                        <div className="relative w-full md:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-zinc-400 z-10">
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </span>
                            <input
                                type="text"
                                placeholder="BUSCAR CONTENEDOR (IR)..."
                                className="w-full h-9 text-[10px] bg-white border border-zinc-200 rounded-lg outline-none text-black uppercase tracking-wider focus:border-zinc-400 transition-all"
                                style={{ paddingLeft: '32px', paddingRight: searchTerm ? '30px' : '12px' }}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-all z-20 text-[11px] font-medium"
                                    title="Limpiar búsqueda"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        <button
                            onClick={() => refetch()}
                            className="h-9 px-4 text-[11px] text-zinc-700 bg-white border border-zinc-200 rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-widest active:scale-95 transition-all hover:bg-zinc-50"
                            title="Recargar datos"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refrescar
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto min-h-[300px]">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 uppercase tracking-widest text-[11px] gap-3">
                            <span className="animate-spin inline-block w-8 h-8 border-3 border-zinc-300 border-t-zinc-600 rounded-full"></span>
                            Cargando historial de conciliaciones...
                        </div>
                    ) : error ? (
                        <div className="text-center py-20 text-red-500 uppercase tracking-widest text-[11px] font-medium">
                            Error: {error}
                        </div>
                    ) : filteredReconciliations.length === 0 ? (
                        <div className="text-center py-20 text-zinc-400 uppercase tracking-widest text-[11px]">
                            No hay conciliaciones registradas
                        </div>
                    ) : (
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr style={{ background: '#111827' }} className="text-white">
                                    <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider">Import Reference (IR)</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Avance Líneas</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Avance GRNs</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Avance Unidades</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Sin Diferencias</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Faltantes</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Sobrantes</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider">Fecha Registro</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider">Operador</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider">Acc</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredReconciliations.map((recon, idx) => {
                                    const linesPercent = recon.total_lines > 0 
                                        ? Math.round((recon.completed_lines / recon.total_lines) * 100) 
                                        : 0;
                                    const grnsPercent = recon.total_grns > 0 
                                        ? Math.round((recon.completed_grns / recon.total_grns) * 100) 
                                        : 0;
                                    const unitsPercent = recon.expected_units > 0 
                                        ? Math.round((recon.received_units / recon.expected_units) * 100) 
                                        : 0;

                                    return (
                                        <tr key={recon.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'} hover:bg-blue-50 border-b border-gray-100 transition-colors`}>
                                            <td className="px-4 py-3 font-semibold text-sm text-black uppercase tracking-wider">
                                                {recon.import_reference}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex flex-col items-center justify-center min-w-[120px]">
                                                    <span className="font-semibold text-black text-sm">{recon.completed_lines} / {recon.total_lines}</span>
                                                    <div className="w-full bg-zinc-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                                                        <div 
                                                            className="bg-[#1679E0] h-full rounded-full transition-all" 
                                                            style={{ width: `${Math.min(100, linesPercent)}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-[10px] text-zinc-500 font-medium mt-1">{linesPercent}%</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex flex-col items-center justify-center min-w-[120px]">
                                                    <span className="font-semibold text-black text-sm">{recon.completed_grns} / {recon.total_grns}</span>
                                                    <div className="w-full bg-zinc-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                                                        <div 
                                                            className="bg-violet-500 h-full rounded-full transition-all" 
                                                            style={{ width: `${Math.min(100, grnsPercent)}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-[10px] text-zinc-500 font-medium mt-1">{grnsPercent}%</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex flex-col items-center justify-center min-w-[120px]">
                                                    <span className="font-semibold text-black text-sm">{recon.received_units} / {recon.expected_units}</span>
                                                    <div className="w-full bg-zinc-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                                                        <div 
                                                            className="bg-emerald-500 h-full rounded-full transition-all" 
                                                            style={{ width: `${Math.min(100, unitsPercent)}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-[10px] text-zinc-500 font-medium mt-1">{unitsPercent}%</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center font-bold text-sm text-emerald-700">
                                                <span className="px-2 py-1 bg-emerald-50 border border-emerald-100 rounded">
                                                    {recon.ok_lines}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center font-bold text-sm text-red-700">
                                                <span className="px-2 py-1 bg-red-50 border border-red-100 rounded">
                                                    {recon.negative_diff_lines}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center font-bold text-sm text-blue-700">
                                                <span className="px-2 py-1 bg-blue-50 border border-blue-100 rounded">
                                                    {recon.positive_diff_lines}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                                                {formatDate(recon.timestamp)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-800 font-medium uppercase whitespace-nowrap">
                                                {recon.username}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button 
                                                    onClick={() => handleDelete(recon.id)} 
                                                    className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors" 
                                                    title="Eliminar registro"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default IRReconciliation;
