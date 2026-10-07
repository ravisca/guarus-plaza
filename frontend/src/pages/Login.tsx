import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import api from '../services/api'
import { Zap, ArrowRight, Loader2 } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data } = await api.post('/auth/login', { email, senha })
      login(data.token, data.user)
      navigate(data.user.role === 'admin' ? '/admin' : '/lojista')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel - Brand */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-600/20 via-transparent to-green-500/10" />
        
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

        <div className="relative z-10 flex flex-col justify-center px-16 lg:px-20">
          <div className="flex items-center gap-4 mb-12">
            <div className="bg-green-500/20 p-4 rounded-2xl border border-green-500/30">
              <Zap className="w-10 h-10 text-green-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Guarus Plaza</h1>
              <p className="text-gray-400 text-sm font-medium">Sistema de Gestão de Energia</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="bg-green-500/10 p-2 rounded-lg mt-0.5">
                <div className="w-2 h-2 bg-green-400 rounded-full" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Monitoramento em Tempo Real</h3>
                <p className="text-gray-400 text-sm leading-relaxed">Acompanhe o consumo de cada loja instantaneamente</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="bg-green-500/10 p-2 rounded-lg mt-0.5">
                <div className="w-2 h-2 bg-green-400 rounded-full" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Faturamento Automatizado</h3>
                <p className="text-gray-400 text-sm leading-relaxed">Cálculo preciso por loja com base nos medidores</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="bg-green-500/10 p-2 rounded-lg mt-0.5">
                <div className="w-2 h-2 bg-green-400 rounded-full" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Alertas Inteligentes</h3>
                <p className="text-gray-400 text-sm leading-relaxed">Notificações por consumo anômalo e falhas</p>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 right-0 w-96 h-96 bg-green-500/5 rounded-full blur-3xl" />
      </div>

      {/* Right panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="bg-green-100 p-3 rounded-xl">
              <Zap className="w-7 h-7 text-green-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Guarus Plaza</h1>
              <p className="text-gray-500 text-xs">Gestão de Energia</p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Bem-vindo de volta</h2>
            <p className="text-gray-500">Entre com suas credenciais para acessar o painel</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                placeholder="voce@exemplo.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm border border-red-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-all duration-150 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm">
            <a
              href="/ajuda/lojista.html#2-1-entrar-pela-primeira-vez"
              target="_blank"
              rel="noopener"
              className="text-gray-500 hover:text-gray-900 underline underline-offset-4"
            >
              Ajuda para entrar
            </a>
          </p>

          <p className="mt-8 text-center text-xs text-gray-400">
            Sistema de gestão de energia para Guarus Plaza
          </p>
        </div>
      </div>
    </div>
  )
}
