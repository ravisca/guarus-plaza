import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Store, Cable, Receipt, LogOut, Zap, Menu, X, ChevronRight, Building2, DollarSign, KeyRound } from 'lucide-react'

const adminLinks = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/lojas', label: 'Lojas', icon: Store },
  { to: '/admin/inquilinos', label: 'Lojistas e acessos', icon: Building2 },
  { to: '/admin/medidores', label: 'Medidores', icon: Cable },
  { to: '/admin/tarifas', label: 'Tarifas', icon: DollarSign },
  { to: '/admin/faturamento', label: 'Faturamento', icon: Receipt },
]

const lojistaLinks = [
  { to: '/lojista', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/lojista/historico', label: 'Histórico', icon: Receipt },
  { to: '/lojista/alertas', label: 'Alertas', icon: Zap },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const links = user?.role === 'admin' ? adminLinks : lojistaLinks

  const content = (
    <div className="flex flex-col h-full">
      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="bg-green-100 p-2.5 rounded-xl border border-green-200">
            <Zap className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-sm tracking-tight">Guarus Plaza</h2>
            <p className="text-xs text-gray-500 font-medium">
              {user?.role === 'admin' ? 'Administrador' : 'Lojista'}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5">
        <div className="h-px bg-gray-100" />
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {links.map((link) => {
          const Icon = link.icon
          const active = location.pathname === link.to
          return (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                active
                  ? 'bg-green-50 text-green-700 border border-green-200/50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Icon className={`w-5 h-5 transition-colors ${active ? 'text-green-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
              <span className="font-medium text-sm">{link.label}</span>
              {active && (
                <ChevronRight className="w-4 h-4 ml-auto text-green-400" />
              )}
            </Link>
          )
        })}
      </nav>

      <div className="px-5">
        <div className="h-px bg-gray-100" />
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3 mb-3 px-2">
          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
            <span className="text-sm font-semibold text-gray-600">
              {user?.email?.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.email}</p>
          </div>
        </div>
        <Link
          to="/trocar-senha"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors text-sm w-full px-2 py-2 rounded-lg hover:bg-gray-50"
        >
          <KeyRound className="w-4 h-4" />
          <span className="font-medium">Trocar senha</span>
        </Link>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-gray-500 hover:text-red-600 transition-colors text-sm w-full px-2 py-2 rounded-lg hover:bg-red-50"
        >
          <LogOut className="w-4 h-4" />
          <span className="font-medium">Sair</span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-white text-gray-700 p-2.5 rounded-xl shadow-lg border border-gray-100"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`lg:hidden fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {content}
      </aside>

      <aside className="hidden lg:flex bg-white border-r border-gray-100 w-64 min-h-screen flex-col flex-shrink-0">
        {content}
      </aside>
    </>
  )
}
