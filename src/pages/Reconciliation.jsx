import React, { useEffect, useState, useMemo } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { useLocation } from 'react-router-dom';
import { cacheData, getCachedData } from '../utils/offlineDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { exportExcelFileNative } from '../utils/tauriBridge';

const Reconciliation = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
    const location = useLocation();
    useEffect(() => { setTitle(t('nav.reconciliation', 'Conciliación')); }, [setTitle, t, language]);
    const queryClient = useQueryClient();

    // Filtros de navegación
    const [selectedIR, setSelectedIR] = useState('');
    const [selectedGRN, setSelectedGRN] = useState('');
    const [filterText, setFilterText] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'GRN', direction: 'ascending' });
    const [isOfflineData, setIsOfflineData] = useState(false);

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

    const rawData = useMemo(() => queryData?.data || [], [queryData]);

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
                set.add(r.GRN);
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

    // Filtrar por IR seleccionada, GRN seleccionada y búsqueda en texto
    const filteredBySelectors = useMemo(() => {
        return processedData.filter(item => {
            if (selectedIR && item.Import_Reference !== selectedIR) return false;
            if (selectedGRN && item.GRN !== selectedGRN) return false;
            return true;
        });
    }, [processedData, selectedIR, selectedGRN]);

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

    const finalDisplayData = useMemo(() => {
        return sortedData.filter(item => {
            if (!filterText) return true;
            const searchStr = filterText.toLowerCase();
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
        <div className="flex flex-col h-full bg-[#fcfcfc] text-zinc-900 font-sans font-normal">
            {/* Barra de Filtros y Acciones */}
            <div className="px-4 pt-2 pb-2 border-b border-zinc-100 bg-white/80 backdrop-blur-md sticky top-0 z-30">
                <div className="flex flex-wrap items-center gap-2 bg-zinc-50/50 p-2 rounded-xl border border-zinc-100">
                    
                    {/* Selector de I.R. */}
                    <div className="w-44 flex flex-col">
                        <label className="text-[9px] uppercase font-semibold text-zinc-500 mb-0.5 tracking-tight">Import Ref (I.R.)</label>
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
                                className="w-full h-8 px-2 text-[11px] text-zinc-900 font-medium bg-white border border-zinc-200 rounded-lg outline-none uppercase focus:border-[#285f94]"
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
                        <label className="text-[9px] uppercase font-semibold text-zinc-500 mb-0.5 tracking-tight">Número de GRN</label>
                        <div className="relative">
                            <input
                                list="grn-list"
                                type="text"
                                placeholder="TODAS LAS GRN"
                                value={selectedGRN}
                                onChange={(e) => setSelectedGRN(e.target.value.trim().toUpperCase())}
                                className="w-full h-8 px-2 text-[11px] text-zinc-900 font-medium bg-white border border-zinc-200 rounded-lg outline-none uppercase focus:border-[#285f94]"
                            />
                            <datalist id="grn-list">
                                {availableGRNs.map(g => (
                                    <option key={g} value={g} />
                                ))}
                            </datalist>
                        </div>
                    </div>

                    {/* Búsqueda General */}
                    <div className="flex-1 min-w-[200px] flex flex-col">
                        <label className="text-[9px] uppercase font-semibold text-zinc-500 mb-0.5 tracking-tight">Búsqueda Rápida</label>
                        <div className="relative">
                            <span style={{
                                position: 'absolute',
                                left: '8px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                pointerEvents: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                color: '#a1a1aa',
                                zIndex: 2
                            }}>
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </span>
                            <input
                                type="text"
                                placeholder="BUSCAR ÍTEM, DESCRIPCIÓN, UBICACIÓN..."
                                className="w-full h-8 text-[11px] bg-white border border-zinc-200 rounded-lg outline-none text-zinc-900 font-normal uppercase tracking-wider"
                                style={{ paddingLeft: '28px', paddingRight: filterText ? '28px' : '10px' }}
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                            />
                            {filterText && (
                                <button
                                    onClick={() => setFilterText('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-600 flex items-center justify-center text-[10px]"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Botón Limpiar Filtros */}
                    {(selectedIR || selectedGRN || filterText) && (
                        <div className="self-end">
                            <button
                                onClick={() => {
                                    setSelectedIR('');
                                    setSelectedGRN('');
                                    setFilterText('');
                                }}
                                className="h-8 px-2.5 text-[11px] text-zinc-600 bg-zinc-200 hover:bg-zinc-300 rounded-lg transition-colors font-medium active:scale-95 flex items-center justify-center"
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
                            className="h-8 px-3 text-[11px] text-zinc-700 bg-white border border-zinc-200 rounded-lg shadow-sm flex items-center gap-1.5 uppercase font-medium active:scale-95 hover:bg-zinc-50 transition-colors"
                        >
                            📁 Historial Guardado
                        </button>

                        {/* Botón Guardar Conciliación */}
                        <button
                            onClick={() => setShowSaveModal(true)}
                            disabled={filteredBySelectors.length === 0}
                            className="h-8 px-3.5 text-[11px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase font-medium active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700"
                        >
                            💾 Guardar Conciliación
                        </button>

                        {/* Botón Exportar */}
                        <button
                            onClick={handleExport}
                            disabled={loading || rawData.length === 0}
                            className="h-8 px-3 text-[11px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase font-medium active:scale-95 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            style={{ background: '#285f94' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#1e4a74'}
                            onMouseLeave={e => e.currentTarget.style.background = '#285f94'}
                        >
                            📊 Exportar Excel
                        </button>
                    </div>
                </div>

                {/* Banner de Resumen de Conciliación Seleccionada */}
                <div className="flex flex-wrap items-center gap-4 bg-white px-3 py-1.5 mt-1 rounded-lg border border-zinc-200/80 text-[11px]">
                    <div className="flex items-center gap-1">
                        <span className="text-zinc-400 uppercase">Líneas:</span>
                        <span className="font-semibold text-zinc-800">{reconciliationSummary.totalLines}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-zinc-400 uppercase">Cant. Esperada:</span>
                        <span className="font-semibold text-zinc-800">{reconciliationSummary.totalExp}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-zinc-400 uppercase">Cant. Recibida:</span>
                        <span className="font-semibold text-zinc-800">{reconciliationSummary.totalRec}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-zinc-400 uppercase">Diferencia Neta:</span>
                        <span className={`font-semibold ${reconciliationSummary.totalDiff > 0 ? 'text-blue-600' : reconciliationSummary.totalDiff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {reconciliationSummary.totalDiff > 0 ? `+${reconciliationSummary.totalDiff}` : reconciliationSummary.totalDiff}
                        </span>
                    </div>
                    {reconciliationSummary.diffLines > 0 && (
                        <div className="flex items-center gap-1.5 ml-auto">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                ⚠️ {reconciliationSummary.diffLines} línea(s) con discrepancia ({reconciliationSummary.justifiedLines} justificadas)
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Tabla Principal de Conciliación */}
            <div className="flex-1 px-4 py-2 overflow-hidden flex flex-col">
                <div className="bg-white border border-zinc-200 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col flex-1">
                    {loading ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-32 text-zinc-400 text-sm font-normal">
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
                                                { id: 'Order_Line', label: 'LÍNEA' },
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
                                                        className="transition-colors hover:z-10 relative"
                                                        style={{ background: idx % 2 === 0 ? '#fff' : '#fcfcfc' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                                                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fcfcfc'}
                                                    >
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Import_Reference}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Waybill}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap font-medium text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.GRN}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-zinc-900 text-center" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Order_Line || '-'}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap font-medium tracking-tight" style={{ borderBottom: '1px solid #f1f1f1', color: '#1e4a74' }}>{row.Codigo_Item}</td>
                                                        <td className="px-3 py-1.5 text-[11px] truncate max-w-[260px] text-zinc-900 tracking-tight" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Descripcion}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Ubicacion || '-'}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Reubicado || '-'}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-center font-medium text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Cant_Esperada}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-center font-medium text-zinc-900" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Cant_Recibida}</td>
                                                        <td className="px-3 py-1.5 text-[11px] whitespace-nowrap text-center font-semibold" style={{ borderBottom: '1px solid #f1f1f1', color: row.Diferencia > 0 ? '#1e4a74' : row.Diferencia < 0 ? '#dc2626' : '#18181b' }}>
                                                            {row.Diferencia > 0 ? `+${row.Diferencia}` : row.Diferencia}
                                                        </td>
                                                        <td className="px-3 py-1.5 text-[11px] max-w-[200px] truncate text-zinc-700" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                            {row.Motivo_Diferencia ? (
                                                                <span className="inline-flex items-center gap-1 text-[10px] bg-sky-50 text-sky-800 px-1.5 py-0.5 rounded border border-sky-200">
                                                                    <span>🏷️</span>
                                                                    <span className="truncate">{row.Motivo_Diferencia}</span>
                                                                </span>
                                                            ) : (
                                                                <span className="text-zinc-400">-</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-1.5 text-[10px] whitespace-nowrap text-zinc-600" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                            {formatDateShort(row.Timestamp)}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-center" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                            <button
                                                                onClick={() => handleOpenEditRow(row)}
                                                                className={`h-6 px-2 text-[10px] rounded flex items-center gap-1 font-medium transition-colors ${hasDiff || hasEdit ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}
                                                            >
                                                                <span>📝</span>
                                                                <span>{hasEdit ? 'Justificado' : 'Editar'}</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr>
                                                <td colSpan={14} className="px-4 py-20 text-center text-zinc-400 text-[11px]">
                                                    No se encontraron registros para los filtros seleccionados
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Footer de estado */}
                            <div className="flex items-center gap-3 px-4 py-2 border-t border-zinc-100 bg-white text-[10px] text-zinc-500">
                                <span>Mostrando <span className="font-medium text-zinc-700">{finalDisplayData.length}</span> de <span className="font-medium text-zinc-700">{rawData.length}</span> registros totales</span>
                                {!isOfflineData ? (
                                    <span className="flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                                        Datos en tiempo real
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-zinc-200">
                        <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between" style={{ background: '#354a5f' }}>
                            <div className="flex items-center gap-2">
                                <span className="text-white text-base">📝</span>
                                <h3 className="text-[13px] font-semibold text-white uppercase tracking-tight">
                                    Conciliar / Editar Diferencia de Ítem
                                </h3>
                            </div>
                            <button
                                onClick={() => setEditingRow(null)}
                                className="text-white/80 hover:text-white text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveRowEdit} className="p-5 space-y-4 text-[11px]">
                            {/* Resumen del Ítem */}
                            <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200 grid grid-cols-2 gap-2">
                                <div>
                                    <span className="text-zinc-500 block text-[9px] uppercase font-semibold">Ítem:</span>
                                    <span className="font-bold text-[#1e4a74] text-[12px]">{editingRow.Codigo_Item}</span>
                                </div>
                                <div>
                                    <span className="text-zinc-500 block text-[9px] uppercase font-semibold">Línea 280 / PO:</span>
                                    <span className="font-semibold text-zinc-800">{editingRow.Order_Line || '-'}</span>
                                </div>
                                <div className="col-span-2">
                                    <span className="text-zinc-500 block text-[9px] uppercase font-semibold">Descripción:</span>
                                    <span className="text-zinc-800">{editingRow.Descripcion}</span>
                                </div>
                                <div>
                                    <span className="text-zinc-500 block text-[9px] uppercase font-semibold">GRN:</span>
                                    <span className="font-semibold text-zinc-800">{editingRow.GRN}</span>
                                </div>
                                <div>
                                    <span className="text-zinc-500 block text-[9px] uppercase font-semibold">I.R. / Waybill:</span>
                                    <span className="font-semibold text-zinc-800">{editingRow.Import_Reference} / {editingRow.Waybill}</span>
                                </div>
                            </div>

                            {/* Comparación de Cantidades */}
                            <div className="grid grid-cols-3 gap-2 bg-sky-50/60 p-3 rounded-lg border border-sky-100 text-center">
                                <div>
                                    <span className="text-sky-900 block text-[9px] uppercase font-semibold">Esperada</span>
                                    <span className="text-sm font-bold text-zinc-800">{editingRow.Cant_Esperada}</span>
                                </div>
                                <div>
                                    <span className="text-sky-900 block text-[9px] uppercase font-semibold">Recibida Actual</span>
                                    <span className="text-sm font-bold text-zinc-800">{editingRow.Cant_Recibida}</span>
                                </div>
                                <div>
                                    <span className="text-sky-900 block text-[9px] uppercase font-semibold">Diferencia</span>
                                    <span className={`text-sm font-bold ${editingRow.Diferencia > 0 ? 'text-blue-600' : editingRow.Diferencia < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {editingRow.Diferencia > 0 ? `+${editingRow.Diferencia}` : editingRow.Diferencia}
                                    </span>
                                </div>
                            </div>

                            {/* Campo de Rectificación de Cantidad */}
                            <div>
                                <label className="block text-[10px] font-semibold uppercase text-zinc-700 mb-1">
                                    Cantidad Recibida Confirmada / Rectificada:
                                </label>
                                <input
                                    type="number"
                                    step="any"
                                    value={editRectifiedQty}
                                    onChange={(e) => setEditRectifiedQty(e.target.value)}
                                    className="w-full h-8 px-2 text-[12px] bg-white border border-zinc-200 rounded-lg outline-none font-semibold focus:border-[#285f94]"
                                />
                                <span className="text-[9px] text-zinc-500 mt-0.5 block">
                                    Ajuste este valor si se realizó un reconteo físico directo del ítem.
                                </span>
                            </div>

                            {/* Selector de Motivo de Diferencia */}
                            <div>
                                <label className="block text-[10px] font-semibold uppercase text-zinc-700 mb-1">
                                    Motivo de la Discrepancia:
                                </label>
                                <select
                                    value={editReason}
                                    onChange={(e) => setEditReason(e.target.value)}
                                    className="w-full h-8 px-2 text-[11px] bg-white border border-zinc-200 rounded-lg outline-none font-medium focus:border-[#285f94]"
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
                                <label className="block text-[10px] font-semibold uppercase text-zinc-700 mb-1">
                                    Observación / Justificación del Operador:
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Detalle o nota explicativa para la auditoría..."
                                    value={editComment}
                                    onChange={(e) => setEditComment(e.target.value)}
                                    className="w-full p-2 text-[11px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-[#285f94]"
                                />
                            </div>

                            {/* Botones de Acción */}
                            <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                                <button
                                    type="button"
                                    onClick={handleClearRowEdit}
                                    className="px-3 py-1.5 text-[10px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                >
                                    Restablecer Original
                                </button>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setEditingRow(null)}
                                        className="px-3 py-1.5 text-[10px] font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-1.5 text-[10px] font-medium text-white rounded-lg shadow-sm"
                                        style={{ background: '#285f94' }}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-zinc-200">
                        <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between bg-emerald-700">
                            <div className="flex items-center gap-2">
                                <span className="text-white text-base">💾</span>
                                <h3 className="text-[13px] font-semibold text-white uppercase tracking-tight">
                                    Guardar Conciliación Permanente
                                </h3>
                            </div>
                            <button
                                onClick={() => setShowSaveModal(false)}
                                className="text-white/80 hover:text-white text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-5 space-y-4 text-[11px]">
                            {saveSuccessMsg ? (
                                <div className="bg-emerald-50 text-emerald-800 p-4 rounded-xl border border-emerald-200 text-center font-medium">
                                    <p className="text-lg mb-1">✅</p>
                                    <p>{saveSuccessMsg}</p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-zinc-600">
                                        Se guardará una <strong>fotografía histórica completa</strong> de la conciliación en la base de datos SQLite. Aunque se elimine o actualice el archivo 280, estos registros permanecerán intactos para auditoría.
                                    </p>

                                    {/* Resumen a Guardar */}
                                    <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200 space-y-1.5">
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500 uppercase font-semibold text-[10px]">GRN a Conciliar:</span>
                                            <span className="font-bold text-zinc-900">{selectedGRN || 'TODAS LAS VISIBLES'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500 uppercase font-semibold text-[10px]">Import Reference:</span>
                                            <span className="font-semibold text-zinc-800">{selectedIR || 'TODAS LAS VISIBLES'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500 uppercase font-semibold text-[10px]">Total Líneas:</span>
                                            <span className="font-semibold text-zinc-800">{reconciliationSummary.totalLines}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500 uppercase font-semibold text-[10px]">Cant. Esperada:</span>
                                            <span className="font-semibold text-zinc-800">{reconciliationSummary.totalExp}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500 uppercase font-semibold text-[10px]">Cant. Recibida:</span>
                                            <span className="font-semibold text-zinc-800">{reconciliationSummary.totalRec}</span>
                                        </div>
                                        <div className="flex justify-between border-t border-zinc-200 pt-1">
                                            <span className="text-zinc-500 uppercase font-bold text-[10px]">Diferencia Neta:</span>
                                            <span className={`font-bold ${reconciliationSummary.totalDiff > 0 ? 'text-blue-600' : reconciliationSummary.totalDiff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {reconciliationSummary.totalDiff > 0 ? `+${reconciliationSummary.totalDiff}` : reconciliationSummary.totalDiff}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Campo de Notas */}
                                    <div>
                                        <label className="block text-[10px] font-semibold uppercase text-zinc-700 mb-1">
                                            Notas Generales de la Conciliación (Opcional):
                                        </label>
                                        <textarea
                                            rows={2}
                                            placeholder="Observaciones de cierre, número de acta, etc..."
                                            value={saveNotes}
                                            onChange={(e) => setSaveNotes(e.target.value)}
                                            className="w-full p-2 text-[11px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-emerald-600"
                                        />
                                    </div>

                                    {/* Botones */}
                                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                                        <button
                                            type="button"
                                            onClick={() => setShowSaveModal(false)}
                                            className="px-3 py-1.5 text-[10px] font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleConfirmSaveReconciliation}
                                            disabled={isSaving}
                                            className="px-4 py-1.5 text-[10px] font-medium text-white rounded-lg shadow-sm bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                        >
                                            {isSaving ? 'Guardando en BD...' : 'Confirmar y Guardar'}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden border border-zinc-200 flex flex-col">
                        <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between" style={{ background: '#354a5f' }}>
                            <div className="flex items-center gap-2">
                                <span className="text-white text-base">📁</span>
                                <h3 className="text-[13px] font-semibold text-white uppercase tracking-tight">
                                    Historial de Conciliaciones Guardadas (SQLite)
                                </h3>
                            </div>
                            <button
                                onClick={() => {
                                    setShowHistoryModal(false);
                                    setViewingDetail(null);
                                }}
                                className="text-white/80 hover:text-white text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-4 flex-1 overflow-auto">
                            {viewingDetail ? (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                                        <div>
                                            <button
                                                onClick={() => setViewingDetail(null)}
                                                className="text-[11px] font-medium text-[#285f94] hover:underline flex items-center gap-1 mb-1"
                                            >
                                                ← Volver al listado
                                            </button>
                                            <h4 className="text-[13px] font-bold text-zinc-900">
                                                Conciliación GRN: {viewingDetail.header.grn_number} (IR: {viewingDetail.header.import_reference})
                                            </h4>
                                            <p className="text-[10px] text-zinc-500">
                                                Fecha: {formatDateShort(viewingDetail.header.reconciled_at)} | Operador: {viewingDetail.header.reconciled_by}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2.5 py-1 rounded text-[10px] font-bold ${viewingDetail.header.status === 'CONCILIADO_OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                                {viewingDetail.header.status}
                                            </span>
                                            <button
                                                onClick={() => handleExportSavedDetail(viewingDetail)}
                                                className="px-2.5 py-1 text-[10px] font-medium text-white rounded-lg shadow-sm bg-[#285f94] hover:bg-[#1e4a74] transition-colors flex items-center gap-1 cursor-pointer"
                                                title="Exportar esta conciliación a Excel"
                                            >
                                                📊 Exportar Excel
                                            </button>
                                        </div>
                                    </div>

                                    {/* Tabla de ítems guardados en la foto */}
                                    <div className="overflow-auto max-h-[50vh] border border-zinc-200 rounded-lg">
                                        <table className="w-full text-left text-[11px]">
                                            <thead className="bg-zinc-100 text-zinc-700 font-semibold sticky top-0">
                                                <tr>
                                                    <th className="px-2 py-1.5">Línea</th>
                                                    <th className="px-2 py-1.5">Ítem</th>
                                                    <th className="px-2 py-1.5">Descripción</th>
                                                    <th className="px-2 py-1.5">Ubicación</th>
                                                    <th className="px-2 py-1.5 text-center">Esperada</th>
                                                    <th className="px-2 py-1.5 text-center">Recibida</th>
                                                    <th className="px-2 py-1.5 text-center">Diferencia</th>
                                                    <th className="px-2 py-1.5">Motivo / Justificación</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100">
                                                {viewingDetail.items.map((it, i) => (
                                                    <tr key={i} className="hover:bg-zinc-50">
                                                        <td className="px-2 py-1.5 text-center">{it.order_line || '-'}</td>
                                                        <td className="px-2 py-1.5 font-medium text-[#1e4a74]">{it.item_code}</td>
                                                        <td className="px-2 py-1.5 truncate max-w-[200px]">{it.description}</td>
                                                        <td className="px-2 py-1.5">{it.location || '-'}</td>
                                                        <td className="px-2 py-1.5 text-center">{it.qty_expected}</td>
                                                        <td className="px-2 py-1.5 text-center">{it.qty_received}</td>
                                                        <td className={`px-2 py-1.5 text-center font-bold ${it.difference > 0 ? 'text-blue-600' : it.difference < 0 ? 'text-red-600' : 'text-zinc-800'}`}>
                                                            {it.difference > 0 ? `+${it.difference}` : it.difference}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-[10px] text-zinc-600">
                                                            {it.difference_reason && <span className="font-semibold text-zinc-800 block">{it.difference_reason}</span>}
                                                            {it.operator_comment && <span>{it.operator_comment}</span>}
                                                            {!it.difference_reason && !it.operator_comment && <span className="text-zinc-400">-</span>}
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
                                        <div className="py-16 text-center text-zinc-400 text-[11px]">
                                            Cargando historial de conciliaciones...
                                        </div>
                                    ) : savedHistoryList.length > 0 ? (
                                        <div className="overflow-auto max-h-[60vh] border border-zinc-200 rounded-lg">
                                            <table className="w-full text-left text-[11px]">
                                                <thead className="bg-zinc-100 text-zinc-700 font-semibold sticky top-0">
                                                    <tr>
                                                        <th className="px-3 py-2">ID</th>
                                                        <th className="px-3 py-2">GRN</th>
                                                        <th className="px-3 py-2">I.R.</th>
                                                        <th className="px-3 py-2">Fecha Guardado</th>
                                                        <th className="px-3 py-2">Operador</th>
                                                        <th className="px-3 py-2 text-center">Líneas</th>
                                                        <th className="px-3 py-2 text-center">Esperada</th>
                                                        <th className="px-3 py-2 text-center">Recibida</th>
                                                        <th className="px-3 py-2 text-center">Diferencia</th>
                                                        <th className="px-3 py-2 text-center">Estado</th>
                                                        <th className="px-3 py-2 text-center">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100">
                                                    {savedHistoryList.map((rec) => (
                                                        <tr key={rec.id} className="hover:bg-zinc-50">
                                                            <td className="px-3 py-2 font-mono text-zinc-500">#{rec.id}</td>
                                                            <td className="px-3 py-2 font-bold text-zinc-900">{rec.grn_number}</td>
                                                            <td className="px-3 py-2 text-zinc-800">{rec.import_reference}</td>
                                                            <td className="px-3 py-2 text-zinc-600">{formatDateShort(rec.reconciled_at)}</td>
                                                            <td className="px-3 py-2 text-zinc-600">{rec.reconciled_by}</td>
                                                            <td className="px-3 py-2 text-center">{rec.total_lines}</td>
                                                            <td className="px-3 py-2 text-center font-medium">{rec.total_expected}</td>
                                                            <td className="px-3 py-2 text-center font-medium">{rec.total_received}</td>
                                                            <td className={`px-3 py-2 text-center font-bold ${rec.total_difference > 0 ? 'text-blue-600' : rec.total_difference < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                                {rec.total_difference > 0 ? `+${rec.total_difference}` : rec.total_difference}
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${rec.status === 'CONCILIADO_OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                                                    {rec.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-center space-x-1 whitespace-nowrap">
                                                                <button
                                                                    onClick={() => handleViewSavedDetail(rec.id)}
                                                                    className="px-2 py-1 text-[10px] font-medium text-white rounded shadow-sm bg-[#285f94] hover:bg-[#1e4a74] cursor-pointer"
                                                                >
                                                                    Ver Detalle
                                                                </button>
                                                                <button
                                                                    onClick={() => handleExportSavedFromList(rec.id)}
                                                                    className="px-2 py-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded shadow-sm cursor-pointer"
                                                                    title="Exportar esta conciliación histórica a Excel"
                                                                >
                                                                    📊 Exportar
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteSavedRecon(rec.id, rec.grn_number)}
                                                                    className="px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 rounded cursor-pointer"
                                                                    title="Eliminar"
                                                                >
                                                                    🗑️
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="py-16 text-center text-zinc-400 text-[11px]">
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
