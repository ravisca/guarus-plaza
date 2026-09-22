import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { stores, meters, tenants, tariffs, billingCycles } from '../../config/schema.js'
import { eq, sql, desc, and, isNull } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth.js'
import { createStoreSchema, createMeterSchema, closeBillingSchema, createTariffSchema } from '../../utils/validators.js'
import {
  limitesDoMes,
  valorarConsumo,
  faixasTarifarias,
  consumoPorLoja,
  mesCorrente,
  LACUNA_MAX_MIN,
  FUSO_LOCAL,
} from '../billing/calculo.js'

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  app.get('/dashboard', async () => {
    // Mês corrente no fuso do shopping. Com `new Date().getMonth()` o container,
    // que roda em UTC, virava o mês três horas antes — o mesmo defeito de fuso
    // já corrigido no faturamento.
    const { ano, mes } = await mesCorrente()
    const { inicio, fim } = await limitesDoMes(ano, mes)

    const [totalStores] = await db.select({ count: sql<number>`count(*)::int` }).from(stores)
    const [activeTenants] = await db.select({ count: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.status, 'ativo'))
    const [offlineMeters] = await db.select({ count: sql<number>`count(*)::int` }).from(meters).where(eq(meters.status, 'offline'))

    // Mesma regra do fechamento — soma de incrementos positivos com teto físico.
    // Antes o ranking usava `max(kwh) - min(kwh)`, o cálculo que o faturamento
    // abandonou: uma leitura corrompida ou um medidor zerado faziam o painel
    // divergir da fatura, sem explicação disponível para quem perguntasse.
    const consumo = await consumoPorLoja(inicio, fim, 500)
    const totalConsumption = consumo.reduce((acc, s) => acc + s.kwh, 0)
    const topStores = consumo.slice(0, 10)

    // Quem está sem comunicação, e desde quando. A contagem sozinha não diz o
    // que a operação precisa saber para agir antes do fechamento do mês.
    const medidoresOffline = await db
      .select({
        id: meters.id,
        numeroSerie: meters.numeroSerie,
        storeNome: stores.nome,
        lastSeen: meters.lastSeen,
      })
      .from(meters)
      .leftJoin(stores, eq(meters.storeId, stores.id))
      .where(eq(meters.status, 'offline'))
      .orderBy(sql`${meters.lastSeen} asc nulls first`)
      .limit(20)

    return {
      totalStores: totalStores.count,
      activeTenants: activeTenants.count,
      offlineMeters: offlineMeters.count,
      totalConsumption,
      topStores,
      medidoresOffline,
      periodo: { ano, mes, inicio: inicio.toISOString(), fim: fim.toISOString(), fuso: FUSO_LOCAL },
    }
  })

  app.get('/stores', async (request) => {
    const { incluirRemovidas } = request.query as { incluirRemovidas?: string }
    const base = db
      .select({
        id: stores.id,
        tenantId: stores.tenantId,
        tenantNome: tenants.nome,
        nome: stores.nome,
        numeroLoja: stores.numeroLoja,
        metragem: stores.metragem,
        horarioAbertura: stores.horarioAbertura,
        horarioFechamento: stores.horarioFechamento,
        contratoInicio: stores.contratoInicio,
        contratoFim: stores.contratoFim,
        deletedAt: stores.deletedAt,
        // Subconsulta escrita com SQL literal, de propósito: dentro de um `sql`
        // de SELECT o drizzle renderiza a coluna SEM o nome da tabela, e
        // `WHERE "store_id" = "id"` passa a comparar duas colunas da tabela do
        // subselect — condição sempre falsa, contagem sempre zero, sem erro.
        medidores: sql<number>`(
          SELECT count(*)::int FROM meters m
          WHERE m.store_id = stores.id AND m.deleted_at IS NULL
        )`,
      })
      .from(stores)
      .leftJoin(tenants, eq(stores.tenantId, tenants.id))
      .orderBy(stores.numeroLoja)

    return incluirRemovidas === '1' ? base : base.where(isNull(stores.deletedAt))
  })

  /**
   * Exclusão lógica.
   *
   * Não havia rota de remoção nenhuma: corrigir um cadastro errado exigia
   * reaproveitar o registro por `PUT` — foi o que precisou ser feito com as 5
   * lojas do seed em produção.
   *
   * Lógica, e não física, porque a loja é referenciada por leituras e faturas.
   * Apagar de verdade destruiria a base de cálculo de cobranças já emitidas, que
   * é exatamente o que uma contestação vem perguntar.
   */
  app.delete('/stores/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [ativos] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(meters)
      .where(and(eq(meters.storeId, id), isNull(meters.deletedAt)))

    if (ativos.n > 0) {
      return reply.status(409).send({
        error: `Loja tem ${ativos.n} medidor(es) vinculado(s). Desvincule antes de remover.`,
      })
    }

    const [store] = await db
      .update(stores)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(stores.id, id), isNull(stores.deletedAt)))
      .returning()

    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return { removida: true, id: store.id, nome: store.nome }
  })

  app.post('/stores/:id/restaurar', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [store] = await db
      .update(stores)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(stores.id, id))
      .returning()
    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return store
  })

  app.post('/stores', async (request, reply) => {
    const body = createStoreSchema.parse(request.body)
    const [store] = await db.insert(stores).values({
      ...body,
      metragem: body.metragem ? String(body.metragem) : undefined,
    }).returning()
    return reply.status(201).send(store)
  })

  app.put('/stores/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createStoreSchema.partial().parse(request.body)
    const updateData: Record<string, any> = { ...body, updatedAt: new Date() }
    if (body.metragem !== undefined) {
      updateData.metragem = body.metragem ? String(body.metragem) : null
    }
    const [store] = await db.update(stores).set(updateData).where(eq(stores.id, id)).returning()
    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return store
  })

  app.get('/meters', async () => {
    return db
      .select({
        id: meters.id,
        storeId: meters.storeId,
        storeNome: stores.nome,
        macAddress: meters.macAddress,
        numeroSerie: meters.numeroSerie,
        ip: meters.ip,
        firmware: meters.firmware,
        status: meters.status,
        lastSeen: meters.lastSeen,
        createdAt: meters.createdAt,
      })
      .from(meters)
      .leftJoin(stores, eq(meters.storeId, stores.id))
      .where(isNull(meters.deletedAt))
      .orderBy(meters.numeroSerie)
  })

  app.delete('/meters/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    // Leitura já gravada continua existindo e continua sustentando faturas
    // antigas — por isso a remoção é lógica.
    const [meter] = await db
      .update(meters)
      .set({ deletedAt: new Date(), status: 'offline', storeId: null })
      .where(and(eq(meters.id, id), isNull(meters.deletedAt)))
      .returning()

    if (!meter) return reply.status(404).send({ error: 'Medidor não encontrado' })
    return { removido: true, id: meter.id, numeroSerie: meter.numeroSerie }
  })

  app.post('/meters', async (request, reply) => {
    const body = createMeterSchema.parse(request.body)
    const [meter] = await db.insert(meters).values(body).returning()
    return reply.status(201).send(meter)
  })

  app.put('/meters/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createMeterSchema.partial().parse(request.body)
    const [meter] = await db.update(meters).set(body).where(eq(meters.id, id)).returning()
    if (!meter) return reply.status(404).send({ error: 'Medidor não encontrado' })
    return meter
  })

  // Com o nome da loja. Sem o join, a tela caía no fallback `storeId.slice(0,8)`
  // e o operador lia fragmentos de UUID no lugar de "Loja 23".
  app.get('/billing', async (request) => {
    const { mes, ano } = request.query as { mes: string; ano: string }
    return db
      .select({
        id: billingCycles.id,
        storeId: billingCycles.storeId,
        storeNome: stores.nome,
        numeroLoja: stores.numeroLoja,
        mes: billingCycles.mes,
        ano: billingCycles.ano,
        kwhTotal: billingCycles.kwhTotal,
        tarifaKwh: billingCycles.tarifaKwh,
        valorTotal: billingCycles.valorTotal,
        status: billingCycles.status,
        fechadoEm: billingCycles.fechadoEm,
        pagoEm: billingCycles.pagoEm,
        pagoPor: billingCycles.pagoPor,
        leituraInicial: billingCycles.leituraInicial,
        leituraFinal: billingCycles.leituraFinal,
        amostras: billingCycles.amostras,
        lacunaMaiorMin: billingCycles.lacunaMaiorMin,
        anomaliasDescartadas: billingCycles.anomaliasDescartadas,
        observacao: billingCycles.observacao,
        reaberturas: billingCycles.reaberturas,
      })
      .from(billingCycles)
      .leftJoin(stores, eq(billingCycles.storeId, stores.id))
      .where(and(eq(billingCycles.mes, Number(mes)), eq(billingCycles.ano, Number(ano))))
      .orderBy(stores.numeroLoja)
  })

  /**
   * Reabre um ciclo já fechado.
   *
   * Antes não existia: o fechamento simplesmente sobrescrevia ciclos fechados,
   * em silêncio. Bastava alguém repetir a ação para os valores de uma fatura já
   * enviada mudarem, sem registro de que tinham mudado. Agora refazer um mês
   * fechado é uma decisão explícita, contada na própria fatura.
   */
  app.post('/billing/:id/reabrir', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [ciclo] = await db.select().from(billingCycles).where(eq(billingCycles.id, id)).limit(1)
    if (!ciclo) return reply.status(404).send({ error: 'Ciclo não encontrado' })
    if (ciclo.status === 'aberto') return reply.status(409).send({ error: 'Ciclo já está aberto' })

    const usuario = (request.user as { email?: string })?.email ?? 'desconhecido'
    const [atualizado] = await db
      .update(billingCycles)
      .set({
        status: 'aberto',
        reaberturas: ciclo.reaberturas + 1,
        reabertoEm: new Date(),
        observacao: [ciclo.observacao, `reaberto por ${usuario}`].filter(Boolean).join('; '),
      })
      .where(eq(billingCycles.id, id))
      .returning()

    app.log.warn(`[BILLING] ciclo ${ciclo.mes}/${ciclo.ano} da loja ${ciclo.storeId} reaberto por ${usuario}`)
    return atualizado
  })

  /** Baixa manual do pagamento. O status 'pago' era pintado pela tela e nunca gravado. */
  app.post('/billing/:id/pagar', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [ciclo] = await db.select().from(billingCycles).where(eq(billingCycles.id, id)).limit(1)
    if (!ciclo) return reply.status(404).send({ error: 'Ciclo não encontrado' })
    if (ciclo.status === 'requer_revisao') {
      return reply.status(409).send({ error: 'Ciclo em revisão não pode ser baixado como pago' })
    }

    const usuario = (request.user as { email?: string })?.email ?? 'desconhecido'
    const [atualizado] = await db
      .update(billingCycles)
      .set({ status: 'pago', pagoEm: new Date(), pagoPor: usuario })
      .where(eq(billingCycles.id, id))
      .returning()

    return atualizado
  })

  app.post('/billing/close', async (request) => {
    const body = closeBillingSchema.parse(request.body)

    // Limites do mês no fuso do shopping, não no fuso do processo. O container
    // roda em UTC: com `new Date(ano, mes-1, 1)` o mês começava às 21h do último
    // dia do mês anterior, em horário de Brasília.
    const { inicio, fim } = await limitesDoMes(body.ano, body.mes)

    // O consumo é medido separadamente em cada faixa de vigência de tarifa, para
    // que uma tarifa que passe a valer no dia 20 não seja cobrada sobre o
    // consumo dos dias 1 a 19.
    const faixas = await faixasTarifarias(inicio, fim)

    const allStores = await db.select().from(stores).where(isNull(stores.deletedAt))

    // Ciclos que já estão fechados ou pagos não são recalculados: mudar o valor
    // de uma fatura já emitida exige reabrir o ciclo, de propósito e com
    // registro (POST /billing/:id/reabrir).
    const jaFechados = await db
      .select({ storeId: billingCycles.storeId, status: billingCycles.status })
      .from(billingCycles)
      .where(and(eq(billingCycles.mes, body.mes), eq(billingCycles.ano, body.ano)))

    const intocaveis = new Set(
      jaFechados.filter((c) => c.status === 'fechado' || c.status === 'pago').map((c) => c.storeId),
    )

    const results: typeof billingCycles.$inferSelect[] = []
    const preservados: string[] = []
    const paraGravar: typeof billingCycles.$inferInsert[] = []

    for (const store of allStores) {
      if (intocaveis.has(store.id)) {
        preservados.push(store.nome)
        continue
      }

      const storeMeters = await db
        .select({ id: meters.id })
        .from(meters)
        .where(and(eq(meters.storeId, store.id), isNull(meters.deletedAt)))
      const meterIds = storeMeters.map((m: { id: string }) => m.id)

      if (meterIds.length === 0) continue

      // Sem tarifa cadastrada o valor sai zero e o ciclo trava em revisão logo
      // abaixo — nunca emitir fatura de valor zero em silêncio.
      const periodo = await valorarConsumo(meterIds, inicio, fim, faixas)
      const valorTotal = periodo.valorTotal
      const tarifaEfetiva = periodo.tarifaKwh

      const motivos: string[] = []
      if (periodo.amostras === 0) motivos.push('nenhuma leitura no período')
      if (periodo.lacunaMaiorMin > LACUNA_MAX_MIN) {
        motivos.push(`lacuna de coleta de ${periodo.lacunaMaiorMin} min (limite ${LACUNA_MAX_MIN})`)
      }
      if (periodo.anomaliasDescartadas > 0) {
        motivos.push(`${periodo.anomaliasDescartadas} leitura(s) descartada(s) por valor implausível ou queda do acumulador`)
      }
      // Vem do próprio coletor, não de dedução do cálculo: o medidor foi zerado
      // ou trocado. Esse sinal era descartado na ingestão e nunca chegava aqui.
      if (periodo.quedasDeAcumulador > 0) {
        motivos.push(
          `${periodo.quedasDeAcumulador} leitura(s) marcada(s) pelo coletor como queda de acumulador ` +
          '(medidor zerado ou substituído) — conferir com a troca de equipamento',
        )
      }
      if (faixas.length === 0) motivos.push('nenhuma tarifa vigente cadastrada')

      // Nunca emitir valor sobre um número que se sabe incompleto: é preferível
      // travar o fechamento e exigir conferência humana.
      const requerRevisao = motivos.length > 0
      const valorFinal = requerRevisao ? 0 : valorTotal

      const dados = {
        kwhTotal: String(periodo.consumoKwh.toFixed(2)),
        tarifaKwh: String(tarifaEfetiva.toFixed(4)),
        valorTotal: String(valorFinal.toFixed(2)),
        status: requerRevisao ? 'requer_revisao' : 'fechado',
        fechadoEm: new Date(),
        leituraInicial: periodo.leituraInicial,
        leituraFinal: periodo.leituraFinal,
        amostras: periodo.amostras,
        lacunaMaiorMin: periodo.lacunaMaiorMin,
        anomaliasDescartadas: periodo.anomaliasDescartadas,
        observacao: requerRevisao ? motivos.join('; ') : null,
      }

      paraGravar.push({ storeId: store.id, mes: body.mes, ano: body.ano, ...dados })
    }

    // Uma transação para todas as lojas.
    //
    // O laço anterior gravava loja a loja: um erro na loja 30 deixava 29 lojas
    // fechadas e 11 não, sem nenhum registro de onde tinha parado — e a segunda
    // tentativa começaria do zero por cima de um fechamento pela metade. Aqui,
    // ou o mês inteiro fecha, ou nada muda.
    //
    // As medições acima ficam fora da transação de propósito: são só leitura, e
    // segurar uma transação aberta durante dezenas de consultas pesadas
    // prenderia conexão à toa.
    if (paraGravar.length > 0) {
      const gravados = await db.transaction(async (tx) => {
        const saida = []
        for (const linha of paraGravar) {
          const { storeId, mes, ano, ...dados } = linha
          const [billing] = await tx
            .insert(billingCycles)
            .values(linha)
            .onConflictDoUpdate({
              target: [billingCycles.storeId, billingCycles.mes, billingCycles.ano],
              set: dados,
            })
            .returning()
          saida.push(billing)
        }
        return saida
      })
      results.push(...gravados)
    }

    const paraRevisao = results.filter((b) => b.status === 'requer_revisao').length

    return {
      closed: results.length,
      fechadas: results.length - paraRevisao,
      requerRevisao: paraRevisao,
      // Ciclos que já estavam fechados e não foram tocados. Sem isto, o operador
      // não tem como saber por que uma loja não apareceu no resultado.
      preservados,
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString(), fuso: FUSO_LOCAL },
      billing: results,
    }
  })

  app.get('/tariffs', async () => {
    return db.select().from(tariffs).orderBy(desc(tariffs.vigenteDesde))
  })

  app.post('/tariffs', async (request, reply) => {
    const body = createTariffSchema.parse(request.body)
    const [tariff] = await db.insert(tariffs).values({
      ...body,
      valorKwh: String(body.valorKwh),
    }).returning()
    return reply.status(201).send(tariff)
  })
}
