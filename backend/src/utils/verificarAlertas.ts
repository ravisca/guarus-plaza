/**
 * Diz quais alertas nunca vão disparar — e por quê (D-09).
 *
 * A suspeita registrada era outra: que o formulário antigo, mandando
 * `storeId: user.id`, tivesse gravado alertas apontando para o id do usuário. Não
 * gravou. `alerts.store_id` tem chave estrangeira para `stores` desde o commit
 * inicial, então o Postgres recusava a inserção e a tela devolvia erro 500 — o
 * efeito real do defeito era **não conseguir criar alerta nenhum** pela tela.
 *
 * O que sobra, e que este script mostra, são as formas silenciosas de um alerta
 * existir e nunca disparar: loja sem relógio, alerta de horário em loja sem
 * horário cadastrado, alerta pausado. Em todos esses casos a tela mostra o
 * alerta configurado e o lojista acredita estar sendo avisado.
 *
 *   npm run verificar:alertas
 *
 * Só lê. O conserto é cadastro (vincular relógio, preencher horário) ou decisão
 * do lojista (reativar), e nenhum dos dois deve acontecer por script.
 */

import { sql } from 'drizzle-orm'
import { db } from '../config/database.js'

interface Linha extends Record<string, unknown> {
  id: string
  tipo: string
  ativo: boolean
  loja: string | null
  medidores: number
  tem_horario: boolean
  disparos: number
  ultimo: Date | null
}

async function main() {
  const linhas = await db.execute<Linha>(sql`
    SELECT
      a.id, a.tipo, a.ativo,
      s.nome AS loja,
      (SELECT count(*)::int FROM meters m WHERE m.store_id = s.id AND m.deleted_at IS NULL) AS medidores,
      (s.horario_abertura IS NOT NULL AND s.horario_fechamento IS NOT NULL) AS tem_horario,
      (SELECT count(*)::int FROM alert_logs l WHERE l.alert_id = a.id) AS disparos,
      (SELECT max(l.enviado_em) FROM alert_logs l WHERE l.alert_id = a.id) AS ultimo
    FROM alerts a
    LEFT JOIN stores s ON s.id = a.store_id
    ORDER BY s.nome NULLS FIRST, a.tipo
  `)

  if (linhas.length === 0) {
    console.log('Nenhum alerta cadastrado no banco.')
    console.log('Se você esperava encontrar alertas, é o sintoma do defeito antigo:')
    console.log('a tela mandava o id do usuário no lugar do id da loja e o cadastro falhava com erro 500.')
    process.exit(0)
  }

  const problemas: string[] = []
  console.log(`${linhas.length} alerta(s) cadastrado(s):\n`)

  for (const l of linhas) {
    const motivos: string[] = []
    if (!l.loja) motivos.push('aponta para loja inexistente')
    if (l.medidores === 0) motivos.push('loja sem relógio vinculado — não há o que medir')
    if (l.tipo === 'horario_sem_atividade' && !l.tem_horario) {
      motivos.push('horário de funcionamento não cadastrado na loja — este tipo é ignorado pelo verificador')
    }
    if (!l.ativo) motivos.push('pausado pelo lojista')

    const situacao = l.disparos > 0
      ? `${l.disparos} disparo(s), último em ${new Date(l.ultimo!).toLocaleString('pt-BR')}`
      : 'nunca disparou'

    console.log(`  ${l.loja ?? '(sem loja)'} · ${l.tipo}`)
    console.log(`      ${situacao}`)
    for (const m of motivos) {
      console.log(`      NÃO VAI DISPARAR: ${m}`)
      problemas.push(`${l.loja ?? '(sem loja)'} / ${l.tipo}: ${m}`)
    }
  }

  console.log('')
  console.log(problemas.length === 0
    ? 'Todos os alertas estão em condição de disparar.'
    : `${problemas.length} alerta(s) não vão disparar como estão — resolva no cadastro da loja.`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
