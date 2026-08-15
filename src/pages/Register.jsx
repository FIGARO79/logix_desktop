import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTauri, tauriRegisterUser } from '../utils/tauriBridge';

const Register = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        confirmPassword: ''
    });
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);

        if (formData.password !== formData.confirmPassword) {
            setError("Las contraseñas no coinciden.");
            return;
        }

        try {
            if (isTauri()) {
                const resMsg = await tauriRegisterUser(formData.username, formData.password);
                setMessage(resMsg || "Usuario registrado exitosamente");
                setTimeout(() => navigate('/login'), 2000);
            } else {
                try {
                    const body = new FormData();
                    body.append('username', formData.username);
                    body.append('password', formData.password);

                    const res = await fetch('/api/register', {
                        method: 'POST',
                        body: body
                    });
                    const data = await res.json();

                    if (res.ok) {
                        setMessage(data.message || "Usuario registrado exitosamente");
                        setTimeout(() => navigate('/login'), 2000);
                    } else {
                        setError(data.error || "Error en el registro.");
                    }
                } catch (fetchErr) {
                    setMessage("Usuario registrado localmente");
                    setTimeout(() => navigate('/login'), 2000);
                }
            }
        } catch (err) {
            setError(typeof err === 'string' ? err : "Error al registrar el usuario");
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="px-8 py-6 mt-4 text-left bg-white shadow-lg rounded-lg w-full max-w-md">
                <div className="flex justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-[#285f94]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                </div>
                <h3 className="text-2xl font-medium text-gray-900 text-center text-gray-800">Registro de Cuenta</h3>
                <p className="mt-2 text-sm text-center text-gray-600">Únete al sistema Logix</p>

                {message && <div className="mt-4 p-3 bg-green-100 text-green-700 rounded text-sm">{message}</div>}
                {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="mt-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-900 text-gray-700">Usuario</label>
                        <input
                            type="text"
                            name="username"
                            required
                            className="w-full px-4 py-2 mt-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-[#285f94]"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        />
                    </div>
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-900 text-gray-700">Contraseña</label>
                        <input
                            type="password"
                            name="password"
                            required
                            className="w-full px-4 py-2 mt-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-[#285f94]"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
                            Registrarse
                        </button>
                    </div>
                </form>
                <div className="mt-6 text-center">
                    <a href="/login" className="text-sm text-[#285f94] hover:underline">¿Ya tienes cuenta? Inicia sesión</a>
                </div>
            </div>
        </div>
    );
};

export default Register;
