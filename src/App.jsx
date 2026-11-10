import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';

// Importación estática de páginas para soporte offline total (Desktop & Mobile)
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Reconciliation from './pages/Reconciliation';
import StockSearch from './pages/StockSearch';
import PickingAuditHistory from './pages/PickingAuditHistory';
import Inbound from './pages/Inbound';
import CycleCounts from './pages/CycleCounts';
import ExpressAudit from './pages/ExpressAudit';
import SpotCheck from './pages/SpotCheck';
import LabelPrinting from './pages/LabelPrinting';
import Planner from './pages/Planner';
import PlannerExecution from './pages/PlannerExecution';
import PickingAudit from './pages/PickingAudit';
import AdminLogin from './pages/AdminLogin';
import AdminUsers from './pages/AdminUsers';
import AdminInventory from './pages/AdminInventory';
import SlottingConfig from './pages/SlottingConfig';
import ManageCounts from './pages/ManageCounts';
import ViewCounts from './pages/ViewCounts';
import EditCount from './pages/EditCount';
import InboundHistory from './pages/InboundHistory';
import Update from './pages/Update';
import Register from './pages/Register';
import SetPassword from './pages/SetPassword';
import PackingListPrint from './pages/PackingListPrint';
import CycleCountHistory from './pages/CycleCountHistory';
import DashboardInventario from './pages/DashboardInventario';
import OccupancyDashboard from './pages/OccupancyDashboard';
import ManageCountDifferences from './pages/ManageCountDifferences';
import ManageCycleCountDifferences from './pages/ManageCycleCountDifferences';
import Shipments from './pages/Shipments';
import ConsolidatedPackingList from './pages/ConsolidatedPackingList';
import ErrorPage from './pages/Error';

import { hasUserPermission, isUserAdmin } from './utils/permissions';

// Componente de carga (para procesos internos)
const LoadingFallback = () => (
    <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '1.2rem',
        color: '#0070f3'
    }}>
        Cargando...
    </div>
);

// Protected Route Component
const ProtectedRoute = ({ children, requiredPermission }) => {
    const userJson = localStorage.getItem('user');
    if (!userJson) return <Navigate to="/login" replace />;

    try {
        const user = JSON.parse(userJson);
        const isAdmin = isUserAdmin(user);

        // Si la cuenta no está aprobada, forzar regreso al login
        if (!isAdmin && user.is_approved === false) {
            localStorage.removeItem('user');
            return <Navigate to="/login" replace />;
        }

        // Verificación de permisos de módulos
        if (requiredPermission && !hasUserPermission(user, requiredPermission)) {
            return <Navigate to="/dashboard" replace />;
        }
    } catch (e) {
        console.error("Error parsing user data", e);
        return <Navigate to="/login" replace />;
    }

    return children;
};

// Admin Protected Route Component
const AdminProtectedRoute = ({ children }) => {
    const userJson = localStorage.getItem('user');
    if (!userJson) return <Navigate to="/admin/login" replace />;

    try {
        const user = JSON.parse(userJson);
        if (!isUserAdmin(user)) {
            return <Navigate to="/admin/login" replace />;
        }
    } catch (e) {
        return <Navigate to="/admin/login" replace />;
    }

    return children;
};

import ReloadPrompt from './components/ReloadPrompt';

function App() {
    return (
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ReloadPrompt />
            <Routes>
                {/* Redirigir raíz a login */}
                    <Route path="/" element={<Navigate to="/login" replace />} />

                    {/* Rutas públicas */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/set_password" element={<SetPassword />} />

                    {/* Protected Routes wrapped in Layout */}
                    <Route element={
                        <ProtectedRoute>
                            <Layout />
                        </ProtectedRoute>
                    }>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/inbound" element={
                            <ProtectedRoute requiredPermission="inbound">
                                <Inbound />
                            </ProtectedRoute>
                        } />
                        <Route path="/label" element={
                            <ProtectedRoute requiredPermission="label">
                                <LabelPrinting />
                            </ProtectedRoute>
                        } />
                        <Route path="/stock" element={
                            <ProtectedRoute requiredPermission="stock">
                                <StockSearch />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_picking_audits" element={
                            <ProtectedRoute requiredPermission="view_picking_audits">
                                <PickingAuditHistory />
                            </ProtectedRoute>
                        } />

                        <Route path="/reconciliation" element={
                            <ProtectedRoute requiredPermission="reconciliation">
                                <Reconciliation />
                            </ProtectedRoute>
                        } />
                        <Route path="/update" element={
                            <ProtectedRoute requiredPermission="update">
                                <Update />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts" element={
                            <ProtectedRoute requiredPermission="counts">
                                <CycleCounts />
                            </ProtectedRoute>
                        } />
                        <Route path="/express-audit" element={
                            <ProtectedRoute requiredPermission="express_audit">
                                <ExpressAudit />
                            </ProtectedRoute>
                        } />
                        <Route path="/spot-check" element={
                            <ProtectedRoute requiredPermission="spot_check">
                                <SpotCheck />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts/manage" element={
                            <ProtectedRoute requiredPermission="counts_manage">
                                <ManageCounts />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_counts" element={
                            <ProtectedRoute requiredPermission="view_counts">
                                <ViewCounts />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts/manage_differences" element={
                            <ProtectedRoute requiredPermission="counts_manage">
                                <ManageCountDifferences />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts/edit/:id" element={
                            <ProtectedRoute requiredPermission="counts_manage">
                                <EditCount />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_counts/recordings" element={
                            <ProtectedRoute requiredPermission="view_counts_recordings">
                                <CycleCountHistory />
                            </ProtectedRoute>
                        } />
                        <Route path="/inventory-dashboard" element={
                            <ProtectedRoute requiredPermission="inventory_dashboard">
                                <DashboardInventario />
                            </ProtectedRoute>
                        } />
                        <Route path="/occupancy" element={
                            <ProtectedRoute requiredPermission="occupancy">
                                <OccupancyDashboard />
                            </ProtectedRoute>
                        } />
                        <Route path="/planner" element={
                            <ProtectedRoute requiredPermission="planner">
                                <Planner />
                            </ProtectedRoute>
                        } />
                        <Route path="/planner/execution" element={
                            <ProtectedRoute requiredPermission="planner">
                                <PlannerExecution />
                            </ProtectedRoute>
                        } />
                        <Route path="/planner/manage_differences" element={
                            <ProtectedRoute requiredPermission="planner_differences">
                                <ManageCycleCountDifferences />
                            </ProtectedRoute>
                        } />
                        <Route path="/picking" element={
                            <ProtectedRoute requiredPermission="picking">
                                <PickingAudit />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_logs" element={
                            <ProtectedRoute requiredPermission="view_logs">
                                <InboundHistory />
                            </ProtectedRoute>
                        } />


                        {/* Admin Routes */}
                        <Route path="/admin/login" element={<AdminLogin />} />
                        <Route path="/admin/users" element={
                            <AdminProtectedRoute>
                                <AdminUsers />
                            </AdminProtectedRoute>
                        } />
                        <Route path="/admin/inventory" element={
                            <ProtectedRoute requiredPermission="admin_inventory">
                                <AdminInventory />
                            </ProtectedRoute>
                        } />
                        <Route path="/admin/inventory/report" element={
                            <Navigate to="/admin/inventory" replace />
                        } />
                        <Route path="/admin/slotting" element={
                            <ProtectedRoute requiredPermission="admin_slotting">
                                <SlottingConfig />
                            </ProtectedRoute>
                        } />
                        <Route path="/shipments" element={
                            <ProtectedRoute requiredPermission="shipments">
                                <Shipments />
                            </ProtectedRoute>
                        } />
                        <Route path="/shipments/print/:id" element={
                            <ProtectedRoute requiredPermission="shipments">
                                <ConsolidatedPackingList />
                            </ProtectedRoute>
                        } />
                        <Route path="/packing_list/print/:id" element={
                            <ProtectedRoute requiredPermission="view_picking_audits">
                                <PackingListPrint />
                            </ProtectedRoute>
                        } />
                        <Route path="/packing_list/:id" element={
                            <ProtectedRoute requiredPermission="view_picking_audits">
                                <PackingListPrint />
                            </ProtectedRoute>
                        } />
                        <Route path="/packing_list" element={
                            <ProtectedRoute requiredPermission="picking">
                                <PackingListPrint />
                            </ProtectedRoute>
                        } />
                    </Route>

                    {/* Standalone Protected Routes (No Layout) */}
                    <Route path="/standalone/shipments/print/:id" element={
                        <ProtectedRoute>
                            <ConsolidatedPackingList />
                        </ProtectedRoute>
                    } />
                    <Route path="/standalone/packing_list/print/:id" element={
                        <ProtectedRoute>
                            <PackingListPrint />
                        </ProtectedRoute>
                    } />

                    {/* Catch-all for 404 */}
                    <Route path="*" element={<ErrorPage />} />
                </Routes>
        </Router>
    );
}

export default App;
