import React, { useState, useEffect, useRef } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';

const ExpressAudit = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
    useEffect(() => { setTitle(t('nav.manual_cycle', 'Ciclo Manual')); }, [setTitle, t, language]);

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
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f8f9fa] min-h-screen text-[#1f1f1f] text-[12px] space-y-3">
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

            <div className="space-y-3">
                {/* Tarjeta Principal de Auditoría Express */}
                <div className="bg-white border border-[#d1d5db] rounded shadow-xs p-4 space-y-3">
                    {/* Encabezado Limpio */}
                    <div className="flex justify-between items-center border-b border-[#e5e7eb] pb-2">
                        <div>
                            <h2 className="text-[14px] font-normal text-gray-800 tracking-normal">
                                Ciclo Manual (Auditoría Express)
                            </h2>
                            <p className="text-[11px] text-gray-500 font-normal">
                                Conteo ciego y verificación rápida de ubicaciones W2W
                            </p>
                        </div>
                        <button
                            onClick={resetAll}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                        >
                            Reiniciar Sesión
                        </button>
                    </div>

                    <div className="space-y-3">
                        {/* Campos Ubicación y SKU */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Ubicación (BIN) */}
                            <div>
                                <label className="text-[11px] font-normal text-gray-700 mb-1 block">
                                    Ubicación (BIN)*
                                </label>
                                <div className="flex items-center">
                                    <input
                                        ref={binRef}
                                        type="text"
                                        value={binLocation}
                                        onChange={(e) => setBinLocation(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => e.key === 'Enter' && itemRef.current?.focus()}
                                        className="h-7 uppercase font-mono font-normal text-[#1f1f1f] text-[12px] flex-grow px-2 border border-[#d1d5db] border-r-0 rounded-l outline-none focus:border-[#0067c0] bg-white"
                                        placeholder="SCAN BIN (EJ. RD72B)"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setScanTarget('bin'); setScannerOpen(true); }}
                                        className="h-7 w-8 border border-[#d1d5db] rounded-r bg-[#f8f9fa] flex items-center justify-center text-gray-700 hover:bg-[#edf3f9] hover:text-[#0067c0] transition-colors cursor-pointer shrink-0"
                                        title="Escanear Código de Ubicación"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Identificación SKU */}
                            <div>
                                <label className="text-[11px] font-normal text-gray-700 mb-1 block">
                                    Identificación (SKU)*
                                </label>
                                <div className="flex items-center gap-1.5">
                                    <div className="flex items-center flex-grow">
                                        <input
                                            ref={itemRef}
                                            type="text"
                                            value={itemCode}
                                            onChange={(e) => handleItemChange(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSearchItem(e.target.value)}
                                            className="h-7 uppercase font-normal text-[#1f1f1f] text-[12px] flex-grow px-2 border border-[#d1d5db] border-r-0 rounded-l outline-none focus:border-[#0067c0] bg-white"
                                            placeholder="SCAN SKU (EJ. 64278542)"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => { setScanTarget('item'); setScannerOpen(true); }}
                                            className="h-7 w-8 border border-[#d1d5db] rounded-r bg-[#f8f9fa] flex items-center justify-center text-gray-700 hover:bg-[#edf3f9] hover:text-[#0067c0] transition-colors cursor-pointer shrink-0"
                                            title="Escanear Código de Artículo"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                            </svg>
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleSearchItem(itemCode)}
                                        disabled={isSearching}
                                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                                    >
                                        {isSearching ? '...' : 'Buscar'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Descripción del Producto */}
                        <div>
                            <label className="text-[11px] font-normal text-gray-700 mb-1 block">
                                Descripción del Producto
                            </label>
                            <div className="bg-[#f8f9fa] h-7 flex items-center px-2 border border-[#d1d5db] rounded text-[12px] font-normal text-gray-800">
                                {itemData ? itemData.description : 'Esperando selección de SKU'}
                            </div>
                        </div>

                        {/* Cantidad Observada & Botón de Guardado */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                            <div>
                                <label className="text-[11px] font-normal text-gray-700 mb-1 block">
                                    Cantidad Observada (Físico)*
                                </label>
                                <div className="flex items-center">
                                    <button
                                        type="button"
                                        onClick={() => setPhysicalQty(prev => Math.max(0, (parseInt(prev || 0) - 1)).toString())}
                                        className="w-7 h-7 border border-[#d1d5db] border-r-0 rounded-l bg-[#f8f9fa] hover:bg-[#f0f0f0] font-normal text-gray-700 flex items-center justify-center select-none cursor-pointer text-sm"
                                    >
                                        -
                                    </button>
                                    <input
                                        ref={qtyRef}
                                        type="number"
                                        value={physicalQty}
                                        onChange={(e) => setPhysicalQty(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                        className="text-center font-normal text-[13px] h-7 flex-grow border-y border-[#d1d5db] outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                                        placeholder="0"
                                        required
                                        min="0"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setPhysicalQty(prev => ((parseInt(prev || 0)) + 1).toString())}
                                        className="w-7 h-7 border border-[#d1d5db] border-l-0 rounded-r bg-[#f8f9fa] hover:bg-[#f0f0f0] font-normal text-gray-700 flex items-center justify-center select-none cursor-pointer text-sm"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving || !itemData}
                                    className="h-7 px-4 w-full bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {isSaving ? "Guardando..." : "Confirmar Registro"}
                                </button>
                            </div>
                        </div>

                        {/* Panel de Análisis de Inventario */}
                        <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                            <h3 className="text-[11px] font-normal text-gray-700">
                                Análisis de Inventario
                            </h3>

                            <div className="grid grid-cols-3 gap-3 bg-[#f8f9fa] border border-[#d1d5db] rounded p-2.5 text-center">
                                <div>
                                    <span className="text-[11px] font-normal text-gray-600 block">
                                        Stock Sistema
                                    </span>
                                    <div className="text-base font-normal text-gray-900 mt-0.5">
                                        {itemData?.system_qty ?? 0}
                                    </div>
                                </div>

                                <div>
                                    <span className="text-[11px] font-normal text-gray-600 block">
                                        Auditoría Física
                                    </span>
                                    <div className="text-base font-normal text-gray-900 mt-0.5">
                                        {physicalQty === '' ? 0 : physicalQty}
                                    </div>
                                </div>

                                <div>
                                    <span className="text-[11px] font-normal text-gray-600 block">
                                        Diferencia
                                    </span>
                                    <div className={`text-base font-normal mt-0.5 ${difference > 0 ? 'text-[#0067c0]' : difference < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {difference > 0 ? `+${difference}` : difference}
                                    </div>
                                </div>
                            </div>

                            {/* Estado de Ubicación */}
                            {itemData && binLocation && (
                                <div className={`p-2 rounded border flex items-center ${binLocation.toUpperCase() === itemData.system_bin?.toUpperCase()
                                        ? 'bg-green-50 border-green-200 text-green-800'
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                    }`}>
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-normal">
                                            {binLocation.toUpperCase() === itemData.system_bin?.toUpperCase()
                                                ? 'Ubicación Correcta'
                                                : 'Discrepancia de Ubicación Detectada'}
                                        </span>
                                        {binLocation.toUpperCase() !== itemData.system_bin?.toUpperCase() && (
                                            <span className="text-[11px] font-normal mt-0.5">
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
                <div className="bg-white border border-[#d1d5db] rounded shadow-xs overflow-hidden">
                    <div className="bg-[#354a5f] text-white px-3 py-2 flex justify-between items-center border-b border-[#2a3c4e]">
                        <h2 className="text-[12px] font-normal text-white">
                            Historial de Auditorías Recientes
                        </h2>
                    </div>

                    <div className="overflow-x-auto max-h-[380px]">
                        <table className="w-full text-[11.5px] border-collapse">
                            <thead className="bg-[#354a5f] text-white sticky top-0 border-b border-[#2a3c4e]">
                                <tr>
                                    <th className="px-3 py-2 text-left font-normal">Fecha / Hora</th>
                                    <th className="px-3 py-2 text-left font-normal">Usuario</th>
                                    <th className="px-3 py-2 text-center font-normal">BIN</th>
                                    <th className="px-3 py-2 text-left font-normal">SKU / Artículo</th>
                                    <th className="px-3 py-2 text-center font-normal">Físico</th>
                                    <th className="px-3 py-2 text-center font-normal">Delta</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentAudits.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="px-4 py-8 text-center text-gray-500 font-normal text-[12px]">
                                            No se han registrado auditorías recientes en esta sesión
                                        </td>
                                    </tr>
                                ) : (
                                    recentAudits.map((audit, idx) => (
                                        <tr key={audit.id || idx} className={`border-b border-[#f0f0f0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#edf3f9] transition-colors`}>
                                            <td className="px-3 py-2 text-gray-600 font-mono text-[11px] font-normal">{formatDate(audit.executed_date)}</td>
                                            <td className="px-3 py-2 text-gray-800 font-normal">{audit.username || 'Sistema'}</td>
                                            <td className="px-3 py-2 text-center font-mono font-normal">{audit.bin_location}</td>
                                            <td className="px-3 py-2 font-normal">
                                                <div className="font-mono text-[12px] text-[#0067c0]">{audit.item_code}</div>
                                                {audit.item_description && (
                                                    <div className="text-[11px] text-gray-600 font-normal truncate max-w-[300px]">
                                                        {audit.item_description}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-center font-mono font-normal text-[12px]">{audit.physical_qty}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`font-mono font-normal text-[11.5px] ${audit.difference > 0
                                                        ? 'text-[#0067c0]'
                                                        : audit.difference < 0
                                                            ? 'text-red-600'
                                                            : 'text-emerald-600'
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
