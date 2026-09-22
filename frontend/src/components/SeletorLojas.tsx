import { useMemo, useState } from 'react'
import { Search, Check, Cable, X } from 'lucide-react'

/**
 * Seletor de lojas para o vínculo do lojista.
 *
 * Busca por nome, número da loja ou número de série do relógio — o shopping
 * conhece o ponto de medição pelo relógio tanto quanto pela loja. Mostra quem já
 * tem acesso a cada loja, para o administrador não entregar a mesma loja a duas
 * empresas sem perceber.
 */

export interface LojaVinculavel {
  id: string
  nome: string
  numeroLoja: string
  medidores: { id: string; numeroSerie: string; status: string }[]
  usuarios: { nome: string; email: string }[]
}

interface Props {
  lojas: LojaVinculavel[]
  selecionadas: string[]
  aoMudar: (ids: string[]) => void
  /** E-mail do usuário sendo editado, para não listá-lo como "outro" com acesso. */
  emailDoUsuario?: string
}

export default function SeletorLojas({ lojas, selecionadas, aoMudar, emailDoUsuario }: Props) {
  const [busca, setBusca] = useState('')
  const [soMarcadas, setSoMarcadas] = useState(false)

  const marcadas = new Set(selecionadas)

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return lojas.filter((l) => {
      if (soMarcadas && !marcadas.has(l.id)) return false
      if (!termo) return true
      return (
        l.nome.toLowerCase().includes(termo) ||
        l.numeroLoja.toLowerCase().includes(termo) ||
        l.medidores.some((m) => m.numeroSerie.toLowerCase().includes(termo))
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojas, busca, soMarcadas, selecionadas])

  const alternar = (id: string) => {
    aoMudar(marcadas.has(id) ? selecionadas.filter((s) => s !== id) : [...selecionadas, id])
  }

  const escolhidas = lojas.filter((l) => marcadas.has(l.id))

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="p-3 border-b border-gray-100 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar loja, número ou relógio..."
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 select-none">
            <input type="checkbox" checked={soMarcadas} onChange={(e) => setSoMarcadas(e.target.checked)} className="accent-green-600" />
            só as marcadas
          </label>
        </div>

        {escolhidas.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {escolhidas.map((l) => (
              <button
                type="button"
                key={l.id}
                onClick={() => alternar(l.id)}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs font-medium rounded-full bg-green-50 text-green-800 border border-green-200 hover:bg-green-100"
              >
                {l.nome}
                <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-700">Nenhuma loja marcada — o lojista entra e não vê consumo algum.</p>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
        {visiveis.length === 0 && <p className="text-sm text-gray-500 text-center py-8">Nenhuma loja encontrada</p>}
        {visiveis.map((l) => {
          const marcada = marcadas.has(l.id)
          const outros = l.usuarios.filter((u) => u.email !== emailDoUsuario)
          return (
            <button
              type="button"
              key={l.id}
              onClick={() => alternar(l.id)}
              className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${marcada ? 'bg-green-50/60' : 'hover:bg-gray-50'}`}
            >
              <span
                className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${marcada ? 'bg-green-600 border-green-600' : 'border-gray-300 bg-white'}`}
              >
                {marcada && <Check className="w-3 h-3 text-white" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{l.nome}</span>
                  <span className="text-xs text-gray-400 shrink-0">nº {l.numeroLoja}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                  {l.medidores.length === 0 ? (
                    <span className="text-amber-600">sem relógio vinculado</span>
                  ) : (
                    l.medidores.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1">
                        <Cable className="w-3 h-3" />
                        {m.numeroSerie}
                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'online' ? 'bg-green-500' : 'bg-red-400'}`} />
                      </span>
                    ))
                  )}
                  {outros.length > 0 && (
                    <span className="text-gray-400">· acesso: {outros.map((u) => u.nome).join(', ')}</span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
