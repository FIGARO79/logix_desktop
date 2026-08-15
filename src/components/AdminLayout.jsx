import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

const AdminLayout = ({ children, title: _title }) => {
    const navigate = useNavigate();

    const handleLogout = async () => {
        // Logic to logout
        navigate('/dashboard');
    };

    return (
        <div className="min-h-screen bg-[#f7f7f7] font-sans text-[#32363a]">
            {/* Shell Bar (Header) - SAP Fiori Style */}
            <header className="fixed top-0 w-full z-50 bg-[#354a5f] text-white h-12 flex items-center px-4 shadow-sm">
                <div className="flex items-center gap-4 w-full max-w-7xl mx-auto">
                    {/* Logo/Icon */}
                    <img src="/static/images/gear-wide-connected.svg" alt="Logo" className="h-6 w-6 opacity-80" />

                    {/* Title */}
                    <h1 className="text-lg font-medium text-gray-900 tracking-wide">Panel de Administración</h1>

                    {/* Actions */}
                    <div className="ml-auto flex gap-4 text-sm">
                        <button
                            onClick={(e) => { e.preventDefault(); /* Global reload logic if needed or pass prop */ }}
                            className="bg-transparent hover:bg-white/10 text-white px-3 py-1 rounded transition-colors flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Recargar CSVs
                        </button>

                        <Link to="/admin/inventory" className="bg-transparent hover:bg-white/10 text-white px-3 py-1 rounded transition-colors flex items-center">
                            Gestionar Inventario
                        </Link>

                        <Link to="/admin/slotting" className="bg-transparent hover:bg-white/10 text-white px-3 py-1 rounded transition-colors flex items-center">
                            Configuración Slotting
                        </Link>

                        <button onClick={handleLogout} className="bg-transparent hover:bg-white/10 text-white px-3 py-1 rounded transition-colors flex items-center">
                            Cerrar Sesión
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="pt-20 px-4 md:px-8 pb-8 max-w-[1400px] mx-auto">
                {children}
            </main>
        </div>
    );
};

export default AdminLayout;
