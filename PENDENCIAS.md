# Pendências — o que depende de você

Estado em 2026-09-09, depois de aplicar os blocos 1 a 5 do `MELHORIAS.md`.

Duas categorias: **decisões** (escolhi um caminho e preciso da sua confirmação) e
**ações no ambiente** (não tenho como executar daqui). Nada aqui bloqueia o código, que
está pronto e verificado — mas alguns itens bloqueiam o *deploy*.

---

# ✅ Respondido em 2026-09-21

O que você decidiu, e o que foi feito com cada resposta.

| Item | Sua resposta | O que ficou |
|---|---|---|
| **A-01** chave do agent | "me dá o manual" | Passo a passo em `scripts/dash_Plaza/07-chave-do-agent.md`. **Continua sendo você quem executa** — sem isso a coleta para depois do deploy. |
| **A-02** senhas de produção | "ainda não distribuímos acesso; tem que ter na tela como fazer" | A tela existe: menu lateral → **Trocar senha**. O endereço do sistema e essa instrução saem no CSV de acessos. Trocar a senha do `admin` continua pendente. |
| **A-03** broker MQTT | "como faço isso?" | Passo a passo em `scripts/dash_Plaza/08-fechar-broker-mqtt.md`. |
| **A-04** firewall | "não posso ligar agora" | **Removido da lista.** Risco aceito conscientemente: sem filtragem de entrada no servidor do shopping. Reavaliar quando a infra permitir. |
| **A-05** backup | "teste depois; qual o melhor destino?" | Recomendação em `scripts/dash_Plaza/09-destino-do-backup.md`: Cloudflare R2 (você já tem conta), com cópia semanal para o servidor do shopping pela Tailscale. Criptografar antes de enviar. |
| **A-06** `RUN_SEED=1` | "você pode fazer isso?" | Não pelo painel do Coolify (a rede corporativa bloqueia). **Resolvido no código:** o seed agora não faz nada em banco já populado e sai com sucesso — `RUN_SEED=1` deixou de sujar o log. |
| **A-07** `COOLIFY_TOKEN` | "não vou rotacionar" | **Removido da lista.** Risco aceito: o token foi transmitido ao appliance Fortinet numa tentativa com `curl -k`. |
| **A-08** `graphify-out` | "pode fazer" | Feito — saiu do versionamento no commit `17895d9`. |
| **D-02** `/api/ingest` | "sim" | Rota confirmada sem uso. `INGEST_API_KEY` removida do código, do compose, do CI e do `.env.example`. |
| **D-05** tensão nominal | "não tenho certeza ainda" | Mantido 220 V, configurável em `TENSAO_NOMINAL`, limite como desvio em volts. **Confirme quando souber.** |
| **D-06** alertas | "pode ser apenas visual, sem e-mail" | Feito. O disparo é gravado e aparece na tela do lojista ("Disparou há 2 h" + histórico). E-mail volta com `ALERTA_EMAIL=1` e SMTP configurado. |
| **D-07** offline em 10 min | "isso mesmo" | Mantido. |
| **D-09** alertas corrompidos | "pode ver pra resolver" | **A corrupção não existe.** `alerts.store_id` tem chave estrangeira para `stores` desde o commit inicial: o Postgres recusava, e o efeito real era não conseguir criar alerta nenhum pela tela (erro 500). No lugar do script de correção entrou `npm run verificar:alertas`, que mostra os alertas que nunca vão disparar (loja sem relógio, horário não cadastrado, pausado). |
| **D-10** senha provisória | "não precisa" | Usuários atuais ficam como estão. |
| **Acessos em lote** | "cria um usuário por relógio e me entrega um CSV" | `npm run criar:lojistas` cria um acesso **por loja** (o relógio pertence à loja, e é a loja que fatura — a Loja 13, com dois relógios, é um acesso só) e gera o CSV com usuário, senha, relógios e endereço. O administrador edita nome e e-mail depois, pela tela. |

**Um defeito encontrado ao fazer isso:** as contagens em subconsulta estavam todas
zeradas — "lojas por inquilino", "usuários por inquilino" e "medidores por loja" na tela
de Lojas. O drizzle renderiza `${tabela.coluna}` sem o nome da tabela dentro de um `sql`
de SELECT, e a correlação virava uma comparação de duas colunas do próprio subselect:
sempre falsa, sem erro nenhum. Sete ocorrências corrigidas.

---

# 🔴 Antes de subir para produção

## D-01 — ✅ Resolvido em 2026-09-14: acesso por vínculo usuário↔loja

O acesso do lojista deixou de vir do inquilino. Agora é a tabela `user_stores`: o
administrador marca, na tela **Lojistas e acessos**, quais lojas (ou relógios) cada
login enxerga. Ninguém vê nada que não tenha sido vinculado a ele.

**Efeito no deploy:** os lojistas que já existem em produção entram **sem loja nenhuma**
até o administrador vincular — a tela avisa "Nenhuma loja vinculada ao seu acesso". Isso
é intencional (é o oposto do risco descrito abaixo). Antes de entregar logins, vincule as
lojas de cada um. `db:push` cria a tabela sozinho; não há migração de dado.

<details><summary>Descrição original do problema</summary>

**Isto era o mais importante desta lista.**

Hoje, em produção, **as 40 lojas estão sob um único inquilino** (`session-notes.md`,
13/08). O código antigo resolvia "a loja do lojista" pegando a **primeira loja do
inquilino** — errado, mas com um efeito colateral que escondia o problema: cada lojista
via uma loja só.

O código novo respeita o modelo de verdade: um lojista enxerga **todas as lojas do
inquilino dele**, com um seletor no topo da tela. Com os dados de produção como estão,
isso significa que **qualquer lojista passa a ver o consumo e as faturas das 40 lojas**.

Não é regressão de segurança em relação ao modelo — é o modelo aplicado a um cadastro
que ainda não foi feito. Mas o efeito prático é grave.

**Opções:**

| Caminho | O que envolve |
|---|---|
| **A. Separar os inquilinos antes do deploy** (recomendado) | Criar um inquilino por lojista real na tela nova, mover cada loja para o inquilino certo e vincular o usuário. É o cadastro que nunca foi feito. |
| **B. Adiar o deploy do vínculo** | Deixo o comportamento antigo (primeira loja) até o cadastro estar pronto. Continua errado para quem tem duas lojas, mas não expõe nada. |
| **C. Deploy assim mesmo** | Só se os logins de lojista ainda não foram entregues a ninguém. |

**Preciso saber qual.** Enquanto não me disser, não recomendo subir.

</details>

---

## D-02 — Confirmar que ninguém publica em `POST /api/ingest`

Removi a rota (`ROB-04`): era um caminho de **escrita de leituras** — a origem do número
que vira fatura — que ninguém usava e ninguém monitorava. O README já a registrava como
sem uso, e a sincronização real é por WebSocket pull.

**Confirme que nenhum script, integração ou teste externo posta nessa rota.** Se postar,
eu devolvo a rota (agora com gravação idempotente).

---

## D-03 — Mudança de schema com dados de faturamento no banco

Este bloco acrescenta colunas: `users.senha_provisoria`, `users.ultimo_login`,
`stores.horario_abertura/fechamento`, `stores.deleted_at`, `meters.deleted_at`,
`readings.anomalia`, e quatro em `billing_cycles` (`pago_em`, `pago_por`, `reaberturas`,
`reaberto_em`).

São todas **adições** — nenhuma remoção. Mas o deploy usa `drizzle-kit push --force`, que
aplica alteração destrutiva sem perguntar (`ROB-07`), e agora existe dado real.

**Faça o dump manual antes** (`scripts/dash_Plaza/06-backup-e-restauracao.md`). Confirmado
isso, pode subir.

---

## D-04 — Converter `readings` em hypertable é uma janela de manutenção

O `db:timescale` roda no `migrate` a cada deploy e é idempotente. Mas a **primeira**
execução move os dados existentes para os chunks e segura um lock na tabela enquanto
isso acontece.

Com ~118 mil linhas/dia desde agosto, deve ser rápido — mas não é instantâneo, e é a
tabela que a coleta escreve a cada 10 segundos.

**Confirme:** rodar junto com um deploy normal, ou numa janela combinada? Se preferir
adiar, é só não deixar o `db:timescale` no comando do `migrate` — o sistema funciona sem.

---

# 🟡 Decisões de regra de negócio

## D-05 — O alerta de tensão passou a usar o número que o lojista digita

Antes a faixa era `205–235 V` fixa no código e o `limite` do formulário **não era usado
para nada**. Agora `limite` é o **desvio máximo em volts** em torno de 220 V — com
`limite = 15` você reproduz exatamente a faixa antiga.

- Confirma que a tensão nominal do shopping é **220 V**? (é `TENSAO_NOMINAL`, configurável)
- Prefere desvio em volts, ou em percentual?

## D-06 — Um aviso por alerta a cada 24 horas

A query de alertas estava quebrada e **provavelmente nenhum alerta jamais disparou**.
Corrigida, ela dispararia a cada 5 minutos enquanto a condição durasse — 288 e-mails por
dia. Coloquei uma janela de 24 h (`ALERTA_REENVIO_HORAS`).

**24 h é o intervalo certo?** Para consumo mensal parece bem; para tensão fora do padrão,
talvez você queira saber mais cedo.

## D-07 — Medidor vira "offline" após 10 minutos sem leitura

O ciclo de coleta é de 30 s e o pull da VPS é de 10 s. 10 minutos (`MEDIDOR_OFFLINE_MIN`)
dá margem para uma queda curta sem alarme falso. **Muito ou pouco?**

## D-08 — Retenção de leitura crua: desligada

Deixei **sem** política de retenção: a leitura crua é a prova de origem da fatura, e
descartá-la só faz sentido quando houver um agregado diário consolidado — que ainda não
existe. A compressão (dados com mais de 30 dias) está ligada.

**Quer definir um prazo de descarte?** Se sim, precisamos construir o agregado antes.

## D-09 — Alertas existentes em produção estão apontando para o lugar errado

O formulário antigo mandava `storeId: user.id` — o id do **usuário** no lugar do id da
**loja**. Qualquer alerta criado pela tela em produção tem `alerts.store_id` corrompido e
nunca dispararia, mesmo com a query corrigida.

**Precisa de um script de correção?** Depende de quantos alertas existem hoje — não tenho
acesso ao banco de produção para conferir.

## D-10 — Usuários atuais e a senha provisória

Usuários criados de agora em diante entram com `senha_provisoria = true` e são obrigados
a trocar no primeiro acesso. Os **já existentes** ficaram com `false`, para não trancar
ninguém para fora no deploy.

**Quer que eu marque o `admin` e os `loja1..5` como provisórios**, forçando a troca? Seria
a forma mais limpa de fechar o `SEC-01` de uma vez.

---

# 🟢 Coisas que deixei de fora, e por quê

## D-11 — Recuperação de senha por e-mail

`GAP-01` previa `POST /auth/forgot-password`. **Não construí**: exige tabela de tokens,
expiração, e um canal SMTP funcionando — e o SMTP não está configurado (o `alertChecker`
só escreve no log). Construir um fluxo de recuperação que não consegue enviar e-mail seria
entregar uma porta que não abre.

O que existe hoje: o admin gera uma senha provisória nova na tela de Inquilinos.

**Configura o SMTP?** Com ele, faço o fluxo completo — e os alertas passam a chegar de verdade.

## D-12 — PDF da fatura gerado no servidor

`GAP-06` pedia PDF. Fiz o **demonstrativo em tela com botão de imprimir** (o navegador
gera o PDF), o que entrega a segunda via sem uma dependência nova no backend e sem servidor
de renderização.

**Se quiser PDF gerado no servidor** (com logo do shopping, envio por e-mail anexado),
é outra tarefa — me diga e eu faço.

## D-13 — Migrar para um runner de teste (vitest / node:test)

`QUA-01` pedia converter `testeFaturamento.ts` para um runner. **Não converti**: aquele
script é a única rede de proteção do cálculo de faturamento e está passando. Trocar o
runner é churn invisível com risco real de quebrar a rede enquanto ela é a única que existe.

O que fiz no lugar: **CI de verdade** (`.github/workflows/ci.yml`), que roda os dois
suites com Postgres a cada push e PR — que é o valor que o item buscava.

**Quer a migração para vitest mesmo assim?**

## D-14 — Cache do dashboard

`QUA-05` pedia cache no dashboard do admin. **Não fiz**: com a hypertable, a varredura
ficou muito mais barata, e cache num painel de faturamento tem efeito colateral chato —
o admin fecha o mês, aperta F5 e vê número velho.

**Se o painel ficar lento com o volume real, eu coloco** (com invalidação no fechamento).

---

# ⚙️ Ações no ambiente (do Bloco 2, ainda abertas)

Estas continuam exatamente como estavam — nenhuma pode ser feita por código.

| # | Ação | Onde | Consequência de não fazer |
|---|---|---|---|
| **A-01** | Gerar a chave do agent (`openssl rand -base64 32`) e pôr em `API_KEY` (NSSM, **primeiro**) e `AGENT_API_KEY` (Coolify) | shopping + Coolify | **A coleta para** depois do deploy. A falha é explícita no log, mas é parada real. |
| **A-02** | Trocar as senhas de produção (`SET_PASSWORD_EMAIL`/`SET_PASSWORD_VALUE`, redeploy, limpar o valor) | Coolify | `admin123` segue ativa, com o sistema público |
| **A-03** | Fechar o broker: `mosquitto_passwd` para `coletor` e `agent`, copiar `mosquitto.producao.conf` + `aclfile`, preencher `MQTT_USER`/`MQTT_PASS` | shopping | Qualquer máquina da rede publica leitura forjada e altera fatura |
| **A-04** | Ligar o firewall do Windows (`SEC-04`) | shopping | Sem filtragem de entrada; 1433, TeamViewer e AnyDesk expostos |
| **A-05** | Definir destino **externo** para o backup e testar uma restauração cronometrada | VPS | Backup só existe na máquina que pode se perder |
| **A-06** | `RUN_SEED` de volta para `0` (`OPS-01`) | Coolify | Log sujo a cada deploy, mascarando erro real de seed |
| **A-07** | Rotacionar o `COOLIFY_TOKEN` (`OPS-03`) | Coolify | Token exposto ao appliance Fortinet |
| **A-08** | `git rm -r --cached graphify-out` no commit | repo | ~7 mil linhas de JSON gerado versionadas |

---

# 📌 Detalhes menores, sem urgência

- **`CORS_ORIGIN=*` continua como default** no `.env.example` (`SEC-07`). Em produção já
  está o domínio certo; o default do repositório é que ainda convida ao erro no próximo
  ambiente.
- **`INGEST_API_KEY` continua no `docker-compose.coolify.yml`** e na validação de env
  (agora opcional). Com a rota removida, a variável não serve mais para nada — dá para
  limpar no mesmo commit em que você confirmar o **D-02**.
- **`docker-compose.prod.yml`** (VPS limpa) não recebeu o serviço de backup nem a imagem
  fixada; só o `coolify.yml`, que é o que está no ar. Se aquele arquivo ainda for usado,
  me diga que eu igualo.
- **7 medidores sem coleta por problema físico** (Quiosque 08, Substação, Loja 28, Loja
  29, My Pop, Quiosque 09, Cinema). Com o `BUG-04` corrigido, eles vão aparecer como
  offline no painel — o que é o comportamento certo, mas é bom você saber antes de abrir
  a tela e levar um susto.
