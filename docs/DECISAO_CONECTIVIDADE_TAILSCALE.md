# Decisão de Arquitetura - Conectividade VPS ↔ Agente do Shopping

## Pergunta que gerou a decisão

> "Pq se a VPS tentar buscar desse websocket, como ele vai encontrar a máquina
> se não tem IP Público?"

## Contexto

A arquitetura implementada (`backend/src/modules/agentSync`) faz a VPS se
conectar como **cliente** ao WebSocket que o agente do shopping expõe na
porta 9200 (`agent/src/index.ts`, que roda como servidor). Isso significa que
a VPS precisa **alcançar** o servidor do shopping pela rede.

O problema: a maioria dos links comerciais de internet no Brasil usa
**CGNAT** (o provedor compartilha um único IP público entre vários
clientes). Nesses casos:
- Não existe port-forward possível - o roteador do shopping nem tem um IP
  público próprio pra redirecionar.
- Mesmo com IP dinâmico (sem CGNAT), a VPS precisaria de DDNS pra sempre
  achar o endereço certo.

Durante a investigação também apareceu uma segunda inconsistência: o
documento `ARQUITETURA_COMUNICACAO.md` afirmava que "o agente faz conexão
outbound" e que "o shopping não tem porta de entrada aberta" - mas o código
real é o oposto (o agente é quem escuta, a VPS é quem conecta). O documento
descrevia uma garantia de segurança que o código não cumpria.

## Opções avaliadas

| Opção | Resolve CGNAT? | Esforço | Escolhida? |
|---|---|---|---|
| Port-forward + DDNS | Não (CGNAT impede) | Baixo, mas inviável na prática | ❌ |
| Inverter a arquitetura (agente conecta na VPS) | Sim | Médio - muda `agentSync` e o agente | ❌ |
| Cloudflare Tunnel | Sim | Baixo-médio - precisa conta Cloudflare | ❌ |
| **Tailscale / ZeroTier** | **Sim** | **Baixo** - instala um binário em cada lado, zero config de firewall | ✅ |

## Solução escolhida: Tailscale

Os dois lados (VPS e servidor do shopping) entram na mesma **tailnet** - uma
rede privada virtual. Cada máquina recebe um IP fixo dentro dela
(`100.x.y.z`), alcançável pela outra independentemente de IP público,
port-forward ou CGNAT. `AGENT_WS_URL` na VPS passa a apontar para o IP da
tailnet do agente, não para um IP público.

## O que foi alterado

| Arquivo | Mudança |
|---|---|
| `.env.example` | `AGENT_WS_URL` documentado como IP de tailnet (`100.x.y.z`), não IP público |
| `docs/CHECKLIST_SHOPPING.md` | Adicionada instalação do Tailscale; seção de rede trocada de "port-forward/DDNS" para "conectar na tailnet"; troubleshooting atualizado |
| `docs/CHECKLIST_SERVIDOR.md` | Adicionada instalação do Tailscale na VPS; seção de rede/firewall reescrita; nota de que o container `api` alcança a tailnet do host sem config extra de Docker |
| `docs/INSTALACAO.md` | Passos 1.2 e 2.2 agora instalam e configuram Tailscale (`tailscale up`, `tailscale ip -4`); `.env` de exemplo usa IP de tailnet |
| `docs/ARQUITETURA_COMUNICACAO.md` | Corrigida a descrição errada de que "o agente conecta outbound" / "shopping sem porta nenhuma" - agora reflete que o agente é o servidor WS e a porta 9200 só é alcançável dentro da tailnet, nunca na internet pública |

## Passo manual pendente

Rodar `tailscale up` nas duas máquinas (abre link de autenticação no
navegador na primeira vez) e anotar o IP de cada uma com `tailscale ip -4`
para preencher `AGENT_WS_URL` no `.env` da VPS.
