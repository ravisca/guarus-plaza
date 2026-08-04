import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import { db } from '../config/database.js'
import { users } from '../config/schema.js'

// Redefine a senha de um usuário existente.
//
// A API não expõe rota de troca de senha, e o seed grava credenciais que estão
// documentadas publicamente no README ('admin123'). Sem este utilitário, a única
// forma de trocar a senha de um ambiente já publicado seria mexer no banco à mão.
//
// Uso:
//   SET_PASSWORD_EMAIL=admin@guarusplaza.com.br SET_PASSWORD_VALUE=<nova> npm run set-password
//
// A senha vem por variável de ambiente de propósito: assim ela é fornecida pelo
// painel de quem opera o deploy e não precisa passar por linha de comando (que
// fica no histórico do shell) nem ser versionada.

const email = process.env.SET_PASSWORD_EMAIL
const senha = process.env.SET_PASSWORD_VALUE

if (!email || !senha) {
  console.error('[set-password] defina SET_PASSWORD_EMAIL e SET_PASSWORD_VALUE')
  process.exit(1)
}

// O login valida senha com z.string().min(6); rejeitar aqui evita gravar uma
// senha que depois seria impossível usar.
if (senha.length < 6) {
  console.error('[set-password] a senha precisa ter no mínimo 6 caracteres')
  process.exit(1)
}

const hash = await bcrypt.hash(senha, 12)
const updated = await db
  .update(users)
  .set({ senhaHash: hash })
  .where(eq(users.email, email))
  .returning({ email: users.email, role: users.role })

if (updated.length === 0) {
  console.error(`[set-password] nenhum usuário com e-mail ${email}`)
  process.exit(1)
}

console.log(`[set-password] senha atualizada para ${updated[0].email} (${updated[0].role})`)
process.exit(0)
