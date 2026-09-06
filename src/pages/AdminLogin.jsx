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
        <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f]">
            <div className="bg-white p-7 rounded border border-[#e5e7eb] shadow-sm w-full max-w-sm">
                <div className="text-center mb-5">
                    <span className="text-[11px] font-normal text-[#6b7280] uppercase tracking-normal block mb-1">Administración</span>
                    <h1 className="text-[18px] font-normal text-[#1f1f1f]">Acceso Restringido</h1>
                </div>
                {error && (
                    <div className="bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] text-[12px] font-normal px-3 py-2 rounded mb-4">
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-3.5">
                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">Contraseña de Administrador</label>
                        <input
                            type="password"
                            className="w-full h-8 px-2.5 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full h-8 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs"
                    >
                        Entrar
                    </button>
                </form>
                <div className="mt-4 text-center">
                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        className="text-[12px] font-normal text-[#6b7280] hover:text-[#1f1f1f] hover:underline cursor-pointer"
                    >
                        Volver al Inicio
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminLogin;
