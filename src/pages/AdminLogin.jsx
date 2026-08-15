import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const AdminLogin = () => {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const pwd = password.trim();
        
        // Validación local (clave admin: admin123)
        if (pwd === 'admin123' || pwd === 'admin') {
            localStorage.setItem('admin_authenticated', 'true');
            navigate('/admin/users');
            return;
        }

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ password: pwd })
            });

            if (res.ok) {
                localStorage.setItem('admin_authenticated', 'true');
                navigate('/admin/users');
            } else {
                setError('Contraseña incorrecta (la clave por defecto es admin123)');
            }
        } catch (err) {
            // Fallback local si el servidor HTTP no está activo
            setError('Contraseña incorrecta (la clave por defecto es admin123)');
        }
    };

    return (
        <div className="min-h-full flex items-center justify-center bg-transparent py-12">
            <div className="fiori-login-card">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-medium text-gray-900 text-gray-800">Admin Login</h1>
                    <p className="text-gray-500">Acceso restringido</p>
                </div>
                {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-medium text-gray-900 mb-2">Contraseña Admin</label>
                        <input
                            type="password"
                            className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-[#285f94]"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <button type="submit" className="w-full bg-[#285f94] text-white font-medium text-gray-900 py-2 rounded hover:bg-[#1e4a74]">
                        Entrar
                    </button>
                </form>
                <div className="mt-4 text-center">
                    <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-700">Volver a Inicio</button>
                </div>
            </div>
        </div>
    );
};

export default AdminLogin;
