import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { db } from '../../config/database.js'
import { users, tenants } from '../../config/schema.js'
import { loginSchema, trocarSenhaSchema } from '../../utils/validators.js'
import { lojasDoUsuario } from '../../utils/loja.js'
import {
  chavesDeLogin,
  bloqueioRestanteMs,
  registrarFalha,
  registrarSucesso,
} from '../../utils/throttleLogin.js'

/**
 * Hash descartável, usado quando o e-mail não existe.
 *
 * Sem ele a resposta para "e-mail inexistente" volta na hora e a de "e-mail
 * certo, senha errada" demora o tempo do bcrypt — diferença medível, que
 * transforma o login num verificador de quais e-mails existem no sistema. Aqui
 * os dois caminhos pagam o mesmo custo.
 *
 * Gerado de verdade, com o mesmo custo (12) usado no cadastro: um hash
 * inventado à mão seria rejeitado como malformado e a comparação voltaria a ser
 * instantânea — sem resolver nada.
 */
const HASH_FALSO = bcrypt.hashSync('nao-e-a-senha-de-ninguem', 12)

interface TokenUser {
  id: string
  email: string
  role: string
  tenantId: string | null
  senhaProvisoria?: boolean
}

/** Verificação de token sem a trava de senha provisória — usada só aqui. */
async function apenasToken(req: FastifyRequest, rep: FastifyReply) {
  try {
    await req.jwtVerify()
  } catch {
    rep.status(401).send({ error: 'Unauthorized' })
  }
}

export async function authRoutes(app: FastifyInstance) {
  function assinar(user: TokenUser) {
    return app.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      senhaProvisoria: user.senhaProvisoria ?? false,
    })
  }

  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      // Corpo inválido é 400, não 500: `<schema>.parse()` deixava o ZodError
      // subir sem tratamento.
      return reply.status(400).send({
        error: 'Requisição inválida',
        campos: parsed.error.flatten().fieldErrors,
      })
    }
    const body = parsed.data

    const chaves = chavesDeLogin(request.ip, body.email)
    const espera = bloqueioRestanteMs(chaves)
    if (espera > 0) {
      const segundos = Math.ceil(espera / 1000)
      app.log.warn(`[LOGIN] bloqueado por ${segundos}s — ip=${request.ip} email=${body.email}`)
      return reply
        .status(429)
        .header('Retry-After', String(segundos))
        .send({ error: `Muitas tentativas. Tente novamente em ${segundos} segundos.` })
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1)

    const valid = await bcrypt.compare(body.senha, user?.senhaHash ?? HASH_FALSO)

    if (!user || !valid) {
      registrarFalha(chaves)
      return reply.status(401).send({ error: 'Credenciais inválidas' })
    }

    registrarSucesso(chaves)
    await db.update(users).set({ ultimoLogin: new Date() }).where(eq(users.id, user.id))

    return {
      token: assinar(user),
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        // A tela usa isto para levar direto à troca obrigatória.
        senhaProvisoria: user.senhaProvisoria,
      },
    }
  })

  /**
   * Quem sou eu e o que enxergo.
   *
   * Existe porque a tela do lojista mandava `user.id` no lugar de um `storeId` —
   * funcionava só porque o backend ignorava o valor e resolvia a loja pelo
   * tenant. Com um inquilino que tem mais de uma loja, isso passa a ser errado:
   * o lojista veria sempre a primeira e nunca saberia que existe outra.
   */
  app.get('/me', { preHandler: [apenasToken] }, async (request) => {
    const token = request.user as TokenUser

    const [user] = await db.select().from(users).where(eq(users.id, token.id)).limit(1)
    if (!user) return { user: null, lojas: [] }

    // Só lojista tem vínculo de loja; o admin enxerga tudo pelas telas próprias.
    const lojas = user.role === 'lojista' ? await lojasDoUsuario(user.id) : []

    const [tenant] = user.tenantId
      ? await db.select({ nome: tenants.nome }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1)
      : [undefined]

    return {
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        senhaProvisoria: user.senhaProvisoria,
        tenantNome: tenant?.nome ?? null,
      },
      lojas,
    }
  })

  /**
   * Troca de senha pelo próprio usuário.
   *
   * Não existia rota nenhuma para isso: a única forma de trocar uma senha era o
   * utilitário `set-password`, por variável de ambiente e redeploy. Foi por isso
   * que `admin123` sobreviveu em produção.
   */
  app.post('/trocar-senha', { preHandler: [apenasToken] }, async (request, reply) => {
    const parsed = trocarSenhaSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', campos: parsed.error.flatten().fieldErrors })
    }
    const token = request.user as TokenUser

    const [user] = await db.select().from(users).where(eq(users.id, token.id)).limit(1)
    if (!user) return reply.status(401).send({ error: 'Unauthorized' })

    // Exigir a senha atual impede que um token roubado troque a senha e tranque
    // o dono para fora da própria conta.
    const confere = await bcrypt.compare(parsed.data.senhaAtual, user.senhaHash)
    if (!confere) {
      return reply.status(401).send({ error: 'Senha atual incorreta' })
    }

    if (parsed.data.senhaNova === parsed.data.senhaAtual) {
      return reply.status(400).send({ error: 'A senha nova precisa ser diferente da atual' })
    }

    await db
      .update(users)
      .set({ senhaHash: await bcrypt.hash(parsed.data.senhaNova, 12), senhaProvisoria: false })
      .where(eq(users.id, user.id))

    app.log.info(`[AUTH] ${user.email} trocou a própria senha`)

    // Token novo já sem a marca de provisória, para o usuário seguir sem
    // precisar entrar de novo.
    return { token: assinar({ ...user, senhaProvisoria: false }) }
  })

  app.post('/refresh', { preHandler: [apenasToken] }, async (request) => {
    const user = request.user as TokenUser
    return { token: assinar(user) }
  })
}
