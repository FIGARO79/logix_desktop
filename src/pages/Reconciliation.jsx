import React, { useEffect, useState, useMemo } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLocation } from 'react-router-dom';
import { cacheData, getCachedData } from '../utils/offlineDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const Reconciliation = () => {
    const { setTitle } = useOutletContext();
    const location = useLocation();
    useEffect(() => { setTitle("Conciliación"); }, [setTitle]);
    const queryClient = useQueryClient();
    const [filterText, setFilterText] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'GRN', direction: 'ascending' });
    const [currentVersion, setCurrentVersion] = useState('');
    const [currentSnapshot, setCurrentSnapshot] = useState('');
    const [isOfflineData, setIsOfflineData] = useState(false);

    // Filtros del histórico en la base de datos
    const [filterGRN, setFilterGRN] = useState('');
    const [filterWaybill, setFilterWaybill] = useState('');
    const [filterImportRef, setFilterImportRef] = useState('');

    const [showHistoryFilters, setShowHistoryFilters] = useState(false);
    const [selectedRowIds, setSelectedRowIds] = useState([]);


    const isHistoricalMode = !!(currentSnapshot || filterGRN || filterWaybill || filterImportRef);

    const { data: queryData = { data: [], archive_versions: [], snapshot_versions: [] }, isLoading: loading, refetch } = useQuery({
        queryKey: ['reconciliation', currentVersion, currentSnapshot, filterGRN, filterWaybill, filterImportRef],
        queryFn: async () => {
            setIsOfflineData(false);
            if (!navigator.onLine) {
                const cachedData = await getCachedData('last_reconciliation');
                if (cachedData) setIsOfflineData(true);
                return { data: cachedData || [], archive_versions: [], snapshot_versions: [] };
            }

            const queryParams = new URLSearchParams();
            let url = `/api/views/reconciliation`;
            if (isHistoricalMode) {
                url = `/api/views/reconciliation/history`;
                if (currentSnapshot) queryParams.append('snapshot_date', currentSnapshot);
                if (filterGRN) queryParams.append('grn', filterGRN);
                if (filterWaybill) queryParams.append('waybill', filterWaybill);
                if (filterImportRef) queryParams.append('import_reference', filterImportRef);
            } else {
                if (currentVersion) queryParams.append('archive_date', currentVersion);
            }

            const res = await fetch(`${url}?${queryParams.toString()}`);
            if (res.ok) {
                const response = await res.json();
                if (!isHistoricalMode && !currentVersion) {
                    await cacheData('last_reconciliation', response.data);
                }
                return response;
            }
            throw new Error('Failed to fetch data');
        },
        refetchInterval: () => {
            if (location.pathname !== '/reconciliation' || currentSnapshot || isHistoricalMode || currentVersion || !navigator.onLine) return false;
            return 5000; // Polling activo cada 5 segundos
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

    const data = useMemo(() => queryData?.data || [], [queryData]);
    const archiveVersions = useMemo(() => queryData?.archive_versions || [], [queryData]);
    const snapshotVersions = useMemo(() => queryData?.snapshot_versions || [], [queryData]);

    const handleArchiveSnapshot = async () => {
        if (!data || data.length === 0) return alert("No hay datos para archivar");
        if (!confirm("¿Deseas guardar una instantánea (SNAPSHOT) de esta conciliación?")) return;

        try {
            const res = await fetch('/api/views/reconciliation/archive', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: data,
                    client_timestamp: new Date().toISOString()
                })
            });
            if (res.ok) {
                const result = await res.json();
                alert(`Instantánea guardada correctamente: ${result.archive_date}`);
                queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
            } else {
                alert("Error al guardar la instantánea");
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    const handleUnarchiveVersion = async () => {
        if (!currentVersion) return;
        if (!confirm(`¿Deseas desarchivar los registros correspondientes al lote ${formatDateShort(currentVersion)}? Esto los reincorporará a la conciliación activa.`)) {
            return;
        }

        try {
            const res = await fetch('/api/logs/unarchive', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version_date: currentVersion })
            });
            if (res.ok) {
                alert("Lote desarchivado con éxito");
                setCurrentVersion('');
                queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
            } else {
                const err = await res.json();
                alert(`Error al desarchivar: ${err.detail || 'Error desconocido'}`);
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    const handleRestoreRowsBulk = async () => {
        if (selectedRowIds.length === 0) return alert("No hay registros seleccionados");
        if (!confirm(`¿Deseas desarchivar y restaurar los ${selectedRowIds.length} registros seleccionados a la conciliación activa?`)) {
            return;
        }

        try {
            const res = await fetch(`/api/views/reconciliation/restore_rows_bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ row_ids: selectedRowIds })
            });
            if (res.ok) {
                alert("Registros restaurados con éxito como logs activos.");
                setSelectedRowIds([]);
                queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
            } else {
                const err = await res.json();
                alert(`Error al restaurar: ${err.detail || 'Error desconocido'}`);
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    const handleDeleteRowsBulk = async () => {
        if (selectedRowIds.length === 0) return alert("No hay registros seleccionados");
        if (!confirm(`¿Deseas eliminar permanentemente los ${selectedRowIds.length} registros seleccionados de los snapshots? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const res = await fetch(`/api/views/reconciliation/delete_rows_bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ row_ids: selectedRowIds })
            });
            if (res.ok) {
                alert("Registros eliminados con éxito.");
                setSelectedRowIds([]);
                queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
            } else {
                const err = await res.json();
                alert(`Error al eliminar: ${err.detail || 'Error desconocido'}`);
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    const handleVersionChange = (e) => {
        const val = e.target.value;
        setCurrentVersion(val);
        setCurrentSnapshot('');
        setFilterGRN('');
        setFilterWaybill('');
        setFilterImportRef('');
    };

    const handleSnapshotChange = (e) => {
        const val = e.target.value;
        setCurrentSnapshot(val);
        setCurrentVersion('');
    };


    const formatDateShort = (dateStr) => {
        if (!dateStr) return '';
        try {
            let cleanStr = dateStr.trim();
            // Normalizar espacio a T para formato ISO estándar
            if (cleanStr.includes(' ') && !cleanStr.includes('T')) {
                cleanStr = cleanStr.replace(' ', 'T');
            }
            // Determinar si ya tiene zona horaria (Z o offset +/-)
            const hasTimezone = cleanStr.endsWith('Z') ||
                cleanStr.includes('+') ||
                (cleanStr.includes('T') && cleanStr.split('T')[1].includes('-')) ||
                (!cleanStr.includes('T') && cleanStr.lastIndexOf('-') > 7);

            // Si es hora del servidor sin offset, forzar interpretación como UTC
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

    const sortedData = useMemo(() => {
        let sortableItems = [...data];
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
    }, [data, sortConfig]);

    const filteredData = useMemo(() => {
        return sortedData.filter(item => {
            if (!filterText) return true;
            const searchStr = filterText.toLowerCase();
            return Object.entries(item).some(([key, val]) => {
                if (val === null || val === undefined) return false;
                if (key === 'id') return false;
                if (key === 'Timestamp' || key === 'Snapshot_Date') {
                    return formatDateShort(val).toLowerCase().includes(searchStr);
                }
                return String(val).toLowerCase().includes(searchStr);
            });
        });
    }, [sortedData, filterText]);

    const allSelected = filteredData.length > 0 && filteredData.every(row => selectedRowIds.includes(row.id));

    const handleToggleSelectAll = () => {
        if (allSelected) {
            setSelectedRowIds(prev => prev.filter(id => !filteredData.some(r => r.id === id)));
        } else {
            const newIds = filteredData.map(r => r.id).filter(id => id && !selectedRowIds.includes(id));
            setSelectedRowIds(prev => [...prev, ...newIds]);
        }
    };

    const handleToggleSelectRow = (rowId) => {
        if (selectedRowIds.includes(rowId)) {
            setSelectedRowIds(prev => prev.filter(id => id !== rowId));
        } else {
            setSelectedRowIds(prev => [...prev, rowId]);
        }
    };

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

    return (
        <div className="flex flex-col h-full bg-[#fcfcfc] text-zinc-900 font-sans font-normal">
            <div className="px-4 pt-2 pb-2 border-b border-zinc-100 bg-white/80 backdrop-blur-md sticky top-0 z-30">
                <div className="flex flex-wrap items-center gap-2 bg-zinc-50/50 p-2 rounded-xl border border-zinc-100">
                    <div className="flex-1 min-w-[200px]">
                        <div style={{ position: 'relative' }}>
                            {/* Ícono lupa — pointer-events none para no bloquear el input */}
                            <span style={{
                                position: 'absolute',
                                left: '10px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                pointerEvents: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                color: '#a1a1aa',
                                zIndex: 2
                            }}>
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </span>
                            <input
                                type="text"
                                placeholder="BUSCAR REGISTRO..."
                                className="w-full h-9 text-[10px] bg-white border border-zinc-200 rounded-lg outline-none text-zinc-900 font-normal uppercase tracking-wider"
                                style={{ paddingLeft: '32px', paddingRight: filterText ? '30px' : '12px' }}
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                            />
                            {/* Botón X para limpiar — solo visible cuando hay texto */}
                            {filterText && (
                                <button
                                    onClick={() => setFilterText('')}
                                    title="Limpiar búsqueda"
                                    style={{
                                        position: 'absolute',
                                        right: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        width: '18px',
                                        height: '18px',
                                        borderRadius: '50%',
                                        background: '#e4e4e7',
                                        border: 'none',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '13px',
                                        lineHeight: 1,
                                        color: '#52525b',
                                        padding: 0,
                                        zIndex: 2
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="w-40">
                        <select
                            value={currentVersion}
                            onChange={handleVersionChange}
                            className="w-full h-9 p-1 text-[12px] text-zinc-900 font-normal bg-white border border-zinc-200 rounded-lg outline-none cursor-pointer uppercase"
                        >
                            <option value="">LOGS ACTUALES</option>
                            {archiveVersions.map(v => (
                                <option key={v} value={v}>LOGS: {formatDateShort(v)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="w-40">
                        <select
                            value={currentSnapshot}
                            onChange={handleSnapshotChange}
                            className="w-full h-9 p-1 text-[12px] text-zinc-900 font-normal bg-white border border-zinc-200 rounded-lg outline-none cursor-pointer uppercase"
                        >
                            <option value="">INSTANTÁNEAS</option>
                            {snapshotVersions.map(v => (
                                <option key={v} value={v}>SNAP: {formatDateShort(v)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-1.5 ml-auto">
                        {isHistoricalMode && selectedRowIds.length > 0 && (
                            <>
                                <button
                                    onClick={handleRestoreRowsBulk}
                                    className="h-9 px-3 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-normal active:scale-95 whitespace-nowrap bg-amber-600 hover:bg-amber-700 transition-colors"
                                >
                                    Desarchivar ({selectedRowIds.length})
                                </button>
                                <button
                                    onClick={handleDeleteRowsBulk}
                                    className="h-9 px-3 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-normal active:scale-95 whitespace-nowrap bg-red-600 hover:bg-red-700 transition-colors"
                                >
                                    Eliminar ({selectedRowIds.length})
                                </button>
                            </>
                        )}

                        {currentVersion && (
                            <button
                                onClick={handleUnarchiveVersion}
                                className="h-9 px-3 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-normal active:scale-95 whitespace-nowrap bg-amber-600 hover:bg-amber-700 transition-colors"
                            >
                                Desarchivar Lote
                            </button>
                        )}

                        <button
                            onClick={() => setShowHistoryFilters(!showHistoryFilters)}
                            className="h-9 px-3 text-[12px] text-zinc-700 bg-white border border-zinc-200 rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-normal active:scale-95 whitespace-nowrap hover:bg-zinc-50 transition-colors"
                        >
                            {showHistoryFilters ? "Ocultar BD" : "Buscar BD"}
                        </button>

                        <button
                            onClick={() => {
                                const params = new URLSearchParams();
                                if (currentVersion) params.append('archive_date', currentVersion);
                                if (currentSnapshot) params.append('snapshot_date', currentSnapshot);
                                params.append('timezone_offset', new Date().getTimezoneOffset());
                                window.location.href = `/api/export_reconciliation?${params.toString()}`;
                            }}
                            className="h-9 px-3 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-normal active:scale-95 whitespace-nowrap" style={{ background: '#285f94' }} onMouseEnter={e => e.currentTarget.style.background = '#1e4a74'} onMouseLeave={e => e.currentTarget.style.background = '#285f94'}
                        >
                            Exportar
                        </button>

                        {!currentSnapshot && (
                            <button
                                onClick={handleArchiveSnapshot}
                                className="h-9 px-3 text-[12px] text-white rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-normal active:scale-95 whitespace-nowrap" style={{ background: '#285f94' }} onMouseEnter={e => e.currentTarget.style.background = '#1e4a74'} onMouseLeave={e => e.currentTarget.style.background = '#285f94'}
                            >
                                Snapshot
                            </button>
                        )}
                    </div>
                </div>

                {/* Panel de filtros históricos de base de datos */}
                {showHistoryFilters && (
                    <div className="flex flex-wrap items-center gap-2 bg-zinc-50/50 p-2 rounded-xl border border-zinc-100 mt-2">
                        <span className="text-[9px] uppercase tracking-normal text-zinc-400 font-normal pl-1">Búsqueda en Histórico (BD):</span>

                        <input
                            type="text"
                            placeholder="GRN..."
                            value={filterGRN}
                            onChange={(e) => setFilterGRN(e.target.value)}
                            className="h-8 text-[11px] px-2 bg-white border border-zinc-200 rounded-lg outline-none text-zinc-900 font-normal w-32 focus:border-[#285f94]"
                        />

                        <input
                            type="text"
                            placeholder="WAYBILL..."
                            value={filterWaybill}
                            onChange={(e) => setFilterWaybill(e.target.value)}
                            className="h-8 text-[11px] px-2 bg-white border border-zinc-200 rounded-lg outline-none text-zinc-900 font-normal w-32 focus:border-[#285f94]"
                        />

                        <input
                            type="text"
                            placeholder="I.R...."
                            value={filterImportRef}
                            onChange={(e) => setFilterImportRef(e.target.value)}
                            className="h-8 text-[11px] px-2 bg-white border border-zinc-200 rounded-lg outline-none text-zinc-900 font-normal w-32 focus:border-[#285f94]"
                        />

                        <button
                            onClick={() => refetch()}
                            className="h-8 px-3 text-[11px] text-white rounded-lg shadow-sm uppercase tracking-normal bg-zinc-700 hover:bg-zinc-800 transition-colors active:scale-95"
                        >
                            Buscar BD
                        </button>

                        {(filterGRN || filterWaybill || filterImportRef) && (
                            <button
                                onClick={() => {
                                    setFilterGRN('');
                                    setFilterWaybill('');
                                    setFilterImportRef('');
                                }}
                                className="h-8 px-2 text-[11px] text-zinc-500 bg-zinc-200 hover:bg-zinc-300 rounded-lg transition-colors active:scale-95"
                            >
                                Limpiar
                            </button>
                        )}

                        {isHistoricalMode && (
                            <span className="text-[9px] uppercase tracking-normal text-[#285f94] font-normal ml-auto flex items-center gap-1.5 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#285f94] animate-pulse"></span>
                                Modo Histórico Activo
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 px-4 py-2 overflow-hidden flex flex-col">
                <div className="bg-white border border-zinc-200 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col flex-1">
                    {loading ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-32 text-zinc-400 text-sm font-normal">
                            Cargando...
                        </div>
                    ) : (
                        <>
                            <div className="overflow-auto max-h-[70vh]">
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
                                                { id: 'Timestamp', label: 'FECHA' },
                                                ...(isHistoricalMode ? [
                                                    { id: 'Snapshot_Date', label: 'SNAPSHOT' },
                                                    { id: 'actions', label: 'ACCIONES' }
                                                ] : [])
                                            ].map((head) => (
                                                <th
                                                    key={head.id}
                                                    onClick={() => head.id !== 'actions' && requestSort(head.id)}
                                                    className={`px-3 py-2.5 text-[12px] font-normal text-white/90 ${head.id !== 'actions' ? 'cursor-pointer select-none' : ''} whitespace-nowrap uppercase tracking-normal transition-colors`}
                                                    style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}
                                                    onMouseEnter={e => head.id !== 'actions' && (e.currentTarget.style.background = '#2a3c4e')}
                                                    onMouseLeave={e => head.id !== 'actions' && (e.currentTarget.style.background = '')}
                                                >
                                                    <div className="flex items-center gap-1 justify-center">
                                                        {head.id === 'actions' ? (
                                                            <input
                                                                type="checkbox"
                                                                checked={allSelected}
                                                                onChange={handleToggleSelectAll}
                                                                className="cursor-pointer rounded border-zinc-300 text-[#285f94] focus:ring-[#285f94] w-4 h-4"
                                                                title="Seleccionar todos"
                                                            />
                                                        ) : (
                                                            <>
                                                                {head.label}
                                                                {getSortIcon(head.id)}
                                                            </>
                                                        )}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredData.length > 0 ? (
                                            filteredData.map((row, idx) => (
                                                <tr
                                                    key={idx}
                                                    className="transition-colors hover:z-10 relative"
                                                    style={{ background: idx % 2 === 0 ? '#fff' : '#fcfcfc' }}
                                                    onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                                                    onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fcfcfc'}
                                                >
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal text-black tracking-tight" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Import_Reference}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Waybill}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.GRN}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Order_Line || '-'}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal tracking-tight" style={{ borderBottom: '1px solid #f1f1f1', color: '#1e4a74' }}>{row.Codigo_Item}</td>
                                                    <td className="px-3 py-2 text-[12px] truncate max-w-[300px] text-sm font-normal text-black tracking-tight" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Descripcion}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Ubicacion || '-'}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Reubicado || '-'}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm text-center font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Cant_Esperada}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm text-center font-normal text-black" style={{ borderBottom: '1px solid #f1f1f1' }}>{row.Cant_Recibida}</td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-center text-sm font-normal" style={{ borderBottom: '1px solid #f1f1f1', color: row.Diferencia > 0 ? '#1e4a74' : row.Diferencia < 0 ? '#dc2626' : '#18181b' }}>
                                                        {row.Diferencia > 0 ? `+${row.Diferencia}` : row.Diferencia}
                                                    </td>
                                                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm text-black font-normal" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                        {formatDateShort(row.Timestamp)}
                                                    </td>
                                                    {isHistoricalMode && (
                                                        <>
                                                            <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm text-black font-normal" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                                <div className="flex flex-col">
                                                                    <span className="font-semibold text-zinc-700">{formatDateShort(row.Snapshot_Date)}</span>
                                                                    <span className="text-[9px] text-zinc-400">Por: {row.Usuario || 'Sistema'}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-[12px] whitespace-nowrap text-sm text-black font-normal text-center" style={{ borderBottom: '1px solid #f1f1f1' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedRowIds.includes(row.id)}
                                                                    onChange={() => handleToggleSelectRow(row.id)}
                                                                    className="cursor-pointer rounded border-zinc-300 text-[#285f94] focus:ring-[#285f94] w-4 h-4"
                                                                />
                                                            </td>
                                                        </>
                                                    )}
                                                </tr>

                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={isHistoricalMode ? 14 : 12} className="px-4 py-20 text-center text-zinc-400 text-[11px]">No se encontraron registros</td>
                                            </tr>

                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Footer */}
                            <div className="flex items-center gap-3 px-4 py-2 border-t border-zinc-100 bg-white text-[10px] text-zinc-500">
                                <span>Mostrando <span className="font-medium  text-zinc-700">{filteredData.length}</span> registros</span>
                                {!isOfflineData && (
                                    <span className="flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                                        Datos en tiempo real
                                    </span>
                                )}
                                {isOfflineData && (
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
        </div>
    );
};

export default Reconciliation;
