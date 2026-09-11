import React, { useState, useEffect, useRef } from 'react';

/**
 * PackageDimensionsModal — Modal de ingreso manual de medidas de bultos
 * Cumple estrictamente con las directivas de diseño Windows 11 Fluent UI:
 * - Tipografía Segoe UI con peso normal (font-normal)
 * - Texto en negro pleno (#1f1f1f / #000000)
 * - Cero emojis decorativos (iconos SVG monocromáticos discretos)
 * - Cursores estándar pointer (cursor-pointer)
 */
const PackageDimensionsModal = ({
    isOpen,
    onClose,
    packageNumber,
    initialDimensions = null,
    onConfirm,
    onClear = null
}) => {
    const [length, setLength] = useState('');
    const [width, setWidth] = useState('');
    const [height, setHeight] = useState('');
    const [weight, setWeight] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    const lengthInputRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        if (initialDimensions) {
            setLength(initialDimensions.length ? String(initialDimensions.length) : '');
            setWidth(initialDimensions.width ? String(initialDimensions.width) : '');
            setHeight(initialDimensions.height ? String(initialDimensions.height) : '');
            setWeight(initialDimensions.weight ? String(initialDimensions.weight) : '');
        } else {
            setLength('');
            setWidth('');
            setHeight('');
            setWeight('');
        }
        setErrorMsg('');

        const timer = setTimeout(() => {
            if (lengthInputRef.current) {
                lengthInputRef.current.focus();
                lengthInputRef.current.select();
            }
        }, 80);

        return () => clearTimeout(timer);
    }, [isOpen, initialDimensions, packageNumber]);

    if (!isOpen) return null;

    const numL = parseFloat(length) || 0;
    const numW = parseFloat(width) || 0;
    const numH = parseFloat(height) || 0;
    const numWeight = parseFloat(weight) || 0;

    // Volumen en metros cúbicos (m³) y centímetros cúbicos (cm³)
    const volumeM3 = (numL * numW * numH) / 1000000;
    // Peso volumétrico IATA estándar (L x W x H / 5000)
    const volumetricWeightKg = (numL * numW * numH) / 5000;

    const handleApplyPreset = (presetL, presetW, presetH, presetWeight = '') => {
        setLength(String(presetL));
        setWidth(String(presetW));
        setHeight(String(presetH));
        if (presetWeight) setWeight(String(presetWeight));
        setErrorMsg('');
    };

    const handleSave = () => {
        if (numL <= 0 || numW <= 0 || numH <= 0) {
            setErrorMsg('Por favor ingrese valores mayores a cero para Largo, Ancho y Alto.');
            return;
        }

        onConfirm({
            length: Math.round(numL * 10) / 10,
            width: Math.round(numW * 10) / 10,
            height: Math.round(numH * 10) / 10,
            weight: numWeight > 0 ? Math.round(numWeight * 100) / 100 : 0
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4"
            onKeyDown={handleKeyDown}
        >
            <div className="bg-[#f3f3f3] border border-[#d1d5db] shadow-xl rounded-lg w-full max-w-md overflow-hidden flex flex-col text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif]">
                {/* Title Bar */}
                <div className="h-9 px-3 bg-[#fbfbfb] border-b border-[#e5e5e5] flex items-center justify-between select-none">
                    <span className="text-[12px] font-normal text-[#1f1f1f]">
                        Medidas del Bulto #{packageNumber}
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

                {/* Content Area */}
                <div className="p-3.5 space-y-3 text-[12px]">
                    {/* Tarjeta de Entrada de Medidas */}
                    <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-3">
                        <div className="flex justify-between items-center">
                            <div>
                                <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                    Dimensiones y Peso
                                </span>
                                <span className="text-[11px] text-[#7f7f7f] font-normal">
                                    Valores físicos para empaque, cubicaje y rotulación.
                                </span>
                            </div>
                        </div>

                        {/* Grid de Inputs: Largo, Ancho, Alto, Peso */}
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="text-[10px] uppercase text-[#616161] block mb-1">
                                    Largo (cm) *
                                </label>
                                <input
                                    ref={lengthInputRef}
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={length}
                                    onChange={e => { setLength(e.target.value); setErrorMsg(''); }}
                                    placeholder="0.0"
                                    className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] text-[#1f1f1f] font-normal"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] uppercase text-[#616161] block mb-1">
                                    Ancho (cm) *
                                </label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={width}
                                    onChange={e => { setWidth(e.target.value); setErrorMsg(''); }}
                                    placeholder="0.0"
                                    className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] text-[#1f1f1f] font-normal"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] uppercase text-[#616161] block mb-1">
                                    Alto (cm) *
                                </label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={height}
                                    onChange={e => { setHeight(e.target.value); setErrorMsg(''); }}
                                    placeholder="0.0"
                                    className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] text-[#1f1f1f] font-normal"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase text-[#616161] block mb-1">
                                Peso en Báscula (kg) <span className="normal-case text-[#7f7f7f]">(Opcional)</span>
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={weight}
                                onChange={e => { setWeight(e.target.value); setErrorMsg(''); }}
                                placeholder="0.00"
                                className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] text-[#1f1f1f] font-normal"
                            />
                        </div>
                    </div>

                    {/* Presets Rápidos de Empaque */}
                    <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2">
                        <span className="text-[11px] text-[#616161] font-normal block">
                            Medidas estándar frecuentes:
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => handleApplyPreset(20, 15, 10)}
                                className="h-6 px-2 text-left bg-[#f9f9f9] hover:bg-[#f0f0f0] border border-[#e5e5e5] rounded text-[11px] text-[#1f1f1f] font-normal transition-colors cursor-pointer truncate"
                                title="Caja Chica: 20 × 15 × 10 cm"
                            >
                                Caja Chica (20×15×10)
                            </button>
                            <button
                                type="button"
                                onClick={() => handleApplyPreset(35, 25, 20)}
                                className="h-6 px-2 text-left bg-[#f9f9f9] hover:bg-[#f0f0f0] border border-[#e5e5e5] rounded text-[11px] text-[#1f1f1f] font-normal transition-colors cursor-pointer truncate"
                                title="Caja Mediana: 35 × 25 × 20 cm"
                            >
                                Caja Mediana (35×25×20)
                            </button>
                            <button
                                type="button"
                                onClick={() => handleApplyPreset(50, 40, 30)}
                                className="h-6 px-2 text-left bg-[#f9f9f9] hover:bg-[#f0f0f0] border border-[#e5e5e5] rounded text-[11px] text-[#1f1f1f] font-normal transition-colors cursor-pointer truncate"
                                title="Caja Grande: 50 × 40 × 30 cm"
                            >
                                Caja Grande (50×40×30)
                            </button>
                            <button
                                type="button"
                                onClick={() => handleApplyPreset(25, 18, 5)}
                                className="h-6 px-2 text-left bg-[#f9f9f9] hover:bg-[#f0f0f0] border border-[#e5e5e5] rounded text-[11px] text-[#1f1f1f] font-normal transition-colors cursor-pointer truncate"
                                title="Sobre / Bolsa: 25 × 18 × 5 cm"
                            >
                                Sobre / Bolsa (25×18×5)
                            </button>
                        </div>
                    </div>

                    {/* Resumen de Cubicaje Calculado */}
                    {numL > 0 && numW > 0 && numH > 0 && (
                        <div className="bg-[#f0f7ff] rounded border border-[#cce4f7] p-2.5 flex items-center justify-between text-[11px] text-[#1f1f1f]">
                            <div>
                                <span className="text-[#616161] block text-[10px] uppercase">Volumen Estimado:</span>
                                <span className="font-normal text-[#0067c0]">
                                    {volumeM3 < 0.01 ? `${Math.round(numL * numW * numH).toLocaleString()} cm³` : `${volumeM3.toFixed(3)} m³`}
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-[#616161] block text-[10px] uppercase">Peso Volumétrico:</span>
                                <span className="font-normal text-[#1f1f1f]">
                                    {volumetricWeightKg.toFixed(2)} kg
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Mensaje de Error si aplica */}
                    {errorMsg && (
                        <div className="p-2 rounded text-[11px] font-normal bg-[#fdf2f2] text-[#a80000] border border-[#f3c5c5]">
                            {errorMsg}
                        </div>
                    )}
                </div>

                {/* Dialog Footer */}
                <div className="h-11 bg-[#f3f3f3] border-t border-[#e5e5e5] px-3.5 flex items-center justify-between">
                    <div>
                        {initialDimensions && onClear && (
                            <button
                                type="button"
                                onClick={onClear}
                                className="h-7 px-2.5 bg-white hover:bg-[#fdf2f2] text-[#a80000] border border-[#fecaca] rounded text-[11px] font-normal transition-colors cursor-pointer"
                                title="Quitar medidas guardadas de este bulto"
                            >
                                Eliminar Medidas
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
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
                            Guardar Medidas
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PackageDimensionsModal;
