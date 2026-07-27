import { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { db } from '../../config/database'
import { users } from '../../config/schema'
import { loginSchema } from '../../utils/validators'

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1)

    if (!user) {
      return reply.status(401).send({ error: 'Credenciais inválidas' })
    }

    const valid = await bcrypt.compare(body.senha, user.senhaHash)
    if (!valid) {
      return reply.status(401).send({ error: 'Credenciais inválidas' })
    }

    const token = app.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    })

    return { token, user: { id: user.id, nome: user.nome, email: user.email, role: user.role } }
  })

  app.post('/refresh', { preHandler: [async (req, rep) => { try { await req.jwtVerify() } catch { rep.status(401).send({ error: 'Unauthorized' }) } }] }, async (request) => {
    const user = request.user as { id: string; email: string; role: string; tenantId: string }
    const token = app.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    })
    return { token }
  })
}
