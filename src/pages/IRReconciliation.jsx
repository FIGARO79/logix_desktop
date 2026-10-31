import { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cacheData, getCachedData } from '../utils/offlineDb';

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
            try {
                const res = await fetch('/api/inbound/ir_reconciliation', { credentials: 'include' }).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json().catch(() => null);
                    if (data) {
                        await cacheData('ir_reconciliations', data);
                        return data;
                    }
                }
            } catch (e) {
                console.log("No API server for IR reconciliations, falling back to local cache.");
            }
            const cached = await getCachedData('ir_reconciliations');
            return cached || [];
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
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f] text-[12px]">
            <div className="bg-white border border-[#d1d5db] rounded shadow-sm overflow-hidden flex flex-col">
                <div className="bg-[#f8f9fa] p-3 border-b border-[#d1d5db] flex flex-col md:flex-row justify-between items-center gap-2">
                    <div>
                        <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Historial de Conciliaciones de Contenedores (IR)</h1>
                        <p className="text-[11px] text-[#5c5c5c] mt-0.5 mb-0 font-normal">Avance general de las Import References conciliadas en el sistema</p>
                    </div>
                    
                    <div className="flex gap-2 items-center justify-end w-full md:w-auto">
                        <div className="relative w-full md:w-60">
                            <input
                                type="text"
                                placeholder="Buscar contenedor (IR)..."
                                className="w-full h-7 text-[12px] bg-white border border-[#d1d5db] rounded px-2 outline-none text-[#1f1f1f] uppercase focus:border-[#0067c0] transition-colors"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-[#8c8c8c] hover:text-[#1f1f1f] transition-colors text-[11px] cursor-pointer"
                                    title="Limpiar búsqueda"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        <button
                            onClick={() => refetch()}
                            className="h-7 px-3 text-[12px] text-[#1f1f1f] bg-white border border-[#d1d5db] rounded shadow-xs flex items-center gap-1.5 transition-colors hover:bg-[#f5f5f5] cursor-pointer font-normal"
                            title="Recargar datos"
                        >
                            Refrescar
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto min-h-[300px]">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 text-[#5c5c5c] text-[12px] gap-2 font-normal">
                            Cargando historial de conciliaciones...
                        </div>
                    ) : error ? (
                        <div className="text-center py-16 text-[#991b1b] text-[12px] font-normal">
                            Error: {error}
                        </div>
                    ) : filteredReconciliations.length === 0 ? (
                        <div className="text-center py-16 text-[#8c8c8c] text-[12px] font-normal">
                            No hay conciliaciones registradas
                        </div>
                    ) : (
                        <table className="w-full text-[12px] border-collapse">
                            <thead>
                                <tr className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal border-b border-[#2a3c4e] sticky top-0 z-10">
                                    <th className="px-3 py-1.5 text-left font-normal">Import Reference (IR)</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Avance Líneas</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Avance GRNs</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Avance Unidades</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Sin Diferencias</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Faltantes</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Sobrantes</th>
                                    <th className="px-3 py-1.5 text-left font-normal">Fecha Registro</th>
                                    <th className="px-3 py-1.5 text-left font-normal">Operador</th>
                                    <th className="px-3 py-1.5 text-center font-normal">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e5e7eb]">
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
                                        <tr key={recon.id} className={`${idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'} hover:bg-[#edf3f9] transition-colors leading-none h-7`}>
                                            <td className="px-3 py-1 text-[11.5px] font-normal text-[#0067c0] uppercase">
                                                {recon.import_reference}
                                            </td>
                                            <td className="px-3 py-1 text-center">
                                                <div className="flex flex-col items-center justify-center min-w-[100px]">
                                                    <span className="text-[11px] font-normal text-[#1f1f1f]">{recon.completed_lines} / {recon.total_lines}</span>
                                                    <div className="w-full bg-[#e5e7eb] h-1.5 rounded-full mt-1 overflow-hidden">
                                                        <div 
                                                            className="bg-[#0067c0] h-full rounded-full transition-all" 
                                                            style={{ width: `${Math.min(100, linesPercent)}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-1 text-center">
                                                <div className="flex flex-col items-center justify-center min-w-[100px]">
                                                    <span className="text-[11px] font-normal text-[#1f1f1f]">{recon.completed_grns} / {recon.total_grns}</span>
                                                    <div className="w-full bg-[#e5e7eb] h-1.5 rounded-full mt-1 overflow-hidden">
                                                        <div 
                                                            className="bg-[#7c3aed] h-full rounded-full transition-all" 
                                                            style={{ width: `${Math.min(100, grnsPercent)}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-1 text-center">
                                                <div className="flex flex-col items-center justify-center min-w-[100px]">
                                                    <span className="text-[11px] font-normal text-[#1f1f1f]">{recon.received_units} / {recon.expected_units}</span>
                                                    <div className="w-full bg-[#e5e7eb] h-1.5 rounded-full mt-1 overflow-hidden">
                                                        <div 
                                                            className="bg-[#059669] h-full rounded-full transition-all" 
                                                            style={{ width: `${Math.min(100, unitsPercent)}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-1 text-center font-normal text-[11.5px] text-[#065f46]">
                                                {recon.ok_lines}
                                            </td>
                                            <td className="px-3 py-1 text-center font-normal text-[11.5px] text-[#991b1b]">
                                                {recon.negative_diff_lines}
                                            </td>
                                            <td className="px-3 py-1 text-center font-normal text-[11.5px] text-[#0067c0]">
                                                {recon.positive_diff_lines}
                                            </td>
                                            <td className="px-3 py-1 text-[11px] text-[#5c5c5c] whitespace-nowrap font-normal">
                                                {formatDate(recon.timestamp)}
                                            </td>
                                            <td className="px-3 py-1 text-[11px] text-[#1f1f1f] font-normal uppercase whitespace-nowrap">
                                                {recon.username}
                                            </td>
                                            <td className="px-3 py-1 text-center">
                                                <button 
                                                    onClick={() => handleDelete(recon.id)} 
                                                    className="h-6 px-2 text-[#8c8c8c] hover:text-[#991b1b] hover:bg-[#fef2f2] rounded transition-colors text-[11px] cursor-pointer" 
                                                    title="Eliminar registro"
                                                >
                                                    Eliminar
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
