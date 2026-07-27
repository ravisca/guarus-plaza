import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import DashboardAdmin from './pages/admin/DashboardAdmin'
import Stores from './pages/admin/Stores'
import Meters from './pages/admin/Meters'
import Billing from './pages/admin/Billing'
import DashboardLojista from './pages/lojista/DashboardLojista'
import Historico from './pages/lojista/Historico'
import Alertas from './pages/lojista/Alertas'

function ProtectedRoute({ children, role }: { children: React.ReactNode; role?: string }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" />
  if (role && user.role !== role) return <Navigate to="/" />
  return <>{children}</>
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        user?.role === 'admin' ? <Navigate to="/admin" /> : <Navigate to="/lojista" />
      } />

      <Route path="/admin" element={
        <ProtectedRoute role="admin"><DashboardAdmin /></ProtectedRoute>
      } />
      <Route path="/admin/lojas" element={
        <ProtectedRoute role="admin"><Stores /></ProtectedRoute>
      } />
      <Route path="/admin/medidores" element={
        <ProtectedRoute role="admin"><Meters /></ProtectedRoute>
      } />
      <Route path="/admin/faturamento" element={
        <ProtectedRoute role="admin"><Billing /></ProtectedRoute>
      } />

      <Route path="/lojista" element={
        <ProtectedRoute role="lojista"><DashboardLojista /></ProtectedRoute>
      } />
      <Route path="/lojista/historico" element={
        <ProtectedRoute role="lojista"><Historico /></ProtectedRoute>
      } />
      <Route path="/lojista/alertas" element={
        <ProtectedRoute role="lojista"><Alertas /></ProtectedRoute>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
