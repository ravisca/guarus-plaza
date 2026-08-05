# Coletor Modbus → MQTT

Lê os medidores Kron por Modbus TCP e publica as leituras no broker MQTT, no formato
que o agent espera.

```
medidores Kron (Modbus/502)  ->  [coletor]  ->  Mosquitto  ->  agent  ->  VPS
```

## Por que este componente existe

O `agent/` assina o tópico `konect/+/readings`, mas **nada publicava nele**. Os medidores
Kron falam Modbus TCP, não MQTT — sem esta ponte, o sistema não recebe uma leitura
sequer. A peça não existia no projeto original.

## Instalação

```bash
cd collector
npm install
cp medidores.example.json medidores.json   # e edite
npm run testar                             # um ciclo só, para conferir
npm start                                  # roda continuamente
```

## Configuração

Por variável de ambiente:

| Variável | Padrão | Para que serve |
|---|---|---|
| `MQTT_BROKER` | `mqtt://localhost:1883` | Broker onde publicar |
| `MEDIDORES_CONFIG` | `./medidores.json` | Lista de medidores |
| `INTERVALO_SEG` | `30` | Segundos entre ciclos de leitura |
| `MODBUS_UNIT_ID` | `255` | Unit id (confirmado nos Kron do Guarus) |
| `MODBUS_TIMEOUT_MS` | `3000` | Timeout por leitura |
| `CONCORRENCIA` | `5` | Medidores lidos em paralelo |
| `VERBOSE` | — | `1` imprime cada leitura |

### `medidores.json`

O campo `device` precisa ser **idêntico ao `macAddress` cadastrado no dashboard**. É por
ele que o backend liga a leitura à loja — `agentSync` faz
`where(eq(meters.macAddress, item.device))`. Se não casar, a leitura é **silenciosamente
descartada**: o agent entrega, o backend recebe e o `continue` do laço a joga fora sem
erro no log. É a falha mais provável na primeira instalação.

## Mapa de registradores

Função 4 (input registers), unit 255, float32 **little-endian (DCBA)**:

| Campo | Registrador |
|---|---|
| `kwh` | 200 |
| `voltage` | 10 |
| `current` | 16 |
| `power` | 34 |
| `power_factor` | 20 |

Detalhes e como foi descoberto: `scripts/dash_Plaza/05-mapa-modbus-kron.md`.

## ⚠️ Antes de usar para faturar

O mapa veio de **engenharia reversa, não de documentação do fabricante**. Ele identifica
*onde* está cada grandeza; não garante *escala* nem *multiplicador*.

Um TC de 200:5 mal aplicado, ou kWh confundido com Wh, gera conta 40x ou 1000x errada
para o lojista. Antes de emitir qualquer cobrança:

1. Obter a tabela Modbus oficial da Kron para o modelo exato
2. Conferir contra o display do próprio medidor, no local
3. Fechar um mês e comparar com a fatura da concessionária

Para monitoramento, o mapa atual já serve.

## Notas de implementação

- **CommonJS, não ESM.** O backend deste projeto quebrou em produção por `"type":
  "module"` com imports sem extensão. Aqui não há build nem essa classe de erro.
- **Leitura por bloco, não por grandeza.** São 3 requisições por medidor, não 5.
- **Energia ausente invalida o ciclo.** Sem `kwh` o coletor não publica, em vez de mandar
  registro incompleto que viraria consumo zero no faturamento.
- **O bloco 200 é lido com quantidade 10.** Com 20 o medidor responde "quantidade
  inválida".
