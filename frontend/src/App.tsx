import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import TrocarSenha from './pages/TrocarSenha'
import DashboardAdmin from './pages/admin/DashboardAdmin'
import Stores from './pages/admin/Stores'
import Meters from './pages/admin/Meters'
import Billing from './pages/admin/Billing'
import Inquilinos from './pages/admin/Inquilinos'
import Tarifas from './pages/admin/Tarifas'
import DashboardLojista from './pages/lojista/DashboardLojista'
import Historico from './pages/lojista/Historico'
import Alertas from './pages/lojista/Alertas'
import { Carregando } from './components/Feedback'

function ProtectedRoute({ children, role }: { children: React.ReactNode; role?: string }) {
  const { user, carregando } = useAuth()
  const location = useLocation()

  // Sem esperar o /auth/me, um F5 numa rota interna jogava para o login mesmo
  // com sessão válida.
  if (carregando) return <Carregando texto="Verificando sessão..." />
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />

  // Enquanto a senha for provisória, o servidor recusa tudo. Levar direto à
  // troca evita uma sequência de telas vazias sem explicação.
  if (user.senhaProvisoria) return <Navigate to="/trocar-senha" replace />

  if (role && user.role !== role) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user, carregando } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/trocar-senha"
        element={user ? <TrocarSenha /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/"
        element={
          carregando ? <Carregando texto="Verificando sessão..." />
            : !user ? <Navigate to="/login" replace />
            : user.role === 'admin' ? <Navigate to="/admin" replace />
            : <Navigate to="/lojista" replace />
        }
      />

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
      <Route path="/admin/inquilinos" element={
        <ProtectedRoute role="admin"><Inquilinos /></ProtectedRoute>
      } />
      <Route path="/admin/tarifas" element={
        <ProtectedRoute role="admin"><Tarifas /></ProtectedRoute>
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

      <Route path="*" element={<Navigate to="/" replace />} />
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
