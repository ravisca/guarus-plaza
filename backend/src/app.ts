import Fastify, { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { env } from './config/env.js'
import { authRoutes } from './modules/auth/routes.js'
import { adminRoutes } from './modules/admin/routes.js'
import { cadastroRoutes } from './modules/admin/cadastro.js'
import { meterRoutes } from './modules/meters/routes.js'
import { readingRoutes } from './modules/readings/routes.js'
import { billingRoutes } from './modules/billing/routes.js'
import { alertRoutes } from './modules/alerts/routes.js'

/**
 * Monta a aplicação sem subir servidor nem ligar job nenhum.
 *
 * A separação existe para que o teste de autorização possa subir a API de
 * verdade — com o mesmo JWT, os mesmos hooks e as mesmas rotas — sem arrastar
 * junto o verificador de alertas, o marcador de medidores offline e a
 * sincronização com o agente. Antes, importar `index.ts` iniciava tudo.
 */
export async function construirApp(): Promise<FastifyInstance> {
  /**
   * Redes em que os nossos proxies vivem.
   *
   * Sem isto, `request.ip` é o IP do container do nginx — o mesmo para **todo
   * mundo**. Consequências, ambas silenciosas:
   *
   *   - o `rate-limit` global de 100 req/min virava um balde único para o
   *     shopping inteiro, em vez de um por cliente;
   *   - o freio de tentativas de login (utils/throttleLogin) bloquearia todos os
   *     lojistas assim que alguém errasse a senha cinco vezes.
   *
   * A lista é de faixas privadas, e não uma contagem de saltos: o Fastify caminha
   * o `X-Forwarded-For` da direita para a esquerda e para no primeiro endereço
   * que não está nela — o IP real do cliente. Um cliente que forje o cabeçalho
   * não se beneficia: o proxy confiável acrescenta o IP verdadeiro depois do
   * valor forjado, e é nesse que a caminhada para.
   */
  const PROXIES_CONFIAVEIS = process.env.TRUST_PROXY
    || '127.0.0.1, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7'

  const app = Fastify({
    logger: process.env.LOG_SILENCIOSO === '1' ? false : true,
    trustProxy: PROXIES_CONFIAVEIS,
  })

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  })

  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX || 100),
    timeWindow: '1 minute',
  })

  /**
   * Erro de validação é 400, não 500.
   *
   * As rotas chamavam `<schema>.parse(request.body)` e deixavam o `ZodError`
   * subir. Resultado: corpo inválido devolvia **500**, com corpo genérico. Além
   * do status errado, isso enchia o log de erro de servidor por engano de digitação
   * do cliente — e escondia as falhas de verdade no meio.
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Dados inválidos',
        campos: error.flatten().fieldErrors,
      })
    }

    // Erro que o Fastify já classificou (payload grande demais, JSON malformado,
    // rate limit) mantém o próprio status.
    const classificado = error as { statusCode?: number; message?: string }
    const status = classificado.statusCode ?? 500
    if (status < 500) {
      return reply.status(status).send({ error: classificado.message ?? 'Requisição inválida' })
    }

    // Falha de verdade: o cliente recebe um identificador, e o log recebe o resto.
    // Sem isso, "deu erro na tela" é impossível de casar com uma linha do log.
    const ref = randomUUID().slice(0, 8)
    request.log.error({ err: error, ref }, `Erro não tratado [${ref}]`)
    return reply.status(500).send({
      error: 'Erro interno. Informe a referência ao suporte.',
      referencia: ref,
    })
  })

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(adminRoutes, { prefix: '/api/admin' })
  await app.register(cadastroRoutes, { prefix: '/api/admin' })
  // /api/stores foi removido: eram três stubs que devolviam `{ message: '...
  // endpoint' }` e vazavam a loja inteira (nome, metragem, vigência de contrato)
  // para qualquer autenticado. Nenhuma tela os consumia.
  await app.register(meterRoutes, { prefix: '/api/meters' })
  await app.register(readingRoutes, { prefix: '/api/readings' })
  await app.register(billingRoutes, { prefix: '/api/billing' })
  await app.register(alertRoutes, { prefix: '/api/alerts' })
  // /api/ingest foi removido. Era um caminho de ESCRITA de leituras — a origem
  // do número que vira fatura — que ninguém usava e ninguém monitorava: a
  // sincronização real é por WebSocket pull (modules/agentSync), e o próprio
  // README já registrava a rota como sem uso. Superfície de ataque sem
  // contrapartida.

  return app
}
