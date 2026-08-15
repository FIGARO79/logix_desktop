import React, { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { parseGS1Barcode } from '../utils/gs1Parser';

const ScannerModal = ({ onClose, onScan, title = "Apunta la cámara al código" }) => {
    const html5QrCode = useRef(null);

    const playBeep = () => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const audioCtx = new AudioContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.1);
        } catch (e) {
            // Ignorar errores de autoplay del contexto de audio
        }
    };

    useEffect(() => {
        const startScanner = async () => {
            const scannerId = "reader";
            html5QrCode.current = new Html5Qrcode(scannerId);
            
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            };

            try {
                await html5QrCode.current.start(
                    { facingMode: "environment" },
                    config,
                    (decodedText) => {
                        const cleanCode = decodedText.trim().toUpperCase();
                        if (cleanCode) {
                            const parsed = parseGS1Barcode(cleanCode);
                            const finalCode = (parsed.isGS1 || parsed.isMultiField) && parsed.itemCode
                                ? parsed.itemCode.trim().toUpperCase()
                                : cleanCode;
                            playBeep();
                            onScan(finalCode, parsed);
                        }
                    },
                    (_errorMessage) => {
                        // Errores de escaneo silenciosos
                    }
                );
            } catch (err) {
                console.error("Error starting scanner:", err);
            }
        };

        startScanner();

        return () => {
            if (html5QrCode.current && html5QrCode.current.isScanning) {
                html5QrCode.current.stop().catch(e => console.error("Error stopping scanner:", e));
            }
        };
    }, [onScan]);

    return (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg p-4 w-full max-w-sm relative shadow-2xl overflow-hidden">
                <h3 className="text-center font-medium text-gray-900 text-sm mb-4 text-gray-800 uppercase">{title}</h3>

                <div className="relative rounded-xl overflow-hidden mb-6 bg-black aspect-square" id="reader">
                    {/* El escáner se renderiza aquí */}
                </div>

                <button
                    onClick={onClose}
                    className="w-full h-12 flex items-center justify-center bg-red-600 text-white font-medium text-gray-900 rounded-lg transition-all"
                >
                    CERRAR
                </button>
            </div>
        </div>
    );
};

export default ScannerModal;
