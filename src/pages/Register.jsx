import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
                setMessage(resMsg || "Registro exitoso. Espera la aprobación del administrador.");
                setTimeout(() => navigate('/login'), 2500);
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
                        setMessage(data.message || "Registro exitoso. Espera la aprobación del administrador.");
                        setTimeout(() => navigate('/login'), 2500);
                    } else {
                        setError(data.error || "Error en el registro.");
                    }
                } catch (fetchErr) {
                    setMessage("Registro exitoso. Espera la aprobación del administrador.");
                    setTimeout(() => navigate('/login'), 2500);
                }
            }
        } catch (err) {
            setError(typeof err === 'string' ? err : "Error al registrar el usuario");
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f]">
            <div className="bg-white p-7 rounded border border-[#e5e7eb] shadow-sm w-full max-w-sm">
                <div className="text-center mb-5">
                    <span className="text-[11px] font-normal text-[#6b7280] uppercase tracking-normal block mb-1">Logix Desktop</span>
                    <h1 className="text-[18px] font-normal text-[#1f1f1f]">Registro de Cuenta</h1>
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

                <form onSubmit={handleSubmit} className="space-y-3.5">
                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">Usuario</label>
                        <input
                            type="text"
                            name="username"
                            required
                            className="w-full h-8 px-2.5 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">Contraseña</label>
                        <input
                            type="password"
                            name="password"
                            required
                            className="w-full h-8 px-2.5 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
                        Registrarse
                    </button>
                </form>
                <div className="pt-4 text-center text-[12px]">
                    <Link to="/login" className="text-[#0067c0] hover:underline font-normal">¿Ya tienes cuenta? Inicia sesión</Link>
                </div>
            </div>
        </div>
    );
};

export default Register;
