import { AlertTriangle, CheckCircle, Info, Loader2, RefreshCw } from 'lucide-react'

/**
 * Estados de erro, aviso e carregamento — reaproveitados por todas as telas.
 *
 * Antes não havia nenhum: os formulários faziam `POST` sem `catch` e as
 * listagens sem `.catch()`. Quando a API falhava, o formulário fechava como se
 * tivesse funcionado e a listagem ficava em branco com o spinner parado. O
 * operador não tinha como distinguir "não funcionou" de "não fiz direito".
 */

export function Erro({ mensagem, aoTentarDeNovo }: { mensagem: string; aoTentarDeNovo?: () => void }) {
  if (!mensagem) return null
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <p className="text-red-700 text-sm font-medium flex-1">{mensagem}</p>
      {aoTentarDeNovo && (
        <button
          onClick={aoTentarDeNovo}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-900 shrink-0"
        >
          <RefreshCw className="w-4 h-4" />
          Tentar de novo
        </button>
      )}
    </div>
  )
}

export function Sucesso({ mensagem }: { mensagem: string }) {
  if (!mensagem) return null
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
      <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
      <p className="text-green-800 text-sm font-medium">{mensagem}</p>
    </div>
  )
}

export function Aviso({ titulo, mensagem }: { titulo: string; mensagem?: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
      <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-amber-900 text-sm font-semibold">{titulo}</p>
        {mensagem && <p className="text-amber-700 text-sm mt-0.5">{mensagem}</p>}
      </div>
    </div>
  )
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm font-medium">{texto}</span>
    </div>
  )
}

export function Vazio({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <div className="text-center py-16">
      <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Info className="w-8 h-8 text-gray-400" />
      </div>
      <p className="text-gray-600 font-medium">{titulo}</p>
      {descricao && <p className="text-sm text-gray-400 mt-1">{descricao}</p>}
    </div>
  )
}

/**
 * Credencial mostrada uma única vez.
 *
 * Senha provisória não fica guardada em lugar nenhum em texto: quem cadastrou
 * precisa copiá-la agora e entregá-la ao lojista por fora.
 */
export function SenhaUnica({ email, senha, exigirTroca = true, aoFechar }: {
  email: string
  senha: string
  exigirTroca?: boolean
  aoFechar?: () => void
}) {
  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-amber-900 font-semibold text-sm">
            Anote agora — esta senha não será exibida novamente
          </p>
          <div className="mt-3 bg-white rounded-xl border border-amber-200 p-3 font-mono text-sm">
            <div className="text-gray-500 text-xs mb-1">usuário</div>
            <div className="text-gray-900 mb-2">{email}</div>
            <div className="text-gray-500 text-xs mb-1">{exigirTroca ? 'senha provisória' : 'senha'}</div>
            <div className="text-gray-900 select-all">{senha}</div>
          </div>
          <p className="text-amber-700 text-xs mt-2">
            {exigirTroca
              ? 'O usuário será obrigado a trocá-la no primeiro acesso.'
              : 'Troca no primeiro acesso não exigida — o usuário pode mantê-la.'}
          </p>
        </div>
        {aoFechar && (
          <button onClick={aoFechar} className="text-amber-700 hover:text-amber-900 text-xs font-medium shrink-0">
            Já anotei
          </button>
        )}
      </div>
    </div>
  )
}
