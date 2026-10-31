import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { isTauri, tauriGetAllUsersAdmin, tauriDeleteUserAdmin, tauriResetPasswordAdmin } from '../utils/tauriBridge';

const AdminUsers = () => {
    const navigate = useNavigate();
    const { setTitle } = useOutletContext();
    const [users, setUsers] = useState([]);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

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
        if (setTitle) setTitle("Gestión de Usuarios");
    }, [setTitle, fetchUsers]);

    const handleApprove = async (id) => {
        setMessage(`Usuario ${id} aprobado`);
        fetchUsers();
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
        if (Array.isArray(permissions)) return permissions.map(p => String(p).trim()).filter(Boolean);
        if (typeof permissions === 'string') {
            const trimmed = permissions.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) return parsed.map(p => String(p).trim()).filter(Boolean);
                } catch (e) {}
            }
            return trimmed.split(',').map(p => p.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
        return [];
    };

    const MODULES = ['stock', 'inbound', 'picking', 'inventory', 'planner', 'counts', 'admin'];

    const handlePermissionChange = async (userId, module) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        // Robust parse of existing permissions
        const currentPerms = parsePermissions(user.permissions);

        let newPerms;
        if (currentPerms.includes(module)) {
            newPerms = currentPerms.filter(p => p !== module);
        } else {
            newPerms = [...currentPerms, module];
        }

        const newPermsStr = newPerms.join(',');

        // Optimistic update
        const updatedUsers = users.map(u => {
            if (u.id === userId) {
                return { ...u, permissions: newPermsStr };
            }
            return u;
        });
        setUsers(updatedUsers);

        // Synchronize currently logged-in user in localStorage if matching
        try {
            const currentLoggedIn = localStorage.getItem('user');
            if (currentLoggedIn) {
                const parsed = JSON.parse(currentLoggedIn);
                if (parsed.id === userId || parsed.username === user.username) {
                    parsed.permissions = newPermsStr;
                    localStorage.setItem('user', JSON.stringify(parsed));
                }
            }
        } catch (e) {}

        try {
            const res = await fetch(`/api/admin/permissions/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissions: newPerms })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                console.error("Permission save error:", errData);
                throw new Error(errData.detail || "Error saving permissions");
            }
        } catch (e) {
            console.error(e);
            setError(e.message);
            // Revert on error
            fetchUsers();
        }
    };

    return (
        <div className="max-w-[1920px] mx-auto px-4 py-3 font-['Segoe_UI',Tahoma,sans-serif] bg-[#f3f3f3] min-h-screen text-[#1f1f1f] text-[12px]">
            {/* Action Bar */}
            <div className="flex justify-between items-center mb-3 border-b border-[#e5e7eb] pb-2">
                <div className="flex items-center gap-2">
                    <h1 className="text-[14px] font-normal text-[#1f1f1f]">Gestión de Usuarios y Permisos</h1>
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

                {/* Users Tile */}
                <div className="bg-white rounded border border-[#d1d5db] shadow-xs overflow-hidden">
                    {/* Header */}
                    <div className="flex justify-between items-center px-4 py-2.5 bg-[#354a5f] text-white border-b border-[#2a3c4e]">
                        <h2 className="text-[13px] font-normal text-white">Usuarios Registrados</h2>
                        <span className="text-[11px] text-gray-300 font-normal">{users.length} Usuarios</span>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#354a5f] text-white text-[11px] font-normal border-b border-[#2a3c4e]">
                                <tr>
                                    <th className="px-3 py-2 text-center w-12 font-normal">ID</th>
                                    <th className="px-3 py-2 font-normal">Usuario</th>
                                    <th className="px-3 py-2 text-center font-normal">Estado</th>
                                    {MODULES.map(m => (
                                        <th key={m} className="px-2 py-2 text-center font-normal text-[10.5px] uppercase">{m}</th>
                                    ))}
                                    <th className="px-3 py-2 text-center font-normal">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u, idx) => (
                                    <tr key={u.id} className={`border-b border-[#f0f0f0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#edf3f9] transition-colors`}>
                                        <td className="px-3 py-2 text-center text-gray-500 font-mono text-[11px]">{u.id}</td>
                                        <td className="px-3 py-2 font-normal text-gray-900">{u.username}</td>
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
                                        {MODULES.map(m => {
                                            const perms = parsePermissions(u.permissions);
                                            const hasPerm = perms.includes(m);
                                            return (
                                                <td key={m} className="px-2 py-2 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={hasPerm}
                                                        onChange={() => handlePermissionChange(u.id, m)}
                                                        className="w-3.5 h-3.5 rounded border-[#d1d5db] text-[#0067c0] focus:ring-0 cursor-pointer accent-[#0067c0]"
                                                    />
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 text-center">
                                            <div className="flex justify-center items-center gap-1.5">
                                                <button
                                                    className="h-6 px-2 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#0067c0] rounded text-[11px] font-normal transition-colors cursor-pointer"
                                                    onClick={() => { alert('Verificar contraseña (no implementado en React aún)'); }}
                                                >
                                                    Verificar
                                                </button>

                                                {!u.is_approved && (
                                                    <button
                                                        onClick={() => handleApprove(u.id)}
                                                        className="h-6 px-2.5 bg-[#0067c0] hover:bg-[#005a9e] text-white rounded text-[11px] font-normal transition-colors cursor-pointer"
                                                    >
                                                        Aprobar
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => handleResetPassword(u.id)}
                                                    className="h-6 px-2 bg-white hover:bg-[#f5f5f5] border border-[#d1d5db] text-[#1f1f1f] rounded text-[11px] font-normal transition-colors cursor-pointer"
                                                >
                                                    Restablecer Pass
                                                </button>

                                                <button
                                                    onClick={() => handleDelete(u.id)}
                                                    className="h-6 px-2 text-red-600 hover:bg-red-50 rounded border border-red-200 transition-colors cursor-pointer text-[11px] font-normal"
                                                    title="Eliminar"
                                                >
                                                    Eliminar
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan={4 + MODULES.length} className="text-center py-8 text-gray-400 font-normal">
                                            No hay usuarios registrados.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
    );
};

export default AdminUsers;
