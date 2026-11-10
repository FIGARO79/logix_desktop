import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabContext as useOutletContext } from '../hooks/useTabContext';
import { useLanguage } from '../context/LanguageContext';
import { canUserAccessPath } from '../utils/permissions';

export const CATEGORIES_CONFIG = [
    { id: 'recepcion', title: 'Gestión de Recepción', accent: 'bg-[#0067c0]', dropBg: 'bg-[#f0f6fc]' },
    { id: 'despacho', title: 'Operaciones de Despacho', accent: 'bg-[#107c41]', dropBg: 'bg-[#f1faf3]' },
    { id: 'inventario', title: 'Control de Inventario', accent: 'bg-[#d83b01]', dropBg: 'bg-[#fdf4f0]' },
    { id: 'admin', title: 'Administración del Sistema', accent: 'bg-[#4a5568]', dropBg: 'bg-[#f7f8f9]' }
];

const DEFAULT_CATEGORIES = [
    {
        id: 'recepcion',
        title: 'Gestión de Recepción',
        accent: 'bg-[#0067c0]',
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
        accent: 'bg-[#107c41]',
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
        accent: 'bg-[#d83b01]',
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
        accent: 'bg-[#4a5568]',
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
    const navigate = useNavigate();
    const { setTitle } = useOutletContext();
    const { t, language } = useLanguage();
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

    const [dragging, setDragging] = useState(null); // { item, fromCatId, fromIndex, x, y }
    const [dropTarget, setDropTarget] = useState(null); // { catId, targetIndex, position: 'before' | 'after' | 'end' }
    const [feedbackMessage, setFeedbackMessage] = useState(null);

    const pointerStateRef = useRef({
        isDown: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        item: null,
        catId: null
    });
    const dropTargetRef = useRef(null);

    const currentUser = useMemo(() => {
        try {
            const raw = localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }, []);

    // Opciones y categorías visibles: solo aquellas que el usuario tiene autorizadas
    const visibleCategories = useMemo(() => {
        return categories
            .map(category => ({
                ...category,
                items: category.items.filter(item => canUserAccessPath(currentUser, item.href))
            }))
            .filter(category => category.items.length > 0);
    }, [categories, currentUser]);

    const handleCardClick = (item) => {
        if (!item?.href) return;
        if (!canUserAccessPath(currentUser, item.href)) {
            showFeedback("Módulo bloqueado: tu usuario no tiene asignado este permiso.");
            return;
        }
        navigate(item.href);
    };

    useEffect(() => {
        dropTargetRef.current = dropTarget;
    }, [dropTarget]);

    useEffect(() => {
        const handleExternalPin = (e) => {
            if (e?.detail) {
                pinItem(e.detail);
            }
        };
        window.addEventListener('logix_dashboard_pin_item', handleExternalPin);
        return () => window.removeEventListener('logix_dashboard_pin_item', handleExternalPin);
    }, [categories]);

    useEffect(() => {
        setTitle(t('dashboard.title', 'Dashboard'));
    }, [setTitle, t, language]);

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

    const resetToDefault = () => {
        saveCategories(DEFAULT_CATEGORIES);
        showFeedback("Orden original restablecido.");
    };

    // Mover un ítem una posición arriba o abajo directamente con un clic
    const moveItem = (e, catId, index, direction) => {
        e.preventDefault();
        e.stopPropagation();

        setCategories(prev => {
            const newCats = prev.map(c => ({ ...c, items: [...c.items] }));
            const cat = newCats.find(c => c.id === catId);
            if (!cat) return prev;

            const targetIdx = direction === 'up' ? index - 1 : index + 1;
            if (targetIdx < 0 || targetIdx >= cat.items.length) return prev;

            const temp = cat.items[index];
            cat.items[index] = cat.items[targetIdx];
            cat.items[targetIdx] = temp;

            saveCategories(newCats);
            return newCats;
        });
    };

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

    // Pointer Events para Drag & Drop 100% nativo sin OLE
    const handlePointerDown = (e, item, catId) => {
        if (e.button !== 0) return; // Solo click principal
        if (e.target.closest('button')) return; // Evitar si se hace clic en botones
        if (!canUserAccessPath(currentUser, item?.href)) return; // No permitir arrastrar módulos bloqueados

        pointerStateRef.current = {
            isDown: true,
            hasMoved: false,
            startX: e.clientX,
            startY: e.clientY,
            item,
            catId
        };

        const handlePointerMove = (moveEvent) => {
            const p = pointerStateRef.current;
            if (!p.isDown) return;

            const dx = moveEvent.clientX - p.startX;
            const dy = moveEvent.clientY - p.startY;

            if (!p.hasMoved && Math.hypot(dx, dy) > 12) {
                p.hasMoved = true;
                setDragging({
                    item: p.item,
                    fromCatId: p.catId,
                    x: moveEvent.clientX,
                    y: moveEvent.clientY
                });
            }

            if (p.hasMoved) {
                setDragging(prev => prev ? { ...prev, x: moveEvent.clientX, y: moveEvent.clientY } : null);

                // Detectar el elemento bajo el cursor
                const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                if (!el) {
                    setDropTarget(null);
                    return;
                }

                const cardEl = el.closest('[data-dashboard-card]');
                const catEl = el.closest('[data-dashboard-category]');

                if (cardEl) {
                    const targetCatId = cardEl.getAttribute('data-cat-id');
                    const targetHref = cardEl.getAttribute('data-card-href');
                    const rect = cardEl.getBoundingClientRect();
                    const isTopHalf = (moveEvent.clientY - rect.top) < (rect.height / 2);
                    const position = isTopHalf ? 'before' : 'after';

                    if (p.catId === targetCatId && p.item?.href === targetHref) {
                        setDropTarget(null);
                    } else {
                        setDropTarget({ catId: targetCatId, targetHref, position });
                    }
                } else if (catEl) {
                    const targetCatId = catEl.getAttribute('data-cat-id');
                    setDropTarget({ catId: targetCatId, targetHref: null, position: 'end' });
                } else {
                    setDropTarget(null);
                }
            }
        };

        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);

            const p = pointerStateRef.current;
            const target = dropTargetRef.current;

            const wasDragging = p.hasMoved;
            const clickedItem = p.item;

            pointerStateRef.current = { isDown: false, hasMoved: false, item: null, catId: null };
            setDragging(null);
            setDropTarget(null);

            if (!wasDragging) {
                // Fue un clic simple -> Navegar dentro de la misma pestaña
                if (clickedItem?.href) {
                    navigate(clickedItem.href);
                }
                return;
            }

            // Fue un arrastre -> Reordenar
            if (!target || !p.item) return;

            const { catId: fromCatId, item } = p;
            const { catId: targetCatId, targetHref, position } = target;

            setCategories(prev => {
                const newCats = prev.map(c => ({ ...c, items: [...c.items] }));
                const sourceCat = newCats.find(c => c.id === fromCatId);
                const destCat = newCats.find(c => c.id === targetCatId);

                if (!sourceCat || !destCat) return prev;

                const fromIndex = sourceCat.items.findIndex(i => i.href === item.href);
                if (fromIndex === -1) return prev;

                const [moved] = sourceCat.items.splice(fromIndex, 1);
                if (!moved) return prev;

                const itemToInsert = { ...moved, categoryId: targetCatId };

                if (position === 'end' || !targetHref) {
                    destCat.items.push(itemToInsert);
                } else {
                    const targetIndex = destCat.items.findIndex(i => i.href === targetHref);
                    if (targetIndex === -1) {
                        destCat.items.push(itemToInsert);
                    } else {
                        const insertIdx = position === 'after' ? targetIndex + 1 : targetIndex;
                        destCat.items.splice(insertIdx, 0, itemToInsert);
                    }
                }

                saveCategories(newCats);
                return newCats;
            });

            showFeedback(`"${item.text}" reordenado exitosamente.`);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    return (
        <div className="min-h-[calc(100vh-80px)] bg-[#f3f3f3] px-6 pt-4 pb-12 lg:px-10 lg:pt-5 lg:pb-12 text-[#1f1f1f] font-['Segoe_UI',Tahoma,sans-serif]">
            <div className="max-w-7xl mx-auto">

                {/* Feedback Toast */}
                {feedbackMessage && (
                    <div className="mb-4 px-3.5 py-2 bg-white border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded shadow-sm transition-all flex items-center justify-between">
                        <span className="leading-snug">{feedbackMessage}</span>
                        <button
                            onClick={() => setFeedbackMessage(null)}
                            className="w-5 h-5 flex items-center justify-center text-[#5f5f5f] hover:text-[#1f1f1f] rounded hover:bg-[#f0f0f0] font-normal text-[11px] ml-4 transition-colors cursor-pointer"
                            title="Cerrar"
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* Grid de Categorías con opciones autorizadas */}
                {visibleCategories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 bg-white border border-[#d2d0ce] rounded text-center max-w-lg mx-auto my-8 shadow-xs">
                        <div className="w-10 h-10 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#605e5c] mb-3">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                            </svg>
                        </div>
                        <h3 className="text-[14px] font-normal text-[#1f1f1f] mb-1">Sin módulos autorizados</h3>
                        <p className="text-[12px] font-normal text-[#605e5c]">
                            Tu usuario no tiene módulos asignados en este momento. Solicita a un administrador que habilite tus permisos para ver las opciones disponibles en el Dashboard.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {visibleCategories.map((category) => {
                            const isCatTarget = dropTarget?.catId === category.id;
                            const config = CATEGORIES_CONFIG.find(c => c.id === category.id) || CATEGORIES_CONFIG[0];

                            return (
                                <div
                                    key={category.id}
                                    data-dashboard-category="true"
                                    data-cat-id={category.id}
                                    className={`flex flex-col p-2.5 rounded-lg transition-all duration-150 border ${
                                        isCatTarget && dropTarget?.position === 'end'
                                            ? `border-dashed border-[#0067c0] ${config.dropBg} shadow-sm`
                                            : 'border-transparent bg-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 mb-3 px-0.5 select-none pointer-events-none">
                                        <div className={`h-3.5 w-1 ${category.accent || config.accent} rounded-full`}></div>
                                        <h2 className="text-[12px] font-normal text-[#1f1f1f] uppercase tracking-normal">{t(category.title)}</h2>
                                    </div>

                                    <div className="space-y-2 min-h-[140px] flex flex-col">
                                        {category.items.length === 0 ? (
                                            <div className="flex-1 flex flex-col items-center justify-center p-6 border border-dashed border-[#d1d5db] rounded text-center bg-white/60 pointer-events-none">
                                                <p className="text-[11px] text-[#7f7f7f] font-normal">{t('dashboard.drag_hint', 'Arrastra opciones aquí para fijarlas')}</p>
                                            </div>
                                        ) : (
                                            category.items.map((item) => {
                                                const isBeingDragged = dragging?.fromCatId === category.id && dragging?.item?.href === item.href;
                                                const isTarget = dropTarget?.catId === category.id && dropTarget?.targetHref === item.href;
                                                const isDropBefore = isTarget && dropTarget?.position === 'before';
                                                const isDropAfter = isTarget && dropTarget?.position === 'after';

                                                return (
                                                    <React.Fragment key={item.href}>
                                                        {isDropBefore && (
                                                            <div className="h-1 bg-[#0067c0] rounded-full my-0.5 shadow-xs pointer-events-none transition-all" />
                                                        )}

                                                        <div
                                                            data-dashboard-card="true"
                                                            data-cat-id={category.id}
                                                            data-card-href={item.href}
                                                            onPointerDown={(e) => handlePointerDown(e, item, category.id)}
                                                            onClick={() => handleCardClick(item)}
                                                            className={`group relative flex items-center justify-between gap-2.5 rounded p-2.5 transition-all duration-150 select-none ${
                                                                isBeingDragged
                                                                    ? 'opacity-25 scale-[0.98] border-dashed border-[#0067c0] bg-white cursor-grabbing'
                                                                    : 'bg-white border border-[#e5e5e5] hover:border-[#0067c0] hover:shadow-xs cursor-pointer'
                                                            }`}
                                                        >
                                                            {/* Text content */}
                                                            <div className="flex-1 min-w-0 pointer-events-none">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[12px] font-normal tracking-normal leading-snug truncate text-[#1f1f1f] group-hover:text-[#0067c0]">
                                                                        {t(item.text)}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[11px] text-[#7f7f7f] font-normal mt-0.5 tracking-normal leading-normal truncate">
                                                                    {t(item.desc)}
                                                                </div>
                                                            </div>

                                                            {/* Acción de retirar del Dashboard */}
                                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => unpinItem(e, item.href)}
                                                                    className="w-5 h-5 flex items-center justify-center text-[#999] hover:text-[#d13438] hover:bg-[#fde7e9] rounded text-[10px] font-normal transition-colors cursor-pointer"
                                                                    title="Retirar del Dashboard"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {isDropAfter && (
                                                            <div className="h-1 bg-[#0067c0] rounded-full my-0.5 shadow-xs pointer-events-none transition-all" />
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Footer Action Bar */}
                <div className="mt-10 pt-4 border-t border-[#e5e7eb] flex flex-col sm:flex-row justify-between items-center gap-3">
                    <span className="text-[12px] text-[#6b7280] font-normal">
                        Arrastra las opciones para organizarlas libremente
                    </span>
                    <button
                        type="button"
                        onClick={resetToDefault}
                        className="h-8 px-4 bg-white hover:bg-[#f5f5f5] active:bg-[#ebebeb] border border-[#d1d5db] text-[#1f1f1f] text-[12px] font-normal rounded shadow-xs transition-colors cursor-pointer flex items-center gap-2"
                        title="Restablecer el orden y opciones por defecto del Dashboard"
                    >
                        <span>Restablecer Orden</span>
                    </button>
                </div>
            </div>

            {/* Ghost preview flotante que sigue al cursor al arrastrar */}
            {dragging && (
                <div
                    style={{
                        position: 'fixed',
                        left: `${dragging.x + 12}px`,
                        top: `${dragging.y + 12}px`,
                        pointerEvents: 'none',
                        zIndex: 9999
                    }}
                    className="bg-white border border-[#0067c0] rounded p-2.5 shadow-lg w-52 opacity-90 transition-none"
                >
                    <div className="text-[11px] text-[#0067c0] font-normal truncate">
                        {t(dragging.item?.text)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
