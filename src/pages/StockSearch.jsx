import React, { useState } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useNavigate } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ScannerModal from '../components/ScannerModal';
import { parseGS1Barcode } from '../utils/gs1Parser';

const StockSearch = () => {
    const { setTitle } = useOutletContext();
    const navigate = useNavigate();
    const inputRef = React.useRef(null);
    const [itemCode, setItemCode] = useState('');
    const [itemData, setItemData] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [scannerOpen, setScannerOpen] = useState(false);

    React.useEffect(() => {
        setTitle("Consulta de Stock");
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }, 50);
    }, [setTitle]);

    // Audio Beep Function
    const playBeep = () => {
        // Only play sound on mobile devices
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (!isMobile) return;

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // 800Hz beep
        oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15);
    };

    // Función para ejecutar búsqueda directamente (usada por el scanner o botón)
    const executeSearch = async (query) => {
        let cleanQuery = query ? query.trim() : '';
        if (!cleanQuery) return;

        const gs1 = parseGS1Barcode(cleanQuery);
        if ((gs1.isGS1 || gs1.isMultiField) && gs1.itemCode) {
            cleanQuery = gs1.itemCode.trim();
            setItemCode(cleanQuery);
        }

        setLoading(true);
        setError('');
        setItemData(null);
        setSearchResults([]);

        try {
            const res = await fetch(`/api/search_items?q=${encodeURIComponent(query)}`);
            const data = await res.json();

            if (res.ok) {
                if (data.length === 0) {
                    setError('Item no encontrado');
                    toast.error('Item no encontrado');
                } else if (data.length === 1) {
                    setItemData(data[0]);
                    playBeep(); // Beep on success
                    setItemCode(''); // Clear input on success
                } else {
                    setSearchResults(data);
                }
            } else {
                setError(data.error || 'Error en la búsqueda');
                toast.error(data.error || 'Error en la búsqueda');
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión');
            toast.error('Error de conexión al servidor');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectResult = (item) => {
        setItemData(item);
        setSearchResults([]);
        setItemCode('');
        playBeep();
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleScan = (code) => {
        setScannerOpen(false);
        setItemCode(code);
        executeSearch(code);
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!itemCode.trim()) return;
        executeSearch(itemCode);
    };

    const clearSearch = () => {
        setItemCode('');
        setItemData(null);
        setSearchResults([]);
        setError('');
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    return (
        <div className="container-wrapper max-w-4xl mx-auto px-4 py-8">
            <ToastContainer position="top-right" autoClose={3000} />

            {/* Search Card */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6 border border-gray-200">
                <div className="bg-gray-50 text-gray-900 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Búsqueda de Stock
                    </h2>
                    <button
                        onClick={() => navigate('/spot-check')}
                        className="btn-sap btn-secondary text-[9px] uppercase font-normal tracking-normal px-4 flex items-center"
                    >
                        Verificar Saldo
                    </button>
                </div>

                <div className="p-6">
                    <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
                        <div className="flex-grow">
                            <label className="form-label mb-1">Código o Descripción</label>
                            <input
                                ref={inputRef}
                                type="text"
                                value={itemCode}
                                onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                                className="w-full uppercase"
                                placeholder="Escribe código o descripción..."
                                autoFocus
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <button
                                type="button"
                                onClick={() => setScannerOpen(true)}
                                className="btn-sap btn-secondary w-[35px] h-[35px] !p-0 flex items-center justify-center"
                                title="Escanear Código"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                                </svg>
                            </button>
                            <button
                                type="submit"
                                className="btn-sap btn-primary h-[35px]"
                                disabled={loading}
                            >
                                {loading ? 'Buscando...' : 'Consultar'}
                            </button>
                            <button
                                type="button"
                                onClick={clearSearch}
                                className="btn-sap btn-secondary h-[35px]"
                            >
                                Limpiar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Selection Results */}
            {searchResults.length > 0 && (
                <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6 border border-gray-200">
                    <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-900 text-gray-700">Múltiples resultados encontrados ({searchResults.length}):</h3>
                    </div>
                    <ul className="divide-y divide-gray-200 max-h-64 overflow-y-auto">
                        {searchResults.map((item) => (
                            <li 
                                key={item.itemCode}
                                onClick={() => handleSelectResult(item)}
                                className="px-6 py-3 hover:bg-blue-50 cursor-pointer transition-colors flex justify-between items-center"
                            >
                                <div>
                                    <div className="font-medium text-gray-900 text-[#1e4a74]">{item.itemCode}</div>
                                    <div className="text-sm text-gray-600 truncate max-w-md">{item.description}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs font-medium text-gray-900 text-gray-400 uppercase">Stock</div>
                                    <div className="font-medium text-gray-900 text-gray-800">{item.physicalQty}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Results Card */}
            {itemData && (
                <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200 animate-fade-in">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                        <h3 className="font-medium text-gray-900 text-gray-800 text-lg">{itemData.itemCode}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium text-gray-900 ${parseFloat(String(itemData.physicalQty || '0').replace(',', '')) > 0
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                            }`}>
                            {parseFloat(String(itemData.physicalQty || '0').replace(',', '')) > 0 ? 'EN STOCK' : 'SIN STOCK'}
                        </span>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="col-span-1 md:col-span-2">
                            <label className="form-label text-gray-700 font-medium text-gray-900">Descripción</label>
                            <div className="text-gray-900 font-medium text-gray-900 text-lg">{itemData.description}</div>
                        </div>

                        <div>
                            <label className="form-label text-gray-700 font-medium text-gray-900">Ubicación Principal</label>
                            <div className="mt-1">
                                <span className="inline-flex items-center px-4 py-1.5 rounded-md text-lg font-medium text-gray-900 bg-blue-100 text-[#1e4a74] border border-blue-200 shadow-sm">
                                    {itemData.binLocation || 'N/A'}
                                </span>
                            </div>
                        </div>

                        <div>
                            <label className="form-label text-gray-700 font-medium text-gray-900">Stock Físico</label>
                            <div className="mt-1">
                                <span className="inline-flex items-center px-4 py-1.5 rounded-md text-lg font-black bg-blue-100 text-[#1e4a74] border border-blue-200 shadow-sm">
                                    {itemData.physicalQty}
                                </span>
                            </div>
                        </div>

                        {itemData.aditionalBins && (
                            <div className="col-span-1 md:col-span-2">
                                <label className="form-label text-gray-700 font-medium text-gray-900">Ubicaciones Adicionales</label>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {itemData.aditionalBins.split(',').map((bin, index) => (
                                        bin.trim() && (
                                            <span key={index} className="inline-flex items-center px-3 py-1 rounded-md text-sm font-medium text-gray-900 bg-blue-50 text-[#1e4a74] border border-blue-200 shadow-sm">
                                                {bin.trim()}
                                            </span>
                                        )
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 col-span-1 md:col-span-2 border-t pt-4 mt-2">
                            <div>
                                <label className="form-label text-gray-700 font-medium text-gray-900">Peso (kg)</label>
                                <div className="text-gray-900 font-medium text-gray-900">{itemData.weight || '-'}</div>
                            </div>
                            <div>
                                <label className="form-label text-gray-700 font-medium text-gray-900">Última Fecha Ingreso</label>
                                <div className="text-gray-900 font-medium text-gray-900">{itemData.dateLastReceived || '-'}</div>
                            </div>
                            <div>
                                <label className="form-label text-gray-700 font-medium text-gray-900">Reemplazado Por</label>
                                <div className="text-gray-900 font-medium text-gray-900">{itemData.supersededBy || '-'}</div>
                            </div>
                            <div>
                                <label className="form-label text-gray-700 font-medium text-gray-900">SIC Code</label>
                                <div className="font-medium text-gray-900 text-gray-900">{itemData.sicCode || '-'}</div>
                            </div>
                            <div>
                                <label className="form-label text-gray-700 font-medium text-gray-900">ABC Code</label>
                                <div className="font-medium text-gray-900 text-gray-900">{itemData.itemType || '-'}</div>
                            </div>
                            <div>
                                <label className="form-label text-gray-700 font-medium text-gray-900">Frozen Qty</label>
                                <div className={`font-medium text-gray-900 ${parseFloat(String(itemData.frozenQty || '0')) > 0 ? 'text-red-700 bg-red-50 inline-block px-2 py-0.5 rounded' : 'text-gray-900'}`}>
                                    {itemData.frozenQty || '0'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty State / Intro */}
            {!itemData && searchResults.length === 0 && !error && (
                <div className="text-center text-gray-500 mt-12">
                    <p>Ingrese un código de item o parte de su descripción para consultar.</p>
                </div>
            )}

            {/* Scanner Modal */}
            {/* Scanner Modal */}
            {scannerOpen && (
                <ScannerModal
                    onScan={handleScan}
                    onClose={() => setScannerOpen(false)}
                />
            )}
        </div>
    );
};

export default StockSearch;
