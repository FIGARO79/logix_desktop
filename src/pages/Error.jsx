import React from 'react';
import { Link } from "react-router-dom";

const ErrorPage = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full text-center space-y-8 bg-white p-10 rounded-xl shadow-2xl">
                <div className="text-red-500">
                    <svg className="mx-auto h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <div>
                    <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
                        Página no encontrada
                    </h2>
                    <p className="mt-2 text-sm text-gray-600">
                        La ruta que buscas no existe o ha sido movida.
                    </p>
                </div>
                <div className="mt-8">
                    <Link
                        to="/dashboard"
                        className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md text-white bg-[#285f94] hover:bg-[#1e4a74] md:py-4 md:text-lg transition duration-150 ease-in-out"
                    >
                        Volver al Inicio
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default ErrorPage;
