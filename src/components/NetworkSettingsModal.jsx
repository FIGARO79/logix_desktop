import React, { useState, useEffect } from 'react';
import { startHostServer, stopHostServer, getHostServerInfo } from '../utils/tauriApi';
import { getNetworkConfig, saveNetworkConfig, testHostConnection } from '../utils/networkHostClient';

const NetworkSettingsModal = ({ isOpen, onClose }) => {
    const [mode, setMode] = useState('standalone');
    const [hostPort, setHostPort] = useState(8088);
    const [remoteHostUrl, setRemoteHostUrl] = useState('http://192.168.1.50:8088');
    const [serverInfo, setServerInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [testStatus, setTestStatus] = useState(null);
    const [copiedIp, setCopiedIp] = useState(null);
    const [hostError, setHostError] = useState(null);

    useEffect(() => {
        if (!isOpen) return;

        const cfg = getNetworkConfig();
        setMode(cfg.mode || 'standalone');
        setHostPort(cfg.port || 8088);
        setRemoteHostUrl(cfg.hostUrl || 'http://192.168.1.50:8088');
        setTestStatus(null);
        setCopiedIp(null);
        setHostError(null);

        // Consultar estado del servidor en Rust
        const checkServer = async () => {
            try {
                const info = await getHostServerInfo();
                if (info) {
                    setServerInfo(info);
                    if (info.running) {
                        setMode('host');
                    }
                }
            } catch (e) {
                console.warn('No se pudo obtener estado del host:', e);
            }
        };

        checkServer();
    }, [isOpen]);

    const handleStartHost = async () => {
        setLoading(true);
        setHostError(null);
        try {
            const info = await startHostServer(Number(hostPort) || 8088);
            if (!info || !info.running) {
                throw new Error('El backend no confirmó la activación del servidor.');
            }
            setServerInfo(info);
            saveNetworkConfig({ mode: 'host', port: Number(hostPort) || 8088 });
            setMode('host');
        } catch (err) {
            setHostError(err?.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleStopHost = async () => {
        setLoading(true);
        setHostError(null);
        try {
            const info = await stopHostServer();
            setServerInfo(info);
            saveNetworkConfig({ mode: 'standalone' });
            setMode('standalone');
        } catch (err) {
            setHostError(err?.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleTestClient = async () => {
        setLoading(true);
        setTestStatus(null);
        const res = await testHostConnection(remoteHostUrl);
        if (res.success) {
            setTestStatus({
                type: 'success',
                text: 'Conexión establecida correctamente con el Servidor Central (' + (res.data?.server_name || 'Logix Host') + ')'
            });
            saveNetworkConfig({ mode: 'client', hostUrl: remoteHostUrl.trim() });
        } else {
            setTestStatus({
                type: 'error',
                text: 'No se pudo conectar: ' + res.error
            });
        }
        setLoading(false);
    };

    const handleSave = () => {
        if (mode === 'standalone') {
            if (serverInfo?.running) {
                handleStopHost();
            }
            saveNetworkConfig({ mode: 'standalone' });
        } else if (mode === 'host') {
            saveNetworkConfig({ mode: 'host', port: Number(hostPort) || 8088 });
        } else if (mode === 'client') {
            saveNetworkConfig({ mode: 'client', hostUrl: remoteHostUrl.trim() });
        }
        onClose();
    };

    const handleCopyIp = (url, ip) => {
        navigator.clipboard.writeText(url);
        setCopiedIp(ip);
        setTimeout(() => setCopiedIp(null), 2000);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
            {/* Ventana Estilo Windows 11 Limpio */}
            <div className="bg-[#f3f3f3] border border-[#d1d5db] shadow-xl rounded-lg w-full max-w-md overflow-hidden flex flex-col text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif]">
                {/* Modern Window Title Bar */}
                <div className="h-9 px-3 bg-[#fbfbfb] border-b border-[#e5e5e5] flex items-center justify-between select-none">
                    <span className="text-[12px] font-normal text-[#1f1f1f]">
                        Configuración de red local
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
                    {/* Tarjeta 1: Modo de Red */}
                    <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2.5">
                        <div>
                            <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                Modo de operación
                            </span>
                            <span className="text-[11px] text-[#7f7f7f] font-normal">
                                Seleccione el rol de este equipo en la red.
                            </span>
                        </div>

                        <div className="space-y-1.5">
                            <select
                                value={mode}
                                onChange={(e) => setMode(e.target.value)}
                                className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] text-[#1f1f1f] font-normal"
                            >
                                <option value="standalone">Standalone (Uso local independiente)</option>
                                <option value="host">Servidor Central (Compartir base de datos)</option>
                                <option value="client">Terminal Cliente (Conectar a servidor central)</option>
                            </select>
                            <span className="text-[11px] text-[#7f7f7f] font-normal block leading-tight">
                                {mode === 'standalone' && 'Almacena registros únicamente en la base de datos local del equipo.'}
                                {mode === 'host' && 'Permite que otras terminales de la red sincronicen inventarios aquí.'}
                                {mode === 'client' && 'Envía y consulta las operaciones en tiempo real al servidor host.'}
                            </span>
                        </div>
                    </div>

                    {/* Tarjeta 2: Configuración Específica por Modo */}
                    {mode === 'standalone' && (
                        <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2">
                            <span className="text-[12px] font-normal text-[#1f1f1f] block mb-0.5">
                                Base de datos local
                            </span>
                            <p className="text-[11px] text-[#7f7f7f] font-normal leading-relaxed">
                                La aplicación opera de forma autónoma. Todos los conteos y auditorías se resguardan en <span className="font-mono text-[#333333]">logix_local.db</span>. No requiere configuración de red ni puertos.
                            </p>
                        </div>
                    )}

                    {mode === 'host' && (
                        <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2.5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                        Servidor central
                                    </span>
                                    <span className="text-[11px] text-[#7f7f7f] font-normal">
                                        Estado: {serverInfo?.running ? 'En ejecución' : 'Detenido'}
                                    </span>
                                </div>
                                <span className={`text-[11px] font-normal px-2 py-0.5 rounded border ${
                                    serverInfo?.running 
                                        ? 'bg-[#f4fbf6] text-[#107c41] border-[#c2e8cf]' 
                                        : 'bg-[#f9f9f9] text-[#7f7f7f] border-[#d1d5db]'
                                }`}>
                                    {serverInfo?.running ? 'Activo' : 'Inactivo'}
                                </span>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <label className="text-[12px] text-[#1f1f1f] font-normal shrink-0">Puerto:</label>
                                <input
                                    type="number"
                                    disabled={serverInfo?.running}
                                    value={hostPort}
                                    onChange={(e) => setHostPort(e.target.value)}
                                    className="w-20 h-7 py-0 px-2 bg-white border border-[#d1d5db] rounded text-[12px] font-normal outline-none focus:border-[#0067c0] box-border leading-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <div className="ml-auto">
                                    {serverInfo?.running ? (
                                        <button
                                            type="button"
                                            onClick={handleStopHost}
                                            disabled={loading}
                                            className="h-7 py-0 px-3 inline-flex items-center justify-center bg-white hover:bg-[#f5f5f5] text-[#a80000] border border-[#d1d5db] rounded text-[12px] font-normal leading-none whitespace-nowrap transition-colors disabled:opacity-50 cursor-pointer box-border"
                                        >
                                            {loading ? 'Deteniendo...' : 'Detener servidor'}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleStartHost}
                                            disabled={loading}
                                            className="h-7 py-0 px-3 inline-flex items-center justify-center bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[12px] font-normal leading-none whitespace-nowrap transition-colors disabled:opacity-50 cursor-pointer box-border"
                                        >
                                            {loading ? 'Iniciando...' : 'Iniciar servidor'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {hostError && (
                                <div className="p-2 bg-[#fdf2f2] border border-[#f3c5c5] text-[#a80000] rounded text-[11px] font-normal">
                                    {hostError}
                                </div>
                            )}

                            {serverInfo?.running && (
                                <div className="pt-2 border-t border-[#f0f0f0] space-y-1.5">
                                    <span className="text-[11px] text-[#7f7f7f] font-normal block">
                                        Direcciones para conectar las terminales:
                                    </span>
                                    <div className="space-y-1 max-h-24 overflow-y-auto">
                                        {serverInfo?.local_ips && serverInfo.local_ips.length > 0 ? (
                                            serverInfo.local_ips.map((ip) => {
                                                const url = `http://${ip}:${serverInfo.port}`;
                                                const isCopied = copiedIp === ip;
                                                return (
                                                    <div
                                                        key={ip}
                                                        className="flex items-center justify-between bg-[#fbfbfb] border border-[#e5e5e5] rounded px-2 py-1 text-[11px]"
                                                    >
                                                        <span className="font-mono text-[#1f1f1f]">{url}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCopyIp(url, ip)}
                                                            className="text-[11px] text-[#0067c0] hover:underline font-normal cursor-pointer ml-2 shrink-0"
                                                        >
                                                            {isCopied ? 'Copiado' : 'Copiar'}
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="font-mono text-[#5f5f5f] text-[11px]">
                                                http://127.0.0.1:{serverInfo?.port || 8088}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {mode === 'client' && (
                        <div className="bg-white rounded border border-[#e5e5e5] p-3 space-y-2.5">
                            <div>
                                <span className="text-[12px] font-normal text-[#1f1f1f] block">
                                    Servidor central remoto
                                </span>
                                <span className="text-[11px] text-[#7f7f7f] font-normal">
                                    Indique la dirección IP y puerto del equipo servidor.
                                </span>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] text-[#7f7f7f] font-normal block">
                                    URL del host:
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={remoteHostUrl}
                                        onChange={(e) => setRemoteHostUrl(e.target.value)}
                                        placeholder="http://192.168.1.50:8088"
                                        className="flex-1 min-w-0 h-7 py-0 px-2 bg-white border border-[#d1d5db] rounded text-[12px] font-mono font-normal outline-none focus:border-[#0067c0] text-[#1f1f1f] leading-none box-border"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTestClient}
                                        disabled={loading}
                                        className="h-7 py-0 px-3 inline-flex items-center justify-center bg-white hover:bg-[#f5f5f5] text-[#1f1f1f] border border-[#d1d5db] rounded text-[12px] font-normal leading-none whitespace-nowrap transition-colors disabled:opacity-50 cursor-pointer shrink-0 box-border"
                                    >
                                        {loading ? 'Verificando...' : 'Probar'}
                                    </button>
                                </div>
                            </div>

                            {testStatus && (
                                <div className={`p-2 rounded text-[11px] font-normal border ${
                                    testStatus.type === 'success'
                                        ? 'bg-[#f4fbf6] text-[#107c41] border-[#c2e8cf]'
                                        : 'bg-[#fdf2f2] text-[#a80000] border-[#f3c5c5]'
                                }`}>
                                    {testStatus.text}
                                </div>
                            )}
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

export default NetworkSettingsModal;
