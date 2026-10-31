import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isTauri, tauriLogin } from '../utils/tauriBridge';
import { useLanguage } from '../context/LanguageContext';

const Login = () => {
    const navigate = useNavigate();
    const { language, setLanguage, t } = useLanguage();
    const [rememberMe, setRememberMe] = useState(() => {
        return localStorage.getItem('logix_remember_login') === 'true';
    });
    const [username, setUsername] = useState(() => {
        const shouldRemember = localStorage.getItem('logix_remember_login') === 'true';
        return shouldRemember ? (localStorage.getItem('logix_saved_username') || '') : '';
    });
    const [password, setPassword] = useState(() => {
        const shouldRemember = localStorage.getItem('logix_remember_login') === 'true';
        return shouldRemember ? (localStorage.getItem('logix_saved_password') || '') : '';
    });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleRememberChange = (e) => {
        const isChecked = e.target.checked;
        setRememberMe(isChecked);
        if (!isChecked) {
            localStorage.removeItem('logix_remember_login');
            localStorage.removeItem('logix_saved_username');
            localStorage.removeItem('logix_saved_password');
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            let userData = null;

            if (isTauri()) {
                try {
                    userData = await tauriLogin(username, password);
                } catch (err) {
                    setError(err || "Usuario o contraseña incorrectos");
                    setLoading(false);
                    return;
                }
            } else {
                try {
                    const formData = new FormData();
                    formData.append('username', username);
                    formData.append('password', password);

                    const res = await fetch('/api/login', {
                        method: 'POST',
                        credentials: 'include',
                        body: formData
                    });

                    if (res.ok) {
                        const data = await res.json();
                        userData = data.user || data;
                    }
                } catch (fetchErr) {
                    console.warn("Servidor HTTP no disponible, iniciando en modo local offline");
                }

                if (!userData) {
                    // Autenticación local predeterminada
                    userData = { id: 1, username: username || 'admin', role: 'admin' };
                }
            }

            if (userData) {
                console.log("Login exitoso", userData);
                if (rememberMe) {
                    localStorage.setItem('logix_remember_login', 'true');
                    localStorage.setItem('logix_saved_username', username);
                    localStorage.setItem('logix_saved_password', password);
                } else {
                    localStorage.removeItem('logix_remember_login');
                    localStorage.removeItem('logix_saved_username');
                    localStorage.removeItem('logix_saved_password');
                }
                localStorage.removeItem('logix_tabs');
                localStorage.removeItem('logix_active_tab');
                localStorage.setItem('user', JSON.stringify(userData));
                navigate('/dashboard');
            } else {
                setError("Usuario o contraseña incorrectos");
            }
        } catch (err) {
            console.error("Error en login", err);
            setError("Error al iniciar sesión localmente");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6] p-4 font-['Segoe_UI',Tahoma,sans-serif] text-[#1f1f1f]">
            <div className="bg-white p-7 rounded border border-[#e5e7eb] shadow-sm w-full max-w-sm">
                <div className="flex items-center justify-between mb-4 border-b border-[#f3f4f6] pb-3">
                    <span className="text-[11px] font-normal text-[#6b7280] uppercase tracking-normal">Logix Desktop</span>
                    <div className="inline-flex bg-[#f3f4f6] p-0.5 rounded border border-[#e5e7eb] text-[11px] font-normal">
                        <button
                            type="button"
                            onClick={() => setLanguage('es')}
                            className={`w-7 h-5 rounded flex items-center justify-center transition-colors cursor-pointer ${language === 'es' ? 'bg-white shadow-xs text-[#0067c0] font-normal' : 'text-[#6b7280] hover:text-[#1f1f1f]'}`}
                            title="Español"
                        >
                            ES
                        </button>
                        <button
                            type="button"
                            onClick={() => setLanguage('pt')}
                            className={`w-7 h-5 rounded flex items-center justify-center transition-colors cursor-pointer ${language === 'pt' ? 'bg-white shadow-xs text-[#0067c0] font-normal' : 'text-[#6b7280] hover:text-[#1f1f1f]'}`}
                            title="Português"
                        >
                            PT
                        </button>
                    </div>
                </div>

                <h2 className="text-[18px] font-normal text-[#1f1f1f] mb-5 text-center">{t('login.title', 'Iniciar Sesión')}</h2>

                {error && (
                    <div className="bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] text-[12px] font-normal px-3 py-2 rounded mb-4" role="alert">
                        <span className="block">{error}</span>
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-3.5">
                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">{t('login.username', 'Usuario')}</label>
                        <input
                            type="text"
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            placeholder={t('login.username_placeholder', 'Ingrese su usuario')}
                            className="w-full h-8 px-2.5 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                        />
                    </div>
                    <div>
                        <label className="block text-[12px] font-normal text-[#374151] mb-1">{t('login.password', 'Contraseña')}</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                placeholder={t('login.password_placeholder', 'Ingrese su contraseña')}
                                className="w-full h-8 px-2.5 pr-8 text-[12px] font-normal border border-[#d1d5db] rounded outline-none focus:border-[#0067c0] bg-white text-[#1f1f1f]"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[#6b7280] hover:text-[#1f1f1f] focus:outline-none cursor-pointer"
                                title={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                            >
                                {showPassword ? (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                ) : (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-1">
                        <label className="flex items-center text-[12px] text-[#374151] cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={handleRememberChange}
                                className="h-3.5 w-3.5 text-[#0067c0] focus:ring-0 border-[#d1d5db] rounded cursor-pointer accent-[#0067c0]"
                            />
                            <span className="ml-2 text-[#374151] text-[12px] font-normal select-none">{t('login.remember', 'Recordar usuario y autocompletar clave')}</span>
                        </label>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full h-8 bg-[#0067c0] hover:bg-[#005a9e] text-white text-[12px] font-normal rounded transition-colors cursor-pointer shadow-xs ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {loading ? t('login.loading', 'Cargando...') : t('login.enter', 'Entrar')}
                    </button>

                    <div className="pt-2 text-center text-[12px]">
                        <Link to="/register" className="text-[#0067c0] hover:underline font-normal">{t('login.register', 'Registrarse')}</Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Login;
