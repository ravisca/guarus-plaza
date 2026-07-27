import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { alerts } from '../../config/schema'
import { eq } from 'drizzle-orm'
import { authenticate } from '../../utils/auth'
import { createAlertSchema } from '../../utils/validators'

export async function alertRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const user = request.user as { tenantId: string }
    return db.select().from(alerts).where(eq(alerts.tenantId, user.tenantId))
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { tenantId: string }
    const body = createAlertSchema.parse(request.body)
    const [alert] = await db.insert(alerts).values({
      ...body,
      tenantId: user.tenantId,
      limite: String(body.limite),
    }).returning()
    return reply.status(201).send(alert)
  })

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createAlertSchema.partial().parse(request.body)
    const updateData: Record<string, any> = { ...body }
    if (body.limite !== undefined) {
      updateData.limite = String(body.limite)
    }
    const [alert] = await db.update(alerts).set(updateData).where(eq(alerts.id, id)).returning()
    if (!alert) return reply.status(404).send({ error: 'Alerta não encontrado' })
    return alert
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [alert] = await db.delete(alerts).where(eq(alerts.id, id)).returning()
    if (!alert) return reply.status(404).send({ error: 'Alerta não encontrado' })
    return { deleted: true }
  })
}
