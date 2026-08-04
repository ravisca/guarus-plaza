import { db } from '../config/database.js'
import { tenants, stores, meters, users, tariffs } from '../config/schema.js'
import bcrypt from 'bcrypt'

async function seed() {
  console.log('Seeding database...')

  const [adminTenant] = await db.insert(tenants).values({
    nome: 'Guarus Plaza Admin',
    cnpj: '00000000000000',
    emailContato: 'admin@guarusplaza.com.br',
    status: 'ativo',
  }).returning()

  const adminHash = await bcrypt.hash('admin123', 12)
  await db.insert(users).values({
    tenantId: adminTenant.id,
    email: 'admin@guarusplaza.com.br',
    senhaHash: adminHash,
    role: 'admin',
    nome: 'Administrador',
  })

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

    const lojistaHash = await bcrypt.hash('lojista123', 12)
    await db.insert(users).values({
      tenantId: tenant.id,
      email: `loja${i + 1}@example.com`,
      senhaHash: lojistaHash,
      role: 'lojista',
      nome: `Lojista ${storeNames[i].numero}`,
    })

    console.log(`  Created store: ${storeNames[i].nome}`)
  }

  await db.insert(tariffs).values({
    valorKwh: '0.85',
    vigenteDesde: '2024-01-01',
  })

  console.log('Seed completed!')
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
