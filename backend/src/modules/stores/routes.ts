import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { stores } from '../../config/schema'
import { eq } from 'drizzle-orm'
import { authenticate } from '../../utils/auth'
import { createStoreSchema } from '../../utils/validators'

export async function storeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/:id/consumption', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1)
    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return { store, message: 'consumption endpoint' }
  })

  app.get('/:id/hourly-profile', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1)
    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return { store, message: 'hourly-profile endpoint' }
  })

  app.get('/:id/billing', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1)
    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return { store, message: 'billing endpoint' }
  })
}
