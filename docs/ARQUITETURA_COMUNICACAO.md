# Arquitetura de Comunicação - Guarus Plaza

## Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        REDE LOCAL DO SHOPPING                           │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       ┌──────────┐          │
│  │ Konect 1 │  │ Konect 2 │  │ Konect 3 │  ...  │ Konect 70│          │
│  │  (medidor)│  │  (medidor)│  │  (medidor)│       │  (medidor)│          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       └────┬─────┘          │
│       │              │              │                   │                │
│       └──────────────┴──────────────┴───────────────────┘                │
│                              │                                          │
│                          MQTT Broker                                    │
│                        (Mosquitto:1883)                                 │
│                              │                                          │
│                    ┌─────────▼─────────┐                               │
│                    │   AGENTE LOCAL    │                               │
│                    │  (servidor shop)  │                               │
│                    │                   │                               │
│                    │  • Coleta MQTT    │                               │
│                    │  • Armazena local │                               │
│                    │  • Expõe HTTP API │                               │
│                    └─────────┬─────────┘                               │
│                              │                                          │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
                          WebSocket (via Tailscale)
                     VPS conecta NO agente (o agente é o servidor WS)
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│                              │          VPS (nuvem)                     │
│                    ┌─────────▼─────────┐                               │
│                    │  BACKEND API      │                               │
│                    │  (Fastify:3001)   │                               │
│                    │                   │                               │
│                    │  • Agent Sync     │                               │
│                    │    (WebSocket)    │                               │
│                    │                   │                               │
│                    │  • Auth           │                               │
│                    │  • Admin API      │                               │
│                    │  • Lojista API    │                               │
│                    │  • Billing        │                               │
│                    │  • Alertas        │                               │
│                    └─────────┬─────────┘                               │
│                              │                                          │
│                    ┌─────────▼─────────┐                               │
│                    │    PostgreSQL     │                               │
│                    │   + TimescaleDB   │                               │
│                    │  (porta 5432)     │                               │
│                    └───────────────────┘                               │
│                              │                                          │
│                    ┌─────────▼─────────┐                               │
│                    │   FRONTEND SPA    │                               │
│                    │  (React:5173)     │                               │
│                    │   via Nginx:443   │                               │
│                    └───────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Dados

### 1. Coleta (MQTT)

```
Medidor Konect                          Mosquitto Broker
     │                                       │
     │  Publica a cada 30s                   │
     │  Tópico: konect/{MAC}/readings       │
     │  Payload: { device, timestamp,       │
     │            readings: {kwh, voltage,   │
     │            current, power, pf} }      │
     │──────────────────────────────────────►│
     │                                       │
```

**Formato do payload:**
```json
{
  "device": "AA:BB:CC:DD:EE:FF",
  "timestamp": "2026-07-15T14:30:00Z",
  "readings": {
    "kwh": 1250.45,
    "voltage": 220.3,
    "current": 45.2,
    "power": 9.95,
    "power_factor": 0.95
  },
  "status": "online"
}
```

### 2. Armazenamento Local (Agente)

```
Mosquitto                         Agente Local
     │                                   │
     │  konect/+/readings                │
     │──────────────────────────────────►│
     │                                   │
     │                     ┌─────────────┤
     │                     │  Buffer     │
     │                     │  (memória)  │
     │                     │  máx: 5000  │
     │                     └──────┬──────┘
     │                            │
     │                     Se buffer cheio:
     │                     salva em /queue/
     │                     (disco local)
     │                            │
```

**O agente NÃO envia para a VPS.** Ele apenas coleta e armazena.

### 3. Puxada VPS → Agente (WebSocket)

> ⚠️ **Correção:** o código real tem o **agente como servidor WebSocket**
> (`WebSocketServer` na porta 9200, em `agent/src/index.ts`) e a **VPS como
> cliente** (`agentSync/index.ts`, que conecta via `AGENT_WS_URL`). É a VPS
> quem abre a conexão TCP, não o agente. Isso só é viável sem expor porta
> nenhuma à internet pública porque os dois lados estão na mesma **tailnet**
> (Tailscale) - a "porta de entrada" do agente só existe dentro dessa rede
> privada, nunca na internet aberta.

```
VPS Backend                           Agente Local
     │                                       │
     │  ──── WebSocket Connection ──────────►│
     │  (VPS conecta, via IP da tailnet)     │
     │                                       │
     │  ←── Auth { apiKey } ────────────────│
     │  ──── Auth OK ──────────────────────►│
     │                                       │
     │  Cada 10 segundos:                    │
     │  ──── Pull { limit: 500 } ──────────►│
     │                                       │
     │  ←── Pull { readings[], count } ─────│
     │                                       │
     │  ──── Ack { count } ────────────────►│
     │  (agente limpa buffer)                │
```

**Por que WebSocket e não HTTP direto?**
- Shopping NÃO tem porta de entrada aberta **para a internet pública** (só dentro da tailnet)
- VPS pode "puxar" dados quando quiser via WebSocket persistente, sem reabrir conexão a cada request
- Tailscale elimina a necessidade de IP público, port-forward ou DDNS no shopping (a maioria dos links comerciais no Brasil usa CGNAT, onde port-forward nem seria possível)

### 4. Processamento (Backend)

```
Agent Sync (WebSocket)              PostgreSQL + TimescaleDB
     │                                       │
     │  Recebe batch de readings             │
     │                                       │
     │  Para cada reading:                   │
     │  • Busca medidor pelo MAC address     │
     │  • Insere na tabela readings          │
     │  • Atualiza lastSeen do medidor       │
     │                                       │
     │  ──── INSERT INTO readings ──────────►│
     │  ──── UPDATE meters SET status ──────►│
     │                                       │
     │  ←── Ack ao agente ──────────────────│
```

### 5. Consulta (Dashboard)

```
Browser (Admin/Lojista)              Backend API
     │                                       │
     │  GET /api/admin/dashboard             │
     │──────────────────────────────────────►│
     │                                       │
     │                     ┌─────────────────┤
     │                     │ Query:          │
     │                     │ • total lojas   │
     │                     │ • consumo total │
     │                     │ • top 10 lojas  │
     │                     │ • medidores off │
     │                     └────────┬────────┘
     │                              │
     │  ←── JSON response ─────────│
     │                                       │
```

---

## Fluxo Completo (Exemplo Real)

```
14:30:00  Medidor Loja 001 publica MQTT:
          konect/AA:BB:CC:DD:EE:FF/readings
          { kwh: 268.19, voltage: 220.3, ... }

14:30:01  Mosquitto recebe e roteia

14:30:01  Agente recebe, adiciona ao buffer
          Buffer: 1 reading

14:30:10  VPS envia Pull via WebSocket
          "Me manda os últimos 500 readings"

14:30:10  Agente responde com o batch
          { readings: [...], count: 45 }

14:30:10  VPS processa:
          - Busca medidor por MAC no BD
          - Insere 45 readings na tabela
          - Atualiza lastSeen dos medidores
          - Envia Ack ao agente

14:30:10  Agente limpa os 45 do buffer

14:30:15  Admin abre dashboard
          - Query: "qual o consumo de julho?"
          - Soma (max - min) por medidor
          - Agrupa por loja
          - Retorna JSON

14:30:15  Dashboard mostra gráfico
          Loja 001: 268.19 kWh | R$ 227.96
```

---

## Segurança

### Shopping (Agent)

| Porta | Serviço | Exposta? |
|-------|---------|----------|
| 1883 | Mosquitto | Interna (rede local do shopping) apenas |
| 9100 | HTTP API | Interna (rede local do shopping) apenas |
| 9200 | WebSocket | Só na tailnet (Tailscale) - alcançável pela VPS, não pela internet |
| nenhuma | porta pública na internet | **NÃO** |

**O shopping não expõe nenhuma porta para a internet pública.** A porta 9200
só é alcançável de dentro da rede privada do Tailscale, à qual só a VPS (e
outras máquinas autorizadas na tailnet) pertence.

### VPS

| Porta | Serviço | Exposta? |
|-------|---------|----------|
| 443 | Nginx (HTTPS) | Sim |
| 3001 | Backend API | Interna (via Nginx) |
| 5432 | PostgreSQL | Interna apenas |

### Autenticação

```
Agente → VPS:
  WebSocket Connection
  → Auth { apiKey: "guarus-local-agent-2026" }
  ← Auth OK

VPS → Agente:
  (nenhum, conexão já autenticada)

API Interna:
  JWT Token (login/email + senha)
  X-API-Key (ingest legacy)
```

---

## Por que Pull e não Push?

### Modelo Push (ANTES)
```
Agente → VPS: "Aqui estão os dados!"
Problema:
  • Agente decide quando enviar
  • VPS não pode pedir dados sob demanda
  • Dashboard não atualiza em tempo real
```

### Modelo Pull (AGORA)
```
VPS → Agente: "Me manda os dados!"
Vantagens:
  • VPS controla quando puxar
  • Dashboard pode atualizar sob demanda
  • Menos tráfego (só puxa quando precisa)
  • Mais segurança (porta do agente só existe dentro da tailnet, nunca na internet pública)
```

---

## Resiliência

### Se o agente perde conexão MQTT?
```
Medidor → ✗ Mosquitto (offline)
                │
                Agente continua rodando
                Buffer fica vazio
                Quando MQTT volta:
                medidor reconecta e publica
```

### Se a VPS fica offline?
```
VPS ← ✗ WebSocket (desconectado)
              │
              Agente continua coletando MQTT
              Buffer cresce em memória
              Se buffer cheio → salva em /queue/ (disco)
              Quando VPS volta → envia da fila primeiro
```

### Se a internet do shopping cai?
```
Agente ← ✗ WebSocket (desconectado)
              │
              MQTT continua funcionando local
              Medidores continuam publicando
              Agente salva em /queue/ (disco)
              Quando internet volta:
              agentSync reconecta e puxa fila
```

---

## Visualização do Lojista

### O que o Lojista Vê

O lojista acessa o painel com suas credenciais e visualiza apenas os dados da sua loja.

```
┌─────────────────────────────────────────────────────────────────┐
│                    DASHBOARD DO LOJISTA                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Consumo Mês │  │ Estimativa  │  │ Fator Potência│           │
│  │  268.2 kWh  │  │ R$ 227.96   │  │    0.95      │           │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐           │
│  │ Consumo Hora a Hora  │  │ Tensão (V)           │           │
│  │  [Gráfico de Linha]  │  │  [Gráfico de Barras] │           │
│  │                      │  │                      │           │
│  │  kWh ────────        │  │  V  ▐▐▐▐▐▐▐▐▐▐▐     │           │
│  │       ───────        │  │     ▐▐▐▐▐▐▐▐▐▐▐     │           │
│  │  14:00  15:00  16:00 │  │  200V ──── 240V      │           │
│  └──────────────────────┘  └──────────────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Funcionalidades Disponíveis

| Funcionalidade | Descrição |
|----------------|-----------|
| **Dashboard** | Consumo mensal, estimativa de valor, fator de potência |
| **Gráfico Consumo** | Linha do tempo com consumo kWh a cada hora |
| **Gráfico Tensão** | Barras com tensão instantânea (200-240V) |
| **Histórico** | Lista de faturas anteriores com status (pago/pendente) |
| **Alertas** | Configurar notificações de consumo anômalo |

### Fluxo de Dados do Lojista

```
Lojista abre Dashboard
        │
        ▼
GET /api/readings/{userId}?from=...&to=...
        │
        ▼
Backend busca readings dos medidores da loja
        │
        ▼
Retorna: [{ time, kwh, voltage, current, power, power_factor }]
        │
        ▼
Frontend calcula:
  • Consumo mês = max(kwh) - min(kwh)
  • Estimativa = consumo × tarifa (R$ 0.85/kWh)
  • Fator potência = média dos power_factor
```

### Configuração de Alertas

O lojista pode configurar alertas para:

| Tipo de Alerta | Lógica de Verificação |
|----------------|----------------------|
| **Consumo Mensal** | Se consumo_mês > limite → dispara |
| **Fator Potência** | Se fator_potência < 0.93 → dispara |
| **Tensão Fora** | Se tensão < 197V ou > 243V → dispara |
| **Desperdício** | Se consumo fora do horário comercial → dispara |

### Canais de Notificação

```
Alerta Dispara
     │
     ├──→ E-mail (SMTP)
     │    "Consumo da Loja 001 atingiu 500 kWh"
     │
     └──→ WhatsApp (futuro)
          "Loja 001: consumo acima do limite"
```

### Restrições de Acesso

```
Lojista NÃO pode:
  ✗ Ver dados de outras lojas
  ✗ Alterar tarifas
  ✗ Cadastrar lojas ou medidores
  ✗ Fechar faturamento
  ✗ Ver dados de inquilinos

Lojista PODE:
  ✓ Ver consumo da sua loja
  ✓ Ver histórico de faturas
  ✓ Configurar alertas
  ✓ Exportar dados (CSV)
```

```
                    Atual (70 medidores)
                    ───────────────────
                    1 agente local
                    1 WebSocket connection
                    Buffer: 5000 readings
                    Pull: a cada 10s

                    Futuro (300+ medidores)
                    ─────────────────────
                    1 agente local
                    1 WebSocket connection
                    Buffer: 10000 readings
                    Pull: a cada 5s
                    Ou: múltiplos agentes
```
