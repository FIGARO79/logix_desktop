import React, { useEffect, useState, useMemo } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { useLocation } from 'react-router-dom';
import { cacheData, getCachedData } from '../utils/offlineDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { exportExcelFileNative } from '../utils/tauriBridge';
import { getDistinctOperators } from '../utils/tauriApi';

const Reconciliation = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
    const location = useLocation();
    useEffect(() => { setTitle(t('nav.reconciliation', 'Conciliación')); }, [setTitle, t, language]);
    const queryClient = useQueryClient();

    // Filtros de navegación
    const [selectedIR, setSelectedIR] = useState('');
    const [selectedGRN, setSelectedGRN] = useState('');
    const [selectedOperator, setSelectedOperator] = useState('all');
    const [availableOperators, setAvailableOperators] = useState([]);
    const [filterText, setFilterText] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'GRN', direction: 'ascending' });
    const [isOfflineData, setIsOfflineData] = useState(false);
    const [filterOnlyDiff, setFilterOnlyDiff] = useState(false);
    const [filterNoDiff, setFilterNoDiff] = useState(false);

    // Cargar lista de operadores para filtro multi-usuario
    useEffect(() => {
        const loadOps = async () => {
            try {
                const ops = await getDistinctOperators();
                if (ops && Array.isArray(ops)) {
                    setAvailableOperators(ops.filter(Boolean));
                }
            } catch (e) {
                console.warn('Error al cargar operadores:', e);
            }
        };
        loadOps();
    }, []);

    // Estado local para justificaciones y rectificaciones de diferencias por fila (clave: `${IR}_${GRN}_${ItemCode}_${OrderLine}`)
    const [differenceEdits, setDifferenceEdits] = useState({});

    // Modal de Edición de Diferencia individual
    const [editingRow, setEditingRow] = useState(null);
    const [editReason, setEditReason] = useState('');
    const [editComment, setEditComment] = useState('');
    const [editRectifiedQty, setEditRectifiedQty] = useState('');

    // Modal de Guardar Conciliación
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveNotes, setSaveNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

    // Modal de Historial de Conciliaciones Guardadas
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [savedHistoryList, setSavedHistoryList] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [viewingDetail, setViewingDetail] = useState(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);

    // Query para obtener datos de conciliación activa
    const { data: queryData = { data: [] }, isLoading: loading, refetch } = useQuery({
        queryKey: ['reconciliation'],
        queryFn: async () => {
            setIsOfflineData(false);
            // Desktop: always attempt to fetch (localApiBridge handles routing to SQLite)
            try {
                const res = await fetch(`/api/views/reconciliation`).catch(() => null);
                if (res && res.ok) {
                    const response = await res.json().catch(() => null);
                    if (response && response.data) {
                        await cacheData('last_reconciliation', response.data);
                        return response;
                    }
                }
            } catch (e) {
                console.log("Error loading reconciliation data, using local cache.");
            }

            const cachedData = await getCachedData('last_reconciliation');
            if (cachedData) setIsOfflineData(true);
            return { data: cachedData || [] };
        },
        refetchInterval: () => {
            if (location.pathname !== '/reconciliation') return false;
            return 5000;
        },
        refetchOnWindowFocus: true,
        refetchOnMount: 'always',
        staleTime: 0
    });

    useEffect(() => {
        if (typeof BroadcastChannel !== 'undefined') {
            const bc = new BroadcastChannel('logix_events');
            bc.onmessage = (event) => {
                if (event.data?.type === 'INBOUND_MUTATED') {
                    refetch();
                }
            };
            return () => bc.close();
        }
    }, [refetch]);

    // Expandir filas con múltiples GRNs para que cada GRN esté en su propia línea individual
    const rawData = useMemo(() => {
        const raw = queryData?.data || [];
        const result = [];
        raw.forEach(row => {
            const grnStr = String(row.GRN || '').trim();
            if (grnStr && grnStr !== 'SIN GRN' && grnStr !== 'PO EXTRACTOR' && (grnStr.includes(',') || grnStr.includes('/'))) {
                const parts = grnStr.split(/[,\/]/).map(g => g.trim().toUpperCase()).filter(Boolean);
                if (parts.length > 0) {
                    parts.forEach(individualGrn => {
                        result.push({
                            ...row,
                            GRN: individualGrn
                        });
                    });
                } else {
                    result.push(row);
                }
            } else {
                result.push(row);
            }
        });
        return result;
    }, [queryData]);

    // Extraer listas únicas de IR y GRN disponibles para autocompletado y filtros
    const availableIRs = useMemo(() => {
        const set = new Set();
        rawData.forEach(r => {
            if (r.Import_Reference && r.Import_Reference !== 'SIN I.R. MAESTRA') {
                set.add(r.Import_Reference);
            }
        });
        return Array.from(set).sort();
    }, [rawData]);

    const availableGRNs = useMemo(() => {
        const set = new Set();
        rawData.forEach(r => {
            if (selectedIR && r.Import_Reference !== selectedIR) return;
            if (r.GRN && r.GRN !== 'SIN GRN') {
                const parts = String(r.GRN).split(/[,\/]/).map(g => g.trim().toUpperCase()).filter(Boolean);
                parts.forEach(g => set.add(g));
            }
        });
        return Array.from(set).sort();
    }, [rawData, selectedIR]);

    const formatDateShort = (dateStr) => {
        if (!dateStr) return '';
        try {
            let cleanStr = dateStr.trim();
            if (cleanStr.includes(' ') && !cleanStr.includes('T')) {
                cleanStr = cleanStr.replace(' ', 'T');
            }
            const hasTimezone = cleanStr.endsWith('Z') ||
                cleanStr.includes('+') ||
                (cleanStr.includes('T') && cleanStr.split('T')[1].includes('-')) ||
                (!cleanStr.includes('T') && cleanStr.lastIndexOf('-') > 7);

            if (!hasTimezone) {
                cleanStr = cleanStr + 'Z';
            }

            const date = new Date(cleanStr);
            return date.toLocaleString('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch (e) {
            return dateStr;
        }
    };

    // Aplicar ediciones de diferencia sobre los datos antes de filtrar y ordenar
    const processedData = useMemo(() => {
        return rawData.map(row => {
            const rowKey = `${row.Import_Reference}_${row.GRN}_${row.Codigo_Item}_${row.Order_Line || ''}`;
            const edit = differenceEdits[rowKey];

            if (!edit) return row;

            const rectQty = edit.rectified_qty !== undefined && edit.rectified_qty !== '' ? Number(edit.rectified_qty) : row.Cant_Recibida;
            const diff = rectQty - row.Cant_Esperada;

            return {
                ...row,
                Cant_Recibida: rectQty,
                Diferencia: diff,
                Motivo_Diferencia: edit.difference_reason || '',
                Observacion_Operador: edit.operator_comment || '',
                hasCustomEdit: true
            };
        });
    }, [rawData, differenceEdits]);

    // Filtrar por IR seleccionada, GRN seleccionada, Operador y búsqueda en texto
    const filteredBySelectors = useMemo(() => {
        return processedData.filter(item => {
            if (selectedIR && item.Import_Reference !== selectedIR) return false;
            if (selectedGRN && item.GRN !== selectedGRN) return false;
            if (selectedOperator && selectedOperator !== 'all') {
                const op = (item.Usuario || item.user_id || item.Operador || item.Observacion_Operador || '').toLowerCase();
                if (!op.includes(selectedOperator.toLowerCase())) return false;
            }
            return true;
        });
    }, [processedData, selectedIR, selectedGRN, selectedOperator]);

    const sortedData = useMemo(() => {
        let sortableItems = [...filteredBySelectors];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let res = 0;
                let aKey = a[sortConfig.key];
                let bKey = b[sortConfig.key];

                if (sortConfig.key === 'Order_Line') {
                    const aNum = parseInt(aKey, 10) || 0;
                    const bNum = parseInt(bKey, 10) || 0;
                    res = aNum - bNum;
                } else if (typeof aKey === 'number' && typeof bKey === 'number') {
                    res = aKey - bKey;
                } else {
                    aKey = aKey ? aKey.toString().toLowerCase() : '';
                    bKey = bKey ? bKey.toString().toLowerCase() : '';
                    if (aKey < bKey) res = -1;
                    else if (aKey > bKey) res = 1;
                }

                if (sortConfig.direction === 'descending') {
                    res = -res;
                }

                if (res === 0) {
                    const aLine = parseInt(a.Order_Line, 10) || 0;
                    const bLine = parseInt(b.Order_Line, 10) || 0;
                    if (aLine !== bLine) return aLine - bLine;
                    return (a.Codigo_Item || '').localeCompare(b.Codigo_Item || '');
                }

                return res;
            });
        }
        return sortableItems;
    }, [filteredBySelectors, sortConfig]);

    const searchedData = useMemo(() => {
        if (!filterText) return sortedData;
        const searchStr = filterText.toLowerCase();
        return sortedData.filter(item => {
            return Object.entries(item).some(([key, val]) => {
                if (val === null || val === undefined) return false;
                if (key === 'id') return false;
                if (key === 'Timestamp') {
                    return formatDateShort(val).toLowerCase().includes(searchStr);
                }
                return String(val).toLowerCase().includes(searchStr);
            });
        });
    }, [sortedData, filterText]);

    const diffStats = useMemo(() => {
        let withDiff = 0;
        let withoutDiff = 0;
        searchedData.forEach(item => {
            if (Math.abs(item.Diferencia || 0) > 0.0001) {
                withDiff++;
            } else {
                withoutDiff++;
            }
        });
        return { withDiff, withoutDiff };
    }, [searchedData]);

    const finalDisplayData = useMemo(() => {
        if (!filterOnlyDiff && !filterNoDiff) return searchedData;
        return searchedData.filter(item => {
            const hasDiff = Math.abs(item.Diferencia || 0) > 0.0001;
            if (filterOnlyDiff && !hasDiff) return false;
            if (filterNoDiff && hasDiff) return false;
            return true;
        });
    }, [searchedData, filterOnlyDiff, filterNoDiff]);

    // Resumen de la conciliación en pantalla
    const reconciliationSummary = useMemo(() => {
        let totalExp = 0;
        let totalRec = 0;
        let diffLines = 0;
        let justifiedLines = 0;

        finalDisplayData.forEach(r => {
            totalExp += (r.Cant_Esperada || 0);
            totalRec += (r.Cant_Recibida || 0);
            if (Math.abs(r.Diferencia || 0) > 0.0001) {
                diffLines++;
                if (r.Motivo_Diferencia || r.Observacion_Operador) {
                    justifiedLines++;
                }
            }
        });

        return {
            totalLines: finalDisplayData.length,
            totalExp,
            totalRec,
            totalDiff: totalRec - totalExp,
            diffLines,
            justifiedLines
        };
    }, [finalDisplayData]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (name) => {
        if (sortConfig.key !== name) return <span className="ml-1 opacity-30">↕</span>;
        return sortConfig.direction === 'ascending' ? <span className="ml-1">↑</span> : <span className="ml-1">↓</span>;
    };

    const handleExport = async () => {
        const dataToExport = finalDisplayData.length > 0 ? finalDisplayData : (filteredBySelectors.length > 0 ? filteredBySelectors : rawData);
        if (!dataToExport || dataToExport.length === 0) {
            alert("No hay datos cargados para exportar.");
            return;
        }

        const formattedData = dataToExport.map(row => ({
            'Import Ref (I.R.)': row.Import_Reference || '',
            'Waybill': row.Waybill || '',
            'GRN': row.GRN || '',
            'Línea PO': row.Order_Line || '',
            'Código Ítem': row.Codigo_Item || '',
            'Descripción': row.Descripcion || '',
            'Ubicación': row.Ubicacion || '',
            'Reubicado': row.Reubicado || '',
            'Cant. Esperada': row.Cant_Esperada ?? 0,
            'Cant. Recibida': row.Cant_Recibida ?? 0,
            'Diferencia': row.Diferencia ?? 0,
            'Motivo Discrepancia': row.Motivo_Diferencia || '',
            'Observación Operador': row.Observacion_Operador || '',
            'Fecha': row.Timestamp ? formatDateShort(row.Timestamp) : ''
        }));

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Conciliación');

        const prefix = selectedGRN ? `GRN_${selectedGRN}` : (selectedIR ? `IR_${selectedIR}` : 'General');
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `Conciliacion_${prefix}_${dateStr}.xlsx`;

        await exportExcelFileNative(workbook, fileName);
    };

    // Apertura del modal de edición de diferencia
    const handleOpenEditRow = (row) => {
        const rowKey = `${row.Import_Reference}_${row.GRN}_${row.Codigo_Item}_${row.Order_Line || ''}`;
        const existing = differenceEdits[rowKey];

        setEditingRow(row);
        setEditReason(existing?.difference_reason || row.Motivo_Diferencia || '');
        setEditComment(existing?.operator_comment || row.Observacion_Operador || '');
        setEditRectifiedQty(existing?.rectified_qty !== undefined ? String(existing.rectified_qty) : String(row.Cant_Recibida));
    };

    const handleSaveRowEdit = (e) => {
        e.preventDefault();
        if (!editingRow) return;

        const rowKey = `${editingRow.Import_Reference}_${editingRow.GRN}_${editingRow.Codigo_Item}_${editingRow.Order_Line || ''}`;
        const rectNum = editRectifiedQty.trim() !== '' ? parseFloat(editRectifiedQty) : editingRow.Cant_Recibida;

        setDifferenceEdits(prev => ({
            ...prev,
            [rowKey]: {
                difference_reason: editReason.trim(),
                operator_comment: editComment.trim(),
                rectified_qty: isNaN(rectNum) ? editingRow.Cant_Recibida : rectNum
            }
        }));

        setEditingRow(null);
    };

    const handleClearRowEdit = () => {
        if (!editingRow) return;
        const rowKey = `${editingRow.Import_Reference}_${editingRow.GRN}_${editingRow.Codigo_Item}_${editingRow.Order_Line || ''}`;
        setDifferenceEdits(prev => {
            const next = { ...prev };
            delete next[rowKey];
            return next;
        });
        setEditingRow(null);
    };

    // Guardar snapshot de conciliación permanente
    const handleConfirmSaveReconciliation = async () => {
        const targetData = finalDisplayData.length > 0 ? finalDisplayData : filteredBySelectors;
        if (targetData.length === 0) {
            alert("No hay registros filtrados para conciliar y guardar.");
            return;
        }

        setIsSaving(true);
        try {
            const uniqueGRNs = Array.from(new Set(targetData.map(r => r.GRN).filter(Boolean)));
            const uniqueIRs = Array.from(new Set(targetData.map(r => r.Import_Reference).filter(Boolean)));
            const uniqueWBs = Array.from(new Set(targetData.map(r => r.Waybill).filter(Boolean)));

            const grnToSave = selectedGRN || (uniqueGRNs.length === 1 ? uniqueGRNs[0] : (uniqueGRNs.length > 1 ? 'VARIAS' : 'SIN GRN'));
            const irToSave = selectedIR || (uniqueIRs.length === 1 ? uniqueIRs[0] : (uniqueIRs.length > 1 ? 'VARIAS' : 'SIN IR'));
            const wbToSave = uniqueWBs.length === 1 ? uniqueWBs[0] : (uniqueWBs.length > 1 ? 'VARIOS' : '');

            const payload = {
                grn_number: grnToSave,
                import_reference: irToSave,
                waybill: wbToSave,
                items: targetData.map(r => ({
                    grn_number: r.GRN,
                    import_reference: r.Import_Reference,
                    waybill: r.Waybill,
                    order_line: r.Order_Line || '',
                    item_code: r.Codigo_Item,
                    description: r.Descripcion,
                    location: r.Ubicacion,
                    relocated_bin: r.Reubicado,
                    qty_expected: r.Cant_Esperada,
                    qty_received: r.Cant_Recibida,
                    difference: r.Diferencia,
                    difference_reason: r.Motivo_Diferencia || '',
                    operator_comment: r.Observacion_Operador || '',
                })),
                username: 'admin',
                notes: saveNotes.trim()
            };

            const res = await fetch('/api/inbound/save_grn_reconciliation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const dataRes = await res.json();
                setSaveSuccessMsg(`¡Conciliación de GRN ${grnToSave} guardada exitosamente con ID #${dataRes.id}!`);
                setTimeout(() => {
                    setSaveSuccessMsg('');
                    setShowSaveModal(false);
                    setSaveNotes('');
                }, 2000);
            } else {
                const err = await res.json().catch(() => ({}));
                alert(`Error al guardar conciliación: ${err.detail || err.error || 'Error en servidor'}`);
            }
        } catch (e) {
            alert(`Error de conexión al guardar: ${e.message || e}`);
        } finally {
            setIsSaving(false);
        }
    };

    // Cargar historial de fotos guardadas
    const fetchSavedHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch('/api/inbound/saved_grn_reconciliations');
            if (res.ok) {
                const list = await res.json();
                setSavedHistoryList(list || []);
            }
        } catch (e) {
            console.error("Error al cargar historial:", e);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const handleOpenHistory = () => {
        setShowHistoryModal(true);
        fetchSavedHistory();
    };

    const handleViewSavedDetail = async (id) => {
        setIsLoadingDetail(true);
        try {
            const res = await fetch(`/api/inbound/saved_grn_reconciliations/${id}`);
            if (res.ok) {
                const detail = await res.json();
                setViewingDetail(detail);
            }
        } catch (e) {
            alert("Error al cargar detalle de la conciliación");
        } finally {
            setIsLoadingDetail(false);
        }
    };

    const handleDeleteSavedRecon = async (id, grnNum) => {
        if (!confirm(`¿Estás seguro de eliminar el registro histórico de la GRN ${grnNum}?`)) return;
        try {
            const res = await fetch(`/api/inbound/saved_grn_reconciliations/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setSavedHistoryList(prev => prev.filter(item => item.id !== id));
                if (viewingDetail?.header?.id === id) {
                    setViewingDetail(null);
                }
            } else {
                alert("Error al eliminar conciliación");
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    // Exportar detalle de conciliación guardada en el historial
    const handleExportSavedDetail = async (detail) => {
        if (!detail || !detail.items || detail.items.length === 0) {
            alert("No hay ítems para exportar en esta conciliación histórica.");
            return;
        }

        const header = detail.header || {};
        const formattedData = detail.items.map(it => ({
            'Línea PO': it.order_line || '',
            'Código Ítem': it.item_code || '',
            'Descripción': it.description || '',
            'Ubicación': it.location || '',
            'Reubicado': it.relocated_bin || '',
            'Cant. Esperada': it.qty_expected ?? 0,
            'Cant. Recibida': it.qty_received ?? 0,
            'Diferencia': it.difference ?? 0,
            'Motivo Discrepancia': it.difference_reason || '',
            'Observación Operador': it.operator_comment || '',
            'I.R.': it.import_reference || header.import_reference || '',
            'Waybill': it.waybill || header.waybill || '',
            'GRN': it.grn_number || header.grn_number || '',
            'Fecha Guardado': header.reconciled_at ? formatDateShort(header.reconciled_at) : '',
            'Operador': header.reconciled_by || ''
        }));

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `GRN_${header.grn_number || 'Historial'}`);

        const dateStr = (header.reconciled_at || new Date().toISOString()).slice(0, 10);
        const fileName = `Conciliacion_Historica_GRN_${header.grn_number || 'Snapshot'}_${dateStr}.xlsx`;

        await exportExcelFileNative(workbook, fileName);
    };

    const handleExportSavedFromList = async (id) => {
        try {
            const res = await fetch(`/api/inbound/saved_grn_reconciliations/${id}`);
            if (res.ok) {
                const detail = await res.json();
                if (detail) {
                    await handleExportSavedDetail(detail);
                } else {
                    alert("No se encontró el detalle de la conciliación para exportar.");
                }
            } else {
                alert("Error al obtener los datos de la conciliación.");
            }
        } catch (e) {
            console.error("Error al exportar conciliación desde historial:", e);
            alert(`Error al exportar: ${e.message || e}`);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#fcfcfc] text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif] font-normal tracking-normal text-[12px]">
            {/* Barra de Filtros y Acciones */}
            <div className="px-4 py-2 border-b border-[#e5e5e5] bg-white sticky top-0 z-30">
                <div className="flex flex-wrap items-center gap-2 bg-[#f9f9f9] p-2 rounded border border-[#e5e5e5]">
                    
                    {/* Selector de I.R. */}
                    <div className="w-44 flex flex-col">
                        <label className="text-[10px] uppercase text-[#616161] mb-0.5 tracking-normal font-normal">Import Ref (I.R.)</label>
                        <div className="relative">
                            <input
                                list="ir-list"
                                type="text"
                                placeholder="TODAS LAS I.R."
                                value={selectedIR}
                                onChange={(e) => {
                                    setSelectedIR(e.target.value.trim().toUpperCase());
                                    setSelectedGRN(''); // Reset GRN al cambiar IR
                                }}
                                className="w-full h-7 px-2 text-[12px] text-[#1f1f1f] bg-white border border-[#d1d5db] rounded outline-none uppercase focus:border-[#0067c0] font-normal"
                            />
                            <datalist id="ir-list">
                                {availableIRs.map(ir => (
                                    <option key={ir} value={ir} />
                                ))}
                            </datalist>
                        </div>
                    </div>

                    {/* Selector de GRN */}
                    <div className="w-40 flex flex-col">
                        <label className="text-[10px] uppercase text-[#616161] mb-0.5 tracking-normal font-normal">Número de GRN</label>
                        <div className="relative">
                            <input
                                list="grn-list"
                                type="text"
                                placeholder="TODAS LAS GRN"
                                value={selectedGRN}
                                onChange={(e) => setSelectedGRN(e.target.value.trim().toUpperCase())}
                                className="w-full h-7 px-2 text-[12px] text-[#1f1f1f] bg-white border border-[#d1d5db] rounded outline-none uppercase focus:border-[#0067c0] font-normal"
                            />
                            <datalist id="grn-list">
                                {availableGRNs.map(g => (
                                    <option key={g} value={g} />
                                ))}
                            </datalist>
                        </div>
                    </div>

                    {/* Selector de Operador / Usuario (Multi-Usuario en Red) */}
                    <div className="w-44 flex flex-col">
                        <label className="text-[10px] uppercase text-[#616161] mb-0.5 tracking-normal font-normal">Operador / Usuario</label>
                        <select
                            value={selectedOperator}
                            onChange={(e) => setSelectedOperator(e.target.value)}
                            className="w-full h-7 px-2 text-[12px] text-[#1f1f1f] bg-white border border-[#d1d5db] rounded outline-none uppercase focus:border-[#0067c0] font-normal"
                        >
                            <option value="all">TODOS LOS OPERADORES</option>
                            {availableOperators.map(op => (
                                <option key={op} value={op}>{op.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>

                    {/* Búsqueda General */}
                    <div className="flex-1 min-w-[200px] flex flex-col">
                        <label className="text-[10px] uppercase text-[#616161] mb-0.5 tracking-normal font-normal">Búsqueda Rápida</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="BUSCAR ÍTEM, DESCRIPCIÓN, UBICACIÓN..."
                                className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none text-[#1f1f1f] font-normal uppercase tracking-normal focus:border-[#0067c0]"
                                style={{ paddingRight: filterText ? '24px' : '8px' }}
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                            />
                            {filterText && (
                                <button
                                    onClick={() => setFilterText('')}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#707070] hover:text-[#1f1f1f] text-[11px] font-normal cursor-pointer"
                                    title="Limpiar búsqueda"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Botón Limpiar Filtros */}
                    {(selectedIR || selectedGRN || (selectedOperator && selectedOperator !== 'all') || filterText || filterOnlyDiff || filterNoDiff) && (
                        <div className="self-end">
                            <button
                                onClick={() => {
                                    setSelectedIR('');
                                    setSelectedGRN('');
                                    setSelectedOperator('all');
                                    setFilterText('');
                                    setFilterOnlyDiff(false);
                                    setFilterNoDiff(false);
                                }}
                                className="h-7 px-2.5 text-[12px] text-[#1f1f1f] bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded transition-colors font-normal cursor-pointer"
                            >
                                Limpiar
                            </button>
                        </div>
                    )}

                    {/* Acciones Principales */}
                    <div className="flex items-center gap-1.5 ml-auto self-end">
                        {/* Botón Historial Guardado */}
                        <button
                            onClick={handleOpenHistory}
                            className="h-7 px-3 text-[12px] text-[#1f1f1f] bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded shadow-sm flex items-center gap-1.5 font-normal transition-colors cursor-pointer"
                        >
                            Historial Guardado
                        </button>

                        {/* Botón Guardar Conciliación */}
                        <button
                            onClick={() => setShowSaveModal(true)}
                            disabled={filteredBySelectors.length === 0}
                            className="h-7 px-3 text-[12px] text-white rounded shadow-sm flex items-center gap-1.5 font-normal transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[#0067c0] hover:bg-[#005a9e] cursor-pointer"
                        >
                            Guardar Conciliación
                        </button>

                        {/* Botón Exportar */}
                        <button
                            onClick={handleExport}
                            disabled={loading || rawData.length === 0}
                            className="h-7 px-3 text-[12px] text-white rounded shadow-sm flex items-center gap-1.5 font-normal whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors bg-[#354a5f] hover:bg-[#2a3c4e]"
                        >
                            Exportar Excel
                        </button>
                    </div>
                </div>

                {/* Banner de Resumen de Conciliación Seleccionada */}
                <div className="flex flex-wrap items-center gap-4 bg-white px-3 py-1.5 mt-1 rounded border border-[#e5e5e5] text-[11.5px] font-normal text-[#1f1f1f]">
                    <div className="flex items-center gap-1">
                        <span className="text-[#616161]">Líneas:</span>
                        <span>{reconciliationSummary.totalLines}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[#616161]">Cant. Esperada:</span>
                        <span>{reconciliationSummary.totalExp}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[#616161]">Cant. Recibida:</span>
                        <span>{reconciliationSummary.totalRec}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[#616161]">Diferencia Neta:</span>
                        <span className={reconciliationSummary.totalDiff > 0 ? 'text-[#0067c0]' : reconciliationSummary.totalDiff < 0 ? 'text-[#a80000]' : 'text-[#107c41]'}>
                            {reconciliationSummary.totalDiff > 0 ? `+${reconciliationSummary.totalDiff}` : reconciliationSummary.totalDiff}
                        </span>
                    </div>

                    {/* Filtros Rápidos de Diferencias (replicados de logix_react) */}
                    <div className="flex items-center gap-3 border-l border-[#e5e5e5] pl-3">
                        <label htmlFor="filter-only-diff" className="flex items-center gap-1.5 cursor-pointer select-none text-[#1f1f1f] font-normal">
                            <input
                                id="filter-only-diff"
                                type="checkbox"
                                checked={filterOnlyDiff}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFilterOnlyDiff(checked);
                                    if (checked) setFilterNoDiff(false);
                                }}
                                className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#b45309] focus:ring-0 cursor-pointer"
                            />
                            <span className="uppercase text-[10.5px]">Solo Diferencias</span>
                            <span className={`px-1.5 py-0.2 text-[10px] rounded font-normal ${filterOnlyDiff ? 'bg-[#fef3c7] text-[#92400e] border border-[#fde68a]' : 'bg-[#f4f4f5] text-[#52525b] border border-[#e4e4e7]'}`}>
                                {diffStats.withDiff}
                            </span>
                        </label>

                        <label htmlFor="filter-no-diff" className="flex items-center gap-1.5 cursor-pointer select-none text-[#1f1f1f] font-normal">
                            <input
                                id="filter-no-diff"
                                type="checkbox"
                                checked={filterNoDiff}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFilterNoDiff(checked);
                                    if (checked) setFilterOnlyDiff(false);
                                }}
                                className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#047857] focus:ring-0 cursor-pointer"
                            />
                            <span className="uppercase text-[10.5px]">Sin Diferencias</span>
                            <span className={`px-1.5 py-0.2 text-[10px] rounded font-normal ${filterNoDiff ? 'bg-[#d1fae5] text-[#065f46] border border-[#a7f3d0]' : 'bg-[#f4f4f5] text-[#52525b] border border-[#e4e4e7]'}`}>
                                {diffStats.withoutDiff}
                            </span>
                        </label>
                    </div>

                    {reconciliationSummary.diffLines > 0 && (
                        <div className="flex items-center gap-1.5 ml-auto">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-normal bg-[#fff4ce] text-[#794e00] border border-[#fde79a]">
                                {reconciliationSummary.diffLines} línea(s) con discrepancia ({reconciliationSummary.justifiedLines} justificadas)
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Tabla Principal de Conciliación */}
            <div className="flex-1 px-4 py-2 overflow-hidden flex flex-col">
                <div className="bg-white border border-[#e5e7eb] shadow-xs overflow-hidden flex flex-col flex-1">
                    {loading ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-32 text-black text-[12px] font-normal">
                            Cargando datos de conciliación...
                        </div>
                    ) : (
                        <>
                            <div className="overflow-auto max-h-[68vh]">
                                <table className="w-full text-left border-separate border-spacing-0">
                                    <thead className="sticky top-0 z-20">
                                        <tr style={{ background: '#354a5f' }}>
                                            {[
                                                { id: 'Import_Reference', label: 'I.R.' },
                                                { id: 'Waybill', label: 'WAYBILL' },
                                                { id: 'GRN', label: 'GRN' },
                                                { id: 'Order_Line', label: 'LÍNEA PO' },
                                                { id: 'Codigo_Item', label: 'CODIGO ITEM' },
                                                { id: 'Descripcion', label: 'DESCRIPCION' },
                                                { id: 'Ubicacion', label: 'UBICACION' },
                                                { id: 'Reubicado', label: 'REUBICADO' },
                                                { id: 'Cant_Esperada', label: 'CANT ESPERADA' },
                                                { id: 'Cant_Recibida', label: 'CANT RECIBIDA' },
                                                { id: 'Diferencia', label: 'DIFERENCIA' },
                                                { id: 'Motivo', label: 'MOTIVO / OBSERVACION' },
                                                { id: 'Timestamp', label: 'FECHA' },
                                                { id: 'Acciones', label: 'ACCIONES' }
                                            ].map((head) => (
                                                <th
                                                    key={head.id}
                                                    onClick={() => !['Acciones', 'Motivo'].includes(head.id) && requestSort(head.id)}
                                                    className={`px-3 py-2 text-[11px] font-normal text-white/90 ${!['Acciones', 'Motivo'].includes(head.id) ? 'cursor-pointer select-none' : ''} whitespace-nowrap uppercase tracking-normal transition-colors`}
                                                    style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}
                                                    onMouseEnter={e => !['Acciones', 'Motivo'].includes(head.id) && (e.currentTarget.style.background = '#2a3c4e')}
                                                    onMouseLeave={e => !['Acciones', 'Motivo'].includes(head.id) && (e.currentTarget.style.background = '')}
                                                >
                                                    <div className="flex items-center gap-1 justify-center">
                                                        {head.label}
                                                        {!['Acciones', 'Motivo'].includes(head.id) && getSortIcon(head.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {finalDisplayData.length > 0 ? (
                                            finalDisplayData.map((row, idx) => {
                                                const hasDiff = Math.abs(row.Diferencia || 0) > 0.0001;
                                                const hasEdit = !!(row.Motivo_Diferencia || row.Observacion_Operador || row.hasCustomEdit);

                                                return (
                                                    <tr
                                                         key={idx}
                                                         className="transition-colors hover:z-10 relative font-normal text-[11.5px]"
                                                         style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}
                                                         onMouseEnter={e => e.currentTarget.style.background = '#edf3f9'}
                                                         onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fafafa'}
                                                     >
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Import_Reference}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Waybill}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.GRN}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-[#1f1f1f] text-center font-normal" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                             {row.Order_Line && row.Order_Line !== '-' ? row.Order_Line : <span className="text-[#a1a1aa]">-</span>}
                                                         </td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap tracking-normal text-[#0067c0]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Codigo_Item}</td>
                                                         <td className="px-3 py-1.5 truncate max-w-[260px] text-[#1f1f1f] tracking-normal" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Descripcion}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Ubicacion || '-'}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Reubicado || '-'}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-center text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Cant_Esperada}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-center text-[#1f1f1f]" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Cant_Recibida}</td>
                                                         <td className="px-3 py-1.5 whitespace-nowrap text-center" style={{ borderBottom: '1px solid #f1f1f1', color: row.Diferencia > 0 ? '#0067c0' : row.Diferencia < 0 ? '#a80000' : '#1f1f1f' }}>
                                                             {row.Diferencia > 0 ? `+${row.Diferencia}` : row.Diferencia}
                                                         </td>
                                                         <td className="px-3 py-1.5 max-w-[200px] truncate text-[#616161]" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                             {row.Motivo_Diferencia ? (
                                                                 <span className="inline-flex items-center text-[11px] bg-[#f0f7ff] text-[#0067c0] px-1.5 py-0.5 rounded border border-[#cce4ff]">
                                                                     <span className="truncate">{row.Motivo_Diferencia}</span>
                                                                 </span>
                                                             ) : (
                                                                 <span className="text-[#a1a1aa]">-</span>
                                                             )}
                                                         </td>
                                                         <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-[#616161]" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                             {formatDateShort(row.Timestamp)}
                                                         </td>
                                                         <td className="px-2 py-1.5 text-[11.5px] whitespace-nowrap text-center" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                             <button
                                                                 onClick={() => handleOpenEditRow(row)}
                                                                 className={`h-6 px-2 text-[11px] rounded flex items-center justify-center font-normal transition-colors cursor-pointer ${hasDiff || hasEdit ? 'bg-[#fff4ce] text-[#794e00] hover:bg-[#fde79a] border border-[#fde79a]' : 'bg-white text-[#1f1f1f] hover:bg-[#f5f5f5] border border-[#d1d5db]'}`}
                                                             >
                                                                 <span>{hasEdit ? 'Justificado' : 'Editar'}</span>
                                                             </button>
                                                         </td>
                                                     </tr>
                                                 );
                                             })
                                         ) : (
                                             <tr>
                                                 <td colSpan={14} className="px-4 py-20 text-center text-[#707070] text-[11.5px] font-normal">
                                                     No se encontraron registros para los filtros seleccionados
                                                 </td>
                                             </tr>
                                         )}
                                     </tbody>
                                 </table>
                             </div>

                             {/* Footer de estado */}
                             <div className="flex items-center gap-3 px-4 py-2 border-t border-[#e5e5e5] bg-white text-[11px] text-[#616161] font-normal">
                                 <span>Mostrando <span className="text-[#1f1f1f]">{finalDisplayData.length}</span> de <span className="text-[#1f1f1f]">{rawData.length}</span> registros totales</span>
                                 {!isOfflineData ? (
                                     <span className="flex items-center gap-1">
                                         <span className="w-1.5 h-1.5 rounded-full bg-[#107c41] inline-block"></span>
                                         Datos en tiempo real
                                     </span>
                                 ) : (
                                     <span className="flex items-center gap-1">
                                         <span className="w-1.5 h-1.5 rounded-full bg-[#d83b01] inline-block"></span>
                                         Datos sin conexión
                                     </span>
                                 )}
                             </div>
                        </>
                    )}
                </div>
            </div>

            {/* MODAL 1: Justificar / Editar Diferencia de Ítem */}
            {editingRow && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
                    <div className="bg-white rounded shadow-lg max-w-lg w-full overflow-hidden border border-[#d1d5db] font-['Segoe_UI',Tahoma,sans-serif]">
                        <div className="px-4 py-2 border-b border-[#2a3c4d] flex items-center justify-between bg-[#354a5f]">
                            <div className="flex items-center gap-2">
                                <h3 className="text-[12px] font-normal text-white uppercase tracking-normal">
                                    Conciliar / Editar Diferencia de Ítem
                                </h3>
                            </div>
                            <button
                                onClick={() => setEditingRow(null)}
                                className="text-white hover:text-gray-200 text-sm font-normal cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveRowEdit} className="p-4 space-y-3 text-[12px] font-normal">
                            {/* Resumen del Ítem */}
                            <div className="bg-[#fafafa] p-2.5 rounded border border-[#e5e5e5] grid grid-cols-2 gap-2 text-[11.5px]">
                                <div>
                                    <span className="text-[#616161] block text-[10px] uppercase">Ítem:</span>
                                    <span className="text-[#0067c0] text-[12px] font-normal">{editingRow.Codigo_Item}</span>
                                </div>
                                <div>
                                    <span className="text-[#616161] block text-[10px] uppercase">Línea 280 / PO:</span>
                                    <span className="text-[#1f1f1f]">{editingRow.Order_Line || '-'}</span>
                                </div>
                                <div className="col-span-2">
                                    <span className="text-[#616161] block text-[10px] uppercase">Descripción:</span>
                                    <span className="text-[#1f1f1f]">{editingRow.Descripcion}</span>
                                </div>
                                <div>
                                    <span className="text-[#616161] block text-[10px] uppercase">GRN:</span>
                                    <span className="text-[#1f1f1f]">{editingRow.GRN}</span>
                                </div>
                                <div>
                                    <span className="text-[#616161] block text-[10px] uppercase">I.R. / Waybill:</span>
                                    <span className="text-[#1f1f1f]">{editingRow.Import_Reference} / {editingRow.Waybill}</span>
                                </div>
                            </div>

                            {/* Comparación de Cantidades */}
                            <div className="grid grid-cols-3 gap-2 bg-[#f0f7ff] p-2.5 rounded border border-[#cce4ff] text-center">
                                <div>
                                    <span className="text-[#0067c0] block text-[10px] uppercase">Esperada</span>
                                    <span className="text-[13px] text-[#1f1f1f]">{editingRow.Cant_Esperada}</span>
                                </div>
                                <div>
                                    <span className="text-[#0067c0] block text-[10px] uppercase">Recibida Actual</span>
                                    <span className="text-[13px] text-[#1f1f1f]">{editingRow.Cant_Recibida}</span>
                                </div>
                                <div>
                                    <span className="text-[#0067c0] block text-[10px] uppercase">Diferencia</span>
                                    <span className={`text-[13px] ${editingRow.Diferencia > 0 ? 'text-[#0067c0]' : editingRow.Diferencia < 0 ? 'text-[#a80000]' : 'text-[#107c41]'}`}>
                                        {editingRow.Diferencia > 0 ? `+${editingRow.Diferencia}` : editingRow.Diferencia}
                                    </span>
                                </div>
                            </div>

                            {/* Campo de Rectificación de Cantidad */}
                            <div>
                                <label className="block text-[10px] uppercase text-[#616161] mb-1">
                                    Cantidad Recibida Confirmada / Rectificada:
                                </label>
                                <input
                                    type="number"
                                    step="any"
                                    value={editRectifiedQty}
                                    onChange={(e) => setEditRectifiedQty(e.target.value)}
                                    className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none font-normal focus:border-[#0067c0]"
                                />
                                <span className="text-[10.5px] text-[#616161] mt-0.5 block">
                                    Ajuste este valor si se realizó un reconteo físico directo del ítem.
                                </span>
                            </div>

                            {/* Selector de Motivo de Diferencia */}
                            <div>
                                <label className="block text-[10px] uppercase text-[#616161] mb-1">
                                    Motivo de la Discrepancia:
                                </label>
                                <select
                                    value={editReason}
                                    onChange={(e) => setEditReason(e.target.value)}
                                    className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none font-normal focus:border-[#0067c0]"
                                >
                                    <option value="">-- Seleccionar Motivo --</option>
                                    <option value="Sin Diferencia / Conforme">Sin Diferencia / Conforme</option>
                                    <option value="Faltante en Origen / Proveedor">Faltante en Origen / Proveedor</option>
                                    <option value="Sobrante en Envío">Sobrante en Envío</option>
                                    <option value="Mercancía Dañada / Rechazada">Mercancía Dañada / Rechazada</option>
                                    <option value="Error de Conteo Físico Rectificado">Error de Conteo Físico Rectificado</option>
                                    <option value="Ítem Trocado / No Corresponde">Ítem Trocado / No Corresponde</option>
                                    <option value="Diferencia Aceptada por Operador">Diferencia Aceptada por Operador</option>
                                    <option value="Otro Motivo">Otro Motivo</option>
                                </select>
                            </div>

                            {/* Campo de Observaciones */}
                            <div>
                                <label className="block text-[10px] uppercase text-[#616161] mb-1">
                                    Observación / Justificación del Operador:
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Detalle o nota explicativa para la auditoría..."
                                    value={editComment}
                                    onChange={(e) => setEditComment(e.target.value)}
                                    className="w-full p-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none font-normal focus:border-[#0067c0]"
                                />
                            </div>

                            {/* Botones de Acción */}
                            <div className="flex items-center justify-between pt-2 border-t border-[#e5e5e5]">
                                <button
                                    type="button"
                                    onClick={handleClearRowEdit}
                                    className="h-7 px-2.5 text-[11px] font-normal text-[#a80000] bg-white hover:bg-[#fef2f2] border border-[#fecaca] rounded transition-colors cursor-pointer"
                                >
                                    Restablecer Original
                                </button>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setEditingRow(null)}
                                        className="h-7 px-3 text-[12px] font-normal text-[#1f1f1f] bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded transition-colors cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="h-7 px-3 text-[12px] font-normal text-white rounded bg-[#0067c0] hover:bg-[#005a9e] transition-colors cursor-pointer"
                                    >
                                        Guardar Justificación
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL 2: Guardar Conciliación Snapshot en BD */}
            {showSaveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
                    <div className="bg-white rounded shadow-lg max-w-md w-full overflow-hidden border border-[#d1d5db] font-['Segoe_UI',Tahoma,sans-serif]">
                        <div className="px-4 py-2 border-b border-[#2a3c4d] flex items-center justify-between bg-[#354a5f]">
                            <div className="flex items-center gap-2">
                                <h3 className="text-[12px] font-normal text-white uppercase tracking-normal">
                                    Guardar Conciliación Permanente
                                </h3>
                            </div>
                            <button
                                onClick={() => setShowSaveModal(false)}
                                className="text-white hover:text-gray-200 text-sm font-normal cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-4 space-y-3 text-[12px] font-normal">
                            {saveSuccessMsg ? (
                                <div className="bg-[#f0fdf4] text-[#166534] p-3 rounded border border-[#bbf7d0] text-center font-normal">
                                    <p>{saveSuccessMsg}</p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-[#616161] text-[11.5px]">
                                        Se guardará un registro histórico completo de la conciliación en la base de datos local. Aunque se modifique el archivo 280, estos registros permanecerán intactos para auditoría.
                                    </p>

                                    {/* Resumen a Guardar */}
                                    <div className="bg-[#fafafa] p-2.5 rounded border border-[#e5e5e5] space-y-1 text-[11.5px]">
                                        <div className="flex justify-between">
                                            <span className="text-[#616161] uppercase text-[10px]">GRN a Conciliar:</span>
                                            <span className="text-[#1f1f1f]">{selectedGRN || 'TODAS LAS VISIBLES'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[#616161] uppercase text-[10px]">Import Reference:</span>
                                            <span className="text-[#1f1f1f]">{selectedIR || 'TODAS LAS VISIBLES'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[#616161] uppercase text-[10px]">Total Líneas:</span>
                                            <span className="text-[#1f1f1f]">{reconciliationSummary.totalLines}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[#616161] uppercase text-[10px]">Cant. Esperada:</span>
                                            <span className="text-[#1f1f1f]">{reconciliationSummary.totalExp}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[#616161] uppercase text-[10px]">Cant. Recibida:</span>
                                            <span className="text-[#1f1f1f]">{reconciliationSummary.totalRec}</span>
                                        </div>
                                        <div className="flex justify-between border-t border-[#e5e5e5] pt-1">
                                            <span className="text-[#616161] uppercase text-[10px]">Diferencia Neta:</span>
                                            <span className={reconciliationSummary.totalDiff > 0 ? 'text-[#0067c0]' : reconciliationSummary.totalDiff < 0 ? 'text-[#a80000]' : 'text-[#107c41]'}>
                                                {reconciliationSummary.totalDiff > 0 ? `+${reconciliationSummary.totalDiff}` : reconciliationSummary.totalDiff}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Campo de Notas */}
                                    <div>
                                        <label className="block text-[10px] uppercase text-[#616161] mb-1">
                                            Notas Generales de la Conciliación (Opcional):
                                        </label>
                                        <textarea
                                            rows={2}
                                            placeholder="Observaciones de cierre, número de acta, etc..."
                                            value={saveNotes}
                                            onChange={(e) => setSaveNotes(e.target.value)}
                                            className="w-full p-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none font-normal focus:border-[#0067c0]"
                                        />
                                    </div>

                                    {/* Botones */}
                                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e5e5]">
                                        <button
                                            type="button"
                                            onClick={() => setShowSaveModal(false)}
                                            className="h-7 px-3 text-[12px] font-normal text-[#1f1f1f] bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded transition-colors cursor-pointer"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleConfirmSaveReconciliation}
                                            disabled={isSaving}
                                            className="h-7 px-3 text-[12px] font-normal text-white rounded bg-[#0067c0] hover:bg-[#005a9e] transition-colors disabled:opacity-50 cursor-pointer"
                                        >
                                            {isSaving ? 'Guardando...' : 'Confirmar y Guardar'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL 3: Historial de Conciliaciones Guardadas */}
            {showHistoryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
                    <div className="bg-white rounded shadow-lg max-w-4xl w-full max-h-[85vh] overflow-hidden border border-[#d1d5db] flex flex-col font-['Segoe_UI',Tahoma,sans-serif]">
                        <div className="px-4 py-2 border-b border-[#2a3c4d] flex items-center justify-between bg-[#354a5f]">
                            <div className="flex items-center gap-2">
                                <h3 className="text-[12px] font-normal text-white uppercase tracking-normal">
                                    Historial de Conciliaciones Guardadas (SQLite)
                                </h3>
                            </div>
                            <button
                                onClick={() => {
                                    setShowHistoryModal(false);
                                    setViewingDetail(null);
                                }}
                                className="text-white hover:text-gray-200 text-sm font-normal cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-4 flex-1 overflow-auto text-[12px] font-normal">
                            {viewingDetail ? (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
                                        <div>
                                            <button
                                                onClick={() => setViewingDetail(null)}
                                                className="text-[11.5px] font-normal text-[#0067c0] hover:underline flex items-center gap-1 mb-1 cursor-pointer"
                                            >
                                                ← Volver al listado
                                            </button>
                                            <h4 className="text-[12px] font-normal text-[#1f1f1f]">
                                                Conciliación GRN: {viewingDetail.header.grn_number} (IR: {viewingDetail.header.import_reference})
                                            </h4>
                                            <p className="text-[10.5px] text-[#616161]">
                                                Fecha: {formatDateShort(viewingDetail.header.reconciled_at)} | Operador: {viewingDetail.header.reconciled_by}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded text-[11px] font-normal ${viewingDetail.header.status === 'CONCILIADO_OK' ? 'bg-[#dff6dd] text-[#107c41] border border-[#a1e59e]' : 'bg-[#fff4ce] text-[#794e00] border border-[#fde79a]'}`}>
                                                {viewingDetail.header.status}
                                            </span>
                                            <button
                                                onClick={() => handleExportSavedDetail(viewingDetail)}
                                                className="h-7 px-3 text-[11.5px] font-normal text-white rounded bg-[#354a5f] hover:bg-[#2a3c4e] transition-colors flex items-center gap-1 cursor-pointer"
                                                title="Exportar esta conciliación a Excel"
                                            >
                                                Exportar Excel
                                            </button>
                                        </div>
                                    </div>

                                    {/* Tabla de ítems guardados en la foto */}
                                    <div className="overflow-auto max-h-[50vh] border border-[#e5e5e5] rounded">
                                        <table className="w-full text-left text-[11.5px]">
                                            <thead className="bg-[#354a5f] text-white font-normal sticky top-0 text-[11px]">
                                                <tr>
                                                    <th className="px-2 py-1.5 font-normal">Línea</th>
                                                    <th className="px-2 py-1.5 font-normal">Ítem</th>
                                                    <th className="px-2 py-1.5 font-normal">Descripción</th>
                                                    <th className="px-2 py-1.5 font-normal">Ubicación</th>
                                                    <th className="px-2 py-1.5 text-center font-normal">Esperada</th>
                                                    <th className="px-2 py-1.5 text-center font-normal">Recibida</th>
                                                    <th className="px-2 py-1.5 text-center font-normal">Diferencia</th>
                                                    <th className="px-2 py-1.5 font-normal">Motivo / Justificación</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#f1f1f1]">
                                                {viewingDetail.items.map((it, i) => (
                                                    <tr key={i} className="hover:bg-[#f9f9f9]">
                                                        <td className="px-2 py-1.5 text-center">{it.order_line || '-'}</td>
                                                        <td className="px-2 py-1.5 text-[#0067c0]">{it.item_code}</td>
                                                        <td className="px-2 py-1.5 truncate max-w-[200px]">{it.description}</td>
                                                        <td className="px-2 py-1.5">{it.location || '-'}</td>
                                                        <td className="px-2 py-1.5 text-center">{it.qty_expected}</td>
                                                        <td className="px-2 py-1.5 text-center">{it.qty_received}</td>
                                                        <td className={`px-2 py-1.5 text-center ${it.difference > 0 ? 'text-[#0067c0]' : it.difference < 0 ? 'text-[#a80000]' : 'text-[#1f1f1f]'}`}>
                                                            {it.difference > 0 ? `+${it.difference}` : it.difference}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-[10.5px] text-[#616161]">
                                                            {it.difference_reason && <span className="text-[#1f1f1f] block">{it.difference_reason}</span>}
                                                            {it.operator_comment && <span>{it.operator_comment}</span>}
                                                            {!it.difference_reason && !it.operator_comment && <span className="text-[#a1a1aa]">-</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {isLoadingHistory ? (
                                        <div className="py-16 text-center text-[#707070] text-[12px] font-normal">
                                            Cargando historial de conciliaciones...
                                        </div>
                                    ) : savedHistoryList.length > 0 ? (
                                        <div className="overflow-auto max-h-[60vh] border border-[#e5e5e5] rounded">
                                            <table className="w-full text-left text-[11.5px]">
                                                <thead className="bg-[#354a5f] text-white font-normal sticky top-0 text-[11px]">
                                                    <tr>
                                                        <th className="px-3 py-1.5 font-normal">ID</th>
                                                        <th className="px-3 py-1.5 font-normal">GRN</th>
                                                        <th className="px-3 py-1.5 font-normal">I.R.</th>
                                                        <th className="px-3 py-1.5 font-normal">Fecha Guardado</th>
                                                        <th className="px-3 py-1.5 font-normal">Operador</th>
                                                        <th className="px-3 py-1.5 text-center font-normal">Líneas</th>
                                                        <th className="px-3 py-1.5 text-center font-normal">Esperada</th>
                                                        <th className="px-3 py-1.5 text-center font-normal">Recibida</th>
                                                        <th className="px-3 py-1.5 text-center font-normal">Diferencia</th>
                                                        <th className="px-3 py-1.5 text-center font-normal">Estado</th>
                                                        <th className="px-3 py-1.5 text-center font-normal">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-[#f1f1f1]">
                                                    {savedHistoryList.map((rec) => (
                                                        <tr key={rec.id} className="hover:bg-[#f9f9f9]">
                                                            <td className="px-3 py-1.5 font-mono text-[#616161]">#{rec.id}</td>
                                                            <td className="px-3 py-1.5 text-[#1f1f1f]">{rec.grn_number}</td>
                                                            <td className="px-3 py-1.5 text-[#1f1f1f]">{rec.import_reference}</td>
                                                            <td className="px-3 py-1.5 text-[#616161]">{formatDateShort(rec.reconciled_at)}</td>
                                                            <td className="px-3 py-1.5 text-[#616161]">{rec.reconciled_by}</td>
                                                            <td className="px-3 py-1.5 text-center">{rec.total_lines}</td>
                                                            <td className="px-3 py-1.5 text-center">{rec.total_expected}</td>
                                                            <td className="px-3 py-1.5 text-center">{rec.total_received}</td>
                                                            <td className={`px-3 py-1.5 text-center ${rec.total_difference > 0 ? 'text-[#0067c0]' : rec.total_difference < 0 ? 'text-[#a80000]' : 'text-[#107c41]'}`}>
                                                                {rec.total_difference > 0 ? `+${rec.total_difference}` : rec.total_difference}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-normal ${rec.status === 'CONCILIADO_OK' ? 'bg-[#dff6dd] text-[#107c41] border border-[#a1e59e]' : 'bg-[#fff4ce] text-[#794e00] border border-[#fde79a]'}`}>
                                                                    {rec.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-1.5 text-center space-x-1 whitespace-nowrap">
                                                                <button
                                                                    onClick={() => handleViewSavedDetail(rec.id)}
                                                                    className="h-6 px-2 text-[11px] font-normal text-white rounded bg-[#0067c0] hover:bg-[#005a9e] cursor-pointer transition-colors"
                                                                >
                                                                    Ver Detalle
                                                                </button>
                                                                <button
                                                                    onClick={() => handleExportSavedFromList(rec.id)}
                                                                    className="h-6 px-2 text-[11px] font-normal text-[#107c41] bg-white hover:bg-[#f0fdf4] border border-[#a1e59e] rounded cursor-pointer transition-colors"
                                                                    title="Exportar esta conciliación histórica a Excel"
                                                                >
                                                                    Exportar
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteSavedRecon(rec.id, rec.grn_number)}
                                                                    className="h-6 px-2 text-[11px] font-normal text-[#a80000] hover:bg-[#fef2f2] border border-[#fecaca] rounded cursor-pointer transition-colors"
                                                                    title="Eliminar"
                                                                >
                                                                    Eliminar
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="py-16 text-center text-[#707070] text-[12px] font-normal">
                                            No hay conciliaciones guardadas permanentemente aún.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Reconciliation;
