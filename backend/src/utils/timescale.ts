import { sql } from 'drizzle-orm'
import { db } from '../config/database.js'

/**
 * Converte `readings` em hypertable do TimescaleDB, se ainda não for.
 *
 * O compose usa a imagem `timescale/timescaledb` e o README anuncia "PostgreSQL
 * 16 + TimescaleDB" desde o início — mas não existia **nenhuma** chamada a
 * `create_hypertable()` no projeto. Pagava-se o custo da imagem sem nenhum
 * benefício: sem particionamento por tempo, sem compressão, sem retenção.
 *
 * Com 41 medidores a cada 30 s são ~118 mil linhas por dia, 43 milhões por ano.
 *
 * Roda depois do `db:push` e é idempotente: pode ser executado a cada deploy.
 *
 * ⚠️ A PRIMEIRA execução numa tabela já populada move os dados existentes para
 * os chunks (`migrate_data => TRUE`) e segura um lock na tabela enquanto isso
 * acontece. Com poucos meses de leitura isso é rápido; com anos, não é.
 * **Faça backup antes** (scripts/dash_Plaza/06-backup-e-restauracao.md) e rode
 * numa janela de manutenção.
 */

/** Tamanho de cada chunk. Uma semana cobre bem a consulta típica (mês corrente). */
const INTERVALO_CHUNK = process.env.TIMESCALE_CHUNK || '7 days'

/** Idade a partir da qual a leitura crua é comprimida. */
const COMPRIMIR_APOS = process.env.TIMESCALE_COMPRIMIR_APOS || '30 days'

/**
 * Idade a partir da qual a leitura crua é descartada.
 *
 * Vazio (default) = **nunca descartar**. Ligar isto é uma decisão de negócio,
 * não técnica: a leitura crua é a prova de origem da fatura. Só faz sentido com
 * um agregado diário consolidado no lugar — que ainda não existe.
 */
const RETENCAO = process.env.TIMESCALE_RETENCAO || ''

export async function configurarTimescale(): Promise<void> {
  const [ext] = await db.execute<{ existe: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS existe
  `)

  if (!ext?.existe) {
    console.log('[TIMESCALE] extensão não instalada — readings segue tabela comum')
    return
  }

  const [ja] = await db.execute<{ existe: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM timescaledb_information.hypertables
      WHERE hypertable_name = 'readings'
    ) AS existe
  `)

  if (!ja?.existe) {
    console.log(`[TIMESCALE] convertendo readings em hypertable (chunks de ${INTERVALO_CHUNK})...`)
    // A PK já é (meter_id, time): o Timescale exige que a coluna de
    // particionamento faça parte de toda restrição única, e é por isso que a
    // chave foi criada nessa ordem.
    await db.execute(sql`
      SELECT create_hypertable(
        'readings', 'time',
        chunk_time_interval => ${INTERVALO_CHUNK}::interval,
        migrate_data => TRUE,
        if_not_exists => TRUE
      )
    `)
    console.log('[TIMESCALE] readings agora é hypertable')
  } else {
    console.log('[TIMESCALE] readings já é hypertable')
  }

  // Compressão: agrupa por medidor e ordena por tempo, que é exatamente como o
  // faturamento lê.
  try {
    await db.execute(sql`
      ALTER TABLE readings SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'meter_id',
        timescaledb.compress_orderby = 'time DESC'
      )
    `)
    await db.execute(sql`
      SELECT add_compression_policy('readings', ${COMPRIMIR_APOS}::interval, if_not_exists => TRUE)
    `)
    console.log(`[TIMESCALE] compressão ativa para dados com mais de ${COMPRIMIR_APOS}`)
  } catch (err: any) {
    console.warn(`[TIMESCALE] compressão não configurada: ${err.message}`)
  }

  if (RETENCAO) {
    await db.execute(sql`
      SELECT add_retention_policy('readings', ${RETENCAO}::interval, if_not_exists => TRUE)
    `)
    console.warn(`[TIMESCALE] RETENÇÃO ATIVA: leitura crua com mais de ${RETENCAO} será APAGADA`)
  } else {
    console.log('[TIMESCALE] sem política de retenção — leitura crua é preservada')
  }
}

// Permite rodar como script: `npm run db:timescale`
if (process.argv[1]?.includes('timescale')) {
  configurarTimescale()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[TIMESCALE] falhou: ${err.message}`)
      // Não derruba o deploy: sem hypertable o sistema funciona, só mais devagar.
      process.exit(0)
    })
}
