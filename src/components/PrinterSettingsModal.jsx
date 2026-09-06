import React, { useState, useEffect } from 'react';
import { getSystemPrinters, getPrinterConfig, savePrinterConfig, testPrintLabelNative } from '../utils/tauriBridge';

const PrinterSettingsModal = ({ isOpen, onClose }) => {
    const [printers, setPrinters] = useState([]);
    const [loadingPrinters, setLoadingPrinters] = useState(false);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const [autoPrintEnabled, setAutoPrintEnabled] = useState(false);
    const [autoPrintOnScan, setAutoPrintOnScan] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResultMsg, setTestResultMsg] = useState(null);

    useEffect(() => {
        if (!isOpen) return;

        // Cargar configuración existente
        const cfg = getPrinterConfig();
        setSelectedPrinter(cfg.default_label_printer || '');
        setAutoPrintEnabled(!!cfg.auto_print_enabled);
        setAutoPrintOnScan(!!cfg.auto_print_on_scan);
        setTestResultMsg(null);

        // Cargar lista de impresoras del sistema
        const fetchPrinters = async () => {
            setLoadingPrinters(true);
            const list = await getSystemPrinters();
            setPrinters(list || []);

            if (!cfg.default_label_printer && list && list.length > 0) {
                const defaultPrn = list.find(p => p.is_default) || list[0];
                if (defaultPrn) {
                    setSelectedPrinter(defaultPrn.name);
                }
            }
            setLoadingPrinters(false);
        };

        fetchPrinters();
    }, [isOpen]);

    const handleSave = () => {
        const newConfig = {
            default_label_printer: selectedPrinter.trim(),
            auto_print_enabled: autoPrintEnabled,
            auto_print_on_scan: autoPrintOnScan,
            print_mode: 'zpl'
        };
        savePrinterConfig(newConfig);
        onClose();
    };

    const handleTestPrint = async () => {
        setIsTesting(true);
        setTestResultMsg(null);
        const res = await testPrintLabelNative(selectedPrinter);
        if (res.success) {
            setTestResultMsg({
                type: 'success',
                text: `Etiqueta de prueba enviada exitosamente a: ${selectedPrinter || 'Predeterminada de Windows'}`
            });
        } else {
            setTestResultMsg({
                type: 'error',
                text: `Error al imprimir: ${res.error}`
            });
        }
        setIsTesting(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
            {/* Ventana Estilo Windows 11 Limpio */}
            <div className="bg-[#f3f3f3] border border-[#d1d5db] shadow-xl rounded-lg w-full max-w-md overflow-hidden flex flex-col text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif]">
                {/* Modern Window Title Bar */}
                <div className="h-9 px-3 bg-[#fbfbfb] border-b border-[#e5e5e5] flex items-center justify-between select-none">
                    <span className="text-[12px] font-normal text-[#1f1f1f]">
                        Configuración de impresión silenciosa
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#e81123] hover:text-white text-[#5f5f5f] transition-colors text-[11px] cursor-pointer"
                        title="Cerrar"
                    >
                        ✕
                    </button>
                </div>

                {/* Dialog Content Area */}
                <div className="p-3.5 space-y-3 text-[12px]">
                    {/* Tarjeta 1: Impresora de etiquetas */}
                    <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2.5">
                        <div className="flex justify-between items-center">
                            <div>
                                <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                    Impresora de etiquetas
                                </span>
                                <span className="text-[11px] text-[#7f7f7f] font-normal">
                                    Dispositivo para emisión de códigos de barra ZPL.
                                </span>
                            </div>
                            {loadingPrinters && (
                                <span className="text-[11px] text-[#7f7f7f] font-normal">Buscando...</span>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <select
                                value={selectedPrinter}
                                onChange={(e) => setSelectedPrinter(e.target.value)}
                                disabled={loadingPrinters}
                                className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] text-[#1f1f1f] font-normal"
                            >
                                <option value="">-- Usar impresora predeterminada de Windows --</option>
                                {printers.map((p) => (
                                    <option key={p.name} value={p.name}>
                                        {p.name} {p.is_default ? '(Predeterminada del sistema)' : ''}
                                    </option>
                                ))}
                            </select>
                            <span className="text-[11px] text-[#7f7f7f] font-normal block">
                                Compatible con impresoras térmicas (Zebra, TSC, Honeywell, Bixolon).
                            </span>
                        </div>

                        <div className="pt-2 flex items-center justify-between border-t border-[#f0f0f0]">
                            <span className="text-[11px] text-[#7f7f7f] font-normal">
                                Comprobar comunicación:
                            </span>
                            <button
                                type="button"
                                onClick={handleTestPrint}
                                disabled={isTesting}
                                className="h-7 py-0 px-3 bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal leading-none whitespace-nowrap transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-1.5 box-border"
                            >
                                {isTesting ? 'Imprimiendo...' : 'Probar impresión'}
                            </button>
                        </div>
                    </div>

                    {/* Tarjeta 2: Automatización */}
                    <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2">
                        <span className="text-[12px] font-normal text-[#1f1f1f] block mb-1">
                            Opciones de impresión
                        </span>

                        <div className="space-y-2">
                            <label className="flex items-start justify-between gap-3 py-1 cursor-pointer select-none">
                                <div className="space-y-0.5">
                                    <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                        Impresión silenciosa directa
                                    </span>
                                    <span className="text-[11px] text-[#7f7f7f] font-normal block leading-tight">
                                        Envía el código ZPL al spooler sin desplegar diálogo de impresión.
                                    </span>
                                </div>
                                <div className="relative inline-flex items-center cursor-pointer mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={autoPrintEnabled}
                                        onChange={(e) => setAutoPrintEnabled(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-7 h-4 bg-[#c7c7c7] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#0067c0]"></div>
                                </div>
                            </label>

                            <div className="border-t border-[#f5f5f5]"></div>

                            <label className="flex items-start justify-between gap-3 py-1 cursor-pointer select-none">
                                <div className="space-y-0.5">
                                    <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                        Imprimir al confirmar o escanear
                                    </span>
                                    <span className="text-[11px] text-[#7f7f7f] font-normal block leading-tight">
                                        Genera la etiqueta de identificación al registrar el ítem.
                                    </span>
                                </div>
                                <div className="relative inline-flex items-center cursor-pointer mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={autoPrintOnScan}
                                        onChange={(e) => setAutoPrintOnScan(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-7 h-4 bg-[#c7c7c7] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#0067c0]"></div>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Banner de resultado de prueba */}
                    {testResultMsg && (
                        <div className={`p-2 rounded text-[11px] font-normal border ${
                            testResultMsg.type === 'success'
                                ? 'bg-[#f4fbf6] text-[#107c41] border-[#c2e8cf]'
                                : 'bg-[#fdf2f2] text-[#a80000] border-[#f3c5c5]'
                        }`}>
                            {testResultMsg.text}
                        </div>
                    )}
                </div>

                {/* Dialog Footer */}
                <div className="h-11 bg-[#f3f3f3] border-t border-[#e5e5e5] px-3.5 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-7 py-0 px-3 inline-flex items-center justify-center bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal leading-none whitespace-nowrap transition-colors cursor-pointer box-border"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="h-7 py-0 px-3 inline-flex items-center justify-center bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal leading-none whitespace-nowrap transition-colors cursor-pointer box-border"
                    >
                        Guardar cambios
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PrinterSettingsModal;
