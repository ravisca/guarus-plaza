import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { alerts, alertLogs, stores } from '../../config/schema.js'
import { and, eq, inArray, desc, sql } from 'drizzle-orm'
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

  /**
   * Alertas com o último disparo de cada um.
   *
   * Sem isto a tela só mostra a configuração, e o lojista não tem como saber se
   * o alerta chegou a disparar — o que, enquanto o aviso é visual e não por
   * e-mail, é a informação principal da tela.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string }
    const minhas = await idsDasMinhasLojas(user.id)
    if (minhas.length === 0) return []
    return db
      .select({
        id: alerts.id,
        storeId: alerts.storeId,
        tipo: alerts.tipo,
        limite: alerts.limite,
        canal: alerts.canal,
        ativo: alerts.ativo,
        createdAt: alerts.createdAt,
        // Subconsulta escrita com SQL literal, de propósito: dentro de um `sql`
        // de SELECT o drizzle renderiza a coluna SEM o nome da tabela, e
        // `WHERE "store_id" = "id"` passa a comparar duas colunas da tabela do
        // subselect — condição sempre falsa, contagem sempre zero, sem erro.
        ultimoDisparo: sql<string | null>`(
          SELECT max(l.enviado_em) FROM alert_logs l WHERE l.alert_id = alerts.id
        )`,
        ultimaMensagem: sql<string | null>`(
          SELECT l.mensagem FROM alert_logs l
          WHERE l.alert_id = alerts.id
          ORDER BY l.enviado_em DESC LIMIT 1
        )`,
        disparos: sql<number>`(
          SELECT count(*)::int FROM alert_logs l WHERE l.alert_id = alerts.id
        )`,
      })
      .from(alerts)
      .where(inArray(alerts.storeId, minhas))
      .orderBy(desc(alerts.createdAt))
  })

  /** Histórico de disparos das lojas do usuário — o "o que aconteceu" da tela. */
  app.get('/disparos', async (request) => {
    const user = request.user as { id: string }
    const minhas = await idsDasMinhasLojas(user.id)
    if (minhas.length === 0) return []
    return db
      .select({
        id: alertLogs.id,
        alertId: alertLogs.alertId,
        tipo: alerts.tipo,
        storeId: alerts.storeId,
        storeNome: stores.nome,
        mensagem: alertLogs.mensagem,
        canal: alertLogs.canal,
        em: alertLogs.enviadoEm,
      })
      .from(alertLogs)
      .innerJoin(alerts, eq(alertLogs.alertId, alerts.id))
      .leftJoin(stores, eq(alerts.storeId, stores.id))
      .where(inArray(alerts.storeId, minhas))
      .orderBy(desc(alertLogs.enviadoEm))
      .limit(50)
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
