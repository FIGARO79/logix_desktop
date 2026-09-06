import React, { useState, useEffect, useCallback } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';
import { useOffline } from '../hooks/useOffline';
import { getDB, savePendingSync } from '../utils/offlineDb';
import { parseGS1Barcode } from '../utils/gs1Parser';

const CycleCounts = () => {
    const { setTitle } = useOutletContext();
    const { isOnline } = useOffline();

    useEffect(() => { setTitle("Inventario W2W"); }, [setTitle]);

    // Session State
    const [activeSession, setActiveSession] = useState(null);
    const [checkingSession, setCheckingSession] = useState(true);

    // Form State
    const [countedLocation, setCountedLocation] = useState('');
    const [itemCode, setItemCode] = useState('');
    const [description, setDescription] = useState('');
    const [binSys, setBinSys] = useState('');
    const [countedQty, setCountedQty] = useState('');
    const [loadingItem, setLoadingItem] = useState(false);
    const [validBins, setValidBins] = useState(new Set());

    // Sidebar Data
    const [locationCounts, setLocationCounts] = useState([]);
    const [sessionLocations, setSessionLocations] = useState([]);

    // Recount State for Mobile
    const [recountData, setRecountData] = useState(null);
    const [showRecountModal, setShowRecountModal] = useState(false);
    const [recountFilter, setRecountFilter] = useState('pending'); // 'pending' | 'all'
    const [selectedPhase, setSelectedPhase] = useState(null);
    const [recountSearchQuery, setRecountSearchQuery] = useState('');
    const [recountItemModal, setRecountItemModal] = useState(null);

    // Scanner
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanTarget, setScanTarget] = useState(null); // 'location' or 'item'

    const fetchRecountList = useCallback(async () => {
        if (!isOnline) return;
        try {
            const res = await fetch('/api/recount_list/active');
            if (res.ok) {
                const data = await res.json();
                setRecountData(data);
            }
        } catch (e) {
            console.error("Error al cargar lista de reconteo:", e);
        }
    }, [isOnline]);

    const selectItemForRecount = (item) => {
        setRecountItemModal({
            item_code: item.item_code,
            description: item.description,
            bin_location: item.bin_location || 'N/A',
            counted_location: (item.bin_location && item.bin_location !== 'N/A') ? item.bin_location : (countedLocation || ''),
            counted_qty: ''
        });
    };

    const handleSaveRecountItem = async (e) => {
        e.preventDefault();
        if (!recountItemModal) return;
        const { item_code, counted_location, counted_qty } = recountItemModal;
        if (!counted_location || counted_qty === '') {
            toast.error("Complete la ubicación y la cantidad observada");
            return;
        }
        try {
            const payload = {
                session_id: activeSession.id || activeSession.session_id,
                counted_location: counted_location.toUpperCase(),
                item_code: item_code.toUpperCase(),
                counted_qty: parseFloat(counted_qty)
            };
            const res = await fetch('/api/counts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "Error al guardar reconteo");
            }
            toast.success(`Reconteo guardado: ${item_code} = ${counted_qty}`);
            setRecountItemModal(null);
            fetchRecountList();
            updateSidebarData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const checkActiveSession = useCallback(async () => {
        setCheckingSession(true);
        try {
            if (isOnline) {
                const res = await fetch('/api/sessions/active');
                if (res.ok) {
                    const session = await res.json();
                    if (session && (session.id || session.session_id)) {
                        setActiveSession(session);
                        // Guardar en caché
                        const db = await getDB();
                        await db.put('active_sessions', { type: 'cycle_count', ...session });
                    } else {
                        setActiveSession(null);
                        const db = await getDB();
                        await db.delete('active_sessions', 'cycle_count');
                    }
                } else {
                    setActiveSession(null);
                }
            } else {
                // Modo Offline: buscar en caché
                const db = await getDB();
                const cached = await db.get('active_sessions', 'cycle_count');
                if (cached) {
                    setActiveSession(cached);
                    toast.info("Cargada sesión activa de caché local");
                } else {
                    setActiveSession(null);
                }
            }
        } catch (e) {
            console.error(e);
            setActiveSession(null);
        } finally {
            setCheckingSession(false);
        }
    }, [isOnline]);

    const startSession = async () => {
        if (!isOnline) {
            toast.error("Debe estar online para iniciar una nueva sesión");
            return;
        }
        try {
            const res = await fetch('/api/sessions/start', { method: 'POST' });
            if (res.ok) {
                const session = await res.json();
                setActiveSession(session);
                const db = await getDB();
                await db.put('active_sessions', { type: 'cycle_count', ...session });
                toast.success("Sesión de inventario iniciada");
            } else {
                toast.error("Error iniciando sesión");
            }
        } catch (e) {
            toast.error("Error de conexión");
        }
    };

    const endSession = async () => {
        if (!activeSession) return;
        if (!confirm("¿Seguro que desea finalizar la sesión de inventario?")) return;

        if (!isOnline) {
            toast.error("Debe estar online para finalizar la sesión oficialmente");
            return;
        }

        try {
            const sessionId = activeSession.id || activeSession.session_id;
            const res = await fetch(`/api/sessions/${sessionId}/close`, { method: 'POST' });
            if (res.ok) {
                setActiveSession(null);
                const db = await getDB();
                await db.delete('active_sessions', 'cycle_count');
                clearForm();
                toast.success("Sesión finalizada");
            } else {
                toast.error("Error finalizando sesión");
            }
        } catch (e) {
            toast.error("Error de conexión");
        }
    };

    const updateSidebarData = useCallback(async () => {
        if (!activeSession) return;

        if (isOnline) {
            const sessionId = activeSession.id || activeSession.session_id;
            try {
                const res = await fetch(`/api/sessions/${sessionId}/locations`);
                if (res.ok) setSessionLocations(await res.json());
            } catch (e) { console.error(e); }

            if (countedLocation) {
                try {
                    const res = await fetch(`/api/sessions/${sessionId}/counts/${encodeURIComponent(countedLocation)}`);
                    if (res.ok) setLocationCounts(await res.json());
                } catch (e) { console.error(e); }
            } else {
                setLocationCounts([]);
            }
            fetchRecountList();
        } else {
            const db = await getDB();
            const allPending = await db.getAll('pending_sync');
            const localMatches = allPending
                .filter(p => p.collection === 'counts' && p.payload.counted_location === countedLocation)
                .map(p => ({
                    id: p.id,
                    item_code: p.payload.item_code,
                    counted_qty: p.payload.counted_qty,
                    is_pending: true
                }));
            setLocationCounts(localMatches);
        }
    }, [activeSession, isOnline, countedLocation, fetchRecountList]);

    useEffect(() => {
        checkActiveSession();
    }, [checkActiveSession]);

    useEffect(() => {
        if (activeSession) {
            updateSidebarData();
            fetchRecountList();
        }
    }, [activeSession, countedLocation, updateSidebarData, fetchRecountList]);

    const loadSlottingBins = async () => {
        let binsLoaded = false;
        if (isOnline) {
            try {
                const res = await fetch('/api/views/valid_bins', { credentials: 'include' });
                if (res.ok) {
                    const binsList = await res.json();
                    if (Array.isArray(binsList) && binsList.length > 0) {
                        const binsSet = new Set(binsList.map(b => b.toUpperCase()));
                        setValidBins(binsSet);
                        const db = await getDB();
                        await db.put('data_cache', { key: 'slotting_valid_bins', data: binsList, timestamp: new Date().toISOString() });
                        binsLoaded = true;
                    }
                }
            } catch (e) {
                console.warn("Error loading valid bins online:", e);
            }
        }

        if (!binsLoaded) {
            try {
                const db = await getDB();
                const cached = await db.get('data_cache', 'slotting_valid_bins');
                if (cached && Array.isArray(cached.data)) {
                    const binsSet = new Set(cached.data.map(b => b.toUpperCase()));
                    setValidBins(binsSet);
                }
            } catch (e) {
                console.error("Error loading cached bins:", e);
            }
        }
    };

    useEffect(() => {
        loadSlottingBins();
    }, [isOnline]);

    const searchItem = async (codeToSearch) => {
        let code = codeToSearch || itemCode;
        if (!code) return;

        // Parsear código GS1 si aplica
        const gs1Result = parseGS1Barcode(code);
        if (gs1Result.isGS1 && gs1Result.itemCode) {
            code = gs1Result.itemCode;
            setItemCode(code);
            toast.info(`Código GS1 decodificado: SKU ${code}` + (gs1Result.lotNumber ? ` | Lote: ${gs1Result.lotNumber}` : ''));
        }

        setLoadingItem(true);
        setDescription('');
        setBinSys('');

        try {
            if (isOnline) {
                const res = await fetch(`/api/get_item_for_counting/${encodeURIComponent(code)}`);
                if (res.ok) {
                    const data = await res.json();
                    setItemCode(data.item_code);
                    setDescription(data.description);
                    setBinSys(data.bin_location || 'N/A');
                    if (!data.in_master) {
                        toast.info("Ítem no registrado en maestro (admitido para conteo W2W)");
                    }
                    document.getElementById('counted_qty')?.focus();
                } else {
                    toast.error("Error consultando ítem");
                }
            } else {
                // Offline: buscar en maestro local
                const db = await getDB();
                const localItem = await db.get('master_items', code.trim().toUpperCase());
                if (localItem) {
                    setItemCode(localItem.Item_Code);
                    setDescription(localItem.Item_Description);
                    setBinSys(localItem.Bin_1 || 'N/A');
                } else {
                    setItemCode(code.trim().toUpperCase());
                    setDescription('ITEM NO REGISTRADO EN MAESTRO');
                    setBinSys('N/A');
                    toast.info("Ítem no encontrado en maestro local (admitido para conteo W2W)");
                }
                document.getElementById('counted_qty')?.focus();
            }
        } catch (e) {
            toast.error("Error buscando item");
        } finally {
            setLoadingItem(false);
        }
    };

    const handleSaveCount = async (e) => {
        e.preventDefault();
        if (!activeSession || !countedLocation || !itemCode || countedQty === '') {
            toast.warning("Complete todos los campos obligatorios");
            return;
        }

        const normalizedLocation = countedLocation.trim().toUpperCase();
        if (validBins.size > 0 && !validBins.has(normalizedLocation)) {
            toast.error(`La ubicación "${normalizedLocation}" no existe en el maestro de slotting.`);
            return;
        }

        const parsedQty = parseInt(countedQty, 10);
        if (isNaN(parsedQty)) {
            toast.error("Ingrese una cantidad entera válida");
            return;
        }

        const payload = {
            session_id: activeSession.id || activeSession.session_id,
            item_code: itemCode,
            counted_qty: parsedQty,
            counted_location: normalizedLocation,
            description: description,
            bin_location_system: binSys,
            timestamp: new Date().toISOString()
        };

        try {
            const db = await getDB();
            const countRecord = {
                id: crypto.randomUUID(),
                item_code: payload.item_code,
                description: payload.description,
                bin_location: payload.counted_location || payload.bin_location_system || 'N/A',
                system_qty: payload.system_qty || 0,
                physical_qty: payload.counted_qty || 0,
                difference: (payload.counted_qty || 0) - (payload.system_qty || 0),
                username: payload.username || 'Local',
                executed_date: new Date().toISOString()
            };

            await db.put('local_counts', countRecord);

            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('logix_events');
                bc.postMessage({ type: 'CYCLE_COUNT_MUTATED' });
                bc.close();
            }
            toast.success("Conteo guardado exitosamente en la base de datos local");
            clearFormAfterSave();

        } catch (e) {
            console.error("Error al guardar conteo local:", e);
            toast.error("Error al guardar conteo");
            clearFormAfterSave();
        }
    };

    const clearFormAfterSave = () => {
        setItemCode('');
        setDescription('');
        setBinSys('');
        setCountedQty('');
        updateSidebarData(); 
        document.getElementById('itemCode')?.focus();
    };

    const closeLocation = async () => {
        if (!activeSession || !countedLocation) return;
        if (!confirm(`¿Cerrar ubicación ${countedLocation}?`)) return;

        if (!isOnline) {
            toast.error("Debe estar online para cerrar ubicaciones");
            return;
        }

        try {
            const res = await fetch('/api/locations/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: activeSession.id || activeSession.session_id, location_code: countedLocation })
            });
            if (res.ok) {
                toast.success(`Ubicación ${countedLocation} cerrada`);
                setCountedLocation('');
                clearForm();
                updateSidebarData();
            } else {
                toast.error("Error cerrando ubicación");
            }
        } catch (e) { toast.error("Error de conexión"); }
    };

    const deleteCount = async (id) => {
        if (!confirm("¿Eliminar este conteo?")) return;
        
        if (typeof id === 'string' && id.includes('-')) {
            // Es un registro pendiente en IndexedDB
            try {
                const db = await getDB();
                await db.delete('pending_sync', id);
                toast.success("Eliminado (Local)");
                updateSidebarData();
                return;
            } catch (e) { console.error(e); }
        }

        if (!isOnline) {
            toast.error("No se pueden eliminar registros del servidor en modo offline");
            return;
        }

        try {
            const res = await fetch(`/api/counts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success("Eliminado");
                updateSidebarData();
            }
        } catch (e) { toast.error("Error al eliminar"); }
    };

    const clearForm = () => {
        setItemCode('');
        setDescription('');
        setBinSys('');
        setCountedQty('');
    };

    // Scanner Logic
    const startScanner = (target) => {
        setScanTarget(target);
        setScannerOpen(true);
    };

    const handleScan = (code) => {
        setScannerOpen(false);
        const text = code.toUpperCase();
        if (scanTarget === 'location') {
            setCountedLocation(text);
        } else if (scanTarget === 'item') {
            setItemCode(text);
            fetchItemData(text);
        }
    };


    if (checkingSession) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-black">
                <svg className="w-8 h-8 animate-spin text-black" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-xs font-normal uppercase tracking-widest text-black">Consultando sesión de inventario...</span>
            </div>
        );
    }

    if (!activeSession) {
        return (
            <div className="max-w-md mx-auto my-12 p-6 bg-white rounded border border-[#d1d5db] text-center text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif] shadow-sm">
                <h2 className="text-[14px] font-normal text-[#1f1f1f] mb-1">Inventario General (W2W)</h2>
                <p className="text-[12px] text-[#5c5c5c] mb-5 leading-relaxed font-normal">No hay ninguna sesión activa. Inicie una nueva sesión para comenzar la captura física wall-to-wall.</p>
                <button
                    onClick={startSession}
                    disabled={!isOnline}
                    className="w-full h-8 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                    Iniciar Sesión de Inventario
                </button>
                {!isOnline && (
                    <p className="mt-3 text-[#991b1b] text-[11px] font-normal">
                        Se requiere conexión a la red para iniciar sesión
                    </p>
                )}
            </div>
        );
    }

    // PÁGINA INTERMEDIA: Selección de Fase de Conteo
    if (selectedPhase === null) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-6 text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif]">
                <ToastContainer position="top-right" autoClose={2000} />
                <div className="bg-white rounded border border-[#d1d5db] p-5 mb-4 shadow-sm">
                    <div className="flex justify-between items-center pb-3 border-b border-[#e5e7eb] mb-5">
                        <div>
                            <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">
                                Sesión de Inventario #{activeSession.id || activeSession.session_id}
                            </h1>
                            <p className="text-[11.5px] text-[#5c5c5c] font-normal mt-0.5 mb-0">
                                Auditor: <span className="text-[#1f1f1f] font-normal">{activeSession.user_username || activeSession.username}</span>
                            </p>
                        </div>
                        <button
                            onClick={endSession}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer"
                        >
                            Finalizar Sesión
                        </button>
                    </div>

                    <div className="text-center mb-6">
                        <h2 className="text-[14px] font-normal text-[#1f1f1f] mb-1">
                            Seleccione la Fase de Conteo a Ejecutar
                        </h2>
                        <p className="text-[12px] text-[#5c5c5c] font-normal m-0">
                            Fase Activa en Sistema: <span className="text-[#065f46] font-normal bg-[#ecfdf5] px-2 py-0.5 rounded border border-[#a7f3d0]">Fase 0{recountData?.stage || 1}</span>
                        </p>
                    </div>

                    <div className="space-y-2.5">
                        {[
                            {
                                s: 1,
                                title: 'FASE 1: CONTEO GENERAL W2W',
                                desc: 'Captura inicial física wall-to-wall de ítems en almacén con formulario limpio directo.',
                                btnText: 'Ingresar a Conteo Fase 1'
                            },
                            {
                                s: 2,
                                title: 'FASE 2: RECONTEO R1',
                                desc: 'Lista de ítems con discrepancia o faltantes de Fase 1 para verificación obligatoria.',
                                btnText: 'Ver Lista de Reconteo R1'
                            },
                            {
                                s: 3,
                                title: 'FASE 3: RECONTEO R2',
                                desc: 'Segunda validación técnica enfocada en discrepancias persistentes.',
                                btnText: 'Ver Lista de Reconteo R2'
                            },
                            {
                                s: 4,
                                title: 'FASE 4: AUDITORÍA FINAL',
                                desc: 'Revisión final de auditoría técnica previa a la consolidación e informe.',
                                btnText: 'Ver Lista Auditoría Final'
                            }
                        ].map(f => {
                            const currentSystemStage = recountData?.stage || 1;
                            const isSystemActive = currentSystemStage === f.s;
                            const isPassed = currentSystemStage > f.s;

                            return (
                                <div
                                    key={f.s}
                                    onClick={() => {
                                        if (isSystemActive) {
                                            setSelectedPhase(f.s);
                                        } else if (isPassed) {
                                            toast.warn(`La Fase ${f.s} ya ha sido finalizada y no permite nuevos registros.`);
                                        } else {
                                            toast.info(`La Fase ${f.s} estará disponible cuando el administrador avance la etapa.`);
                                        }
                                    }}
                                    className={`p-3.5 rounded border text-left transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                        isSystemActive
                                            ? 'border-[#0067c0] ring-1 ring-[#0067c0] bg-white shadow-xs cursor-pointer hover:bg-[#f8f9fa]'
                                            : isPassed
                                            ? 'border-[#e5e7eb] bg-[#f9fafb] opacity-70 cursor-not-allowed'
                                            : 'border-[#e5e7eb] bg-[#fafafa] opacity-50 cursor-not-allowed'
                                    }`}
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-[12px] font-normal text-[#1f1f1f] m-0">
                                                {f.title}
                                            </h3>
                                            {isSystemActive ? (
                                                <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0] shrink-0">
                                                    Activa en Sistema
                                                </span>
                                            ) : isPassed ? (
                                                <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-[#f3f4f6] text-[#1f1f1f] border border-[#d1d5db] shrink-0">
                                                    Finalizada
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-[#f9fafb] text-[#8c8c8c] border border-[#e5e7eb] shrink-0">
                                                    En Espera
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11.5px] text-[#5c5c5c] font-normal leading-relaxed m-0">
                                            {f.desc}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={!isSystemActive}
                                        className={`sm:w-44 h-7 px-3 text-[12px] font-normal rounded transition-colors shrink-0 ${
                                            isSystemActive
                                                ? 'bg-[#0067c0] text-white hover:bg-[#005a9e] shadow-xs cursor-pointer'
                                                : isPassed
                                                ? 'bg-[#f3f4f6] text-[#8c8c8c] border border-[#d1d5db] cursor-not-allowed'
                                                : 'bg-[#f9fafb] text-[#8c8c8c] border border-[#e5e7eb] cursor-not-allowed'
                                        }`}
                                    >
                                        {isSystemActive ? f.btnText : isPassed ? 'Fase Finalizada' : 'En Espera'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] text-[12px] text-[#1f1f1f] bg-[#f8f9fa] min-h-screen">
            <ToastContainer position="top-right" autoClose={2000} />

            {/* Header de Navegación entre Fases */}
            <div className="mb-3 p-2 bg-white border border-[#d1d5db] rounded flex justify-between items-center shadow-sm">
                <button
                    type="button"
                    onClick={() => setSelectedPhase(null)}
                    className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer shadow-xs"
                >
                    ← Cambiar de Fase
                </button>
                <div className="text-[12px] font-normal text-[#1f1f1f] flex items-center gap-2">
                    <span>Fase Actual: <strong className="font-normal text-[#0067c0]">0{selectedPhase}</strong></span>
                    {recountData?.stage === selectedPhase && (
                        <span className="bg-[#ecfdf5] text-[#065f46] text-[11px] px-2 py-0.5 rounded border border-[#a7f3d0]">
                            Activa en Sistema
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

                {/* Main Form Panel */}
                <div className="lg:col-span-2 bg-white rounded shadow-sm border border-[#d1d5db] p-3">
                    {/* Header */}
                    <div className="flex justify-between items-center pb-2 mb-3 border-b border-[#e5e7eb]">
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-[13px] font-normal text-[#1f1f1f] m-0">
                                    Sesión #{activeSession.id || activeSession.session_id}
                                </h1>
                                {!isOnline && (
                                    <span className="text-[10px] bg-[#fef2f2] text-[#991b1b] px-1.5 py-0.5 rounded border border-[#fecaca] font-normal">
                                        Offline
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-[#5c5c5c] font-normal mt-0.5 mb-0">
                                Auditor: <span className="text-[#1f1f1f] font-normal">{activeSession.user_username || activeSession.username}</span>
                            </p>
                        </div>
                        <button
                            onClick={endSession}
                            className="h-7 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal transition-colors cursor-pointer shadow-xs"
                        >
                            Finalizar Sesión
                        </button>
                    </div>

                    {/* VISTA FASE 1: Formulario Limpio de Captura W2W */}
                    {selectedPhase === 1 && (
                        <form onSubmit={handleSaveCount} className="space-y-3">
                            {/* Location Input Group */}
                            <div>
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                    Ubicación Física <span className="text-[#991b1b]">*</span>
                                </label>
                                <div className="flex items-center gap-1.5">
                                    <div className="relative flex-grow">
                                        <input
                                            type="text"
                                            value={countedLocation}
                                            onChange={e => setCountedLocation(e.target.value.toUpperCase())}
                                            className="w-full h-7 border border-[#d1d5db] rounded px-2 text-[12px] font-normal text-[#1f1f1f] uppercase bg-white focus:outline-none focus:border-[#0067c0]"
                                            placeholder="Scan o digite ubicación..."
                                            required
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => startScanner('location')}
                                        title="Escanear QR / Barcode Ubicación"
                                        className="h-7 px-2.5 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] rounded text-[11.5px] font-normal flex items-center justify-center cursor-pointer shrink-0 shadow-xs"
                                    >
                                        Escanear
                                    </button>
                                </div>
                            </div>

                            {/* Item Code Input Group */}
                            <div>
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                    Código de Artículo / SKU <span className="text-[#991b1b]">*</span>
                                </label>
                                <div className="flex items-center gap-1.5">
                                    <input
                                        id="itemCode"
                                        type="text"
                                        value={itemCode}
                                        onChange={e => setItemCode(e.target.value.toUpperCase())}
                                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), fetchItemData(itemCode))}
                                        className="flex-grow h-7 border border-[#d1d5db] rounded px-2 text-[12px] font-normal text-[#1f1f1f] uppercase bg-white focus:outline-none focus:border-[#0067c0]"
                                        placeholder="Scan o digite SKU..."
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => startScanner('item')}
                                        title="Escanear QR / Barcode SKU"
                                        className="h-7 px-2.5 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] rounded text-[11.5px] font-normal flex items-center justify-center cursor-pointer shrink-0 shadow-xs"
                                    >
                                        Escanear
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => fetchItemData(itemCode)}
                                        disabled={loadingItem}
                                        className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors shrink-0 cursor-pointer shadow-xs disabled:opacity-50"
                                    >
                                        {loadingItem ? '...' : 'Buscar'}
                                    </button>
                                </div>
                            </div>

                            {/* Description Display Card */}
                            <div>
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                    Descripción del Artículo
                                </label>
                                <div className="h-7 px-2 bg-[#f8f9fa] border border-[#d1d5db] rounded text-[12px] font-normal text-[#1f1f1f] flex items-center truncate">
                                    {description || <span className="text-[#8c8c8c] italic">No consultado</span>}
                                </div>
                            </div>

                            {/* Master Bin & Counted Qty */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                        Ubicación Maestro
                                    </label>
                                    <div className="h-7 px-2 bg-[#f8f9fa] border border-[#d1d5db] rounded text-[12px] font-normal text-[#1f1f1f] flex items-center">
                                        {binSys || '—'}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                        Cantidad Observada <span className="text-[#991b1b]">*</span>
                                    </label>
                                    <div className="flex items-center">
                                        <button
                                            type="button"
                                            onClick={() => setCountedQty(prev => Math.max(0, (parseInt(prev) || 0) - 1))}
                                            className="h-7 w-7 border border-[#d1d5db] bg-[#f8f9fa] hover:bg-[#f0f0f0] text-[#1f1f1f] font-normal text-sm rounded-l flex items-center justify-center cursor-pointer select-none p-0"
                                        >
                                            -
                                        </button>
                                        <input
                                            id="counted_qty"
                                            type="number"
                                            value={countedQty}
                                            onChange={e => setCountedQty(e.target.value)}
                                            className="h-7 flex-grow border-y border-[#d1d5db] text-center text-[12px] font-normal text-[#1f1f1f] bg-white focus:outline-none focus:border-[#0067c0] px-1"
                                            min="0"
                                            step="1"
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setCountedQty(prev => (parseInt(prev) || 0) + 1)}
                                            className="h-7 w-7 border border-[#d1d5db] bg-[#f8f9fa] hover:bg-[#f0f0f0] text-[#1f1f1f] font-normal text-sm rounded-r flex items-center justify-center cursor-pointer select-none p-0"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                                <button
                                    type="button"
                                    onClick={clearForm}
                                    className="h-7 px-3 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs"
                                >
                                    Limpiar
                                </button>
                                <button
                                    type="submit"
                                    className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded shadow-xs transition-colors cursor-pointer"
                                >
                                    Guardar Conteo
                                </button>
                            </div>
                        </form>
                    )}

                    {/* VISTA FASES 2+: Lista de Reconteo Principal (Estilo Conteos Cíclicos) */}
                    {selectedPhase >= 2 && (
                        <div className="space-y-3">
                            <div className="bg-white border border-[#d1d5db] rounded p-3 text-[#1f1f1f] shadow-xs">
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-2 mb-2 border-b border-[#e5e7eb]">
                                    <div>
                                        <h2 className="text-[13px] font-normal text-[#1f1f1f] m-0">
                                            Lista de Ítems a Recontar — Fase 0{selectedPhase}
                                        </h2>
                                        <p className="text-[11px] text-[#5c5c5c] font-normal mt-0.5 mb-0">
                                            {recountData?.recounted_count || 0} de {recountData?.total || 0} recontados ({recountData?.pending_count || 0} pendientes)
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5 items-center">
                                        <input
                                            type="text"
                                            placeholder="Buscar SKU o Ubicación..."
                                            value={recountSearchQuery}
                                            onChange={e => setRecountSearchQuery(e.target.value)}
                                            className="h-7 border border-[#d1d5db] rounded px-2 text-[12px] text-[#1f1f1f] bg-white focus:outline-none focus:border-[#0067c0]"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setRecountFilter('pending')}
                                            className={`h-7 px-2.5 text-[11.5px] font-normal rounded border transition-colors cursor-pointer ${
                                                recountFilter === 'pending'
                                                    ? 'bg-[#354a5f] border-[#354a5f] text-white'
                                                    : 'bg-white border-[#d1d5db] text-[#5c5c5c] hover:bg-[#f5f5f5]'
                                            }`}
                                        >
                                            Pendientes
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRecountFilter('all')}
                                            className={`h-7 px-2.5 text-[11.5px] font-normal rounded border transition-colors cursor-pointer ${
                                                recountFilter === 'all'
                                                    ? 'bg-[#354a5f] border-[#354a5f] text-white'
                                                    : 'bg-white border-[#d1d5db] text-[#5c5c5c] hover:bg-[#f5f5f5]'
                                            }`}
                                        >
                                            Todos
                                        </button>
                                    </div>
                                </div>

                                {/* Vista Adaptable: Tarjetas para Móvil y Tabla para Escritorio */}

                                {/* Vista Móvil (< sm) */}
                                <div className="block sm:hidden space-y-2 max-h-[500px] overflow-y-auto">
                                    {(!recountData?.items || recountData.items.length === 0) ? (
                                        <div className="text-center py-6 text-[#8c8c8c] text-[12px] italic font-normal bg-[#f8f9fa] rounded border border-[#d1d5db]">
                                            No hay ítems registrados en la lista de reconteo para esta fase.
                                        </div>
                                    ) : (
                                        recountData.items
                                            .filter(item => {
                                                const matchQuery =
                                                    item.item_code.toLowerCase().includes(recountSearchQuery.toLowerCase()) ||
                                                    (item.description && item.description.toLowerCase().includes(recountSearchQuery.toLowerCase())) ||
                                                    (item.bin_location && item.bin_location.toLowerCase().includes(recountSearchQuery.toLowerCase()));

                                                if (!matchQuery) return false;
                                                if (recountFilter === 'pending') return !item.is_recounted;
                                                return true;
                                            })
                                            .map((item, idx) => (
                                                <div
                                                    key={item.item_code || `mobile-recount-${idx}`}
                                                    className={`p-2.5 border rounded flex flex-col gap-1.5 transition-colors ${
                                                        item.is_recounted
                                                            ? 'bg-[#f8f9fa] border-[#d1d5db]'
                                                            : 'bg-white border-[#d1d5db] shadow-2xs'
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div>
                                                            <span className="text-[12px] text-[#0067c0] font-normal block">
                                                                {item.item_code}
                                                            </span>
                                                            <p className="text-[11.5px] text-[#5c5c5c] font-normal line-clamp-2 mt-0.5 mb-0">
                                                                {item.description}
                                                            </p>
                                                        </div>
                                                        {item.is_recounted ? (
                                                            <span className="bg-[#ecfdf5] text-[#065f46] text-[10px] font-normal px-2 py-0.5 rounded border border-[#a7f3d0] shrink-0">
                                                                Recontado ({item.counted_qty_in_stage})
                                                            </span>
                                                        ) : (
                                                            <span className="bg-[#fffbeb] text-[#92400e] text-[10px] font-normal px-2 py-0.5 rounded border border-[#fde68a] shrink-0">
                                                                Pendiente
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex justify-between items-center pt-2 border-t border-[#e5e7eb] gap-2">
                                                        <div className="bg-[#f8f9fa] border border-[#d1d5db] px-2.5 py-0.5 rounded text-center shrink-0">
                                                            <span className="text-[9px] text-[#5c5c5c] block font-normal">UBICACIÓN</span>
                                                            <span className="font-mono text-[11.5px] font-normal text-[#1f1f1f] uppercase">{item.bin_location || '—'}</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => selectItemForRecount(item)}
                                                            className={`h-7 px-3 rounded text-[11.5px] font-normal transition-colors cursor-pointer ${
                                                                item.is_recounted
                                                                    ? 'bg-white text-[#1f1f1f] border border-[#d1d5db] hover:bg-[#f5f5f5]'
                                                                    : 'bg-[#0067c0] text-white hover:bg-[#005a9e]'
                                                            }`}
                                                        >
                                                            {item.is_recounted ? 'Editar' : 'Recontar'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>

                                {/* Vista Escritorio / Tablet (>= sm) */}
                                <div className="hidden sm:block bg-white shadow-xs rounded overflow-hidden border border-[#d1d5db]">
                                    <div className="overflow-x-auto max-h-[500px]">
                                        <table className="w-full text-[12px] border-collapse min-w-[600px]">
                                            <thead className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal sticky top-0 z-10 border-b border-[#2a3c4e]">
                                                <tr>
                                                    <th className="px-3 py-1.5 text-left font-normal">ITEM CODE</th>
                                                    <th className="px-3 py-1.5 text-left font-normal">DESCRIPCIÓN</th>
                                                    <th className="px-3 py-1.5 text-center font-normal">UBICACIÓN SISTEMA</th>
                                                    <th className="px-3 py-1.5 text-center font-normal">ESTADO</th>
                                                    <th className="px-3 py-1.5 text-center font-normal">ACCIÓN</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#e5e7eb]">
                                                {(!recountData?.items || recountData.items.length === 0) ? (
                                                    <tr>
                                                        <td colSpan="5" className="text-center py-6 text-[#8c8c8c] text-[12px] italic font-normal">
                                                            No hay ítems registrados en la lista de reconteo para esta fase.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    recountData.items
                                                        .filter(item => {
                                                            const matchQuery =
                                                                item.item_code.toLowerCase().includes(recountSearchQuery.toLowerCase()) ||
                                                                (item.description && item.description.toLowerCase().includes(recountSearchQuery.toLowerCase())) ||
                                                                (item.bin_location && item.bin_location.toLowerCase().includes(recountSearchQuery.toLowerCase()));

                                                            if (!matchQuery) return false;
                                                            if (recountFilter === 'pending') return !item.is_recounted;
                                                            return true;
                                                        })
                                                        .map((item, idx) => (
                                                            <tr
                                                                key={item.item_code || `main-recount-${idx}`}
                                                                className={`hover:bg-[#edf3f9] transition-colors leading-none h-7 ${idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}
                                                            >
                                                                <td className="px-3 py-1 whitespace-nowrap text-[11.5px] text-[#0067c0] font-normal">
                                                                    {item.item_code}
                                                                </td>
                                                                <td className="px-3 py-1 text-[11.5px] text-[#5c5c5c] font-normal truncate max-w-md" title={item.description}>
                                                                    {item.description}
                                                                </td>
                                                                <td className="px-3 py-1 text-center whitespace-nowrap">
                                                                    <span className="font-mono text-[11.5px] text-[#1f1f1f]">
                                                                        {item.bin_location || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-1 text-center whitespace-nowrap">
                                                                    {item.is_recounted ? (
                                                                        <span className="bg-[#ecfdf5] text-[#065f46] text-[10px] font-normal px-2 py-0.5 rounded border border-[#a7f3d0]">
                                                                            Recontado ({item.counted_qty_in_stage})
                                                                        </span>
                                                                    ) : (
                                                                        <span className="bg-[#fffbeb] text-[#92400e] text-[10px] font-normal px-2 py-0.5 rounded border border-[#fde68a]">
                                                                            Pendiente
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-1 text-center whitespace-nowrap">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => selectItemForRecount(item)}
                                                                        className={`h-6 px-2.5 rounded text-[11px] font-normal transition-colors cursor-pointer ${
                                                                            item.is_recounted
                                                                                ? 'bg-white text-[#1f1f1f] hover:bg-[#f5f5f5] border border-[#d1d5db]'
                                                                                : 'bg-[#0067c0] hover:bg-[#005a9e] text-white'
                                                                        }`}
                                                                    >
                                                                        {item.is_recounted ? 'Editar' : 'Recontar'}
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar Info */}
                <div className="space-y-3">
                    {/* Indicador de Avance de Reconteo por Usuario y Zona Asignada */}
                    {selectedPhase >= 2 && recountData && (
                        <div className="bg-white rounded shadow-sm border border-[#d1d5db] p-3 text-[#1f1f1f]">
                            <div className="flex justify-between items-center mb-1.5">
                                <div>
                                    <h3 className="text-[11.5px] font-normal text-[#1f1f1f] m-0">
                                        Avance de Reconteo por Zona
                                    </h3>
                                    <p className="text-[11px] text-[#5c5c5c] font-normal mt-0.5 mb-0">
                                        Auditor: <span className="text-[#1f1f1f] font-normal">{activeSession?.user_username || activeSession?.username || 'Auditor'}</span>
                                    </p>
                                </div>
                                <span className="text-[11px] font-normal px-2 py-0.5 bg-[#f0f7ff] text-[#0067c0] border border-[#bae0ff] rounded">
                                    {(recountData.total || 0) > 0 ? Math.round(((recountData.recounted_count || 0) / recountData.total) * 100) : 0}%
                                </span>
                            </div>

                            {/* Barra de Progreso Visual */}
                            <div className="w-full bg-[#f3f4f6] h-2 rounded-full overflow-hidden border border-[#e5e7eb] mb-2">
                                <div
                                    className="bg-[#0067c0] h-full rounded-full transition-all duration-300"
                                    style={{ width: `${(recountData.total || 0) > 0 ? Math.round(((recountData.recounted_count || 0) / recountData.total) * 100) : 0}%` }}
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] pt-1.5 border-t border-[#e5e7eb]">
                                <div className="bg-[#f8f9fa] p-1.5 rounded border border-[#e5e7eb]">
                                    <span className="text-[#5c5c5c] font-normal block text-[10px]">Recontados</span>
                                    <span className="text-[#065f46] text-[12px] font-normal">{recountData.recounted_count || 0}</span>
                                </div>
                                <div className="bg-[#f8f9fa] p-1.5 rounded border border-[#e5e7eb]">
                                    <span className="text-[#5c5c5c] font-normal block text-[10px]">Pendientes</span>
                                    <span className="text-[#92400e] text-[12px] font-normal">{recountData.pending_count || 0}</span>
                                </div>
                                <div className="bg-[#f8f9fa] p-1.5 rounded border border-[#e5e7eb]">
                                    <span className="text-[#5c5c5c] font-normal block text-[10px]">Total Zona</span>
                                    <span className="text-[#1f1f1f] text-[12px] font-normal">{recountData.total || 0}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Counts in Current Location */}
                    <div className="bg-white rounded shadow-sm border border-[#d1d5db] p-3 text-[#1f1f1f]">
                        <div className="flex justify-between items-center mb-2 pb-1 border-b border-[#e5e7eb]">
                            <h3 className="text-[11px] font-normal text-[#1f1f1f] m-0">
                                Ítems en <span className="font-normal text-[#0067c0]">{countedLocation || '...'}</span>
                            </h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f3f4f6] text-[#1f1f1f] font-normal border border-[#d1d5db]">
                                {locationCounts.length}
                            </span>
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-[#e5e7eb]">
                            {locationCounts.length === 0 ? (
                                <p className="text-[11px] text-[#8c8c8c] text-center py-4 italic font-normal m-0">
                                    Sin registros en esta ubicación
                                </p>
                            ) : (
                                locationCounts.map((c, idx) => (
                                    <div
                                        key={c.id || `loc-count-${c.item_code}-${idx}`}
                                        className={`flex justify-between items-center text-[11.5px] py-1 px-1 hover:bg-[#edf3f9] rounded transition-colors ${
                                            c.is_pending ? 'border-l-2 border-amber-400 pl-1.5' : ''
                                        }`}
                                    >
                                        <span className="font-normal text-[#1f1f1f]">{c.item_code}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="font-normal text-[#0067c0]">{c.counted_qty}</span>
                                            <button
                                                onClick={() => deleteCount(c.id)}
                                                title="Eliminar registro"
                                                className="text-[#8c8c8c] hover:text-[#991b1b] font-normal px-1 text-[11px] transition-colors cursor-pointer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Session Locations History */}
                    <div className="bg-white rounded shadow-sm border border-[#d1d5db] p-3 text-[#1f1f1f]">
                        <div className="flex justify-between items-center mb-2 pb-1 border-b border-[#e5e7eb]">
                            <h3 className="text-[11px] font-normal text-[#1f1f1f] m-0">
                                Historial de Ubicaciones
                            </h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f3f4f6] text-[#1f1f1f] font-normal border border-[#d1d5db]">
                                {sessionLocations.length}
                            </span>
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-[#e5e7eb] mb-3">
                            {sessionLocations.length === 0 ? (
                                <p className="text-[11px] text-[#8c8c8c] text-center py-4 italic font-normal m-0">
                                    No hay ubicaciones registradas
                                </p>
                            ) : (
                                sessionLocations.map((l, idx) => (
                                    <div
                                        key={l.id || l.location_code || `sess-loc-${idx}`}
                                        className="flex justify-between items-center text-[11.5px] py-1 px-1 hover:bg-[#edf3f9] rounded"
                                    >
                                        <span className="font-mono text-[#1f1f1f]">{l.location_code}</span>
                                        <span
                                            className={`text-[10px] font-normal px-1.5 py-0.5 rounded border ${
                                                l.status === 'open'
                                                    ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]'
                                                    : 'bg-[#f3f4f6] text-[#1f1f1f] border-[#d1d5db]'
                                            }`}
                                        >
                                            {l.status === 'open' ? 'En proceso' : 'Cerrada'}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                        {countedLocation && (
                            <button
                                onClick={closeLocation}
                                disabled={!isOnline}
                                className={`w-full h-7 text-[11.5px] font-normal rounded border transition-colors shadow-xs cursor-pointer ${
                                    isOnline
                                        ? 'bg-white hover:bg-[#fef2f2] text-[#991b1b] border-[#fecaca]'
                                        : 'bg-[#f3f4f6] text-[#8c8c8c] border-[#d1d5db] cursor-not-allowed'
                                }`}
                            >
                                {isOnline ? `Cerrar Ubicación ${countedLocation}` : '(Cerrar requiere red)'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Scanner Modal */}
            {scannerOpen && (
                <ScannerModal
                    title={`Escanear ${scanTarget === 'location' ? 'Ubicación' : 'Código de Ítem'}`}
                    onScan={handleScan}
                    onClose={() => setScannerOpen(false)}
                />
            )}

            {/* Recount List Modal */}
            {showRecountModal && recountData && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-xl rounded shadow-xl overflow-hidden flex flex-col max-h-[85vh] border border-[#d1d5db] text-[#1f1f1f]">
                        {/* Modal Header */}
                        <div className="bg-[#354a5f] text-white px-4 py-2.5 flex justify-between items-center">
                            <div>
                                <h3 className="font-normal text-[13px] m-0 text-white">
                                    Ítems a Recontar — Etapa {recountData.stage} (R{recountData.stage - 1})
                                </h3>
                                <p className="text-[11px] text-[#d1d5db] font-normal m-0">
                                    {recountData.recounted_count} de {recountData.total} recontados ({recountData.pending_count} pendientes)
                                </p>
                            </div>
                            <button
                                onClick={() => setShowRecountModal(false)}
                                className="text-white hover:text-[#d1d5db] text-sm font-normal cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal Filter Tabs */}
                        <div className="flex border-b border-[#d1d5db] bg-[#f8f9fa] px-3 pt-2 gap-2 text-[12px]">
                            <button
                                onClick={() => setRecountFilter('pending')}
                                className={`px-3 py-1.5 border-b-2 font-normal text-[11.5px] transition-colors cursor-pointer ${
                                    recountFilter === 'pending'
                                        ? 'border-[#0067c0] text-[#0067c0] bg-white rounded-t'
                                        : 'border-transparent text-[#5c5c5c] hover:text-[#1f1f1f]'
                                }`}
                            >
                                Pendientes ({recountData.pending_count})
                            </button>
                            <button
                                onClick={() => setRecountFilter('all')}
                                className={`px-3 py-1.5 border-b-2 font-normal text-[11.5px] transition-colors cursor-pointer ${
                                    recountFilter === 'all'
                                        ? 'border-[#0067c0] text-[#0067c0] bg-white rounded-t'
                                        : 'border-transparent text-[#5c5c5c] hover:text-[#1f1f1f]'
                                }`}
                            >
                                Todos ({recountData.total})
                            </button>
                        </div>

                        {/* Items List */}
                        <div className="p-3 overflow-y-auto space-y-2 flex-grow">
                            {recountData.items
                                .filter(item => recountFilter === 'all' || !item.is_recounted)
                                .map((item, idx) => (
                                    <div
                                        key={item.item_code || `recount-item-${idx}`}
                                        className={`p-2.5 border rounded flex justify-between items-center transition-colors ${
                                            item.is_recounted
                                                ? 'bg-[#f8f9fa] border-[#d1d5db] opacity-80'
                                                : 'bg-white border-[#d1d5db] hover:border-[#0067c0] shadow-2xs'
                                        }`}
                                    >
                                        <div className="flex-1 pr-3">
                                            <div className="flex items-center gap-2">
                                                <span className="font-normal text-[12px] text-[#0067c0]">
                                                    {item.item_code}
                                                </span>
                                                {item.is_recounted ? (
                                                    <span className="bg-[#ecfdf5] text-[#065f46] text-[10px] font-normal px-2 py-0.5 rounded border border-[#a7f3d0]">
                                                        Recontado ({item.counted_qty_in_stage})
                                                    </span>
                                                ) : (
                                                    <span className="bg-[#fffbeb] text-[#92400e] text-[10px] font-normal px-2 py-0.5 rounded border border-[#fde68a]">
                                                        Pendiente
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11.5px] text-[#5c5c5c] font-normal line-clamp-1 mt-0.5 mb-0">
                                                {item.description}
                                            </p>
                                            <p className="text-[11px] text-[#5c5c5c] font-mono mt-0.5 mb-0 font-normal">
                                                Ubic. Sistema: <span className="font-normal text-[#1f1f1f]">{item.bin_location}</span>
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => selectItemForRecount(item)}
                                            className={`h-7 px-3 rounded text-[11.5px] font-normal transition-colors cursor-pointer ${
                                                item.is_recounted
                                                    ? 'bg-white text-[#1f1f1f] border border-[#d1d5db] hover:bg-[#f5f5f5]'
                                                    : 'bg-[#0067c0] hover:bg-[#005a9e] text-white'
                                            }`}
                                        >
                                            {item.is_recounted ? 'Editar' : 'Recontar'}
                                        </button>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Limpio de Captura de Reconteo */}
            {recountItemModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white max-w-md w-full rounded shadow-xl border border-[#d1d5db] overflow-hidden text-[#1f1f1f]">
                        <div className="bg-[#354a5f] px-4 py-2.5 text-white flex justify-between items-center">
                            <div>
                                <h3 className="text-[13px] font-normal m-0 text-white">
                                    Capturar Reconteo — {recountItemModal.item_code}
                                </h3>
                                <p className="text-[11px] text-[#d1d5db] font-normal truncate max-w-[280px] m-0">
                                    {recountItemModal.description}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRecountItemModal(null)}
                                className="text-white hover:text-[#d1d5db] text-sm font-normal cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveRecountItem} className="p-4 space-y-3">
                            <div>
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                    Ubicación Sistema / Referencia
                                </label>
                                <div className="h-7 px-2 bg-[#f8f9fa] border border-[#d1d5db] rounded text-[12px] font-mono text-[#1f1f1f] flex items-center">
                                    {recountItemModal.bin_location}
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                    Ubicación Física Real <span className="text-[#991b1b]">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={recountItemModal.counted_location}
                                    onChange={e => setRecountItemModal({ ...recountItemModal, counted_location: e.target.value.toUpperCase() })}
                                    className="w-full h-7 border border-[#d1d5db] rounded px-2 text-[12px] font-normal text-[#1f1f1f] uppercase bg-white focus:outline-none focus:border-[#0067c0]"
                                    placeholder="Scan o digite ubicación..."
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-normal text-[#5c5c5c] mb-1">
                                    Cantidad Observada / Recontada <span className="text-[#991b1b]">*</span>
                                </label>
                                <div className="flex items-center">
                                    <button
                                        type="button"
                                        onClick={() => setRecountItemModal(prev => ({
                                            ...prev,
                                            counted_qty: String(Math.max(0, (parseInt(prev.counted_qty) || 0) - 1))
                                        }))}
                                        className="h-7 w-7 border border-[#d1d5db] bg-[#f8f9fa] hover:bg-[#f0f0f0] text-[#1f1f1f] font-normal text-sm rounded-l flex items-center justify-center cursor-pointer select-none p-0"
                                    >
                                        -
                                    </button>
                                    <input
                                        type="number"
                                        value={recountItemModal.counted_qty}
                                        onChange={e => setRecountItemModal({ ...recountItemModal, counted_qty: e.target.value })}
                                        className="h-7 flex-grow border-y border-[#d1d5db] text-center text-[12px] font-normal text-[#1f1f1f] bg-white focus:outline-none focus:border-[#0067c0] px-1"
                                        min="0"
                                        autoFocus
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setRecountItemModal(prev => ({
                                            ...prev,
                                            counted_qty: String((parseInt(prev.counted_qty) || 0) + 1)
                                        }))}
                                        className="h-7 w-7 border border-[#d1d5db] bg-[#f8f9fa] hover:bg-[#f0f0f0] text-[#1f1f1f] font-normal text-sm rounded-r flex items-center justify-center cursor-pointer select-none p-0"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                                <button
                                    type="button"
                                    onClick={() => setRecountItemModal(null)}
                                    className="h-7 px-3 border border-[#d1d5db] bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="h-7 px-4 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded shadow-xs transition-colors cursor-pointer"
                                >
                                    Guardar Reconteo
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CycleCounts;
