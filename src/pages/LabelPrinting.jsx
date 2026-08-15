import React, { useState, useEffect, useRef } from 'react';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useReactToPrint } from 'react-to-print';
import QRCode from 'qrcode';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import SandvikLabel from '../components/labels/SandvikLabel';
import ScannerModal from '../components/ScannerModal';
import { parseGS1Barcode } from '../utils/gs1Parser';
import '../styles/Label.css';


const LabelPrinting = () => {
    const { setTitle } = useOutletContext();
    useEffect(() => { setTitle("Etiquetado"); }, [setTitle]);

    // States
    const [itemCode, setItemCode] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [itemData, setItemData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [qrImage, setQrImage] = useState(null);
    const [scannerOpen, setScannerOpen] = useState(false);

    // Refs
    const itemCodeInputRef = useRef(null);
    const labelComponentRef = useRef(null);

    // QR Code Generation
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

    const findItem = async (codeToUse) => {
        let code = (codeToUse || itemCode).trim().toUpperCase();
        if (!code) {
            toast.error("Ingrese un código de item");
            return;
        }

        const gs1 = parseGS1Barcode(code);
        if ((gs1.isGS1 || gs1.isMultiField) && gs1.itemCode) {
            code = gs1.itemCode.trim().toUpperCase();
            setItemCode(code);
            if (gs1.quantity && (!quantity || quantity === 1)) {
                setQuantity(gs1.quantity);
            }
            toast.info(`Código decodificado: ${code}`);
        }

        setLoading(true);
        setItemData(null);

        try {
            const res = await fetch(`/api/get_item_details/${encodeURIComponent(code)}`);
            const data = await res.json();

            if (res.ok) {
                setItemData({
                    itemCode: data.item_code,
                    description: data.description,
                    binLocation: data.bin_location,
                    aditionalBins: data.additional_bins,
                    weight: data.weight_kg
                });
                toast.success("Item encontrado");
            } else {
                toast.error(data.detail || "Item no encontrado");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    const handleScan = (scannedCode) => {
        setScannerOpen(false);
        if (scannedCode) {
            setItemCode(scannedCode);
            findItem(scannedCode);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: labelComponentRef,
        content: () => labelComponentRef.current,
        documentTitle: itemData ? `Etiqueta_${itemData.itemCode}` : "Etiqueta",
        pageStyle: "@page { size: 70mm 100mm; margin: 0; } body { margin: 0; -webkit-print-color-adjust: exact; }"
    });

    const totalWeight = itemData ? (parseFloat(itemData.weight || 0) * parseInt(quantity || 1)).toFixed(2) : '0.00';

    return (
        <div className="container-wrapper px-4 py-4">
            <ToastContainer position="top-right" autoClose={3000} />
            {scannerOpen && <ScannerModal onClose={() => setScannerOpen(false)} onScan={handleScan} />}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

                {/* Form Column */}
                <div className="lg:col-span-2 space-y-3 bg-white p-4 rounded shadow-sm border border-gray-200">
                    <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2 -mx-4 -mt-4 rounded-t flex justify-between items-center mb-3">
                        <h2 className="text-[12px] font-semibold text-black uppercase tracking-wider">
                            Imprimir Etiqueta
                        </h2>
                    </div>

                    <div>
                        <label className="form-label font-normal text-black">Item Code</label>
                        <div className="flex items-center gap-2">
                            <input
                                ref={itemCodeInputRef}
                                type="text"
                                value={itemCode}
                                onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && findItem()}
                                className="font-normal text-black border border-zinc-400 focus:border-black outline-none uppercase flex-grow h-[30px] px-2 rounded"
                                placeholder="Ingrese código o escanee GS1/QR"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={() => setScannerOpen(true)}
                                className="h-[30px] px-3 bg-zinc-700 text-white rounded hover:bg-zinc-800 transition-colors flex items-center justify-center flex-shrink-0"
                                title="Escanear con cámara"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/>
                                    <path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/>
                                </svg>
                            </button>
                            <button
                                onClick={() => findItem()}
                                className="h-[30px] px-4 text-[10px] text-white rounded-lg shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest active:scale-95 transition-all flex-shrink-0"
                                style={{ background: '#285f94' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#1e4a74'}
                                onMouseLeave={e => e.currentTarget.style.background = '#285f94'}
                                disabled={loading}
                            >
                                {loading ? '...' : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                                        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="mb-2">
                        <label className="form-label font-normal text-black">Item Description</label>
                        <div className="data-field font-normal text-black border-b border-gray-200 pb-1">{itemData?.description || ''}</div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                        <div>
                            <label className="form-label font-normal text-black">Quantity Per Pack</label>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                min="1"
                                className="font-normal text-base text-black border border-zinc-400 focus:border-black outline-none w-full h-[30px] px-2 rounded"
                            />
                        </div>
                        <div>
                            <label className="form-label font-normal text-black">Bin Location</label>
                            <div className="data-field font-normal text-blue-800 bg-blue-50 px-2 py-1 rounded border border-blue-100" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.binLocation || ''}</div>
                        </div>
                        <div>
                            <label className="form-label font-normal text-black">Additional Bins</label>
                            <div className="data-field text-xs font-normal text-black bg-zinc-50 px-2 py-0.5 rounded" style={{ padding: '0.25rem', height: '30px', minHeight: '30px' }}>{itemData?.aditionalBins || ''}</div>
                        </div>
                    </div>
                </div>

                {/* Label Preview Column */}
                <div className="lg:col-span-1 bg-white p-3 rounded shadow-sm border border-gray-200 flex flex-col justify-between max-w-sm mx-auto w-full">
                    <h2 className="text-[12px] font-semibold text-black uppercase tracking-wider mb-2 border-b border-zinc-100 pb-1.5 flex items-center gap-1.5">
                        Vista Previa
                    </h2>

                    {/* Print Area Preview */}
                    <div className="flex-grow flex flex-col justify-center items-center py-1">
                        <div className="border border-zinc-200 p-0 rounded bg-zinc-50 shadow-inner transform origin-center">
                            <div ref={labelComponentRef} className="bg-white">
                                <SandvikLabel 
                                    data={itemData} 
                                    qrImage={qrImage} 
                                    quantity={quantity} 
                                    totalWeight={totalWeight} 
                                />
                            </div>
                        </div>
                    </div>

                    <div className="w-full flex justify-center mt-2">
                        <button
                            onClick={handlePrint}
                            disabled={!itemData}
                            className={`h-[30px] px-6 text-[10px] text-white rounded-lg shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest active:scale-95 transition-all ${!itemData ? 'opacity-60 cursor-not-allowed' : ''}`}
                            style={{ background: '#285f94' }}
                            onMouseEnter={e => itemData && (e.currentTarget.style.background = '#1e4a74')}
                            onMouseLeave={e => itemData && (e.currentTarget.style.background = '#285f94')}
                        >
                            Imprimir Etiqueta
                        </button>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default LabelPrinting;
