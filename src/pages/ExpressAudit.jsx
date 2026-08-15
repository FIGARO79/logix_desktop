import React, { useState, useEffect, useRef } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';

const ExpressAudit = () => {
    const { setTitle } = useOutletContext();
    useEffect(() => { setTitle("Ciclo Manual"); }, [setTitle]);

    const [binLocation, setBinLocation] = useState('');
    const [itemCode, setItemCode] = useState('');
    const [itemData, setItemData] = useState(null);
    const [physicalQty, setPhysicalQty] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [recentAudits, setRecentAudits] = useState([]);

    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanTarget, setScanTarget] = useState(null);

    const binRef = useRef(null);
    const itemRef = useRef(null);
    const qtyRef = useRef(null);

    useEffect(() => {
        fetchRecentAudits();
    }, []);

    const fetchRecentAudits = async () => {
        try {
            const res = await fetch('/api/express_audit/recordings');
            if (res.ok) {
                const data = await res.json();
                setRecentAudits(data.slice(0, 10));
            }
        } catch (e) { console.error(e); }
    };

    const handleSearchItem = async (codeToSearch) => {
        const code = codeToSearch || itemCode;
        if (!code) return;
        setIsSearching(true);
        try {
            const res = await fetch(`/api/express_audit/find/${encodeURIComponent(code)}`);
            if (res.ok) {
                const data = await res.json();
                setItemData({
                    item_code: data.item_code,
                    description: data.description,
                    system_qty: data.system_qty,
                    system_bin: data.system_bin,
                    abc_code: data.abc_code
                });
                setItemCode(data.item_code);
                setTimeout(() => qtyRef.current?.focus(), 100);
            } else {
                toast.warn("Artículo no encontrado en el catálogo");
                setItemData(null);
            }
        } catch (e) { toast.error("Error de conexión al buscar artículo"); }
        finally { setIsSearching(false); }
    };

    const handleItemChange = (val) => {
        const upperVal = val.toUpperCase();
        const prevVal = itemCode;
        setItemCode(upperVal);
        if (upperVal.length > prevVal.length + 3) {
            handleSearchItem(upperVal);
        }
    };

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        if (!binLocation || !itemCode || physicalQty === '' || !itemData) {
            toast.warning("Complete todos los campos obligatorios antes de confirmar");
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/express_audit/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_code: itemData.item_code,
                    item_description: itemData.description,
                    bin_location: binLocation.toUpperCase(),
                    system_qty: itemData.system_qty,
                    physical_qty: parseInt(physicalQty || 0),
                    abc_code: itemData.abc_code,
                    executed_date: new Date().toISOString()
                })
            });

            if (res.ok) {
                toast.success("Auditoría registrada exitosamente");
                resetForm();
                fetchRecentAudits();
            } else {
                toast.error("Error al registrar la auditoría");
            }
        } catch (e) { toast.error("Error de conexión al guardar"); }
        finally { setIsSaving(false); }
    };

    const resetForm = () => {
        setItemCode(''); setItemData(null); setPhysicalQty('');
        setTimeout(() => itemRef.current?.focus(), 100);
    };

    const resetAll = () => {
        setBinLocation(''); resetForm();
        setTimeout(() => binRef.current?.focus(), 100);
    };

    const handleScan = (code) => {
        if (scanTarget === 'bin') {
            setBinLocation(code.toUpperCase());
            itemRef.current?.focus();
        } else {
            setItemCode(code.toUpperCase());
            setTimeout(() => handleSearchItem(code.toUpperCase()), 100);
        }
        setScannerOpen(false);
    };

    const difference = itemData ? (parseInt(physicalQty || 0) - itemData.system_qty) : 0;

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleString('es-CO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="container-wrapper max-w-6xl mx-auto px-4 py-4 space-y-4">
            <ToastContainer position="top-right" autoClose={2000} />

            <style>{`
                input[type=number]::-webkit-inner-spin-button,
                input[type=number]::-webkit-outer-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
                input[type=number] {
                    -moz-appearance: textfield;
                }
            `}</style>

            <div className="space-y-4">

                {/* Tarjeta Principal de Auditoría Express */}
                <div className="bg-white border border-gray-200 shadow rounded-lg overflow-hidden p-6 space-y-4">

                    {/* Encabezado Limpio */}
                    <div className="flex justify-between items-center border-b pb-3">
                        <div>
                            <h2 className="text-[12px] font-normal text-gray-900 text-gray-800 uppercase tracking-tight">
                                Ciclo Manual (Auditoría Express)
                            </h2>
                            <p className="text-[10px] text-gray-500 uppercase font-medium text-gray-900">
                                Conteo ciego y verificación rápida de ubicaciones W2W
                            </p>
                        </div>
                        <button
                            onClick={resetAll}
                            className="btn-sap btn-secondary text-xs font-medium text-gray-900 uppercase h-[36px] px-4"
                        >
                            Reiniciar Sesión
                        </button>
                    </div>

                    <div className="space-y-4">

                        {/* Campos Ubicación y SKU */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Ubicación (BIN) */}
                            <div>
                                <label className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600">
                                    Ubicación (BIN)*
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={binRef}
                                        type="text"
                                        value={binLocation}
                                        onChange={(e) => setBinLocation(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => e.key === 'Enter' && itemRef.current?.focus()}
                                        className="uppercase font-medium text-gray-900 text-[#1e4a74] h-[40px] flex-grow px-3 border rounded"
                                        placeholder="SCAN BIN (EJ. RD72B)"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setScanTarget('bin'); setScannerOpen(true); }}
                                        className="btn-sap btn-secondary h-[30px] w-[30px] !p-0 flex items-center justify-center shrink-0"
                                        title="Escanear Código de Ubicación"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Identificación SKU */}
                            <div>
                                <label className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600">
                                    Identificación (SKU)*
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={itemRef}
                                        type="text"
                                        value={itemCode}
                                        onChange={(e) => handleItemChange(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearchItem(e.target.value)}
                                        className="uppercase font-medium text-gray-900 text-[#1e4a74] h-[30px] flex-grow px-3 border rounded"
                                        placeholder="SCAN SKU (EJ. 64278542)"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setScanTarget('item'); setScannerOpen(true); }}
                                        className="btn-sap btn-secondary h-[30px] w-[30px] !p-0 flex items-center justify-center shrink-0"
                                        title="Escanear Código de Artículo"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSearchItem(itemCode)}
                                        disabled={isSearching}
                                        className="btn-sap btn-secondary h-[30px] px-4 font-medium text-gray-900 text-[10px] uppercase shrink-0"
                                    >
                                        {isSearching ? '...' : 'Buscar'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Descripción del Producto */}
                        <div>
                            <label className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600">
                                Descripción del Producto
                            </label>
                            <div className="data-field bg-gray-50 h-[40px] flex items-center px-3 border rounded text-xs font-medium text-gray-900 text-gray-700 uppercase">
                                {itemData ? itemData.description : '— ESPERANDO SKU —'}
                            </div>
                        </div>

                        {/* Cantidad Observada & Botón de Guardado */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            <div>
                                <label className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600">
                                    Cantidad Observada (Físico)*
                                </label>
                                <div className="flex items-center">
                                    <button
                                        type="button"
                                        onClick={() => setPhysicalQty(prev => Math.max(0, (parseInt(prev || 0) - 1)).toString())}
                                        className="w-[30px] h-[30px] border bg-gray-100 font-medium text-gray-900 flex items-center justify-center select-none"
                                    >
                                        -
                                    </button>
                                    <input
                                        ref={qtyRef}
                                        type="number"
                                        value={physicalQty}
                                        onChange={(e) => setPhysicalQty(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                        className="text-center font-medium text-gray-900 text-lg h-[30px] flex-grow border-y border-gray-300"
                                        placeholder="0"
                                        required
                                        min="0"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setPhysicalQty(prev => ((parseInt(prev || 0)) + 1).toString())}
                                        className="w-[30px] h-[30px] border bg-gray-100 font-medium text-gray-900 flex items-center justify-center select-none"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving || !itemData}
                                    className="btn-sap btn-primary h-[30px] px-8 w-full text-[10px] font-medium text-gray-900 uppercase tracking-widest"
                                >
                                    {isSaving ? "Guardando..." : "Confirmar Registro"}
                                </button>
                            </div>
                        </div>

                        {/* Panel de Análisis de Inventario */}
                        <div className="pt-4 border-t space-y-3">
                            <h3 className="font-medium text-gray-900 text-[10px] text-gray-700 uppercase tracking-wider">
                                Análisis de Inventario
                            </h3>

                            <div className="grid grid-cols-3 gap-4 bg-gray-50 border rounded-lg p-3 text-center">
                                <div>
                                    <span className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600 block">
                                        Stock Sistema
                                    </span>
                                    <div className="text-xl font-medium text-gray-900 text-gray-900 mt-1">
                                        {itemData?.system_qty ?? 0}
                                    </div>
                                </div>

                                <div>
                                    <span className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600 block">
                                        Auditoría Física
                                    </span>
                                    <div className="text-xl font-medium text-gray-900 text-gray-900 mt-1">
                                        {physicalQty === '' ? 0 : physicalQty}
                                    </div>
                                </div>

                                <div>
                                    <span className="form-label text-[10px] font-medium text-gray-900 uppercase text-gray-600 block">
                                        Diferencia
                                    </span>
                                    <div className={`text-xl font-medium text-gray-900 mt-1 ${difference > 0 ? 'text-blue-700' : difference < 0 ? 'text-red-700' : 'text-emerald-700'
                                        }`}>
                                        {difference > 0 ? `+${difference}` : difference}
                                    </div>
                                </div>
                            </div>

                            {/* Estado de Ubicación */}
                            {itemData && binLocation && (
                                <div className={`p-3 rounded border flex items-center ${binLocation.toUpperCase() === itemData.system_bin?.toUpperCase()
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                                        : 'bg-red-50 border-red-200 text-red-950'
                                    }`}>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-medium text-gray-900 uppercase tracking-wider leading-tight">
                                            {binLocation.toUpperCase() === itemData.system_bin?.toUpperCase()
                                                ? 'Ubicación Correcta'
                                                : 'Discrepancia de Ubicación Detectada'}
                                        </span>
                                        {binLocation.toUpperCase() !== itemData.system_bin?.toUpperCase() && (
                                            <span className="text-[10px] font-medium text-gray-900 uppercase mt-0.5">
                                                Ubicación Principal en Sistema: {itemData.system_bin || 'NO DEFINIDA'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tarjeta de Historial Reciente */}
                <div className="bg-white border border-gray-200 shadow rounded-lg overflow-hidden p-6">
                    <div className="flex justify-between items-center border-b pb-3 mb-4">
                        <h2 className="text-[12px] font-normal text-gray-900 text-gray-800 uppercase tracking-tight">
                            Historial de Auditorías Recientes
                        </h2>
                    </div>

                    <div className="overflow-x-auto max-h-[380px]">
                        <table className="w-full text-xs border-collapse">
                            <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider">Fecha / Hora</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider">Usuario</th>
                                    <th className="px-4 py-2.5 text-center text-[10px] font-medium uppercase tracking-wider">BIN</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider">SKU / Artículo</th>
                                    <th className="px-4 py-2.5 text-center text-[10px] font-medium uppercase tracking-wider">Físico</th>
                                    <th className="px-4 py-2.5 text-center text-[10px] font-medium uppercase tracking-wider">Delta</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {recentAudits.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="px-4 py-12 text-center text-gray-400 uppercase tracking-widest text-[11px] font-medium text-gray-900">
                                            No se han registrado auditorías recientes en esta sesión
                                        </td>
                                    </tr>
                                ) : (
                                    recentAudits.map((audit, idx) => (
                                        <tr key={audit.id || idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                                            <td className="px-4 py-2.5 text-gray-600 font-mono text-[11px]">{formatDate(audit.executed_date)}</td>
                                            <td className="px-4 py-2.5 text-gray-800 font-medium text-gray-900 uppercase">{audit.username || 'Sistema'}</td>
                                            <td className="px-4 py-2.5 text-center font-medium text-gray-900">{audit.bin_location}</td>
                                            <td className="px-4 py-2.5 font-medium text-gray-900 text-[#1e4a74]">
                                                <div className="font-mono text-xs">{audit.item_code}</div>
                                                {audit.item_description && (
                                                    <div className="text-[10px] text-gray-500 font-normal truncate max-w-[300px]">
                                                        {audit.item_description}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5 text-center font-medium text-gray-900 font-mono text-sm">{audit.physical_qty}</td>
                                            <td className="px-4 py-2.5 text-center">
                                                <span className={`font-mono font-medium text-gray-900 text-xs ${audit.difference > 0
                                                        ? 'text-blue-700'
                                                        : audit.difference < 0
                                                            ? 'text-red-700'
                                                            : 'text-emerald-700'
                                                    }`}>
                                                    {audit.difference > 0 ? `+${audit.difference}` : audit.difference}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {scannerOpen && <ScannerModal onScan={handleScan} onClose={() => setScannerOpen(false)} />}
        </div>
    );
};

export default ExpressAudit;
