import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

const SlottingConfig = () => {
    const { setTitle } = useOutletContext();
    const [activeTab, setActiveTab] = useState('turnover');
    const [config, setConfig] = useState({
        turnover: {},
        storage: {},
        ai_optimization_level: 'alta'
    });
    const [mixLimits, setMixLimits] = useState({
        minuteria_max_skus: 3,
        nivel2_max_skus: 6,
        otros_niveles_max_skus: 4,
    });
    const [zoneRules, setZoneRules] = useState({
        cantilever_keywords: 'ROD, INTEGRAL STEEL',
        minuteria_weight_max: 0.1,
        minuteria_zone: 'Minuteria',
        heavy_weight_min: 10,
        heavy_levels: '3, 4, 5',
        high_rotation_levels: '0, 1',
        high_rotation_min_score: 1,
        high_rotation_max_score: 2,
        medium_rotation_levels: '1, 2',
        medium_rotation_min_score: 4,
        medium_rotation_max_score: 6,
        default_levels: '2',
        exile_sic_codes: '0, Z, L',
        exile_max_score: 3,
        exile_rack_levels: '2',
        ai_min_learn_score: 6
    });
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [searchTerm, setSearchSpec] = useState('');
    const [showUpload, setShowUpload] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

    const fetchSummary = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/slotting-summary', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setSummary(data);
            }
        } catch (err) { console.error(err); }
    }, []);

    const fetchConfig = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/slotting-config', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setConfig(prev => ({ ...prev, ...data }));
                if (data.mix_limits) setMixLimits(prev => ({ ...prev, ...data.mix_limits }));
                if (data.zone_rules) setZoneRules(prev => ({ ...prev, ...data.zone_rules }));
                fetchSummary();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [fetchSummary]);

    useEffect(() => {
        fetchConfig();
        if (setTitle) setTitle("Config. Slotting");
    }, [fetchConfig, setTitle]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const updatedConfig = {
                ...config,
                mix_limits: mixLimits,
                zone_rules: zoneRules
            };
            const res = await fetch('/api/admin/slotting-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedConfig),
                credentials: 'include'
            });
            if (res.ok) {
                setSuccess('Configuración actualizada correctamente.');
                setConfig(updatedConfig);
                fetchSummary();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleFileUpload = async () => {
        if (!selectedFile) return;
        if (!window.confirm("¿Está seguro de reemplazar TODO el layout actual?")) return;
        setSaving(true);
        const formData = new FormData();
        formData.append('file', selectedFile);
        try {
            const res = await fetch('/api/admin/slotting-upload', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) {
                setSuccess(data.message);
                setShowUpload(false);
                setSelectedFile(null);
                fetchConfig();
            }
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    };

    const updateBin = (binCode, field, value) => {
        const newConfig = { ...config };
        newConfig.storage[binCode][field] = value;
        setConfig(newConfig);
    };

    const handleSpotChange = (sic, newSpot) => {
        const newConfig = { ...config };
        if (newConfig.turnover[sic]) {
            newConfig.turnover[sic].spot = newSpot.toLowerCase();
            setConfig(newConfig);
        }
    };

    const handleMixLimitChange = (key, value) => {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
            setMixLimits(prev => ({ ...prev, [key]: numValue }));
        }
    };

    const handleZoneRuleChange = (key, value) => {
        setZoneRules(prev => ({ ...prev, [key]: value }));
    };

    const filteredBins = useMemo(() => {
        return Object.entries(config.storage || {})
            .filter(([code]) => code.toLowerCase().includes(searchTerm.toLowerCase()))
            .slice(0, 150);
    }, [config.storage, searchTerm]);

    const getSpotColor = (spot) => {
        switch (spot?.toLowerCase()) {
            case 'hot': return 'text-black font-normal';
            case 'warm': return 'text-black font-normal';
            case 'cold': return 'text-black font-normal';
            default: return 'text-zinc-400';
        }
    };

    return (
        <div className="max-w-[1400px] mx-auto px-6 pt-3 pb-6 font-sans bg-[#fcfcfc] min-h-screen text-black text-[12px] antialiased">

            <div className="flex justify-end items-center mb-2 border-b border-zinc-100 pb-1.5 text-black">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowUpload(!showUpload)}
                        className="h-8 px-3 bg-white border border-zinc-300 text-black hover:bg-zinc-50 transition-colors rounded text-[12px] uppercase font-normal shadow-sm"
                    >
                        Cargar Layout
                    </button>
                    <button
                        onClick={fetchConfig}
                        className="h-8 px-3 bg-white border border-zinc-300 text-black hover:bg-zinc-50 transition-colors rounded text-[12px] uppercase font-normal shadow-sm"
                    >
                        Refrescar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="h-8 px-4 bg-black text-white hover:bg-zinc-800 transition-colors rounded text-[12px] uppercase font-normal shadow-sm disabled:opacity-50"
                    >
                        {saving ? 'GUARDANDO...' : 'PUBLICAR CAMBIOS'}
                    </button>
                </div>
            </div>

            {success && <div className="bg-zinc-50 border border-zinc-200 text-black p-4 mb-6 rounded shadow-sm text-[12px] font-normal uppercase tracking-tight">{success}</div>}
            {error && <div className="bg-red-50 border border-red-100 text-red-700 p-4 mb-6 rounded shadow-sm text-[12px] font-normal uppercase tracking-tight">{error}</div>}

            <div className="flex border-b border-zinc-200 mb-6">
                <button
                    onClick={() => setActiveTab('storage')}
                    className={`px-6 py-3 text-[12px] font-normal border-b-2 transition-colors ${activeTab === 'storage' ? 'border-black text-black' : 'border-transparent text-black opacity-60 hover:opacity-100'}`}
                >
                    Mapa de Ubicaciones
                </button>
                <button
                    onClick={() => setActiveTab('turnover')}
                    className={`px-6 py-3 text-[12px] font-normal border-b-2 transition-colors ${activeTab === 'turnover' ? 'border-black text-black' : 'border-transparent text-black opacity-60 hover:opacity-100'}`}
                >
                    Parametros slotting
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <div className="lg:col-span-3 space-y-8">
                    {showUpload && (
                        <div className="bg-zinc-50 border border-zinc-200 rounded p-6 shadow-sm animate-fadeIn mb-8 text-black">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-[12px] text-black font-normal uppercase tracking-wider">Carga Masiva de Layout</h2>
                                <button onClick={() => window.location.href = '/api/admin/slotting-template'} className="text-[12px] font-normal text-black hover:underline uppercase tracking-widest">Descargar Plantilla</button>
                            </div>
                            <div
                                className="border-2 border-dashed border-zinc-200 rounded-lg p-8 text-center cursor-pointer hover:bg-white transition-colors bg-white/50"
                                onClick={() => fileInputRef.current.click()}
                            >
                                <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={e => setSelectedFile(e.target.files[0])} />
                                <p className="text-[12px] text-black font-normal uppercase tracking-widest">{selectedFile ? `Seleccionado: ${selectedFile.name}` : 'Haga clic para seleccionar archivo Excel'}</p>
                            </div>
                            <div className="mt-4 flex justify-end gap-3">
                                <button onClick={() => { setShowUpload(false); setSelectedFile(null); }} className="text-[12px] font-normal text-black px-4 py-2 uppercase tracking-widest">Cancelar</button>
                                <button onClick={handleFileUpload} disabled={!selectedFile || saving} className="bg-black text-white px-6 py-2 rounded text-[12px] font-normal uppercase tracking-widest hover:bg-zinc-800 transition-colors disabled:bg-zinc-100 disabled:text-zinc-400 shadow-sm">Subir y Reemplazar</button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'storage' ? (
                        <div className="bg-white rounded border border-zinc-200 overflow-hidden h-[calc(100vh-240px)] flex flex-col shadow-sm">
                            <div className="bg-zinc-50 px-4 py-2 border-b border-zinc-200 flex flex-row justify-between items-center gap-4 text-black">
                                <div className="flex-1 max-w-[180px]">
                                    <input
                                        type="text"
                                        placeholder="Buscar..."
                                        className="h-7 w-full px-2 text-[12px] font-normal border border-zinc-200 rounded focus:ring-0 focus:border-black outline-none transition-all uppercase placeholder:text-zinc-400 bg-white"
                                        value={searchTerm}
                                        onChange={e => setSearchSpec(e.target.value)}
                                    />
                                </div>
                                <div className="whitespace-nowrap shrink-0">
                                    <span className="text-[12px] text-black font-normal uppercase tracking-tight">{filteredBins.length} registros</span>
                                </div>
                            </div>
                            <div className="overflow-auto flex-1 custom-scrollbar text-black">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-zinc-100 border-b border-zinc-200 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-2 text-[12px] font-normal uppercase tracking-wider text-white">BIN</th>
                                            <th className="px-4 py-2 text-[12px] font-normal uppercase tracking-wider text-white">ZONA</th>
                                            <th className="px-4 py-2 text-[12px] font-normal uppercase tracking-wider text-center w-20 text-white">PASILLO</th>
                                            <th className="px-4 py-2 text-[12px] font-normal uppercase tracking-wider text-center w-20 text-white">NIVEL</th>
                                            <th className="px-4 py-2 text-[12px] font-normal uppercase tracking-wider text-center text-white">SPOT</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-50">
                                        {loading ? (
                                            <tr><td colSpan="5" className="p-8 text-center text-black text-[12px] font-normal uppercase tracking-widest italic animate-pulse">Cargando layout...</td></tr>
                                        ) : (
                                            filteredBins.map(([code, info]) => (
                                                <tr key={code} className="hover:bg-zinc-50 transition-colors leading-none text-black">
                                                    <td className="px-4 py-3 font-mono text-[12px] font-normal uppercase tracking-tight">{code}</td>
                                                    <td className="px-4 py-3">
                                                        <select value={info.zone} onChange={e => updateBin(code, 'zone', e.target.value)} className="bg-transparent border-none text-[12px] font-normal uppercase focus:ring-0 p-0 h-7 w-full cursor-pointer tracking-tight text-black">
                                                            <option value="Rack">Rack</option>
                                                            <option value="Minuteria">Minutería</option>
                                                            <option value="Cantilever">Cantilever</option>
                                                            <option value="Floor">Piso / Isla</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-4 py-3 text-center w-20">
                                                        <input type="text" value={info.aisle} onChange={e => updateBin(code, 'aisle', e.target.value)} className="bg-white border border-zinc-200 rounded w-10 text-[12px] font-normal text-center h-7 p-0 font-mono text-black" />
                                                    </td>
                                                    <td className="px-4 py-3 text-center w-20">
                                                        <input type="text" value={info.level} onChange={e => updateBin(code, 'level', e.target.value)} className="bg-white border border-zinc-200 rounded w-10 text-[12px] font-normal text-center h-7 p-0 font-mono text-black" />
                                                    </td>
                                                    <td className="px-4 py-3 text-center leading-none">
                                                        <select value={info.spot} onChange={e => updateBin(code, 'spot', e.target.value)} className={`bg-transparent border-none text-[12px] font-normal uppercase focus:ring-0 p-0 h-7 w-full cursor-pointer tracking-tight text-center ${getSpotColor(info.spot)}`}>
                                                            <option value="Hot" className="text-black font-normal">Hot</option>
                                                            <option value="Warm" className="text-black font-normal">Warm</option>
                                                            <option value="Cold" className="text-black font-normal">Cold</option>
                                                        </select>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-8 animate-fadeIn text-black">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* 01. Jerarquía de Rotación */}
                                <div className="bg-white rounded border border-zinc-200 overflow-hidden flex flex-col shadow-sm text-black">
                                    <div className="bg-zinc-50 px-4 py-2 border-b border-zinc-200 flex items-center gap-2 text-black font-normal uppercase tracking-wider">
                                        <span className="text-[12px] text-black">Jerarquía de Rotación (SIC)</span>
                                    </div>
                                    <div className="overflow-auto no-scrollbar">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-zinc-100 border-b border-zinc-200">
                                                <tr>
                                                    <th className="px-4 py-2 text-[12px] font-normal !bg-none !bg-transparent text-black uppercase tracking-wider">SIC</th>
                                                    <th className="px-4 py-2 text-[12px] font-normal !bg-none !bg-transparent text-black uppercase tracking-wider">Hits (Frecuencia)</th>
                                                    <th className="px-4 py-2 text-[12px] font-normal !bg-none !bg-transparent text-black uppercase tracking-wider">Spot Ideal</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-50 text-black">
                                                {Object.entries(config.turnover || {})
                                                    .sort((a, b) => {
                                                        const order = ['W', 'X', 'Y', 'K', 'L', 'Z', '0'];
                                                        let idxA = order.indexOf(a[0]);
                                                        let idxB = order.indexOf(b[0]);
                                                        if (idxA === -1) idxA = 99;
                                                        if (idxB === -1) idxB = 99;
                                                        return idxA - idxB;
                                                    })
                                                    .map(([sic, info]) => (
                                                        <tr key={sic} className="hover:bg-zinc-50 transition-colors leading-none text-black">
                                                            <td className="px-4 py-3 font-mono text-[12px] font-normal text-black uppercase">{sic}</td>
                                                            <td className="px-4 py-3 text-[12px] text-black font-normal">{info.range}</td>
                                                            <td className="px-4 py-3">
                                                                <select
                                                                    value={info.spot?.charAt(0).toUpperCase() + info.spot?.slice(1).toLowerCase()}
                                                                    onChange={(e) => handleSpotChange(sic, e.target.value)}
                                                                    className="bg-transparent border-none text-[12px] font-normal uppercase focus:ring-0 p-0 h-7 w-24 cursor-pointer tracking-tight text-black text-center"
                                                                >
                                                                    <option value="Hot">Hot</option>
                                                                    <option value="Warm">Warm</option>
                                                                    <option value="Cold">Cold</option>
                                                                </select>
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* 02. Zonificación Física Automática */}
                                <div className="bg-white rounded border border-zinc-200 overflow-hidden flex flex-col shadow-sm text-black">
                                    <div className="bg-zinc-50 px-4 py-2 border-b border-zinc-200 flex items-center gap-2 text-[12px] text-black font-normal uppercase tracking-wider">
                                        <span>Zonificación Física Automática</span>
                                    </div>
                                    <div className="p-4 space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase leading-tight text-black">Cantilever</span>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-black uppercase tracking-tighter text-[12px]">PALABRAS CLAVE:</span>
                                                    <input
                                                        type="text"
                                                        value={zoneRules.cantilever_keywords}
                                                        onChange={(e) => handleZoneRuleChange('cantilever_keywords', e.target.value)}
                                                        className="no-spinner h-5 !w-60 min-w-0 !px-1 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-normal text-black uppercase text-[12px] leading-tight text-black">Minutería (Peso &lt;)</span>
                                                    <input
                                                        type="number" step="0.01"
                                                        value={zoneRules.minuteria_weight_max}
                                                        onChange={(e) => handleZoneRuleChange('minuteria_weight_max', parseFloat(e.target.value) || 0.1)}
                                                        className="no-spinner h-5 !w-16 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    />
                                                    <span className="font-normal text-black uppercase tracking-tighter">KG</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-black uppercase tracking-tighter text-[12px]">ZONA:</span>
                                                    <select
                                                        value={zoneRules.minuteria_zone}
                                                        onChange={(e) => handleZoneRuleChange('minuteria_zone', e.target.value)}
                                                        className="h-7 px-1 py-0 text-[12px] font-normal border border-zinc-200 rounded text-black outline-none focus:border-black bg-transparent cursor-pointer uppercase shadow-none text-black"
                                                    >
                                                        <option value="Minuteria">Minutería</option>
                                                        <option value="Rack">Rack</option>
                                                        <option value="Cantilever">Cantilever</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <div className="flex items-center gap-2 text-black">
                                                    <span className="font-normal text-black uppercase text-[12px] leading-tight text-black">Pesados (Peso &gt;)</span>
                                                    <input
                                                        type="number"
                                                        value={zoneRules.heavy_weight_min}
                                                        onChange={(e) => handleZoneRuleChange('heavy_weight_min', parseFloat(e.target.value) || 10)}
                                                        className="no-spinner h-5 !w-16 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    />
                                                    <span className="font-normal text-black uppercase tracking-tighter">KG</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-black uppercase tracking-tighter text-[12px]">NIVELES:</span>
                                                    <input
                                                        type="text"
                                                        value={zoneRules.heavy_levels}
                                                        onChange={(e) => handleZoneRuleChange('heavy_levels', e.target.value)}
                                                        className="no-spinner h-5 !w-20 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase leading-tight text-black">Alta Rotación (W, X)</span>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-black uppercase tracking-tighter text-[12px]">NIVELES:</span>
                                                        <input
                                                            type="text"
                                                            value={zoneRules.high_rotation_levels}
                                                            onChange={(e) => handleZoneRuleChange('high_rotation_levels', e.target.value)}
                                                            className="no-spinner h-5 !w-16 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-black uppercase tracking-tighter text-[12px]">SCORE UBIC (MÍN-MÁX):</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <input
                                                                type="number"
                                                                value={zoneRules.high_rotation_min_score}
                                                                onChange={(e) => handleZoneRuleChange('high_rotation_min_score', parseInt(e.target.value) || 0)}
                                                                className="no-spinner h-5 !w-10 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                            />
                                                            <span className="text-zinc-300">-</span>
                                                            <input
                                                                type="number"
                                                                value={zoneRules.high_rotation_max_score}
                                                                onChange={(e) => handleZoneRuleChange('high_rotation_max_score', parseInt(e.target.value) || 0)}
                                                                className="no-spinner h-5 !w-10 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase leading-tight text-black">Media Rotación (Y, K)</span>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-black uppercase tracking-tighter text-[12px]">NIVELES:</span>
                                                        <input
                                                            type="text"
                                                            value={zoneRules.medium_rotation_levels}
                                                            onChange={(e) => handleZoneRuleChange('medium_rotation_levels', e.target.value)}
                                                            className="no-spinner h-5 !w-16 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-black uppercase tracking-tighter text-[12px]">SCORE UBIC (MÍN-MÁX):</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <input
                                                                type="number"
                                                                value={zoneRules.medium_rotation_min_score}
                                                                onChange={(e) => handleZoneRuleChange('medium_rotation_min_score', parseInt(e.target.value) || 0)}
                                                                className="no-spinner h-5 !w-10 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                            />
                                                            <span className="text-zinc-300">-</span>
                                                            <input
                                                                type="number"
                                                                value={zoneRules.medium_rotation_max_score}
                                                                onChange={(e) => handleZoneRuleChange('medium_rotation_max_score', parseInt(e.target.value) || 0)}
                                                                className="no-spinner h-5 !w-10 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-[12px] text-black italic leading-tight uppercase font-normal text-center mt-2">Las reglas físicas prevalecen sobre el motor de IA para garantizar seguridad operacional.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* 03. Límites de Mezcla de SKUs */}
                                <div className="bg-white rounded border border-zinc-200 overflow-hidden flex flex-col shadow-sm text-black">
                                    <div className="bg-zinc-50 px-4 py-2 border-b border-zinc-200 flex items-center gap-2 text-[12px] text-black font-normal uppercase tracking-wider">
                                        <span>Límites de Mezcla de SKUs</span>
                                    </div>
                                    <div className="p-4 space-y-4">
                                        <div className="flex justify-between items-center p-3 bg-zinc-50/50 border border-zinc-100 rounded shadow-none text-black">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-normal uppercase text-black leading-tight">Ubicaciones Minutería</span>
                                                <span className="text-[12px] uppercase text-black leading-none mt-1">Gavetas y cajones</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={mixLimits.minuteria_max_skus}
                                                    onChange={(e) => handleMixLimitChange('minuteria_max_skus', e.target.value)}
                                                    className="no-spinner h-5 !w-20 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                />
                                                <span className="text-[12px] font-normal text-black uppercase">SKUs</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center p-3 bg-zinc-50/50 border border-zinc-100 rounded shadow-none text-black">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-normal uppercase text-black leading-tight">Nivel de Recolección (N2)</span>
                                                <span className="text-[12px] uppercase text-black leading-none mt-1">Picking manual intensivo</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={mixLimits.nivel2_max_skus}
                                                    onChange={(e) => handleMixLimitChange('nivel2_max_skus', e.target.value)}
                                                    className="no-spinner h-5 !w-20 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                />
                                                <span className="text-[12px] font-normal text-black uppercase">SKUs</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center p-3 bg-zinc-50/50 border border-zinc-100 rounded shadow-none text-black">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-normal uppercase text-black leading-tight">Otros Niveles Rack</span>
                                                <span className="text-[12px] uppercase text-black leading-none mt-1">Reserva y aéreos</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={mixLimits.otros_niveles_max_skus}
                                                    onChange={(e) => handleMixLimitChange('otros_niveles_max_skus', e.target.value)}
                                                    className="no-spinner h-5 !w-20 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                />
                                                <span className="text-[12px] font-normal text-black uppercase">SKUs</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 04. Matriz de Exilio y Calidad IA */}
                                <div className="bg-white rounded border border-zinc-200 overflow-hidden flex flex-col shadow-sm text-black">
                                    <div className="bg-zinc-50 px-4 py-2 border-b border-zinc-200 flex items-center gap-2 text-[12px] text-black font-normal uppercase tracking-wider">
                                        <span>Matriz de Exilio y Calidad IA</span>
                                    </div>
                                    <div className="p-4 space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase leading-tight">SICs de Baja Rotación</span>
                                                <input
                                                    type="text"
                                                    value={zoneRules.exile_sic_codes}
                                                    onChange={(e) => handleZoneRuleChange('exile_sic_codes', e.target.value)}
                                                    className="no-spinner h-5 !w-20 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    placeholder="0, Z, L"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase leading-tight">Score Máximo Exilio</span>
                                                <input
                                                    type="number"
                                                    value={zoneRules.exile_max_score}
                                                    onChange={(e) => handleZoneRuleChange('exile_max_score', parseInt(e.target.value) || 0)}
                                                    className="no-spinner h-5 !w-16 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase leading-tight">Niveles Rack Exilio</span>
                                                <input
                                                    type="text"
                                                    value={zoneRules.exile_rack_levels}
                                                    onChange={(e) => handleZoneRuleChange('exile_rack_levels', e.target.value)}
                                                    className="no-spinner h-5 !w-20 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    placeholder="2, 3"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-zinc-50 pb-2 text-black">
                                                <span className="font-normal text-black uppercase italic leading-tight text-[12px]">Calidad Aprendizaje IA</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] text-black uppercase leading-tight">Score Min:</span>
                                                    <input
                                                        type="number"
                                                        value={zoneRules.ai_min_learn_score}
                                                        onChange={(e) => handleZoneRuleChange('ai_min_learn_score', parseInt(e.target.value) || 6)}
                                                        className="no-spinner h-5 !w-16 min-w-0 !py-0 !px-1 text-[12px] font-mono font-normal text-center border border-zinc-200 rounded text-black outline-none focus:border-black shadow-none bg-white"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-[12px] text-black italic leading-tight uppercase font-normal text-center mt-2">Estos parámetros definen el comportamiento estricto del exilio y el filtro de calidad de la IA.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="mt-4 text-[12px] text-black font-normal uppercase tracking-[0.2em] text-center italic">
                        {activeTab === 'storage' ? `Visualización del Layout Maestro` : 'Configuración de Reglas Operativas y Parámetros de Optimización'}
                    </div>
                </div>

                {/* Right Panel: Summary Dashboard (ORIGINAL STATS RESTORED) */}
                <div className="lg:col-span-1">
                    <div className="bg-white p-6 rounded shadow-sm border border-black sticky top-20 overflow-y-auto h-[calc(100vh-240px)] custom-scrollbar text-black">
                        <h2 className="text-[12px] font-normal mb-4 border-b border-black pb-2 uppercase tracking-tight leading-tight text-black">
                            Estado del Almacén
                        </h2>
                        {!summary ? (
                            <div className="text-[12px] uppercase text-black italic font-normal text-center py-8">Calculando estadísticas...</div>
                        ) : (
                            <div className="space-y-6 text-black">
                                <div>
                                    <h3 className="text-[12px] font-normal text-black uppercase tracking-widest mb-3 tracking-tighter">Capacidad Física</h3>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center text-[12px] border-b border-black pb-1">
                                            <span className="uppercase text-[12px] font-normal text-black">Total Bins</span>
                                            <span className="font-mono font-normal text-black text-right min-w-[60px]">{summary.total}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-[12px] border-b border-black pb-1">
                                            <span className="uppercase text-[12px] font-normal text-black">Bins en Uso</span>
                                            <span className="font-mono font-normal text-black text-right min-w-[60px]">{summary.in_use}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-[12px]">
                                            <span className="uppercase text-[12px] font-normal text-black">Disponibles</span>
                                            <span className="font-mono font-normal text-black text-right min-w-[60px]">{summary.free}</span>
                                        </div>
                                        <div className="pt-2">
                                            <div className="flex justify-between text-[12px] font-normal text-black mb-1 uppercase tracking-tight">
                                                <span>Índice de Ocupación</span>
                                                <span className={summary.occupancy_pct > 90 ? 'text-red-600 font-normal' : 'text-black font-normal'}>{summary.occupancy_pct}%</span>
                                            </div>
                                            <div className="w-full bg-black/10 rounded-full h-1.5 overflow-hidden shadow-inner">
                                                <div className={`h-full transition-all duration-1000 ${summary.occupancy_pct > 90 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${summary.occupancy_pct}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-[12px] font-normal text-black uppercase tracking-widest mb-3 border-t border-black pt-4 text-black">Carga por Zona</h3>
                                    <div className="space-y-2">
                                        {Object.entries(summary.zones_by_items || {}).map(([zone, count]) => (
                                            <div key={zone} className="flex justify-between items-center text-[12px] group py-0.5 border-b border-transparent hover:border-black">
                                                <div className="flex items-center gap-2 text-black">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-black group-hover:bg-zinc-800 transition-colors"></span>
                                                    <span className="group-hover:text-black transition-colors uppercase font-normal text-[12px] text-black">{zone}</span>
                                                </div>
                                                <span className="font-mono font-normal text-black">{count} <span className="text-[12px] text-black">PZS</span></span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-[12px] font-normal text-black uppercase tracking-widest mb-3 border-t border-black pt-4 text-black">Pasillos Críticos</h3>
                                    <div className="space-y-2">
                                        {Object.entries(summary.top_aisles || {}).map(([aisle, count]) => (
                                            <div key={aisle} className="flex justify-between items-center text-[12px] group py-0.5 border-b border-transparent hover:border-black">
                                                <div className="flex items-center gap-2 text-black">
                                                    <span className="text-black group-hover:text-black transition-colors uppercase font-normal text-[12px] text-black">Pasillo {aisle}</span>
                                                </div>
                                                <span className="font-mono font-normal text-black">{count} <span className="text-[12px] text-black">PZS</span></span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-[12px] font-normal text-black uppercase tracking-widest mb-3 border-t border-black pt-4 text-black">Saturación</h3>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center text-[12px] border-b border-black pb-1 text-black">
                                            <span className="text-black uppercase font-normal text-[12px]">Ítems Totales</span>
                                            <span className="font-mono font-normal text-black">{summary.total_items_in_bins ?? '—'}</span>
                                        </div>
                                        <div className="pt-1">
                                            <div className="flex justify-between text-[12px] font-normal text-black mb-1 uppercase text-black">
                                                <span>Promedio ítems / bin</span>
                                                <span className={(summary.avg_items_per_bin ?? 0) > 5 ? 'text-red-600' : 'text-black'}>{summary.avg_items_per_bin ?? '—'}</span>
                                            </div>
                                            <div className="w-full bg-black/10 rounded-full h-1.5 overflow-hidden">
                                                <div className="h-full bg-blue-500" style={{ width: `${Math.min(((summary.avg_items_per_bin ?? 0) / 8) * 100, 100)}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SlottingConfig;
