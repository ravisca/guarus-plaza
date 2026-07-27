# Checklist - O que vai para o Servidor do Shopping (Agente Local)

> Esse checklist cobre só o lado do **shopping** (agente coletor). O
> dashboard/API/banco ficam na VPS - ver `CHECKLIST_SERVIDOR.md` para aquele
> lado.

## 1. Requisitos da máquina

- [ ] Computador com Linux (Ubuntu 22.04+) ou Windows, conectado à **rede local do shopping** (mesma rede dos medidores Kron Konect)
- [ ] IP fixo (ou reservado via DHCP) dentro da rede local
- [ ] Acesso à internet de saída (para os pacotes Docker)

## 2. Software a instalar

```bash
curl -fsSL https://get.docker.com | sh
```

Docker Compose já vem embutido nas versões recentes (`docker compose`, sem hífen).

**Tailscale** (resolve o acesso da VPS sem precisar de IP público nem port-forward):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```
Depois de rodar, pegue o IP da tailnet desta máquina:
```bash
tailscale ip -4     # algo como 100.x.y.z
```
Esse é o IP que vai no `AGENT_WS_URL` do `.env` da VPS.

## 3. Arquivos do projeto a copiar (só o necessário, não o repositório inteiro)

```
agent/
mosquitto/
docker-compose.yml
.env
```

```bash
mkdir -p /opt/guarus
scp -r agent/ docker-compose.yml mosquitto/ .env usuario@IP_SERVIDOR_SHOPPING:/opt/guarus/
```

## 4. Variáveis de ambiente (`.env`)

| Variável | Descrição |
|---|---|
| `MQTT_BROKER` | `mqtt://mosquitto:1883` (nome do serviço no compose local) |
| `API_KEY` | Segredo que autentica a conexão WebSocket - **deve ser idêntico** ao `AGENT_API_KEY` do `.env` da VPS |
| `LOCAL_PORT` | `9100` (porta da API HTTP local de debug/status - default já cobre) |

> Não é preciso configurar nada relacionado a "enviar para a VPS" - o agente
> só expõe um WebSocket na porta **9200**; quem inicia a conexão é a API na
> VPS (modelo pull). A conexão em si acontece **dentro da tailnet**, não pela
> internet pública - ver seção 5.

## 5. Rede / Conectividade (o ponto mais importante)

- [ ] Porta **1883** (MQTT) acessível pelos medidores Kron Konect **dentro da rede local** - não precisa expor à internet
- [ ] **Tailscale instalado e conectado** (`tailscale up`, ver seção 2) - com isso a VPS alcança o agente pelo IP da tailnet (`100.x.y.z:9200`), **sem precisar de IP público, port-forward ou DDNS**. Funciona mesmo atrás de CGNAT.
- [ ] Não é necessário abrir nenhuma porta no roteador do shopping para a internet

> Descartamos port-forward/DDNS como caminho padrão: a maioria dos links
> comerciais no Brasil usa CGNAT (IP público compartilhado), o que torna
> port-forward inviável. O Tailscale contorna isso criando uma rede privada
> virtual entre as duas máquinas.

## 6. Subir o agente

```bash
cd /opt/guarus
docker compose up -d --build
```

Isso sobe:
- `mosquitto` (broker MQTT, porta 1883)
- `agent` (Node.js - assina MQTT, faz buffer, serve WebSocket na 9200 e HTTP de status na 9100)

## 7. Configurar os medidores Kron Konect

Cada medidor deve publicar via MQTT:

| Item | Valor |
|---|---|
| Broker | IP do servidor do shopping |
| Porta | `1883` |
| Tópico | `konect/{MAC_ADDRESS}/readings` |

Formato do payload (JSON):
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

## 8. Verificação

```bash
# Logs do agente
docker compose logs agent -f
```

Deve aparecer:
```
[MQTT] Connected to mqtt://mosquitto:1883
[MQTT] Subscribed to konect/+/readings
[LOCAL] HTTP API on http://localhost:9100
[WS] Client connected from <IP_DA_VPS>     ← aparece quando a VPS conectar
```

Testar status local:
```bash
curl http://localhost:9100/status
```

## 9. Troubleshooting

**Medidor não aparece no MQTT:**
```bash
docker compose logs mosquitto
docker compose exec mosquitto mosquitto_pub -t "test" -m "hello"
```

**VPS não conecta no WebSocket:**
- Confirmar que o Tailscale está rodando aqui: `tailscale status`
- Confirmar que a VPS consegue pingar esta máquina pela tailnet: `tailscale ping 100.x.y.z` (rodar a partir da VPS)
- Confirmar que `AGENT_WS_URL` na VPS usa o IP da tailnet (`100.x.y.z`), não `localhost` nem IP público
- Confirmar que `API_KEY` aqui é idêntico ao `AGENT_API_KEY` da VPS
- Ver logs do agente: procurar por `[WS] Client connected` (deve aparecer quando a VPS tenta conectar)
