# Auditoria do sistema — Guarus Plaza

Levantamento de 2026-09-09, somente leitura. Nada foi alterado.

Contexto que define a régua desta auditoria: **este sistema cobra dinheiro de lojista**.
Um número errado na tela não é incômodo de UX — é uma cobrança que o lojista vai
contestar, e uma contestação que o condomínio precisa conseguir reconstituir.

A pasta `scripts/dash_Plaza/` já documenta segurança (`SEC-xx`), robustez (`ROB-xx`),
infraestrutura (`INF-xx`) e pendências operacionais (`OPS-xx`). Este documento **não
repete** o que está lá: referencia. O que ele acrescenta são os defeitos de **lógica de
negócio e de produto** — a parte que faz o sistema mostrar um número e o faturamento
mostrar outro.

Legenda de esforço: **P** = até meio dia · **M** = 1 a 3 dias · **G** = mais que isso.

---

> **Blocos 1 a 5 aplicados em 2026-09-09.** As decisões e ações que dependem de você
> estão em **[`PENDENCIAS.md`](PENDENCIAS.md)** — leia o `D-01` antes de qualquer deploy.

## Status

**Bloco 1 aplicado em 2026-09-09** — `BUG-01` a `BUG-05` corrigidos e verificados contra
banco real (24 checagens: 14 em `npm run teste:faturamento`, 10 numa verificação
descartável de ingestão e status de medidor).

**Bloco 2 aplicado em 2026-09-09, pela metade que é código** — `SEC-08`, `SEC-09` e o
novo `SEC-10` estão fechados. `SEC-01`, `SEC-02`, `SEC-03` e `INF-05` tiveram o código e
a configuração preparados, mas **só se completam com ação no ambiente**: trocar senha em
produção, gerar e distribuir a chave do agent, instalar o `mosquitto.producao.conf` no
servidor do shopping e definir o destino externo do backup. Ver a lista de pendências em
`session-notes.md`.

`SEC-04` (firewall do servidor do shopping) é inteiramente operacional e continua aberto.

**Blocos 3, 4 e 5 aplicados em 2026-09-09** — `GAP-01` a `GAP-07` e `QUA-01` a `QUA-05`.
Verificados contra banco real: 14 checagens de faturamento, 20 de autorização, mais um
ponta a ponta dos fluxos novos (cadastro, fechamento, reabertura, alertas).

Quatro itens ficaram parcialmente entregues, por decisão explicada em `PENDENCIAS.md`:
`GAP-06` (PDF por impressão, não gerado no servidor — `D-12`), `QUA-01` (CI construído,
runner de teste não migrado — `D-13`), `QUA-02` (código pronto, conversão em produção
pendente — `D-04`) e `QUA-05` (sem cache de dashboard — `D-14`).

Recuperação de senha por e-mail (`GAP-01`, item 3) não foi construída: depende de SMTP,
que não está configurado — ver `D-11`.

---

# P0 — número errado, dado perdido ou acesso indevido

## BUG-01 — O dashboard do lojista mostra um número que não é o consumo dele ✅ APLICADO

**Esforço: M**

### Problema

`frontend/src/pages/lojista/DashboardLojista.tsx` tem quatro defeitos empilhados na
mesma tela:

1. **Janela de data fixa em julho de 2026** (linha 22):
   `?from=2026-07-01T00:00:00Z&to=2026-07-31T23:59:59Z`. Hoje é setembro. A tela do
   lojista está congelada num mês que já passou — e julho é justamente o mês sem coleta.
2. **Subtração invertida** (linha 28):
   `readings[readings.length - 1].kwh - readings[0].kwh`. A API devolve `ORDER BY time
   desc` (`backend/src/modules/readings/routes.ts:44`), então o último item do array é a
   leitura **mais antiga**. A conta é `antiga − recente` → **valor negativo**.
3. **Mistura medidores diferentes.** A rota agrega todos os medidores da loja num único
   array ordenado por tempo. A "Loja 13" tem dois medidores; a subtração pega o kWh de
   um e subtrai do outro. Acumuladores diferentes, resultado sem significado físico.
4. **Teto de 1000 leituras.** A rota limita a 1000 registros. A 30 s por leitura, isso
   é cerca de 8 horas — nunca um mês. O rótulo diz "Consumo do mês".

O gráfico tem o mesmo problema: `readings.slice(-24)` (linha 33) pega os 24 registros
do **fim** do array, que são os mais antigos, e o título diz "Últimas 24 horas". São,
na verdade, ~12 minutos de dados velhos.

### Impacto

O lojista abre o painel e vê um número negativo, zero, ou um valor sem relação com a
fatura que vai receber. É o pior tipo de defeito neste sistema: destrói a confiança no
faturamento antes mesmo de haver discussão sobre o valor.

### Solução

1. Criar no backend uma rota de **agregado**, não de leituras cruas:
   `GET /api/readings/:storeId/resumo?ano=&mes=`, que reusa `medirConsumo()` de
   `backend/src/modules/billing/calculo.ts` — a mesma função que fecha a fatura.
   Devolver `{ consumoKwh, amostras, lacunaMaiorMin, leituraInicial, leituraFinal }`.
2. Criar `GET /api/readings/:storeId/serie?de=&ate=&passo=1h`, com agregação por
   `time_bucket` (ou `date_trunc`) **por medidor**, somando os incrementos — nunca
   devolvendo 1000 linhas cruas para o navegador somar.
3. No frontend, trocar a janela fixa pelo mês corrente calculado em `America/Sao_Paulo`,
   e trocar as duas contas locais pelos campos que a API já devolve.
4. Manter a rota de leituras cruas só para diagnóstico do admin.

> **Regra que evita a recaída:** consumo só é calculado em um lugar — `medirConsumo()`.
> Nenhuma tela recalcula.

---

## BUG-02 — A estimativa em reais usa uma tarifa inventada ✅ APLICADO

**Esforço: P**

### Problema

`DashboardLojista.tsx:68`: `R$ {(currentKwh * 0.85).toFixed(2)}`. O `0,85` é literal no
código. A tabela `tariffs` existe, tem vigência por faixa de data, e o fechamento a usa
corretamente — mas a tela do lojista ignora tudo isso.

### Impacto

O lojista vê "Estimativa do mês: R$ X" e recebe uma fatura com valor diferente. Se a
tarifa real for maior, ele vai alegar que o sistema prometeu outro número.

### Solução

1. Expor `GET /api/tariffs/vigente` (leitura, autenticada) devolvendo a tarifa em vigor
   hoje.
2. Calcular a estimativa no backend, dentro da rota de resumo do BUG-01, usando
   `faixasTarifarias()` — a mesma função do fechamento.
3. Rotular explicitamente na tela: "Estimativa — valor final apurado no fechamento do
   mês".

---

## BUG-03 — Uma leitura repetida trava a sincronização e o dado começa a se perder ✅ APLICADO

**Esforço: M**

### Problema

Encadeamento em `backend/src/modules/agentSync/index.ts`:

- `processReadings()` insere leitura por leitura com `db.insert(readings)` (linha 84),
  **sem `onConflictDoNothing()`**. A PK é `(meter_id, time)`, então uma leitura repetida
  lança exceção.
- A exceção sobe para o `try/catch` do handler de mensagem, que só faz `console.error`.
  **O `ack` da linha 39 nunca é enviado.**
- Sem `ack`, o agent não remove nada do buffer (`agent/src/index.ts`, caso `'ack'`). O
  próximo `pull`, 10 segundos depois, devolve exatamente o mesmo lote — que falha de
  novo. **Laço infinito, com a coleta parada.**

A repetição não é hipótese remota: o `pull` dispara a cada 10 s por `setInterval`
independentemente de o lote anterior ter terminado, e processar 500 leituras custa
**1.000 idas ao banco** (um `SELECT` de medidor + um `UPDATE` de `lastSeen` por
leitura). Se um ciclo passar de 10 s, o ciclo seguinte puxa o mesmo lote.

E há uma segunda perda embutida: quando o buffer do agent chega a 5.000, ele grava o
excedente em disco (`saveToQueue`) — mas **`loadFromQueue()` nunca é chamada em lugar
nenhum**. É código morto. O que vai para `agent/queue/` não volta nunca.

### Impacto

Coleta parada sem alarme (nada marca medidor como offline — ver BUG-04), e leituras
perdidas de forma definitiva depois de ~1 h de fila cheia. Ambos aparecem só no
fechamento do mês, como `requer_revisao` — quando já não há como recuperar o dado.

### Solução

1. `db.insert(readings).values(lote).onConflictDoNothing()` — inserção em lote único,
   idempotente por construção.
2. Carregar o mapa `macAddress → meterId` uma vez por lote (um `SELECT ... WHERE
   mac_address = ANY(...)`), eliminando o N+1.
3. `UPDATE meters SET last_seen = ..., status = 'online' WHERE id = ANY(...)` uma vez
   por lote, não por leitura.
4. Trocar o `ack` por contagem pelo `ack` por **marca d'água** (timestamp/ID da última
   leitura confirmada). Contagem quebra quando o buffer é truncado por overflow entre o
   `pull` e o `ack` — o `splice(0, count)` remove itens errados.
5. Chamar `loadFromQueue()` no boot do agent e após reconexão, devolvendo os lotes de
   disco ao buffer.
6. Não disparar novo `pull` enquanto o anterior não foi confirmado.

---

## BUG-04 — Nenhum medidor nunca fica offline ✅ APLICADO

**Esforço: P**

### Problema

`status` só é escrito com o valor `'online'`, em dois lugares
(`agentSync/index.ts:95` e `ingest/routes.ts:39`). **Não existe no projeto nenhum código
que grave `'offline'`.** O dashboard conta `where status = 'offline'`
(`admin/routes.ts:18`) — um contador que é permanentemente zero.

É por isso que o painel mostra "41 de 41 online" enquanto sete medidores estão
fisicamente sem coleta (Quiosque 08, Substação, Loja 28, Loja 29, My Pop, Quiosque 09,
Cinema — `session-notes.md`).

### Impacto

O sistema é cego para a própria falha. A operação descobre que perdeu um mês de coleta
no dia do fechamento, não no dia em que o medidor caiu. Para um sistema de faturamento,
detectar a lacuna **enquanto ainda dá para corrigir** é metade do produto.

### Solução

1. Job periódico (a cada 5 min, junto do `alertChecker`):
   `UPDATE meters SET status = 'offline' WHERE last_seen < now() - interval '10 minutes'`.
2. Card "medidores sem comunicação" no dashboard admin, com a lista e o tempo desde a
   última leitura — não só a contagem.
3. Alerta por e-mail ao admin quando um medidor cruza o limite (reusar o canal do
   `alertChecker`).
4. Na tela de Medidores, colorir a linha por `lastSeen`, não por `status`.

---

## BUG-05 — O dashboard do admin e a fatura calculam consumo de formas diferentes ✅ APLICADO

**Esforço: P**

### Problema

`backend/src/modules/admin/routes.ts:24` e `:31` ainda usam
`max(kwh) - min(kwh)` — exatamente o cálculo que o faturamento abandonou por produzir
cobrança errada (documentado no cabeçalho de `billing/calculo.ts`). A mesma fórmula
antiga está em `jobs/alertChecker.ts:55`.

Junto com isso, o mês é calculado com `new Date(now.getFullYear(), now.getMonth(), 1)`
(`admin/routes.ts:14` e `alertChecker.ts:29`) — hora local do processo. É o mesmo bug de
fuso já corrigido no faturamento.

### Impacto

Uma leitura corrompida, um medidor zerado ou uma troca de equipamento fazem o ranking do
dashboard divergir da fatura. O admin fecha o mês, compara com o que via na tela e
encontra números diferentes — sem nenhuma explicação disponível.

### Solução

1. Substituir as duas ocorrências por `medirConsumo()` + `limitesDoMes()`.
2. Para o dashboard, criar uma agregação diária (view materializada ou
   `continuous aggregate` do Timescale) atualizada de hora em hora — soma de incrementos
   por medidor por dia. Assim o painel não paga o custo do cálculo completo a cada
   `F5` e ainda usa a mesma regra da fatura.
3. Remover o `limit(50)` antes da agregação por loja: com o crescimento do parque, ele
   trunca lojas do ranking silenciosamente.

---

## SEC-08 — Lojista enxerga o parque inteiro de medidores e qualquer loja ✅ APLICADO

**Esforço: P**

### Problema

- `backend/src/modules/meters/routes.ts` — `GET /api/meters` exige apenas
  `authenticate`, **sem filtro de tenant**. Qualquer lojista autenticado lista os 41
  medidores, com IP, MAC, número de série e firmware.
- `backend/src/modules/stores/routes.ts` — as três rotas (`/:id/consumption`,
  `/:id/hourly-profile`, `/:id/billing`) fazem `SELECT * FROM stores WHERE id = :id` e
  devolvem a loja inteira para qualquer autenticado: nome, metragem, datas de contrato.
  (E o "consumo" que elas prometem nunca foi implementado — devolvem
  `{ message: 'consumption endpoint' }`.)

As rotas de `readings` e `billing` **já foram corrigidas** para resolver a loja pelo
tenant do usuário. Estas duas ficaram para trás.

### Impacto

Vazamento de dados comerciais entre lojistas concorrentes do mesmo shopping (metragem e
vigência de contrato são informação sensível), e mapa completo da rede de medidores nas
mãos de qualquer credencial de lojista.

### Solução

1. `GET /api/meters` → exigir `requireAdmin`, ou filtrar por
   `meters.storeId IN (lojas do tenant)` quando o papel for lojista.
2. Deletar `backend/src/modules/stores/routes.ts` e o registro em `index.ts`: são três
   stubs que nenhuma tela consome (o frontend não chama `/api/stores`). Superfície de
   ataque sem contrapartida.
3. Escrever teste de autorização para cada rota (ver QUA-01) — os furos corrigidos em
   `readings` e `billing` não têm regressão que os proteja.

---

## SEC-09 — Login sem limite específico de tentativas ✅ APLICADO

**Esforço: P**

### Problema

O `rate-limit` é global: 100 requisições por minuto por IP (`backend/src/index.ts`).
`POST /api/auth/login` herda esse limite — 100 tentativas de senha por minuto, 144 mil
por dia, contra senhas que hoje têm 8 caracteres e mínimo de 6 no schema.

### Impacto

Força bruta viável contra uma conta `admin` que fecha faturamento.

### Solução

1. `rateLimit` dedicado na rota de login: 5 tentativas por minuto por IP **e** por
   e-mail.
2. Contador de falhas por usuário com bloqueio temporário progressivo.
3. Elevar o mínimo de senha para 10 caracteres em `loginSchema` e no `setPassword`.
4. Comparar `INGEST_API_KEY` com `crypto.timingSafeEqual` em vez de `!==`
   (`ingest/routes.ts:12`).

---

## SEC-10 — Atrás do nginx, todo cliente tem o mesmo IP ✅ APLICADO

**Esforço: P** · *encontrado ao aplicar o `SEC-09`, em 2026-09-09*

### Problema

`Fastify({ logger: true })` não configurava `trustProxy`. A API só recebe conexão do
container do nginx, então `request.ip` era **o IP do nginx para todo mundo** — o cabeçalho
`X-Forwarded-For`, que o nginx já preenchia corretamente, era ignorado.

### Impacto

Dois controles que pareciam existir não existiam:

- o `rate-limit` global de 100 req/min era um balde **único**, compartilhado pelo shopping
  inteiro — bastava um cliente ativo para consumir a cota de todos;
- o freio de login do `SEC-09`, se aplicado sem esta correção, bloquearia **todos os
  lojistas** assim que uma pessoa errasse a senha cinco vezes. Foi assim que o problema
  apareceu: na verificação, uma conta sem relação com o ataque também levou 429.

### Solução

`trustProxy` com uma **lista de faixas privadas**, não com contagem de saltos: o Fastify
percorre o `X-Forwarded-For` da direita para a esquerda e para no primeiro endereço fora
dessas faixas — o cliente real. Contagem de saltos quebra quando a topologia muda
(Traefik → nginx → api são dois saltos hoje); a lista, não.

Cabeçalho forjado pelo cliente não escapa: o proxy confiável acrescenta o IP verdadeiro
**depois** do valor forjado, e é nesse que a caminhada para. Verificado.

---

## INF-05 — Não existe backup do banco ⚠️ CÓDIGO PRONTO, FALTA CÓPIA EXTERNA

**Esforço: M**

### Problema

O volume `pgdata` do compose é a única cópia dos dados. Não há `pg_dump` agendado, não
há retenção, não há teste de restauração documentado em nenhum lugar do repositório nem
em `scripts/dash_Plaza/`.

O banco guarda o histórico de leituras que sustenta **toda** fatura já emitida.

### Impacto

Perda do volume = perda da base de cálculo de todas as cobranças. Sem trilha para
reconstituir uma contestação, e sem argumento em discussão contratual.

### Solução

1. Serviço de backup no compose (ou cron na VPS): `pg_dump` diário comprimido,
   retenção de 30 dias diários + 12 mensais.
2. Cópia **fora da VPS** — object storage ou outra máquina. Backup no mesmo disco não
   é backup.
3. Restauração testada uma vez, com o tempo medido, e o procedimento anotado em
   `scripts/dash_Plaza/`.
4. Antes de qualquer `db:push --force`, dump manual (ver ROB-07 — agora com dado real de
   faturamento no banco, o risco deixou de ser teórico).

---

## Já documentados — continuam abertos e continuam P0

| Código | O quê | Onde |
|---|---|---|
| `SEC-01` / `OPS-02` | `admin123` ativa em produção, publicada em repo público | `scripts/dash_Plaza/01-seguranca.md` |
| `SEC-02` | `API_KEY=guarus-local-agent-2026` no código e no compose (repo público) | idem |
| `SEC-03` | MQTT anônimo, sem TLS, sem ACL — dá para publicar leitura forjada | idem |
| `SEC-04` | Firewall do Windows desligado no servidor do shopping | idem |
| `ROB-07` | `drizzle-kit push --force` sem migrations versionadas | `02-robustez.md` |

`SEC-03` merece um reforço: `mosquitto/config/mosquitto.conf` versionado é
`listener 1883` + `allow_anonymous true`, **sem `bind_address`**. Quem instalar a partir
do repositório expõe o broker na rede inteira do shopping. O mínimo é
`listener 1883 127.0.0.1` no arquivo versionado, para que o default seja o seguro.

---

# P1 — o produto não entrega o que promete

## GAP-01 — Não há como cadastrar um lojista. Nem uma loja, pela tela. ✅ APLICADO

**Esforço: G**

### Problema

O sistema promete "cada lojista acompanha o consumo da sua loja". Hoje isso não é
possível, e não é por falta de configuração — falta código:

- **Não existe rota de tenants.** `tenants` só aparece num `count(*)` do dashboard.
  Não há `POST /admin/tenants`, nem listagem.
- **Não existe rota de usuários.** Criar um login de lojista só é possível editando o
  `seed.ts` ou escrevendo no banco à mão.
- **Não existe troca de senha pela aplicação.** Só o utilitário
  `setPassword.ts`, acionado por variável de ambiente e redeploy.
- **O formulário de nova loja está quebrado.** `frontend/src/pages/admin/Stores.tsx:18`
  mantém `tenantId: ''` no estado, e **não há campo no formulário para preenchê-lo**. O
  backend valida `tenantId: z.string().uuid()`, então o POST sempre falha. E `metragem`
  vai como string para um `z.number()`. O `catch` não existe: o `finally` só desliga o
  spinner, e o usuário vê o formulário fechar como se tivesse dado certo.

Por isso as 40 lojas foram cadastradas por script Python (`scripts/cadastra-medidores.py`)
e as 40 estão sob o mesmo tenant — o que faz qualquer lojista cair na primeira loja da
lista.

### Impacto

Metade do produto não existe. O sistema hoje é um painel de admin; a promessa ao lojista
não é entregável sem intervenção técnica a cada novo inquilino do shopping.

### Solução

1. CRUD de tenants (`GET/POST/PUT /api/admin/tenants`), com CNPJ, contato e status.
2. CRUD de usuários: criar lojista vinculado a um tenant, com senha inicial gerada e
   **troca obrigatória no primeiro acesso** (campo `senha_provisoria` em `users`).
3. `POST /api/auth/change-password` (autenticada, exigindo a senha atual) e
   `POST /api/auth/forgot-password` por e-mail — o canal SMTP já existe no projeto.
4. Trocar a relação: hoje o vínculo lojista→loja é `user.tenantId → primeira loja do
   tenant`. Precisa ser explícito — um tenant por lojista, ou uma tabela
   `user_stores`. Enquanto for "primeira loja do tenant", um lojista com duas lojas vê
   só uma, sem aviso.
5. No formulário de loja: seletor de tenant (não campo de UUID), `metragem` convertida
   para número, e **exibição do erro da API** na tela.

---

## GAP-02 — A fatura esconde exatamente aquilo que a torna auditável ✅ APLICADO

**Esforço: M**

### Problema

O fechamento grava uma trilha completa: `leituraInicial`, `leituraFinal`, `amostras`,
`lacunaMaiorMin`, `anomaliasDescartadas`, `observacao`. É o que permite reconstituir uma
contestação. **Nenhum desses campos aparece em tela alguma.**

Somando os defeitos da tela de faturamento (`frontend/src/pages/admin/Billing.tsx`):

- **O nome da loja não é exibido.** A tabela usa `b.storeNome`, mas `GET /admin/billing`
  devolve `billingCycles` sem `join` com `stores`. Cai sempre no fallback
  `b.storeId.slice(0, 8)` — o admin lê fragmentos de UUID.
- **`requer_revisao` não é tratado.** O badge só conhece `pago` e `fechado`; o status
  mais importante do sistema aparece como texto cru em cinza, ao lado de um ícone de
  relógio, sem destaque nem explicação.
- **A mensagem de sucesso mente.** "X lojas fechadas" é exibido mesmo quando todas
  travaram em revisão. A API devolve `requerRevisao` na resposta; a tela ignora.
- **`pago` não existe.** O status está no código do frontend mas nunca é gravado —
  não há fluxo de pagamento nem baixa manual.
- **Fechar mês é irreversível e não avisa o que vai acontecer.** O `onConflictDoUpdate`
  reescreve ciclos já fechados sem checar o status: reexecutar o fechamento **sobrescreve
  faturas fechadas** com novos valores, silenciosamente. O `confirm()` do navegador diz
  "não pode ser desfeito", o que não é verdade — e o comportamento real é pior.
- **O fechamento não é transacional.** Um erro na loja 30 deixa 29 lojas fechadas e 11
  não, sem registro do que aconteceu.

### Impacto

O sistema fez o trabalho difícil (calcular certo, detectar lacuna, travar quando o dado
é incompleto) e joga fora o resultado na interface. Numa contestação, o operador não tem
o que mostrar. E uma reexecução acidental do fechamento reescreve faturas já enviadas.

### Solução

1. `GET /admin/billing` com `join` em `stores` (nome e número da loja).
2. Linha expansível na tabela com a trilha: leitura inicial → final, nº de amostras,
   maior lacuna, anomalias descartadas e a `observacao`.
3. Badge próprio para `requer_revisao` (âmbar, ícone de alerta) e um filtro "somente
   pendentes de revisão".
4. Resumo do fechamento honesto: "X fechadas, Y em revisão" com a lista dos motivos.
5. **Proteger ciclo fechado:** `onConflictDoUpdate` só quando `status <> 'fechado'`.
   Refazer um mês já fechado exige uma ação explícita de reabertura, registrada em log.
6. Envolver o laço de fechamento numa transação.
7. Fluxo de baixa: `POST /admin/billing/:id/pagar` gravando data e responsável — ou
   remover o status `pago` do frontend, se a cobrança acontece fora do sistema.

---

## GAP-03 — A sessão morre em 15 minutos, no meio do trabalho ✅ APLICADO

**Esforço: P**

### Problema

O JWT expira em 15 min (`JWT_EXPIRES_IN` default `15m`). Existe `POST /api/auth/refresh`
no backend — e **nenhuma chamada a ele no frontend** (busca por "refresh" em
`frontend/src` não retorna nada). O interceptor do axios reage ao 401 apagando o
`localStorage` e fazendo `window.location.href = '/login'`.

### Impacto

O admin abre a tela de faturamento, confere os números, clica em "Fechar Mês" 16 minutos
depois e é jogado para o login sem explicação, perdendo o contexto. O lojista sofre o
mesmo ao ler o histórico.

### Solução

1. Interceptor de resposta: no primeiro 401, chamar `/auth/refresh` e repetir a
   requisição original; só deslogar se o refresh também falhar.
2. Renovar proativamente quando faltar menos de 2 min para expirar.
3. Trocar o `window.location.href` por navegação do React Router preservando a rota de
   origem (`?redirect=`), para voltar ao lugar certo após o login.
4. Avaliar refresh token em cookie `httpOnly` — hoje o JWT vive em `localStorage`,
   exposto a qualquer XSS.

---

## GAP-04 — Alertas: um tipo que nunca dispara e os outros que repetem para sempre ✅ APLICADO

**Esforço: M**

### Problema

Em `backend/src/jobs/alertChecker.ts`:

- **`horario_sem_atividade` não está implementado.** O tipo é oferecido na tela
  (`Alertas.tsx`, "Desperdício Fora do Horário"), aceito pelo schema e gravado no banco —
  e o `alertChecker` não tem ramo para ele. O lojista configura um alerta que nunca vai
  disparar, e não tem como saber.
- **Sem deduplicação.** O job roda a cada 5 min e dispara o e-mail toda vez que a
  condição persiste. Um consumo acima do limite gera **288 e-mails por dia** até o fim do
  mês. `alert_logs` é gravado mas nunca consultado antes de enviar.
- **`tensao_fora_padrao` ignora o limite configurado** — usa 205/235 fixos no código,
  e o valor que o lojista digitou no formulário não é usado.
- **A query de leituras é suspeita:** `sql\`${readings.meterId} in ${meterIds}\``
  (linha 63) passa um array JS onde o Postgres espera uma lista. O próprio
  `calculo.ts` documenta que esse padrão não funciona e usa `= ANY(ARRAY[...])`.
  Provavelmente o job falha silenciosamente (o erro é engolido pelo `catch` do
  `setInterval` em `index.ts`) e **nenhum alerta jamais disparou**.
- **Só o primeiro usuário do tenant recebe.** `.limit(1)` em `checkAlerts()`.
- Média de FP e de tensão são calculadas sobre o mês inteiro — uma queda de tensão de
  uma hora nunca move a média o bastante para disparar.

### Impacto

O módulo de alertas — um dos três pilares anunciados na tela de login — provavelmente
nunca funcionou em produção, e ninguém percebeu porque a falha é silenciosa.

### Solução

1. Corrigir a query para `= ANY(...)` e **fazer o job registrar sucesso/falha em log
   visível**, não morrer em silêncio.
2. Implementar `horario_sem_atividade`: consumo fora da janela comercial da loja
   (exige campo de horário de funcionamento na loja) acima de um piso.
3. Deduplicação: consultar `alert_logs` e não reenviar o mesmo alerta antes de 24 h;
   enviar um "normalizado" quando a condição cessar.
4. Usar o `limite` configurado em todos os tipos, inclusive tensão.
5. Enviar para todos os usuários do tenant, ou adicionar `destinatarios` no alerta.
6. Janela de avaliação por tipo (FP e tensão nas últimas 24 h, consumo no mês).
7. Na tela, marcar quais tipos estão ativos de fato e permitir ligar/desligar o alerta
   (o campo `ativo` existe no banco e a rota `PUT` também — falta o botão).

---

## GAP-05 — Falha de API é invisível para quem está usando ✅ APLICADO

**Esforço: P**

### Problema

- `Stores.tsx` e `Alertas.tsx` fazem `POST` sem `catch`: erro nenhum chega à tela.
- `SEC-05` (já documentado): `<schema>.parse(request.body)` sem handler → **500** em vez
  de 400, com corpo genérico. Mesmo que o frontend tratasse, não haveria o que mostrar.
- `DashboardAdmin.tsx` e `Meters.tsx` não têm `.catch()` — se a API cair, a tela fica em
  branco com o spinner parado.

### Impacto

O operador não distingue "não funcionou" de "não fiz direito". É a causa de o cadastro de
loja parecer "silencioso" em vez de quebrado (GAP-01).

### Solução

1. Error handler global no Fastify: `ZodError` → 400 com a lista de campos inválidos;
   demais erros → 500 com ID de correlação no log.
2. Componente de toast/erro reaproveitável no frontend, alimentado pelo interceptor do
   axios.
3. `catch` em todo submit, exibindo a mensagem da API.
4. Estado de erro nas telas de listagem, com botão "tentar de novo".

---

## GAP-06 — O lojista não consegue levar a fatura embora ⚠️ APLICADO (PDF via impressão — ver D-12)

**Esforço: M**

### Problema

O botão "Exportar" de `frontend/src/pages/lojista/Historico.tsx` **não tem `onClick`** —
é decorativo. Não há segunda via, não há PDF, não há detalhamento por dia. A tela mostra
quatro colunas e nada mais.

O que o mercado de rateio de energia em shopping entrega como padrão: demonstrativo
mensal em PDF com leitura inicial/final, período, tarifa aplicada, consumo e valor;
comparativo com o mês anterior; e histórico exportável.

### Impacto

O lojista precisa pedir a via para o condomínio por e-mail — o sistema não elimina o
trabalho manual que justifica sua existência.

### Solução

1. `GET /api/billing/:cycleId/demonstrativo` gerando PDF com a trilha de auditoria do
   GAP-02.
2. Exportação CSV no histórico do lojista (o admin já tem — reaproveitar a função).
3. Comparativo com o mês anterior e com a média do shopping por m² (a `metragem` já está
   cadastrada e hoje não é usada para nada).

---

## GAP-07 — Faltam operações básicas de cadastro ✅ APLICADO

**Esforço: M**

### Problema

- **Não há `DELETE` de loja nem de medidor** em nenhuma rota. Corrigir um cadastro
  errado exige `PUT` reaproveitando o registro — foi o que precisou ser feito com as 5
  lojas do seed em produção.
- A tela de Medidores é **somente leitura**: a API tem `POST` e `PUT /admin/meters`, sem
  nenhuma interface. Vincular medidor a loja só por script.
- Não há tela de tarifas: `GET/POST /admin/tariffs` existem, e nada no frontend os
  consome. A tarifa que define toda a cobrança só entra por chamada direta à API.

### Impacto

Toda manutenção de cadastro depende de quem sabe chamar a API. O condomínio não opera o
sistema sozinho.

### Solução

1. `DELETE` com exclusão lógica (`deletedAt`) — nunca apagar registro que tenha leitura
   ou fatura associada.
2. Formulário de medidor (criar, editar, vincular a loja) na tela existente.
3. Tela de tarifas com histórico de vigência e aviso do impacto: "esta tarifa passa a
   valer em DD/MM e afeta o fechamento a partir dessa data".

---

# P2 — qualidade, custo e manutenção

## QUA-01 — Não há suíte de testes nem CI ⚠️ APLICADO (CI + testes; runner não migrado — ver D-13)

**Esforço: M**

### Problema

O único teste é `backend/src/utils/testeFaturamento.ts`: 201 linhas, rodado à mão por
`npm run teste:faturamento`, contra um banco real, com `console.log` no lugar de um
runner. É um bom teste — cobre os sete cenários que produzem cobrança errada — mas:

- não roda em lugar nenhum automaticamente (**não existe `.github/`** no repositório);
- não cobre **autorização** — os furos de isolamento por tenant corrigidos em `readings`
  e `billing` não têm nenhuma regressão que os proteja, e SEC-08 mostra que o mesmo erro
  se repetiu em outras rotas;
- não cobre o frontend, onde estão BUG-01 e BUG-02;
- `npm run lint` está declarado no `package.json` e nunca é executado.

### Impacto

Toda a garantia de correção do faturamento depende de alguém lembrar de rodar um script.

### Solução

1. Adotar `node:test` ou `vitest` (já há Vite no frontend) e converter
   `testeFaturamento.ts`, mantendo os cenários.
2. Testes de autorização, um por rota: lojista tentando ler loja alheia deve receber 403
   ou os próprios dados — nunca os do vizinho.
3. GitHub Actions: `typecheck` + `lint` + testes com Postgres de serviço, em push e PR.
4. Testes do frontend para as contas de consumo, com dados em ordem decrescente (o que
   pegaria o BUG-01 imediatamente).

---

## QUA-02 — `readings` cresce sem particionamento ⚠️ CÓDIGO PRONTO (execução em produção — ver D-04)

**Esforço: M** · reforça `ROB-01`

Com 41 medidores a cada 30 s são ~118 mil linhas/dia — 43 milhões ao ano. A imagem é
`timescale/timescaledb`, e `readings` continua uma tabela comum. A PK `(meter_id, time)`
já está no formato que o `create_hypertable` exige; falta o passo idempotente no
`migrate`, mais política de compressão (dado com mais de 7 dias) e retenção (leitura
crua com mais de 2 anos, mantendo o agregado diário para sempre — é o agregado que
sustenta a fatura antiga).

---

## QUA-03 — Código morto e coisas que enganam quem opera ✅ APLICADO

**Esforço: P**

| O quê | Onde | Por que remover |
|---|---|---|
| `VPS_URL` | `agent/src/index.ts:8` | Nunca usado; imprime no log que o agent conecta na VPS — o fluxo é o inverso (`ROB-05`) |
| `loadFromQueue()` | `agent/src/index.ts:42` | Nunca chamada — e é justamente ela que devolveria o dado da fila (BUG-03) |
| `seed70.ts` | `backend/src/utils/` | 166 linhas, nenhum script npm o referencia |
| `POST /api/ingest` | `backend/src/modules/ingest/` | Caminho de escrita de leituras que ninguém usa nem monitora (`ROB-04`) |
| `stores/routes.ts` | `backend/src/modules/` | Três stubs que devolvem `{ message: '... endpoint' }` (SEC-08) |
| `graphify-out/` | raiz | Saída de ferramenta versionada (~7 mil linhas de JSON) |
| campo `anomalia` | `collector/index.js` | O coletor marca `queda_acumulador` no payload e **nada no backend lê esse campo** — o sinal se perde antes de chegar à fatura |

O último merece atenção: o coletor detecta que o acumulador do medidor caiu (medidor
zerado ou trocado) e publica a marcação. `agentSync` e `ingest` descartam o campo. Vale
adicionar a coluna em `readings` e propagar para a `observacao` da fatura — é
exatamente a informação que explica um consumo estranho.

---

## QUA-04 — Endurecimento de infraestrutura ✅ APLICADO

**Esforço: P**

1. **Containers rodam como root** — `backend/Dockerfile` e `frontend/Dockerfile` não
   têm `USER node`.
2. **Imagem não fixada**: `timescale/timescaledb:latest-pg16` pode trocar de versão num
   rebuild qualquer. Fixar a tag completa.
3. **Sem `NODE_ENV=production`** na imagem final do backend.
4. **Sem cabeçalhos de segurança** no nginx: `X-Content-Type-Options`,
   `X-Frame-Options`, `Referrer-Policy` e um CSP mínimo (a app não usa script externo —
   dá para ser restritivo). Compressão gzip também não está ligada.
5. **`CORS_ORIGIN=*` como default** no `.env.example` e `origin: true` como fallback no
   código (`SEC-07`): trocar o default para exigir a variável.
6. **Sem healthcheck** nos serviços `frontend` e `nginx` do compose.
7. **Relógio do servidor do shopping**: o `timestamp` de cada leitura é gerado por ele
   (`collector/index.js`, `new Date().toISOString()`). Sem NTP conferido, um desvio de
   horário move consumo de um mês para outro e pode colidir com a PK. Vale checar
   `w32tm /query /status` e documentar.

---

## QUA-05 — Desempenho previsível ⚠️ APLICADO (sem cache de dashboard — ver D-14)

**Esforço: P**

1. **N+1 na ingestão** (BUG-03): 1.000 consultas por lote de 500 leituras, a cada 10 s.
2. **`GET /readings/:storeId` devolve até 1.000 linhas cruas** para o navegador — a
   agregação do BUG-01 resolve isso na origem.
3. **Índices**: as consultas de faturamento filtram por `meter_id` + intervalo de
   `time`. A PK `(meter_id, time)` cobre isso; o `idx_readings_time` isolado tem pouco
   uso e custa escrita a cada inserção. Reavaliar após a hypertable.
4. **Dashboard sem cache**: cada `F5` do admin varre o mês inteiro de leituras.

---

# Ordem sugerida de execução

**Bloco 1 — parar de perder dado e de mostrar número errado** (o que está acontecendo agora)
`BUG-03` → `BUG-04` → `BUG-01` → `BUG-02` → `BUG-05`

**Bloco 2 — fechar as portas** (rápido, e reduz risco imediato)
`SEC-08` → `SEC-09` → `SEC-01/OPS-02` → `SEC-02` → `SEC-03` → `INF-05`

**Bloco 3 — tornar o produto operável sem programador**
`GAP-01` → `GAP-02` → `GAP-05` → `GAP-03`

**Bloco 4 — completar a promessa**
`GAP-04` → `GAP-06` → `GAP-07`

**Bloco 5 — sustentação**
`QUA-01` → `QUA-02` → `QUA-03` → `QUA-04` → `QUA-05`

Cada bloco fecha com uma verificação em produção — não só o teste local.
