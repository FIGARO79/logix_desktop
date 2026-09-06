import React, { useState, useEffect, useRef } from 'react';

const DesktopMenuBar = ({
    onNewTab,
    onCloseCurrentTab,
    onOpenNetworkModal,
    onOpenPrinterModal,
    onNavigate,
    language,
    setLanguage,
    onLogout
}) => {
    const [activeMenu, setActiveMenu] = useState(null);
    const menubarRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menubarRef.current && !menubarRef.current.contains(event.target)) {
                setActiveMenu(null);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setActiveMenu(null);
            }
        };

        if (activeMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeMenu]);

    const handleMenuClick = (menuName) => {
        setActiveMenu(activeMenu === menuName ? null : menuName);
    };

    const handleMouseEnter = (menuName) => {
        if (activeMenu) {
            setActiveMenu(menuName);
        }
    };

    const handleItemClick = (action) => {
        setActiveMenu(null);
        if (action) action();
    };

    const menuBoxClass = "absolute left-0 top-full mt-0.5 w-56 bg-white border border-gray-300 shadow-md rounded-none py-0.5 z-[1050] text-gray-800 text-[12px] font-['Segoe_UI',Tahoma,sans-serif]";
    const itemClass = "w-full text-left px-3 h-6 flex items-center justify-between text-[12px] leading-none hover:bg-[#0078d4] hover:text-white cursor-pointer select-none text-gray-800 font-normal";
    const headerClass = "px-3 pt-1.5 pb-1 text-[11px] font-normal text-gray-500 uppercase tracking-wider text-left leading-none select-none";
    const separatorClass = "border-t border-gray-200 my-0.5";

    return (
        <div
            ref={menubarRef}
            className="h-7 bg-[#f0f2f5] border-b border-gray-300 px-2 flex items-center text-[12px] font-['Segoe_UI',Tahoma,sans-serif] text-gray-800 select-none z-[1002] relative print:hidden no-print"
        >
            {/* 1. ARCHIVO */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => handleMenuClick('archivo')}
                    onMouseEnter={() => handleMouseEnter('archivo')}
                    className={`px-2.5 py-0.5 rounded-none text-[12px] leading-none cursor-default font-normal ${
                        activeMenu === 'archivo'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-gray-200 text-gray-800'
                    }`}
                >
                    Archivo
                </button>
                {activeMenu === 'archivo' && (
                    <div className={menuBoxClass}>
                        <button
                            onClick={() => handleItemClick(onNewTab)}
                            className={itemClass}
                        >
                            <span>Nueva pestaña</span>
                            <span className="text-[11px] text-gray-400 font-mono">Ctrl+T</span>
                        </button>
                        <button
                            onClick={() => handleItemClick(onCloseCurrentTab)}
                            className={itemClass}
                        >
                            <span>Cerrar pestaña</span>
                            <span className="text-[11px] text-gray-400 font-mono">Ctrl+W</span>
                        </button>
                        <div className={separatorClass}></div>
                        <button
                            onClick={() => handleItemClick(onLogout)}
                            className={itemClass}
                        >
                            <span>Cerrar sesión</span>
                        </button>
                    </div>
                )}
            </div>

            {/* 2. CONFIGURACIÓN */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => handleMenuClick('configuracion')}
                    onMouseEnter={() => handleMouseEnter('configuracion')}
                    className={`px-2.5 py-0.5 rounded-none text-[12px] leading-none cursor-default font-normal ${
                        activeMenu === 'configuracion'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-gray-200 text-gray-800'
                    }`}
                >
                    Configuración
                </button>
                {activeMenu === 'configuracion' && (
                    <div className={menuBoxClass}>
                        <button
                            onClick={() => handleItemClick(() => onNavigate('/admin/login'))}
                            className={itemClass}
                        >
                            <span>Panel de administrador...</span>
                        </button>
                        <button
                            onClick={() => handleItemClick(onOpenNetworkModal)}
                            className={itemClass}
                        >
                            <span>Configuración de red...</span>
                        </button>
                        <button
                            onClick={() => handleItemClick(onOpenPrinterModal)}
                            className={itemClass}
                        >
                            <span>Impresión silenciosa...</span>
                        </button>

                        <div className={separatorClass}></div>

                        <div className={headerClass}>Idioma</div>
                        <button
                            onClick={() => handleItemClick(() => setLanguage('es'))}
                            className={itemClass}
                        >
                            <span className="flex items-center gap-2">
                                <span className="w-3.5 inline-block text-center font-normal text-[#0078d4]">
                                    {language === 'es' ? '✓' : ''}
                                </span>
                                <span>Español</span>
                            </span>
                        </button>
                        <button
                            onClick={() => handleItemClick(() => setLanguage('pt'))}
                            className={itemClass}
                        >
                            <span className="flex items-center gap-2">
                                <span className="w-3.5 inline-block text-center font-normal text-[#0078d4]">
                                    {language === 'pt' ? '✓' : ''}
                                </span>
                                <span>Português</span>
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DesktopMenuBar;
