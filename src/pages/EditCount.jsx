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

    if (loading) return <div className="p-8 text-slate-500 font-medium">Cargando datos del conteo...</div>;
    if (error) return <div className="p-8 text-red-600 font-medium">Error: {error}</div>;
    if (!count) return <div className="p-8 text-slate-500 font-medium">Registro de conteo no encontrado.</div>;

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="bg-white shadow rounded-lg p-6 border border-slate-200">
                <h1 className="text-2xl font-bold text-slate-900 mb-6">Editar Conteo #{id}</h1>

                <div className="grid grid-cols-2 gap-4 mb-6 text-sm text-slate-600 bg-slate-50 p-4 rounded-md border border-slate-100">
                    <div>
                        <span className="font-semibold text-slate-900">Item:</span> {count.item_code}
                    </div>
                    <div>
                        <span className="font-semibold text-slate-900">Sesión:</span> {count.session_id}
                    </div>
                    <div className="col-span-2">
                        <span className="font-semibold text-slate-900">Descripción:</span> {count.item_description || 'N/A'}
                    </div>
                    <div>
                        <span className="font-semibold text-slate-900">Ubicación:</span> {count.counted_location}
                    </div>
                </div>

                <form onSubmit={handleSave}>
                    <div className="mb-6">
                        <label className="block text-slate-700 font-semibold mb-2">Cantidad Contada</label>
                        <input
                            type="number"
                            step="any"
                            value={countedQty}
                            onChange={(e) => setCountedQty(e.target.value)}
                            className="w-full border border-slate-300 p-2.5 rounded-lg text-lg focus:ring-2 focus:ring-[#285f94] focus:outline-none"
                            required
                        />
                    </div>

                    <div className="flex justify-end gap-4">
                        <button
                            type="button"
                            onClick={() => navigate('/counts/manage')}
                            className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 font-medium transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="bg-[#285f94] text-white px-6 py-2 rounded-lg hover:bg-[#1e4a74] font-medium transition-colors"
                        >
                            Guardar Cambios
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditCount;
