import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const SetPassword = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [formData, setFormData] = useState({
        newPassword: '',
        confirmPassword: ''
    });
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!token) {
            setError("Token de seguridad no proporcionado o inválido.");
        }
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);

        if (formData.newPassword !== formData.confirmPassword) {
            setError("Las contraseñas no coinciden.");
            return;
        }

        try {
            const body = new FormData();
            body.append('token', token);
            body.append('new_password', formData.newPassword);
            body.append('confirm_password', formData.confirmPassword);

            const res = await fetch('/api/set_password', {
                method: 'POST',
                body: body
            });
            const data = await res.json();

            if (res.ok) {
                setMessage(data.message);
                setTimeout(() => navigate('/login'), 3000);
            } else {
                setError(data.error || "Error al restablecer la contraseña.");
            }
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="px-8 py-6 mt-4 text-left bg-white shadow-lg rounded-lg w-full max-w-md">
                <div className="flex justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-[#285f94]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                </div>
                <h3 className="text-2xl font-medium text-gray-900 text-center text-gray-800">Restablecer Contraseña</h3>
                <p className="mt-2 text-sm text-center text-gray-600">Establece tu nueva contraseña de acceso</p>

                {message && <div className="mt-4 p-3 bg-green-100 text-green-700 rounded text-sm">{message}</div>}
                {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>}

                {token && !message && (
                    <form onSubmit={handleSubmit} className="mt-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-900 text-gray-700">Nueva Contraseña</label>
                            <input
                                type="password"
                                name="newPassword"
                                required
                                className="w-full px-4 py-2 mt-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-[#285f94]"
                                value={formData.newPassword}
                                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                            />
                        </div>
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-900 text-gray-700">Confirmar Contraseña</label>
                            <input
                                type="password"
                                name="confirmPassword"
                                required
                                className="w-full px-4 py-2 mt-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-[#285f94]"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                            />
                        </div>
                        <div className="flex items-center justify-between mt-6">
                            <button type="submit" className="w-full px-6 py-2 leading-5 text-white transition-colors duration-200 transform bg-[#285f94] rounded-md hover:bg-[#1e4a74] focus:outline-none focus:bg-[#1e4a74]">
                                Guardar Contraseña
                            </button>
                        </div>
                    </form>
                )}

                <div className="mt-6 text-center">
                    <a href="/login" className="text-sm text-[#285f94] hover:underline">Volver a Inicio de Sesión</a>
                </div>
            </div>
        </div>
    );
};

export default SetPassword;
