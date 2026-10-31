import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useReactToPrint } from 'react-to-print';
import QRCode from 'qrcode';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import SandvikLabel from '../components/labels/SandvikLabel';
import ScannerModal from '../components/ScannerModal';
import PrinterSettingsModal from '../components/PrinterSettingsModal';
import { parseGS1Barcode } from '../utils/gs1Parser';
import { getPrinterConfig, printSandvikLabelSilent, isTauri } from '../utils/tauriBridge';
import '../styles/Label.css';


const LabelPrinting = () => {
    const { setTitle } = useOutletContext();
    const location = useLocation();
    useEffect(() => { setTitle("Etiquetado"); }, [setTitle]);

    // States
    const [itemCode, setItemCode] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [itemData, setItemData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [qrImage, setQrImage] = useState(null);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [printerModalOpen, setPrinterModalOpen] = useState(false);

    // Refs
    const itemCodeInputRef = useRef(null);
    const labelComponentRef = useRef(null);

    // Initial item loading from navigation state
    useEffect(() => {
        if (location.state?.itemCode) {
            const initialCode = location.state.itemCode.trim().toUpperCase();
            setItemCode(initialCode);
            findItem(initialCode);
        }
    }, [location.state]);

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


    const printSilentOrFallback = async (dataToPrint, qtyToPrint) => {
        const cfg = getPrinterConfig();
        const currentData = dataToPrint || itemData;
        const currentQty = qtyToPrint || quantity || 1;

        if (!currentData) return;

        const weightCalc = (parseFloat(currentData.weight || 0) * parseInt(currentQty, 10)).toFixed(2);

        if (isTauri() && cfg.auto_print_enabled) {
            const payload = {
                itemCode: currentData.itemCode,
                description: currentData.description,
                quantity: currentQty,
                weight: weightCalc,
                binLocation: currentData.binLocation || '',
                qrData: currentData.itemCode
            };
            const res = await printSandvikLabelSilent(payload, cfg.default_label_printer);
            if (res.success) {
                toast.success(`Etiqueta enviada a: ${cfg.default_label_printer || 'Predeterminada'}`);
                return;
            } else {
                toast.warn(`Fallo en impresión silenciosa (${res.error}), abriendo diálogo...`);
            }
        }

        // Fallback al diálogo react-to-print
        triggerReactPrint();
    };

    const findItem = async (codeToUse) => {
        let code = (codeToUse || itemCode).trim().toUpperCase();
        if (!code) {
            toast.error("Ingrese un código de item");
            return;
        }

        const gs1 = parseGS1Barcode(code);
        let decodedQty = quantity;
        if ((gs1.isGS1 || gs1.isMultiField) && gs1.itemCode) {
            code = gs1.itemCode.trim().toUpperCase();
            setItemCode(code);
            if (gs1.quantity && (!quantity || quantity === 1)) {
                decodedQty = gs1.quantity;
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
                const foundObj = {
                    itemCode: data.item_code,
                    description: data.description,
                    binLocation: data.bin_location,
                    aditionalBins: data.additional_bins,
                    weight: data.weight_kg
                };
                setItemData(foundObj);
                toast.success("Item encontrado");

                // Auto-imprimir si está habilitada la opción en configuración
                const cfg = getPrinterConfig();
                if (cfg.auto_print_on_scan && cfg.auto_print_enabled) {
                    setTimeout(() => {
                        printSilentOrFallback(foundObj, decodedQty);
                    }, 200);
                }
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

    const triggerReactPrint = useReactToPrint({
        contentRef: labelComponentRef,
        documentTitle: itemData ? `Etiqueta_${itemData.itemCode}` : "Etiqueta",
        pageStyle: `
            @page {
                size: 70mm 100mm;
                margin: 0;
            }
            @media print {
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 70mm !important;
                    height: 100mm !important;
                    background: #ffffff !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
            }
        `
    });

    const handlePrintClick = () => {
        printSilentOrFallback(itemData, quantity);
    };

    const totalWeight = itemData ? (parseFloat(itemData.weight || 0) * parseInt(quantity || 1)).toFixed(2) : '0.00';

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f8f9fa] min-h-screen text-[#1f1f1f] text-[12px]">
            <ToastContainer position="top-right" autoClose={3000} />
            {scannerOpen && <ScannerModal onClose={() => setScannerOpen(false)} onScan={handleScan} />}
            <PrinterSettingsModal isOpen={printerModalOpen} onClose={() => setPrinterModalOpen(false)} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">

                {/* Form Column */}
                <div className="lg:col-span-2 space-y-3 bg-white p-4 rounded border border-[#e5e7eb] shadow-xs">
                    <div className="border-b border-[#e5e7eb] pb-2 mb-3">
                        <h2 className="text-[12px] font-normal text-[#1f1f1f] uppercase tracking-normal">
                            Imprimir Etiqueta
                        </h2>
                    </div>

                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">Item Code</label>
                        <div className="flex items-center gap-2">
                            <input
                                ref={itemCodeInputRef}
                                type="text"
                                value={itemCode}
                                onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && findItem()}
                                className="h-7 px-2 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f] uppercase flex-grow"
                                placeholder="Ingrese código o escanee GS1/QR"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={() => setScannerOpen(true)}
                                className="h-7 px-2.5 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] rounded transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer shadow-xs"
                                title="Escanear con cámara"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/>
                                    <path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/>
                                </svg>
                            </button>
                            <button
                                onClick={() => findItem()}
                                className="h-7 px-3 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors flex items-center justify-center gap-1.5 flex-shrink-0 cursor-pointer shadow-xs"
                                disabled={loading}
                            >
                                {loading ? '...' : 'Buscar'}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">Item Description</label>
                        <div className="h-7 px-2 text-[12px] font-normal border border-[#e5e7eb] bg-[#f9fafb] rounded text-[#1f1f1f] flex items-center">{itemData?.description || '-'}</div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                            <label className="block text-[12px] font-normal text-[#374151] mb-1">Quantity Per Pack</label>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                min="1"
                                className="w-full h-7 px-2 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                            />
                        </div>
                        <div>
                            <label className="block text-[12px] font-normal text-[#374151] mb-1">Bin Location</label>
                            <div className="h-7 px-2 text-[12px] font-normal border border-[#bfdbfe] bg-[#eff6ff] text-[#1e40af] rounded flex items-center">{itemData?.binLocation || '-'}</div>
                        </div>
                        <div>
                            <label className="block text-[12px] font-normal text-[#374151] mb-1">Additional Bins</label>
                            <div className="h-7 px-2 text-[12px] font-normal border border-[#e5e7eb] bg-[#f9fafb] text-[#1f1f1f] rounded flex items-center">{itemData?.aditionalBins || '-'}</div>
                        </div>
                    </div>
                </div>

                {/* Label Preview Column */}
                <div className="lg:col-span-1 bg-white p-4 rounded border border-[#e5e7eb] shadow-xs flex flex-col justify-between max-w-sm mx-auto w-full">
                    <div className="border-b border-[#e5e7eb] pb-2 mb-3">
                        <h2 className="text-[12px] font-normal text-[#1f1f1f] uppercase tracking-normal">
                            Vista Previa
                        </h2>
                    </div>

                    {/* Print Area Preview */}
                    <div className="flex-grow flex flex-col justify-center items-center py-2">
                        <div className="border border-[#e5e7eb] p-0 rounded bg-white shadow-xs transform origin-center">
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

                    <div className="w-full flex items-center justify-center gap-2 mt-3 pt-3 border-t border-[#f3f4f6]">
                        <button
                            type="button"
                            onClick={() => setPrinterModalOpen(true)}
                            className="h-7 px-3 text-[12px] font-normal text-[#1f1f1f] bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] rounded shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                            title="Configurar Impresora Predeterminada e Impresión Silenciosa"
                        >
                            Impresora
                        </button>
                        <button
                            onClick={handlePrintClick}
                            disabled={!itemData}
                            className={`h-7 px-3.5 text-[12px] font-normal text-white bg-[#0067c0] hover:bg-[#005a9e] rounded shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${!itemData ? 'opacity-50 cursor-not-allowed' : ''}`}
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
