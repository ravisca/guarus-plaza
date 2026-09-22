import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Compara segredo em tempo constante.
 *
 * `recebida !== esperada` termina no primeiro byte diferente, e o tempo dessa
 * comparação vaza quantos caracteres iniciais estão certos. Com muitas
 * tentativas dá para reconstruir a chave byte a byte.
 *
 * O SHA-256 antes do `timingSafeEqual` existe porque essa função exige buffers
 * do mesmo tamanho e lança exceção quando não são — o digest normaliza o
 * comprimento sem revelar nada sobre o original.
 */
export function segredoConfere(recebido: unknown, esperado: string): boolean {
  if (typeof recebido !== 'string' || esperado.length === 0) return false

  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(esperado).digest()

  return timingSafeEqual(a, b)
}
