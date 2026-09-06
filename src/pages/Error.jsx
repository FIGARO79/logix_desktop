import React from 'react';
import { Link } from "react-router-dom";

const ErrorPage = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f]">
            <div className="bg-white p-8 rounded border border-[#e5e7eb] shadow-sm w-full max-w-sm text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#fef2f2] border border-[#fecaca] flex items-center justify-center text-[#dc2626]">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2 className="text-[18px] font-normal text-[#1f1f1f] mb-1">
                    Página no encontrada
                </h2>
                <p className="text-[12px] font-normal text-[#6b7280] mb-6">
                    La ruta que buscas no existe o ha sido movida.
                </p>
                <div>
                    <Link
                        to="/dashboard"
                        className="inline-flex items-center justify-center w-full h-8 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors shadow-xs"
                    >
                        Volver al Inicio
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default ErrorPage;
