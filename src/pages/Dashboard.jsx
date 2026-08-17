import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';

export const CATEGORIES_CONFIG = [
    { id: 'recepcion', title: 'Gestión de Recepción', accent: 'bg-blue-600', dropBg: 'bg-blue-50/60' },
    { id: 'despacho', title: 'Operaciones de Despacho', accent: 'bg-emerald-600', dropBg: 'bg-emerald-50/60' },
    { id: 'inventario', title: 'Control de Inventario', accent: 'bg-amber-600', dropBg: 'bg-amber-50/60' },
    { id: 'admin', title: 'Administración del Sistema', accent: 'bg-slate-700', dropBg: 'bg-slate-50/60' }
];

const DEFAULT_CATEGORIES = [
    {
        id: 'recepcion',
        title: 'Gestión de Recepción',
        accent: 'bg-blue-600',
        items: [
            { href: '/inbound', text: 'REGISTRO INBOUND', desc: 'Entrada de mercancía y referencias', categoryId: 'recepcion' },
            { href: '/reconciliation', text: 'CONCILIACIÓN', desc: 'Cruce de documentos y discrepancias', categoryId: 'recepcion' },
            { href: '/view_logs', text: 'HISTORIAL', desc: 'Consulta de registros históricos', categoryId: 'recepcion' },
            { href: '/stock', text: 'CONSULTAR STOCK', desc: 'Búsqueda global de inventario y saldos', categoryId: 'recepcion' }
        ]
    },
    {
        id: 'despacho',
        title: 'Operaciones de Despacho',
        accent: 'bg-emerald-600',
        items: [
            { href: '/picking', text: 'AUDITORÍA PICKING', desc: 'Verificación de pedidos y empaque', categoryId: 'despacho' },
            { href: '/view_picking_audits', text: 'REPORTES EMPAQUE', desc: 'Listas de empaque y auditorías', categoryId: 'despacho' },
            { href: '/shipments', text: 'CONSOLIDACIÓN', desc: 'Gestión de despachos y embarques', categoryId: 'despacho' },
            { href: '/label', text: 'ETIQUETADO', desc: 'Impresión de etiquetas operativas', categoryId: 'despacho' }
        ]
    },
    {
        id: 'inventario',
        title: 'Control de Inventario',
        accent: 'bg-amber-600',
        items: [
            { href: '/planner', text: 'PLANIFICACIÓN', desc: 'Programación de conteos cíclicos', categoryId: 'inventario' },
            { href: '/inventory-dashboard', text: 'MÉTRICAS ERI', desc: 'Indicadores de exactitud', categoryId: 'inventario' },
            { href: '/planner/manage_differences', text: 'DIFERENCIAS CICLICOS', desc: 'Gestión de ajustes y discrepancias', categoryId: 'inventario' },
            { href: '/counts', text: 'INVENTARIO W2W', desc: 'Conteo masivo wall-to-wall', categoryId: 'inventario' },
            { href: '/express-audit', text: 'CICLO MANUAL', desc: 'Conteo ciego y auditoría rápida', categoryId: 'inventario' }
        ]
    },
    {
        id: 'admin',
        title: 'Administración del Sistema',
        accent: 'bg-slate-700',
        items: [
            { href: '/admin/inventory', text: 'ADMINISTRACIÓN INVENTARIO', desc: 'Control de ciclos de conteo', categoryId: 'admin' },
            { href: '/admin/slotting', text: 'REGLAS SLOTTING', desc: 'Parámetros de ubicaciones', categoryId: 'admin' },
            { href: '/occupancy', text: 'OCUPACIÓN BODEGA', desc: 'Análisis de espacio y ubicaciones', categoryId: 'admin' },
            { href: '/update', text: 'CARGA DE DATOS', desc: 'Actualización masiva vía ficheros', categoryId: 'admin' }
        ]
    }
];

const STORAGE_KEY = 'logix_dashboard_layout_v2';

const Dashboard = () => {
    const { setTitle } = useOutletContext();
    const [categories, setCategories] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {
            console.error("Error cargando configuración de dashboard:", e);
        }
        return DEFAULT_CATEGORIES;
    });

    const [activeDropCategory, setActiveDropCategory] = useState(null);
    const [draggedItem, setDraggedItem] = useState(null);
    const [feedbackMessage, setFeedbackMessage] = useState(null);

    useEffect(() => {
        setTitle("Dashboard");
    }, [setTitle]);

    // Guardar en localStorage
    const saveCategories = (newCats) => {
        setCategories(newCats);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newCats));
        } catch (e) {
            console.error("Error guardando dashboard:", e);
        }
    };

    const showFeedback = (msg) => {
        setFeedbackMessage(msg);
        setTimeout(() => setFeedbackMessage(null), 3000);
    };

    // Escuchar eventos de fijación desde el menú lateral
    useEffect(() => {
        const handleGlobalPin = (e) => {
            if (e.detail) {
                pinItem(e.detail);
            }
        };
        window.addEventListener('logix_dashboard_pin_item', handleGlobalPin);
        return () => window.removeEventListener('logix_dashboard_pin_item', handleGlobalPin);
    }, [categories]);

    // Fijar / Añadir un ítem a una categoría
    const pinItem = (moduleItem, targetCategoryId = null) => {
        const catId = targetCategoryId || moduleItem.categoryId || 'recepcion';
        let alreadyExists = false;

        const updated = categories.map(cat => {
            const existsInCat = cat.items.some(i => i.href === moduleItem.href);
            if (existsInCat) alreadyExists = true;

            if (cat.id === catId && !existsInCat) {
                return {
                    ...cat,
                    items: [...cat.items, { ...moduleItem, categoryId: cat.id }]
                };
            }
            return cat;
        });

        if (alreadyExists) {
            showFeedback(`"${moduleItem.text}" ya se encuentra en el Dashboard.`);
            return;
        }

        saveCategories(updated);
        showFeedback(`"${moduleItem.text}" fijado en el Dashboard.`);
    };

    // Desfijar / Retirar un ítem del Dashboard
    const unpinItem = (e, href) => {
        e.preventDefault();
        e.stopPropagation();
        const updated = categories.map(cat => ({
            ...cat,
            items: cat.items.filter(i => i.href !== href)
        }));
        saveCategories(updated);
        showFeedback("Opción retirada del Dashboard.");
    };

    // Drag & Drop Handlers
    const handleDragStartCard = (e, item, fromCatId, index) => {
        setDraggedItem({ item, fromCatId, index });
        e.dataTransfer.setData('application/json', JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOverCategory = (e, categoryId) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copyMove';
        if (activeDropCategory !== categoryId) {
            setActiveDropCategory(categoryId);
        }
    };

    const handleDragLeaveCategory = (e, categoryId) => {
        if (activeDropCategory === categoryId) {
            setActiveDropCategory(null);
        }
    };

    const handleDropOnCategory = (e, categoryId) => {
        e.preventDefault();
        setActiveDropCategory(null);

        let data = null;
        try {
            const raw = e.dataTransfer.getData('application/json');
            if (raw) data = JSON.parse(raw);
        } catch (err) {
            console.warn("Error leyendo drop data:", err);
        }

        if (!data && draggedItem) {
            data = draggedItem.item;
        }

        if (!data || !data.href) return;

        // Si viene de arrastre interno de una categoría a otra
        if (draggedItem && draggedItem.fromCatId) {
            const fromCatId = draggedItem.fromCatId;
            const updated = categories.map(cat => {
                if (cat.id === fromCatId && fromCatId !== categoryId) {
                    return {
                        ...cat,
                        items: cat.items.filter(i => i.href !== data.href)
                    };
                }
                if (cat.id === categoryId) {
                    const alreadyIn = cat.items.some(i => i.href === data.href);
                    if (!alreadyIn) {
                        return {
                            ...cat,
                            items: [...cat.items, { ...data, categoryId }]
                        };
                    }
                }
                return cat;
            });
            saveCategories(updated);
            setDraggedItem(null);
            showFeedback(`"${data.text}" reubicado en ${categories.find(c => c.id === categoryId)?.title || 'categoría'}.`);
            return;
        }

        // Si se arrastra desde el menú lateral
        pinItem(data, categoryId);
        setDraggedItem(null);
    };

    return (
        <div className="min-h-[calc(100vh-80px)] bg-[#f8fafc] px-6 pt-4 pb-12 lg:px-12 lg:pt-6 lg:pb-12">
            <div className="max-w-7xl mx-auto">
                {/* Feedback Toast */}
                {feedbackMessage && (
                    <div className="mb-4 px-4 py-2 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium rounded-md shadow-sm transition-all animate-fadeIn flex items-center justify-between">
                        <span>{feedbackMessage}</span>
                        <button onClick={() => setFeedbackMessage(null)} className="text-blue-500 hover:text-blue-700 font-bold ml-4">✕</button>
                    </div>
                )}

                {/* Grid de Categorías con Drop Zones */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {categories.map((category) => {
                        const isHovered = activeDropCategory === category.id;
                        const config = CATEGORIES_CONFIG.find(c => c.id === category.id) || CATEGORIES_CONFIG[0];

                        return (
                            <div
                                key={category.id}
                                onDragOver={(e) => handleDragOverCategory(e, category.id)}
                                onDragLeave={(e) => handleDragLeaveCategory(e, category.id)}
                                onDrop={(e) => handleDropOnCategory(e, category.id)}
                                className={`flex flex-col p-2 rounded-xl transition-all duration-200 border-2 ${
                                    isHovered ? `border-dashed border-blue-500 ${config.dropBg} scale-[1.01] shadow-lg` : 'border-transparent bg-transparent'
                                }`}
                            >
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={`h-4 w-1 ${category.accent || config.accent} rounded-full`}></div>
                                    <h2 className="text-sm font-normal text-black uppercase tracking-normal">{category.title}</h2>
                                </div>

                                <div className="space-y-3 min-h-[140px] flex flex-col">
                                    {category.items.length === 0 ? (
                                        <div className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-lg text-center bg-white/50">
                                            <p className="text-[11px] text-slate-400 font-normal">Arrastra opciones aquí para fijarlas</p>
                                        </div>
                                    ) : (
                                        category.items.map((item, idx) => (
                                            <div
                                                key={item.href || idx}
                                                draggable
                                                onDragStart={(e) => handleDragStartCard(e, item, category.id, idx)}
                                                className="group relative block bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-400 hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing select-none"
                                            >
                                                <Link to={item.href} className="block pr-5">
                                                    <div className="text-xs font-normal text-black group-hover:text-blue-700 transition-colors tracking-normal">
                                                        {item.text}
                                                    </div>
                                                    <div className="text-[11px] text-black font-normal mt-1 uppercase tracking-normal">
                                                        {item.desc}
                                                    </div>
                                                </Link>

                                                {/* Botón de Desfijar / Retirar */}
                                                <button
                                                    onClick={(e) => unpinItem(e, item.href)}
                                                    className="absolute top-2 right-2 p-1 text-slate-300 hover:text-red-600 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all duration-150"
                                                    title="Retirar del Dashboard"
                                                    aria-label="Retirar del Dashboard"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
