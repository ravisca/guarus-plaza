import { randomBytes } from 'node:crypto'
import { db } from '../config/database.js'
import { tenants, stores, meters, users, tariffs, userStores } from '../config/schema.js'
import bcrypt from 'bcrypt'

/**
 * Senha inicial de um usuário do seed.
 *
 * O seed gravava `admin123` e `lojista123` fixos no código — e essas senhas
 * estão publicadas no README de um repositório público. Um ambiente novo já
 * nascia com credencial conhecida, e a de produção ficou ativa por semanas
 * porque a API não tem rota de troca de senha.
 *
 * Agora: se a variável não vier definida, sorteia uma senha e a imprime **uma
 * única vez** no log de quem rodou o seed. Não dá para vazar por commit o que
 * não está no código.
 */
function senhaInicial(variavel: string): { senha: string; sorteada: boolean } {
  const informada = process.env[variavel]
  if (informada && informada.length > 0) return { senha: informada, sorteada: false }
  // base64url de 12 bytes = 16 caracteres, sem ambiguidade de encoding.
  return { senha: randomBytes(12).toString('base64url'), sorteada: true }
}

const credenciaisSorteadas: string[] = []

async function seed() {
  console.log('Seeding database...')

  // Banco já populado não é repopulado.
  //
  // O seed roda no `migrate` a cada deploy quando `RUN_SEED=1` ficou ligado no
  // painel — e ligado ele ficou. Sem esta guarda, cada deploy tentava recriar
  // inquilino, loja e usuário, falhava no índice único e deixava um erro no log
  // que mascara erro de verdade. Falhar por duplicata não é o mesmo que "não
  // havia nada a fazer", e o log precisa distinguir as duas coisas.
  const [existente] = await db.select({ id: users.id }).from(users).limit(1)
  if (existente) {
    console.log('Banco já populado — seed ignorado (nada foi alterado).')
    process.exit(0)
  }

  const [adminTenant] = await db.insert(tenants).values({
    nome: 'Guarus Plaza Admin',
    cnpj: '00000000000000',
    emailContato: 'admin@guarusplaza.com.br',
    status: 'ativo',
  }).returning()

  const admin = senhaInicial('SEED_ADMIN_PASSWORD')
  const adminHash = await bcrypt.hash(admin.senha, 12)
  await db.insert(users).values({
    tenantId: adminTenant.id,
    email: 'admin@guarusplaza.com.br',
    senhaHash: adminHash,
    role: 'admin',
    nome: 'Administrador',
  })
  if (admin.sorteada) {
    credenciaisSorteadas.push(`admin@guarusplaza.com.br  ${admin.senha}`)
  }

  const storeNames = [
    { nome: 'Loja 01 - Roupas', numero: '001' },
    { nome: 'Loja 02 - Calçados', numero: '002' },
    { nome: 'Loja 03 - Acessórios', numero: '003' },
    { nome: 'Loja 04 - Perfumaria', numero: '004' },
    { nome: 'Loja 05 - Eletrônicos', numero: '005' },
  ]

  const macAddresses = [
    'AA:BB:CC:DD:EE:01',
    'AA:BB:CC:DD:EE:02',
    'AA:BB:CC:DD:EE:03',
    'AA:BB:CC:DD:EE:04',
    'AA:BB:CC:DD:EE:05',
  ]

  for (let i = 0; i < storeNames.length; i++) {
    const [tenant] = await db.insert(tenants).values({
      nome: storeNames[i].nome,
      cnpj: `${10000000 + i}000100`,
      emailContato: `loja${i + 1}@example.com`,
      status: 'ativo',
    }).returning()

    const [store] = await db.insert(stores).values({
      tenantId: tenant.id,
      nome: storeNames[i].nome,
      numeroLoja: storeNames[i].numero,
      metragem: String(50 + Math.random() * 100),
      contratoInicio: '2024-01-01',
    }).returning()

    await db.insert(meters).values({
      storeId: store.id,
      macAddress: macAddresses[i],
      numeroSerie: `KON-${storeNames[i].numero}`,
      status: 'online',
    })

    const lojista = senhaInicial('SEED_LOJISTA_PASSWORD')
    const lojistaHash = await bcrypt.hash(lojista.senha, 12)
    const [lojistaUser] = await db.insert(users).values({
      tenantId: tenant.id,
      email: `loja${i + 1}@example.com`,
      senhaHash: lojistaHash,
      role: 'lojista',
      nome: `Lojista ${storeNames[i].numero}`,
    }).returning()
    // O acesso é pelo vínculo explícito, não pelo inquilino.
    await db.insert(userStores).values({ userId: lojistaUser.id, storeId: store.id, vinculadoPor: 'seed' })
    if (lojista.sorteada) {
      credenciaisSorteadas.push(`loja${i + 1}@example.com          ${lojista.senha}`)
    }

    console.log(`  Created store: ${storeNames[i].nome}`)
  }

  await db.insert(tariffs).values({
    valorKwh: '0.85',
    vigenteDesde: '2024-01-01',
  })

  console.log('Seed completed!')

  if (credenciaisSorteadas.length > 0) {
    console.log('')
    console.log('  ┌─────────────────────────────────────────────────────────────┐')
    console.log('  │  SENHAS SORTEADAS — anote agora. Não são exibidas de novo.  │')
    console.log('  └─────────────────────────────────────────────────────────────┘')
    for (const linha of credenciaisSorteadas) console.log(`    ${linha}`)
    console.log('')
    console.log('  Para definir as senhas em vez de sortear, use SEED_ADMIN_PASSWORD')
    console.log('  e SEED_LOJISTA_PASSWORD. Para trocar depois: npm run set-password.')
    console.log('')
  }

  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
