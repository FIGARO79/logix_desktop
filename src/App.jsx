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
import InboundAudit from './pages/InboundAudit';
import IRReconciliation from './pages/IRReconciliation';

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
    // Basic auth check
    const userJson = localStorage.getItem('user');
    const isAuthenticated = !!userJson;

    if (!isAuthenticated) return <Navigate to="/login" replace />;

    // Permission check
    if (requiredPermission) {
        try {
            const user = JSON.parse(userJson);
            // If admin, allow everything
            if (user.username === 'admin') return children;

            const perms = user.permissions ? user.permissions.split(',') : [];
            const hasPermission = Array.isArray(requiredPermission)
                ? requiredPermission.some(p => perms.includes(p))
                : perms.includes(requiredPermission);

            if (!hasPermission) {
                // Determine where to redirect if unauthorized
                return <Navigate to="/dashboard" replace />; // Or an Unauthorized page
            }
        } catch (e) {
            console.error("Error parsing user data", e);
            return <Navigate to="/login" replace />;
        }
    }

    return children;
};

// Admin Protected Route Component
const AdminProtectedRoute = ({ children }) => {
    const [isVerified, setIsVerified] = React.useState(null);

    React.useEffect(() => {
        fetch('/api/admin/verify', { credentials: 'include' })
            .then(res => {
                if (res.ok) setIsVerified(true);
                else setIsVerified(false);
            })
            .catch(() => setIsVerified(false));
    }, []);

    if (isVerified === null) return <LoadingFallback />;
    if (isVerified === false) return <Navigate to="/admin/login" replace />;
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
                        <Route path="/label" element={<LabelPrinting />} />
                        <Route path="/stock" element={
                            <ProtectedRoute requiredPermission={['stock', 'inbound']}>
                                <StockSearch />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_picking_audits" element={
                            <ProtectedRoute requiredPermission="picking">
                                <PickingAuditHistory />
                            </ProtectedRoute>
                        } />

                        <Route path="/reconciliation" element={
                            <ProtectedRoute requiredPermission="inbound">
                                <Reconciliation />
                            </ProtectedRoute>
                        } />
                        <Route path="/update" element={
                            <ProtectedRoute>
                                <Update />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <CycleCounts />
                            </ProtectedRoute>
                        } />
                        <Route path="/express-audit" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <ExpressAudit />
                            </ProtectedRoute>
                        } />
                        <Route path="/spot-check" element={
                            <ProtectedRoute requiredPermission={['inventory', 'stock']}>
                                <SpotCheck />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts/manage" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <ManageCounts />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_counts" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <ViewCounts />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts/manage_differences" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <ManageCountDifferences />
                            </ProtectedRoute>
                        } />
                        <Route path="/counts/edit/:id" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <EditCount />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_counts/recordings" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <CycleCountHistory />
                            </ProtectedRoute>
                        } />
                        <Route path="/inventory-dashboard" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <DashboardInventario />
                            </ProtectedRoute>
                        } />
                        <Route path="/occupancy" element={
                            <ProtectedRoute requiredPermission="inventory">
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
                            <ProtectedRoute requiredPermission="planner">
                                <ManageCycleCountDifferences />
                            </ProtectedRoute>
                        } />
                        <Route path="/picking" element={
                            <ProtectedRoute requiredPermission="picking">
                                <PickingAudit />
                            </ProtectedRoute>
                        } />
                        <Route path="/view_logs" element={
                            <ProtectedRoute requiredPermission="inbound">
                                <InboundHistory />
                            </ProtectedRoute>
                        } />
                        <Route path="/inbound/audit" element={
                            <ProtectedRoute requiredPermission="inbound">
                                <InboundAudit />
                            </ProtectedRoute>
                        } />
                        <Route path="/ir-reconciliation" element={
                            <ProtectedRoute requiredPermission="inbound">
                                <IRReconciliation />
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
                            <ProtectedRoute requiredPermission="inventory">
                                <AdminInventory />
                            </ProtectedRoute>
                        } />
                        <Route path="/admin/slotting" element={
                            <ProtectedRoute requiredPermission="inventory">
                                <SlottingConfig />
                            </ProtectedRoute>
                        } />
                        <Route path="/shipments" element={
                            <ProtectedRoute requiredPermission="picking">
                                <Shipments />
                            </ProtectedRoute>
                        } />
                        <Route path="/packing_list/print/:id" element={
                            <ProtectedRoute>
                                <PackingListPrint />
                            </ProtectedRoute>
                        } />
                    </Route>

                    {/* Standalone Protected Routes (No Layout) */}
                    <Route path="/shipments/print/:id" element={
                        <ProtectedRoute>
                            <ConsolidatedPackingList />
                        </ProtectedRoute>
                    } />

                    {/* Catch-all for 404 */}
                    <Route path="*" element={<ErrorPage />} />
                </Routes>
        </Router>
    );
}

export default App;
