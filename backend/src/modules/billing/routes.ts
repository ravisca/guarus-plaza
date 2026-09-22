import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { billingCycles } from '../../config/schema.js'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../../utils/auth.js'
import { resolverLoja } from '../../utils/loja.js'

export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // O lojista só alcança loja do próprio inquilino — o id do path vinha direto
  // do cliente, sem checagem de propriedade. Ver utils/loja.ts.
  app.get('/:storeId', async (request, reply) => {
    const loja = await resolverLoja(request, reply)
    if (!loja) return

    return db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.storeId, loja.storeId))
      .orderBy(desc(billingCycles.ano), desc(billingCycles.mes))
  })

  /**
   * Demonstrativo de uma fatura — a segunda via que o lojista precisava pedir
   * ao condomínio por e-mail.
   *
   * Devolve a trilha de auditoria que o fechamento já gravava e que nenhuma tela
   * mostrava: leitura inicial, leitura final, número de amostras, maior lacuna
   * de coleta e anomalias descartadas. É o que permite conferir de onde saiu o
   * número, como se confere uma conta de luz.
   */
  app.get('/:storeId/ciclo/:cicloId', async (request, reply) => {
    const { cicloId } = request.params as { cicloId: string }

    const loja = await resolverLoja(request, reply)
    if (!loja) return

    const [ciclo] = await db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.id, cicloId))
      .limit(1)

    if (!ciclo || ciclo.storeId !== loja.storeId) {
      return reply.status(404).send({ error: 'Fatura não encontrada' })
    }

    // Dias do mês faturado, para a média diária. Vem do calendário, não do
    // número de amostras: amostras dependem de quantos medidores a loja tem.
    const diasNoMes = new Date(Date.UTC(ciclo.ano, ciclo.mes, 0)).getUTCDate()

    return {
      ...ciclo,
      // Derivados aqui para a tela não recalcular nada — foi recálculo em tela
      // que produziu o consumo negativo do painel do lojista.
      derivados: {
        diasNoMes,
        mediaDiariaKwh: Number(ciclo.kwhTotal) / diasNoMes,
        coletaCompleta: ciclo.lacunaMaiorMin <= 30,
      },
    }
  })
}
