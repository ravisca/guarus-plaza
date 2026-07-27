import { pgTable, uuid, varchar, numeric, timestamp, doublePrecision, inet, integer, boolean, date, text, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: varchar('nome', { length: 200 }).notNull(),
  cnpj: varchar('cnpj', { length: 14 }).unique().notNull(),
  emailContato: varchar('email_contato', { length: 200 }),
  whatsapp: varchar('whatsapp', { length: 20 }),
  status: varchar('status', { length: 20 }).default('ativo').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  nome: varchar('nome', { length: 200 }).notNull(),
  numeroLoja: varchar('numero_loja', { length: 20 }).unique().notNull(),
  metragem: numeric('metragem', { precision: 8, scale: 2 }),
  contratoInicio: date('contrato_inicio'),
  contratoFim: date('contrato_fim'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_stores_tenant').on(table.tenantId),
])

export const meters = pgTable('meters', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
  macAddress: varchar('mac_address', { length: 17 }).unique().notNull(),
  numeroSerie: varchar('numero_serie', { length: 50 }).unique().notNull(),
  ip: inet('ip'),
  firmware: varchar('firmware', { length: 20 }),
  status: varchar('status', { length: 20 }).default('online').notNull(),
  lastSeen: timestamp('last_seen'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_meters_store').on(table.storeId),
  index('idx_meters_mac').on(table.macAddress),
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 200 }).unique().notNull(),
  senhaHash: varchar('senha_hash', { length: 200 }).notNull(),
  role: varchar('role', { length: 20 }).notNull(),
  nome: varchar('nome', { length: 200 }).notNull(),
  whatsapp: varchar('whatsapp', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_users_email').on(table.email),
])

export const readings = pgTable('readings', {
  time: timestamp('time').notNull(),
  meterId: uuid('meter_id').references(() => meters.id).notNull(),
  kwh: doublePrecision('kwh'),
  voltage: doublePrecision('voltage'),
  current: doublePrecision('current'),
  power: doublePrecision('power'),
  powerFactor: doublePrecision('power_factor'),
}, (table) => [
  index('idx_readings_time').on(table.time),
  index('idx_readings_meter').on(table.meterId, table.time),
])

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
  tipo: varchar('tipo', { length: 50 }).notNull(),
  limite: numeric('limite', { precision: 12, scale: 2 }).notNull(),
  canal: varchar('canal', { length: 20 }).notNull(),
  ativo: boolean('ativo').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const alertLogs = pgTable('alert_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  alertId: uuid('alert_id').references(() => alerts.id, { onDelete: 'cascade' }),
  canal: varchar('canal', { length: 20 }).notNull(),
  destinatario: varchar('destinatario', { length: 200 }).notNull(),
  mensagem: text('mensagem'),
  enviadoEm: timestamp('enviado_em').defaultNow().notNull(),
})

export const tariffs = pgTable('tariffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  valorKwh: numeric('valor_kwh', { precision: 8, scale: 4 }).notNull(),
  vigenteDesde: date('vigente_desde').notNull(),
  vigenteAte: date('vigente_ate'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const billingCycles = pgTable('billing_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
  mes: integer('mes').notNull(),
  ano: integer('ano').notNull(),
  kwhTotal: numeric('kwh_total', { precision: 12, scale: 2 }).default('0').notNull(),
  tarifaKwh: numeric('tarifa_kwh', { precision: 8, scale: 4 }).notNull(),
  valorTotal: numeric('valor_total', { precision: 12, scale: 2 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('aberto').notNull(),
  fechadoEm: timestamp('fechado_em'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_billing_store_period').on(table.storeId, table.mes, table.ano),
])
