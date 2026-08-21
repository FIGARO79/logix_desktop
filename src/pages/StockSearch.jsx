import React, { useState, useRef, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useNavigate } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';
import { parseGS1Barcode } from '../utils/gs1Parser';
import { getDB } from '../utils/offlineDb';
import { useLanguage } from '../context/LanguageContext';

const StockSearch = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const [itemCode, setItemCode] = useState('');
    const [itemData, setItemData] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [scannerOpen, setScannerOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (setTitle) setTitle(t('stock.title', 'Consulta de Stock'));
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }, 50);
    }, [setTitle, language]);

    // Audio Beep Function for mobile feedback
    const playBeep = () => {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (!isMobile) return;

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.15);
        } catch (e) {
            console.warn("Audio playback not allowed:", e);
        }
    };

    // Normalizador de datos de ítems desde cualquier fuente (API Rust / IndexedDB)
    const normalizeItem = (raw) => {
        if (!raw) return null;
        const code = (raw.itemCode || raw.item_code || raw.Item_Code || '').trim();
        const desc = (raw.description || raw.Item_Description || raw.item_description || '').trim();
        const binLoc = (raw.binLocation || raw.bin_location || raw.Bin_Location || raw.Bin_1 || raw.system_bin || 'N/A').trim();
        const addBins = (raw.additionalBins || raw.aditionalBins || raw.additional_bins || raw.Aditional_Bin_Location || raw.additional_locations || '').trim();
        
        const rawQty = raw.systemQty ?? raw.system_qty ?? raw.physicalQty ?? raw.physical_qty ?? raw.System_Qty ?? raw.Physical_Qty ?? 0;
        const systemQty = typeof rawQty === 'number' ? rawQty : (parseFloat(String(rawQty).replace(/,/g, '')) || 0);

        const rawCost = raw.unitCost ?? raw.unit_cost ?? raw.Unit_Cost ?? raw.cost_per_unit ?? raw.cost ?? 0;
        const unitCost = typeof rawCost === 'number' ? rawCost : (parseFloat(String(rawCost).replace(/,/g, '')) || 0);

        const rawWeight = raw.weightPerUnit ?? raw.weight_per_unit ?? raw.weight ?? raw.weight_kg ?? raw.Weight_Per_Unit ?? raw.Weight_per_Unit ?? 0;
        const weightPerUnit = typeof rawWeight === 'number' ? rawWeight : (parseFloat(String(rawWeight).replace(/,/g, '')) || 0);

        const sicCode = String(raw.sicCode || raw.sic_code || raw.SIC_Code || raw.SIC_Code_stockroom || '0').trim();
        const abcCode = String(raw.abcCode || raw.abc_code || raw.ABC_Code || raw.ABC_Code_stockroom || raw.itemType || '').trim().toUpperCase();

        const lengthCm = parseFloat(raw.lengthCm || raw.length_cm || 0) || 0;
        const widthCm = parseFloat(raw.widthCm || raw.width_cm || 0) || 0;
        const heightCm = parseFloat(raw.heightCm || raw.height_cm || 0) || 0;
        const volumeCm3 = parseFloat(raw.volumeCm3 || raw.volume_cm3 || 0) || (lengthCm > 0 && widthCm > 0 && heightCm > 0 ? lengthCm * widthCm * heightCm : 0);

        const updatedAt = raw.updatedAt || raw.updated_at || '';
        const dateLastReceived = raw.dateLastReceived || (updatedAt ? updatedAt.split(' ')[0] : '');

        return {
            itemCode: code,
            description: desc,
            binLocation: binLoc,
            additionalBins: addBins,
            systemQty,
            physicalQty: systemQty,
            unitCost,
            weightPerUnit,
            weight: weightPerUnit,
            sicCode,
            abcCode,
            itemType: abcCode,
            lengthCm,
            widthCm,
            heightCm,
            volumeCm3,
            updatedAt,
            dateLastReceived
        };
    };

    // Formateadores numéricos y de moneda
    const formatMoney = (val) => {
        const num = Number(val || 0);
        return '$ ' + num.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const formatNumber = (val) => {
        const num = Number(val || 0);
        return num.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    };

    // Ejecución de búsqueda
    const executeSearch = async (query) => {
        let cleanQuery = query ? query.trim() : '';
        if (!cleanQuery) return;

        const gs1 = parseGS1Barcode(cleanQuery);
        if ((gs1.isGS1 || gs1.isMultiField) && gs1.itemCode) {
            cleanQuery = gs1.itemCode.trim();
            setItemCode(cleanQuery);
        }

        setLoading(true);
        setError('');
        setItemData(null);
        setSearchResults([]);

        try {
            let data = [];
            const res = await fetch(`/api/search_items?q=${encodeURIComponent(cleanQuery)}`).catch(() => null);
            if (res && res.ok) {
                const json = await res.json().catch(() => []);
                if (Array.isArray(json)) {
                    data = json.map(normalizeItem).filter(Boolean);
                }
            }

            // Fallback en IndexedDB offline si no hubo resultados
            if (!data || data.length === 0) {
                const db = await getDB();
                const allItems = await db.getAll('master_items') || [];
                const qUpper = cleanQuery.toUpperCase();
                const matches = allItems.filter(item =>
                    (item.Item_Code && item.Item_Code.toUpperCase().includes(qUpper)) ||
                    (item.item_code && item.item_code.toUpperCase().includes(qUpper)) ||
                    (item.Item_Description && item.Item_Description.toUpperCase().includes(qUpper)) ||
                    (item.description && item.description.toUpperCase().includes(qUpper)) ||
                    (item.Bin_Location && item.Bin_Location.toUpperCase().includes(qUpper)) ||
                    (item.Bin_1 && item.Bin_1.toUpperCase().includes(qUpper)) ||
                    (item.bin_location && item.bin_location.toUpperCase().includes(qUpper))
                );

                data = matches.map(normalizeItem).filter(Boolean);
            }

            if (data.length === 0) {
                setError('Item no encontrado en el maestro de inventario');
                toast.error('Item no encontrado');
            } else if (data.length === 1) {
                setItemData(data[0]);
                playBeep();
                setItemCode('');
            } else {
                setSearchResults(data);
            }
        } catch (err) {
            console.error("Error en executeSearch:", err);
            setError('Error al consultar stock');
            toast.error('Error al consultar stock');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectResult = (item) => {
        setItemData(item);
        setSearchResults([]);
        setItemCode('');
        playBeep();
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleScan = (code) => {
        setScannerOpen(false);
        setItemCode(code);
        executeSearch(code);
    };

    const handleSearch = (e) => {
        if (e) e.preventDefault();
        if (!itemCode.trim()) return;
        executeSearch(itemCode);
    };

    const clearSearch = () => {
        setItemCode('');
        setItemData(null);
        setSearchResults([]);
        setError('');
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const copyToClipboard = (text) => {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            toast.success(`Código ${text} copiado al portapapeles`);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
            toast.info(`Código: ${text}`);
        });
    };

    // Separar ubicaciones adicionales en lista
    const additionalBinsList = itemData && itemData.additionalBins
        ? itemData.additionalBins.split(/[,;\/]+/).map(b => b.trim()).filter(b => b && b !== 'N/A' && b !== itemData.binLocation)
        : [];

    return (
        <div className="container-wrapper max-w-5xl mx-auto px-4 py-6">
            <ToastContainer position="top-right" autoClose={3000} />

            {/* Header & Search Form */}
            <div className="bg-white rounded-lg shadow-sm border border-zinc-200 overflow-hidden mb-6">
                <div className="bg-[#354a5f] text-white px-6 py-4 flex flex-wrap justify-between items-center gap-3">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-zinc-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <h2 className="text-base font-medium text-white tracking-normal m-0">
                            Consulta y Búsqueda de Stock
                        </h2>
                    </div>
                    
                </div>

                <div className="p-6 bg-white">
                    <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
                        <div className="flex-grow">
                            <label className="text-[12px] uppercase font-medium text-black tracking-normal block mb-1">
                                Código de Ítem, Ubicación o Descripción
                            </label>
                            <input
                                ref={inputRef}
                                type="text"
                                value={itemCode}
                                onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                                className="w-full h-10 px-3 border border-zinc-300 rounded text-[14px] uppercase text-black focus:outline-none focus:border-[#285f94] focus:ring-1 focus:ring-[#285f94]"
                                placeholder={t('stock.search_placeholder', 'Escanear o ingresar Código de Artículo...')}
                                autoFocus
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <button
                                type="button"
                                onClick={() => setScannerOpen(true)}
                                className="h-10 w-10 border border-zinc-300 bg-zinc-50 hover:bg-zinc-100 rounded text-black flex items-center justify-center transition-colors"
                                title="Escanear Código de Barras"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-30 h-30 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                                </svg>
                            </button>
                            <button
                                type="submit"
                                className="h-10 px-5 bg-[#285f94] hover:bg-[#1e4a74] text-white text-[12px] font-normal uppercase tracking-normal rounded transition-colors shadow-sm"
                                disabled={loading}
                            >
                                {loading ? 'Buscando...' : t('stock.search_btn', 'Buscar')}
                            </button>
                            <button
                                type="button"
                                onClick={clearSearch}
                                className="h-10 px-4 bg-white hover:bg-zinc-100 border border-zinc-300 text-black text-[12px] font-normal uppercase tracking-normal rounded transition-colors"
                            >
                                Limpiar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Error Message Banner */}
            {error && (
                <div className="p-4 mb-6 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span>{error}</span>
                </div>
            )}

            {/* Multiple Search Results List */}
            {searchResults.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-zinc-200 overflow-hidden mb-6 animate-fade-in">
                    <div className="bg-zinc-100 px-6 py-3 border-b border-zinc-200 flex justify-between items-center">
                        <h3 className="text-xs font-medium text-black uppercase tracking-normal">
                            Coincidencias encontradas ({searchResults.length}) — Seleccione un ítem:
                        </h3>
                        <span className="text-[11px] text-zinc-500">Haga clic en una fila para ver el detalle</span>
                    </div>
                    <div className="divide-y divide-zinc-200 max-h-80 overflow-y-auto">
                        {searchResults.map((item) => (
                            <div
                                key={item.itemCode}
                                onClick={() => handleSelectResult(item)}
                                className="px-6 py-3.5 hover:bg-blue-50/70 cursor-pointer transition-colors flex flex-wrap justify-between items-center gap-2"
                            >
                                <div className="flex-1 min-w-[240px]">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-medium text-[13px] text-[#285f94] tracking-normal">
                                            {item.itemCode}
                                        </span>
                                        {item.abcCode && (
                                            <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-zinc-100 text-black border border-zinc-300 rounded">
                                                ABC {item.abcCode}
                                            </span>
                                        )}
                                        {item.sicCode && item.sicCode !== '0' && (
                                            <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                                                SIC {item.sicCode}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[12px] text-black font-normal truncate max-w-lg mt-0.5" title={item.description}>
                                        {item.description || 'Sin descripción'}
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-zinc-600 mt-1">
                                        <span>Ubicación: <strong className="text-black font-mono">{item.binLocation}</strong></span>
                                        {item.additionalBins && (
                                            <span>Adicionales: <strong className="text-zinc-700 font-mono">{item.additionalBins}</strong></span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right flex items-center gap-4">
                                    <div>
                                        <div className="text-[10px] uppercase font-normal text-zinc-500">Costo Unit.</div>
                                        <div className="text-[12px] font-normal text-black font-mono">
                                            {formatMoney(item.unitCost)}
                                        </div>
                                    </div>
                                    <div className="min-w-[90px] text-right">
                                        <div className="text-[10px] uppercase font-normal text-zinc-500">Stock Sistema</div>
                                        <span className={`inline-block px-2.5 py-0.5 rounded text-[12px] font-semibold font-mono ${
                                            item.systemQty > 0 
                                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                                : item.systemQty < 0
                                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                                    : 'bg-zinc-100 text-zinc-600 border border-zinc-300'
                                        }`}>
                                            {formatNumber(item.systemQty)} und
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Selected Item Detail Card */}
            {itemData && (
                <div className="bg-white rounded-lg shadow-sm border border-zinc-200 overflow-hidden animate-fade-in">
                    {/* Item Card Header */}
                    <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex flex-wrap justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                            <h3 className="font-mono text-xl font-bold text-black tracking-normal m-0 flex items-center gap-2">
                                {itemData.itemCode}
                            </h3>
                            <button
                                onClick={() => copyToClipboard(itemData.itemCode)}
                                className="px-2 py-1 bg-white hover:bg-zinc-100 border border-zinc-300 rounded text-[11px] text-black flex items-center gap-1 transition-colors"
                                title="Copiar código"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                {copied ? 'Copiado' : 'Copiar'}
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`px-3 py-1 rounded text-xs font-semibold uppercase tracking-wide border ${
                                itemData.systemQty > 0
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : itemData.systemQty < 0
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                        : 'bg-zinc-100 text-zinc-600 border-zinc-300'
                            }`}>
                                {itemData.systemQty > 0 
                                    ? `DISPONIBLE (${formatNumber(itemData.systemQty)} UND)`
                                    : itemData.systemQty < 0
                                        ? `SALDO NEGATIVO (${formatNumber(itemData.systemQty)} UND)`
                                        : 'SIN STOCK (0 UND)'}
                            </span>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* 4 Main Stat Metric Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {/* Stock en Sistema */}
                            <div className="bg-zinc-50 border border-zinc-200 rounded p-4 text-center">
                                <span className="text-[11px] font-normal text-zinc-500 uppercase tracking-normal block mb-1">
                                    Stock en Sistema
                                </span>
                                <div className={`text-2xl font-bold font-mono ${
                                    itemData.systemQty > 0 ? 'text-black' : itemData.systemQty < 0 ? 'text-rose-700' : 'text-zinc-500'
                                }`}>
                                    {formatNumber(itemData.systemQty)}
                                </div>
                                <span className="text-[10px] text-zinc-500 uppercase">Unidades</span>
                            </div>

                            {/* Ubicación Principal */}
                            <div className="bg-zinc-50 border border-zinc-200 rounded p-4 text-center">
                                <span className="text-[11px] font-normal text-zinc-500 uppercase tracking-normal block mb-1">
                                    Ubicación Principal
                                </span>
                                <div className="text-2xl font-bold font-mono text-[#285f94]">
                                    {itemData.binLocation || 'N/A'}
                                </div>
                                <span className="text-[10px] text-zinc-500 uppercase">Bin Primario</span>
                            </div>

                            {/* Costo Unitario */}
                            <div className="bg-zinc-50 border border-zinc-200 rounded p-4 text-center">
                                <span className="text-[11px] font-normal text-zinc-500 uppercase tracking-normal block mb-1">
                                    Costo Unitario
                                </span>
                                <div className="text-xl font-bold font-mono text-black">
                                    {formatMoney(itemData.unitCost)}
                                </div>
                                <span className="text-[10px] text-zinc-500 uppercase">Costo Estándar</span>
                            </div>

                            {/* Valor Total Inventario */}
                            <div className="bg-zinc-50 border border-zinc-200 rounded p-4 text-center">
                                <span className="text-[11px] font-normal text-zinc-500 uppercase tracking-normal block mb-1">
                                    Valor Total Stock
                                </span>
                                <div className="text-xl font-bold font-mono text-black">
                                    {formatMoney(itemData.systemQty * itemData.unitCost)}
                                </div>
                                <span className="text-[10px] text-zinc-500 uppercase">Valoración Total</span>
                            </div>
                        </div>

                        {/* Descripción del Producto */}
                        <div className="bg-white border border-zinc-200 rounded p-4">
                            <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-normal block mb-1">
                                Descripción del Material / Producto
                            </label>
                            <div className="text-base font-semibold text-black uppercase">
                                {itemData.description || 'Sin descripción registrada'}
                            </div>
                        </div>

                        {/* Ubicaciones de Almacenamiento */}
                        <div className="bg-white border border-zinc-200 rounded p-4">
                            <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-normal block mb-2">
                                Ubicaciones en Bodega
                            </label>
                            <div className="flex flex-wrap items-center gap-3">
                                <div>
                                    <span className="text-[10px] text-zinc-500 block uppercase mb-1">Principal:</span>
                                    <span className="inline-flex items-center px-3 py-1 bg-blue-100 text-[#1e4a74] border border-blue-200 rounded font-mono font-bold text-sm">
                                        {itemData.binLocation || 'N/A'}
                                    </span>
                                </div>
                                {additionalBinsList.length > 0 ? (
                                    <div>
                                        <span className="text-[10px] text-zinc-500 block uppercase mb-1">Adicionales:</span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {additionalBinsList.map((bin, idx) => (
                                                <span key={idx} className="inline-flex items-center px-2.5 py-1 bg-zinc-100 text-black border border-zinc-300 rounded font-mono text-xs font-medium">
                                                    {bin}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <span className="text-[10px] text-zinc-500 block uppercase mb-1">Adicionales:</span>
                                        <span className="text-xs text-zinc-500 italic">Sin ubicaciones adicionales</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Ficha Técnica & Atributos de Almacenamiento */}
                        <div className="bg-white border border-zinc-200 rounded p-4">
                            <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-normal block mb-3 border-b border-zinc-100 pb-1.5">
                                Atributos Técnicos y Logísticos
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[12px]">
                                <div>
                                    <span className="text-[11px] font-normal text-zinc-500 uppercase block mb-1">Clasificación ABC</span>
                                    <span className="inline-block px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-bold text-black font-mono">
                                        {itemData.abcCode || 'N/A'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-zinc-500 uppercase block mb-1">Código SIC</span>
                                    <span className="inline-block px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-bold text-black font-mono">
                                        {itemData.sicCode || '0'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-zinc-500 uppercase block mb-1">Peso Unitario</span>
                                    <span className="font-semibold text-black font-mono">
                                        {itemData.weightPerUnit > 0 ? `${formatNumber(itemData.weightPerUnit)} kg` : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-zinc-500 uppercase block mb-1">Dimensiones (L × An × Al)</span>
                                    <span className="font-semibold text-black font-mono">
                                        {itemData.lengthCm > 0 || itemData.widthCm > 0 || itemData.heightCm > 0
                                            ? `${formatNumber(itemData.lengthCm)} × ${formatNumber(itemData.widthCm)} × ${formatNumber(itemData.heightCm)} cm`
                                            : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-zinc-500 uppercase block mb-1">Volumen Estimado</span>
                                    <span className="font-semibold text-black font-mono">
                                        {itemData.volumeCm3 > 0 ? `${formatNumber(itemData.volumeCm3)} cm³` : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-zinc-500 uppercase block mb-1">Última Actualización</span>
                                    <span className="font-normal text-black font-mono text-[11px]">
                                        {itemData.updatedAt || itemData.dateLastReceived || '-'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Direct Action Buttons */}
                        <div className="flex flex-wrap justify-between items-center gap-3 pt-2 border-t border-zinc-200">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => navigate('/spot-check')}
                                    className="h-9 px-4 bg-[#285f94] hover:bg-[#1e4a74] text-white text-[12px] font-normal uppercase tracking-normal rounded flex items-center gap-1.5 transition-colors shadow-sm"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Verificar Saldo (Spot Check)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/label-printing')}
                                    className="h-9 px-4 bg-white hover:bg-zinc-100 border border-zinc-300 text-black text-[12px] font-normal uppercase tracking-normal rounded flex items-center gap-1.5 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                    </svg>
                                    Imprimir Etiqueta
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={clearSearch}
                                className="h-9 px-4 bg-zinc-100 hover:bg-zinc-200 text-black text-[12px] font-normal uppercase tracking-normal rounded transition-colors"
                            >
                                Nueva Consulta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty State Prompt */}
            {!itemData && searchResults.length === 0 && !error && (
                <div className="bg-white rounded-lg border border-zinc-200 p-12 text-center text-zinc-500 shadow-sm mt-6">
                    <div className="w-12 h-12 rounded-full bg-zinc-100 text-zinc-400 flex items-center justify-center mx-auto mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <h3 className="text-sm font-medium text-black uppercase mb-1">Consulte el saldo y ubicación de un material</h3>
                    <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                        Ingrese el código del ítem, una ubicación de almacén o parte de la descripción para consultar sus saldos y atributos.
                    </p>
                </div>
            )}

            {/* Barcode Scanner Modal */}
            {scannerOpen && (
                <ScannerModal
                    onScan={handleScan}
                    onClose={() => setScannerOpen(false)}
                />
            )}
        </div>
    );
};

export default StockSearch;
