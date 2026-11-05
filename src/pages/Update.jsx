import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { isTauri, callTauriCommand, processLocalCSVUpload, previewLocalGRNFile } from '../utils/tauriBridge';
import { getDB } from '../utils/offlineDb';

const Update = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();

    useEffect(() => {
        if (setTitle) setTitle(t('nav.update_data', 'Carga de Datos'));
    }, [setTitle, t, language]);

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

    const fetchSyncStatus = useCallback(async () => {
        try {
            if (isTauri()) {
                const statusMap = await callTauriCommand('get_sync_status');
                if (statusMap && typeof statusMap === 'object' && Object.keys(statusMap).length > 0) {
                    setSyncStatus(statusMap);
                    localStorage.setItem('logix_last_sync_status', JSON.stringify(statusMap));
                    return;
                }
            }
            const res = await fetch('/api/sync/status').catch(() => null);
            if (res && res.ok) {
                const data = await res.json();
                if (data && typeof data === 'object') {
                    setSyncStatus(data);
                    localStorage.setItem('logix_last_sync_status', JSON.stringify(data));
                    return;
                }
            }
            const db = await getDB();
            const allMeta = await db.getAll('sync_metadata');
            const statusMap = {};
            allMeta.forEach(m => {
                if (m.key && m.value) {
                    statusMap[m.key] = typeof m.value === 'number' && m.value > 10000000000 ? Math.floor(m.value / 1000) : m.value;
                }
            });
            if (Object.keys(statusMap).length > 0) {
                setSyncStatus(statusMap);
                localStorage.setItem('logix_last_sync_status', JSON.stringify(statusMap));
            } else {
                const cached = localStorage.getItem('logix_last_sync_status');
                if (cached) {
                    try {
                        setSyncStatus(JSON.parse(cached));
                    } catch (e) {}
                }
            }
        } catch (err) {
            console.error("Error fetching sync status:", err);
            const cached = localStorage.getItem('logix_last_sync_status');
            if (cached) {
                try {
                    setSyncStatus(JSON.parse(cached));
                } catch (e) {}
            }
        }
    }, []);

    // Cargar siempre el estado de última actualización al entrar o refrescar la página
    useEffect(() => {
        const cached = localStorage.getItem('logix_last_sync_status');
        if (cached) {
            try {
                setSyncStatus(JSON.parse(cached));
            } catch (e) {}
        }
        fetchSyncStatus();
    }, [fetchSyncStatus]);

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
        let unlistenSync = null;
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

                        unlistenSync = await eventApi.listen('network-sync-event', () => {
                            if (isMounted) {
                                fetchSyncStatus();
                            }
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
            if (typeof unlistenSync === 'function') unlistenSync();
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
        <div className="max-w-[1440px] mx-auto px-6 py-4 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f9f9fb] min-h-screen text-[#1f1f1f] text-[12px] font-normal tracking-normal">
            
            {/* Mensajes de Notificación */}
            {messages.error && (
                <div className="mb-3 bg-[#fdf2f2] text-[#a80000] px-3 py-2 border border-[#f3c5c5] rounded flex justify-between items-center text-[11px] font-normal tracking-normal">
                    <div className="flex items-center gap-2">
                        <span className="font-normal">[Error]</span>
                        <span>{messages.error}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-[#a80000] hover:underline text-[11px] font-normal px-1 cursor-pointer">
                        Cerrar
                    </button>
                </div>
            )}
            {messages.info && (
                <div className="mb-3 bg-[#f0f6ff] text-[#0067c0] px-3 py-2 border border-[#cce0ff] rounded flex justify-between items-center text-[11px] font-normal tracking-normal">
                    <div className="flex items-center gap-2">
                        <span className="font-normal">[Información]</span>
                        <span>{messages.info}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-[#0067c0] hover:underline text-[11px] font-normal px-1 cursor-pointer">
                        Cerrar
                    </button>
                </div>
            )}
            {messages.success && (
                <div className="mb-3 bg-[#f4fbf6] text-[#107c41] px-3 py-2 border border-[#c2e8cf] rounded flex justify-between items-center text-[11px] font-normal tracking-normal">
                    <div className="flex items-center gap-2">
                        <span className="font-normal">[Éxito]</span>
                        <span>{messages.success}</span>
                    </div>
                    <button type="button" onClick={clearMessages} className="text-[#107c41] hover:underline text-[11px] font-normal px-1 cursor-pointer">
                        Cerrar
                    </button>
                </div>
            )}

            {/* Grid Principal */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">

                {/* Fila 1 - Columna Izquierda: Carga Manual */}
                <div className="lg:col-span-7 bg-white border border-[#e5e5e5] rounded p-3.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#f0f0f0]">
                            <div>
                                <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                    Carga manual de ficheros
                                </span>
                                <span className="text-[11px] text-[#7f7f7f] font-normal">
                                    Importación de archivos CSV o Excel a la base de datos local
                                </span>
                            </div>
                            <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-[#f3f3f3] text-[#5f5f5f] border border-[#d1d5db]">
                                Formatos: CSV / XLSX
                            </span>
                        </div>

                        <form onSubmit={handleFileUpdate} className="flex flex-col">
                            {/* Dropzone */}
                            <div
                                className={`border border-dashed rounded p-5 text-center transition-colors cursor-pointer mb-3 ${dragActive ? 'border-[#0067c0] bg-[#f0f6ff]' : 'border-[#d1d5db] hover:border-[#999] bg-[#fafafa] hover:bg-[#f3f3f3]'}`}
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
                                <div className="flex flex-col items-center justify-center py-1">
                                    <p className="text-[12px] font-normal text-[#1f1f1f] mb-0.5">
                                        Haga clic para seleccionar o arrastre archivos aquí
                                    </p>
                                    <p className="text-[11px] text-[#7f7f7f] font-normal">
                                        Archivos admitidos: CSV (250, 280, 240, LAMP0006) y Excel (.xlsx)
                                    </p>
                                </div>
                            </div>

                            {/* Lista de Archivos Seleccionados */}
                            {files.length > 0 && (
                                <div className="mb-3 space-y-1 bg-[#fafafa] p-2 rounded border border-[#e5e5e5]">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[11px] font-normal text-[#1f1f1f]">
                                            Archivos seleccionados ({files.length}):
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setFiles([])}
                                            className="text-[11px] text-[#a80000] hover:underline font-normal cursor-pointer"
                                        >
                                            Quitar todos
                                        </button>
                                    </div>
                                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                                        {files.map((file, idx) => (
                                             <div key={idx} className="flex items-center justify-between px-2 py-1 bg-white border border-[#e5e5e5] rounded text-[11px]">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className="font-normal text-[#1f1f1f] truncate">{file.name}</span>
                                                    <span className="text-[10px] text-[#7f7f7f] font-normal">({(file.size / 1024).toFixed(1)} KB)</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeFile(idx)}
                                                    className="text-[#a80000] hover:underline text-[10px] font-normal ml-2 flex-shrink-0 cursor-pointer"
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
                                <div className="mb-3 bg-[#fafafa] border border-[#e5e5e5] p-2.5 rounded">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#e5e5e5]">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-normal text-[#1f1f1f]">
                                                Filtro de GRN (Archivo 280)
                                            </span>
                                            <div className="flex gap-2 border-l border-[#d1d5db] pl-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedGrns([...availableGrns])}
                                                    className={`text-[10px] font-normal cursor-pointer ${selectedGrns.length === availableGrns.length ? 'text-[#0067c0] underline' : 'text-[#7f7f7f] hover:text-[#1f1f1f]'}`}
                                                >
                                                    Marcar todas
                                                </button>
                                                <span className="text-[#d1d5db]">|</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedGrns([])}
                                                    className={`text-[10px] font-normal cursor-pointer ${selectedGrns.length === 0 ? 'text-[#0067c0] underline' : 'text-[#7f7f7f] hover:text-[#1f1f1f]'}`}
                                                >
                                                    Desmarcar todas
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 bg-white px-2 py-0.5 rounded border border-[#d1d5db] text-[11px]">
                                            <label className="flex items-center gap-1 cursor-pointer">
                                                <input type="radio" value="combine" checked={updateOption === 'combine'} onChange={e => setUpdateOption(e.target.value)} className="accent-[#0067c0]" />
                                                <span className="font-normal text-[#1f1f1f]">Combinar</span>
                                            </label>
                                            <label className="flex items-center gap-1 cursor-pointer">
                                                <input type="radio" value="replace" checked={updateOption === 'replace'} onChange={e => setUpdateOption(e.target.value)} className="accent-[#0067c0]" />
                                                <span className="font-normal text-[#1f1f1f]">Reemplazar</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div className="max-h-28 overflow-y-auto bg-white p-1.5 border border-[#e5e5e5] grid grid-cols-2 sm:grid-cols-3 gap-1 rounded">
                                        {availableGrns.map(grn => (
                                            <label key={grn} className="flex items-center gap-1.5 p-0.5 rounded hover:bg-[#f3f3f3] cursor-pointer">
                                                <input type="checkbox" checked={selectedGrns.includes(grn)} onChange={e => e.target.checked ? setSelectedGrns(p => [...p, grn]) : setSelectedGrns(p => p.filter(g => g !== grn))} className="accent-[#0067c0]" />
                                                <span className="text-[11px] font-normal text-[#1f1f1f]">{grn}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Botón Principal de Publicar */}
                            <button
                                disabled={isLoading || files.length === 0}
                                type="submit"
                                className="w-full h-7 text-[12px] font-normal text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-1"
                                style={{ background: files.length > 0 && !isLoading ? '#0067c0' : '#888' }}
                            >
                                {isLoading ? 'Procesando y publicando datos...' : 'Publicar actualización'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Fila 1 - Columna Derecha: Mantenimiento de Datos */}
                <div className="lg:col-span-5 bg-white border border-[#e5e5e5] rounded p-3.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="pb-2 mb-3 border-b border-[#f0f0f0]">
                            <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                Mantenimiento de datos
                            </span>
                            <span className="text-[11px] text-[#7f7f7f] font-normal">
                                Exportación y depuración selectiva del sistema
                            </span>
                        </div>

                        <div className="space-y-3">
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
                                    <label className="text-[11px] font-normal text-[#1f1f1f]">
                                        Exportación de históricos
                                    </label>
                                    <span className="text-[10px] text-[#7f7f7f] font-mono">Excel (.xlsx)</span>
                                </div>
                                <p className="text-[11px] text-[#7f7f7f] font-normal leading-normal">
                                    Descarga de copia de seguridad consolidada con la totalidad de registros.
                                </p>
                                <div className="relative w-full">
                                    <input
                                        type={showBackupPassword ? "text" : "password"}
                                        name="password"
                                        placeholder="Contraseña de administrador"
                                        value={backupPassword}
                                        onChange={e => setBackupPassword(e.target.value)}
                                        className="w-full h-7 border border-[#d1d5db] rounded px-2 pr-14 text-[12px] placeholder:text-[#999] outline-none bg-white text-[#1f1f1f] focus:border-[#0067c0] font-normal"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowBackupPassword(!showBackupPassword)}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#0067c0] hover:underline font-normal cursor-pointer px-1 py-0.5"
                                        tabIndex={-1}
                                    >
                                        {showBackupPassword ? 'Ocultar' : 'Ver'}
                                    </button>
                                </div>
                                <button
                                    type="submit"
                                    className="w-full h-7 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer"
                                >
                                    Generar respaldo
                                </button>
                            </form>

                            {/* Limpieza Selectiva de Maestro GRN */}
                            <div className="space-y-2 pt-2.5 border-t border-[#f0f0f0]">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <label className="text-[11px] font-normal text-[#1f1f1f] block">
                                            Limpieza de maestro (GRN)
                                        </label>
                                        <span className="text-[11px] text-[#7f7f7f] font-normal">
                                            Depuración puntual de números GRN
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={maestroGrns.length > 0 || messages.info?.includes("VACÍO") ? () => { setMaestroGrns([]); setMessages(prev => ({ ...prev, info: '' })) } : fetchMaestroGrns}
                                        disabled={isFetchingMaestro}
                                        className="h-6 px-2 text-[11px] font-normal rounded bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] transition-colors cursor-pointer"
                                    >
                                        {isFetchingMaestro ? 'Cargando...' : (maestroGrns.length > 0 || messages.info?.includes("VACÍO") ? 'Ocultar' : 'Ver lista')}
                                    </button>
                                </div>

                                {maestroGrns.length > 0 ? (
                                    <div className="space-y-2 bg-[#fafafa] p-2 rounded border border-[#e5e5e5]">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[11px] font-normal text-[#1f1f1f]">{maestroGrns.length} GRNs encontrados</span>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => setSelectedMaestroGrns([...maestroGrns])} className="text-[10px] font-normal text-[#0067c0] hover:underline cursor-pointer">Todas</button>
                                                <button type="button" onClick={() => setSelectedMaestroGrns([])} className="text-[10px] font-normal text-[#0067c0] hover:underline cursor-pointer">Ninguna</button>
                                            </div>
                                        </div>
                                        <div className="max-h-24 overflow-y-auto bg-white p-1.5 border border-[#e5e5e5] rounded space-y-0.5">
                                            {maestroGrns.map((grn, idx) => {
                                                const grnStr = typeof grn === 'string' ? grn : grn?.reference || grn?.grn || String(grn);
                                                return (
                                                    <label key={grnStr || idx} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-[#f3f3f3] cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedMaestroGrns.includes(grnStr)}
                                                            onChange={e => e.target.checked ? setSelectedMaestroGrns(p => [...p, grnStr]) : setSelectedMaestroGrns(p => p.filter(g => g !== grnStr))}
                                                            className="accent-[#0067c0]"
                                                        />
                                                        <span className="text-[11px] font-normal text-[#1f1f1f]">{grnStr}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>

                                        <form onSubmit={handleDeleteMaestroGrns} className="space-y-1.5">
                                            <div className="relative w-full">
                                                <input
                                                    type={showDeleteMaestroPassword ? "text" : "password"}
                                                    placeholder="Contraseña de administrador"
                                                    value={deleteMaestroPassword}
                                                    onChange={e => setDeleteMaestroPassword(e.target.value)}
                                                    className="w-full h-7 border border-[#d1d5db] rounded px-2 pr-14 text-[12px] outline-none bg-white text-[#1f1f1f] placeholder:text-[#999] focus:border-[#0067c0] font-normal"
                                                    required
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDeleteMaestroPassword(!showDeleteMaestroPassword)}
                                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#0067c0] hover:underline font-normal cursor-pointer px-1 py-0.5"
                                                    tabIndex={-1}
                                                >
                                                    {showDeleteMaestroPassword ? 'Ocultar' : 'Ver'}
                                                </button>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={isLoading || selectedMaestroGrns.length === 0}
                                                className="w-full h-7 text-[12px] font-normal text-white rounded bg-[#a80000] hover:bg-[#8f0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                            >
                                                Eliminar seleccionados ({selectedMaestroGrns.length})
                                            </button>
                                        </form>
                                    </div>
                                ) : (
                                    messages.info && <p className="text-[11px] text-[#5f5f5f] bg-[#fafafa] p-2 rounded border border-[#e5e5e5] font-normal">{messages.info}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Fila 2 - Columna Izquierda: Fechas de Actualización */}
                <div className="lg:col-span-7 bg-white border border-[#e5e5e5] rounded p-3.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#f0f0f0]">
                            <div>
                                <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                    Fechas de actualización de maestros
                                </span>
                                <span className="text-[11px] text-[#7f7f7f] font-normal">
                                    Última marca de tiempo registrada por fuente de datos
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={fetchSyncStatus}
                                className="text-[11px] text-[#0067c0] hover:underline font-normal cursor-pointer"
                                title="Refrescar estado"
                            >
                                Refrescar
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
                                        className={`p-2 rounded border border-[#e5e5e5] bg-[#fafafa] flex flex-col justify-between ${item.fullWidth ? 'md:col-span-2' : ''}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-[12px] font-normal text-[#1f1f1f]">{item.label}</span>
                                            <span className="text-[10px] font-mono font-normal bg-white text-[#5f5f5f] px-1.5 py-0.5 rounded border border-[#d1d5db]">
                                                {item.filename}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-1 border-t border-[#f0f0f0] text-[11px]">
                                            <span className="text-[#7f7f7f] font-normal">Última modificación</span>
                                            <span className={`font-normal ${hasData ? 'text-[#1f1f1f]' : 'text-[#999]'}`}>
                                                {formatTimestamp(syncStatus[item.key])}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Fila 2 - Columna Derecha: Zona de Riesgo */}
                <div className="lg:col-span-5 bg-white border border-[#e5e5e5] rounded p-3.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="pb-2 mb-3 border-b border-[#f0f0f0]">
                            <span className="text-[12px] font-normal text-[#a80000] block">
                                Zona de riesgo: restablecimiento total
                            </span>
                            <span className="text-[11px] text-[#7f7f7f] font-normal">
                                Acción destructiva e irreversible
                            </span>
                        </div>

                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            if (!window.confirm("¿Desea borrar toda la base de datos local? Esta acción no se puede deshacer.")) return;
                            setIsLoading(true);
                            try {
                                const res = await fetch('/api/clear_database', { method: 'POST', body: new FormData(e.target) });
                                const d = await res.json();
                                if (res.ok) setMessages({ success: d.message || "Base de datos restablecida" }); else setMessages({ error: d.error || "Error" });
                            } catch (err) { setMessages({ error: "Error al limpiar la base de datos" }); }
                            finally { setIsLoading(false); setClearPassword(''); }
                        }} className="space-y-3 flex-1 flex flex-col justify-between">
                            <p className="text-[11px] text-[#5f5f5f] font-normal leading-normal">
                                Esta acción eliminará permanentemente todas las tablas de ítems, GRNs, auditorías y movimientos locales en SQLite.
                            </p>
                            <div className="space-y-2 mt-auto pt-1">
                                <div className="relative w-full">
                                    <input
                                        type={showClearPassword ? "text" : "password"}
                                        name="password"
                                        placeholder="Contraseña de administrador"
                                        value={clearPassword}
                                        onChange={e => setClearPassword(e.target.value)}
                                        className="w-full h-7 border border-[#d1d5db] rounded px-2 pr-14 text-[12px] placeholder:text-[#999] outline-none bg-white text-[#1f1f1f] focus:border-[#a80000] font-normal"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowClearPassword(!showClearPassword)}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#0067c0] hover:underline font-normal cursor-pointer px-1 py-0.5"
                                        tabIndex={-1}
                                    >
                                        {showClearPassword ? 'Ocultar' : 'Ver'}
                                    </button>
                                </div>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full h-7 text-[12px] font-normal text-[#a80000] bg-white border border-[#f3c5c5] rounded hover:bg-[#fdf2f2] transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    Limpiar toda la base de datos
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
