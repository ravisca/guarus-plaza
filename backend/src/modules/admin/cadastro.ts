import { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { eq, sql, isNull, and, inArray } from 'drizzle-orm'
import { db } from '../../config/database.js'
import { tenants, stores, users, meters, userStores } from '../../config/schema.js'
import { requireAdmin } from '../../utils/auth.js'
import {
  createTenantSchema,
  createUserSchema,
  atualizarUsuarioSchema,
  vincularLojasSchema,
  redefinirSenhaSchema,
} from '../../utils/validators.js'

/**
 * Cadastro de inquilinos, usuários e acessos.
 *
 * O administrador do shopping cria o login do lojista (e-mail e senha) e diz
 * quais lojas ele enxerga. O acesso é por vínculo explícito em `user_stores`,
 * não mais pelo inquilino: com as 40 lojas de produção sob um único inquilino,
 * o vínculo por inquilino daria a qualquer lojista o shopping inteiro.
 *
 * Medidor não é vinculado direto ao usuário: o medidor pertence à loja, e é a
 * loja que entra na fatura. Vincular a loja dá acesso a todos os medidores dela.
 */

/** Senha inicial legível, para ser passada ao lojista uma única vez. */
function senhaGerada(): string {
  return randomBytes(12).toString('base64url')
}

/** Confere que todas as lojas existem e não foram removidas. Devolve as que faltam. */
async function lojasInexistentes(storeIds: string[]): Promise<string[]> {
  if (storeIds.length === 0) return []
  const achadas = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(inArray(stores.id, storeIds), isNull(stores.deletedAt)))
  const ok = new Set(achadas.map((s) => s.id))
  return storeIds.filter((id) => !ok.has(id))
}

export async function cadastroRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  const quem = (request: { user: unknown }) => (request.user as { email?: string })?.email ?? 'desconhecido'

  // ─── Inquilinos ────────────────────────────────────────────────────

  app.get('/tenants', async () => {
    return db
      .select({
        id: tenants.id,
        nome: tenants.nome,
        cnpj: tenants.cnpj,
        emailContato: tenants.emailContato,
        whatsapp: tenants.whatsapp,
        status: tenants.status,
        lojas: sql<number>`(
          SELECT count(*)::int FROM ${stores}
          WHERE ${stores.tenantId} = ${tenants.id} AND ${stores.deletedAt} IS NULL
        )`,
        usuarios: sql<number>`(
          SELECT count(*)::int FROM ${users} WHERE ${users.tenantId} = ${tenants.id}
        )`,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .orderBy(tenants.nome)
  })

  app.post('/tenants', async (request, reply) => {
    const parsed = createTenantSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }

    const [existente] = await db.select().from(tenants).where(eq(tenants.cnpj, parsed.data.cnpj)).limit(1)
    if (existente) {
      return reply.status(409).send({ error: `Já existe inquilino com o CNPJ ${parsed.data.cnpj}: ${existente.nome}` })
    }

    const [tenant] = await db.insert(tenants).values(parsed.data).returning()
    return reply.status(201).send(tenant)
  })

  app.put('/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = createTenantSchema.partial().safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }

    const [tenant] = await db
      .update(tenants)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning()

    if (!tenant) return reply.status(404).send({ error: 'Inquilino não encontrado' })
    return tenant
  })

  app.get('/tenants/:id/stores', async (request) => {
    const { id } = request.params as { id: string }
    return db
      .select({ id: stores.id, nome: stores.nome, numeroLoja: stores.numeroLoja })
      .from(stores)
      .where(and(eq(stores.tenantId, id), isNull(stores.deletedAt)))
      .orderBy(stores.numeroLoja)
  })

  // ─── Lojas disponíveis para vínculo ────────────────────────────────

  /**
   * Lojas com os medidores de cada uma e quem já tem acesso.
   *
   * É o que alimenta o seletor da tela de cadastro: o administrador procura pelo
   * nome da loja, pelo número ou pelo número de série do relógio, e vê na hora
   * se aquela loja já está com outro lojista.
   */
  app.get('/acessos/lojas', async () => {
    const lojas = await db
      .select({ id: stores.id, nome: stores.nome, numeroLoja: stores.numeroLoja })
      .from(stores)
      .where(isNull(stores.deletedAt))
      .orderBy(stores.numeroLoja)

    const medidores = await db
      .select({ storeId: meters.storeId, id: meters.id, numeroSerie: meters.numeroSerie, status: meters.status })
      .from(meters)
      .where(isNull(meters.deletedAt))

    const vinculos = await db
      .select({ storeId: userStores.storeId, nome: users.nome, email: users.email })
      .from(userStores)
      .innerJoin(users, eq(userStores.userId, users.id))

    return lojas.map((l) => ({
      ...l,
      medidores: medidores
        .filter((m) => m.storeId === l.id)
        .map(({ id, numeroSerie, status }) => ({ id, numeroSerie, status })),
      usuarios: vinculos.filter((v) => v.storeId === l.id).map(({ nome, email }) => ({ nome, email })),
    }))
  })

  // ─── Usuários ──────────────────────────────────────────────────────

  app.get('/users', async () => {
    const lista = await db
      .select({
        id: users.id,
        nome: users.nome,
        email: users.email,
        role: users.role,
        whatsapp: users.whatsapp,
        tenantId: users.tenantId,
        tenantNome: tenants.nome,
        senhaProvisoria: users.senhaProvisoria,
        ultimoLogin: users.ultimoLogin,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(tenants, eq(users.tenantId, tenants.id))
      .orderBy(users.nome)

    const vinculos = await db
      .select({ userId: userStores.userId, id: stores.id, nome: stores.nome, numeroLoja: stores.numeroLoja })
      .from(userStores)
      .innerJoin(stores, eq(userStores.storeId, stores.id))
      .where(isNull(stores.deletedAt))
      .orderBy(stores.numeroLoja)

    return lista.map((u) => ({
      ...u,
      lojas: vinculos.filter((v) => v.userId === u.id).map(({ id, nome, numeroLoja }) => ({ id, nome, numeroLoja })),
    }))
  })

  /**
   * Cria um usuário.
   *
   * A senha pode ser definida pelo administrador ou sorteada. Nos dois casos ela
   * é devolvida **uma única vez** nesta resposta. Como quem cria conhece a senha,
   * o padrão é o usuário ser obrigado a trocá-la no primeiro acesso.
   */
  app.post('/users', async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }
    const body = parsed.data
    const email = body.email.trim().toLowerCase()

    const [existente] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (existente) {
      return reply.status(409).send({ error: `Já existe usuário com o e-mail ${email}` })
    }

    if (body.tenantId) {
      const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, body.tenantId)).limit(1)
      if (!tenant) return reply.status(400).send({ error: 'Inquilino não encontrado' })
    }

    const storeIds = body.role === 'lojista' ? [...new Set(body.storeIds)] : []
    const faltando = await lojasInexistentes(storeIds)
    if (faltando.length > 0) {
      return reply.status(400).send({ error: `${faltando.length} loja(s) não encontrada(s) ou removida(s)` })
    }

    const senha = body.senha ?? senhaGerada()
    const senhaHash = await bcrypt.hash(senha, 12)
    const admin = quem(request)

    const user = await db.transaction(async (tx) => {
      const [criado] = await tx
        .insert(users)
        .values({
          tenantId: body.tenantId ?? null,
          email,
          nome: body.nome,
          whatsapp: body.whatsapp ?? null,
          role: body.role,
          senhaHash,
          senhaProvisoria: body.exigirTroca,
        })
        .returning({ id: users.id, email: users.email, nome: users.nome, role: users.role })

      if (storeIds.length > 0) {
        await tx.insert(userStores).values(storeIds.map((storeId) => ({ userId: criado.id, storeId, vinculadoPor: admin })))
      }
      return criado
    })

    app.log.info(`[ADMIN] ${admin} criou ${user.role} ${user.email} com ${storeIds.length} loja(s)`)

    return reply.status(201).send({
      ...user,
      lojasVinculadas: storeIds.length,
      // A senha só volta quando foi sorteada: se o admin digitou, ele já a tem.
      senhaGerada: body.senha ? null : senha,
      exigirTroca: body.exigirTroca,
    })
  })

  app.put('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = atualizarUsuarioSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }

    const [user] = await db
      .update(users)
      .set(parsed.data)
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, nome: users.nome, role: users.role })

    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    return user
  })

  /**
   * Define quais lojas o lojista enxerga — substitui o conjunto inteiro.
   *
   * Substituir, e não acrescentar/remover um a um, porque a tela mostra a lista
   * completa marcada: o que o administrador vê ao salvar é exatamente o que fica.
   */
  app.put('/users/:id/lojas', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = vincularLojasSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }

    const [user] = await db.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, id)).limit(1)
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    if (user.role !== 'lojista') {
      return reply.status(400).send({ error: 'Só lojista tem vínculo de loja — o administrador enxerga todas' })
    }

    const storeIds = [...new Set(parsed.data.storeIds)]
    const faltando = await lojasInexistentes(storeIds)
    if (faltando.length > 0) {
      return reply.status(400).send({ error: `${faltando.length} loja(s) não encontrada(s) ou removida(s)` })
    }

    const admin = quem(request)
    await db.transaction(async (tx) => {
      await tx.delete(userStores).where(eq(userStores.userId, id))
      if (storeIds.length > 0) {
        await tx.insert(userStores).values(storeIds.map((storeId) => ({ userId: id, storeId, vinculadoPor: admin })))
      }
    })

    app.log.warn(`[ADMIN] ${admin} definiu ${storeIds.length} loja(s) para ${user.email}`)
    return { id, lojasVinculadas: storeIds.length }
  })

  /** Nova senha — definida pelo administrador ou sorteada. */
  app.post('/users/:id/reset-senha', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = redefinirSenhaSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }

    const senha = parsed.data.senha ?? senhaGerada()

    const [user] = await db
      .update(users)
      .set({ senhaHash: await bcrypt.hash(senha, 12), senhaProvisoria: parsed.data.exigirTroca })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email })

    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    app.log.warn(`[ADMIN] senha de ${user.email} redefinida por ${quem(request)}`)

    return {
      ...user,
      senhaGerada: parsed.data.senha ? null : senha,
      exigirTroca: parsed.data.exigirTroca,
    }
  })

  /**
   * Remove o acesso de um usuário.
   *
   * O usuário não é referenciado por leitura nem fatura — só pelos vínculos, que
   * saem junto. O próprio administrador não se remove, para ninguém trancar o
   * sistema sem administrador por um clique errado.
   */
  app.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const eu = request.user as { id: string }
    if (eu.id === id) return reply.status(409).send({ error: 'Você não pode remover o próprio usuário' })

    const [user] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id, email: users.email })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    app.log.warn(`[ADMIN] ${quem(request)} removeu o usuário ${user.email}`)
    return { removido: true, id: user.id }
  })
}
