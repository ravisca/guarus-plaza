import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { meters } from '../../config/schema'
import { eq } from 'drizzle-orm'
import { authenticate } from '../../utils/auth'

export async function meterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

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
