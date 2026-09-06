import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTabContext } from '../hooks/useTabContext';

const EditCount = ({ id: propId }) => {
    const { id: paramId } = useParams();
    const navigate = useNavigate();
    const id = propId || paramId;
    const { setTitle } = useTabContext() || {};

    const [count, setCount] = useState(null);
    const [countedQty, setCountedQty] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!id || id === 'undefined') return;
        const fetchCount = async () => {
            try {
                const res = await fetch(`/api/counts/${id}`);
                if (!res.ok) throw new Error("Conteo no encontrado");
                const data = await res.json();
                setCount(data);
                setCountedQty(data.counted_qty);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchCount();
        if (setTitle) setTitle(`Editar Conteo #${id}`);
    }, [id]);

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`/api/counts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ counted_qty: parseFloat(countedQty) })
            });
            if (!res.ok) throw new Error("Error al actualizar el conteo");

            navigate('/counts/manage');
        } catch (err) {
            setError(err.message);
        }
    };

    if (loading) return <div className="p-8 text-[#5c5c5c] font-normal text-[12px] font-['Segoe_UI',Tahoma,sans-serif]">Cargando datos del conteo...</div>;
    if (error) return <div className="p-8 text-[#991b1b] font-normal text-[12px] font-['Segoe_UI',Tahoma,sans-serif]">Error: {error}</div>;
    if (!count) return <div className="p-8 text-[#5c5c5c] font-normal text-[12px] font-['Segoe_UI',Tahoma,sans-serif]">Registro de conteo no encontrado.</div>;

    return (
        <div className="max-w-xl mx-auto px-4 py-6 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f]">
            <div className="bg-white shadow-sm rounded border border-[#d1d5db] overflow-hidden">
                <div className="bg-[#354a5f] text-white px-4 py-2.5">
                    <h1 className="text-[13px] font-normal text-white m-0">Editar Conteo #{id}</h1>
                </div>

                <div className="p-4">
                    <div className="grid grid-cols-2 gap-3 mb-4 text-[12px] bg-[#f8f9fa] p-3 rounded border border-[#e5e7eb]">
                        <div>
                            <span className="text-[#5c5c5c] block text-[10px]">Item:</span>
                            <span className="text-[#0067c0] font-normal">{count.item_code}</span>
                        </div>
                        <div>
                            <span className="text-[#5c5c5c] block text-[10px]">Sesión:</span>
                            <span className="text-[#1f1f1f] font-normal">{count.session_id}</span>
                        </div>
                        <div className="col-span-2">
                            <span className="text-[#5c5c5c] block text-[10px]">Descripción:</span>
                            <span className="text-[#1f1f1f] font-normal">{count.item_description || 'N/A'}</span>
                        </div>
                        <div>
                            <span className="text-[#5c5c5c] block text-[10px]">Ubicación:</span>
                            <span className="text-[#1f1f1f] font-mono font-normal">{count.counted_location}</span>
                        </div>
                    </div>

                    <form onSubmit={handleSave}>
                        <div className="mb-4">
                            <label className="block text-[#5c5c5c] text-[11px] font-normal mb-1">Cantidad Contada</label>
                            <input
                                type="number"
                                step="any"
                                value={countedQty}
                                onChange={(e) => setCountedQty(e.target.value)}
                                className="w-full h-8 border border-[#d1d5db] px-2.5 rounded text-[13px] font-normal text-[#1f1f1f] focus:border-[#0067c0] focus:outline-none bg-white"
                                required
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
                            <button
                                type="button"
                                onClick={() => navigate('/counts/manage')}
                                className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal transition-colors shadow-sm cursor-pointer"
                            >
                                Guardar Cambios
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default EditCount;
