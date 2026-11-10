import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import {
    isTauri,
    tauriGetAllUsersAdmin,
    tauriDeleteUserAdmin,
    tauriResetPasswordAdmin,
    tauriApproveUserAdmin,
    tauriUpdateUserPermissionsAdmin,
    tauriUpdateUserRoleAdmin
} from '../utils/tauriBridge';
import {
    SIDEBAR_MODULES,
    MODULE_CATEGORIES,
    MODULE_NAMES,
    isUserAdmin,
    getUserPermissions
} from '../utils/permissions';

const AdminUsers = () => {
    const navigate = useNavigate();
    const { setTitle } = useOutletContext();
    const [users, setUsers] = useState([]);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [expandedUserId, setExpandedUserId] = useState(null);

    const loggedInUser = useMemo(() => {
        try {
            const raw = localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }, []);

    const isRootAdmin = useMemo(() => {
        const isAdminAuth = localStorage.getItem('admin_authenticated') === 'true';
        const uName = String(loggedInUser?.username || '').toLowerCase().trim();
        return uName === 'admin' || isUserAdmin(loggedInUser) || isAdminAuth;
    }, [loggedInUser]);

    const fetchUsers = useCallback(async () => {
        try {
            if (isTauri()) {
                const uList = await tauriGetAllUsersAdmin();
                setUsers(uList || []);
            } else {
                try {
                    const res = await fetch('/api/admin/users');
                    if (res.status === 401) {
                        navigate('/admin/login');
                        return;
                    }
                    if (res.ok) {
                        const data = await res.json();
                        setUsers(data);
                        return;
                    }
                } catch (e) {}

                const uList = await tauriGetAllUsersAdmin();
                setUsers(uList || []);
            }
        } catch (err) {
            setUsers([
                { id: 1, username: 'admin', role: 'admin', is_approved: true, permissions: 'stock,inbound,picking,inventory,planner,counts,admin' }
            ]);
        }
    }, [navigate]);

    useEffect(() => {
        fetchUsers();
        if (setTitle) setTitle("Gestión de Usuarios y Permisos");

        // Escuchar eventos de sincronización de red en tiempo real
        let unlisten = null;
        if (isTauri()) {
            import('@tauri-apps/api/event').then(({ listen }) => {
                listen('network-sync-event', (event) => {
                    const evtType = event.payload?.event_type;
                    if (evtType && evtType.startsWith('USER_')) {
                        fetchUsers();
                    }
                }).then(fn => { unlisten = fn; });
            }).catch(() => {});
        }

        return () => {
            if (unlisten) unlisten();
        };
    }, [setTitle, fetchUsers]);

    const handleApprove = async (id) => {
        if (!window.confirm(`¿Aprobar el usuario con ID ${id}?`)) return;
        try {
            if (isTauri()) {
                await tauriApproveUserAdmin(id);
            } else {
                const res = await fetch(`/api/admin/approve/${id}`, { method: 'POST' });
                if (!res.ok) throw new Error("Error al aprobar");
            }
            setMessage(`Usuario ID ${id} aprobado exitosamente`);
            await fetchUsers();
        } catch (e) {
            setError(typeof e === 'string' ? e : (e.message || "Error al aprobar usuario"));
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿ELIMINAR este usuario permanentemente?")) return;
        try {
            if (isTauri()) {
                await tauriDeleteUserAdmin(id);
            } else {
                await fetch(`/api/admin/delete/${id}`, { method: 'POST' }).catch(() => {});
            }
            setMessage(`Usuario ${id} eliminado`);
            fetchUsers();
        } catch (e) { setError("Error al eliminar usuario"); }
    };

    const handleResetPassword = async (id) => {
        const newPass = prompt("Ingrese nueva contraseña:");
        if (!newPass) return;

        try {
            if (isTauri()) {
                await tauriResetPasswordAdmin(id, newPass);
            } else {
                const formData = new FormData();
                formData.append('new_password', newPass);
                await fetch(`/api/admin/reset_password/${id}`, { method: 'POST', body: formData }).catch(() => {});
            }
            setMessage(`Contraseña restablecida para usuario ${id}`);
        } catch (e) { setError("Error al restablecer contraseña"); }
    };

    const parsePermissions = (permissions) => {
        if (!permissions) return [];
        if (Array.isArray(permissions)) return permissions.map(p => String(p).trim().toLowerCase()).filter(Boolean);
        if (typeof permissions === 'string') {
            const trimmed = permissions.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) return parsed.map(p => String(p).trim().toLowerCase()).filter(Boolean);
                } catch (e) {}
            }
            return trimmed.split(',').map(p => p.trim().toLowerCase().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
        return [];
    };

    const handleToggleAdminRole = async (userId) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        if (!isRootAdmin) {
            alert("Operación denegada: Se requieren privilegios de Administrador para modificar perfiles de usuario.");
            return;
        }

        if (String(user.username || '').toLowerCase().trim() === 'admin') {
            alert("El usuario administrador principal ('admin') no puede perder privilegios.");
            return;
        }

        const currentlyAdmin = isUserAdmin(user);
        const newRole = currentlyAdmin ? 'operator' : 'admin';

        // Si se quita el rol admin, retirar también 'admin' y 'admin_users' de sus permisos
        let newPerms = parsePermissions(user.permissions);
        if (newRole !== 'admin') {
            newPerms = newPerms.filter(p => p !== 'admin' && p !== 'admin_users');
        }
        const newPermsStr = newPerms.join(',');

        // Optimistic update
        const updatedUsers = users.map(u => {
            if (u.id === userId) {
                return { ...u, role: newRole, permissions: newPermsStr };
            }
            return u;
        });
        setUsers(updatedUsers);

        // Si es el usuario activo en sesión, sincronizar localStorage
        try {
            const currentLoggedIn = localStorage.getItem('user');
            if (currentLoggedIn) {
                const parsed = JSON.parse(currentLoggedIn);
                if (parsed.id === userId || parsed.username === user.username) {
                    parsed.role = newRole;
                    parsed.permissions = newPermsStr;
                    localStorage.setItem('user', JSON.stringify(parsed));
                }
            }
        } catch (e) {}

        try {
            if (isTauri()) {
                await tauriUpdateUserRoleAdmin(userId, newRole);
                if (newRole !== 'admin') {
                    await tauriUpdateUserPermissionsAdmin(userId, newPermsStr);
                }
            } else {
                await fetch(`/api/admin/role/${userId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: newRole })
                });
            }
            setMessage(`Perfil de '${user.username}' actualizado a ${newRole === 'admin' ? 'Administrador' : 'Operario'}`);
            await fetchUsers();
        } catch (e) {
            console.error("Error al actualizar rol de usuario:", e);
            setError(typeof e === 'string' ? e : (e.message || "Error al actualizar rol"));
            fetchUsers();
        }
    };

    const handleToggleSinglePermission = async (userId, moduleKey) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        const currentPerms = parsePermissions(user.permissions);
        let newPerms;
        if (currentPerms.includes(moduleKey)) {
            newPerms = currentPerms.filter(p => p !== moduleKey);
        } else {
            newPerms = [...currentPerms, moduleKey];
        }

        await savePermissionsForUser(userId, user.username, newPerms);
    };

    const handleSetCategoryPermissions = async (userId, categoryName, enableAll) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        const currentPerms = new Set(parsePermissions(user.permissions));
        const categoryModules = SIDEBAR_MODULES.filter(m => m.category === categoryName);

        categoryModules.forEach(m => {
            if (enableAll) {
                currentPerms.add(m.key);
            } else {
                currentPerms.delete(m.key);
            }
        });

        await savePermissionsForUser(userId, user.username, Array.from(currentPerms));
    };

    const savePermissionsForUser = async (userId, username, newPermsArray) => {
        const newPermsStr = newPermsArray.join(',');

        // Optimistic update
        const updatedUsers = users.map(u => {
            if (u.id === userId) {
                return { ...u, permissions: newPermsStr };
            }
            return u;
        });
        setUsers(updatedUsers);

        // Si el usuario editado es el mismo que tiene sesión iniciada, actualizar localStorage
        try {
            const currentLoggedIn = localStorage.getItem('user');
            if (currentLoggedIn) {
                const parsed = JSON.parse(currentLoggedIn);
                if (parsed.id === userId || parsed.username === username) {
                    parsed.permissions = newPermsStr;
                    localStorage.setItem('user', JSON.stringify(parsed));
                }
            }
        } catch (e) {}

        try {
            if (isTauri()) {
                await tauriUpdateUserPermissionsAdmin(userId, newPermsStr);
            } else {
                const res = await fetch(`/api/admin/permissions/${userId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permissions: newPermsArray })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.detail || "Error al guardar permisos");
                }
            }
        } catch (e) {
            console.error("Error al actualizar permisos:", e);
            setError(typeof e === 'string' ? e : (e.message || "Error al guardar permisos"));
            fetchUsers();
        }
    };

    const toggleExpandUser = (userId) => {
        setExpandedUserId(prev => prev === userId ? null : userId);
    };

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f] text-[12px]">
            {/* Cabecera Principal */}
            <div className="flex justify-between items-center mb-3 border-b border-[#e5e7eb] pb-2">
                <div className="flex items-center gap-2">
                    <h1 className="text-[14px] font-normal text-[#1f1f1f]">Gestión de Usuarios y Permisos Individuales</h1>
                    <span className="text-[11px] text-[#6b7280] font-normal">({users.length} registrados)</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={fetchUsers}
                        className="h-7 px-3 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] rounded text-[12px] font-normal transition-colors cursor-pointer shadow-xs"
                    >
                        Actualizar Lista
                    </button>
                </div>
            </div>

            {/* Aviso informativo de políticas de seguridad */}
            <div className="mb-3 p-2.5 bg-[#f0f6fc] border border-[#c8e1fb] rounded text-[11.5px] text-[#1f1f1f] font-normal flex items-start gap-2.5 leading-relaxed">
                <svg className="w-4 h-4 text-[#0067c0] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                    <span><strong>Política de Control de Acceso:</strong> La autorización se realiza por módulo individual (incluyendo <strong>Carga de Datos</strong>). Únicamente el usuario <strong>admin</strong> principal tiene la potestad de otorgar o retirar el perfil de Administrador a otras cuentas.</span>
                </div>
            </div>

            {message && (
                <div className="mb-3 p-2 bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534] rounded text-[12px] font-normal">
                    {message}
                </div>
            )}
            {error && (
                <div className="mb-3 p-2 bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] rounded text-[12px] font-normal">
                    {error}
                </div>
            )}

            {/* Tabla de Usuarios */}
            <div className="bg-white rounded border border-[#d1d5db] shadow-xs overflow-hidden mb-6">
                <div className="flex justify-between items-center px-4 py-2.5 bg-[#354a5f] text-white border-b border-[#2a3c4e]">
                    <h2 className="text-[13px] font-normal text-white">Directorio de Usuarios</h2>
                    <span className="text-[11px] text-gray-300 font-normal">{users.length} Cuentas</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-[#354a5f] text-white text-[11px] font-normal border-b border-[#2a3c4e]">
                            <tr>
                                <th className="px-3 py-2 text-center w-12 font-normal">ID</th>
                                <th className="px-3 py-2 font-normal">Usuario</th>
                                <th className="px-3 py-2 text-center font-normal">Estado Cuenta</th>
                                <th className="px-3 py-2 text-center font-normal">Perfil Administrador</th>
                                <th className="px-3 py-2 font-normal">Módulos Autorizados</th>
                                <th className="px-3 py-2 text-center font-normal">Módulos</th>
                                <th className="px-3 py-2 text-center font-normal">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u, idx) => {
                                const isExpanded = expandedUserId === u.id;
                                const userPerms = parsePermissions(u.permissions);
                                const isUserAdminRole = isUserAdmin(u);
                                const isThisRootAdmin = String(u.username || '').toLowerCase().trim() === 'admin';
                                const activeModuleCount = isUserAdminRole ? SIDEBAR_MODULES.length : userPerms.length;

                                return (
                                    <React.Fragment key={u.id}>
                                        <tr className={`border-b border-[#f0f0f0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#edf3f9] transition-colors`}>
                                            <td className="px-3 py-2 text-center text-gray-500 font-mono text-[11px]">{u.id}</td>
                                            <td className="px-3 py-2 font-normal text-gray-900">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-normal">{u.username}</span>
                                                    {isUserAdminRole && (
                                                        <span className="px-1.5 py-0.2 text-[10px] bg-[#0067c0] text-white rounded font-normal">
                                                            Admin
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {u.is_approved ? (
                                                    <span className="px-2 py-0.5 rounded text-[11px] font-normal bg-green-50 text-green-700 border border-green-200">
                                                        Aprobado
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded text-[11px] font-normal bg-amber-50 text-amber-700 border border-amber-200">
                                                        Pendiente
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <label className={`inline-flex items-center gap-1.5 select-none ${isRootAdmin && !isThisRootAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'}`} title={!isRootAdmin ? "Solo el usuario principal 'admin' puede otorgar o retirar el perfil de Administrador" : isThisRootAdmin ? "El usuario 'admin' principal no puede ser modificado" : ""}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isUserAdminRole}
                                                        disabled={!isRootAdmin || isThisRootAdmin}
                                                        onChange={() => handleToggleAdminRole(u.id)}
                                                        className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#0067c0] focus:ring-0 accent-[#0067c0] cursor-pointer disabled:cursor-not-allowed"
                                                    />
                                                    <span className={`text-[11px] font-normal ${isUserAdminRole ? 'text-[#0067c0] font-semibold' : 'text-[#605e5c]'}`}>
                                                        {isUserAdminRole ? 'Administrador' : 'Operario'}
                                                    </span>
                                                </label>
                                            </td>
                                            <td className="px-3 py-2 font-normal text-[#1f1f1f]">
                                                {isUserAdminRole ? (
                                                    <span className="text-[11px] text-[#0067c0] font-normal">
                                                        Acceso total ({SIDEBAR_MODULES.length} módulos)
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-[#605e5c] font-normal">
                                                        {activeModuleCount} de {SIDEBAR_MODULES.length} módulos autorizados
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpandUser(u.id)}
                                                    className={`h-6 px-2.5 rounded text-[11px] font-normal border transition-colors cursor-pointer flex items-center justify-center gap-1 mx-auto ${
                                                        isExpanded
                                                            ? 'bg-[#0067c0] text-white border-[#0067c0]'
                                                            : 'bg-white hover:bg-[#f5f5f5] text-[#0067c0] border-[#d1d5db]'
                                                    }`}
                                                >
                                                    <span>{isExpanded ? 'Ocultar Permisos' : 'Configurar'}</span>
                                                    <span className="text-[9px]">{isExpanded ? '▲' : '▼'}</span>
                                                </button>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <div className="flex justify-center items-center gap-1.5">
                                                    {!u.is_approved && (
                                                        <button
                                                            onClick={() => handleApprove(u.id)}
                                                            className="h-6 px-2.5 bg-[#107c41] hover:bg-[#0b5a2f] text-white rounded text-[11px] font-normal transition-colors cursor-pointer"
                                                        >
                                                            Aprobar
                                                        </button>
                                                    )}

                                                    <button
                                                        onClick={() => handleResetPassword(u.id)}
                                                        className="h-6 px-2 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] rounded text-[11px] font-normal transition-colors cursor-pointer"
                                                    >
                                                        Reset Pass
                                                    </button>

                                                    <button
                                                        onClick={() => handleDelete(u.id)}
                                                        disabled={u.username === 'admin'}
                                                        className="h-6 px-2 text-[#a80000] hover:bg-[#fde7e9] border border-[#f8b8bc] rounded text-[11px] font-normal transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                                        title="Eliminar usuario"
                                                    >
                                                        Eliminar
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Panel Expandible de Permisos por Módulo Individual */}
                                        {isExpanded && (
                                            <tr className="bg-[#fcfcfc] border-b border-[#d1d5db]">
                                                <td colSpan="7" className="p-4">
                                                    <div className="bg-white border border-[#e5e7eb] rounded p-4 shadow-inner">
                                                        
                                                        {/* Opción destacada para marcar Perfil de Administrador */}
                                                        <div className="flex items-center justify-between p-3 mb-3.5 bg-[#f0f6fc] border border-[#c8e1fb] rounded">
                                                            <div className="flex items-center gap-2.5">
                                                                <input
                                                                    type="checkbox"
                                                                    id={`admin-role-expanded-${u.id}`}
                                                                    checked={isUserAdminRole}
                                                                    disabled={!isRootAdmin || isThisRootAdmin}
                                                                    onChange={() => handleToggleAdminRole(u.id)}
                                                                    className="w-4 h-4 rounded border-[#d1d5db] text-[#0067c0] focus:ring-0 accent-[#0067c0] cursor-pointer disabled:cursor-not-allowed"
                                                                />
                                                                <label htmlFor={`admin-role-expanded-${u.id}`} className={`text-[12px] font-semibold text-[#1f1f1f] select-none ${isRootAdmin && !isThisRootAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                                                                    Perfil de Administrador Global
                                                                    {!isRootAdmin && (
                                                                        <span className="ml-2 text-[10.5px] text-[#a80000] font-normal">
                                                                            (Solo modificable por el usuario principal 'admin')
                                                                        </span>
                                                                    )}
                                                                </label>
                                                            </div>
                                                            <span className="text-[11px] text-[#605e5c] font-normal">
                                                                {isUserAdminRole
                                                                    ? 'Este usuario tiene acceso total y facultades de administración.'
                                                                    : 'Perfil de Operario: se rige estrictamente por los módulos seleccionados abajo.'}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#e5e7eb]">
                                                            <div>
                                                                <h3 className="text-[13px] font-normal text-[#1f1f1f]">
                                                                    Módulos individuales asignados a: <span className="font-semibold">{u.username}</span>
                                                                </h3>
                                                                <span className="text-[11px] text-[#605e5c] font-normal">
                                                                    Active las opciones permitidas en el panel lateral para este usuario.
                                                                </span>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const allKeys = SIDEBAR_MODULES.filter(m => !m.adminOnly || isUserAdminRole).map(m => m.key);
                                                                        savePermissionsForUser(u.id, u.username, allKeys);
                                                                    }}
                                                                    className="h-6 px-2.5 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#0067c0] text-[11px] font-normal rounded cursor-pointer"
                                                                >
                                                                    Marcar todos
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => savePermissionsForUser(u.id, u.username, [])}
                                                                    className="h-6 px-2.5 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#a80000] text-[11px] font-normal rounded cursor-pointer"
                                                                >
                                                                    Desmarcar todos
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Grid de Categorías con Checkboxes Individuales */}
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
                                                            {MODULE_CATEGORIES.map(categoryName => {
                                                                const categoryModules = SIDEBAR_MODULES.filter(m => m.category === categoryName);
                                                                const allCategoryChecked = categoryModules.every(m => userPerms.includes(m.key));

                                                                return (
                                                                    <div key={categoryName} className="bg-[#fafafa] border border-[#e1dfdd] rounded p-2.5 flex flex-col justify-between">
                                                                        <div>
                                                                            <div className="flex justify-between items-center pb-1.5 mb-2 border-b border-[#e1dfdd]">
                                                                                <span className="text-[11px] font-semibold text-[#323130] uppercase tracking-normal">
                                                                                    {categoryName}
                                                                                </span>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleSetCategoryPermissions(u.id, categoryName, !allCategoryChecked)}
                                                                                    className="text-[10px] text-[#0067c0] hover:underline font-normal cursor-pointer"
                                                                                >
                                                                                    {allCategoryChecked ? 'Desmarcar' : 'Todos'}
                                                                                </button>
                                                                            </div>

                                                                            <div className="space-y-1.5">
                                                                                {categoryModules.map(mod => {
                                                                                    const isChecked = userPerms.includes(mod.key);
                                                                                    const isBlockedForNonAdmin = mod.adminOnly && !isUserAdminRole;

                                                                                    return (
                                                                                        <label
                                                                                            key={mod.key}
                                                                                            className={`flex items-start gap-2 p-1 rounded hover:bg-white transition-colors cursor-pointer select-none ${
                                                                                                isBlockedForNonAdmin ? 'opacity-50 cursor-not-allowed' : ''
                                                                                            }`}
                                                                                            title={isBlockedForNonAdmin ? 'Solo disponible para usuarios con perfil Administrador' : mod.path}
                                                                                        >
                                                                                            <input
                                                                                                type="checkbox"
                                                                                                checked={isChecked}
                                                                                                disabled={isBlockedForNonAdmin}
                                                                                                onChange={() => handleToggleSinglePermission(u.id, mod.key)}
                                                                                                className="mt-0.5 w-3.5 h-3.5 rounded border-[#d1d5db] text-[#0067c0] focus:ring-0 cursor-pointer accent-[#0067c0]"
                                                                                            />
                                                                                            <div className="flex flex-col leading-tight">
                                                                                                <span className="text-[11.5px] font-normal text-[#1f1f1f]">
                                                                                                    {mod.name}
                                                                                                </span>
                                                                                                <span className="text-[10px] font-mono text-[#7f7f7f]">
                                                                                                    {mod.path}
                                                                                                </span>
                                                                                            </div>
                                                                                        </label>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="text-center py-8 text-gray-500 italic font-normal">
                                        No hay usuarios registrados.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-center">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="text-[12px] text-[#605e5c] hover:text-[#1f1f1f] flex items-center justify-center gap-1.5 mx-auto font-normal cursor-pointer"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Volver al Dashboard principal
                </button>
            </div>
        </div>
    );
};

export default AdminUsers;
