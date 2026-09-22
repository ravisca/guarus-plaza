import { FastifyRequest, FastifyReply } from 'fastify'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { db } from '../config/database.js'
import { stores, meters, users, userStores } from '../config/schema.js'

/**
 * Descobre de qual loja é a consulta, e se quem pergunta tem direito a ela.
 *
 * O acesso do lojista vem do vínculo explícito em `user_stores`, feito pelo
 * administrador. Antes era deduzido do inquilino — e com as 40 lojas de produção
 * sob um único inquilino, qualquer lojista enxergaria o shopping inteiro.
 *
 * O lojista pode pedir qualquer loja vinculada a ele e recebe 403 em qualquer
 * outra. `me` continua valendo como atalho para a primeira.
 */
export interface LojaResolvida {
  storeId: string
  meterIds: string[]
}

export async function lojasDoUsuario(userId: string) {
  return db
    .select({ id: stores.id, nome: stores.nome, numeroLoja: stores.numeroLoja })
    .from(userStores)
    .innerJoin(stores, eq(userStores.storeId, stores.id))
    .where(and(eq(userStores.userId, userId), isNull(stores.deletedAt)))
    .orderBy(stores.numeroLoja)
}

/** Lojistas com acesso a uma loja — destinatários dos alertas dela. */
export async function usuariosDaLoja(storeId: string) {
  return db
    .select({ id: users.id, nome: users.nome, email: users.email })
    .from(userStores)
    .innerJoin(users, eq(userStores.userId, users.id))
    .where(and(eq(userStores.storeId, storeId), eq(users.role, 'lojista')))
}

export async function resolverLoja(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<LojaResolvida | null> {
  const user = request.user as { id: string; role: string }
  const { storeId: pedido } = request.params as { storeId: string }

  let storeId: string

  if (user.role === 'lojista') {
    const minhas = await lojasDoUsuario(user.id)
    if (minhas.length === 0) {
      reply.status(404).send({ error: 'Nenhuma loja vinculada ao seu cadastro' })
      return null
    }

    if (pedido === 'me') {
      storeId = minhas[0].id
    } else if (minhas.some((l) => l.id === pedido)) {
      storeId = pedido
    } else {
      // Não diferencia "não existe" de "não é sua": as duas respostas juntas
      // permitiriam descobrir quais lojas existem.
      reply.status(403).send({ error: 'Loja não pertence ao seu cadastro' })
      return null
    }
  } else {
    if (pedido === 'me') {
      reply.status(400).send({ error: 'Informe o id da loja' })
      return null
    }
    const [loja] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.id, pedido), isNull(stores.deletedAt)))
      .limit(1)
    if (!loja) {
      reply.status(404).send({ error: 'Loja não encontrada' })
      return null
    }
    storeId = loja.id
  }

  const storeMeters = await db
    .select({ id: meters.id })
    .from(meters)
    .where(and(eq(meters.storeId, storeId), isNull(meters.deletedAt)))

  return { storeId, meterIds: storeMeters.map((m) => m.id) }
}

/** Medidores de um conjunto de lojas, para consultas agregadas. */
export async function medidoresDasLojas(storeIds: string[]): Promise<string[]> {
  if (storeIds.length === 0) return []
  const linhas = await db
    .select({ id: meters.id })
    .from(meters)
    .where(and(inArray(meters.storeId, storeIds), isNull(meters.deletedAt)))
  return linhas.map((m) => m.id)
}
