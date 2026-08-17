import React, { useState, useEffect } from 'react';
import { getSystemPrinters, getPrinterConfig, savePrinterConfig, testPrintLabelNative, isTauri } from '../utils/tauriBridge';

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

        // Cargar lista de impresoras
        const fetchPrinters = async () => {
            setLoadingPrinters(true);
            const list = await getSystemPrinters();
            setPrinters(list || []);

            // Si no hay seleccionada previamente, predeterminar la marcada por el SO
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
            setTestResultMsg({ type: 'success', text: `✅ Etiqueta de prueba enviada a: ${selectedPrinter || 'Predeterminada'}` });
        } else {
            setTestResultMsg({ type: 'error', text: `❌ Error al imprimir: ${res.error}` });
        }
        setIsTesting(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in text-zinc-900">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-zinc-200">
                {/* Header */}
                <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between" style={{ background: '#354a5f' }}>
                    <div className="flex items-center gap-2">
                        <span className="text-white text-base">🖨️</span>
                        <h3 className="text-[13px] font-semibold text-white uppercase tracking-tight">
                            Configuración de Impresión Automática
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white text-lg font-bold"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 text-[11px]">
                    {/* Selector de Impresora */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-[10px] font-semibold uppercase text-zinc-700">
                                Impresora de Etiquetas Predeterminada:
                            </label>
                            {loadingPrinters && (
                                <span className="text-[9px] text-zinc-400">Buscando impresoras...</span>
                            )}
                        </div>

                        <select
                            value={selectedPrinter}
                            onChange={(e) => setSelectedPrinter(e.target.value)}
                            disabled={loadingPrinters}
                            className="w-full h-8 px-2 text-[11px] bg-white border border-zinc-200 rounded-lg outline-none font-medium focus:border-[#285f94]"
                        >
                            <option value="">-- Usar Impresora Predeterminada del Sistema --</option>
                            {printers.map((p) => (
                                <option key={p.name} value={p.name}>
                                    {p.name} {p.is_default ? '(Predeterminada del SO)' : ''}
                                </option>
                            ))}
                        </select>
                        <span className="text-[9px] text-zinc-500 mt-1 block">
                            Selecciona la impresora térmica conectada por USB, Red o CUPS (ej. Zebra ZD420, TSC, etc.).
                        </span>
                    </div>

                    {/* Opciones de Automatización */}
                    <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200 space-y-2.5">
                        <label className="flex items-start gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={autoPrintEnabled}
                                onChange={(e) => setAutoPrintEnabled(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded text-[#285f94] focus:ring-0 cursor-pointer"
                            />
                            <div>
                                <span className="font-semibold text-zinc-800 block text-[11px]">
                                    Habilitar Impresión Silenciosa Directa
                                </span>
                                <span className="text-[9px] text-zinc-500 block">
                                    Envía las etiquetas directamente a la impresora sin mostrar el cuadro de diálogo del navegador.
                                </span>
                            </div>
                        </label>

                        <label className="flex items-start gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={autoPrintOnScan}
                                onChange={(e) => setAutoPrintOnScan(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded text-[#285f94] focus:ring-0 cursor-pointer"
                            />
                            <div>
                                <span className="font-semibold text-zinc-800 block text-[11px]">
                                    Imprimir automáticamente al escanear / confirmar ítem
                                </span>
                                <span className="text-[9px] text-zinc-500 block">
                                    Al pistolear o confirmar recepción, se imprime la etiqueta automáticamente sin clics adicionales.
                                </span>
                            </div>
                        </label>
                    </div>

                    {/* Mensaje de Resultado de Prueba */}
                    {testResultMsg && (
                        <div className={`p-2.5 rounded-lg text-[10px] font-medium border ${testResultMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                            {testResultMsg.text}
                        </div>
                    )}

                    {/* Botón de Prueba */}
                    <div className="flex items-center justify-between pt-1">
                        <button
                            type="button"
                            onClick={handleTestPrint}
                            disabled={isTesting}
                            className="px-3 py-1.5 text-[10px] font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            <span>📄</span>
                            <span>{isTesting ? 'Imprimiendo...' : 'Probar Impresión'}</span>
                        </button>
                    </div>

                    {/* Footer de Acciones */}
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 text-[10px] font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="px-4 py-1.5 text-[10px] font-medium text-white rounded-lg shadow-sm bg-[#285f94] hover:bg-[#1e4a74] transition-colors cursor-pointer"
                        >
                            Guardar Preferencias
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PrinterSettingsModal;
