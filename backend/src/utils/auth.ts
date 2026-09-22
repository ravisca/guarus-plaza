import { FastifyRequest, FastifyReply } from 'fastify'

interface Autenticado {
  role: string
  senhaProvisoria?: boolean
}

/**
 * Enquanto a senha for provisória, o usuário não usa o sistema.
 *
 * Uma senha provisória foi gerada por outra pessoa e entregue por um canal fora
 * do sistema — quem criou o usuário a conhece. Deixar navegar assim significa
 * que nada do que aquela conta fizer é atribuível só ao dono dela. E num sistema
 * que fecha faturamento, "quem fez isso" é uma pergunta que precisa ter resposta.
 *
 * A trava é aqui, no servidor, e não só na tela: esconder o botão não impede
 * ninguém de chamar a rota direto.
 */
function bloqueiaSenhaProvisoria(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user as Autenticado
  if (user?.senhaProvisoria) {
    reply.status(403).send({
      error: 'Senha provisória: troque a senha antes de continuar',
      codigo: 'SENHA_PROVISORIA',
    })
    return true
  }
  return false
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
  bloqueiaSenhaProvisoria(request, reply)
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  if (bloqueiaSenhaProvisoria(request, reply)) return

  const user = request.user as Autenticado
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden: admin only' })
  }
}
