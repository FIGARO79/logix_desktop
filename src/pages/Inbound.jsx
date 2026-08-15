import { useState, useEffect, useRef, useMemo } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import QRCode from 'qrcode';
import ScannerModal from '../components/ScannerModal';
import { getDB, savePendingSync, cacheData, getCachedData, getGRNExpectedQty, getGRNExpectedQtyBulk } from '../utils/offlineDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { syncPendingInbound, checkAndSyncIfNeeded, downloadMasterData } from '../utils/syncManager';
import { useOffline } from '../hooks/useOffline';
import SandvikLabel from '../components/labels/SandvikLabel';
import { useReactToPrint } from 'react-to-print';
import '../styles/Label.css';
import { parseGS1Barcode } from '../utils/gs1Parser';


const EMPTY_ARRAY = [];
const DEFAULT_IR_STATS = {
    totalLines: 0,
    completedLines: 0,
    startedLines: 0,
    expectedUnits: 0,
    receivedUnits: 0,
    positiveDiffLines: 0,
    negativeDiffLines: 0,
    okLines: 0,
    totalGrns: 0,
    completedGrns: 0,
    grnProgressPercent: 0
};

const Dial = ({ percent, label, valueText, strokeColor = "#1679E0", strokeWidth = 8, trackStrokeWidth = 5 }) => {
    const radius = 35;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    
    return (
        <div className="flex flex-col items-center justify-center p-1.5 bg-zinc-50/50 rounded border border-zinc-100 shadow-sm flex-1 min-w-0">
            <div className="relative flex items-center justify-center" style={{ width: '85px', height: '85px' }}>
                <svg className="transform -rotate-90" style={{ width: '85px', height: '85px' }}>
                    <circle 
                        cx="42.5" 
                        cy="42.5" 
                        r={radius} 
                        className="text-zinc-200" 
                        strokeWidth={trackStrokeWidth} 
                        stroke="currentColor" 
                        fill="transparent" 
                    />
                    <circle 
                        cx="42.5" 
                        cy="42.5" 
                        r={radius} 
                        stroke={strokeColor} 
                        strokeWidth={strokeWidth} 
                        strokeDasharray={circumference} 
                        strokeDashoffset={offset} 
                        strokeLinecap="round" 
                        fill="transparent" 
                        className="transition-all duration-500 ease-out"
                    />
                </svg>
                <div className="absolute text-center flex flex-col items-center justify-center">
                    <span className="text-[13px] font-extrabold text-black leading-none">{valueText}</span>
                    <span className="text-[10px] text-zinc-700 font-extrabold leading-none mt-0.5">{percent}%</span>
                </div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-900 font-bold mt-1.5 text-center leading-none truncate w-full">{label}</span>
        </div>
    );
};


const Inbound = () => {
    const { setTitle } = useOutletContext();
    const { pendingCount, syncPendingData } = useOffline();
    const queryClient = useQueryClient();

    useEffect(() => { setTitle("Recepción"); }, [setTitle]);



    // --- Estados del Formulario ---
    const [importRef, setImportRef] = useState('');
    const [waybill, setWaybill] = useState('');
    const [itemCode, setItemCode] = useState('');
    const [quantity, setQuantity] = useState('');
    const [relocatedBin, setRelocatedBin] = useState('');

    // --- Estados de Datos ---
    const [itemData, setItemData] = useState(null);
    const [versions, setVersions] = useState([]);
    const [currentVersion, setCurrentVersion] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [validBins, setValidBins] = useState(new Set());

    // --- Estados de UI ---
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [hasWarnedOffline, setHasWarnedOffline] = useState(false);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [qrImage, setQrImage] = useState(null);
    const [editId, setEditId] = useState(null);

    // --- Estado para el Tablero de Control de la IR ---
    const [irStats, setIrStats] = useState(DEFAULT_IR_STATS);

    const { data: logs = EMPTY_ARRAY, refetch: loadLogs } = useQuery({
        queryKey: ['inbound_logs', currentVersion],
        queryFn: async () => {
            let apiLogs = [];
            const version = currentVersion;
            try {
                const url = version
                    ? `/api/get_logs?version_date=${version}`
                    : `/api/get_logs`;
                const res = await fetch(url, { credentials: 'include' });
                if (res.ok) {
                    apiLogs = await res.json();
                    if (!version || version === '') {
                        await cacheData('inbound_logs', apiLogs);
                    }
                } else {
                    console.error("Failed to load logs:", res.status, res.statusText);
                    if (res.status === 401) window.location.href = '/login';
                }
            } catch (e) {
                console.error("Error loading logs from API", e);
                if (!version || version === '') {
                    apiLogs = await getCachedData('inbound_logs') || [];
                    console.log("Cargado desde caché local:", apiLogs.length, "registros");
                }
            }

            let pendingLogs = [];
            if (!version || version === '') {
                try {
                    const db = await getDB();
                    const pending = await db.getAll('pending_sync');
                    pendingLogs = pending.map(p => ({
                        ...p.payload,
                        id: p.id,
                        timestamp: p.timestamp,
                        username: 'LOCAL (Sync)',
                        isPending: true,
                        itemDescription: p.payload.itemDescription || 'Cargando...'
                    }));
                } catch (e) { console.error("Error loading pending logs", e); }
            }

            const logMap = new Map();
            pendingLogs.forEach(log => {
                const key = log.id;
                logMap.set(key, log);
            });
            apiLogs.forEach(log => {
                const key = log.client_id || `server_${log.id}`;
                logMap.set(key, log);
            });

            const allLogsSorted = Array.from(logMap.values()).sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime();
                const timeB = new Date(b.timestamp).getTime();
                if (timeB !== timeA) return timeB - timeA;
                return (b.id || 0) - (a.id || 0);
            });

            let grnMap = {};
            try {
                const db = await getDB();
                const uniqueQueryKeys = new Set();
                const itemsToQuery = [];
                allLogsSorted.forEach(log => {
                    const code = log.itemCode;
                    const ir = log.importReference || log.importRef || '';
                    const key = `${code}|${ir}`;
                    if (code && ir && !uniqueQueryKeys.has(key)) {
                        uniqueQueryKeys.add(key);
                        itemsToQuery.push({ itemCode: code, importRef: ir });
                    }
                });
                grnMap = await getGRNExpectedQtyBulk(db, itemsToQuery);
            } catch (e) { console.error("Error loading GRN info", e); }

            const totalsMap = {};
            const latestEntryMap = {};

            allLogsSorted.forEach(log => {
                const code = log.itemCode;
                const ir = log.importReference || log.importRef || '';
                const key = `${code}|${ir}`;
                const qty = parseInt(log.qtyReceived) || parseInt(log.quantity) || 0;
                totalsMap[key] = (totalsMap[key] || 0) + qty;

                if (!latestEntryMap[key]) {
                    latestEntryMap[key] = log.id;
                }
            });

            return allLogsSorted.map(log => {
                const code = log.itemCode;
                const ir = log.importReference || log.importRef || '';
                const key = `${code}|${ir}`;
                const expected = log.qtyGrn || grnMap[key] || 0;
                const totalReceived = totalsMap[key] || 0;
                const isLatest = latestEntryMap[key] === log.id;

                return {
                    ...log,
                    expected_qty: expected,
                    difference: isLatest ? (totalReceived - expected) : 0
                };
            });
        },
        refetchInterval: () => currentVersion ? false : 15000,
        refetchOnWindowFocus: false
    });
    const normalizeDate = (dateString) => {
        if (!dateString) return null;
        let normalized = dateString.trim().replace(' ', 'T');

        if (normalized.length === 10 && normalized.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return `${normalized}T00:00:00`;
        }

        const hasTimeZone = normalized.includes('Z') ||
            normalized.match(/[+-]\d{2}:\d{2}$/) ||
            (normalized.includes('-') && normalized.split('T')[1]?.includes('-'));
        if (!hasTimeZone) normalized = `${normalized}Z`;
        return normalized;
    };

    const formatDate = (dateString, showTime = true) => {
        const normalized = normalizeDate(dateString);
        if (!normalized) return '-';
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return 'Fecha Inválida';

        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        };

        if (showTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
            options.hour12 = false;
        }

        return date.toLocaleString('es-CO', options);
    };

    // --- Refs ---
    const quantityRef = useRef(null);
    const itemCodeRef = useRef(null);
    const labelComponentRef = useRef(null);
    const relocatedBinRef = useRef(null);

    // --- Helpers de Sincronización ---
    const runAutoSync = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        const didSync = await checkAndSyncIfNeeded();
        setIsSyncing(false);
        if (didSync) {
            console.log("Logix: Sincronización automática detectó cambios. Refrescando datos...");
            // Recargar logs para actualizar la tabla de diferencias
            loadLogs();
            // Si ya hay un item cargado, refrescar su información (cantidades esperadas)
            if (itemData && itemCode) {
                findItem();
            }
        }
    };

    useEffect(() => {
        loadVersions();
        loadSlottingBins();

        // Check inicial
        runAutoSync();
        syncPendingInbound().then(() => queryClient.invalidateQueries({ queryKey: ['inbound_logs'] }));

        // Intervalo de revisión cada 10 minutos
        const syncInterval = setInterval(() => {
            runAutoSync();
        }, 600000);

        const handleFocus = () => runAutoSync();
        window.addEventListener('focus', handleFocus);

        return () => {
            clearInterval(syncInterval);
            window.removeEventListener('focus', handleFocus);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadSlottingBins = async () => {
        let binsLoaded = false;

        // 1. Intentar cargar en tiempo real desde la API del backend (más actualizado, consulta DB física directamente)
        if (navigator.onLine) {
            try {
                const res = await fetch('/api/views/valid_bins', { credentials: 'include' });
                if (res.ok) {
                    const binsList = await res.json();
                    if (Array.isArray(binsList) && binsList.length > 0) {
                        const binsSet = new Set(binsList.map(b => b.toUpperCase()));
                        setValidBins(binsSet);
                        // Guardar en la caché IndexedDB para soporte offline futuro
                        await cacheData('slotting_valid_bins', binsList);
                        binsLoaded = true;
                        console.log(`Logix: Cargadas ${binsSet.size} ubicaciones válidas de slotting desde API.`);
                    }
                }
            } catch (e) {
                console.warn("No se pudo cargar bins desde la API, intentando fallback estático...", e);
            }
        }

        // 2. Fallback 1: Cargar desde el archivo estático JSON (con prevención de caché)
        if (!binsLoaded && navigator.onLine) {
            try {
                const res = await fetch(`/static/json/slotting_parameters.json?t=${Date.now()}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.storage) {
                        const binsList = Object.keys(data.storage);
                        const binsSet = new Set(binsList.map(b => b.toUpperCase()));
                        setValidBins(binsSet);
                        await cacheData('slotting_valid_bins', binsList);
                        binsLoaded = true;
                        console.log(`Logix: Cargadas ${binsSet.size} ubicaciones válidas de slotting desde JSON.`);
                    }
                }
            } catch (e) {
                console.error("Error en fallback de JSON estático:", e);
            }
        }

        // 3. Fallback 2 (Offline / Desconectado): Cargar desde IndexedDB
        if (!binsLoaded) {
            try {
                const cachedBinsList = await getCachedData('slotting_valid_bins');
                if (cachedBinsList && Array.isArray(cachedBinsList) && cachedBinsList.length > 0) {
                    const binsSet = new Set(cachedBinsList.map(b => b.toUpperCase()));
                    setValidBins(binsSet);
                    console.log(`Logix Offline: Cargadas ${binsSet.size} ubicaciones válidas de slotting desde caché local.`);
                } else {
                    console.warn("Logix: Sin ubicaciones válidas de slotting en caché local.");
                }
            } catch (e) {
                console.error("Error al cargar bins de slotting desde IndexedDB:", e);
            }
        }
    };

    const calculateIRStats = async () => {
        if (!importRef || importRef.trim() === '') {
            setIrStats(prev => {
                if (
                    prev.totalLines === 0 &&
                    prev.completedLines === 0 &&
                    prev.startedLines === 0 &&
                    prev.expectedUnits === 0 &&
                    prev.receivedUnits === 0 &&
                    prev.positiveDiffLines === 0 &&
                    prev.negativeDiffLines === 0 &&
                    prev.okLines === 0 &&
                    prev.totalGrns === 0 &&
                    prev.completedGrns === 0 &&
                    prev.grnProgressPercent === 0
                ) {
                    return prev;
                }
                return DEFAULT_IR_STATS;
            });
            return;
        }

        try {
            const db = await getDB();
            const allGrns = await db.getAll('grn_pending') || [];
            const targetIr = importRef.trim().toUpperCase();
            
            // 1. Obtener GRNs asociadas a la IR desde po_lookup
            const poInfo = await db.get('po_lookup', `ir_${targetIr}`);
            const associatedGrns = new Set();
            if (poInfo && poInfo.items) {
                poInfo.items.forEach(it => {
                    const grnVal = it.grn ? String(it.grn).toUpperCase().trim() : '';
                    if (grnVal) {
                        grnVal.split(',').forEach(g => {
                            const gKey = g.trim();
                            if (gKey) {
                                associatedGrns.add(gKey);
                            }
                        });
                    }
                });
            }

            // 2. Filtrar líneas de la GRN para esta IR (por GRN_Number si hay asociadas, sino fallback a Import_Reference)
            let irLines = [];
            allGrns.forEach(g => {
                if (g.grns) {
                    // Si el nuevo formato estructurado de grns está presente:
                    let itemExpectedForIr = 0;
                    Object.entries(g.grns).forEach(([grnNum, qty]) => {
                        if (associatedGrns.has(grnNum.toUpperCase().trim())) {
                            itemExpectedForIr += parseInt(qty) || 0;
                        }
                    });
                    if (itemExpectedForIr > 0) {
                        irLines.push({
                            Item_Code: g.Item_Code,
                            total_expected: itemExpectedForIr
                        });
                    }
                } else {
                    // Fallback para formato antiguo / registros planos
                    const grnNum = (g.GRN_Number || '').trim().toUpperCase();
                    if (associatedGrns.size > 0) {
                        if (grnNum && associatedGrns.has(grnNum)) {
                            irLines.push(g);
                        } else if (!grnNum && String(g.Import_Reference || '').toUpperCase().trim() === targetIr) {
                            irLines.push(g);
                        }
                    } else if (String(g.Import_Reference || '').toUpperCase().trim() === targetIr) {
                        irLines.push(g);
                    }
                }
            });
            
            // 3. Agrupar irLines por Item_Code (SKU) para evitar duplicaciones
            const groupedIrLines = {};
            irLines.forEach(line => {
                const code = String(line.Item_Code).toUpperCase().trim();
                if (!groupedIrLines[code]) {
                    groupedIrLines[code] = {
                        Item_Code: code,
                        total_expected: 0
                    };
                }
                groupedIrLines[code].total_expected += parseInt(line.total_expected) || 0;
            });

            // Si no hay líneas de la GRN (280) para calcular en el tablero, ir a la PO Purchase (poInfo)
            if (irLines.length === 0 && poInfo && poInfo.items) {
                poInfo.items.forEach(it => {
                    const code = String(it.item_code || it.Item_Code || '').toUpperCase().trim();
                    if (code) {
                        if (!groupedIrLines[code]) {
                            groupedIrLines[code] = {
                                Item_Code: code,
                                total_expected: 0
                            };
                        }
                        groupedIrLines[code].total_expected += parseInt(it.qty || it.Quantity || 0);
                    }
                });
            }

            const uniqueIrLines = Object.values(groupedIrLines);
            let totalLines = uniqueIrLines.length;
            let expectedUnits = 0;
            let receivedUnits = 0;
            let completedLines = 0;
            let startedLines = 0;
            let positiveDiffLines = 0;
            let negativeDiffLines = 0;
            let okLines = 0;

            // Crear mapa de cantidades esperadas para cada SKU para el cálculo de GRNs
            const grnExpectedMap = {};
            uniqueIrLines.forEach(line => {
                grnExpectedMap[line.Item_Code] = line.total_expected;
            });

            // Crear mapa de cantidades recibidas para cada ítem en esta IR
            const receivedMap = {};
            logs.forEach(log => {
                const logIr = (log.importReference || log.importRef || '').trim().toUpperCase();
                if (logIr === targetIr) {
                    const code = String(log.itemCode).toUpperCase().trim();
                    const qty = parseInt(log.qtyReceived) || parseInt(log.quantity) || 0;
                    receivedMap[code] = (receivedMap[code] || 0) + qty;
                }
            });

            // Hacer la unión de los SKUs esperados y los SKUs recibidos en logs
            const allSkusSet = new Set([
                ...uniqueIrLines.map(l => l.Item_Code),
                ...Object.keys(receivedMap)
            ]);

            allSkusSet.forEach(code => {
                const line = groupedIrLines[code];
                const expected = line ? line.total_expected : 0;
                const received = receivedMap[code] || 0;

                expectedUnits += expected;
                receivedUnits += received;

                if (received > 0) {
                    startedLines += 1;
                }

                const diff = received - expected;
                if (diff > 0) {
                    positiveDiffLines += 1;
                } else if (diff < 0) {
                    negativeDiffLines += 1;
                } else {
                    okLines += 1;
                }

                if (received >= expected && expected > 0) {
                    completedLines += 1;
                }
            });

            // Crear mapa de cantidades esperadas por SKU y por GRN individual a partir de allGrns (280)
            const grnDetailExpectedMap = {};
            allGrns.forEach(g => {
                const code = String(g.Item_Code).toUpperCase().trim();
                if (code) {
                    if (!grnDetailExpectedMap[code]) {
                        grnDetailExpectedMap[code] = {};
                    }
                    if (g.grns) {
                        Object.entries(g.grns).forEach(([grnNum, qty]) => {
                            grnDetailExpectedMap[code][grnNum.toUpperCase().trim()] = parseInt(qty) || 0;
                        });
                    }
                }
            });

            // Calcular avance de GRNs asociadas
            let totalGrns = 0;
            let completedGrns = 0;
            let grnTotalProgress = 0;
            
            try {
                if (poInfo && poInfo.items) {
                    const grnToItems = {}; // grn -> [ {itemCode, expected} ]
                    
                    poInfo.items.forEach(it => {
                        const itemCode = String(it.item_code).toUpperCase().trim();
                        const grnVal = it.grn ? String(it.grn).toUpperCase().trim() : '';
                        const qty = parseInt(it.qty) || 0;
                        
                        if (grnVal) {
                            grnVal.split(',').forEach(g => {
                                const gKey = g.trim();
                                if (gKey) {
                                    const gKeyUpper = gKey.toUpperCase().trim();
                                    
                                    // Determinar la cantidad esperada de forma inteligente
                                    let expectedQty = 0;
                                    const has280Data = uniqueIrLines.length > 0;
                                    
                                    if (grnDetailExpectedMap[itemCode] !== undefined && 
                                        grnDetailExpectedMap[itemCode][gKeyUpper] !== undefined) {
                                        expectedQty = grnDetailExpectedMap[itemCode][gKeyUpper];
                                    } else if (!has280Data) {
                                        expectedQty = qty;
                                    }
                                    
                                    // Solo incluir en el avance si realmente se espera recibir unidades en esa GRN
                                    if (expectedQty > 0) {
                                        if (!grnToItems[gKeyUpper]) {
                                            grnToItems[gKeyUpper] = [];
                                        }
                                        grnToItems[gKeyUpper].push({ itemCode, expected: expectedQty });
                                    }
                                }
                            });
                        }
                    });
                    
                    const grnList = Object.keys(grnToItems);
                    totalGrns = grnList.length;
                    
                    grnList.forEach(grn => {
                        const itemsInGrn = grnToItems[grn];
                        let itemsCompleted = 0;
                        
                        itemsInGrn.forEach(it => {
                            const recQty = receivedMap[it.itemCode] || 0;
                            if (recQty >= it.expected) {
                                itemsCompleted += 1;
                            }
                        });
                        
                        const grnProgress = itemsInGrn.length > 0 ? itemsCompleted / itemsInGrn.length : 0;
                        grnTotalProgress += grnProgress;
                        
                        if (grnProgress === 1 && itemsInGrn.length > 0) {
                            completedGrns += 1;
                        }
                    });
                }
            } catch (poErr) {
                console.error("Error calculating GRN stats from po_lookup:", poErr);
            }

            const grnProgressPercent = totalGrns > 0 ? Math.min(100, Math.round((grnTotalProgress / totalGrns) * 100)) : 0;

            setIrStats(prev => {
                if (
                    prev.totalLines === totalLines &&
                    prev.completedLines === completedLines &&
                    prev.startedLines === startedLines &&
                    prev.expectedUnits === expectedUnits &&
                    prev.receivedUnits === receivedUnits &&
                    prev.positiveDiffLines === positiveDiffLines &&
                    prev.negativeDiffLines === negativeDiffLines &&
                    prev.okLines === okLines &&
                    prev.totalGrns === totalGrns &&
                    prev.completedGrns === completedGrns &&
                    prev.grnProgressPercent === grnProgressPercent
                ) {
                    return prev;
                }
                return {
                    totalLines,
                    completedLines,
                    startedLines,
                    expectedUnits,
                    receivedUnits,
                    positiveDiffLines,
                    negativeDiffLines,
                    okLines,
                    totalGrns,
                    completedGrns,
                    grnProgressPercent
                };
            });
        } catch (err) {
            console.error("Error calculating IR stats:", err);
        }
    };

    useEffect(() => {
        calculateIRStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [importRef, logs]);

    // Autoguardar la conciliación en segundo plano de manera silenciosa cada vez que cambien las estadísticas
    useEffect(() => {
        if (!importRef || importRef.trim() === '' || (irStats.totalLines === 0 && irStats.receivedUnits === 0)) return;

        const delayDebounceFn = setTimeout(async () => {
            try {
                await fetch('/api/inbound/ir_reconciliation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        import_reference: importRef,
                        total_lines: irStats.totalLines,
                        completed_lines: irStats.completedLines,
                        started_lines: irStats.startedLines,
                        expected_units: irStats.expectedUnits,
                        received_units: irStats.receivedUnits,
                        ok_lines: irStats.okLines,
                        negative_diff_lines: irStats.negativeDiffLines,
                        positive_diff_lines: irStats.positiveDiffLines,
                        total_grns: irStats.totalGrns,
                        completed_grns: irStats.completedGrns
                    }),
                    credentials: 'include'
                });
            } catch (e) {
                console.error("Error auto-saving IR reconciliation:", e);
            }
        }, 1000);

        return () => clearTimeout(delayDebounceFn);
    }, [irStats, importRef]);

    // Filter logs based on search term
    const filteredLogs = useMemo(() => logs.filter(log =>
        (log.itemCode && log.itemCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.waybill && log.waybill.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.importReference && log.importReference.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.itemDescription && log.itemDescription.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.username && log.username.toLowerCase().includes(searchTerm.toLowerCase()))
    ), [logs, searchTerm]);

    // Generar QR para la etiqueta cuando cambia el item o el código
    useEffect(() => {
        const activeCode = itemData?.itemCode || itemCode;
        if (activeCode) {
            QRCode.toDataURL(activeCode, { width: 256, margin: 0 })
                .then(url => setQrImage(url))
                .catch(err => console.error(err));
        } else {
            setQrImage(null);
        }
    }, [itemData, itemCode]);

    // --- Funciones API ---


    const loadVersions = async () => {
        try {
            const res = await fetch('/api/logs/versions', { credentials: 'include' });
            if (res.ok) setVersions(await res.json());
        } catch (e) { console.error(e); }
    };

    const handleLookupReference = async (type, value) => {
        if (!value) return;
        const normalizedValue = value.trim().toUpperCase();

        let onlineDataFound = false;
        if (navigator.onLine) {
            try {
                const params = type === 'waybill' ? `waybill=${encodeURIComponent(normalizedValue)}` : `import_ref=${encodeURIComponent(normalizedValue)}`;
                const res = await fetch(`/api/inbound/lookup_reference?${params}`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    if ((type === 'waybill' && data.import_ref) || (type === 'import_ref' && data.waybill)) {
                        if (data.waybill) setWaybill(data.waybill);
                        if (data.import_ref) setImportRef(data.import_ref);
                        onlineDataFound = true;
                        return;
                    }
                }
            } catch (e) { console.error("Error lookup", e); }
        }

        if (!onlineDataFound) {
            try {
                const db = await getDB();
                const id = type === 'waybill' ? `wb_${normalizedValue}` : `ir_${normalizedValue}`;
                const match = await db.get('po_lookup', id);
                if (match) {
                    if (type === 'waybill' && match.import_ref) setImportRef(match.import_ref);
                    else if (type === 'import_ref' && match.waybill) setWaybill(match.waybill);
                }
            } catch (e) { console.error("Offline lookup error", e); }
        }
    };

    const findItem = async (codeToSearch = null) => {
        const rawCode = (codeToSearch !== null && typeof codeToSearch === 'string') ? codeToSearch : itemCode;
        if (!rawCode || !importRef) {
            alert("Ingrese Import Reference e Item Code");
            return;
        }
        setLoading(true);

        let normalizedCode = rawCode.trim().toUpperCase();
        const gs1Result = parseGS1Barcode(normalizedCode);
        if (gs1Result.isGS1 && gs1Result.itemCode) {
            normalizedCode = gs1Result.itemCode.trim().toUpperCase();
        }
        setItemCode(normalizedCode);

        let onlineFound = false;
        if (navigator.onLine) {
            try {
                const res = await fetch(`/api/find_item/${encodeURIComponent(normalizedCode)}/${encodeURIComponent(importRef)}?_=${Date.now()}`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    setItemData(data);
                    if (!editId) {
                        setQuantity('');
                        // El binLocation ya viene actualizado del backend (effective_bin_location)
                        setRelocatedBin('');
                    }
                    quantityRef.current?.focus();
                    setLoading(false);
                    onlineFound = true;
                    return;
                }
            } catch (e) { console.error("Error finding item online", e); }
        }

        if (!onlineFound) {
            try {
                const db = await getDB();
                const localItem = await db.get('master_items', normalizedCode);
                if (localItem) {
                    const xdockInfo = await db.get('xdock_reservations', normalizedCode);

                    // Buscar si ya hay reubicaciones de este ítem en la cola local
                    const pendingLogs = await db.getAll('pending_sync');
                    const recentRelocation = pendingLogs
                        .filter(l => l.payload.itemCode === normalizedCode && l.payload.relocatedBin)
                        .pop();

                    // Calcular acumulado local
                    const itemLogs = logs.filter(l => l.itemCode === normalizedCode);
                    const localCumulative = itemLogs.reduce((acc, curr) => acc + (parseInt(curr.qtyReceived) || 0), 0);

                    let offlineSuggestedBin = null;
                    if (recentRelocation) {
                        offlineSuggestedBin = recentRelocation.payload.relocatedBin;
                    } else {
                        offlineSuggestedBin = localItem.Bin_1;
                    }

                    // Obtener desglose offline y po_lookup
                    const allPos = await db.getAll('po_lookup') || [];
                    const offlineBreakdown = [];
                    for (const po of allPos) {
                        if (po.type === 'ir' && po.items) {
                            let itemQty = 0;
                            const grns = new Set();
                            for (const it of po.items) {
                                if (String(it.item_code).toUpperCase() === normalizedCode) {
                                    itemQty += parseInt(it.qty) || 0;
                                    if (it.grn) {
                                        String(it.grn).split(',').forEach(g => {
                                            if (g.trim()) grns.add(g.trim().toUpperCase());
                                        });
                                    }
                                }
                            }
                            if (itemQty > 0) {
                                offlineBreakdown.push({
                                    ir: po.value,
                                    grn: Array.from(grns).join(',') || 'N/A',
                                    qty: itemQty
                                });
                            }
                        }
                    }

                    // Filtrar Xdock exclusivamente por PO_Number de la IR en offline
                    let totalRes = xdockInfo ? xdockInfo.total : 0;
                    let xdockCustomersList = xdockInfo ? xdockInfo.customers : [];
                    if (importRef && xdockInfo?.customers?.length > 0 && allPos.length > 0) {
                        const targetPos = new Set();
                        for (const po of allPos) {
                            if (po.type === 'ir' && String(po.value).toUpperCase() === importRef.toUpperCase() && po.items) {
                                for (const it of po.items) {
                                    if (String(it.item_code).toUpperCase() === normalizedCode && it.customer_ref) {
                                        targetPos.add(String(it.customer_ref).toUpperCase());
                                    }
                                }
                            }
                        }
                        if (targetPos.size > 0) {
                            const filteredCusts = xdockInfo.customers.filter(c => {
                                const po = typeof c === 'object' ? (c.po_number || '') : '';
                                return po && targetPos.has(String(po).toUpperCase());
                            });
                            if (filteredCusts.length > 0) {
                                const filteredTot = filteredCusts.reduce((acc, c) => acc + (typeof c === 'object' ? (Number(c.qty) || 0) : 0), 0);
                                totalRes = filteredTot;
                                let remDeduct = localCumulative;
                                const custsWithPending = [];
                                for (const c of filteredCusts) {
                                    if (typeof c === 'object') {
                                        const cQty = Number(c.qty) || 0;
                                        if (remDeduct >= cQty) {
                                            remDeduct -= cQty;
                                        } else {
                                            const pendingQty = cQty - remDeduct;
                                            remDeduct = 0;
                                            custsWithPending.push({ ...c, qty: pendingQty });
                                        }
                                    } else {
                                        custsWithPending.push(c);
                                    }
                                }
                                xdockCustomersList = custsWithPending;
                            } else {
                                totalRes = 0;
                                xdockCustomersList = [];
                            }
                        }
                    }

                    const xdockRemanente = Math.max(0, totalRes - localCumulative);

                    const expectedQty = await getGRNExpectedQty(db, normalizedCode, importRef);

                    const itemDataObj = {
                        itemCode: localItem.Item_Code,
                        description: localItem.Item_Description,
                        binLocation: localItem.Bin_1,
                        weight: localItem.Weight_per_Unit,
                        itemType: localItem.ABC_Code_stockroom,
                        sicCode: localItem.SIC_Code_stockroom,
                        defaultQtyGrn: expectedQty,
                        xdockTotal: totalRes,
                        xdockPending: xdockRemanente,
                        xdockCustomers: xdockCustomersList,
                        is_offline_result: true,
                        suggestedBin: offlineSuggestedBin,
                        expectedBreakdown: offlineBreakdown
                    };
                    setItemData(itemDataObj);
                    if (!editId) {
                        setQuantity('');
                        // En offline mantenemos el comportamiento anterior
                        setRelocatedBin('');
                    }
                    quantityRef.current?.focus();
                } else {
                    alert("Item no encontrado en el maestro local.");
                    setItemData(null);
                }
            } catch (e) {
                console.error("Offline lookup error", e);
                alert("Error al buscar el ítem localmente.");
            }
            finally { setLoading(false); }
        }
    };

    const handleSaveLog = async (e) => {
        e.preventDefault();
        if (!itemData) return alert("Busque un item primero");

        // Validación de Ubicación (Slotting)
        const currentBin = (itemData.binLocation || '').trim().toUpperCase();
        const hasValidMasterBin = currentBin && currentBin !== 'N/A' && currentBin !== 'SIN UBICACION' && currentBin !== 'NONE' && (validBins.size === 0 || validBins.has(currentBin));
        const hasRelocatedBin = relocatedBin.trim().length > 0;

        if (!hasValidMasterBin && !hasRelocatedBin) {
            if (itemData.suggestedBin) {
                setRelocatedBin(itemData.suggestedBin);
                alert(`El ítem ingresado no tiene una ubicación registrada en el maestro de ubicaciones. Se ha sugerido la ubicación: ${itemData.suggestedBin}. Por favor confirme o asigne la ubicación.`);
            } else {
                alert("El ítem ingresado no tiene una ubicación registrada en el maestro de ubicaciones. Se debe asignar una ubicación.");
            }
            setTimeout(() => relocatedBinRef.current?.focus(), 100);
            return;
        }

        if (relocatedBin.trim()) {
            const normalizedBin = relocatedBin.trim().toUpperCase();
            if (validBins.size > 0 && normalizedBin !== 'XDOCK' && !validBins.has(normalizedBin)) {
                alert(`La ubicación "${normalizedBin}" no existe.`);
                setTimeout(() => relocatedBinRef.current?.focus(), 100);
                return;
            }
        }

        if (isSaving) return; // Bloquear doble clic
        setIsSaving(true);

        const targetClientId = (typeof editId === 'string' && editId.includes('-')) ? editId : crypto.randomUUID();
        const payload = {
            importReference: importRef.trim().toUpperCase(),
            waybill: waybill.trim().toUpperCase(),
            itemCode: itemData.itemCode,
            itemDescription: itemData.description,
            quantity: parseInt(quantity),
            qtyReceived: parseInt(quantity),
            relocatedBin: relocatedBin.trim().toUpperCase(),
            binLocation: itemData.binLocation,
            qtyGrn: itemData.defaultQtyGrn,
            client_id: targetClientId,
            timestamp: new Date().toISOString()
        };

        // Actualización optimista instantánea (0ms latencia visual en la tabla)
        const optimisticEntry = {
            id: typeof editId === 'number' ? editId : targetClientId,
            timestamp: payload.timestamp,
            importReference: payload.importReference,
            waybill: payload.waybill,
            itemCode: payload.itemCode,
            itemDescription: payload.itemDescription,
            binLocation: payload.binLocation,
            relocatedBin: payload.relocatedBin,
            qtyReceived: payload.quantity,
            qtyGrn: payload.qtyGrn,
            difference: payload.quantity - payload.qtyGrn,
            username: 'TÚ (Reciente)',
            client_id: targetClientId,
            expected_qty: payload.qtyGrn
        };

        queryClient.setQueryData(['inbound_logs', currentVersion], (old = []) => {
            if (editId) {
                return old.map(l => (l.id === editId || l.client_id === targetClientId) ? { ...l, ...optimisticEntry } : l);
            }
            return [optimisticEntry, ...old.filter(l => l.client_id !== targetClientId)];
        });

        try {
            if (navigator.onLine) {
                try {
                    let res;
                    if (editId) {
                        if (typeof editId === 'string' && editId.includes('-')) {
                            await savePendingSync('inbound', payload, editId);
                            loadLogs(); resetForm(); return;
                        }
                        res = await fetch(`/api/update_log/${editId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({
                                importReference: payload.importReference,
                                waybill: payload.waybill,
                                qtyReceived: payload.quantity,
                                relocatedBin: payload.relocatedBin
                            })
                        });
                    } else {
                        res = await fetch(`/api/add_log`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify(payload)
                        });
                    }
                    if (res.ok) {
                        queryClient.invalidateQueries({ queryKey: ['inbound_logs'] });
                        queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
                        queryClient.invalidateQueries({ queryKey: ['ir_reconciliations'] });
                        if (typeof BroadcastChannel !== 'undefined') {
                            const bc = new BroadcastChannel('logix_events');
                            bc.postMessage({ type: 'INBOUND_MUTATED' });
                            bc.close();
                        }
                        resetForm(); return;
                    }
                } catch (e) { console.error("Connection error, falling back to offline save", e); }
            }

            // Guardar offline
            await savePendingSync('inbound', payload, typeof editId === 'number' ? editId : null);
            if (navigator.onLine) {
                syncPendingData(); // Intentar sincronizar de nuevo en segundo plano
            }
            queryClient.invalidateQueries({ queryKey: ['inbound_logs'] });
            queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
            queryClient.invalidateQueries({ queryKey: ['ir_reconciliations'] });
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('logix_events');
                bc.postMessage({ type: 'INBOUND_MUTATED' });
                bc.close();
            }
            if (!hasWarnedOffline) {
                if (!navigator.onLine) {
                    alert("Guardado localmente (Offline).");
                } else {
                    console.log("Logix: Requerimiento encolado localmente por fallo temporal de red.");
                }
                setHasWarnedOffline(true);
            }
            resetForm();
        } catch (e) {
            alert("Error al guardar");
        } finally {
            setIsSaving(false); // Siempre liberar el bloqueo
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("¿Eliminar registro?")) return;
        if (typeof id === 'string' && id.includes('-')) {
            try {
                const db = await getDB();
                await db.delete('pending_sync', id);
                loadLogs(); return;
            } catch (e) { console.error(e); }
        }
        try {
            await fetch(`/api/delete_log/${id}`, { method: 'DELETE', credentials: 'include' });
            loadLogs();
        } catch (e) { alert("Error"); }
    };

    const handleArchive = async () => {
        if (!confirm("¿Archivar registros actuales y limpiar base?")) return;
        try {
            await fetch(`/api/logs/archive`, { method: 'POST', credentials: 'include' });
            loadLogs(); loadVersions();
        } catch (e) { alert("Error"); }
    };

    const resetForm = () => {
        setEditId(null); setItemCode(''); setQuantity(''); setRelocatedBin(''); setItemData(null);
        setTimeout(() => itemCodeRef.current?.focus(), 300);
    };

    const startEdit = (log) => {
        setEditId(log.id);
        setImportRef(log.importReference ? log.importReference.trim() : '');
        setWaybill(log.waybill ? log.waybill.trim() : '');
        setItemCode(log.itemCode);
        setQuantity(log.qtyReceived);
        setRelocatedBin(log.relocatedBin ? log.relocatedBin.trim() : '');
        fetch(`/api/find_item/${encodeURIComponent(log.itemCode)}/${encodeURIComponent(log.importReference)}?_=${Date.now()}`)
            .then(r => r.json()).then(data => setItemData(data));
    };

    const handleScan = (code) => {
        setScannerOpen(false);
        if (code) {
            findItem(code.toUpperCase());
        }
    };

    const itemLogs = logs.filter(l => l.itemCode === itemData?.itemCode && (l.importReference || l.importRef || '').trim().toUpperCase() === importRef.trim().toUpperCase());
    const cumulativeQty = itemLogs.reduce((acc, curr) => acc + (parseInt(curr.qtyReceived) || 0), 0);
    const currentQtyNum = parseInt(quantity) || 0;
    const itemWeight = parseFloat(itemData?.weight || 0);
    const totalWeight = isNaN(itemWeight) || isNaN(currentQtyNum) ? '0.00' : (itemWeight * (currentQtyNum || 1)).toFixed(2);

    // Cálculo dinámico de Xdock pendiente basado en lo que ya se ha registrado en la tabla
    const effectiveXdockPending = Math.max(0, (itemData?.xdockTotal || 0) - cumulativeQty);

    const handlePrint = useReactToPrint({
        contentRef: labelComponentRef,
        documentTitle: itemData ? `Etiqueta-${itemData.itemCode}` : 'Etiqueta',
        pageStyle: "@page { size: 70mm 100mm; margin: 0; } @media print { body { -webkit-print-color-adjust: exact; } }",
    });

    return (
        <>
            <div className="container-wrapper px-4 pt-1 pb-4 lg:h-[calc(100vh-5px)] lg:flex lg:flex-col lg:overflow-hidden" style={{ paddingTop: '0.75rem' }}>
                <form onSubmit={handleSaveLog} className="lg:flex-shrink-0 mb-0">

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-1">
                        <div className="lg:col-span-2 bg-white p-2 rounded shadow-sm !mb-0 border border-gray-200">
                            <div className="bg-white text-black px-2 py-1 -mx-2 -mt-2 mb-2 rounded-t border-b border-gray-100 flex justify-between items-center">
                                <h1 className="text-base font-medium  tracking-tight uppercase">Inbound - Recepción</h1>
                                <div className="flex items-center gap-2">
                                    {pendingCount > 0 && (
                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-md text-[10px] font-medium animate-pulse cursor-pointer" onClick={syncPendingData} title="Sincronizar pendientes ahora">
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                            {pendingCount} Pendientes
                                        </div>
                                    )}
                                    <button type="button" onClick={async () => { setIsSyncing(true); const ok = await downloadMasterData(); alert(ok ? '✅ Maestro sincronizado.' : '❌ Error.'); setIsSyncing(false); }} className={`p-1.5 rounded hover:bg-gray-200 ${isSyncing ? 'animate-spin' : ''}`} title="Sincronizar Maestro">
                                        <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-2">
                                <div>
                                    <label className="form-label font-normal text-black">Import Reference</label>
                                    <input type="text" value={importRef} onChange={e => setImportRef(e.target.value.toUpperCase())} onBlur={e => handleLookupReference('import_ref', e.target.value)} placeholder="I.R." className="font-normal text-black" required />
                                </div>
                                <div>
                                    <label className="form-label font-normal text-black">Waybill</label>
                                    <input type="text" value={waybill} onChange={e => setWaybill(e.target.value.toUpperCase())} onBlur={e => handleLookupReference('waybill', e.target.value)} placeholder="W.B." className="font-normal text-black" required />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="form-label font-normal text-black">Item Code</label>
                                    <div className="flex gap-2">
                                        <input type="text" ref={itemCodeRef} value={itemCode} onChange={e => setItemCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), findItem(e.target.value))} placeholder="Escanear o Escribir" className="font-normal text-black" required disabled={!!editId} />
                                        <button
                                            type="button"
                                            className="btn-sap btn-secondary w-[30px] h-[30px] !p-0 flex items-center justify-center"
                                            onClick={findItem}
                                            disabled={loading}
                                        >
                                            {loading ? '...' : (
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                                </svg>
                                            )}
                                        </button>
                                        {!editId && (
                                            <button
                                                type="button"
                                                className="btn-sap btn-secondary w-[30px] h-[30px] !p-0 flex items-center justify-center"
                                                onClick={() => setScannerOpen(true)}
                                                title="Escanear"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 26 26" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" /></svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mb-2"><label className="form-label font-normal text-black">Item Description</label><div className="data-field font-normal text-black border-b border-gray-200 pb-1">{itemData?.description || ''}</div></div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                                <div><label className="form-label font-normal text-black">Qty Received</label><input type="number" ref={quantityRef} value={quantity} onChange={e => setQuantity(e.target.value)} className="font-normal text-xl text-black border border-zinc-400 focus:border-black outline-none" required min="1" /></div>
                                <div><label className="form-label font-normal text-black">Bin (Original)</label><div className="data-field font-normal text-blue-800 bg-blue-50 px-2 py-1 rounded border border-blue-100" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.binLocation || ''}</div></div>
                                <div><label className="form-label font-normal text-black">Relocate (New)</label><input type="text" ref={relocatedBinRef} value={relocatedBin} onChange={e => setRelocatedBin(e.target.value.toUpperCase())} className="font-normal text-black border border-zinc-400 focus:border-black outline-none" placeholder="(Opcional)" /></div>

                                {(effectiveXdockPending > 0 || itemData?.suggestedBin) && (
                                    <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                                        {effectiveXdockPending > 0 ? (
                                            <div className="bg-red-50 border-2 border-red-800 rounded p-2 shadow-sm">
                                                <h4 className="text-[10px] font-medium  uppercase text-red-900 mb-1 border-b border-red-100 pb-0.5 tracking-widest">XDOCK</h4>
                                                <div className="flex flex-col gap-0.5 text-black font-medium ">
                                                    <div className="flex justify-between items-center text-[9px] uppercase"><span>Total Reservado:</span><span>{itemData.xdockTotal}</span></div>
                                                    <div className="flex justify-between items-center text-[9px] uppercase text-red-900 font-medium "><span>Pendiente:</span><span>{effectiveXdockPending} UN</span></div>
                                                </div>
                                            </div>
                                        ) : <div className="hidden sm:block"></div>}

                                        {effectiveXdockPending > 0 && itemData?.xdockCustomers?.length > 0 ? (
                                            <div className="bg-red-50 border-2 border-red-800 rounded p-2 shadow-sm overflow-hidden">
                                                <h4 className="text-[10px] font-medium  uppercase text-red-900 mb-1 border-b border-red-100 pb-0.5 tracking-widest">RESERVAS:</h4>
                                                <div className="max-h-24 overflow-y-auto space-y-0.5 pr-1 font-medium ">
                                                    {itemData.xdockCustomers.map((c, idx) => {
                                                        const custName = typeof c === 'string' ? c : (c?.name || c?.customer_name || 'SIN NOMBRE');
                                                        const custQty = (typeof c === 'object' && c?.qty !== undefined) ? `${c.qty} UN` : null;
                                                        return (
                                                            <div key={idx} className="flex justify-between items-baseline text-[10px] border-b border-red-50 last:border-0 pb-0.5">
                                                                <div className="pr-2 text-black uppercase truncate font-medium "><span className="text-[9px]">{custName}</span></div>
                                                                {custQty && <span className="text-red-700 whitespace-nowrap font-medium ">{custQty}</span>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : (effectiveXdockPending > 0 ? <div className="bg-gray-50 border border-red-200 rounded p-2 text-[10px] text-gray-800 font-medium  italic flex items-center justify-center">Sin detalles</div> : <div className="hidden sm:block"></div>)}

                                        {itemData?.suggestedBin ? (
                                            <div className={`rounded p-2 shadow-sm cursor-pointer border-2 ${(!itemData.binLocation || itemData.binLocation === 'N/A') && effectiveXdockPending > 0 ? 'bg-amber-50 border-amber-400 hover:bg-amber-100' : 'bg-emerald-50 border-emerald-400 hover:bg-emerald-100'}`} onClick={() => setRelocatedBin(itemData.suggestedBin)}>
                                                <div className="flex justify-between border-b border-opacity-20 pb-0.5 mb-1">
                                                    <span className={`text-[10px] font-medium  uppercase ${(!itemData.binLocation || itemData.binLocation === 'N/A') && effectiveXdockPending > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                                                        {(!itemData.binLocation || itemData.binLocation === 'N/A') && effectiveXdockPending > 0 ? 'UBICACIÓN + XDOCK' : 'Sugerida'}
                                                    </span>
                                                    <span className="text-[8px] italic text-zinc-600 font-medium ">Tap usar</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <svg className={`w-4 h-4 ${(!itemData.binLocation || itemData.binLocation === 'N/A') && effectiveXdockPending > 0 ? 'text-amber-700' : 'text-emerald-700'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                        <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                        <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    </svg>
                                                    <span className="text-base font-mono font-medium  text-black">{itemData.suggestedBin}</span>
                                                    {(!itemData.binLocation || itemData.binLocation === 'N/A') && effectiveXdockPending > 0 && (
                                                        <span className="ml-auto text-[10px] font-medium  bg-red-700 text-white px-1.5 py-0.5 rounded shadow-sm">XDOCK</span>
                                                    )}
                                                </div>
                                            </div>
                                        ) : <div className="hidden sm:block"></div>}
                                    </div>
                                )}
                                <div><label className="form-label font-normal text-black">Aditional Bins</label><div className="data-field text-xs font-normal text-black bg-zinc-50 px-2 py-0.5 rounded" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.aditionalBins || ''}</div></div>
                                <div><label className="form-label font-normal text-black">ABC Type</label><div className="data-field font-normal text-black bg-zinc-50 px-2 py-0.5 rounded" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.itemType || ''}</div></div>
                                <div><label className="form-label font-normal text-black">SIC Code</label><div className="data-field font-normal text-black bg-zinc-50 px-2 py-0.5 rounded" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.sicCode || ''}</div></div>
                            </div>

                            <div className="bg-white p-4 border-2 border-zinc-200 rounded-lg mb-2 shadow-sm">
                                <h3 className="text-[11px] font-medium  uppercase text-black border-b-2 border-black pb-1 mb-3 tracking-widest">Resumen de Recepción</h3>
                                <div className="grid grid-cols-3 gap-4 mb-4">
                                    <div><label className="form-label font-normal text-black">Recibido</label><div className="data-field font-normal text-2xl text-[#1e4a74]" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{cumulativeQty}</div></div>
                                    <div><label className="form-label font-normal text-black">Esperado</label><div className="data-field font-normal text-2xl text-black" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.defaultQtyGrn || 0}</div></div>
                                    <div><label className="form-label font-normal text-black">Diferencia</label><div className={`data-field font-normal text-2xl ${(cumulativeQty - (itemData?.defaultQtyGrn || 0)) > 0 ? 'text-blue-700' :
                                        (cumulativeQty - (itemData?.defaultQtyGrn || 0)) < 0 ? 'text-red-700' : 'text-black'
                                        }`} style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{cumulativeQty - (itemData?.defaultQtyGrn || 0)}</div></div>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className={`h-9 px-6 text-[10px] text-white rounded-lg shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest active:scale-95 transition-all ${isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                                    style={{ background: '#285f94' }}
                                    onMouseEnter={e => !isSaving && (e.currentTarget.style.background = '#1e4a74')}
                                    onMouseLeave={e => !isSaving && (e.currentTarget.style.background = '#285f94')}
                                >
                                    {isSaving ? (
                                        <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> Guardando...</>
                                    ) : (
                                        editId ? 'Guardar Cambios' : 'Añadir Registro'
                                    )}
                                </button>
                                {editId && (
                                    <button
                                        type="button"
                                        onClick={resetForm}
                                        className="h-9 px-6 text-[10px] text-zinc-700 bg-white border border-zinc-200 rounded-lg shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest active:scale-95 transition-all hover:bg-zinc-50"
                                    >
                                        Cancelar
                                    </button>
                                )}
                            </div>

                        </div>

                        {/* Columna 3: Vista Etiqueta */}
                        <div className="lg:col-span-1 bg-white p-1 rounded shadow-sm border border-gray-200 flex flex-col justify-between">
                            <h2 className="text-[12px] font-semibold text-black uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1.5 flex items-center gap-1.5">
                                Vista Etiqueta
                            </h2>
                            <div className="flex-grow flex flex-col justify-center items-center">
                                <div className="border border-zinc-200 p-0 rounded bg-zinc-50 shadow-inner scale-[0.95] transform origin-center my-auto">
                                    <div ref={labelComponentRef} className="bg-white">
                                        <SandvikLabel
                                            data={itemData}
                                            qrImage={qrImage}
                                            quantity={quantity}
                                            relocatedBin={relocatedBin}
                                            totalWeight={totalWeight}
                                        />
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handlePrint}
                                className="h-9 w-full text-[10px] text-white rounded-lg shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                                style={{ background: '#285f94' }}
                                onMouseEnter={e => !(!itemData) && (e.currentTarget.style.background = '#1e4a74')}
                                onMouseLeave={e => !(!itemData) && (e.currentTarget.style.background = '#285f94')}
                                disabled={!itemData}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                Imprimir
                            </button>
                        </div>

                        {/* Columna 4: Tablero de Control de la IR */}
                        <div className="lg:col-span-1 bg-white p-3 rounded shadow-sm border border-gray-200 flex flex-col h-full min-h-[300px]">
                            <h2 className="text-[12px] font-semibold text-black uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1.5 flex items-center gap-1.5">
                                Tablero de Control: {importRef || "S.I.R."}
                            </h2>
                            
                            {importRef ? (
                                <div className="flex-grow flex flex-col justify-between">
                                    <div className="grid grid-cols-2 gap-2">
                                        <Dial 
                                            percent={irStats.totalLines > 0 ? Math.min(100, Math.round((irStats.completedLines / irStats.totalLines) * 100)) : 0} 
                                            label="Líneas OK" 
                                            valueText={`${irStats.completedLines}/${irStats.totalLines}`} 
                                            strokeColor="#1679E0" 
                                        />
                                        <Dial 
                                            percent={irStats.totalLines > 0 ? Math.min(100, Math.round((irStats.startedLines / irStats.totalLines) * 100)) : 0} 
                                            label="Iniciadas" 
                                            valueText={`${irStats.startedLines}/${irStats.totalLines}`} 
                                            strokeColor="#D97706" 
                                        />
                                        <Dial 
                                            percent={irStats.expectedUnits > 0 ? Math.min(100, Math.round((irStats.receivedUnits / irStats.expectedUnits) * 100)) : 0} 
                                            label="Unidades" 
                                            valueText={`${irStats.receivedUnits}/${irStats.expectedUnits}`} 
                                            strokeColor="#10B981" 
                                        />
                                        <Dial 
                                            percent={irStats.totalGrns > 0 ? irStats.grnProgressPercent : 0} 
                                            label="GRNs OK" 
                                            valueText={`${irStats.completedGrns}/${irStats.totalGrns}`} 
                                            strokeColor="#8B5CF6" 
                                        />
                                    </div>
                                    
                                    <div className="mt-4 space-y-2">
                                        <div className="text-[11px] uppercase font-bold text-zinc-800 tracking-wider">Desglose de Diferencias (GRN)</div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="p-2 bg-emerald-50 rounded border border-emerald-200 text-center">
                                                <div className="text-[15px] font-extrabold text-emerald-900">{irStats.okLines}</div>
                                                <div className="text-[9.5px] uppercase tracking-wider text-emerald-800 font-bold leading-tight">Sin Dif.</div>
                                            </div>
                                            <div className="p-2 bg-red-50 rounded border border-red-200 text-center">
                                                <div className="text-[15px] font-extrabold text-red-900">{irStats.negativeDiffLines}</div>
                                                <div className="text-[9.5px] uppercase tracking-wider text-red-800 font-bold leading-tight">Faltantes</div>
                                            </div>
                                            <div className="p-2 bg-blue-50 rounded border border-blue-200 text-center">
                                                <div className="text-[15px] font-extrabold text-blue-900">{irStats.positiveDiffLines}</div>
                                                <div className="text-[9.5px] uppercase tracking-wider text-blue-800 font-bold leading-tight">Sobrantes</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-grow flex flex-col items-center justify-center text-zinc-700 p-4 text-center">
                                    <svg className="w-10 h-10 text-zinc-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    <span className="italic text-[11px] uppercase tracking-wider font-medium">Ingrese una Import Reference para activar el tablero</span>
                                </div>
                            )}
                        </div>
                    </div>
                </form>

                <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden lg:flex-grow lg:flex lg:flex-col lg:min-h-0">
                    <div className="bg-zinc-50/50 p-2 border-b border-zinc-100 flex flex-col md:flex-row justify-between items-center lg:flex-shrink-0 gap-3">
                        <h2 className="text-base font-medium  text-black tracking-normal uppercase">Registros de ingreso</h2>
                        <div className="flex flex-wrap gap-2 items-center justify-end">
                            <div className="relative w-full sm:w-64">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-zinc-400 z-10">
                                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </span>
                                <input
                                    type="text"
                                    placeholder="BUSCAR..."
                                    className="w-full h-9 text-[10px] bg-white border border-zinc-200 rounded-lg outline-none text-black uppercase tracking-wider focus:border-zinc-400 transition-all"
                                    style={{ paddingLeft: '32px', paddingRight: searchTerm ? '30px' : '12px' }}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchTerm('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-all z-20 text-[11px] font-medium "
                                        title="Limpiar búsqueda"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            <select
                                onChange={(e) => setCurrentVersion(e.target.value)}
                                value={currentVersion}
                                className="h-9 p-1 text-[12px] text-black bg-white border border-zinc-200 rounded-lg outline-none cursor-pointer uppercase w-full sm:w-40 focus:border-zinc-400 transition-all"
                            >
                                <option value="">ACTUAL</option>
                                {versions.map(v => <option key={v} value={v}>{formatDate(v, false)}</option>)}
                            </select>

                            <button
                                onClick={() => {
                                    const offset = new Date().getTimezoneOffset();
                                    const baseUrl = currentVersion ? `/api/export_log?version_date=${currentVersion}` : '/api/export_log';
                                    window.location.href = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}timezone_offset=${offset}`;
                                }}
                                className="h-9 px-4 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-widest active:scale-95 transition-all whitespace-nowrap"
                                style={{ background: '#285f94' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#1e4a74'}
                                onMouseLeave={e => e.currentTarget.style.background = '#285f94'}
                            >
                                Exportar
                            </button>

                            <button
                                onClick={handleArchive}
                                className="h-9 px-4 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-widest active:scale-95 transition-all whitespace-nowrap"
                                style={{ background: '#285f94' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#1e4a74'}
                                onMouseLeave={e => e.currentTarget.style.background = '#285f94'}
                            >
                                Archivar
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto lg:flex-grow lg:overflow-y-auto min-h-0">
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 z-20">
                                <tr style={{ background: '#111827' }} className="text-white">
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">Ref</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">Waybill</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">Item</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">Desc</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">Orig</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">New</th>
                                    <th className="px-2 py-2 text-center text-[12px] font-medium  uppercase tracking-wider">Qty</th>
                                    <th className="px-2 py-2 text-center text-[12px] font-medium  uppercase tracking-wider">Esp.</th>
                                    <th className="px-2 py-2 text-center text-[12px] font-medium  uppercase tracking-wider">Dif.</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">Fecha</th>
                                    <th className="px-2 py-2 text-left text-[12px] font-medium  uppercase tracking-wider">User</th>
                                    <th className="px-2 py-2 text-center text-[12px] font-medium  uppercase tracking-wider">Acc</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-200">
                                {filteredLogs.length === 0 ? <tr><td colSpan="12" className="text-center py-4 font-normal text-black/60 uppercase tracking-widest">No hay registros registrados</td></tr> : filteredLogs.map((log, idx) => (
                                    <tr key={log.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'} hover:bg-blue-50 border-b border-gray-100 ${log.isPending ? 'border-l-4 border-amber-400' : ''}`}>
                                        <td className="px-2 py-1 font-normal text-sm text-black">{log.importReference}</td>
                                        <td className="px-2 py-1 font-normal text-sm text-black">{log.waybill}</td>
                                        <td className="px-2 py-1 font-normal text-sm text-black">{log.itemCode}</td>
                                        <td className="px-2 py-1 truncate max-w-[180px] font-normal text-sm text-black">{log.itemDescription}</td>
                                        <td className="px-2 py-1 font-normal text-sm text-blue-900">{log.binLocation}</td>
                                        <td className="px-2 py-1 font-normal text-sm text-emerald-900">{log.relocatedBin}</td>
                                        <td className="px-2 py-1 text-center font-normal text-sm text-black">{log.qtyReceived}</td>
                                        <td className="px-2 py-1 text-center font-normal text-sm text-black">{log.expected_qty || 0}</td>
                                        <td className={`px-2 py-1 text-center font-normal text-sm ${(log.difference || 0) > 0 ? 'text-blue-700' :
                                            (log.difference || 0) < 0 ? 'text-red-700' : 'text-gray-950'
                                            }`}>{log.difference || 0}</td>
                                        <td className="px-2 py-1 whitespace-nowrap text-sm text-black font-normal">{formatDate(log.timestamp)}</td>
                                        <td className="px-2 py-1 uppercase font-normal text-sm text-black">{log.username}</td>
                                        <td className="px-2 py-0.5">
                                            <div className="flex gap-1 justify-center">
                                                <button onClick={() => startEdit(log)} className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Editar">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => handleDelete(log.id)} className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors" title="Eliminar">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            {scannerOpen && <ScannerModal onScan={handleScan} onClose={() => setScannerOpen(false)} />}
        </>
    );
};

export default Inbound;
