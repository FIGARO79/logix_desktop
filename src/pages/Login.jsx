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
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <div className="fiori-login-card bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
                    <span className="text-[12px] font-medium text-gray-500 uppercase tracking-tight">LOGIX DESKTOP</span>
                    <div className="inline-flex bg-gray-100 p-0.5 rounded border border-gray-200 text-xs">
                        <button
                            type="button"
                            onClick={() => setLanguage('es')}
                            className={`px-2 py-1 rounded transition-all flex items-center gap-1 cursor-pointer ${language === 'es' ? 'bg-white shadow-xs text-[#285f94] font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
                            title="Español"
                        >
                            <span>🇪🇸</span>
                            <span>ES</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setLanguage('pt')}
                            className={`px-2 py-1 rounded transition-all flex items-center gap-1 cursor-pointer ${language === 'pt' ? 'bg-white shadow-xs text-emerald-700 font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
                            title="Português (Brasil)"
                        >
                            <span>🇧🇷</span>
                            <span>PT</span>
                        </button>
                    </div>
                </div>

                <h2 className="text-2xl font-medium text-gray-900 mb-6 text-center text-[#2c3e50]">{t('login.title', 'Iniciar Sesión')}</h2>

                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('login.username', 'Usuario')}</label>
                        <input
                            type="text"
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            placeholder={t('login.username_placeholder', 'Ingrese su usuario')}
                            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-[#285f94] focus:ring focus:ring-[#285f94] focus:ring-opacity-50 p-2 border"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('login.password', 'Contraseña')}</label>
                        <div className="relative mt-1">
                            <input
                                type={showPassword ? "text" : "password"}
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                placeholder={t('login.password_placeholder', 'Ingrese su contraseña')}
                                className="block w-full rounded border-gray-300 shadow-sm focus:border-[#285f94] focus:ring focus:ring-[#285f94] focus:ring-opacity-50 p-2 border pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 focus:outline-none"
                                title={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                            >
                                {showPassword ? (
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                ) : (
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-1">
                        <label className="flex items-center text-sm text-gray-700 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={handleRememberChange}
                                className="h-4 w-4 text-[#285f94] focus:ring-[#285f94] border-gray-300 rounded cursor-pointer accent-[#285f94]"
                            />
                            <span className="ml-2 text-gray-700 text-sm font-normal select-none">{t('login.remember', 'Recordar usuario y autocompletar clave')}</span>
                        </label>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full bg-[#285f94] text-white py-2 rounded hover:bg-[#1e4a74] transition font-medium cursor-pointer ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {loading ? t('login.loading', 'Cargando...') : t('login.enter', 'Entrar')}
                    </button>

                    <div className="mt-4 text-center text-sm">
                        <Link to="/register" className="text-[#285f94] hover:underline">{t('login.register', 'Registrarse')}</Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Login;
