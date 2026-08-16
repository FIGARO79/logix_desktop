import React, { useState, useEffect, useCallback } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { isTauri, processLocalCSVUpload, previewLocalGRNFile } from '../utils/tauriBridge';
import { getDB } from '../utils/offlineDb';

const Update = () => {
    const { setTitle } = useOutletContext();
    const [messages, setMessages] = useState({ success: '', error: '', info: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [files, setFiles] = useState([]);
    const [updateOption, setUpdateOption] = useState('combine');
    const [clearPassword, setClearPassword] = useState('');
    const [backupPassword, setBackupPassword] = useState('');
    const [deleteMaestroPassword, setDeleteMaestroPassword] = useState('');
    const [showBackupPassword, setShowBackupPassword] = useState(false);
    const [showDeleteMaestroPassword, setShowDeleteMaestroPassword] = useState(false);
    const [showClearPassword, setShowClearPassword] = useState(false);
    const [syncStatus, setSyncStatus] = useState({});

    // GRN Selection State
    const [availableGrns, setAvailableGrns] = useState([]);
    const [selectedGrns, setSelectedGrns] = useState([]);
    const [maestroGrns, setMaestroGrns] = useState([]);
    const [selectedMaestroGrns, setSelectedMaestroGrns] = useState([]);
    const [isFetchingMaestro, setIsFetchingMaestro] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewedFile, setPreviewedFile] = useState(null);

    const fetchSyncStatus = async () => {
        try {
            const res = await fetch('/api/sync/status').catch(() => null);
            if (res && res.ok) {
                const data = await res.json();
                setSyncStatus(data);
                return;
            }
            const db = await getDB();
            const allMeta = await db.getAll('sync_metadata');
            const statusMap = {};
            allMeta.forEach(m => {
                if (m.key && m.value) {
                    statusMap[m.key] = typeof m.value === 'number' && m.value > 10000000000 ? Math.floor(m.value / 1000) : m.value;
                }
            });
            setSyncStatus(statusMap);
        } catch (err) {
            console.error("Error fetching sync status:", err);
        }
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp || timestamp === 0) return 'SIN DATOS';
        try {
            const date = new Date(timestamp * 1000);
            return date.toLocaleString('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch (e) {
            return 'SIN DATOS';
        }
    };

    useEffect(() => {
        setTitle("Datos Maestros");
        fetchSyncStatus();
    }, [setTitle]);

    // Temporizador de 10 segundos para ocultar notificaciones automáticamente
    useEffect(() => {
        if (messages.success || messages.error || messages.info) {
            const timer = setTimeout(() => {
                setMessages({ success: '', error: '', info: '' });
            }, 10000);
            return () => clearTimeout(timer);
        }
    }, [messages]);

    const clearMessages = () => setMessages({ success: '', error: '', info: '' });

    const fetchPreviewGrns = useCallback(async (file) => {
        if (!file) return;
        setIsPreviewing(true);
        setPreviewedFile(file);
        try {
            const grnList = await previewLocalGRNFile(file);
            if (grnList && grnList.length > 0) {
                setAvailableGrns(grnList);
                setSelectedGrns(grnList);
            } else {
                setAvailableGrns([]);
                setSelectedGrns([]);
            }
        } catch (err) {
            console.error("Error previsualizando GRNs:", err);
            setAvailableGrns([]);
            setSelectedGrns([]);
        } finally {
            setIsPreviewing(false);
        }
    }, []);

    useEffect(() => {
        const grnFile = files.find(f => {
            const name = f.name.toLowerCase();
            const isPo = name.includes('extractor') || name.includes('purchase');
            return !isPo && (name.includes('280') || name.includes('pedido') || name.includes('grn') || name.includes('entrada') || name.includes('recepcion'));
        });
        if (grnFile && grnFile !== previewedFile) {
            fetchPreviewGrns(grnFile);
        } else if (!grnFile && availableGrns.length > 0) {
            setAvailableGrns([]);
            setSelectedGrns([]);
            setPreviewedFile(null);
        }
    }, [files, previewedFile, fetchPreviewGrns, availableGrns.length]);

    const handleFiles = (newFiles) => {
        if (!newFiles || newFiles.length === 0) return;
        const incomingArray = Array.from(newFiles);
        setFiles(prev => {
            const existingNames = new Set(prev.map(f => f.name));
            const filteredNew = incomingArray.filter(f => !existingNames.has(f.name));
            return [...prev, ...filteredNew];
        });
    };

    const removeFile = (idx) => {
        setFiles(prev => {
            const next = prev.filter((_, i) => i !== idx);
            const hasGrn = next.some(f => {
                const name = f.name.toLowerCase();
                const isPo = name.includes('extractor') || name.includes('purchase');
                return !isPo && (name.includes('280') || name.includes('pedido') || name.includes('grn') || name.includes('entrada') || name.includes('recepcion'));
            });
            if (!hasGrn) {
                setAvailableGrns([]);
                setSelectedGrns([]);
                setPreviewedFile(null);
            }
            return next;
        });
    };

    const handleFileUpdate = async (e) => {
        e.preventDefault(); setMessages({ success: '', error: '' }); setIsLoading(true);

        if (files.length === 0) {
            setMessages({ success: '', error: "Por favor seleccione al menos un archivo CSV o Excel." });
            setIsLoading(false);
            return;
        }

        try {
            let processedMsg = '';
            for (const file of files) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.txt')) {
                    const result = await processLocalCSVUpload(file, selectedGrns, updateOption);
                    processedMsg += result + '. ';
                }
            }

            if (!processedMsg && !isTauri()) {
                const formData = new FormData();
                files.forEach(file => {
                    formData.append('file', file);
                });
                const res = await fetch('/api/update', { method: 'POST', body: formData }).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json();
                    processedMsg = data.message || "Archivos cargados exitosamente.";
                }
            }

            if (!processedMsg) {
                processedMsg = `Se cargaron ${files.length} archivo(s) localmente en la base de datos SQLite`;
            }

            setMessages({ success: processedMsg, error: '' });
            setFiles([]);
        } catch (err) {
            setMessages({ success: '', error: `Error al procesar los archivos: ${err.message || err}` });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchMaestroGrns = async () => {
        setIsFetchingMaestro(true);
        setMessages({ success: '', error: '', info: '' }); // Limpiar mensajes previos
        console.log("Cargando maestro de GRNs...");
        try {
            const res = await fetch('/api/grn/unique_references');
            if (res.ok) {
                const data = await res.json();
                console.log("Datos recibidos:", data);
                setMaestroGrns(data);
                if (data.length === 0) {
                    setMessages({ success: '', error: '', info: "EL MAESTRO ESTÁ VACÍO. NO HAY GRNS PARA ELIMINAR." });
                }
            } else {
                const errorData = await res.json().catch(() => ({ detail: "Error desconocido" }));
                console.error("Error al cargar:", errorData);
                const errorMsg = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
                setMessages({ success: '', error: `ERROR AL CARGAR MAESTRO: ${errorMsg || res.statusText}` });
            }
        } catch (err) {
            console.error("Error de conexión:", err);
            setMessages({ success: '', error: "ERROR DE CONEXIÓN AL SERVIDOR" });
        } finally {
            setIsFetchingMaestro(false);
        }
    };

    const handleDeleteMaestroGrns = async (e) => {
        e.preventDefault();
        if (selectedMaestroGrns.length === 0) return alert("Seleccione al menos un GRN");
        if (!window.confirm(`¿ELIMINAR ${selectedMaestroGrns.length} NÚMEROS DE GRN DEL SISTEMA?`)) return;

        setIsLoading(true);
        try {
            const res = await fetch('/api/grn/delete_bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grn_numbers: selectedMaestroGrns,
                    password: deleteMaestroPassword
                })
            });
            const data = await res.json();
            if (res.ok) {
                setMessages({ success: data.message, error: '' });
                setMaestroGrns(prev => prev.filter(g => !selectedMaestroGrns.includes(g)));
                setSelectedMaestroGrns([]);
                setDeleteMaestroPassword('');
            } else {
                const errorMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
                setMessages({ success: '', error: errorMsg || "ERROR EN ELIMINACIÓN" });
            }
        } catch (err) {
            setMessages({ success: '', error: "ERROR DE CONEXIÓN" });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-[1400px] mx-auto px-6 py-3 font-sans bg-[#fcfcfc] min-h-screen text-black text-[12px]">

            {messages.error && (
                <div className="mb-6 bg-red-50 text-red-900 px-4 py-3 border border-red-200 rounded flex justify-between items-center text-[12px] font-normal uppercase tracking-tight shadow-sm transition-all">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-red-600">⚠️</span>
                        <span>{messages.error}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-red-700 hover:text-red-950 text-sm font-bold px-2 py-0.5 rounded hover:bg-red-100 transition-colors ml-4" title="Cerrar notificación">
                        ✕
                    </button>
                </div>
            )}
            {messages.info && (
                <div className="mb-6 bg-blue-50 text-blue-900 px-4 py-3 border border-blue-200 rounded flex justify-between items-center text-[12px] font-normal uppercase tracking-tight shadow-sm transition-all">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-blue-600">ℹ️</span>
                        <span>{messages.info}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-blue-700 hover:text-blue-950 text-sm font-bold px-2 py-0.5 rounded hover:bg-blue-100 transition-colors ml-4" title="Cerrar notificación">
                        ✕
                    </button>
                </div>
            )}
            {messages.success && (
                <div className="mb-6 bg-emerald-50 text-emerald-900 px-4 py-3 border border-emerald-200 rounded flex justify-between items-center text-[12px] font-normal uppercase tracking-tight shadow-sm transition-all">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-emerald-600">✅</span>
                        <span>{messages.success}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-emerald-700 hover:text-emerald-950 text-sm font-bold px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors ml-4" title="Cerrar notificación">
                        ✕
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

                {/* File Upload Section */}
                <div className="lg:col-span-2 bg-white border border-zinc-200 shadow-sm p-6">
                    <h3 className="text-[12px] font-normal text-black uppercase tracking-normal mb-6">Carga Manual de Ficheros</h3>

                    <form onSubmit={handleFileUpdate}>
                        <div
                            className={`border-2 border-dashed rounded-lg p-10 text-center transition-all cursor-pointer mb-6 ${dragActive ? 'border-black bg-zinc-50' : 'border-zinc-200 hover:border-zinc-400 bg-zinc-50/50'}`}
                            onDragEnter={() => setDragActive(true)}
                            onDragLeave={() => setDragActive(false)}
                            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                            onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files); }}
                            onClick={() => document.getElementById('file-upload').click()}
                        >
                            <input
                                id="file-upload"
                                type="file"
                                multiple
                                className="hidden"
                                onClick={(e) => { e.stopPropagation(); e.target.value = ''; }}
                                onChange={(e) => {
                                    handleFiles(e.target.files);
                                    e.target.value = '';
                                }}
                            />
                            <div className="text-black">
                                <p className="text-[12px] font-normal text-black uppercase tracking-normal mb-1">Click para seleccionar o arrastre archivos</p>
                                <p className="text-[12px] uppercase font-normal text-black">Soporta: CSV (250, 280, 240) y Excel (.xlsx)</p>
                            </div>
                        </div>

                        {files.length > 0 && (
                            <div className="mb-6 space-y-2">
                                <h4 className="text-[12px] font-medium text-black uppercase tracking-tight mb-2">Archivos Seleccionados ({files.length}):</h4>
                                {files.map((file, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-zinc-50 border border-zinc-200 rounded shadow-sm">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <span className="text-zinc-600 font-bold">📄</span>
                                            <span className="text-[12px] font-medium text-black uppercase tracking-tight truncate">{file.name}</span>
                                            <span className="text-[11px] text-zinc-500 font-normal">({(file.size / 1024).toFixed(1)} KB)</span>
                                        </div>
                                        <button type="button" onClick={() => removeFile(idx)} className="text-red-600 hover:text-red-800 text-[12px] font-normal uppercase hover:underline ml-2 flex-shrink-0">Remover</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {availableGrns.length > 0 && (
                            <div className="mb-6 bg-zinc-50 border border-zinc-200 p-4 rounded shadow-sm">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-3 border-b border-zinc-100">
                                    <div className="flex items-center gap-4">
                                        <h4 className="text-[12px] font-normal text-black uppercase tracking-normal">Filtro de GRN (Archivo 280)</h4>
                                        <div className="flex gap-3 border-l border-zinc-200 pl-4">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedGrns([...availableGrns])}
                                                className={`text-[12px] font-normal uppercase tracking-normal transition-colors ${selectedGrns.length === availableGrns.length ? 'text-black underline' : 'text-black opacity-60 hover:opacity-100'}`}
                                            >
                                                Marcar Todas
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedGrns([])}
                                                className={`text-[12px] font-normal uppercase tracking-normal transition-colors ${selectedGrns.length === 0 ? 'text-black underline' : 'text-black opacity-60 hover:opacity-100'}`}
                                            >
                                                Desmarcar Todas
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" value="combine" checked={updateOption === 'combine'} onChange={e => setUpdateOption(e.target.value)} className="accent-black" />
                                            <span className="text-[12px] font-normal text-black uppercase">Combinar</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" value="replace" checked={updateOption === 'replace'} onChange={e => setUpdateOption(e.target.value)} className="accent-black" />
                                            <span className="text-[12px] font-normal text-black uppercase">Reemplazar</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="max-h-40 overflow-y-auto bg-white p-3 border border-zinc-100 grid grid-cols-2 md:grid-cols-3 gap-2 shadow-inner rounded">
                                    {availableGrns.map(grn => (
                                        <div key={grn} className="flex items-center gap-2">
                                            <input type="checkbox" checked={selectedGrns.includes(grn)} onChange={e => e.target.checked ? setSelectedGrns(p => [...p, grn]) : setSelectedGrns(p => p.filter(g => g !== grn))} className="accent-black" />
                                            <span className="text-[12px] font-normal text-black">{grn}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button disabled={isLoading || files.length === 0} type="submit" className="w-full h-11 border border-black bg-white text-black text-[12px] font-normal uppercase tracking-normal rounded hover:bg-blue-500 hover:text-white hover:border-blue-500 disabled:bg-zinc-100 disabled:border-zinc-200 disabled:text-zinc-400 transition-all shadow-md">
                            {isLoading ? 'PROCESANDO DATOS...' : 'PUBLICAR ACTUALIZACIÓN'}
                        </button>
                    </form>
                </div>

                {/* Database Maintenance */}
                <div className="lg:col-span-1 lg:row-span-2 lg:col-start-3 lg:row-start-1 lg:h-full bg-white border border-zinc-200 shadow-sm p-6 flex flex-col justify-between">
                    <div>
                        <h3 className="text-[12px] font-normal text-black uppercase tracking-normal mb-6 border-b border-zinc-100 pb-2">Mantenimiento de Datos</h3>

                        <div className="space-y-8">
                            {/* Backup */}
                            <form onSubmit={async (e) => {
                                e.preventDefault(); setIsLoading(true);
                                setMessages({ success: '', error: '', info: 'Generando respaldo...' });
                                try {
                                    const res = await fetch('/api/export_all_log', { method: 'POST', body: new FormData(e.target) });
                                    if (res.ok) {
                                        const blob = await res.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a'); a.href = url; a.download = `LOGIX_BACKUP_${new Date().toISOString().slice(0, 10)}.xlsx`;
                                        a.click(); setMessages({ success: "BACKUP GENERADO", error: '', info: '' });
                                    } else {
                                        const data = await res.json().catch(() => ({}));
                                        setMessages({ success: '', error: data.error || `ERROR AL GENERAR RESPALDO (CÓDIGO ${res.status})`, info: '' });
                                    }
                                } catch (err) {
                                    setMessages({ success: '', error: "ERROR DE CONEXIÓN AL GENERAR RESPALDO", info: '' });
                                }
                                finally { setIsLoading(false); setBackupPassword(''); }
                            }} className="space-y-3">
                                <label className="text-[12px] font-normal text-black uppercase">Exportación de Históricos</label>
                                <div className="relative w-full">
                                    <input
                                        type={showBackupPassword ? "text" : "password"}
                                        name="password"
                                        placeholder="Contraseña Admin"
                                        value={backupPassword}
                                        onChange={e => setBackupPassword(e.target.value)}
                                        className="w-full h-9 border border-zinc-200 rounded pl-3 pr-10 text-[12px] placeholder:text-zinc-400 outline-none bg-zinc-50 focus:bg-white text-black"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowBackupPassword(!showBackupPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center p-1 focus:outline-none"
                                        tabIndex={-1}
                                    >
                                        {showBackupPassword ? (
                                            <svg className="w-4 h-4 text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.025 10.025 0 014.132-5.4M9.62 9.62a3 3 0 004.24 4.24M21 21l-2-2m-2-2L3 3m18 9a9.96 9.96 0 01-2.458 5.4M12 5c4.478 0 8.268 2.943 9.542 7a9.968 9.968 0 01-1.88 4.125" />
                                            </svg>
                                        ) : (
                                            <svg className="w-4 h-4 text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <button type="submit" className="w-full h-9 border border-black bg-white text-black text-[12px] font-normal uppercase tracking-normal rounded hover:bg-blue-500 hover:text-white hover:border-blue-500 transition-colors">Generar Respaldo</button>
                            </form>

                            {/* Delete GRN from Master */}
                            <div className="space-y-3 pt-6 border-t border-zinc-100">
                                <div className="flex justify-between items-center">
                                    <label className="text-[12px] font-normal text-black uppercase">Limpieza de Maestro (GRN)</label>
                                    <button
                                        type="button"
                                        onClick={maestroGrns.length > 0 || messages.info?.includes("VACÍO") ? () => { setMaestroGrns([]); setMessages(prev => ({ ...prev, info: '' })) } : fetchMaestroGrns}
                                        disabled={isFetchingMaestro}
                                        className="text-[12px] font-normal text-black uppercase hover:underline"
                                    >
                                        {isFetchingMaestro ? 'CARGANDO...' : (maestroGrns.length > 0 || messages.info?.includes("VACÍO") ? 'OCULTAR' : 'VER LISTA')}
                                    </button>
                                </div>

                                {maestroGrns.length > 0 ? (
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[12px] text-black uppercase">{maestroGrns.length} GRNs encontrados</span>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => setSelectedMaestroGrns([...maestroGrns])} className="text-[12px] font-normal text-black hover:underline uppercase">Todas</button>
                                                <button type="button" onClick={() => setSelectedMaestroGrns([])} className="text-[12px] font-normal text-black hover:underline uppercase">Ninguna</button>
                                            </div>
                                        </div>
                                        <div className="max-h-32 overflow-y-auto bg-zinc-50 p-2 border border-zinc-100 rounded shadow-inner space-y-1">
                                            {maestroGrns.map(grn => (
                                                <div key={grn} className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedMaestroGrns.includes(grn)}
                                                        onChange={e => e.target.checked ? setSelectedMaestroGrns(p => [...p, grn]) : setSelectedMaestroGrns(p => p.filter(g => g !== grn))}
                                                        className="accent-black"
                                                    />
                                                    <span className="text-[12px] font-normal text-black">{grn}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <form onSubmit={handleDeleteMaestroGrns} className="space-y-2">
                                            <div className="relative w-full">
                                                <input
                                                    type={showDeleteMaestroPassword ? "text" : "password"}
                                                    placeholder="Contraseña Admin"
                                                    value={deleteMaestroPassword}
                                                    onChange={e => setDeleteMaestroPassword(e.target.value)}
                                                    className="w-full h-8 border border-zinc-200 rounded pl-3 pr-10 text-[12px] outline-none bg-zinc-50 focus:bg-white text-black placeholder:text-zinc-400"
                                                    required
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDeleteMaestroPassword(!showDeleteMaestroPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center p-1 focus:outline-none"
                                                    tabIndex={-1}
                                                >
                                                    {showDeleteMaestroPassword ? (
                                                        <svg className="w-4 h-4 text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.025 10.025 0 014.132-5.4M9.62 9.62a3 3 0 004.24 4.24M21 21l-2-2m-2-2L3 3m18 9a9.96 9.96 0 01-2.458 5.4M12 5c4.478 0 8.268 2.943 9.542 7a9.968 9.968 0 01-1.88 4.125" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-4 h-4 text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={isLoading || selectedMaestroGrns.length === 0}
                                                className="w-full h-8 border border-black bg-white text-black text-[12px] font-normal uppercase tracking-normal rounded hover:bg-blue-500 hover:text-white hover:border-blue-500 disabled:bg-zinc-100 disabled:border-zinc-200 disabled:text-zinc-400 transition-colors"
                                            >
                                                ELIMINAR SELECCIONADOS ({selectedMaestroGrns.length})
                                            </button>
                                        </form>
                                    </div>
                                ) : (
                                    messages.info && <p className="text-[12px] text-black italic">{messages.info}</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Danger Zone at the bottom of the card */}
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!window.confirm("¿BORRAR TODA LA BASE DE DATOS?")) return;
                        setIsLoading(true);
                        try {
                            const res = await fetch('/api/clear_database', { method: 'POST', body: new FormData(e.target) });
                            const d = await res.json();
                            if (res.ok) setMessages({ success: d.message }); else setMessages({ error: d.error });
                        } catch (err) { setMessages({ error: "ERROR CRÍTICO" }); }
                        finally { setIsLoading(false); setClearPassword(''); }
                    }} className="space-y-3 pt-6 border-t border-zinc-100 mt-8">
                        <label className="text-[12px] font-normal text-black uppercase">Zona de Riesgo: Reset Total</label>
                        <div className="relative w-full">
                            <input
                                type={showClearPassword ? "text" : "password"}
                                name="password"
                                placeholder="Contraseña Admin"
                                value={clearPassword}
                                onChange={e => setClearPassword(e.target.value)}
                                className="w-full h-9 border border-zinc-200 rounded pl-3 pr-10 text-[12px] placeholder:text-zinc-400 outline-none bg-zinc-50 focus:bg-white text-black"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowClearPassword(!showClearPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center p-1 focus:outline-none"
                                tabIndex={-1}
                            >
                                {showClearPassword ? (
                                    <svg className="w-4 h-4 text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.025 10.025 0 014.132-5.4M9.62 9.62a3 3 0 004.24 4.24M21 21l-2-2m-2-2L3 3m18 9a9.96 9.96 0 01-2.458 5.4M12 5c4.478 0 8.268 2.943 9.542 7a9.968 9.968 0 01-1.88 4.125" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4 text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                        <button type="submit" className="w-full h-9 border border-black bg-white text-black text-[12px] font-normal uppercase tracking-normal hover:bg-blue-500 hover:text-white hover:border-blue-500 shadow-sm transition-colors">Limpiar Base de Datos</button>
                    </form>
                </div>

                {/* Fechas de Actualización */}
                <div className="lg:col-span-1 lg:col-start-3 lg:row-start-3 bg-white border border-zinc-200 shadow-sm p-6 text-black">
                    <h3 className="text-[12px] font-normal text-black uppercase tracking-normal mb-4 pb-2 border-b border-zinc-100 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Fechas de Actualización
                    </h3>
                    <div className="space-y-4">
                        {[
                            { label: "Maestro Ítems", filename: "AURRSGLBD0250.csv", key: "master_items" },
                            { label: "Entradas GRN", filename: "AURRSGLBD0280.csv", key: "grn_pending" },
                            { label: "Salidas Picking", filename: "AURRSGLBD0240.csv", key: "picking" },
                            { label: "Reservas Xdock", filename: "AURRSLAMP0006.csv", key: "xdock_reservations" },
                            { label: "PO Extractor", filename: "Purchase Order Extractor.xlsx", key: "po_extractor" }
                        ].map((item) => (
                            <div key={item.key} className="flex flex-col gap-1 pb-3 border-b border-zinc-100 last:border-0 last:pb-0">
                                <div className="flex justify-between items-center">
                                    <span className="text-[12px] font-normal text-black uppercase tracking-normal">{item.label}</span>
                                    <span className="text-[12px] font-normal bg-zinc-50 text-black px-1.5 py-0.5 rounded border border-zinc-200">{item.filename}</span>
                                </div>
                                <div className="flex justify-between items-center text-[12px]">
                                    <span className="text-black uppercase font-normal text-[12px] tracking-normal">Última Modificación</span>
                                    <span className="font-normal text-black">
                                        {formatTimestamp(syncStatus[item.key])}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Update;
