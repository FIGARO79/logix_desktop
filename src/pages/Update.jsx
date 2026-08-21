import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { isTauri, callTauriCommand, processLocalCSVUpload, previewLocalGRNFile } from '../utils/tauriBridge';
import { getDB } from '../utils/offlineDb';

const Update = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
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

    const fileInputRef = useRef(null);
    const dropHappenedRef = useRef(false);

    // GRN Selection State
    const [availableGrns, setAvailableGrns] = useState([]);
    const [selectedGrns, setSelectedGrns] = useState([]);
    const [maestroGrns, setMaestroGrns] = useState([]);
    const [selectedMaestroGrns, setSelectedMaestroGrns] = useState([]);
    const [isFetchingMaestro, setIsFetchingMaestro] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewedFile, setPreviewedFile] = useState(null);

    const handleFiles = useCallback((newFiles) => {
        if (!newFiles || newFiles.length === 0) return;
        const incomingArray = Array.from(newFiles);
        setFiles(prev => {
            const existingNames = new Set(prev.map(f => f.name));
            const filteredNew = incomingArray.filter(f => !existingNames.has(f.name));
            return [...prev, ...filteredNew];
        });
    }, []);

    const fetchSyncStatus = async () => {
        try {
            if (isTauri()) {
                const statusMap = await callTauriCommand('get_sync_status');
                if (statusMap && typeof statusMap === 'object') {
                    setSyncStatus(statusMap);
                    return;
                }
            }
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

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        setDragActive(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        dropHappenedRef.current = true;
        setTimeout(() => { dropHappenedRef.current = false; }, 300);

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    };

    const createFileFromPath = async (filePath) => {
        try {
            const fileName = filePath.split(/[/\\]/).pop();
            let bytes = null;

            if (isTauri()) {
                try {
                    const fs = await import('@tauri-apps/api/fs').catch(() => null);
                    if (fs && fs.readBinaryFile) {
                        bytes = await fs.readBinaryFile(filePath);
                    } else if (window.__TAURI__?.fs?.readBinaryFile) {
                        bytes = await window.__TAURI__.fs.readBinaryFile(filePath);
                    }
                } catch (err) {
                    console.warn("Tauri fs.readBinaryFile error:", err);
                }
            }

            if (bytes) {
                const blob = new Blob([new Uint8Array(bytes)]);
                return new File([blob], fileName);
            }
            return null;
        } catch (e) {
            console.error("Error creando archivo desde ruta:", e);
            return null;
        }
    };

    useEffect(() => {
        let unlistenDrop = null;
        let unlistenHover = null;
        let unlistenCancel = null;
        let isMounted = true;

        if (isTauri()) {
            const setupListeners = async () => {
                try {
                    const eventApi = await import('@tauri-apps/api/event').catch(() => null);
                    if (eventApi && eventApi.listen && isMounted) {
                        unlistenDrop = await eventApi.listen('tauri://file-drop', async (event) => {
                            setDragActive(false);
                            dropHappenedRef.current = true;
                            setTimeout(() => { dropHappenedRef.current = false; }, 300);

                            const paths = event.payload;
                            if (Array.isArray(paths) && paths.length > 0) {
                                const loadedFiles = [];
                                for (const p of paths) {
                                    const f = await createFileFromPath(p);
                                    if (f) loadedFiles.push(f);
                                }
                                if (loadedFiles.length > 0 && isMounted) {
                                    handleFiles(loadedFiles);
                                }
                            }
                        }).catch(() => null);

                        unlistenHover = await eventApi.listen('tauri://file-drop-hover', () => {
                            if (isMounted) setDragActive(true);
                        }).catch(() => null);

                        unlistenCancel = await eventApi.listen('tauri://file-drop-cancelled', () => {
                            if (isMounted) setDragActive(false);
                        }).catch(() => null);
                    }
                } catch (e) {
                    console.warn("Tauri event listen error:", e);
                }
            };
            setupListeners();
        }

        return () => {
            isMounted = false;
            if (typeof unlistenDrop === 'function') unlistenDrop();
            if (typeof unlistenHover === 'function') unlistenHover();
            if (typeof unlistenCancel === 'function') unlistenCancel();
        };
    }, [handleFiles]);

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
            return !isPo && (name.includes('280') || name.includes('aurrsglbd0280') || name.includes('goods received') || name.includes('goods_received') || name.includes('pedido') || name.includes('grn') || name.includes('entrada') || name.includes('recepcion') || name.includes('receipt'));
        });
        if (grnFile && grnFile !== previewedFile) {
            fetchPreviewGrns(grnFile);
        } else if (!grnFile && availableGrns.length > 0) {
            setAvailableGrns([]);
            setSelectedGrns([]);
            setPreviewedFile(null);
        }
    }, [files, previewedFile, fetchPreviewGrns, availableGrns.length]);

    const removeFile = (idx) => {
        setFiles(prev => {
            const next = prev.filter((_, i) => i !== idx);
            const hasGrn = next.some(f => {
                const name = f.name.toLowerCase();
                const isPo = name.includes('extractor') || name.includes('purchase');
                return !isPo && (name.includes('280') || name.includes('aurrsglbd0280') || name.includes('goods received') || name.includes('goods_received') || name.includes('pedido') || name.includes('grn') || name.includes('entrada') || name.includes('recepcion') || name.includes('receipt'));
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
        e.preventDefault();
        setMessages({ success: '', error: '' });
        setIsLoading(true);

        if (files.length === 0) {
            setMessages({ success: '', error: "Por favor seleccione al menos un archivo CSV o Excel." });
            setIsLoading(false);
            return;
        }

        try {
            const successMsgs = [];
            const errorMsgs = [];

            for (const file of files) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.txt')) {
                    const result = await processLocalCSVUpload(file, selectedGrns, updateOption);
                    const isErr = typeof result === 'string' && (
                        result.startsWith('Error') ||
                        result.startsWith('Tipo de archivo no reconocido') ||
                        result.startsWith('No se encontraron') ||
                        result.startsWith('El archivo')
                    );
                    if (isErr) {
                        errorMsgs.push(result);
                    } else {
                        successMsgs.push(result);
                    }
                } else {
                    errorMsgs.push(`Archivo '${file.name}': Formato no compatible. Seleccione archivos .csv o .xlsx`);
                }
            }

            if (errorMsgs.length > 0 && successMsgs.length === 0) {
                setMessages({ success: '', error: errorMsgs.join(' | ') });
            } else if (errorMsgs.length > 0 && successMsgs.length > 0) {
                setMessages({ success: successMsgs.join(' | '), error: errorMsgs.join(' | ') });
            } else if (successMsgs.length > 0) {
                setMessages({ success: successMsgs.join(' | '), error: '' });
            } else {
                setMessages({ success: `Se procesaron ${files.length} archivo(s).`, error: '' });
            }

            setFiles([]);
            await fetchSyncStatus();
        } catch (err) {
            setMessages({ success: '', error: `Error al procesar los archivos: ${err.message || err}` });
        } finally {
            setIsLoading(false);
            fetchSyncStatus();
        }
    };

    const fetchMaestroGrns = async () => {
        setIsFetchingMaestro(true);
        setMessages({ success: '', error: '', info: '' });
        console.log("Cargando maestro de GRNs...");
        try {
            const res = await fetch('/api/grn/unique_references');
            if (res.ok) {
                const data = await res.json();
                console.log("Datos recibidos:", data);
                const list = Array.isArray(data)
                    ? data.map(item => (typeof item === 'string' ? item : item?.reference || item?.grn || String(item))).filter(Boolean)
                    : [];
                setMaestroGrns(list);
                if (list.length === 0) {
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
                setMessages({ success: data.message || "GRNs eliminados exitosamente", error: '' });
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
        <div className="max-w-[1440px] mx-auto px-6 py-4 font-sans bg-[#fcfcfc] min-h-screen text-zinc-900 text-[12px]">
            
            {/* Mensajes de Notificación */}
            {messages.error && (
                <div className="mb-4 bg-red-50 text-red-900 px-4 py-2.5 border border-red-200 rounded-lg flex justify-between items-center text-[11px] font-normal shadow-sm transition-all animate-fade-in">
                    <div className="flex items-center gap-2">
                        <span className="text-red-700 uppercase font-medium tracking-tight">[Error]</span>
                        <span>{messages.error}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-red-700 hover:text-red-950 text-[11px] font-normal px-2 py-0.5 rounded hover:bg-red-100 transition-colors ml-4 cursor-pointer" title="Cerrar">
                        Cerrar
                    </button>
                </div>
            )}
            {messages.info && (
                <div className="mb-4 bg-sky-50 text-sky-900 px-4 py-2.5 border border-sky-200 rounded-lg flex justify-between items-center text-[11px] font-normal shadow-sm transition-all animate-fade-in">
                    <div className="flex items-center gap-2">
                        <span className="text-sky-700 uppercase font-medium tracking-tight">[Info]</span>
                        <span>{messages.info}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-sky-700 hover:text-sky-950 text-[11px] font-normal px-2 py-0.5 rounded hover:bg-sky-100 transition-colors ml-4 cursor-pointer" title="Cerrar">
                        Cerrar
                    </button>
                </div>
            )}
            {messages.success && (
                <div className="mb-4 bg-emerald-50 text-emerald-900 px-4 py-2.5 border border-emerald-200 rounded-lg flex justify-between items-center text-[11px] font-normal shadow-sm transition-all animate-fade-in">
                    <div className="flex items-center gap-2">
                        <span className="text-emerald-700 uppercase font-medium tracking-tight">[OK]</span>
                        <span>{messages.success}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-emerald-700 hover:text-emerald-950 text-[11px] font-normal px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors ml-4 cursor-pointer" title="Cerrar">
                        Cerrar
                    </button>
                </div>
            )}

            {/* Grid Principal 2x2 Perfectamente Alineado */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">

                {/* ================= FILA 1 - COLUMNA IZQUIERDA: Carga Manual ================= */}
                <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-lg shadow-sm p-4 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2.5 mb-3.5 border-b border-zinc-100">
                            <div>
                                <h3 className="text-[11px] font-medium text-zinc-900 uppercase tracking-tight">Carga Manual de Ficheros</h3>
                                <p className="text-[10px] text-zinc-500 font-normal">Importación de archivos CSV o Excel a la base de datos local</p>
                            </div>
                            <span className="text-[10px] uppercase font-normal px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200">
                                Formatos: CSV / XLSX
                            </span>
                        </div>

                        <form onSubmit={handleFileUpdate} className="flex flex-col">
                            {/* Dropzone */}
                            <div
                                className={`border border-dashed rounded-lg p-6 text-center transition-all cursor-pointer mb-3.5 ${dragActive ? 'border-[#285f94] bg-sky-50/40' : 'border-zinc-300 hover:border-zinc-400 bg-zinc-50/40 hover:bg-zinc-50'}`}
                                onDragEnter={handleDragEnter}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={() => {
                                    if (!dropHappenedRef.current) {
                                        fileInputRef.current?.click();
                                    }
                                }}
                            >
                                <input
                                    ref={fileInputRef}
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
                                <div className="flex flex-col items-center justify-center py-2">
                                    <p className="text-[11px] font-medium text-zinc-800 uppercase tracking-tight mb-1">
                                        Haga clic para seleccionar o arrastre archivos aquí
                                    </p>
                                    <p className="text-[10px] text-zinc-500 font-normal">
                                        Archivos admitidos: CSV (250, 280, 240, LAMP0006) y Excel (.xlsx)
                                    </p>
                                </div>
                            </div>

                            {/* Lista de Archivos Seleccionados */}
                            {files.length > 0 && (
                                <div className="mb-3.5 space-y-1.5 bg-zinc-50/70 p-2.5 rounded-lg border border-zinc-200">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-medium text-zinc-700 uppercase tracking-tight">
                                            Archivos Seleccionados ({files.length}):
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setFiles([])}
                                            className="text-[10px] text-red-600 hover:text-red-800 hover:underline uppercase font-normal cursor-pointer"
                                        >
                                            Quitar Todos
                                        </button>
                                    </div>
                                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                                        {files.map((file, idx) => (
                                             <div key={idx} className="flex items-center justify-between px-2 py-1.5 bg-white border border-zinc-200 rounded text-[11px]">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className="font-normal text-zinc-900 uppercase tracking-tight truncate">{file.name}</span>
                                                    <span className="text-[10px] text-zinc-400 font-normal">({(file.size / 1024).toFixed(1)} KB)</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeFile(idx)}
                                                    className="text-red-600 hover:text-red-800 text-[10px] font-normal uppercase hover:underline ml-2 flex-shrink-0 cursor-pointer"
                                                >
                                                    Eliminar
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Selector / Filtro de GRN si hay archivo 280 */}
                            {availableGrns.length > 0 && (
                                <div className="mb-3.5 bg-zinc-50/60 border border-zinc-200 p-3 rounded-lg">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5 pb-2 border-b border-zinc-200">
                                        <div className="flex items-center gap-2.5">
                                            <span className="text-[10px] font-medium text-zinc-800 uppercase tracking-tight">
                                                Filtro de GRN (Archivo 280)
                                            </span>
                                            <div className="flex gap-2 border-l border-zinc-200 pl-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedGrns([...availableGrns])}
                                                    className={`text-[10px] font-normal uppercase tracking-tight transition-colors cursor-pointer ${selectedGrns.length === availableGrns.length ? 'text-[#1e4a74] underline' : 'text-zinc-500 hover:text-zinc-800'}`}
                                                >
                                                    Marcar Todas
                                                </button>
                                                <span className="text-zinc-300">|</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedGrns([])}
                                                    className={`text-[10px] font-normal uppercase tracking-tight transition-colors cursor-pointer ${selectedGrns.length === 0 ? 'text-[#1e4a74] underline' : 'text-zinc-500 hover:text-zinc-800'}`}
                                                >
                                                    Desmarcar Todas
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 bg-white px-2 py-0.5 rounded border border-zinc-200 text-[10px]">
                                            <label className="flex items-center gap-1 cursor-pointer">
                                                <input type="radio" value="combine" checked={updateOption === 'combine'} onChange={e => setUpdateOption(e.target.value)} className="accent-[#285f94]" />
                                                <span className="font-normal text-zinc-700 uppercase">Combinar</span>
                                            </label>
                                            <label className="flex items-center gap-1 cursor-pointer">
                                                <input type="radio" value="replace" checked={updateOption === 'replace'} onChange={e => setUpdateOption(e.target.value)} className="accent-[#285f94]" />
                                                <span className="font-normal text-zinc-700 uppercase">Reemplazar</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div className="max-h-28 overflow-y-auto bg-white p-2 border border-zinc-200 grid grid-cols-2 sm:grid-cols-3 gap-1.5 rounded">
                                        {availableGrns.map(grn => (
                                            <label key={grn} className="flex items-center gap-1.5 p-0.5 rounded hover:bg-zinc-50 cursor-pointer">
                                                <input type="checkbox" checked={selectedGrns.includes(grn)} onChange={e => e.target.checked ? setSelectedGrns(p => [...p, grn]) : setSelectedGrns(p => p.filter(g => g !== grn))} className="accent-[#285f94]" />
                                                <span className="text-[10px] font-normal text-zinc-800">{grn}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Botón Principal de Publicar */}
                            <button
                                disabled={isLoading || files.length === 0}
                                type="submit"
                                className="w-full h-8 text-[11px] font-normal text-white uppercase tracking-normal rounded shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-1"
                                style={{ background: files.length > 0 && !isLoading ? '#285f94' : '#64748b' }}
                            >
                                {isLoading ? 'PROCESANDO Y PUBLICANDO DATOS...' : 'PUBLICAR ACTUALIZACIÓN'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* ================= FILA 1 - COLUMNA DERECHA: Mantenimiento de Datos ================= */}
                <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-lg shadow-sm p-4 flex flex-col justify-between">
                    <div>
                        <div className="pb-2.5 mb-3.5 border-b border-zinc-100">
                            <h3 className="text-[11px] font-medium text-zinc-900 uppercase tracking-tight">Mantenimiento de Datos</h3>
                            <p className="text-[10px] text-zinc-500 font-normal">Exportación y depuración selectiva del sistema</p>
                        </div>

                        <div className="space-y-4">
                            {/* Exportación de Históricos / Respaldo */}
                            <form onSubmit={async (e) => {
                                e.preventDefault(); setIsLoading(true);
                                setMessages({ success: '', error: '', info: 'Generando respaldo...' });
                                try {
                                    const res = await fetch('/api/export_all_log', { method: 'POST', body: new FormData(e.target) });
                                    if (res.ok) {
                                        const blob = await res.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a'); a.href = url; a.download = `LOGIX_BACKUP_${new Date().toISOString().slice(0, 10)}.xlsx`;
                                        a.click(); setMessages({ success: "Respaldo generado exitosamente", error: '', info: '' });
                                    } else {
                                        const data = await res.json().catch(() => ({}));
                                        setMessages({ success: '', error: data.error || `Error al generar respaldo (Código ${res.status})`, info: '' });
                                    }
                                } catch (err) {
                                    setMessages({ success: '', error: "Error de conexión al generar respaldo", info: '' });
                                }
                                finally { setIsLoading(false); setBackupPassword(''); }
                            }} className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-medium text-zinc-800 uppercase tracking-tight">
                                        Exportación de Históricos
                                    </label>
                                    <span className="text-[10px] text-zinc-500 font-mono">Excel (.xlsx)</span>
                                </div>
                                <p className="text-[10px] text-zinc-500 font-normal">
                                    Descarga de copia de seguridad consolidada con la totalidad de registros.
                                </p>
                                <div className="relative w-full">
                                    <input
                                        type={showBackupPassword ? "text" : "password"}
                                        name="password"
                                        placeholder="Contraseña de Administrador"
                                        value={backupPassword}
                                        onChange={e => setBackupPassword(e.target.value)}
                                        className="w-full h-7 border border-zinc-200 rounded pl-2.5 pr-8 text-[11px] placeholder:text-zinc-400 outline-none bg-zinc-50 focus:bg-white text-zinc-900 focus:border-[#285f94] font-normal"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowBackupPassword(!showBackupPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center p-0.5 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                                        tabIndex={-1}
                                    >
                                        {showBackupPassword ? (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.025 10.025 0 014.132-5.4M9.62 9.62a3 3 0 004.24 4.24M21 21l-2-2m-2-2L3 3m18 9a9.96 9.96 0 01-2.458 5.4M12 5c4.478 0 8.268 2.943 9.542 7a9.968 9.968 0 01-1.88 4.125" />
                                            </svg>
                                        ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <button
                                    type="submit"
                                    className="w-full h-7 border border-zinc-300 bg-white text-zinc-800 text-[10px] font-normal uppercase tracking-tight rounded hover:bg-zinc-100 transition-colors shadow-sm cursor-pointer"
                                >
                                    Generar Respaldo
                                </button>
                            </form>

                            {/* Limpieza Selectiva de Maestro GRN */}
                            <div className="space-y-2 pt-2.5 border-t border-zinc-100">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <label className="text-[10px] font-medium text-zinc-800 uppercase tracking-tight block">
                                            Limpieza de Maestro (GRN)
                                        </label>
                                        <p className="text-[10px] text-zinc-500 font-normal">Depuración puntual de números GRN</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={maestroGrns.length > 0 || messages.info?.includes("VACÍO") ? () => { setMaestroGrns([]); setMessages(prev => ({ ...prev, info: '' })) } : fetchMaestroGrns}
                                        disabled={isFetchingMaestro}
                                        className="h-6 px-2 text-[10px] font-normal uppercase tracking-tight rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-colors cursor-pointer"
                                    >
                                        {isFetchingMaestro ? 'Cargando...' : (maestroGrns.length > 0 || messages.info?.includes("VACÍO") ? 'Ocultar' : 'Ver Lista')}
                                    </button>
                                </div>

                                {maestroGrns.length > 0 ? (
                                    <div className="space-y-2 bg-zinc-50 p-2.5 rounded border border-zinc-200">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] font-medium text-zinc-700 uppercase">{maestroGrns.length} GRNs encontrados</span>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => setSelectedMaestroGrns([...maestroGrns])} className="text-[10px] font-normal text-[#285f94] hover:underline uppercase cursor-pointer">Todas</button>
                                                <button type="button" onClick={() => setSelectedMaestroGrns([])} className="text-[10px] font-normal text-[#285f94] hover:underline uppercase cursor-pointer">Ninguna</button>
                                            </div>
                                        </div>
                                        <div className="max-h-24 overflow-y-auto bg-white p-1.5 border border-zinc-200 rounded space-y-0.5">
                                            {maestroGrns.map((grn, idx) => {
                                                const grnStr = typeof grn === 'string' ? grn : grn?.reference || grn?.grn || String(grn);
                                                return (
                                                    <label key={grnStr || idx} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-zinc-50 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedMaestroGrns.includes(grnStr)}
                                                            onChange={e => e.target.checked ? setSelectedMaestroGrns(p => [...p, grnStr]) : setSelectedMaestroGrns(p => p.filter(g => g !== grnStr))}
                                                            className="accent-[#285f94]"
                                                        />
                                                        <span className="text-[10px] font-normal text-zinc-800">{grnStr}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>

                                        <form onSubmit={handleDeleteMaestroGrns} className="space-y-1.5">
                                            <div className="relative w-full">
                                                <input
                                                    type={showDeleteMaestroPassword ? "text" : "password"}
                                                    placeholder="Contraseña Admin"
                                                    value={deleteMaestroPassword}
                                                    onChange={e => setDeleteMaestroPassword(e.target.value)}
                                                    className="w-full h-7 border border-zinc-200 rounded pl-2.5 pr-8 text-[10px] outline-none bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-[#285f94] font-normal"
                                                    required
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDeleteMaestroPassword(!showDeleteMaestroPassword)}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center p-0.5 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                                                    tabIndex={-1}
                                                >
                                                    {showDeleteMaestroPassword ? (
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.025 10.025 0 014.132-5.4M9.62 9.62a3 3 0 004.24 4.24M21 21l-2-2m-2-2L3 3m18 9a9.96 9.96 0 01-2.458 5.4M12 5c4.478 0 8.268 2.943 9.542 7a9.968 9.968 0 01-1.88 4.125" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={isLoading || selectedMaestroGrns.length === 0}
                                                className="w-full h-7 text-[10px] font-normal text-white uppercase tracking-tight rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                            >
                                                Eliminar Seleccionados ({selectedMaestroGrns.length})
                                            </button>
                                        </form>
                                    </div>
                                ) : (
                                    messages.info && <p className="text-[10px] text-zinc-600 bg-zinc-50 p-2 rounded border border-zinc-200 font-normal">{messages.info}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ================= FILA 2 - COLUMNA IZQUIERDA: Fechas de Actualización ================= */}
                <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-lg shadow-sm p-4 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2.5 mb-3.5 border-b border-zinc-100">
                            <div>
                                <h3 className="text-[11px] font-medium text-zinc-900 uppercase tracking-tight">Fechas de Actualización de Maestros</h3>
                                <p className="text-[10px] text-zinc-500 font-normal">Última marca de tiempo registrada por fuente de datos</p>
                            </div>
                            <button
                                type="button"
                                onClick={fetchSyncStatus}
                                className="text-[10px] text-[#285f94] hover:underline uppercase font-normal flex items-center cursor-pointer"
                                title="Refrescar estado"
                            >
                                Refrescar
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {[
                                { label: "Maestro Ítems", filename: "AURRSGLBD0250.csv", key: "master_items" },
                                { label: "Entradas GRN", filename: "AURRSGLBD0280.csv", key: "grn_pending" },
                                { label: "Salidas Picking", filename: "AURRSGLBD0240.csv", key: "picking" },
                                { label: "Reservas Xdock", filename: "AURRSLAMP0006.csv", key: "xdock_reservations" },
                                { label: "PO Extractor", filename: "Purchase Order Extractor.xlsx", key: "po_extractor", fullWidth: true }
                            ].map((item) => {
                                const hasData = syncStatus[item.key] && syncStatus[item.key] !== 0;
                                return (
                                    <div
                                        key={item.key}
                                        className={`p-2.5 rounded border border-zinc-200 bg-zinc-50/60 flex flex-col justify-between ${item.fullWidth ? 'md:col-span-2' : ''}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-[11px] font-medium text-zinc-900 uppercase tracking-tight">{item.label}</span>
                                            <span className="text-[9px] font-mono font-normal bg-white text-zinc-600 px-1.5 py-0.5 rounded border border-zinc-200">
                                                {item.filename}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-1 border-t border-zinc-100 text-[10px]">
                                            <span className="text-zinc-500 uppercase font-normal tracking-tight">Última Modificación</span>
                                            <span className={`font-normal flex items-center gap-1 ${hasData ? 'text-zinc-800' : 'text-zinc-400'}`}>
                                                {hasData && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>}
                                                {formatTimestamp(syncStatus[item.key])}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* ================= FILA 2 - COLUMNA DERECHA: Zona de Riesgo ================= */}
                <div className="lg:col-span-5 bg-red-50/30 border border-red-200 rounded-lg shadow-sm p-4 flex flex-col justify-between">
                    <div>
                        <div className="pb-2 mb-2.5 border-b border-red-200/60">
                            <h3 className="text-[11px] font-medium text-red-900 uppercase tracking-tight">
                                Zona de Riesgo: Reset Total
                            </h3>
                            <p className="text-[10px] text-red-700 font-normal">Acción destructiva e irreversible</p>
                        </div>

                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            if (!window.confirm("¿BORRAR TODA LA BASE DE DATOS LOCAL? ESTA ACCIÓN NO SE PUEDE DESHACER.")) return;
                            setIsLoading(true);
                            try {
                                const res = await fetch('/api/clear_database', { method: 'POST', body: new FormData(e.target) });
                                const d = await res.json();
                                if (res.ok) setMessages({ success: d.message || "Base de datos limpiada" }); else setMessages({ error: d.error || "Error" });
                            } catch (err) { setMessages({ error: "Error crítico al limpiar base de datos" }); }
                            finally { setIsLoading(false); setClearPassword(''); }
                        }} className="space-y-2.5 flex-1 flex flex-col justify-between">
                            <p className="text-[10px] text-red-800 font-normal leading-relaxed">
                                Esta acción eliminará permanentemente todas las tablas de ítems, GRNs, auditorías y movimientos locales en SQLite.
                            </p>
                            <div className="space-y-2 mt-auto pt-1">
                                <div className="relative w-full">
                                    <input
                                        type={showClearPassword ? "text" : "password"}
                                        name="password"
                                        placeholder="Contraseña de Administrador"
                                        value={clearPassword}
                                        onChange={e => setClearPassword(e.target.value)}
                                        className="w-full h-7 border border-red-200 rounded pl-2.5 pr-8 text-[10px] placeholder:text-red-300 outline-none bg-white text-zinc-900 focus:border-red-500 font-normal"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowClearPassword(!showClearPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center p-0.5 text-red-400 hover:text-red-700 cursor-pointer"
                                        tabIndex={-1}
                                    >
                                        {showClearPassword ? (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.025 10.025 0 014.132-5.4M9.62 9.62a3 3 0 004.24 4.24M21 21l-2-2m-2-2L3 3m18 9a9.96 9.96 0 01-2.458 5.4M12 5c4.478 0 8.268 2.943 9.542 7a9.968 9.968 0 01-1.88 4.125" />
                                            </svg>
                                        ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full h-7 text-[10px] font-normal uppercase tracking-tight text-red-700 bg-white border border-red-300 rounded hover:bg-red-600 hover:text-white transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                                >
                                    Limpiar Toda la Base de Datos
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Update;
