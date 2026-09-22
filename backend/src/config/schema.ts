import { pgTable, uuid, varchar, numeric, timestamp, doublePrecision, inet, integer, boolean, date, text, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core'

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
  // Horário de funcionamento, 'HH:MM' no fuso do shopping. É o que permite
  // avaliar o alerta de desperdício fora do horário — que era oferecido na tela
  // e não tinha implementação nenhuma no verificador.
  horarioAbertura: varchar('horario_abertura', { length: 5 }),
  horarioFechamento: varchar('horario_fechamento', { length: 5 }),
  contratoInicio: date('contrato_inicio'),
  contratoFim: date('contrato_fim'),
  // Exclusão lógica. Apagar de verdade uma loja que tem leitura e fatura
  // associadas destruiria a base de cálculo de cobranças já emitidas — e é
  // exatamente sobre isso que uma contestação pergunta.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
  // Quem recebeu senha gerada por outra pessoa precisa trocá-la antes de usar o
  // sistema: enquanto isto for true, o administrador que criou o usuário conhece
  // a senha dele, e nada do que o lojista fizer é atribuível só a ele.
  senhaProvisoria: boolean('senha_provisoria').default(false).notNull(),
  ultimoLogin: timestamp('ultimo_login', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_users_email').on(table.email),
])

/**
 * Quais lojas cada lojista enxerga — vínculo feito pelo administrador.
 *
 * Antes o acesso era deduzido do inquilino: o lojista via todas as lojas do
 * `tenant` dele. Como as 40 lojas de produção estão sob um único inquilino,
 * qualquer login de lojista passaria a enxergar o shopping inteiro. O vínculo
 * explícito resolve isso sem exigir um CNPJ por lojista, e permite o que o
 * shopping realmente precisa: dar a um usuário exatamente as lojas (e, por
 * consequência, os medidores) que são dele.
 */
export const userStores = pgTable('user_stores', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  // Quem concedeu o acesso. Acesso a consumo e fatura é dado sensível: precisa
  // ter resposta para "quem liberou isso".
  vinculadoPor: varchar('vinculado_por', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.storeId] }),
  index('idx_user_stores_store').on(table.storeId),
])

export const readings = pgTable('readings', {
  // COM fuso, de propósito. Com `timestamp without time zone` o instante gravado
  // dependia do fuso do processo Node: o driver interpretava o valor como hora
  // local ao ler e ao gravar. Depois de definir TZ=America/Sao_Paulo no
  // container, o mês de faturamento passou a começar às 06:00Z em vez de 03:00Z.
  // Com timestamptz o instante é absoluto e não há o que interpretar.
  time: timestamp('time', { withTimezone: true }).notNull(),
  meterId: uuid('meter_id').references(() => meters.id).notNull(),
  kwh: doublePrecision('kwh'),
  voltage: doublePrecision('voltage'),
  current: doublePrecision('current'),
  power: doublePrecision('power'),
  powerFactor: doublePrecision('power_factor'),
  // O coletor detecta que o acumulador do medidor retrocedeu (zerado, trocado,
  // ou leitura ruim) e marca `queda_acumulador` no payload. Esse sinal era
  // descartado pela ingestão e nunca chegava à fatura — sobrava só o delta
  // negativo, que o cálculo ignora sem dizer por quê. Agora é registrado e vira
  // observação no fechamento.
  anomalia: varchar('anomalia', { length: 40 }),
}, (table) => [
  // Chave primária composta: sem ela, uma reentrega do MQTT com QoS 1 gravava a
  // mesma leitura duas vezes. Isso não incomodava o cálculo antigo (max - min),
  // mas com soma de deltas a duplicata vira consumo inflado — e consumo inflado
  // vira cobrança indevida.
  //
  // A ordem (meterId, time) também é o que o TimescaleDB exige caso `readings`
  // venha a ser convertida em hypertable: a coluna de particionamento precisa
  // fazer parte da chave.
  primaryKey({ columns: [table.meterId, table.time] }),
  index('idx_readings_time').on(table.time),
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
  // 'aberto' | 'fechado' | 'requer_revisao'
  status: varchar('status', { length: 20 }).default('aberto').notNull(),
  fechadoEm: timestamp('fechado_em'),

  // Baixa do pagamento. O frontend já pintava um status 'pago' que nunca era
  // gravado por ninguém — um ramo morto na interface.
  pagoEm: timestamp('pago_em', { withTimezone: true }),
  pagoPor: varchar('pago_por', { length: 200 }),

  // Reabertura de ciclo fechado. O fechamento reescrevia fatura já fechada em
  // silêncio: bastava alguém repetir a ação para os valores mudarem debaixo de
  // uma cobrança que já tinha sido enviada. Agora reabrir é explícito e fica
  // registrado.
  reaberturas: integer('reaberturas').default(0).notNull(),
  reabertoEm: timestamp('reaberto_em', { withTimezone: true }),

  // ─── Trilha de auditoria ───────────────────────────────────────────
  //
  // Sem isto a fatura é um número solto: o lojista não consegue conferir de onde
  // ele saiu, e uma contestação não tem como ser reconstituída. Com estes campos
  // a fatura passa a ser verificável como uma conta de luz — leitura inicial,
  // leitura final, e quantas amostras sustentam o valor.
  leituraInicial: doublePrecision('leitura_inicial'),
  leituraFinal: doublePrecision('leitura_final'),
  amostras: integer('amostras').default(0).notNull(),
  // Maior intervalo sem leitura dentro do período, em minutos. É o que denuncia
  // queda de coleta e dispara o status 'requer_revisao'.
  lacunaMaiorMin: integer('lacuna_maior_min').default(0).notNull(),
  // Deltas descartados por serem fisicamente impossíveis ou por queda do
  // acumulador (medidor zerado/trocado).
  anomaliasDescartadas: integer('anomalias_descartadas').default(0).notNull(),
  observacao: text('observacao'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_billing_store_period').on(table.storeId, table.mes, table.ano),
])
