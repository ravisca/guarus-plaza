/**
 * Freio de tentativas de login.
 *
 * O `rate-limit` global do Fastify é de 100 requisições por minuto por IP, e o
 * login herdava esse número: 100 tentativas de senha por minuto, 144 mil por
 * dia, contra uma conta `admin` que fecha faturamento. Isso torna força bruta
 * viável — ainda mais com senhas curtas.
 *
 * O bloqueio é por IP **e** por e-mail, porque só por IP não segura ataque
 * distribuído contra uma conta conhecida, e só por e-mail não segura varredura
 * de contas a partir de uma origem.
 *
 * O estado vive em memória, de propósito: é uma única instância da API, e
 * perder o contador num restart é aceitável para o que isto protege. Se um dia
 * a API rodar replicada, isto precisa ir para o Postgres ou um Redis — está
 * anotado no MELHORIAS.md.
 */

interface Registro {
  falhas: number
  bloqueadoAte: number
  visto: number
}

const registros = new Map<string, Registro>()

/**
 * Quanto mais insiste, mais espera. O primeiro degrau é curto para não punir
 * quem simplesmente errou a senha; os seguintes tornam a varredura inviável.
 */
const DEGRAUS = [
  { falhas: 15, bloqueioMs: 30 * 60_000 },
  { falhas: 10, bloqueioMs: 5 * 60_000 },
  { falhas: 5, bloqueioMs: 60_000 },
]

/** Registro parado por mais que isto é descartado. */
const VALIDADE_MS = 60 * 60_000

export function chavesDeLogin(ip: string, email: string): string[] {
  return [`ip:${ip}`, `email:${email.trim().toLowerCase()}`]
}

/** Milissegundos que ainda faltam para liberar. Zero significa liberado. */
export function bloqueioRestanteMs(chaves: string[]): number {
  const agora = Date.now()
  let maior = 0
  for (const chave of chaves) {
    const r = registros.get(chave)
    if (r && r.bloqueadoAte > agora) {
      maior = Math.max(maior, r.bloqueadoAte - agora)
    }
  }
  return maior
}

export function registrarFalha(chaves: string[]): void {
  const agora = Date.now()
  for (const chave of chaves) {
    const r = registros.get(chave) ?? { falhas: 0, bloqueadoAte: 0, visto: agora }
    r.falhas++
    r.visto = agora

    const degrau = DEGRAUS.find((d) => r.falhas >= d.falhas)
    if (degrau) r.bloqueadoAte = agora + degrau.bloqueioMs

    registros.set(chave, r)
  }
}

/** Login bem-sucedido zera o histórico daquele IP e daquele e-mail. */
export function registrarSucesso(chaves: string[]): void {
  for (const chave of chaves) registros.delete(chave)
}

export function limparExpirados(): number {
  const agora = Date.now()
  let removidos = 0
  for (const [chave, r] of registros) {
    if (r.bloqueadoAte <= agora && agora - r.visto > VALIDADE_MS) {
      registros.delete(chave)
      removidos++
    }
  }
  return removidos
}

// A limpeza não pode segurar o processo aberto no encerramento.
const limpeza = setInterval(limparExpirados, 10 * 60_000)
limpeza.unref()

/** Só para teste. */
export function _zerar(): void {
  registros.clear()
}
