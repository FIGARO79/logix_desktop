import React, { useEffect, useRef, useState } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const STATES = {
    SCANNING: 'scanning',
    CAPTURING: 'capturing',
    ADJUSTING: 'adjusting',
    PROCESSING: 'processing',
    RESULTS: 'results',
    ERROR: 'error',
};

const DimensionScanner = ({ onConfirm, onClose, packageNumber }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const detectorRef = useRef(null);
    const barcodeDetectorRef = useRef(null);
    
    const [loading, setLoading] = useState(true);
    const [flowState, setFlowState] = useState(STATES.SCANNING);
    const [error, setError] = useState(null);
    const [dimensions, setDimensions] = useState({ length: 0, width: 0, height: 0 });
    const [isCalibrated, setIsCalibrated] = useState(false);
    const [qrSize, setQrSize] = useState(0);
    const [pitch, setPitch] = useState(0);
    const [isLevel, setIsLevel] = useState(false);
    const [instruction, setInstruction] = useState("BUSCANDO QR EN EL SUELO...");
    const [capturedImage, setCapturedImage] = useState(null);
    const [magnifier, setMagnifier] = useState({ visible: false, x: 0, y: 0, pointKey: null });


    const [gizmoPoints, setGizmoPoints] = useState({
        origin: { x: 50, y: 70 },
        x: { x: 80, y: 65 },
        y: { x: 20, y: 65 },
        z: { x: 50, y: 40 },
    });

    const flowStateRef = useRef(flowState);
    useEffect(() => { flowStateRef.current = flowState; }, [flowState]);

    useEffect(() => {
        const handleOrientation = (e) => {
            if (flowStateRef.current !== STATES.SCANNING) return;
            // Beta is pitch in degrees [-180, 180]
            // We want the angle relative to the floor. 
            // When phone is vertical, beta is ~90. When flat, beta is ~0.
            // But it depends on the browser/OS. We'll try to normalize it.
            let b = e.beta;
            if (b !== null) {
                const p = Math.abs(Math.round(b));
                setPitch(p);
                setIsLevel(p >= 20 && p <= 55);
            }
        };

        window.addEventListener('deviceorientation', handleOrientation);
        return () => window.removeEventListener('deviceorientation', handleOrientation);
    }, []);

    const isScanning = flowState === STATES.SCANNING;

    useEffect(() => {
        let stream = null;
        let animationFrameId = null;
        let isMounted = true;

        if ('BarcodeDetector' in window) {
            barcodeDetectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        }

        const init = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
                });
                
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }

                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
                );

                detectorRef.current = await ObjectDetector.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
                        delegate: "GPU"
                    },
                    scoreThreshold: 0.4,
                    runningMode: "VIDEO"
                });

                if (isMounted) {
                    setLoading(false);
                    renderLoop();
                }
            } catch (err) {
                console.error("Scanner Error:", err);
                if (isMounted) setError("Error al iniciar sensores 3D.");
            }
        };

        const renderLoop = async () => {
            if (!isMounted || !videoRef.current || !canvasRef.current || flowStateRef.current !== STATES.SCANNING) return;
            
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d', { alpha: false });

            if (video.readyState >= 2) {
                if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // --- DIBUJAR GUÍA DE ALINEACIÓN ---
                const centerX = canvas.width / 2;
                const centerY = canvas.height / 2;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 2;
                ctx.setLineDash([10, 10]);
                ctx.strokeRect(centerX - 250, centerY - 150, 500, 350);
                ctx.setLineDash([]);

                // --- Lógica de Calibración QR ---
                let qrCorners = null;
                if (barcodeDetectorRef.current) {
                    try {
                        const barcodes = await barcodeDetectorRef.current.detect(video);
                        if (barcodes.length > 0) {
                            const code = barcodes[0];
                            qrCorners = code.cornerPoints;
                            
                            // Calcular tamaño del QR para feedback de distancia
                            const side = Math.sqrt(Math.pow(qrCorners[1].x - qrCorners[0].x, 2) + Math.pow(qrCorners[1].y - qrCorners[0].y, 2));
                            setQrSize(Math.round(side));

                            setIsCalibrated(true);
                            if (side < 45) {
                                setInstruction("LEJOS — IDEAL PARA PALLETS (1.2M)");
                            } else if (side > 140) {
                                setInstruction("CERCA — ¡DEMASIADO CERCA!");
                            } else {
                                setInstruction("RANGO ÓPTIMO — ENCUADRE LA CAJA");
                            }
                            
                            ctx.strokeStyle = '#22c55e';
                            ctx.lineWidth = 4;
                            ctx.beginPath();
                            ctx.moveTo(qrCorners[0].x, qrCorners[0].y);
                            qrCorners.forEach(p => ctx.lineTo(p.x, p.y));
                            ctx.closePath();
                            ctx.stroke();
                        } else {
                            if (!isCalibrated) setInstruction("COLOQUE EL QR EN EL SUELO (CENTRO)");
                        }
                    } catch (e) {
                        // Omitir error de lectura de código de barras
                    }
                }

                // --- Lógica de Detección de Caja ---
                if (detectorRef.current && isCalibrated) {
                    const result = detectorRef.current.detectForVideo(video, performance.now());
                    if (result.detections && result.detections.length > 0) {
                        const box = result.detections[0].boundingBox;
                        ctx.strokeStyle = '#00FFFF';
                        ctx.lineWidth = 3;
                        ctx.strokeRect(box.originX, box.originY, box.width, box.height);
                    }
                }
            }
            animationFrameId = requestAnimationFrame(renderLoop);
        };

        init();

        return () => {
            isMounted = false;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            if (stream) stream.getTracks().forEach(t => t.stop());
            if (detectorRef.current) detectorRef.current.close();
        };
    }, [isCalibrated, isScanning]);

    const handleCapture = async () => {
        if (!videoRef.current || !canvasRef.current) return;
        setFlowState(STATES.CAPTURING);
        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        // Capturar frame actual
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedImage(dataUrl);
        setFlowState(STATES.ADJUSTING);
        setInstruction("AJUSTE LOS EJES SOBRE LA CAJA");
    };

    const processMeasurement = async () => {
        setFlowState(STATES.PROCESSING);
        try {
            const base64Image = capturedImage.split(',')[1];
            const response = await fetch('/api/measure-v2', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    image: base64Image,
                    gizmo: gizmoPoints,
                    camera_pitch: pitch,
                    qr_real_size: 15.0 // Tamaño estándar del QR en cm
                })
            });
            const data = await response.json();
            
            if (data.error) {
                setError(data.error);
                setFlowState(STATES.ERROR);
            } else {
                setDimensions(data);
                setFlowState(STATES.RESULTS);
                setInstruction("MEDIDAS CALCULADAS");
            }
        } catch (err) {
            setError("Error en el servidor");
            setFlowState(STATES.ERROR);
        }
    };

    const handlePointMove = (pointKey, e) => {
        if (flowState !== STATES.ADJUSTING) return;
        const rect = e.currentTarget.parentElement.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));

        setGizmoPoints(prev => ({
            ...prev,
            [pointKey]: { x, y }
        }));
        setMagnifier({ visible: true, x: clientX, y: clientY, pointKey });
    };

    const resetState = () => {
        setFlowState(STATES.SCANNING);
        setIsCalibrated(false);
        setCapturedImage(null);
        setError(null);
        setDimensions({ length: 0, width: 0, height: 0 });
        setGizmoPoints({
            origin: { x: 50, y: 70 },
            x: { x: 80, y: 65 },
            y: { x: 20, y: 65 },
            z: { x: 50, y: 40 },
        });
    };

    // Cálculos para el dibujo del Gizmo
    const getGizmoLineProps = () => {
        if (!canvasRef.current) return null;
        const w = canvasRef.current.clientWidth;
        const h = canvasRef.current.clientHeight;
        
        const toPx = (p) => ({ x: (p.x * w) / 100, y: (p.y * h) / 100 });
        const pO = toPx(gizmoPoints.origin);
        const pX = toPx(gizmoPoints.x);
        const pY = toPx(gizmoPoints.y);
        const pZ = toPx(gizmoPoints.z);

        const pXY = { x: pX.x + (pY.x - pO.x), y: pX.y + (pY.y - pO.y) };
        const pXZ = { x: pX.x + (pZ.x - pO.x), y: pX.y + (pZ.y - pO.y) };
        const pYZ = { x: pY.x + (pZ.x - pO.x), y: pY.y + (pZ.y - pO.y) };
        const pXYZ = { x: pXY.x + (pZ.x - pO.x), y: pXY.y + (pZ.y - pO.y) };

        return { pO, pX, pY, pZ, pXY, pXZ, pYZ, pXYZ };
    };

    const lines = flowState === STATES.ADJUSTING ? getGizmoLineProps() : null;

    return (
        <div className="fixed inset-0 bg-black z-[9999] flex flex-col font-sans overflow-hidden">
            {/* Header */}
            <div className="h-16 flex-shrink-0 bg-slate-900 flex items-center justify-between px-4 border-b border-white/10">
                <div className="flex flex-col">
                    <span className="text-white font-medium text-gray-900 text-sm tracking-tight flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isCalibrated ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-orange-500 animate-pulse'}`}></div>
                        ESCANER B{packageNumber}
                    </span>
                    <span className={`text-[9px] font-medium text-gray-900 uppercase tracking-widest ${flowState === STATES.ADJUSTING ? 'text-amber-400' : 'text-slate-400'}`}>
                        {instruction}
                    </span>
                </div>
                <button onClick={onClose} className="w-10 h-10 flex items-center justify-center text-white bg-slate-800 rounded-full">✕</button>
            </div>

            {/* Main Viewport */}
            <div className="relative flex-grow min-h-0 bg-black flex items-center justify-center overflow-hidden">
                <video ref={videoRef} playsInline muted style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0 }} />
                
                {flowState === STATES.SCANNING ? (
                    <>
                        <canvas ref={canvasRef} width="1280" height="720" className="w-full h-full object-contain" />
                        
                        {/* Overlay Guía */}
                        {!isCalibrated && !loading && (
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="w-64 h-64 border-2 border-dashed border-white/30 rounded-3xl flex items-center justify-center">
                                    <div className="text-white/40 text-[10px] font-medium text-gray-900 uppercase tracking-widest text-center px-4">
                                        Coloque el QR <br/> aquí (en el suelo)
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Indicadores Laterales */}
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-6 items-center">
                            {/* Pitch Meter */}
                            <div className="flex flex-col items-center">
                                <div className="w-1 h-24 bg-white/10 rounded-full relative overflow-hidden">
                                    <div 
                                        className={`absolute bottom-0 w-full transition-all duration-300 ${isLevel ? 'bg-green-500' : 'bg-red-500'}`}
                                        style={{ height: `${(pitch / 90) * 100}%` }}
                                    ></div>
                                </div>
                                <span className="text-[10px] text-white font-medium text-gray-900 mt-2">{pitch}°</span>
                            </div>

                            {/* Distance Badge */}
                            <div className={`p-2 rounded-lg flex flex-col items-center gap-1 ${qrSize < 45 ? 'bg-blue-500/20' : (qrSize > 140 ? 'bg-red-500/20' : 'bg-green-500/20')}`}>
                                <span className="text-[10px] font-black text-white">
                                    {qrSize < 45 ? "PALLET" : (qrSize > 140 ? "CERCA" : "OK")}
                                </span>
                            </div>
                        </div>

                        {/* Botón Captura */}
                        {isCalibrated && (
                            <button 
                                onClick={handleCapture}
                                className={`absolute bottom-8 left-1/2 -translate-x-1/2 group flex flex-col items-center gap-2`}
                            >
                                <div className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all ${isLevel ? 'border-green-500 bg-green-500/20' : 'border-white/30 bg-white/10'}`}>
                                    <div className="w-16 h-16 rounded-full bg-white group-active:scale-95 transition-transform"></div>
                                </div>
                                <span className={`text-[10px] font-black uppercase tracking-widest ${isLevel ? 'text-green-500' : 'text-white/50'}`}>
                                    Capturar
                                </span>
                            </button>
                        )}
                    </>
                ) : (
                    <div className="relative w-full h-full flex items-center justify-center bg-black">
                        <img src={capturedImage} className="w-full h-full object-contain opacity-60" alt="Captured" />
                        
                        {flowState === STATES.ADJUSTING && lines && (
                            <div className="absolute inset-0">
                                <svg className="w-full h-full pointer-events-none">
                                    <line x1={lines.pO.x} y1={lines.pO.y} x2={lines.pX.x} y2={lines.pX.y} stroke="#22c55e" strokeWidth="3" />
                                    <line x1={lines.pO.x} y1={lines.pO.y} x2={lines.pY.x} y2={lines.pY.y} stroke="#3b82f6" strokeWidth="3" />
                                    <line x1={lines.pO.x} y1={lines.pO.y} x2={lines.pZ.x} y2={lines.pZ.y} stroke="#ef4444" strokeWidth="3" />
                                    
                                    <line x1={lines.pX.x} y1={lines.pX.y} x2={lines.pXY.x} y2={lines.pXY.y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="5,5" />
                                    <line x1={lines.pY.x} y1={lines.pY.y} x2={lines.pXY.x} y2={lines.pXY.y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="5,5" />
                                    
                                    <line x1={lines.pX.x} y1={lines.pX.y} x2={lines.pXZ.x} y2={lines.pXZ.y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="5,5" />
                                    <line x1={lines.pY.x} y1={lines.pY.y} x2={lines.pYZ.x} y2={lines.pYZ.y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="5,5" />
                                    
                                    <line x1={lines.pXY.x} y1={lines.pXY.y} x2={lines.pXYZ.x} y2={lines.pXYZ.y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="5,5" />
                                    <line x1={lines.pZ.x} y1={lines.pZ.y} x2={lines.pXZ.x} y2={lines.pXZ.y} stroke="#ef4444" strokeWidth="1" opacity="0.5" />
                                    <line x1={lines.pZ.x} y1={lines.pZ.y} x2={lines.pYZ.x} y2={lines.pYZ.y} stroke="#ef4444" strokeWidth="1" opacity="0.5" />
                                    <line x1={lines.pXZ.x} y1={lines.pXZ.y} x2={lines.pXYZ.x} y2={lines.pXYZ.y} stroke="#ef4444" strokeWidth="1" opacity="0.5" />
                                    <line x1={lines.pYZ.x} y1={lines.pYZ.y} x2={lines.pXYZ.x} y2={lines.pXYZ.y} stroke="#ef4444" strokeWidth="1" opacity="0.5" />
                                </svg>

                                {/* Gizmo Handles */}
                                {Object.entries(gizmoPoints).map(([key, point]) => (
                                    <div 
                                        key={key}
                                        onMouseDown={(e) => handlePointMove(key, e)}
                                        onTouchMove={(e) => handlePointMove(key, e)}
                                        onTouchEnd={() => setMagnifier(prev => ({ ...prev, visible: false }))}
                                        onMouseUp={() => setMagnifier(prev => ({ ...prev, visible: false }))}
                                        className={`absolute w-10 h-10 -ml-5 -mt-5 rounded-full border-2 border-white cursor-move z-10 flex items-center justify-center shadow-lg transition-transform active:scale-125
                                            ${key === 'origin' ? 'bg-white' : key === 'x' ? 'bg-green-500' : key === 'y' ? 'bg-blue-500' : 'bg-red-500'}`}
                                        style={{ left: `${point.x}%`, top: `${point.y}%` }}
                                    >
                                        <span className="text-[10px] font-medium text-gray-900 pointer-events-none uppercase">{key[0]}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Magnifier */}
                {magnifier.visible && (
                    <div 
                        className="absolute w-40 h-40 rounded-full border-4 border-amber-400 overflow-hidden z-[100] shadow-2xl pointer-events-none bg-black"
                        style={{ 
                            left: magnifier.x < window.innerWidth / 2 ? 'auto' : 20,
                            right: magnifier.x < window.innerWidth / 2 ? 20 : 'auto',
                            top: 100
                        }}
                    >
                        <img 
                            src={capturedImage} 
                            className="absolute max-w-none"
                            style={{ 
                                width: '400%', 
                                height: '400%', 
                                left: `-${(gizmoPoints[magnifier.pointKey].x * 4) - 50}%`,
                                top: `-${(gizmoPoints[magnifier.pointKey].y * 4) - 50}%`,
                                transform: 'translate(-50%, -50%)'
                            }} 
                            alt="Magnified"
                        />
                        <div className="absolute inset-0 border-[0.5px] border-amber-400/30 flex items-center justify-center">
                            <div className="w-full h-px bg-amber-400"></div>
                            <div className="h-full w-px bg-amber-400 absolute"></div>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-white">
                        <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-[10px] font-medium text-gray-900 tracking-widest uppercase">Iniciando IA...</p>
                    </div>
                )}

                {(flowState === STATES.PROCESSING || flowState === STATES.CAPTURING) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white z-20">
                        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-xs font-medium text-gray-900 tracking-widest uppercase animate-pulse">Procesando 3D...</p>
                    </div>
                )}
            </div>

            {/* Footer / Controls */}
            <div className="bg-slate-900 p-5 flex-shrink-0 border-t border-white/10 shadow-2xl">
                {flowState === STATES.RESULTS ? (
                    <>
                        <div className="grid grid-cols-3 gap-3 mb-6">
                            <div className="bg-slate-800/80 p-3 rounded-xl text-center border border-white/5">
                                <span className="text-[8px] text-slate-500 block font-medium text-gray-900 uppercase mb-1">Largo</span>
                                <span className="text-2xl font-black text-white">{Math.round(dimensions.length)}<small className="text-[10px] ml-0.5 text-cyan-500">cm</small></span>
                            </div>
                            <div className="bg-slate-800/80 p-3 rounded-xl text-center border border-white/5">
                                <span className="text-[8px] text-slate-500 block font-medium text-gray-900 uppercase mb-1">Ancho</span>
                                <span className="text-2xl font-black text-white">{Math.round(dimensions.width)}<small className="text-[10px] ml-0.5 text-cyan-500">cm</small></span>
                            </div>
                            <div className="bg-slate-800/80 p-3 rounded-xl text-center border border-white/5">
                                <span className="text-[8px] text-slate-500 block font-medium text-gray-900 uppercase mb-1">Alto</span>
                                <span className="text-2xl font-black text-white">{Math.round(dimensions.height)}<small className="text-[10px] ml-0.5 text-cyan-500">cm</small></span>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={resetState} className="flex-1 py-4 bg-slate-800 text-slate-400 font-medium text-gray-900 rounded-2xl text-xs uppercase">Repetir</button>
                            <button 
                                onClick={() => onConfirm(dimensions)}
                                className="flex-[2] py-4 bg-cyan-600 text-white font-black rounded-2xl text-xs uppercase shadow-xl shadow-cyan-900/40"
                            >
                                Confirmar Medidas
                            </button>
                        </div>
                    </>
                ) : flowState === STATES.ADJUSTING ? (
                    <div className="flex flex-col gap-4">
                        <div className="text-center">
                            <p className="text-[10px] font-medium text-gray-900 text-amber-400 uppercase tracking-tighter mb-2">Ajuste los vértices en la foto</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={resetState} className="flex-1 py-4 bg-slate-800 text-slate-400 font-medium text-gray-900 rounded-2xl text-xs uppercase">Cancelar</button>
                            <button 
                                onClick={processMeasurement}
                                className="flex-[2] py-4 bg-green-600 text-white font-black rounded-2xl text-xs uppercase shadow-xl"
                            >
                                Calcular Medidas
                            </button>
                        </div>
                    </div>
                ) : flowState === STATES.ERROR ? (
                    <div className="flex flex-col items-center gap-4">
                        <p className="text-red-400 text-xs font-medium text-gray-900 text-center">{error}</p>
                        <button onClick={resetState} className="w-full py-4 bg-slate-800 text-white font-medium text-gray-900 rounded-2xl text-xs uppercase">Reintentar</button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-center text-[10px] font-medium text-gray-900 text-slate-500 uppercase px-1">
                            <span>Inclinación: {pitch}°</span>
                            <span className={isLevel ? 'text-green-500' : 'text-orange-500'}>
                                {isLevel ? 'Ángulo Óptimo' : 'Ajuste Inclinación'}
                            </span>
                        </div>
                        <button onClick={onClose} className="w-full py-4 bg-slate-800 text-slate-400 font-medium text-gray-900 rounded-2xl text-xs uppercase">Cerrar</button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DimensionScanner;

