import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { isUserAdmin, hasUserPermission } from '../utils/permissions';

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

    const currentUser = useMemo(() => {
        try {
            const raw = localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }, []);
    const isAdmin = useMemo(() => isUserAdmin(currentUser), [currentUser]);
    const canUpload = useMemo(() => {
        return isUserAdmin(currentUser) || hasUserPermission(currentUser, 'admin_slotting') || hasUserPermission(currentUser, 'update');
    }, [currentUser]);

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
        setError(null);
        setSuccess(null);
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
                setSuccess(data.message || 'Layout de almacén actualizado correctamente.');
                setShowUpload(false);
                setSelectedFile(null);
                await fetchConfig();
            } else {
                setError(data.error || 'No se pudo cargar el archivo de layout.');
            }
        } catch (err) {
            setError(err.message || 'Error al subir el archivo.');
        } finally {
            setSaving(false);
        }
    };

    const handleDownloadTemplate = () => {
        try {
            const templateData = [
                { BIN: 'A-01-1-01', ZONA: 'Rack', PASILLO: '01', NIVEL: 1, SPOT: 'Hot', SCORE: 10 },
                { BIN: 'A-01-2-01', ZONA: 'Rack', PASILLO: '01', NIVEL: 2, SPOT: 'Warm', SCORE: 6 },
                { BIN: 'M-01-1-01', ZONA: 'Minuteria', PASILLO: 'M1', NIVEL: 1, SPOT: 'Hot', SCORE: 10 },
                { BIN: 'C-01-1-01', ZONA: 'Cantilever', PASILLO: 'C1', NIVEL: 1, SPOT: 'Cold', SCORE: 2 }
            ];
            const ws = XLSX.utils.json_to_sheet(templateData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Layout");
            XLSX.writeFile(wb, "layout_slotting_plantilla.xlsx");
        } catch (e) {
            console.error("Error descargando plantilla:", e);
        }
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
            default: return 'text-black font-normal';
        }
    };

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f] text-[12px] antialiased">
            <div className="flex justify-between items-center mb-3 border-b border-[#e5e7eb] pb-2 text-[#1f1f1f]">
                <h1 className="text-[14px] font-normal text-gray-800 tracking-normal">Configuración de Slotting y Reglas de Almacén</h1>
                <div className="flex items-center gap-2">
                    {canUpload && (
                        <button
                            onClick={() => setShowUpload(!showUpload)}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] rounded text-[12px] font-normal transition-colors cursor-pointer"
                        >
                            Cargar Layout
                        </button>
                    )}
                    <button
                        onClick={fetchConfig}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] rounded text-[12px] font-normal transition-colors cursor-pointer"
                    >
                        Refrescar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {saving ? 'Guardando...' : 'Publicar Cambios'}
                    </button>
                </div>
            </div>

            {success && <div className="bg-green-50 border border-green-200 text-green-800 p-2.5 mb-3 rounded text-[12px] font-normal">{success}</div>}
            {error && <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 mb-3 rounded text-[12px] font-normal">{error}</div>}

            <div className="flex border-b border-[#d1d5db] mb-4 gap-1">
                <button
                    onClick={() => setActiveTab('storage')}
                    className={`px-4 py-1.5 text-[12px] font-normal border-b-2 transition-colors cursor-pointer ${activeTab === 'storage' ? 'border-[#0067c0] text-[#0067c0]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
                >
                    Mapa de Ubicaciones
                </button>
                <button
                    onClick={() => setActiveTab('turnover')}
                    className={`px-4 py-1.5 text-[12px] font-normal border-b-2 transition-colors cursor-pointer ${activeTab === 'turnover' ? 'border-[#0067c0] text-[#0067c0]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
                >
                    Parámetros de Slotting
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-3 space-y-4">
                    {canUpload && showUpload && (
                        <div className="bg-white border border-[#d1d5db] rounded p-4 shadow-xs mb-4 text-[#1f1f1f]">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-[13px] text-gray-800 font-normal">Carga Masiva de Layout</h2>
                                <button type="button" onClick={handleDownloadTemplate} className="text-[12px] font-normal text-[#0067c0] hover:underline cursor-pointer">Descargar Plantilla</button>
                            </div>
                            <div
                                className="border border-dashed border-[#d1d5db] rounded p-6 text-center cursor-pointer hover:bg-[#f8f9fa] transition-colors bg-[#f8f9fa]/50"
                                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                            >
                                <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls,.csv" onChange={e => setSelectedFile(e.target.files[0])} />
                                <p className="text-[12px] text-gray-600 font-normal">{selectedFile ? `Seleccionado: ${selectedFile.name}` : 'Haga clic para seleccionar archivo Excel o CSV (.xlsx, .xls, .csv)'}</p>
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                                <button onClick={() => { setShowUpload(false); setSelectedFile(null); }} className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer">Cancelar</button>
                                <button onClick={handleFileUpload} disabled={!selectedFile || saving} className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal transition-colors disabled:opacity-50 cursor-pointer">Subir y Reemplazar</button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'storage' ? (
                        <div className="bg-white rounded border border-[#d1d5db] overflow-hidden h-[calc(100vh-210px)] flex flex-col shadow-xs">
                            <div className="bg-[#f8f9fa] px-3 py-2 border-b border-[#e5e7eb] flex flex-row justify-between items-center gap-4 text-[#1f1f1f]">
                                <div className="flex-1 max-w-[220px]">
                                    <input
                                        type="text"
                                        placeholder="Buscar BIN..."
                                        className="h-7 w-full px-2 text-[12px] font-normal border border-[#d1d5db] rounded focus:border-[#0067c0] outline-none transition-all uppercase bg-white text-[#1f1f1f]"
                                        value={searchTerm}
                                        onChange={e => setSearchSpec(e.target.value)}
                                    />
                                </div>
                                <div className="whitespace-nowrap shrink-0">
                                    <span className="text-[11px] text-gray-600 font-normal">{filteredBins.length} registros</span>
                                </div>
                            </div>
                            <div className="overflow-auto flex-1 custom-scrollbar text-[#1f1f1f]">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-[#354a5f] text-white border-b border-[#2a3c4e] sticky top-0 z-10">
                                        <tr>
                                            <th className="px-3 py-2 text-[11px] font-normal">BIN</th>
                                            <th className="px-3 py-2 text-[11px] font-normal">ZONA</th>
                                            <th className="px-3 py-2 text-[11px] font-normal text-center w-20">PASILLO</th>
                                            <th className="px-3 py-2 text-[11px] font-normal text-center w-20">NIVEL</th>
                                            <th className="px-3 py-2 text-[11px] font-normal text-center">SPOT</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#f0f0f0]">
                                        {loading ? (
                                            <tr><td colSpan="5" className="p-8 text-center text-gray-500 text-[12px] font-normal italic animate-pulse">Cargando layout...</td></tr>
                                        ) : (
                                            filteredBins.map(([code, info], idx) => (
                                                <tr key={code} className={`hover:bg-[#edf3f9] transition-colors leading-none text-[#1f1f1f] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}>
                                                    <td className="px-3 py-2 font-mono text-[12px] font-normal">{code}</td>
                                                    <td className="px-3 py-2">
                                                        <select value={info.zone} onChange={e => updateBin(code, 'zone', e.target.value)} className="bg-transparent border border-transparent hover:border-[#d1d5db] rounded text-[12px] font-normal focus:border-[#0067c0] px-1 h-6 w-full cursor-pointer text-[#1f1f1f]">
                                                            <option value="Rack">Rack</option>
                                                            <option value="Minuteria">Minutería</option>
                                                            <option value="Cantilever">Cantilever</option>
                                                            <option value="Floor">Piso / Isla</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2 text-center w-20">
                                                        <input type="text" value={info.aisle} onChange={e => updateBin(code, 'aisle', e.target.value)} className="bg-white border border-[#d1d5db] rounded w-12 text-[12px] font-normal text-center h-6 p-0 font-mono text-[#1f1f1f] focus:border-[#0067c0] outline-none" />
                                                    </td>
                                                    <td className="px-3 py-2 text-center w-20">
                                                        <input type="text" value={info.level} onChange={e => updateBin(code, 'level', e.target.value)} className="bg-white border border-[#d1d5db] rounded w-12 text-[12px] font-normal text-center h-6 p-0 font-mono text-[#1f1f1f] focus:border-[#0067c0] outline-none" />
                                                    </td>
                                                    <td className="px-3 py-2 text-center leading-none">
                                                        <select value={info.spot} onChange={e => updateBin(code, 'spot', e.target.value)} className={`bg-transparent border border-transparent hover:border-[#d1d5db] rounded text-[12px] font-normal px-1 h-6 w-24 cursor-pointer text-center text-[#1f1f1f]`}>
                                                            <option value="Hot">Hot</option>
                                                            <option value="Warm">Warm</option>
                                                            <option value="Cold">Cold</option>
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
                        <div className="space-y-4 animate-fadeIn text-[#1f1f1f]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* 01. Jerarquía de Rotación */}
                                <div className="bg-white rounded border border-[#d1d5db] overflow-hidden flex flex-col shadow-xs text-[#1f1f1f]">
                                    <div className="bg-[#354a5f] text-white px-3 py-2 border-b border-[#2a3c4e] flex items-center gap-2">
                                        <span className="text-[12px] font-normal">Jerarquía de Rotación (SIC)</span>
                                    </div>
                                    <div className="overflow-auto no-scrollbar">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-[#f8f9fa] border-b border-[#d1d5db]">
                                                <tr>
                                                    <th className="px-3 py-2 text-[11px] font-normal text-gray-700">SIC</th>
                                                    <th className="px-3 py-2 text-[11px] font-normal text-gray-700">Hits (Frecuencia)</th>
                                                    <th className="px-3 py-2 text-[11px] font-normal text-gray-700">Spot Ideal</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#f0f0f0] text-[#1f1f1f]">
                                                {Object.entries(config.turnover || {})
                                                    .sort((a, b) => {
                                                        const order = ['W', 'X', 'Y', 'K', 'L', 'Z', '0'];
                                                        let idxA = order.indexOf(a[0]);
                                                        let idxB = order.indexOf(b[0]);
                                                        if (idxA === -1) idxA = 99;
                                                        if (idxB === -1) idxB = 99;
                                                        return idxA - idxB;
                                                    })
                                                    .map(([sic, info], idx) => (
                                                        <tr key={sic} className={`hover:bg-[#edf3f9] transition-colors leading-none text-[#1f1f1f] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}>
                                                            <td className="px-3 py-2 font-mono text-[12px] font-normal text-gray-900">{sic}</td>
                                                            <td className="px-3 py-2 text-[12px] text-gray-700 font-normal">{info.range}</td>
                                                            <td className="px-3 py-2">
                                                                <select
                                                                    value={info.spot?.charAt(0).toUpperCase() + info.spot?.slice(1).toLowerCase()}
                                                                    onChange={(e) => handleSpotChange(sic, e.target.value)}
                                                                    className="bg-transparent border border-[#d1d5db] rounded text-[12px] font-normal px-2 h-6 w-24 cursor-pointer text-gray-800 text-center"
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
                                <div className="bg-white rounded border border-[#d1d5db] overflow-hidden flex flex-col shadow-xs text-[#1f1f1f]">
                                    <div className="bg-[#354a5f] text-white px-3 py-2 border-b border-[#2a3c4e] flex items-center gap-2">
                                        <span className="text-[12px] font-normal">Zonificación Física Automática</span>
                                    </div>
                                    <div className="p-3 space-y-3">
                                        <div className="space-y-2.5">
                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">Cantilever</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-600 text-[11px]">Palabras clave:</span>
                                                    <input
                                                        type="text"
                                                        value={zoneRules.cantilever_keywords}
                                                        onChange={(e) => handleZoneRuleChange('cantilever_keywords', e.target.value)}
                                                        className="h-6 w-48 px-2 text-[11.5px] font-normal border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-normal text-gray-800 text-[12px]">Minutería (Peso &lt;)</span>
                                                    <input
                                                        type="number" step="0.01"
                                                        value={zoneRules.minuteria_weight_max}
                                                        onChange={(e) => handleZoneRuleChange('minuteria_weight_max', parseFloat(e.target.value) || 0.1)}
                                                        className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    />
                                                    <span className="font-normal text-gray-500 text-[11px]">KG</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-600 text-[11px]">Zona:</span>
                                                    <select
                                                        value={zoneRules.minuteria_zone}
                                                        onChange={(e) => handleZoneRuleChange('minuteria_zone', e.target.value)}
                                                        className="h-6 px-2 text-[11.5px] font-normal border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white cursor-pointer"
                                                    >
                                                        <option value="Minuteria">Minutería</option>
                                                        <option value="Rack">Rack</option>
                                                        <option value="Cantilever">Cantilever</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-normal text-gray-800 text-[12px]">Pesados (Peso &gt;)</span>
                                                    <input
                                                        type="number"
                                                        value={zoneRules.heavy_weight_min}
                                                        onChange={(e) => handleZoneRuleChange('heavy_weight_min', parseFloat(e.target.value) || 10)}
                                                        className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    />
                                                    <span className="font-normal text-gray-500 text-[11px]">KG</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-600 text-[11px]">Niveles:</span>
                                                    <input
                                                        type="text"
                                                        value={zoneRules.heavy_levels}
                                                        onChange={(e) => handleZoneRuleChange('heavy_levels', e.target.value)}
                                                        className="h-6 w-20 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">Alta Rotación (W, X)</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-gray-600 text-[11px]">Niveles:</span>
                                                        <input
                                                            type="text"
                                                            value={zoneRules.high_rotation_levels}
                                                            onChange={(e) => handleZoneRuleChange('high_rotation_levels', e.target.value)}
                                                            className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-gray-600 text-[11px]">Score:</span>
                                                        <input
                                                            type="number"
                                                            value={zoneRules.high_rotation_min_score}
                                                            onChange={(e) => handleZoneRuleChange('high_rotation_min_score', parseInt(e.target.value) || 0)}
                                                            className="h-6 w-10 px-1 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                        />
                                                        <span className="text-gray-400">-</span>
                                                        <input
                                                            type="number"
                                                            value={zoneRules.high_rotation_max_score}
                                                            onChange={(e) => handleZoneRuleChange('high_rotation_max_score', parseInt(e.target.value) || 0)}
                                                            className="h-6 w-10 px-1 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">Media Rotación (Y, K)</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-gray-600 text-[11px]">Niveles:</span>
                                                        <input
                                                            type="text"
                                                            value={zoneRules.medium_rotation_levels}
                                                            onChange={(e) => handleZoneRuleChange('medium_rotation_levels', e.target.value)}
                                                            className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-gray-600 text-[11px]">Score:</span>
                                                        <input
                                                            type="number"
                                                            value={zoneRules.medium_rotation_min_score}
                                                            onChange={(e) => handleZoneRuleChange('medium_rotation_min_score', parseInt(e.target.value) || 0)}
                                                            className="h-6 w-10 px-1 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                        />
                                                        <span className="text-gray-400">-</span>
                                                        <input
                                                            type="number"
                                                            value={zoneRules.medium_rotation_max_score}
                                                            onChange={(e) => handleZoneRuleChange('medium_rotation_max_score', parseInt(e.target.value) || 0)}
                                                            className="h-6 w-10 px-1 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-gray-500 italic font-normal text-center mt-2">Las reglas físicas prevalecen sobre el motor de IA para garantizar seguridad operacional.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* 03. Límites de Mezcla de SKUs */}
                                <div className="bg-white rounded border border-[#d1d5db] overflow-hidden flex flex-col shadow-xs text-[#1f1f1f]">
                                    <div className="bg-[#354a5f] text-white px-3 py-2 border-b border-[#2a3c4e] flex items-center gap-2">
                                        <span className="text-[12px] font-normal">Límites de Mezcla de SKUs</span>
                                    </div>
                                    <div className="p-3 space-y-3">
                                        <div className="flex justify-between items-center p-2 bg-[#f8f9fa] border border-[#e5e7eb] rounded text-[#1f1f1f]">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-normal text-gray-800">Ubicaciones Minutería</span>
                                                <span className="text-[11px] text-gray-500 font-normal">Gavetas y cajones</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number"
                                                    value={mixLimits.minuteria_max_skus}
                                                    onChange={(e) => handleMixLimitChange('minuteria_max_skus', e.target.value)}
                                                    className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                />
                                                <span className="text-[11px] font-normal text-gray-600">SKUs</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center p-2 bg-[#f8f9fa] border border-[#e5e7eb] rounded text-[#1f1f1f]">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-normal text-gray-800">Nivel de Recolección (N2)</span>
                                                <span className="text-[11px] text-gray-500 font-normal">Picking manual intensivo</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number"
                                                    value={mixLimits.nivel2_max_skus}
                                                    onChange={(e) => handleMixLimitChange('nivel2_max_skus', e.target.value)}
                                                    className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                />
                                                <span className="text-[11px] font-normal text-gray-600">SKUs</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center p-2 bg-[#f8f9fa] border border-[#e5e7eb] rounded text-[#1f1f1f]">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-normal text-gray-800">Otros Niveles Rack</span>
                                                <span className="text-[11px] text-gray-500 font-normal">Reserva y aéreos</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number"
                                                    value={mixLimits.otros_niveles_max_skus}
                                                    onChange={(e) => handleMixLimitChange('otros_niveles_max_skus', e.target.value)}
                                                    className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                />
                                                <span className="text-[11px] font-normal text-gray-600">SKUs</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 04. Matriz de Exilio y Calidad IA */}
                                <div className="bg-white rounded border border-[#d1d5db] overflow-hidden flex flex-col shadow-xs text-[#1f1f1f]">
                                    <div className="bg-[#354a5f] text-white px-3 py-2 border-b border-[#2a3c4e] flex items-center gap-2">
                                        <span className="text-[12px] font-normal">Matriz de Exilio y Calidad IA</span>
                                    </div>
                                    <div className="p-3 space-y-3">
                                        <div className="space-y-2.5">
                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">SICs de Baja Rotación</span>
                                                <input
                                                    type="text"
                                                    value={zoneRules.exile_sic_codes}
                                                    onChange={(e) => handleZoneRuleChange('exile_sic_codes', e.target.value)}
                                                    className="h-6 w-24 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    placeholder="0, Z, L"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">Score Máximo Exilio</span>
                                                <input
                                                    type="number"
                                                    value={zoneRules.exile_max_score}
                                                    onChange={(e) => handleZoneRuleChange('exile_max_score', parseInt(e.target.value) || 0)}
                                                    className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">Niveles Rack Exilio</span>
                                                <input
                                                    type="text"
                                                    value={zoneRules.exile_rack_levels}
                                                    onChange={(e) => handleZoneRuleChange('exile_rack_levels', e.target.value)}
                                                    className="h-6 w-20 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    placeholder="2, 3"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-2 text-[#1f1f1f]">
                                                <span className="font-normal text-gray-800">Score Mínimo Aprendizaje IA</span>
                                                <div className="flex items-center gap-1.5">
                                                    <input
                                                        type="number"
                                                        value={zoneRules.ai_min_learn_score}
                                                        onChange={(e) => handleZoneRuleChange('ai_min_learn_score', parseInt(e.target.value) || 6)}
                                                        className="h-6 w-16 px-1.5 text-[11.5px] font-mono font-normal text-center border border-[#d1d5db] rounded text-[#1f1f1f] outline-none focus:border-[#0067c0] bg-white"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-gray-500 italic font-normal text-center mt-2">Estos parámetros definen el comportamiento estricto del exilio y el filtro de calidad de la IA.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel: Summary Dashboard */}
                <div className="lg:col-span-1">
                    <div className="bg-white p-4 rounded shadow-xs border border-[#d1d5db] sticky top-20 overflow-y-auto h-[calc(100vh-210px)] custom-scrollbar text-[#1f1f1f]">
                        <h2 className="text-[13px] font-normal mb-3 border-b border-[#e5e7eb] pb-2 text-gray-800">
                            Estado del Almacén
                        </h2>
                        {!summary ? (
                            <div className="text-[12px] text-gray-500 italic font-normal text-center py-6">Calculando estadísticas...</div>
                        ) : (
                            <div className="space-y-4 text-[#1f1f1f]">
                                <div>
                                    <h3 className="text-[11px] font-normal text-gray-600 mb-2">Capacidad Física</h3>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-1">
                                            <span className="font-normal text-gray-700">Total Bins</span>
                                            <span className="font-mono font-normal text-gray-900 text-right min-w-[60px]">{summary.total}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-1">
                                            <span className="font-normal text-gray-700">Bins en Uso</span>
                                            <span className="font-mono font-normal text-gray-900 text-right min-w-[60px]">{summary.in_use}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-[12px]">
                                            <span className="font-normal text-gray-700">Disponibles</span>
                                            <span className="font-mono font-normal text-gray-900 text-right min-w-[60px]">{summary.free}</span>
                                        </div>
                                        <div className="pt-2">
                                            <div className="flex justify-between text-[11px] font-normal text-gray-600 mb-1">
                                                <span>Índice de Ocupación</span>
                                                <span className={summary.occupancy_pct > 90 ? 'text-red-600 font-normal' : 'text-gray-900 font-normal'}>{summary.occupancy_pct}%</span>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                                <div className={`h-full transition-all duration-500 ${summary.occupancy_pct > 90 ? 'bg-red-500' : 'bg-[#0067c0]'}`} style={{ width: `${summary.occupancy_pct}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-[#e5e7eb] pt-3">
                                    <h3 className="text-[11px] font-normal text-gray-600 mb-2">Carga por Zona</h3>
                                    <div className="space-y-1.5">
                                        {Object.entries(summary.zones_by_items || {}).map(([zone, count]) => (
                                            <div key={zone} className="flex justify-between items-center text-[12px] py-0.5 border-b border-[#f0f0f0]">
                                                <div className="flex items-center gap-2 text-gray-700">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[#0067c0]"></span>
                                                    <span className="font-normal text-[11.5px]">{zone}</span>
                                                </div>
                                                <span className="font-mono font-normal text-gray-800">{count} <span className="text-[10px] text-gray-500">pzs</span></span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-t border-[#e5e7eb] pt-3">
                                    <h3 className="text-[11px] font-normal text-gray-600 mb-2">Pasillos Críticos</h3>
                                    <div className="space-y-1.5">
                                        {Object.entries(summary.top_aisles || {}).map(([aisle, count]) => (
                                            <div key={aisle} className="flex justify-between items-center text-[12px] py-0.5 border-b border-[#f0f0f0]">
                                                <span className="text-gray-700 font-normal text-[11.5px]">Pasillo {aisle}</span>
                                                <span className="font-mono font-normal text-gray-800">{count} <span className="text-[10px] text-gray-500">pzs</span></span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-t border-[#e5e7eb] pt-3">
                                    <h3 className="text-[11px] font-normal text-gray-600 mb-2">Saturación</h3>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center text-[12px] border-b border-[#f0f0f0] pb-1">
                                            <span className="text-gray-700 font-normal text-[11.5px]">Ítems Totales</span>
                                            <span className="font-mono font-normal text-gray-800">{summary.total_items_in_bins ?? '—'}</span>
                                        </div>
                                        <div className="pt-1">
                                            <div className="flex justify-between text-[11px] font-normal text-gray-600 mb-1">
                                                <span>Promedio ítems / bin</span>
                                                <span className={(summary.avg_items_per_bin ?? 0) > 5 ? 'text-red-600' : 'text-gray-800'}>{summary.avg_items_per_bin ?? '—'}</span>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                                <div className="h-full bg-[#0067c0]" style={{ width: `${Math.min(((summary.avg_items_per_bin ?? 0) / 8) * 100, 100)}%` }}></div>
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
