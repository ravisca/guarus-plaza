import { sql } from 'drizzle-orm'
import { db } from '../config/database.js'

/**
 * Marca como `offline` o medidor que parou de comunicar.
 *
 * Antes disto, `status` só era escrito com o valor `'online'` — em dois lugares,
 * na ingestão. **Nada no projeto gravava `'offline'`.** O painel mostrava
 * "41 de 41 online" com sete medidores fisicamente sem coleta, e o contador de
 * offline do dashboard era permanentemente zero.
 *
 * Para um sistema que fatura, isso é o pior tipo de cegueira: a lacuna de coleta
 * só aparecia no fechamento do mês, quando já não há como recuperar o dado. O
 * ciclo trava em `requer_revisao` e alguém precisa explicar ao lojista por que a
 * fatura dele não saiu.
 *
 * O caminho de volta é automático: qualquer leitura gravada devolve o medidor
 * para `'online'` (ver `modules/agentSync`).
 */

/** Sem leitura por mais que isto, o medidor é considerado sem comunicação. */
export const MINUTOS_ATE_OFFLINE = Number(process.env.MEDIDOR_OFFLINE_MIN || 10)

export async function atualizarStatusDosMedidores(): Promise<{ marcados: number }> {
  const linhas = await db.execute<{ numero_serie: string }>(sql`
    UPDATE meters
       SET status = 'offline'
     WHERE status <> 'offline'
       AND (
         last_seen IS NULL
         OR last_seen < now() - make_interval(mins => ${MINUTOS_ATE_OFFLINE}::int)
       )
    RETURNING numero_serie
  `)

  if (linhas.length > 0) {
    const nomes = linhas.map((l) => l.numero_serie).join(', ')
    console.warn(
      `[MEDIDORES] ${linhas.length} sem comunicação há mais de ${MINUTOS_ATE_OFFLINE} min: ${nomes}`,
    )
  }

  return { marcados: linhas.length }
}
