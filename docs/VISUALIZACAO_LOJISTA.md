o# Visualização do Lojista - Guarus Plaza

## Acesso

```
URL: https://dashboard.guarusplaza.com.br
Login: loja1@example.com
Senha: lojista123
```

---

## Dashboard

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ☰  Guarus Plaza                                               │
│     Lojista                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Meu Consumo                                                   │
│  Acompanhe o consumo da sua loja                               │
│                                                                 │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐  │
│  │ ⚡              │ │ $               │ │ ⚙️              │  │
│  │ 268.2 kWh      │ │ R$ 227.96       │ │ 0.95            │  │
│  │ Consumo do mês  │ │ Estimativa      │ │ Fator potência  │  │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘  │
│                                                                 │
│  ┌──────────────────────────┐ ┌──────────────────────────┐    │
│  │ Consumo Hora a Hora      │ │ Tensão                   │    │
│  │                          │ │                          │    │
│  │  kWh                     │ │  V                       │    │
│  │   ╲                      │ │  ▐▐▐▐▐▐▐▐▐▐▐            │    │
│  │    ╲____                 │ │  ▐▐▐▐▐▐▐▐▐▐▐            │    │
│  │         ╲___             │ │  ▐▐▐▐▐▐▐▐▐▐▐            │    │
│  │              ╲___        │ │  ▐▐▐▐▐▐▐▐▐▐▐            │    │
│  │                  ╲___    │ │  ▐▐▐▐▐▐▐▐▐▐▐            │    │
│  │  14:00  15:00  16:00     │ │  200V ──── 240V          │    │
│  │                          │ │                          │    │
│  │  Últimas 24 horas        │ │  Últimas 24 horas        │    │
│  └──────────────────────────┘ └──────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cards de Resumo

| Card | Valor | Cálculo |
|------|-------|---------|
| **Consumo Mês** | 268.2 kWh | `max(kwh) - min(kwh)` no mês |
| **Estimativa** | R$ 227.96 | `consumo × R$ 0.85/kWh` |
| **Fator Potência** | 0.95 | `média(power_factor)` |

### Gráfico de Consumo (Linha)

```
Eixo X: Hora do dia (14:00, 15:00, 16:00...)
Eixo Y: Consumo em kWh
Dados: Últimas 24 leituras do medidor
Cor: Verde (#22c55e)
```

### Gráfico de Tensão (Barras)

```
Eixo X: Hora do dia (14:00, 15:00, 16:00...)
Eixo Y: Tensão em Volts (200V - 240V)
Dados: Últimas 24 leituras do medidor
Cor: Verde (#22c55e)
Faixa ideal: 200V - 240V
```

---

## Histórico de Faturas

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Histórico de Faturas                           [Exportar]     │
│  3 faturas encontradas                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Período          Consumo        Valor          Status         │
│  ─────────────────────────────────────────────────────────────  │
│  📄 Julho/2026    268.19 kWh     R$ 227.96     ⏳ fechado     │
│  📄 Junho/2026    312.45 kWh     R$ 265.58     ✅ pago        │
│  📄 Maio/2026     289.33 kWh     R$ 245.93     ✅ pago        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Status das Faturas

| Status | Cor | Significado |
|--------|-----|-------------|
| `pago` | Verde | Fatura paga pelo lojista |
| `fechado` | Amarelo | Mês fechado, aguardando pagamento |
| `aberto` | Cinza | Mês em aberto, dados sendo coletados |

### Exportação CSV

O lojista pode exportar o histórico em formato CSV:

```csv
Período;Consumo (kWh);Valor (R$);Status
Julho/2026;268.19;227.96;fechado
Junho/2026;312.45;265.58;pago
Maio/2026;289.33;245.93;pago
```

---

## Alertas

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Alertas                                    [Novo Alerta]      │
│  2 alertas configurados                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚡  Consumo Mensal (kWh)                                │   │
│  │     Limite: 500 | email | ✅ Ativo                      │   │
│  │                                              🗑️        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚙️  Fator de Potência Baixo                             │   │
│  │     Limite: 0.93 | email | ✅ Ativo                     │   │
│  │                                              🗑️        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Formulário de Novo Alerta

```
┌─────────────────────────────────────────────────────────────────┐
│  Criar Novo Alerta                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tipo de Alerta          Limite              Canal              │
│  ┌─────────────────┐    ┌─────────────────┐ ┌──────────────┐  │
│  │ Consumo Mensal  │    │ 500             │ │ E-mail    ▼  │  │
│  └─────────────────┘    └─────────────────┘ └──────────────┘  │
│                                                                 │
│                                        [Salvar]                │
└─────────────────────────────────────────────────────────────────┘
```

### Tipos de Alerta

| Tipo | Descrição | Limite Padrão |
|------|-----------|---------------|
| **Consumo Mensal** | Alerta quando consumo ultrapassa limite | 500 kWh |
| **Desperdício Fora do Horário** | Alerta quando há consumo fora do horário comercial | Automático |
| **Fator de Potência Baixo** | Alerta quando fator de potência cai abaixo do ideal | 0.93 |
| **Tensão Fora do Padrão** | Alerta quando tensão está fora da faixa (197-243V) | Automático |

### Canais de Notificação

| Canal | Status | Descrição |
|-------|--------|-----------|
| **E-mail** | ✅ Disponível | Envia e-mail com detalhes do alerta |
| **WhatsApp** | 🔜 Futuro | Envia mensagem via WhatsApp |

---

## Fluxo de Dados

### Coleta de Dados

```
Medidor Konect (Loja 001)
     │
     │ Publica a cada 30 segundos
     │ konect/AA:BB:CC:DD:EE:FF/readings
     │ { kwh: 268.19, voltage: 220.3, ... }
     │
     ▼
Mosquitto Broker (local)
     │
     ▼
Agente Local (servidor shopping)
     │
     │ Armazena em buffer
     │
     ▼
VPS Backend (a cada 10 segundos)
     │
     │ Puxa via WebSocket
     │
     ▼
PostgreSQL + TimescaleDB
     │
     │ Tabela: readings
     │ { time, meter_id, kwh, voltage, ... }
     │
     ▼
API do Backend
     │
     │ GET /api/readings/{userId}
     │
     ▼
Dashboard do Lojista
     │
     │ Calcula consumo, estimativa, fator potência
     │
     ▼
Gráficos e Cards
```

### Cálculo de Consumo

```javascript
// Consumo do mês
const consumoMes = Math.max(...readings.map(r => r.kwh)) 
                 - Math.min(...readings.map(r => r.kwh))

// Estimativa de valor
const estimativa = consumoMes * 0.85  // R$ 0.85/kWh

// Fator de potência médio
const fatorPotencia = readings.reduce((acc, r) => acc + r.power_factor, 0) 
                    / readings.length
```

---

## Restrições de Acesso

### Lojista PODE

| Ação | Endpoint |
|------|----------|
| ✅ Ver dashboard da sua loja | `GET /api/readings/:userId` |
| ✅ Ver histórico de faturas | `GET /api/billing/:storeId` |
| ✅ Configurar alertas | `POST /api/alerts` |
| ✅ Ver alertas configurados | `GET /api/alerts` |
| ✅ Deletar alertas | `DELETE /api/alerts/:id` |
| ✅ Exportar dados (CSV) | Frontend gera CSV |

### Lojista NÃO PODE

| Ação | Motivo |
|------|--------|
| ❌ Ver dados de outras lojas | Privacidade |
| ❌ Alterar tarifas | Controle administrativo |
| ❌ Cadastrar lojas | Controle administrativo |
| ❌ Cadastrar medidores | Controle administrativo |
| ❌ Fechar faturamento | Controle administrativo |
| ❌ Ver dados de inquilinos | Privacidade |

---

## Exemplo de Uso Real

### Cenário: Lojista verifica consumo

```
1. Lojista acessa https://dashboard.guaruspliza.com.br
2. Faz login com email/senha
3. Dashboard mostra:
   - Consumo atual: 268.2 kWh
   - Estimativa: R$ 227.96
   - Fator potência: 0.95 (bom)
4. Gráfico mostra consumo subindo às 14:00
5. Lojista configura alerta para 300 kWh
```

### Cenário: Alerta dispara

```
1. Consumo atinge 300 kWh
2. Sistema verifica: 300 > 289 (limite)
3. Envia e-mail para loja1@example.com:
   "Consumo da Loja 001 atingiu 300 kWh"
4. Lojista recebe notificação
5. Lojista verifica dashboard
6. Ajusta uso de equipamentos
```

---

## APIs Utilizadas pelo Lojista

### GET /api/readings/:userId

Retorna leituras do medidor da loja.

**Query Parameters:**
- `from` (ISO date) - Data início
- `to` (ISO date) - Data fim

**Response:**
```json
[
  {
    "time": "2026-07-15T14:30:00Z",
    "kwh": 268.19,
    "voltage": 220.3,
    "current": 45.2,
    "power": 9.95,
    "power_factor": 0.95
  }
]
```

### GET /api/billing/:storeId

Retorna faturas da loja.

**Response:**
```json
[
  {
    "id": "uuid",
    "mes": 7,
    "ano": 2026,
    "kwhTotal": "268.19",
    "valorTotal": "227.96",
    "status": "fechado"
  }
]
```

### POST /api/alerts

Cria novo alerta.

**Request:**
```json
{
  "tipo": "consumo_mensal",
  "limite": 500,
  "canal": "email",
  "storeId": "uuid-da-loja"
}
```

**Response:**
```json
{
  "id": "uuid",
  "tipo": "consumo_mensal",
  "limite": "500",
  "canal": "email",
  "ativo": true
}
```
