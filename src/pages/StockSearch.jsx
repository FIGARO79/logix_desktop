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
    const [lastQuery, setLastQuery] = useState('');
    const [validBins, setValidBins] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [scannerOpen, setScannerOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (setTitle) setTitle(t('stock.title', 'Consulta de Stock'));
        fetch('/api/stock/valid_bins')
            .then(res => res.ok ? res.json() : [])
            .then(data => {
                if (Array.isArray(data)) setValidBins(data);
            })
            .catch(() => {});
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

    // Ejecución de búsqueda unificada: código, ubicación o descripción en un solo input
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
        setLastQuery(cleanQuery);

        try {
            let data = [];

            // 1. Consultar endpoint general de búsqueda (busca por item_code, description, bin_location y additional_bins)
            const res = await fetch(`/api/search_items?q=${encodeURIComponent(cleanQuery)}`).catch(() => null);
            if (res && res.ok) {
                const json = await res.json().catch(() => []);
                if (Array.isArray(json)) {
                    data = json.map(normalizeItem).filter(Boolean);
                }
            }

            // 2. Si no hay resultados, intentar explícitamente como ubicación (/api/stock/by_location)
            if (!data || data.length === 0) {
                const resLoc = await fetch(`/api/stock/by_location?bin=${encodeURIComponent(cleanQuery)}`).catch(() => null);
                if (resLoc && resLoc.ok) {
                    const jsonLoc = await resLoc.json().catch(() => []);
                    if (Array.isArray(jsonLoc) && jsonLoc.length > 0) {
                        data = jsonLoc.map(normalizeItem).filter(Boolean);
                    }
                }
            }

            // 3. Fallback en IndexedDB offline si no hubo resultados
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
                    (item.bin_location && item.bin_location.toUpperCase().includes(qUpper)) ||
                    (item.Aditional_Bin_Location && item.Aditional_Bin_Location.toUpperCase().includes(qUpper)) ||
                    (item.additional_bins && item.additional_bins.toUpperCase().includes(qUpper))
                );

                data = matches.map(normalizeItem).filter(Boolean);
            }

            if (data.length === 0) {
                setError(`No se encontraron artículos para "${cleanQuery}" (código, ubicación o descripción)`);
                toast.error('No se encontraron resultados');
            } else if (data.length === 1 && data[0].itemCode.toUpperCase() === cleanQuery.toUpperCase()) {
                // Coincidencia exacta de SKU único: abrir detalle directamente
                setItemData(data[0]);
                playBeep();
                setItemCode('');
            } else {
                // Búsqueda por ubicación, descripción o múltiples coincidencias: mostrar lista de artículos
                setSearchResults(data);
                playBeep();
            }
        } catch (err) {
            console.error("Error en executeSearch:", err);
            setError('Error al consultar inventario');
            toast.error('Error al consultar inventario');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectResult = (item) => {
        setItemData(item);
        playBeep();
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleSearchLocation = (loc) => {
        if (!loc || loc === 'N/A') return;
        setItemCode(loc);
        executeSearch(loc);
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
        setLastQuery('');
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
        <div className="container-wrapper max-w-5xl mx-auto px-4 py-5 font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f]">
            <ToastContainer position="top-right" autoClose={3000} />

            {/* Header & Search Form */}
            <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden mb-5">
                <div className="bg-[#354a5f] text-white px-4 py-2.5 flex flex-wrap justify-between items-center border-b border-[#2a3c4d]">
                    <span className="text-[12px] font-normal text-white uppercase tracking-normal">
                        Consulta y Búsqueda de Stock
                    </span>
                </div>

                <div className="p-4 bg-white">
                    <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-2.5 items-end">
                        <div className="flex-grow w-full">
                            <label className="text-[11px] font-normal text-[#5f5f5f] uppercase tracking-normal block mb-1">
                                Código de Ítem, Ubicación o Descripción
                            </label>
                            <input
                                ref={inputRef}
                                type="text"
                                list="valid-bins-list"
                                value={itemCode}
                                onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                                className="w-full h-7 px-2.5 border border-[#d1d5db] rounded text-[12px] uppercase text-[#1f1f1f] font-normal tracking-normal outline-none focus:border-[#0067c0] transition-colors"
                                placeholder="Escanear o ingresar Código de Artículo, Ubicación o Descripción..."
                                autoFocus
                            />
                            {validBins.length > 0 && (
                                <datalist id="valid-bins-list">
                                    {validBins.map((b) => (
                                        <option key={b} value={b} />
                                    ))}
                                </datalist>
                            )}
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                            <button
                                type="button"
                                onClick={() => setScannerOpen(true)}
                                className="h-7 px-3 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] rounded text-[#1f1f1f] text-[12px] font-normal transition-colors cursor-pointer"
                                title="Escanear Código de Barras"
                            >
                                Escanear
                            </button>
                            <button
                                type="submit"
                                className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal tracking-normal rounded transition-colors cursor-pointer"
                                disabled={loading}
                            >
                                {loading ? 'Buscando...' : t('stock.search_btn', 'Buscar')}
                            </button>
                            <button
                                type="button"
                                onClick={clearSearch}
                                className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal tracking-normal rounded transition-colors cursor-pointer"
                            >
                                Limpiar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Error Message Banner */}
            {error && (
                <div className="p-3 mb-4 bg-white border border-[#d13438] text-[#d13438] rounded text-[12px] font-normal flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-[#5f5f5f] hover:text-[#1f1f1f] text-[11px] cursor-pointer">✕</button>
                </div>
            )}

            {/* Multiple Search Results List */}
            {searchResults.length > 0 && !itemData && (
                <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden mb-5">
                    <div className="bg-[#fbfbfb] px-4 py-2 border-b border-[#e5e5e5] flex justify-between items-center">
                        <span className="text-[12px] font-normal text-[#1f1f1f] uppercase tracking-normal">
                            Coincidencias encontradas ({searchResults.length}) — Seleccione un ítem
                        </span>
                        <span className="text-[11px] text-[#7f7f7f] font-normal">Haga clic en una fila para ver el detalle</span>
                    </div>
                    <div className="divide-y divide-[#e5e5e5] max-h-80 overflow-y-auto">
                        {searchResults.map((item) => (
                            <div
                                key={item.itemCode}
                                onClick={() => handleSelectResult(item)}
                                className="px-4 py-2.5 hover:bg-[#edf3f9] cursor-pointer transition-colors flex flex-wrap justify-between items-center gap-2"
                            >
                                <div className="flex-1 min-w-[240px]">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-normal text-[12px] text-[#0067c0] tracking-normal">
                                            {item.itemCode}
                                        </span>
                                        {item.abcCode && (
                                            <span className="px-1.5 py-0.2 text-[10px] font-normal bg-[#f3f3f3] text-[#1f1f1f] border border-[#d1d5db] rounded">
                                                ABC {item.abcCode}
                                            </span>
                                        )}
                                        {item.sicCode && item.sicCode !== '0' && (
                                            <span className="px-1.5 py-0.2 text-[10px] font-normal bg-[#fdf4f0] text-[#d83b01] border border-[#f5c6cb] rounded">
                                                SIC {item.sicCode}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[12px] text-[#1f1f1f] font-normal truncate max-w-lg mt-0.5" title={item.description}>
                                        {item.description || 'Sin descripción'}
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-[#7f7f7f] font-normal mt-0.5">
                                        <span>Ubicación: <span className="text-[#1f1f1f] font-mono">{item.binLocation}</span></span>
                                        {item.additionalBins && (
                                            <span>Adicionales: <span className="text-[#5f5f5f] font-mono">{item.additionalBins}</span></span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right flex items-center gap-4">
                                    <div>
                                        <div className="text-[10px] uppercase font-normal text-[#7f7f7f]">Costo Unit.</div>
                                        <div className="text-[12px] font-normal text-[#1f1f1f] font-mono">
                                            {formatMoney(item.unitCost)}
                                        </div>
                                    </div>
                                    <div className="min-w-[90px] text-right">
                                        <div className="text-[10px] uppercase font-normal text-[#7f7f7f]">Stock Sistema</div>
                                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-normal font-mono border ${
                                            item.systemQty > 0 
                                                ? 'bg-[#f1faf3] text-[#107c41] border-[#c3e6cb]' 
                                                : item.systemQty < 0
                                                    ? 'bg-[#fde7e9] text-[#d13438] border-[#f5c6cb]'
                                                    : 'bg-[#f3f3f3] text-[#5f5f5f] border-[#d1d5db]'
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
                <div className="bg-white rounded border border-[#d1d5db] shadow-sm overflow-hidden mb-5">
                    {/* Return to search results breadcrumb banner */}
                    {searchResults.length > 1 && (
                        <div className="bg-[#f0f6fc] px-4 py-2 border-b border-[#d1d5db] flex justify-between items-center">
                            <button
                                type="button"
                                onClick={() => setItemData(null)}
                                className="text-[12px] font-normal text-[#0067c0] hover:underline flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                ← Volver a la lista de resultados {lastQuery ? `("${lastQuery}")` : ''} ({searchResults.length} ítems)
                            </button>
                        </div>
                    )}

                    {/* Item Card Header */}
                    <div className="bg-[#fbfbfb] px-4 py-2.5 border-b border-[#e5e5e5] flex flex-wrap justify-between items-center gap-4">
                        <div className="flex items-center gap-2.5">
                            <span className="font-mono text-[16px] font-normal text-[#1f1f1f] tracking-normal m-0">
                                {itemData.itemCode}
                            </span>
                            <button
                                onClick={() => copyToClipboard(itemData.itemCode)}
                                className="h-6 px-2 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded text-[11px] font-normal text-[#1f1f1f] flex items-center gap-1 transition-colors cursor-pointer"
                                title="Copiar código"
                            >
                                {copied ? 'Copiado' : 'Copiar'}
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-normal uppercase tracking-normal border ${
                                itemData.systemQty > 0
                                    ? 'bg-[#f1faf3] text-[#107c41] border-[#c3e6cb]'
                                    : itemData.systemQty < 0
                                        ? 'bg-[#fde7e9] text-[#d13438] border-[#f5c6cb]'
                                        : 'bg-[#f3f3f3] text-[#5f5f5f] border-[#d1d5db]'
                            }`}>
                                {itemData.systemQty > 0 
                                    ? `Disponible (${formatNumber(itemData.systemQty)} und)`
                                    : itemData.systemQty < 0
                                        ? `Saldo negativo (${formatNumber(itemData.systemQty)} und)`
                                        : 'Sin stock (0 und)'}
                            </span>
                        </div>
                    </div>

                    <div className="p-4 space-y-4">
                        {/* 4 Main Stat Metric Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {/* Stock en Sistema */}
                            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-3 text-center">
                                <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-1">
                                    Stock en Sistema
                                </span>
                                <div className={`text-xl font-normal font-mono ${
                                    itemData.systemQty > 0 ? 'text-[#1f1f1f]' : itemData.systemQty < 0 ? 'text-[#d13438]' : 'text-[#7f7f7f]'
                                }`}>
                                    {formatNumber(itemData.systemQty)}
                                </div>
                                <span className="text-[10px] text-[#7f7f7f] uppercase font-normal">Unidades</span>
                            </div>

                            {/* Ubicación Principal */}
                            <div 
                                onClick={() => handleSearchLocation(itemData.binLocation)}
                                className="bg-[#fafafa] hover:bg-[#f0f6fc] border border-[#e5e5e5] hover:border-[#0067c0] rounded p-3 text-center cursor-pointer transition-colors group"
                                title="Clic para consultar artículos en esta ubicación"
                            >
                                <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-1 group-hover:text-[#0067c0]">
                                    Ubicación Principal
                                </span>
                                <div className="text-xl font-normal font-mono text-[#0067c0] group-hover:underline">
                                    {itemData.binLocation || 'N/A'}
                                </div>
                                <span className="text-[10px] text-[#7f7f7f] uppercase font-normal">Bin Primario</span>
                            </div>

                            {/* Costo Unitario */}
                            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-3 text-center">
                                <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-1">
                                    Costo Unitario
                                </span>
                                <div className="text-xl font-normal font-mono text-[#1f1f1f]">
                                    {formatMoney(itemData.unitCost)}
                                </div>
                                <span className="text-[10px] text-[#7f7f7f] uppercase font-normal">Costo Estándar</span>
                            </div>

                            {/* Valor Total Inventario */}
                            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-3 text-center">
                                <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-1">
                                    Valor Total Stock
                                </span>
                                <div className="text-xl font-normal font-mono text-[#1f1f1f]">
                                    {formatMoney(itemData.systemQty * itemData.unitCost)}
                                </div>
                                <span className="text-[10px] text-[#7f7f7f] uppercase font-normal">Valoración Total</span>
                            </div>
                        </div>

                        {/* Descripción del Producto */}
                        <div className="bg-white border border-[#e5e5e5] rounded p-3">
                            <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-1">
                                Descripción del Material / Producto
                            </span>
                            <div className="text-[13px] font-normal text-[#1f1f1f]">
                                {itemData.description || 'Sin descripción registrada'}
                            </div>
                        </div>

                        {/* Ubicaciones de Almacenamiento */}
                        <div className="bg-white border border-[#e5e5e5] rounded p-3">
                            <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-2">
                                Ubicaciones en Bodega <span className="text-[10px] text-[#7f7f7f] normal-case">(Haga clic en una ubicación para consultar todos sus artículos)</span>
                            </span>
                            <div className="flex flex-wrap items-center gap-3">
                                <div>
                                    <span className="text-[10px] text-[#7f7f7f] block uppercase mb-1">Principal:</span>
                                    <button
                                        type="button"
                                        onClick={() => handleSearchLocation(itemData.binLocation)}
                                        className="h-6 px-2.5 bg-[#f0f6fc] hover:bg-[#e1dfdd] text-[#0067c0] border border-[#d1d5db] rounded font-mono font-normal text-[12px] transition-colors cursor-pointer"
                                        title="Clic para consultar artículos en esta ubicación"
                                    >
                                        {itemData.binLocation || 'N/A'}
                                    </button>
                                </div>
                                {additionalBinsList.length > 0 ? (
                                    <div>
                                        <span className="text-[10px] text-[#7f7f7f] block uppercase mb-1">Adicionales:</span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {additionalBinsList.map((bin, idx) => (
                                                <button
                                                    key={idx}
                                                    type="button"
                                                    onClick={() => handleSearchLocation(bin)}
                                                    className="h-6 px-2.5 bg-[#fafafa] hover:bg-[#f0f0f0] text-[#1f1f1f] border border-[#d1d5db] rounded font-mono text-[11px] font-normal transition-colors cursor-pointer"
                                                    title={`Clic para consultar artículos en ${bin}`}
                                                >
                                                    {bin}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <span className="text-[10px] text-[#7f7f7f] block uppercase mb-1">Adicionales:</span>
                                        <span className="text-[11px] text-[#7f7f7f] font-normal">Sin ubicaciones adicionales</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Ficha Técnica & Atributos de Almacenamiento */}
                        <div className="bg-white border border-[#e5e5e5] rounded p-3">
                            <span className="text-[11px] font-normal text-[#7f7f7f] uppercase tracking-normal block mb-2 border-b border-[#f0f0f0] pb-1">
                                Atributos Técnicos y Logísticos
                            </span>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
                                <div>
                                    <span className="text-[11px] font-normal text-[#7f7f7f] uppercase block mb-0.5">Clasificación ABC</span>
                                    <span className="inline-block px-1.5 py-0.5 bg-[#fafafa] border border-[#d1d5db] rounded font-normal text-[#1f1f1f] font-mono text-[11px]">
                                        {itemData.abcCode || 'N/A'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-[#7f7f7f] uppercase block mb-0.5">Código SIC</span>
                                    <span className="inline-block px-1.5 py-0.5 bg-[#fafafa] border border-[#d1d5db] rounded font-normal text-[#1f1f1f] font-mono text-[11px]">
                                        {itemData.sicCode || '0'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-[#7f7f7f] uppercase block mb-0.5">Peso Unitario</span>
                                    <span className="font-normal text-[#1f1f1f] font-mono">
                                        {itemData.weightPerUnit > 0 ? `${formatNumber(itemData.weightPerUnit)} kg` : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-[#7f7f7f] uppercase block mb-0.5">Dimensiones (L × An × Al)</span>
                                    <span className="font-normal text-[#1f1f1f] font-mono">
                                        {itemData.lengthCm > 0 || itemData.widthCm > 0 || itemData.heightCm > 0
                                            ? `${formatNumber(itemData.lengthCm)} × ${formatNumber(itemData.widthCm)} × ${formatNumber(itemData.heightCm)} cm`
                                            : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-[#7f7f7f] uppercase block mb-0.5">Volumen Estimado</span>
                                    <span className="font-normal text-[#1f1f1f] font-mono">
                                        {itemData.volumeCm3 > 0 ? `${formatNumber(itemData.volumeCm3)} cm³` : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-normal text-[#7f7f7f] uppercase block mb-0.5">Última Actualización</span>
                                    <span className="font-normal text-[#1f1f1f] font-mono text-[11px]">
                                        {itemData.updatedAt || itemData.dateLastReceived || '-'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Direct Action Buttons */}
                        <div className="flex flex-wrap justify-between items-center gap-2.5 pt-3 border-t border-[#e5e5e5]">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => navigate('/spot-check')}
                                    className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal tracking-normal rounded transition-colors cursor-pointer"
                                >
                                    Verificar Saldo (Spot Check)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/label', { state: { itemCode: itemData?.item_code || itemData?.itemCode } })}
                                    className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal tracking-normal rounded transition-colors cursor-pointer"
                                >
                                    Imprimir Etiqueta
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={clearSearch}
                                className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal tracking-normal rounded transition-colors cursor-pointer"
                            >
                                Nueva Consulta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty State Prompt */}
            {!itemData && searchResults.length === 0 && !error && (
                <div className="bg-white rounded border border-[#d1d5db] p-8 text-center text-[#7f7f7f] shadow-sm mt-5">
                    <span className="text-[12px] font-normal text-[#1f1f1f] uppercase tracking-normal block mb-1">Consulte el saldo y ubicación de un material</span>
                    <p className="text-[11px] text-[#7f7f7f] max-w-sm mx-auto font-normal">
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
