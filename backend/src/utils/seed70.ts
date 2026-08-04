import { db } from '../config/database.js'
import { tenants, stores, meters, users, readings, tariffs } from '../config/schema.js'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'

const storeNames = [
  'Roupas Femininas', 'Calçados & Acessórios', 'Perfumaria & Cosméticos', 'Eletrônicos & Gadgets',
  'Livraria & Papelaria', 'Casa & Decoração', 'Supermercado Mini', 'Farmácia Popular',
  'Ótica & Contact Lentes', 'Relojoaria & Joalheria', 'Pet Shop', 'Floricultura',
  'Pizzaria', 'Hamburgueria', 'Café & Confeitaria', 'Açaí & Sucos',
  'Barbearia', 'Salão de Beleza', 'Clínica Estética', 'Academia',
  'Studio de Pilates', 'Escritório de Advocacia', 'Contabilidade', 'Imobiliária',
  'Correios & Encomendas', 'Loterias', 'Informática & Reparos', 'Celular & Acessórios',
  'Materiais de Construção', 'Tintas & Pinturas', 'Elétrica & Hidráulica', 'Móveis Planejados',
  'Cama & Mesa & Banho', 'Loja de Brinquedos', 'Bebê & Gravidez', 'Esportes & Fitness',
  'Roupas Masculinas', 'Moda Infantil', 'Plus Size', 'Outlet de Marca',
  'Artesanato & Presentes', 'Bolsas & Malas', 'Chapéus & Bonés', 'Óculos de Sol',
  'Cigarraria & Tabacaria', 'Loja de Vinhos', 'Conveniência 24h', 'Lavanderia',
  'Self Service', 'Câmeras & Segurança', 'Automotivo', 'Jardinagem',
  'Ar & Ventilação', 'Água & Purificadores', 'Gás Encanado', 'Hotel & Pousada',
  'Agência de Viagem', 'Curso de Idiomas', 'Cursinho Pré-Vestibular', 'Psicologia',
  'Nutricionista', 'Fisioterapia', 'Dentista', 'Oftalmologista',
  'Veterinário', 'Pet Grooming', 'Pet Hotel', 'Banho & Tosa',
  'Doceria', 'Churrascaria', 'Restaurante Self Service', 'Marmitaria',
  'Padaria & Confeitaria', 'Sorveteria',
]

const categories = [
  { minKwh: 200, maxKwh: 800, pf: 0.88 },   // Lojas pequenas
  { minKwh: 500, maxKwh: 1500, pf: 0.92 },  // Lojas médias
  { minKwh: 1000, maxKwh: 3000, pf: 0.95 }, // Lojas grandes (supermercado, academia)
]

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function generateMacAddress(index: number) {
  const hex = index.toString(16).padStart(2, '0').toUpperCase()
  return `AA:BB:CC:DD:EE:${hex}`
}

async function seed() {
  console.log('=== Seeding 70 lojas com dados realistas ===\n')

  // Tarifa vigente
  const existingTariff = await db.select().from(tariffs).limit(1)
  if (existingTariff.length === 0) {
    await db.insert(tariffs).values({
      valorKwh: '0.85',
      vigenteDesde: '2024-01-01',
    })
  }

  const adminHash = await bcrypt.hash('admin123', 12)
  const lojistaHash = await bcrypt.hash('lojista123', 12)

  // Admin
  const existingAdmin = await db.select().from(users).where(eq(users.email, 'admin@guarusplaza.com.br')).limit(1)
  if (existingAdmin.length === 0) {
    const [adminTenant] = await db.insert(tenants).values({
      nome: 'Guarus Plaza Admin',
      cnpj: '00000000000000',
      emailContato: 'admin@guarusplaza.com.br',
      status: 'ativo',
    }).returning()

    await db.insert(users).values({
      tenantId: adminTenant.id,
      email: 'admin@guarusplaza.com.br',
      senhaHash: adminHash,
      role: 'admin',
      nome: 'Administrador',
    })
    console.log('Admin criado: admin@guarusplaza.com.br / admin123\n')
  } else {
    console.log('Admin já existe, pulando...\n')
  }

  for (let i = 0; i < storeNames.length; i++) {
    const num = String(i + 1).padStart(3, '0')
    const cat = categories[i < 25 ? 0 : i < 55 ? 1 : 2]

    // Tenant
    const [tenant] = await db.insert(tenants).values({
      nome: `Loja ${num} - ${storeNames[i]}`,
      cnpj: `${10000000 + i}000100`,
      emailContato: `loja${num}@example.com`,
      status: 'ativo',
    }).returning()

    // Store
    const metragem = randomBetween(20, 300)
    const [store] = await db.insert(stores).values({
      tenantId: tenant.id,
      nome: `Loja ${num} - ${storeNames[i]}`,
      numeroLoja: num,
      metragem: String(metragem.toFixed(1)),
      contratoInicio: '2024-01-01',
    }).returning()

    // Meter
    const mac = generateMacAddress(i + 1)
    await db.insert(meters).values({
      storeId: store.id,
      macAddress: mac,
      numeroSerie: `KON-${num}`,
      status: 'online',
    })

    // User (lojista)
    await db.insert(users).values({
      tenantId: tenant.id,
      email: `loja${num}@example.com`,
      senhaHash: lojistaHash,
      role: 'lojista',
      nome: `Lojista ${num}`,
    })

    // Generate readings for the current month (1 reading per hour for 15 days)
    const baseKwh = randomBetween(cat.minKwh, cat.maxKwh)
    const readingsPerDay = 24
    const days = 15
    const readingsData = []

    for (let day = 1; day <= days; day++) {
      for (let hour = 0; hour < readingsPerDay; hour++) {
        // Simulate realistic consumption pattern:
        // Low at night (0-6), peak during business hours (10-18), medium evening (18-22)
        let multiplier = 0.3 // night
        if (hour >= 6 && hour < 10) multiplier = 0.6 // morning ramp
        if (hour >= 10 && hour < 18) multiplier = 1.0 // peak
        if (hour >= 18 && hour < 22) multiplier = 0.7 // evening
        if (hour >= 22) multiplier = 0.4 // late night

        const dailyKwh = baseKwh / 30 // daily average
        const hourlyKwh = dailyKwh * multiplier / readingsPerDay
        const cumulativeKwh = baseKwh * ((day - 1) * readingsPerDay + hour) / (days * readingsPerDay)

        const voltage = randomBetween(215, 225)
        const current = randomBetween(10, 80) * multiplier
        const power = voltage * current / 1000
        const pf = randomBetween(cat.pf - 0.05, cat.pf + 0.05)

        const timestamp = new Date(2026, 6, day, hour, 0, 0) // July 2026

        readingsData.push({
          time: timestamp,
          meterId: (await db.select({ id: meters.id }).from(meters).where(
            eq(meters.macAddress, mac)
          ).limit(1))[0].id,
          kwh: cumulativeKwh,
          voltage,
          current,
          power,
          power_factor: Math.min(1, Math.max(0.7, pf)),
        })
      }
    }

    // Batch insert readings
    if (readingsData.length > 0) {
      await db.insert(readings).values(readingsData)
    }

    console.log(`  [${num}] ${storeNames[i]} - ${metragem.toFixed(0)}m² - ${baseKwh.toFixed(0)}kWh/mês - MAC: ${mac} - ${readingsData.length} readings`)
  }

  console.log('\n=== Seed completo! ===')
  console.log(`Total: ${storeNames.length} lojas, ${storeNames.length} medidores, ${storeNames.length * 24 * 15} readings`)
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
