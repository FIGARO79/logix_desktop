import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

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
        <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f]">
            <div className="bg-white p-7 rounded border border-[#e5e7eb] shadow-sm w-full max-w-sm">
                <div className="text-center mb-5">
                    <span className="text-[11px] font-normal text-[#6b7280] uppercase tracking-normal block mb-1">Logix Desktop</span>
                    <h1 className="text-[18px] font-normal text-[#1f1f1f]">Restablecer Contraseña</h1>
                </div>

                {message && (
                    <div className="bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534] text-[12px] font-normal px-3 py-2 rounded mb-4">
                        {message}
                    </div>
                )}
                {error && (
                    <div className="bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] text-[12px] font-normal px-3 py-2 rounded mb-4">
                        {error}
                    </div>
                )}

                {token && !message && (
                    <form onSubmit={handleSubmit} className="space-y-3.5">
                        <div>
                            <label className="block text-[12px] font-normal text-[#374151] mb-1">Nueva Contraseña</label>
                            <input
                                type="password"
                                name="newPassword"
                                required
                                className="w-full h-8 px-2.5 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                                value={formData.newPassword}
                                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-[12px] font-normal text-[#374151] mb-1">Confirmar Contraseña</label>
                            <input
                                type="password"
                                name="confirmPassword"
                                required
                                className="w-full h-8 px-2.5 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                            />
                        </div>
                        <button
                            type="submit"
                            className="w-full h-8 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs"
                        >
                            Guardar Contraseña
                        </button>
                    </form>
                )}

                <div className="pt-4 text-center text-[12px]">
                    <Link to="/login" className="text-[#0067c0] hover:underline font-normal">Volver a Inicio de Sesión</Link>
                </div>
            </div>
        </div>
    );
};

export default SetPassword;
