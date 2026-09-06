import React, { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import axios from 'axios';
import { toast } from 'react-toastify';

const OccupancyDashboard = () => {
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedCell, setSelectedCell] = useState(null); // { zone, level }
    const [cellDetails, setCellDetails] = useState([]);
    const [loadingDetails, setLoadingDetails] = useState(false);

    useEffect(() => {
        if (setTitle) setTitle(t('occupancy.title', 'Ocupación de Bodega'));
        fetchData();
    }, [setTitle, language]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const response = await axios.get('/api/views/occupancy_stats');
            setData(response.data);
        } catch (error) {
            console.error('Error fetching occupancy stats:', error);
            toast.error('Error loading occupancy analytics');
        } finally {
            setLoading(false);
        }
    };

    const handleCellClick = async (zone, level) => {
        setSelectedCell({ zone, level });
        setLoadingDetails(true);
        try {
            const params = { zone };
            if (level !== null && level !== undefined) {
                params.level = level;
            }
            const response = await axios.get('/api/views/occupancy_detail', { params });
            setCellDetails(response.data);
        } catch (error) {
            console.error('Error fetching occupancy details:', error);
            toast.error('Error loading bin details');
        } finally {
            setLoadingDetails(false);
        }
    };

    const getHeatmapStyle = (percentage) => {
        if (percentage === 0) {
            return 'bg-zinc-100 text-black border-zinc-200 font-normal';
        }
        if (percentage < 30) {
            return 'bg-emerald-200 text-black border-emerald-300 font-normal';
        }
        if (percentage < 75) {
            return 'bg-amber-200 text-black border-amber-300 font-normal';
        }
        return 'bg-red-300 text-black border-red-300 font-normal';
    };

    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-black text-[12px] font-normal tracking-widest uppercase">Processing spatial data...</div>
        </div>
    );

    if (!data) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="bg-red-50 text-red-750 px-4 py-2 rounded border border-red-200 text-[12px] font-normal">Failed to retrieve warehouse metrics.</div>
        </div>
    );

    const allLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const zones = Object.keys(data.zones || {}).sort();

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f8f9fa] min-h-screen text-[#1f1f1f] text-[12px]">

            {/* Header & Barra de Acciones */}
            <div className="mb-3 flex justify-between items-center bg-white px-4 py-2.5 rounded border border-[#d1d5db] shadow-sm">
                <div>
                    <h1 className="text-[14px] font-normal text-[#1f1f1f] m-0">Ocupación de Bodega</h1>
                    <p className="text-[11px] font-normal text-[#5c5c5c] mt-0.5 mb-0">Análisis espacial de capacidad, saturación y distribución de bins</p>
                </div>
                <button
                    onClick={fetchData}
                    className="h-7 px-3 border border-[#d1d5db] text-[#1f1f1f] bg-white text-[12px] font-normal rounded hover:bg-[#f5f5f5] transition-colors shadow-xs cursor-pointer"
                >
                    {t('occupancy.update_data', 'Actualizar Datos')}
                </button>
            </div>

            {/* Global Utilization Summary */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
                {[
                    { label: t('occupancy.total_bins', 'Total Ubicaciones'), val: data?.summary?.total_bins ?? 0, color: 'text-[#1f1f1f]' },
                    { label: t('occupancy.filled_capacity', 'Capacidad Ocupada'), val: data?.summary?.filled_bins ?? 0, color: 'text-[#0067c0]' },
                    { label: t('occupancy.available', 'Disponibles'), val: data?.summary?.available_bins ?? 0, color: 'text-[#065f46]' },
                    { label: t('occupancy.utilization_pct', '% de Ocupación'), val: `${data?.summary?.occupancy_pct ?? 0}%`, color: (data?.summary?.occupancy_pct ?? 0) > 85 ? 'text-[#991b1b]' : 'text-[#0067c0]' },
                    { label: t('occupancy.active_skus', 'SKUs Activos'), val: data?.summary?.total_items ?? 0, color: 'text-[#1f1f1f]' },
                    { label: t('occupancy.density', 'Densidad (SKU/Bin)'), val: data?.summary?.avg_items_per_bin ?? '0.0', color: 'text-[#5c5c5c]' }
                ].map((s, i) => (
                    <div key={i} className="bg-white px-3 py-2 border border-[#d1d5db] rounded shadow-xs text-[#1f1f1f]">
                        <label className="text-[11px] text-[#5c5c5c] font-normal block mb-0.5 leading-tight">{s.label}</label>
                        <p className={`text-[18px] font-normal font-mono leading-none m-0 ${s.color}`}>{s.val}</p>
                    </div>
                ))}
            </div>

            {/* Heatmap Matrix Section */}
            <div className="bg-white border border-[#d1d5db] rounded shadow-sm mb-4 overflow-hidden text-[#1f1f1f]">
                <div className="px-4 py-2 border-b border-[#d1d5db] bg-[#f8f9fa] flex justify-between items-center text-[#1f1f1f]">
                    <h3 className="text-[12px] font-normal text-[#1f1f1f] m-0">
                        {t('occupancy.matrix_title', 'Matriz de Saturación de Bins (Nivel vs Zona)')}
                    </h3>
                </div>
                <div className="overflow-x-auto text-[#1f1f1f]">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-[#354a5f] text-white text-[11px] font-normal tracking-normal border-b border-[#2a3c4e]">
                                <th className="px-4 py-2 text-left font-normal border-r border-[#2a3c4e]">{t('occupancy.zone_col', 'Identificador de Zona')}</th>
                                {allLevels.map(level => (
                                    <th key={level} className="px-2 py-2 text-center font-normal border-r border-[#2a3c4e] last:border-r-0">
                                        {t('occupancy.level', 'Nivel')} {level}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e5e7eb]">
                            {zones.map((zoneName, zIdx) => {
                                const zoneData = data.zones[zoneName] || { total: 0, occupied: 0, levels: {} };
                                const zoneOccupancyPct = zoneData.total > 0
                                    ? Math.round((zoneData.occupied / zoneData.total) * 100)
                                    : 0;
                                const isZoneSelected = selectedCell && selectedCell.zone === zoneName && selectedCell.level === null;
                                return (
                                    <tr key={zoneName} className={`hover:bg-[#edf3f9] transition-colors ${zIdx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'}`}>
                                        <td
                                            onClick={() => handleCellClick(zoneName, null)}
                                            className={`px-4 py-2 cursor-pointer transition-colors border-r border-[#e5e7eb] ${isZoneSelected
                                                ? 'bg-[#f0f7ff] border-l-4 border-l-[#0067c0]'
                                                : 'hover:bg-[#edf3f9]'
                                                }`}
                                        >
                                            <div className="text-[12px] font-normal text-[#0067c0] flex items-center gap-1.5">
                                                <span>{zoneName}</span>
                                                <span className="text-[10.5px] text-[#8c8c8c] font-normal">(Ver todo)</span>
                                            </div>
                                            <div className="text-[11px] text-[#5c5c5c] font-normal mt-0.5">
                                                {zoneData.total} Bins • {zoneOccupancyPct}% Ocupación
                                            </div>
                                        </td>
                                        {allLevels.map(level => {
                                            const levelData = zoneData.levels?.[level] || { total: 0, full_bins: 0, occupied_skus: 0, total_occupancy_pct: 0, occupied_bins: 0 };
                                            const occupancyPercent = levelData.total > 0
                                                ? (levelData.total_occupancy_pct !== undefined
                                                    ? Math.round(levelData.total_occupancy_pct / levelData.total)
                                                    : Math.round((levelData.full_bins / levelData.total) * 100))
                                                : 0;

                                            const isSelected = selectedCell && selectedCell.zone === zoneName && selectedCell.level === level;

                                            return (
                                                <td key={level} className="px-1 py-1.5 border-r border-[#e5e7eb] last:border-r-0 text-center">
                                                    {levelData.total > 0 ? (
                                                        <div
                                                            onClick={() => handleCellClick(zoneName, level)}
                                                            className={`
                                                                w-full h-12 flex flex-col items-center justify-center rounded border
                                                                ${getHeatmapStyle(occupancyPercent)}
                                                                cursor-pointer hover:border-[#0067c0] transition-colors
                                                                ${isSelected ? 'ring-2 ring-[#0067c0] border-transparent shadow-xs z-10' : ''}
                                                            `}
                                                        >
                                                            <span className="text-[11.5px] font-normal leading-none mb-0.5 text-[#1f1f1f]">{occupancyPercent}%</span>
                                                            <div className="text-[10px] font-normal opacity-85 text-center text-[#1f1f1f]">
                                                                {levelData.occupied_bins !== undefined ? levelData.occupied_bins : levelData.full_bins}/{levelData.total} Bins
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="h-12 flex items-center justify-center text-[#d1d5db] font-mono text-[11px]">
                                                            —
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Legend Bar Compact */}
                <div className="px-4 py-2 border-t border-[#d1d5db] bg-[#f8f9fa] flex items-center gap-4 text-[#1f1f1f] text-[11.5px]">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-emerald-200 border border-emerald-300 rounded"></div>
                        <span className="font-normal text-[#5c5c5c]">Baja Utilización</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-amber-200 border border-amber-300 rounded"></div>
                        <span className="font-normal text-[#5c5c5c]">Carga Óptima</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-red-300 border border-red-300 rounded"></div>
                        <span className="font-normal text-[#5c5c5c]">Saturado</span>
                    </div>
                    <div className="ml-auto text-[11px] font-normal text-[#8c8c8c]">
                        Valores porcentuales basados en capacidades configuradas por bin
                    </div>
                </div>
            </div>

            {/* Bin Details Matrix Section */}
            {selectedCell && (
                <div className="bg-white border border-[#d1d5db] rounded shadow-sm mb-4 overflow-hidden text-[#1f1f1f]">
                    <div className="px-4 py-2.5 border-b border-[#d1d5db] bg-[#f8f9fa] flex justify-between items-center text-[#1f1f1f]">
                        <div>
                            <h3 className="text-[13px] font-normal text-[#1f1f1f] m-0">
                                Mapa de Ubicaciones: {t('occupancy.zone', 'Zona')} {selectedCell.zone} {selectedCell.level !== null ? `— ${t('occupancy.level', 'Nivel')} ${selectedCell.level}` : '— Todos los Niveles'}
                            </h3>
                            <p className="text-[11px] text-[#5c5c5c] font-normal mt-0.5 mb-0">
                                {loadingDetails ? 'Cargando infraestructura...' : `${cellDetails.length} Ubicaciones encontradas`}
                            </p>
                        </div>
                        <button
                            onClick={() => { setSelectedCell(null); setCellDetails([]); }}
                            className="text-[#8c8c8c] hover:text-[#1f1f1f] transition-colors p-1 cursor-pointer"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-4">
                        {loadingDetails ? (
                            <div className="flex flex-col items-center justify-center py-8">
                                <span className="text-[12px] font-normal text-[#5c5c5c]">Analizando mapa de slots...</span>
                            </div>
                        ) : cellDetails.length === 0 ? (
                            <div className="text-center py-8 text-[#8c8c8c] text-[12px] font-normal">
                                No se encontraron bins configurados para la Zona {selectedCell.zone} {selectedCell.level !== null ? `en el Nivel ${selectedCell.level}` : 'en ningún nivel'}.
                            </div>
                        ) : (
                            <div className="space-y-4 text-[#1f1f1f]">
                                {Object.entries(
                                    cellDetails.reduce((acc, bin) => {
                                        const aisle = bin.aisle || 'Sin Pasillo';
                                        if (!acc[aisle]) acc[aisle] = [];
                                        acc[aisle].push(bin);
                                        return acc;
                                    }, {})
                                ).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([aisle, bins]) => (
                                    <div key={aisle} className="border border-[#d1d5db] rounded p-3 bg-[#f8f9fa]">
                                        <div className="flex items-center justify-between mb-3 border-b border-[#e5e7eb] pb-1.5">
                                            <span className="text-[12px] font-normal text-[#1f1f1f]">
                                                {t('occupancy.aisle', 'Pasillo')}: {aisle}
                                            </span>
                                            <span className="text-[11.5px] text-[#5c5c5c] font-normal font-mono">
                                                {bins.length} Bins
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                            {bins.map(bin => {
                                                const occupancyColor =
                                                    bin.occupancy_pct === 0 ? 'bg-zinc-100 text-[#1f1f1f] border-zinc-200' :
                                                        bin.occupancy_pct < 30 ? 'bg-emerald-100 text-[#065f46] border-emerald-200' :
                                                            bin.occupancy_pct < 75 ? 'bg-amber-100 text-[#92400e] border-amber-200' :
                                                                'bg-red-100 text-[#991b1b] border-red-200';

                                                return (
                                                    <div
                                                        key={bin.bin_code}
                                                        className={`border p-2 rounded flex flex-col justify-between h-16 ${occupancyColor} shadow-xs`}
                                                    >
                                                        <div className="flex justify-between items-start">
                                                            <span className="text-[11px] font-normal font-mono">{bin.bin_code}</span>
                                                            <span className={`text-[9px] font-normal px-1 rounded ${bin.spot === 'Hot'
                                                                ? 'bg-amber-600 text-white'
                                                                : 'bg-[#0067c0] text-white'
                                                                }`}>
                                                                {bin.spot}
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 flex justify-between items-end">
                                                            <span className="text-[10px] opacity-80">{bin.skus} SKUs</span>
                                                            <span className="text-[11px] font-mono font-normal">{bin.occupancy_pct}%</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Granular Analytics Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[#1f1f1f]">

                {/* 1. Spatial Distribution */}
                <div className="bg-white p-4 border border-[#d1d5db] rounded shadow-sm">
                    <h3 className="text-[13px] font-normal text-[#1f1f1f] mb-3 border-b border-[#e5e7eb] pb-1.5">
                        Distribución de Bins por Zona
                    </h3>
                    <div className="space-y-2">
                        {(() => {
                            const totalBins = Object.values(data?.analytics?.bins_by_zone || {}).reduce((acc, val) => acc + val, 0);
                            return Object.entries(data?.analytics?.bins_by_zone || {}).map(([zone, count]) => {
                                const percentage = totalBins > 0 ? ((count / totalBins) * 100).toFixed(1) : 0;
                                return (
                                    <div key={zone} className="flex justify-between items-end border-b border-[#f3f4f6] pb-1">
                                        <span className="text-[12px] font-normal text-[#1f1f1f]">{zone}</span>
                                        <span className="text-[#5c5c5c] font-normal text-[12px]">
                                            {count} Unidades
                                            <span className="text-[#0067c0] font-normal text-[11.5px] ml-1.5">({percentage}%)</span>
                                        </span>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>

                {/* 2. SKU Volume Distribution */}
                <div className="bg-white p-4 border border-[#d1d5db] rounded shadow-sm text-[#1f1f1f]">
                    <h3 className="text-[13px] font-normal text-[#1f1f1f] mb-3 border-b border-[#e5e7eb] pb-1.5">
                        {t('occupancy.sku_volume', 'Densidad de SKUs por Zona')}
                    </h3>
                    <div className="space-y-2.5">
                        {(() => {
                            const totalItems = Object.values(data?.analytics?.zones_by_items || {}).reduce((acc, val) => acc + val, 0);
                            return Object.entries(data?.analytics?.zones_by_items || {}).map(([zone, count]) => {
                                const maxVal = Math.max(...Object.values(data?.analytics?.zones_by_items || {}), 1);
                                const pct = Math.round((count / maxVal) * 100);
                                const itemPct = totalItems > 0 ? ((count / totalItems) * 100).toFixed(1) : 0;
                                return (
                                    <div key={zone}>
                                        <div className="flex justify-between text-[12px] font-normal text-[#1f1f1f] mb-1">
                                            <span>{zone}</span>
                                            <span className="text-[#5c5c5c] font-normal text-[12px]">
                                                {count}
                                                <span className="text-[#0067c0] font-normal text-[11.5px] ml-1.5">({itemPct}%)</span>
                                            </span>
                                        </div>
                                        <div className="w-full bg-[#f3f4f6] h-1.5 rounded-full overflow-hidden border border-[#e5e7eb]">
                                            <div className="h-full bg-[#0067c0]" style={{ width: `${pct}%` }}></div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>

                {/* 3. Operational Risk (Hot Aisles) */}
                <div className="bg-white p-4 border border-[#d1d5db] rounded shadow-sm text-[#1f1f1f]">
                    <h3 className="text-[13px] font-normal text-[#1f1f1f] mb-3 border-b border-[#e5e7eb] pb-1.5">
                        {t('occupancy.hot_aisles', 'Densidad Crítica (Pasillos Principales)')}
                    </h3>
                    <div className="space-y-2.5">
                        {Object.entries(data?.analytics?.top_aisles || {}).map(([aisle, count], idx) => {
                            const maxVal = Math.max(...Object.values(data?.analytics?.top_aisles || {}), 1);
                            const pct = Math.round((count / maxVal) * 100);
                            return (
                                <div key={aisle}>
                                    <div className="flex justify-between text-[12px] font-normal text-[#1f1f1f] mb-1">
                                        <span>{t('occupancy.aisle', 'Pasillo')} {aisle}</span>
                                        <span className="text-[#5c5c5c] font-normal text-[12px]">{count}</span>
                                    </div>
                                    <div className="w-full bg-[#f3f4f6] h-1.5 rounded-full overflow-hidden border border-[#e5e7eb]">
                                        <div
                                            className={`h-full ${idx === 0 ? 'bg-[#991b1b]' : 'bg-[#0067c0]'}`}
                                            style={{ width: `${pct}%` }}
                                        ></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default OccupancyDashboard;
