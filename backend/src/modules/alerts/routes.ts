import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { alerts, stores } from '../../config/schema.js'
import { and, eq, inArray } from 'drizzle-orm'
import { authenticate } from '../../utils/auth.js'
import { createAlertSchema, atualizarAlertaSchema } from '../../utils/validators.js'
import { lojasDoUsuario } from '../../utils/loja.js'

/**
 * Alertas pertencem à loja, e o lojista alcança os das lojas vinculadas a ele.
 *
 * O filtro era por inquilino; com o acesso passando a ser por vínculo
 * usuário↔loja, filtrar por inquilino devolveria alertas de lojas que o usuário
 * não enxerga (ou nenhum, para lojista sem inquilino).
 */
export async function alertRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  async function idsDasMinhasLojas(userId: string): Promise<string[]> {
    return (await lojasDoUsuario(userId)).map((l) => l.id)
  }

  app.get('/', async (request) => {
    const user = request.user as { id: string }
    const minhas = await idsDasMinhasLojas(user.id)
    if (minhas.length === 0) return []
    return db.select().from(alerts).where(inArray(alerts.storeId, minhas))
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string }
    const parsed = createAlertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }
    const body = parsed.data

    // O `storeId` do corpo é do cliente. O frontend chegou a mandar o id do
    // USUÁRIO aqui, o que corrompeu `alerts.storeId` — e um alerta apontando
    // para uma loja que não existe nunca dispara. Só se aceita loja vinculada.
    const minhas = await idsDasMinhasLojas(user.id)
    if (minhas.length === 0) {
      return reply.status(400).send({ error: 'Nenhuma loja vinculada ao seu cadastro' })
    }
    if (!minhas.includes(body.storeId)) {
      return reply.status(403).send({ error: 'Loja não pertence ao seu cadastro' })
    }

    const [loja] = await db.select({ tenantId: stores.tenantId }).from(stores).where(eq(stores.id, body.storeId)).limit(1)

    const [alert] = await db.insert(alerts).values({
      ...body,
      tenantId: loja?.tenantId ?? null,
      limite: String(body.limite),
    }).returning()

    return reply.status(201).send(alert)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string }
    const { id } = request.params as { id: string }

    const parsed = atualizarAlertaSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }

    const minhas = await idsDasMinhasLojas(user.id)
    if (minhas.length === 0) return reply.status(404).send({ error: 'Alerta não encontrado' })

    // Mudar o alerta de loja também só vale para loja vinculada.
    if (parsed.data.storeId && !minhas.includes(parsed.data.storeId)) {
      return reply.status(403).send({ error: 'Loja não pertence ao seu cadastro' })
    }

    const updateData: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.limite !== undefined) updateData.limite = String(parsed.data.limite)

    // Sem o filtro por loja, qualquer autenticado alterava alerta alheio só
    // conhecendo o id.
    const [alert] = await db
      .update(alerts)
      .set(updateData)
      .where(and(eq(alerts.id, id), inArray(alerts.storeId, minhas)))
      .returning()

    if (!alert) return reply.status(404).send({ error: 'Alerta não encontrado' })
    return alert
  })

  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string }
    const { id } = request.params as { id: string }

    const minhas = await idsDasMinhasLojas(user.id)
    if (minhas.length === 0) return reply.status(404).send({ error: 'Alerta não encontrado' })

    const [alert] = await db
      .delete(alerts)
      .where(and(eq(alerts.id, id), inArray(alerts.storeId, minhas)))
      .returning()

    if (!alert) return reply.status(404).send({ error: 'Alerta não encontrado' })
    return { deleted: true }
  })
}
