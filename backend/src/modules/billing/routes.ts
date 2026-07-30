import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { billingCycles, stores } from '../../config/schema'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../../utils/auth'

export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // A lojista's own storeId is resolved server-side from their tenant; the URL
  // value is ignored for that role so one lojista can't read another store's
  // billing history by swapping the id in the path.
  app.get('/:storeId', async (request, reply) => {
    const user = request.user as { role: string; tenantId: string }
    const { storeId: paramStoreId } = request.params as { storeId: string }

    let storeId = paramStoreId
    if (user.role === 'lojista') {
      const [store] = await db.select().from(stores).where(eq(stores.tenantId, user.tenantId)).limit(1)
      if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
      storeId = store.id
    }

    return db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.storeId, storeId))
      .orderBy(desc(billingCycles.ano), desc(billingCycles.mes))
  })
}
