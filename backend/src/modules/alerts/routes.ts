import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { alerts, stores } from '../../config/schema.js'
import { eq } from 'drizzle-orm'
import { authenticate } from '../../utils/auth.js'
import { createAlertSchema } from '../../utils/validators.js'

export async function alertRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const user = request.user as { tenantId: string }
    return db.select().from(alerts).where(eq(alerts.tenantId, user.tenantId))
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { tenantId: string; role: string }
    const body = createAlertSchema.parse(request.body)

    // The client-supplied storeId is untrustworthy for a lojista - the frontend
    // has been sending the logged-in user's own id (users has no FK to stores),
    // which corrupted alerts.storeId. Resolve it server-side from the tenant
    // instead of trusting the body for that role.
    let storeId: string | undefined = body.storeId
    if (user.role === 'lojista') {
      const [store] = await db.select().from(stores).where(eq(stores.tenantId, user.tenantId)).limit(1)
      storeId = store?.id
    }

    const [alert] = await db.insert(alerts).values({
      ...body,
      storeId,
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
