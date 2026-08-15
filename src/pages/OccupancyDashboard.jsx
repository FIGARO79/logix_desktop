import React, { useState, useEffect } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import axios from 'axios';
import { toast } from 'react-toastify';

const OccupancyDashboard = () => {
    const { setTitle } = useOutletContext();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedCell, setSelectedCell] = useState(null); // { zone, level }
    const [cellDetails, setCellDetails] = useState([]);
    const [loadingDetails, setLoadingDetails] = useState(false);

    useEffect(() => {
        if (setTitle) setTitle('Ocupación de Bodega');
        fetchData();
    }, [setTitle]);

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
    const zones = Object.keys(data.zones).sort();

    return (
        <div className="max-w-[1600px] mx-auto px-6 pt-3 pb-6 font-sans bg-[#fcfcfc] min-h-screen text-black text-[12px] antialiased">

            {/* Barra de Acciones */}
            <div className="mb-2 border-b border-zinc-200 pb-1.5 flex justify-end items-center">
                <button
                    onClick={fetchData}
                    className="px-3 py-1.5 border border-black text-black bg-white text-[10px] font-normal uppercase tracking-tight rounded hover:bg-black hover:text-white transition-all shadow-sm"
                >
                    Actualizar Datos
                </button>
            </div>

            {/* Global Utilization Summary */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4">
                {[
                    { label: 'Total Bins', val: data.summary.total_bins, color: 'text-black' },
                    { label: 'Filled Capacity', val: data.summary.filled_bins, color: 'text-black' },
                    { label: 'Available', val: data.summary.available_bins, color: 'text-black' },
                    { label: 'Utilization %', val: `${data.summary.occupancy_pct}%`, color: data.summary.occupancy_pct > 85 ? 'text-red-750' : 'text-black' },
                    { label: 'Active SKUs', val: data.summary.total_items, color: 'text-black' },
                    { label: 'Density (SKU/Bin)', val: data.summary.avg_items_per_bin, color: 'text-black' }
                ].map((s, i) => (
                    <div key={i} className="bg-white px-3 py-1.5 border border-zinc-200 shadow-sm text-black">
                        <label className="text-[12px] uppercase text-black font-normal tracking-tight block mb-0.5 leading-tight">{s.label}</label>
                        <p className={`text-[20px] font-normal font-mono leading-none ${s.color}`}>{s.val}</p>
                    </div>
                ))}
            </div>

            {/* Heatmap Matrix Section */}
            <div className="bg-white border border-zinc-300 shadow-sm mb-8 overflow-hidden text-black">
                <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex justify-between items-center text-black">
                    <h3 className="text-[12px] font-normal text-black uppercase tracking-widest">
                        Matriz de Saturación de Bins (Nivel vs Zona)
                    </h3>
                </div>
                <div className="overflow-x-auto text-black">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-zinc-950">
                                <th className="px-6 py-3 text-left text-[12px] font-normal text-white uppercase tracking-wider border-b border-zinc-900">Identificador de Zona</th>
                                {allLevels.map(level => (
                                    <th key={level} className="px-2 py-3 text-center text-[12px] font-normal text-white uppercase tracking-wider border-b border-zinc-800">
                                        Nivel {level}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                            {zones.map(zoneName => {
                                const zoneData = data.zones[zoneName];
                                const zoneOccupancyPct = zoneData.total > 0
                                    ? Math.round((zoneData.occupied / zoneData.total) * 100)
                                    : 0;
                                const isZoneSelected = selectedCell && selectedCell.zone === zoneName && selectedCell.level === null;
                                return (
                                    <tr key={zoneName} className="hover:bg-zinc-50/50 transition-colors">
                                        <td
                                            onClick={() => handleCellClick(zoneName, null)}
                                            className={`px-6 py-4 cursor-pointer transition-all duration-200 ${isZoneSelected
                                                ? 'bg-zinc-100 border-l-4 border-black font-semibold'
                                                : 'hover:bg-zinc-100/70'
                                                }`}
                                        >
                                            <div className="text-[12px] font-normal text-black uppercase tracking-tight flex items-center gap-1.5">
                                                <span className="hover:underline">{zoneName}</span>
                                                <span className="text-[10px] text-zinc-400 font-normal lowercase tracking-normal">(Ver todo)</span>
                                            </div>
                                            <div className="text-[12px] text-zinc-500 font-normal mt-1 uppercase tracking-tight">
                                                {zoneData.total} Bins Total • {zoneOccupancyPct}% Ocupación
                                            </div>
                                        </td>
                                        {allLevels.map(level => {
                                            const levelData = zoneData.levels[level] || { total: 0, full_bins: 0, occupied_skus: 0, total_occupancy_pct: 0, occupied_bins: 0 };
                                            const occupancyPercent = levelData.total > 0
                                                ? (levelData.total_occupancy_pct !== undefined
                                                    ? Math.round(levelData.total_occupancy_pct / levelData.total)
                                                    : Math.round((levelData.full_bins / levelData.total) * 100))
                                                : 0;

                                            const isSelected = selectedCell && selectedCell.zone === zoneName && selectedCell.level === level;

                                            return (
                                                <td key={level} className="px-1 py-2">
                                                    {levelData.total > 0 ? (
                                                        <div
                                                            onClick={() => handleCellClick(zoneName, level)}
                                                            className={`
                                                                w-full h-16 flex flex-col items-center justify-center rounded-sm border
                                                                ${getHeatmapStyle(occupancyPercent)}
                                                                cursor-pointer hover:border-zinc-400 hover:shadow-sm transition-all duration-200
                                                                ${isSelected ? 'ring-2 ring-black border-transparent scale-105 shadow-md z-10' : ''}
                                                            `}
                                                        >
                                                            <span className="text-[12px] font-normal leading-none mb-1 text-black">{occupancyPercent}%</span>
                                                            <div className="text-[12px] uppercase tracking-tighter font-normal opacity-90 text-center text-black">
                                                                {levelData.occupied_bins !== undefined ? levelData.occupied_bins : levelData.full_bins}/{levelData.total} Bins
                                                            </div>
                                                            <div className="text-[12px] font-normal opacity-85 text-black">
                                                                {levelData.occupied_skus} SKUs
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="h-16 flex items-center justify-center text-zinc-200 font-mono text-[12px]">
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
                <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center gap-6 text-black">
                    <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 bg-emerald-200 border border-emerald-300 rounded-sm"></div>
                        <span className="text-[12px] font-normal text-black uppercase tracking-wider">Baja Utilización</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 bg-amber-200 border border-amber-300 rounded-sm"></div>
                        <span className="text-[12px] font-normal text-black uppercase tracking-wider">Carga Óptima</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 bg-red-300 border border-red-300 rounded-sm"></div>
                        <span className="text-[12px] font-normal text-black uppercase tracking-wider">Saturado</span>
                    </div>
                    <div className="ml-auto text-[12px] font-normal text-black">
                        * Los valores indican bins alcanzando umbrales de capacidad configurados.
                    </div>
                </div>
            </div>

            {/* Bin Details Matrix Section */}
            {selectedCell && (
                <div className="bg-white border border-zinc-300 shadow-md mb-8 overflow-hidden transition-all duration-300 text-black">
                    <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50 flex justify-between items-center text-black">
                        <div>
                            <h3 className="text-[12px] font-normal text-black uppercase tracking-tight">
                                Mapa de Ubicaciones: Zona {selectedCell.zone} {selectedCell.level !== null ? `— Nivel ${selectedCell.level}` : '— Todos los Niveles'}
                            </h3>
                            <p className="text-[12px] text-black font-normal uppercase tracking-tight mt-1">
                                {loadingDetails ? 'Cargando infraestructura...' : `${cellDetails.length} Ubicaciones encontradas`}
                            </p>
                        </div>
                        <button
                            onClick={() => { setSelectedCell(null); setCellDetails([]); }}
                            className="text-black hover:text-zinc-500 transition-colors p-1"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="p-6">
                        {loadingDetails ? (
                            <div className="flex flex-col items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 mb-4"></div>
                                <span className="text-[12px] font-normal uppercase tracking-tight text-black">Analizando mapa de slots...</span>
                            </div>
                        ) : cellDetails.length === 0 ? (
                            <div className="text-center py-12 text-black text-[12px] font-normal">
                                No se encontraron bins configurados para la Zona {selectedCell.zone} {selectedCell.level !== null ? `en el Nivel ${selectedCell.level}` : 'en ningún nivel'}.
                            </div>
                        ) : (
                            <div className="space-y-8 text-black">
                                {/* Agrupar por Pasillo */}
                                {Object.entries(
                                    cellDetails.reduce((acc, bin) => {
                                        const aisle = bin.aisle || 'Sin Pasillo';
                                        if (!acc[aisle]) acc[aisle] = [];
                                        acc[aisle].push(bin);
                                        return acc;
                                    }, {})
                                ).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([aisle, bins]) => (
                                    <div key={aisle} className="border border-zinc-200 rounded-sm p-4 bg-zinc-50/50">
                                        <div className="flex items-center justify-between mb-4 border-b border-zinc-200 pb-2">
                                            <span className="text-[12px] font-normal text-black uppercase tracking-tight">
                                                Pasillo: {aisle}
                                            </span>
                                            <span className="text-[12px] text-black font-normal font-mono">
                                                {bins.length} Bins
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                                            {bins.map(bin => {
                                                const occupancyColor =
                                                    bin.occupancy_pct === 0 ? 'bg-zinc-100 text-black border-zinc-200 font-normal' :
                                                        bin.occupancy_pct < 30 ? 'bg-emerald-200 text-black border-emerald-300 font-normal' :
                                                            bin.occupancy_pct < 75 ? 'bg-amber-200 text-black border-amber-300 font-normal' :
                                                                'bg-red-300 text-black border-red-300 font-normal';

                                                return (
                                                    <div
                                                        key={bin.bin_code}
                                                        className={`border p-2.5 rounded-sm flex flex-col justify-between h-20 ${occupancyColor} shadow-sm`}
                                                    >
                                                        <div className="flex justify-between items-start">
                                                            <span className="text-[12px] font-normal font-mono tracking-tight text-black">{bin.bin_code}</span>
                                                            <span className={`text-[12px] uppercase font-normal px-1 rounded-sm ${bin.spot === 'Hot'
                                                                ? 'bg-orange-500 text-white'
                                                                : 'bg-blue-500 text-white'
                                                                }`}>
                                                                {bin.spot}
                                                            </span>
                                                        </div>
                                                        <div className="mt-2 flex justify-between items-end">
                                                            <div className="flex flex-col">
                                                                <span className="text-[12px] uppercase tracking-tighter opacity-80 text-black">SKUs</span>
                                                                <span className="text-[12px] font-normal font-mono leading-none text-black">{bin.skus}</span>
                                                            </div>
                                                            <div className="text-right">
                                                                <span className="text-[12px] font-mono font-normal text-black">{bin.occupancy_pct}%</span>
                                                            </div>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-black">

                {/* 1. Spatial Distribution */}
                <div className="bg-white p-6 border border-zinc-200 shadow-sm">
                    <h3 className="text-[14px] font-normal text-black uppercase tracking-normal mb-4 border-b border-zinc-100 pb-2">
                        Distribución de Bins por Zona
                    </h3>
                    <div className="space-y-4">
                        {(() => {
                            const totalBins = Object.values(data.analytics.bins_by_zone).reduce((acc, val) => acc + val, 0);
                            return Object.entries(data.analytics.bins_by_zone).map(([zone, count]) => {
                                const percentage = totalBins > 0 ? ((count / totalBins) * 100).toFixed(1) : 0;
                                return (
                                    <div key={zone} className="flex justify-between items-end border-b border-zinc-50 pb-1.5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[14px] font-normal text-black">{zone}</span>
                                        </div>
                                        <span className="text-black font-normal text-[14px]">
                                            {count} <span className="text-[14px] ml-0.5 text-black font-normal">Units</span>
                                            <span className="text-black font-normal text-[14px] ml-2">({percentage}%)</span>
                                        </span>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>

                {/* 2. SKU Volume Distribution */}
                <div className="bg-white p-6 border border-zinc-200 shadow-sm text-black">
                    <h3 className="text-[14px] font-normal text-black uppercase tracking-normal mb-4 border-b border-zinc-100 pb-2">
                        Densidad de SKUs por Zona
                    </h3>
                    <div className="space-y-4">
                        {(() => {
                            const totalItems = Object.values(data.analytics.zones_by_items).reduce((acc, val) => acc + val, 0);
                            return Object.entries(data.analytics.zones_by_items).map(([zone, count]) => {
                                const maxVal = Object.values(data.analytics.zones_by_items)[0] || 1;
                                const pct = Math.round((count / maxVal) * 100);
                                const itemPct = totalItems > 0 ? ((count / totalItems) * 100).toFixed(1) : 0;
                                return (
                                    <div key={zone}>
                                        <div className="flex justify-between text-[14px] font-normal text-black mb-1 tracking-normal">
                                            <span>{zone}</span>
                                            <span className="text-black font-normal text-[14px]">
                                                {count}
                                                <span className="text-black font-normal text-[14px] ml-2">({itemPct}%)</span>
                                            </span>
                                        </div>
                                        <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500" style={{ width: `${pct}%` }}></div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>

                {/* 3. Operational Risk (Hot Aisles) */}
                <div className="bg-white p-6 border border-zinc-200 shadow-sm text-black">
                    <h3 className="text-[14px] font-normal text-black uppercase tracking-normal mb-4 border-b border-zinc-100 pb-2">
                        Densidad Crítica (Pasillos Principales)
                    </h3>
                    <div className="space-y-4">
                        {Object.entries(data.analytics.top_aisles).map(([aisle, count], idx) => {
                            const maxVal = Object.values(data.analytics.top_aisles)[0] || 1;
                            const pct = Math.round((count / maxVal) * 100);
                            return (
                                <div key={aisle}>
                                    <div className="flex justify-between text-[14px] font-normal text-black mb-1 tracking-normal">
                                        <span>Pasillo {aisle}</span>
                                        <span className="text-black font-normal text-[14px]">{count}</span>
                                    </div>
                                    <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${idx === 0 ? 'bg-red-600' : 'bg-blue-500'}`}
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
