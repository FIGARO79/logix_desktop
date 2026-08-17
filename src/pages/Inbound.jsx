import { useState, useEffect, useRef, useMemo } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import QRCode from 'qrcode';
import ScannerModal from '../components/ScannerModal';
import { getDB, savePendingSync, cacheData, getCachedData, getGRNExpectedQty, getGRNExpectedQtyBulk, matchRef } from '../utils/offlineDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { syncPendingInbound, checkAndSyncIfNeeded, downloadMasterData } from '../utils/syncManager';
import { useOffline } from '../hooks/useOffline';
import SandvikLabel from '../components/labels/SandvikLabel';
import PrinterSettingsModal from '../components/PrinterSettingsModal';
import { useReactToPrint } from 'react-to-print';
import '../styles/Label.css';
import { parseGS1Barcode } from '../utils/gs1Parser';
import { isTauri, callTauriCommand, tauriGetInboundMasterMaps, tauriLookupInboundReference, tauriGetItemDetails, confirmNative, getPrinterConfig, printSandvikLabelSilent } from '../utils/tauriBridge';


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
    const [refItems, setRefItems] = useState([]);
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
    const [printerModalOpen, setPrinterModalOpen] = useState(false);

    // --- Estado para el Tablero de Control de la IR ---
    const [irStats, setIrStats] = useState(DEFAULT_IR_STATS);

    const { data: logs = EMPTY_ARRAY, refetch: loadLogs } = useQuery({
        queryKey: ['inbound_logs', currentVersion],
        queryFn: async () => {
            let apiLogs = [];
            const version = currentVersion;

            if (isTauri()) {
                try {
                    const rawLogs = await callTauriCommand('get_inbound_logs', { versionDate: version || null });
                    if (rawLogs && Array.isArray(rawLogs)) {
                        apiLogs = rawLogs.map(l => ({
                            id: l.id,
                            timestamp: l.timestamp,
                            importReference: l.import_reference,
                            waybill: l.waybill,
                            itemCode: l.item_code,
                            itemDescription: l.item_description,
                            binLocation: l.bin_location,
                            relocatedBin: l.relocated_bin,
                            qtyReceived: l.qty_received,
                            qtyGrn: l.qty_grn,
                            difference: l.difference,
                            username: l.username || 'admin',
                            client_id: l.client_id,
                            version_date: l.version_date
                        }));
                    }
                } catch (tErr) {
                    console.error("Error cargando logs desde Rust Tauri:", tErr);
                }
            } else {
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
            }

            let localLogs = [];
            if (!version || version === '') {
                try {
                    const db = await getDB();
                    const directLocal = await db.getAll('local_inbound') || [];
                    const pending = await db.getAll('pending_sync') || [];
                    const pendingMapped = pending.map(p => ({
                        ...p.payload,
                        id: p.id,
                        timestamp: p.timestamp,
                        username: 'LOCAL (Sync)',
                        isPending: true,
                        itemDescription: p.payload.itemDescription || 'Cargando...'
                    }));
                    localLogs = [...directLocal, ...pendingMapped];
                } catch (e) { console.error("Error loading local inbound logs", e); }
            }

            const logMap = new Map();
            localLogs.forEach(log => {
                const key = log.id || log.client_id;
                if (key) logMap.set(key, log);
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
    const lastLookupRef = useRef({ ir: '', wb: '' });
    const isLookupRunningRef = useRef(false);

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

        // Desktop: always attempt to load from API (localApiBridge routes to SQLite)
        try {
            const res = await fetch('/api/views/valid_bins', { credentials: 'include' });
            if (res.ok) {
                const binsList = await res.json();
                if (Array.isArray(binsList) && binsList.length > 0) {
                    const binsSet = new Set(binsList.map(b => b.toUpperCase()));
                    setValidBins(binsSet);
                    await cacheData('slotting_valid_bins', binsList);
                    binsLoaded = true;
                    console.log(`Logix: Cargadas ${binsSet.size} ubicaciones válidas de slotting.`);
                }
            }
        } catch (e) {
            console.warn("No se pudo cargar bins desde la API, intentando fallback estático...", e);
        }

        // 2. Fallback: Cargar desde archivo estático JSON
        if (!binsLoaded) {
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
            let poInfo = await db.get('po_lookup', `ir_${targetIr}`);
            if (!poInfo) {
                const allPoItems = await db.getAll('po_lookup') || [];
                poInfo = allPoItems.find(p => {
                    const irVal = getImportRefFromMatch(p);
                    return matchRef(irVal, targetIr);
                });
            }

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
                const code = String(g.Item_Code || g.item_code || '').toUpperCase().trim();
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
                            Item_Code: code,
                            total_expected: itemExpectedForIr
                        });
                    }
                } else {
                    // Fallback para formato plano (Item_Code, GRN_Number, Quantity, Import_Reference)
                    const grnNum = (g.GRN_Number || g.grn_number || '').trim().toUpperCase();
                    const qty = parseInt(g.Quantity || g.quantity || g.total_expected || 0) || 0;
                    if (associatedGrns.size > 0) {
                        if (grnNum && associatedGrns.has(grnNum)) {
                            irLines.push({
                                Item_Code: code,
                                total_expected: qty
                            });
                        } else if (!grnNum && matchRef(g.Import_Reference || g.import_ref || g.import_reference, targetIr)) {
                            irLines.push({
                                Item_Code: code,
                                total_expected: qty
                            });
                        }
                    } else if (matchRef(g.Import_Reference || g.import_ref || g.import_reference, targetIr)) {
                        irLines.push({
                            Item_Code: code,
                            total_expected: qty
                        });
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
                groupedIrLines[code].total_expected += parseInt(line.total_expected || line.Quantity || line.quantity || 0) || 0;
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
                if (matchRef(logIr, targetIr)) {
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
                const code = String(g.Item_Code || g.item_code || '').toUpperCase().trim();
                if (code) {
                    if (!grnDetailExpectedMap[code]) {
                        grnDetailExpectedMap[code] = {};
                    }
                    if (g.grns) {
                        Object.entries(g.grns).forEach(([grnNum, qty]) => {
                            grnDetailExpectedMap[code][grnNum.toUpperCase().trim()] = parseInt(qty) || 0;
                        });
                    } else if (g.GRN_Number || g.grn_number) {
                        const grnNum = String(g.GRN_Number || g.grn_number).toUpperCase().trim();
                        const qty = parseInt(g.Quantity || g.quantity || 0) || 0;
                        grnDetailExpectedMap[code][grnNum] = qty;
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
                                    
                                    if (grnDetailExpectedMap[itemCode] !== undefined && 
                                        grnDetailExpectedMap[itemCode][gKeyUpper] !== undefined) {
                                        expectedQty = grnDetailExpectedMap[itemCode][gKeyUpper];
                                    } else {
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

    // Búsqueda automática en tiempo real al escribir Import Reference (300ms debounce)
    useEffect(() => {
        if (!importRef || importRef.trim().length < 3) return;
        const timer = setTimeout(() => {
            handleLookupReference('import_ref', importRef);
        }, 300);
        return () => clearTimeout(timer);
    }, [importRef]);

    // Búsqueda automática en tiempo real al escribir Waybill (300ms debounce)
    useEffect(() => {
        if (!waybill || waybill.trim().length < 3) return;
        const timer = setTimeout(() => {
            handleLookupReference('waybill', waybill);
        }, 300);
        return () => clearTimeout(timer);
    }, [waybill]);

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
    const filteredLogs = useMemo(() => {
        if (!searchTerm || !searchTerm.trim()) return logs;
        const term = searchTerm.trim().toLowerCase();
        return logs.filter(log =>
            (log.itemCode && String(log.itemCode).toLowerCase().includes(term)) ||
            (log.waybill && String(log.waybill).toLowerCase().includes(term)) ||
            ((log.importReference || log.importRef) && String(log.importReference || log.importRef).toLowerCase().includes(term)) ||
            ((log.itemDescription || log.description) && String(log.itemDescription || log.description).toLowerCase().includes(term)) ||
            (log.binLocation && String(log.binLocation).toLowerCase().includes(term)) ||
            (log.relocatedBin && String(log.relocatedBin).toLowerCase().includes(term)) ||
            (log.username && String(log.username).toLowerCase().includes(term))
        );
    }, [logs, searchTerm]);

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

    const matchRef = (val1, val2) => {
        if (!val1 || !val2) return false;
        const s1 = String(val1).trim().toUpperCase();
        const s2 = String(val2).trim().toUpperCase();
        if (s1 === s2) return true;

        // Quitar prefijos comunes como 'IR', 'IR-', 'REF-', 'PO-'
        const stripPrefix = (str) => str.replace(/^(IR|REF|PO)[-_\s]*/i, '');
        const clean1 = stripPrefix(s1).replace(/[^A-Z0-9]/g, '');
        const clean2 = stripPrefix(s2).replace(/[^A-Z0-9]/g, '');
        if (clean1 && clean2 && clean1 === clean2) return true;

        // Normalizar ceros a la izquierda en subpartes (ej. 26-0594 === 26-594)
        const normParts = (str) => stripPrefix(str).split(/[^A-Z0-9]+/).map(p => p.replace(/^0+/, '')).filter(Boolean).join('-');
        const p1 = normParts(s1);
        const p2 = normParts(s2);
        return Boolean(p1 && p2 && p1 === p2);
    };

    const getWaybillFromMatch = (m) => {
        if (!m) return '';
        if (m.waybill) return m.waybill;
        if (m.Waybill) return m.Waybill;
        if (m.wb) return m.wb;
        if (m.type === 'wb' && m.value) return m.value;
        if (m.id && typeof m.id === 'string' && m.id.startsWith('wb_')) return m.id.replace('wb_', '');
        return '';
    };

    const getImportRefFromMatch = (m) => {
        if (!m) return '';
        if (m.import_ref) return m.import_ref;
        if (m.import_reference) return m.import_reference;
        if (m.Import_Reference) return m.Import_Reference;
        if (m.ir) return m.ir;
        if (m.type === 'ir' && m.value) return m.value;
        if (m.id && typeof m.id === 'string' && m.id.startsWith('ir_')) return m.id.replace('ir_', '');
        return '';
    };

    const handleLookupReference = async (type, value) => {
        if (!value) return;
        const normalizedValue = value.trim().toUpperCase();
        if (!normalizedValue) return;

        let foundWb = '';
        let foundIr = '';

        // 1. Intentar Búsqueda en Rust Core nativo (100% local en SQLite / po_lookup.json)
        if (isTauri()) {
            try {
                const res = await tauriLookupInboundReference(
                    type === 'waybill' ? normalizedValue : null,
                    type === 'import_ref' ? normalizedValue : null
                );
                if (res) {
                    const resWb = res.waybill || res.wb || '';
                    const resIr = res.import_ref || res.importRef || res.ir || '';
                    if (resWb && !matchRef(resWb, normalizedValue)) setWaybill(resWb);
                    if (resIr && !matchRef(resIr, normalizedValue)) setImportRef(resIr);
                    if (res.items && Array.isArray(res.items) && res.items.length > 0) {
                        setRefItems(res.items);
                    }
                    if (resWb || resIr) return;
                }
            } catch (err) {
                console.warn("Error en lookup de Rust:", err);
            }
        }

        // 2. Fallback a caché local si no se encontró en Rust
        if ((type === 'import_ref' && !foundWb) || (type === 'waybill' && !foundIr)) {
            try {
                const db = await getDB();
                const cleanVal = normalizedValue.replace(/[^A-Z0-9]/g, '');
                const idExact = type === 'waybill' ? `wb_${normalizedValue}` : `ir_${normalizedValue}`;
                const idClean = type === 'waybill' ? `wb_${cleanVal}` : `ir_${cleanVal}`;

                let match = await db.get('po_lookup', idExact) || (cleanVal ? await db.get('po_lookup', idClean) : null);
                if (!match) {
                    const allPo = await db.getAll('po_lookup') || [];
                    match = allPo.find(p => {
                        const irStr = getImportRefFromMatch(p);
                        const wbStr = getWaybillFromMatch(p);
                        return type === 'import_ref'
                            ? matchRef(irStr, normalizedValue)
                            : matchRef(wbStr, normalizedValue);
                    });
                }

                if (match) {
                    if (!foundIr) foundIr = getImportRefFromMatch(match);
                    if (!foundWb) foundWb = getWaybillFromMatch(match);
                    if (match.items && Array.isArray(match.items)) {
                        setRefItems(match.items);
                    }
                }
            } catch (e) {
                console.error("Error en búsqueda de referencia:", e);
            }
        }

        // 3. Asignar los valores encontrados a los inputs del formulario
        if (foundWb && type === 'import_ref' && !matchRef(foundWb, waybill)) setWaybill(foundWb);
        if (foundIr && type === 'waybill' && !matchRef(foundIr, importRef)) setImportRef(foundIr);
    };

    const findItem = async (codeToSearch = null) => {
        const rawCode = (codeToSearch !== null && typeof codeToSearch === 'string') ? codeToSearch : itemCode;
        if (!rawCode) {
            alert("Por favor ingrese el código del ítem");
            return;
        }
        setLoading(true);

        let normalizedCode = rawCode.trim().toUpperCase();
        const gs1Result = parseGS1Barcode(normalizedCode);
        if (gs1Result.isGS1 && gs1Result.itemCode) {
            normalizedCode = gs1Result.itemCode.trim().toUpperCase();
        }
        setItemCode(normalizedCode);

        try {
            // 1. En Tauri Desktop, invocar directamente find_item_inbound de Rust
            if (isTauri()) {
                const res = await callTauriCommand('find_item_inbound', {
                    itemCode: normalizedCode,
                    importRef: importRef || null
                });
                if (res) {
                    const suggested = res.suggested_bin || res.suggestedBin || null;
                    const binLoc = res.bin_location || 'N/A';
                    setItemData({
                        itemCode: res.item_code || normalizedCode,
                        description: res.description || 'Ítem sin descripción',
                        binLocation: binLoc,
                        aditionalBins: res.additional_bins || '',
                        weight: res.weight || 0,
                        itemType: res.item_type || '',
                        sicCode: res.sic_code || '',
                        defaultQtyGrn: res.default_qty_grn || 0,
                        xdockTotal: res.xdock_total || 0,
                        xdockPending: res.xdock_pending || 0,
                        xdockCustomers: res.xdock_customers || [],
                        expectedBreakdown: res.expected_breakdown || [],
                        suggestedBin: suggested
                    });
                    if (!editId) {
                        setQuantity(res.default_qty_grn > 0 ? String(res.default_qty_grn) : '');
                        const currBin = binLoc.trim().toUpperCase();
                        if ((!currBin || currBin === 'N/A' || currBin === 'SIN UBICACION' || currBin === 'NONE' || currBin === '0' || currBin === '-') && suggested) {
                            setRelocatedBin(suggested);
                        } else {
                            setRelocatedBin('');
                        }
                    }
                    quantityRef.current?.focus();
                    setLoading(false);
                    return;
                }
            }

            // 2. Fetch HTTP estándar (manejado por localApiBridge en local o backend en web)
            const fetchRes = await fetch(`/api/find_item/${encodeURIComponent(normalizedCode)}/${encodeURIComponent(importRef || '')}?_=${Date.now()}`, { credentials: 'include' });
            if (fetchRes.ok) {
                const data = await fetchRes.json();
                const suggested = data.suggestedBin || data.suggested_bin || null;
                const binLoc = data.binLocation || data.bin_location || 'N/A';
                setItemData({
                    ...data,
                    binLocation: binLoc,
                    suggestedBin: suggested
                });
                if (!editId) {
                    setQuantity(data.defaultQtyGrn > 0 ? String(data.defaultQtyGrn) : '');
                    const currBin = binLoc.trim().toUpperCase();
                    if ((!currBin || currBin === 'N/A' || currBin === 'SIN UBICACION' || currBin === 'NONE' || currBin === '0' || currBin === '-') && suggested) {
                        setRelocatedBin(suggested);
                    } else {
                        setRelocatedBin('');
                    }
                }
                quantityRef.current?.focus();
                setLoading(false);
                return;
            }
        } catch (e) {
            console.error("Error buscando ítem:", e);
        } finally {
            setLoading(false);
        }

        alert(`No se encontraron datos para el ítem '${normalizedCode}'. Asegúrese de haber cargado el archivo 250 en Datos Maestros.`);
        setItemData(null);
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
            if (isTauri()) {
                await callTauriCommand('save_inbound_log', {
                    entry: {
                        id: typeof editId === 'number' ? editId : null,
                        timestamp: payload.timestamp,
                        import_reference: payload.importReference,
                        waybill: payload.waybill || null,
                        item_code: payload.itemCode,
                        item_description: payload.itemDescription || null,
                        bin_location: payload.binLocation || null,
                        relocated_bin: payload.relocatedBin || null,
                        qty_received: Number(payload.quantity),
                        qty_grn: Number(payload.qtyGrn || 0),
                        difference: Number(payload.quantity - (payload.qtyGrn || 0)),
                        username: 'admin',
                        client_id: targetClientId,
                        archived_at: null,
                        version_date: null
                    }
                });
            } else {
                await fetch(editId ? `/api/update_log/${editId}` : '/api/add_log', {
                    method: editId ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });
            }

            resetForm();
            queryClient.invalidateQueries({ queryKey: ['inbound_logs'] });
            queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
            queryClient.invalidateQueries({ queryKey: ['ir_reconciliations'] });
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('logix_events');
                bc.postMessage({ type: 'INBOUND_MUTATED' });
                bc.close();
            }
            toast.success("Registro de inbound guardado exitosamente");
        } catch (e) {
            console.error("Error al guardar log de inbound:", e);
            toast.error("Error al guardar registro");
            resetForm();
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        const confirmed = await confirmNative("¿Está seguro de que desea eliminar este registro de recepción?", "Eliminar Registro");
        if (!confirmed) return;
        try {
            if (isTauri()) {
                await callTauriCommand('delete_inbound_log', { id: Number(id) });
            } else {
                await fetch(`/api/delete_log/${id}`, { method: 'DELETE', credentials: 'include' });
            }
            queryClient.invalidateQueries({ queryKey: ['inbound_logs'] });
            queryClient.invalidateQueries({ queryKey: ['ir_reconciliations'] });
            loadLogs();
            toast.success("Registro eliminado correctamente");
        } catch (e) {
            console.error("Error al eliminar log:", e);
            toast.error("Error al eliminar");
        }
    };

    const handleArchive = async () => {
        const confirmed = await confirmNative("¿Desea archivar todos los registros actuales y limpiar la base activa?", "Archivar Registros");
        if (!confirmed) return;
        try {
            if (isTauri()) {
                await callTauriCommand('archive_inbound_logs');
            } else {
                await fetch(`/api/logs/archive`, { method: 'POST', credentials: 'include' });
            }
            queryClient.invalidateQueries({ queryKey: ['inbound_logs'] });
            loadLogs();
            loadVersions();
            toast.success("Registros archivados exitosamente");
        } catch (e) {
            console.error("Error al archivar logs:", e);
            toast.error("Error al archivar");
        }
    };

    const resetForm = () => {
        setEditId(null);
        setItemCode('');
        setQuantity('');
        setRelocatedBin('');
        setItemData(null);
        setQrImage(null);
        if (itemCodeRef.current) {
            itemCodeRef.current.value = '';
        }
        if (quantityRef.current) {
            quantityRef.current.value = '';
        }
        if (relocatedBinRef.current) {
            relocatedBinRef.current.value = '';
        }
        setTimeout(() => {
            if (itemCodeRef.current) {
                itemCodeRef.current.focus();
                itemCodeRef.current.select?.();
            }
        }, 50);
    };

    const startEdit = (log) => {
        setEditId(log.id);
        const ir = (log.importReference || log.importRef || '').trim();
        const wb = (log.waybill || '').trim();
        const code = (log.itemCode || '').trim();
        setImportRef(ir);
        setWaybill(wb);
        setItemCode(code);
        setQuantity(log.qtyReceived || log.quantity || '');
        setRelocatedBin((log.relocatedBin || '').trim());
        findItem(code);
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

    const triggerReactPrint = useReactToPrint({
        contentRef: labelComponentRef,
        documentTitle: itemData ? `Etiqueta-${itemData.itemCode}` : 'Etiqueta',
        pageStyle: "@page { size: 70mm 100mm; margin: 0; } @media print { body { -webkit-print-color-adjust: exact; } }",
    });

    const handlePrintClick = async () => {
        const cfg = getPrinterConfig();
        if (isTauri() && cfg.auto_print_enabled && itemData) {
            const payload = {
                itemCode: itemData.itemCode,
                description: itemData.description,
                quantity: quantity || 1,
                weight: totalWeight,
                binLocation: relocatedBin || itemData.binLocation || '',
                qrData: itemData.itemCode
            };
            const res = await printSandvikLabelSilent(payload, cfg.default_label_printer);
            if (res.success) {
                return;
            }
        }
        triggerReactPrint();
    };

    return (
        <>
            <PrinterSettingsModal isOpen={printerModalOpen} onClose={() => setPrinterModalOpen(false)} />
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
                                    <input type="text" value={importRef} onChange={e => setImportRef(e.target.value.toUpperCase())} onBlur={e => handleLookupReference('import_ref', e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLookupReference('import_ref', e.target.value))} placeholder="I.R." className="font-normal text-black" required />
                                </div>
                                <div>
                                    <label className="form-label font-normal text-black">Waybill</label>
                                    <input type="text" value={waybill} onChange={e => setWaybill(e.target.value.toUpperCase())} onBlur={e => handleLookupReference('waybill', e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLookupReference('waybill', e.target.value))} placeholder="W.B." className="font-normal text-black" required />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="form-label font-normal text-black">Item Code</label>
                                    <div className="flex gap-2 relative">
                                        <input
                                            type="text"
                                            ref={itemCodeRef}
                                            list="inbound-item-suggestions"
                                            value={itemCode}
                                            onChange={e => setItemCode(e.target.value.toUpperCase())}
                                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), findItem(e.target.value))}
                                            placeholder="Escanear o Escribir"
                                            className="font-normal text-black"
                                            required
                                            disabled={!!editId}
                                        />
                                        {refItems.length > 0 && (
                                            <datalist id="inbound-item-suggestions">
                                                {refItems.map((it, idx) => (
                                                    <option key={idx} value={it.item_code || it.item || it.code}>
                                                        {`Cant: ${it.qty || it.quantity || 0} | GRN: ${it.grn || 'N/A'}`}
                                                    </option>
                                                ))}
                                            </datalist>
                                        )}
                                        <button
                                            type="button"
                                            className="btn-sap btn-secondary w-[30px] h-[30px] !p-0 flex items-center justify-center"
                                            onClick={() => findItem(itemCode)}
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
                            <div className="flex items-center gap-1.5 w-full">
                                <button
                                    type="button"
                                    onClick={() => setPrinterModalOpen(true)}
                                    className="h-9 px-2.5 text-[10px] text-zinc-700 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded-lg shadow-sm flex items-center justify-center font-medium transition-colors cursor-pointer"
                                    title="Configurar Impresora de Etiquetas"
                                >
                                    ⚙️
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePrintClick}
                                    className="h-9 flex-grow text-[10px] text-white rounded-lg shadow-sm flex items-center justify-center gap-1.5 uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold cursor-pointer"
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
                                                <button type="button" onClick={(e) => { e.stopPropagation(); startEdit(log); }} className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Editar">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                                    </svg>
                                                </button>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(log.id); }} className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors" title="Eliminar">
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
