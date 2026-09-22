import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { meters } from '../../config/schema.js'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth.js'

/**
 * Inventário de medidores. **Somente admin.**
 *
 * Antes o hook era `authenticate`, sem nenhum filtro: qualquer lojista
 * autenticado listava os 41 medidores do shopping com IP, MAC, número de série e
 * firmware — o mapa completo da rede de medição nas mãos de qualquer credencial
 * de loja. As rotas equivalentes de `readings` e `billing` já haviam sido
 * corrigidas; esta ficou para trás.
 *
 * Não existe visão de medidor para o lojista: o painel dele mostra consumo, não
 * equipamento. Se um dia existir, o filtro é por `meters.storeId` dentro das
 * lojas do tenant — nunca a lista inteira.
 */
export async function meterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  app.get('/', async () => {
    return db.select().from(meters)
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [meter] = await db.select().from(meters).where(eq(meters.id, id)).limit(1)
    if (!meter) return reply.status(404).send({ error: 'Medidor não encontrado' })
    return meter
  })
}
