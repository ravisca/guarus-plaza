import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import api, { mensagemDeErro } from '../services/api'
import { Erro } from '../components/Feedback'
import { KeyRound, ArrowRight, Loader2 } from 'lucide-react'

const MINIMO = 10

/**
 * Troca de senha pelo próprio usuário.
 *
 * Não existia rota nem tela para isso. A única forma de trocar uma senha era o
 * utilitário `set-password`, por variável de ambiente e redeploy — e foi por
 * isso que a senha do seed sobreviveu em produção.
 */
export default function TrocarSenha() {
  const [senhaAtual, setSenhaAtual] = useState('')
  const [senhaNova, setSenhaNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const { user, login } = useAuth()
  const navigate = useNavigate()

  const provisoria = user?.senhaProvisoria

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')

    if (senhaNova !== confirmacao) {
      setErro('A confirmação não confere com a senha nova.')
      return
    }
    if (senhaNova.length < MINIMO) {
      setErro(`A senha nova precisa ter no mínimo ${MINIMO} caracteres.`)
      return
    }

    setSalvando(true)
    try {
      const { data } = await api.post('/auth/trocar-senha', { senhaAtual, senhaNova })
      if (user) login(data.token, { ...user, senhaProvisoria: false })
      navigate(user?.role === 'admin' ? '/admin' : '/lojista')
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível trocar a senha.'))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-green-50 p-3 rounded-xl border border-green-100">
              <KeyRound className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {provisoria ? 'Defina sua senha' : 'Trocar senha'}
              </h1>
              <p className="text-sm text-gray-500">
                {provisoria
                  ? 'Sua senha atual foi criada por outra pessoa'
                  : 'Escolha uma senha nova para a sua conta'}
              </p>
            </div>
          </div>

          {provisoria && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
              <p className="text-amber-800 text-sm">
                Enquanto a senha for provisória, o sistema fica bloqueado. Quem cadastrou
                a sua conta conhece essa senha — trocá-la é o que torna o acesso seu.
              </p>
            </div>
          )}

          <Erro mensagem={erro} />

          <form onSubmit={submeter} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Senha atual</label>
              <input
                type="password"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Senha nova <span className="text-gray-400 font-normal">(mínimo {MINIMO} caracteres)</span>
              </label>
              <input
                type="password"
                value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Confirme a senha nova</label>
              <input
                type="password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={salvando}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm disabled:opacity-50"
            >
              {salvando ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
              ) : (
                <>Salvar senha <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
