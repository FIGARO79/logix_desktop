import { useState, useEffect, useRef, useCallback } from 'react';
import { useTabContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';
import { useOffline } from '../hooks/useOffline';
import { getDB, savePendingSync, cacheData, getCachedData } from '../utils/offlineDb';
import { parseGS1Barcode } from '../utils/gs1Parser';

const SpotCheck = () => {
    const context = useTabContext();
    const setTitle = context ? context.setTitle : null;
    const navigate = useNavigate();
    const { isOnline } = useOffline();
    const { t, language } = useLanguage();

    useEffect(() => {
        if (setTitle) setTitle(t('nav.spot_check', 'Spot Check'));
    }, [setTitle, t, language]);

    const [binLocation, setBinLocation] = useState('');
    const [itemCode, setItemCode] = useState('');
    const [itemData, setItemData] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [physicalQty, setPhysicalQty] = useState('');
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [recentChecks, setRecentChecks] = useState([]);

    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanTarget, setScanTarget] = useState(null);

    const binRef = useRef(null);
    const itemRef = useRef(null);
    const qtyRef = useRef(null);

    const fetchRecentChecks = useCallback(async () => {
        try {
            if (isOnline) {
                const res = await fetch('/api/spot_check/list');
                if (res.ok) {
                    const data = await res.json();
                    setRecentChecks(data);
                    await cacheData('recent_spot_checks', data);
                }
            } else {
                const cached = await getCachedData('recent_spot_checks');
                if (cached) setRecentChecks(cached);
            }
        } catch (e) { console.error("Error al cargar historial", e); }
    }, [isOnline]);

    useEffect(() => {
        fetchRecentChecks();
    }, [fetchRecentChecks]);

    const handleSearchItem = async (query) => {
        let q = (query || itemCode || '').trim().toUpperCase();
        if (!q) return;

        const gs1 = parseGS1Barcode(q);
        if ((gs1.isGS1 || gs1.isMultiField) && gs1.itemCode) {
            q = gs1.itemCode.trim().toUpperCase();
            setItemCode(q);
        }

        setLoading(true);
        setItemData(null);
        setSearchResults([]);
        
        try {
            if (isOnline) {
                const res = await fetch(`/api/spot_check/find/${encodeURIComponent(q)}`);
                if (res.ok) {
                    const data = await res.json();
                    setItemData({
                        item_code: data.item_code,
                        description: data.description,
                        system_bin: data.system_bin || 'N/A',
                        additional_locations: data.additional_locations || ''
                    });
                    setItemCode(data.item_code);
                    setTimeout(() => qtyRef.current?.focus(), 100);
                } else {
                    const searchRes = await fetch(`/api/search_items?q=${encodeURIComponent(q)}`);
                    if (searchRes.ok) {
                        const data = await searchRes.json();
                        if (data.length === 0) {
                            toast.warn("Item no encontrado");
                        } else if (data.length === 1) {
                            const item = data[0];
                            setItemData({
                                item_code: item.itemCode,
                                description: item.description,
                                system_bin: item.binLocation || item.bin_1 || 'N/A',
                                additional_locations: item.aditionalBins || ''
                            });
                            setItemCode(item.itemCode);
                            setTimeout(() => qtyRef.current?.focus(), 100);
                        } else {
                            setSearchResults(data);
                        }
                    } else {
                        toast.error("Error en la búsqueda");
                    }
                }
            } else {
                // Modo Offline: buscar en IndexedDB master_items
                const db = await getDB();
                const tx = db.transaction('master_items', 'readonly');
                const store = tx.objectStore('master_items');
                
                const exactMatch = await store.get(q);
                if (exactMatch) {
                    setItemData({
                        item_code: exactMatch.Item_Code,
                        description: exactMatch.Item_Description,
                        system_bin: exactMatch.Bin_1 || 'N/A',
                        additional_locations: exactMatch.Aditional_Bin_Location || ''
                    });
                    setItemCode(exactMatch.Item_Code);
                    setTimeout(() => qtyRef.current?.focus(), 100);
                } else {
                    const allItems = await store.getAll();
                    const filtered = allItems.filter(i => 
                        i.Item_Code.includes(q) || 
                        (i.Item_Description && i.Item_Description.toUpperCase().includes(q))
                    ).slice(0, 10);

                    if (filtered.length === 0) {
                        toast.warn("Item no encontrado en maestro local");
                    } else if (filtered.length === 1) {
                        setItemData({
                            item_code: filtered[0].Item_Code,
                            description: filtered[0].Item_Description,
                            system_bin: filtered[0].Bin_1 || 'N/A',
                            additional_locations: filtered[0].Aditional_Bin_Location || ''
                        });
                        setItemCode(filtered[0].Item_Code);
                        setTimeout(() => qtyRef.current?.focus(), 100);
                    } else {
                        setSearchResults(filtered.map(f => ({
                            itemCode: f.Item_Code,
                            description: f.Item_Description,
                            system_bin: f.Bin_1 || 'N/A',
                            additional_locations: f.Aditional_Bin_Location || ''
                        })));
                    }
                }
            }
        } catch (e) { toast.error("Error de conexión"); }
        finally { setLoading(false); }
    };

    const selectItemFromResult = (item) => {
        setItemData({
            item_code: item.itemCode,
            description: item.description,
            system_bin: item.system_bin || item.binLocation || 'N/A',
            additional_locations: item.additional_locations || item.aditionalBins || ''
        });
        setItemCode(item.itemCode);
        setSearchResults([]);
        setTimeout(() => qtyRef.current?.focus(), 100);
    };

    const clearForm = () => {
        setItemCode('');
        setItemData(null);
        setPhysicalQty('');
        setSearchResults([]);
        setTimeout(() => itemRef.current?.focus(), 100);
    };

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        if (!binLocation || !itemCode || !physicalQty || !itemData) {
            toast.warning("Complete todos los campos");
            return;
        }

        const payload = {
            bin_location: binLocation.toUpperCase(),
            system_bin: (itemData.system_bin || 'N/A').toUpperCase(),
            item_code: itemData.item_code,
            item_description: itemData.description,
            quantity: parseInt(physicalQty),
            timestamp: new Date().toISOString()
        };

        setIsSaving(true);
        try {
            const db = await getDB();
            const record = {
                id: crypto.randomUUID(),
                ...payload,
                username: 'Local',
                timestamp: new Date().toISOString()
            };

            await db.put('local_spot_check', record);
            toast.success("Hallazgo registrado en la base de datos local");
            clearForm();
            setRecentChecks(prev => [record, ...prev]);

        } catch (e) {
            console.error("Error al guardar spot check local:", e);
            toast.error("Error al guardar hallazgo");
            clearForm();
        } finally {
            setIsSaving(false);
        }
    };

    const handleClearTable = async () => {
        const password = prompt("Ingrese su contraseña para confirmar la limpieza de la tabla:");
        if (!password) return;

        try {
            const res = await fetch('/api/spot_check/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                toast.success("Tabla limpiada correctamente");
                fetchRecentChecks();
            } else {
                const err = await res.json();
                toast.error(err.detail || "Error al limpiar la tabla");
            }
        } catch (e) { toast.error("Error de conexión"); }
    };

    const handleExport = () => {
        window.location.href = '/api/spot_check/export';
    };

    const handleScan = (code) => {
        const text = code.toUpperCase();
        if (scanTarget === 'bin') {
            setBinLocation(text);
            // Salto automático al campo de ítem tras escanear ubicación
            setTimeout(() => itemRef.current?.focus(), 150);
        } else {
            setItemCode(text);
            handleSearchItem(text);
        }
        setScannerOpen(false);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    };

    const scannerIcon = (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
        </svg>
    );

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f8f9fa] min-h-screen text-[#1f1f1f] text-[12px]">
            <ToastContainer position="top-right" autoClose={2000} />

            <div className="mb-3 border-b border-[#e5e7eb] pb-2 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <h1 className="text-[14px] font-normal text-gray-800 tracking-normal">Spot Check (Inspección Rápida)</h1>
                    {!isOnline && <span className="text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 font-normal">Modo Offline</span>}
                </div>
                <button
                    onClick={() => navigate('/stock')}
                    className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                >
                    Stock
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1">
                    <div className="bg-white border border-[#d1d5db] rounded shadow-xs p-4 space-y-4 sticky top-20">
                        <style>{`input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}`}</style>

                        <div>
                            <label className="text-[11px] font-normal text-gray-700 mb-1 block">Ubicación (BIN)</label>
                            <div className="flex">
                                <input
                                    ref={binRef}
                                    type="text"
                                    value={binLocation}
                                    onChange={(e) => setBinLocation(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === 'Enter' && itemRef.current?.focus()}
                                    className="flex-1 h-7 px-2 border border-[#d1d5db] border-r-0 rounded-l font-mono font-normal text-[#1f1f1f] text-[12px] outline-none focus:border-[#0067c0] bg-white"
                                    placeholder="BIN"
                                />
                                <button
                                    onClick={() => { setScanTarget('bin'); setScannerOpen(true); }}
                                    className="shrink-0 h-7 w-8 border border-[#d1d5db] rounded-r bg-[#f8f9fa] flex items-center justify-center text-gray-700 hover:bg-[#edf3f9] hover:text-[#0067c0] transition-colors cursor-pointer"
                                    title="Escanear"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-normal text-gray-700 mb-1 block">Código o Descripción</label>
                            <div className="flex">
                                <input
                                    ref={itemRef}
                                    type="text"
                                    value={itemCode}
                                    onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearchItem()}
                                    className="flex-1 h-7 px-2 border border-[#d1d5db] border-r-0 rounded-l font-normal text-[#1f1f1f] text-[12px] outline-none focus:border-[#0067c0] bg-white"
                                    placeholder="SKU o Descripción"
                                />
                                <button
                                    onClick={() => { setScanTarget('item'); setScannerOpen(true); }}
                                    className="shrink-0 h-7 w-8 border border-[#d1d5db] rounded-r bg-[#f8f9fa] flex items-center justify-center text-gray-700 hover:bg-[#edf3f9] hover:text-[#0067c0] transition-colors cursor-pointer"
                                    title="Escanear"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Lista de Resultados de Búsqueda */}
                        {searchResults.length > 0 && (
                            <div className="bg-white border border-[#0067c0]/30 rounded overflow-hidden max-h-48 overflow-y-auto">
                                <div className="p-1.5 bg-[#edf3f9] text-[11px] font-normal text-[#0067c0]">Seleccione un ítem:</div>
                                {searchResults.map((item) => (
                                    <div 
                                        key={item.itemCode}
                                        onClick={() => selectItemFromResult(item)}
                                        className="p-2 border-b border-[#f0f0f0] hover:bg-[#edf3f9] cursor-pointer transition-colors"
                                    >
                                        <div className="font-normal text-gray-900">{item.itemCode}</div>
                                        <div className="text-[11px] text-gray-600 truncate">{item.description}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="p-2.5 bg-[#f8f9fa] border border-[#d1d5db] rounded text-[12px] font-normal text-gray-800 leading-tight">
                            {loading ? (
                                <div className="flex items-center gap-2 text-gray-600">
                                    <div className="w-3 h-3 border-2 border-[#0067c0] border-t-transparent rounded-full animate-spin"></div>
                                    Buscando...
                                </div>
                            ) : (itemData?.description || 'Esperando selección de artículo')}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                            <div>
                                <label className="text-[11px] font-normal text-gray-700 mb-1 block">Cantidad</label>
                                <input
                                    ref={qtyRef}
                                    type="number"
                                    value={physicalQty}
                                    onChange={(e) => setPhysicalQty(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                    className="w-full h-7 px-2 border border-[#d1d5db] rounded text-center font-normal text-[13px] text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                    placeholder="0"
                                />
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !itemData}
                                className="w-full h-7 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded font-normal text-[12px] disabled:opacity-50 transition-colors cursor-pointer"
                            >
                                {isSaving ? 'Guardando...' : 'Registrar'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2">
                    <div className="bg-white border border-[#d1d5db] rounded shadow-xs overflow-hidden">
                        <div className="bg-[#354a5f] text-white px-3 py-2 flex justify-between items-center border-b border-[#2a3c4e]">
                            <h2 className="text-[12px] font-normal text-white">Hallazgos Recientes</h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleExport}
                                    className="h-6 px-2.5 bg-[#2a3c4e] hover:bg-[#1f2d3a] text-white text-[11px] font-normal rounded transition-colors cursor-pointer border border-[#4a637d]"
                                >
                                    Exportar Excel
                                </button>
                                <button
                                    onClick={handleClearTable}
                                    className="h-6 px-2.5 bg-red-700 hover:bg-red-800 text-white text-[11px] font-normal rounded transition-colors cursor-pointer"
                                >
                                    Limpiar
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal border-b border-[#2a3c4e]">
                                    <tr>
                                        <th className="px-3 py-2 font-normal">Hora</th>
                                        <th className="px-3 py-2 font-normal">Bin Encontrado</th>
                                        <th className="px-3 py-2 font-normal">Bin Defecto</th>
                                        <th className="px-3 py-2 font-normal">Item</th>
                                        <th className="px-3 py-2 text-center font-normal">Cant</th>
                                        <th className="px-3 py-2 font-normal">Usuario</th>
                                    </tr>
                                </thead>
                                <tbody className="text-[11.5px]">
                                    {recentChecks.length === 0 ? (
                                        <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500 font-normal">No hay registros recientes</td></tr>
                                    ) : (
                                        recentChecks.map((check, idx) => {
                                            const isMatch = check.system_bin && check.system_bin !== 'N/A' && check.bin_location === check.system_bin;
                                            return (
                                                <tr key={check.id || idx} className={`border-b border-[#f0f0f0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#edf3f9] transition-colors`}>
                                                    <td className="px-3 py-2 text-gray-600 font-normal font-mono">{formatDate(check.timestamp)}</td>
                                                    <td className="px-3 py-2 font-normal">
                                                        <span className={`px-2 py-0.5 rounded font-mono text-[11px] ${isMatch ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                                            {check.bin_location}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-gray-700 font-normal">{check.system_bin || check.default_bin || 'N/A'}</td>
                                                    <td className="px-3 py-2">
                                                        <div className="font-normal text-[#0067c0]">{check.item_code}</div>
                                                        <div className="text-[11px] text-gray-600 truncate max-w-[240px] font-normal">{check.item_description}</div>
                                                    </td>
                                                    <td className="px-3 py-2 text-center font-normal text-[12px] text-[#1f1f1f]">{check.quantity}</td>
                                                    <td className="px-3 py-2 text-gray-600 font-normal">{check.username}</td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            {scannerOpen && <ScannerModal onScan={handleScan} onClose={() => setScannerOpen(false)} />}
        </div>
    );
};

export default SpotCheck;
