# Crypto Daily Discord Bot

[![Test Status](https://img.shields.io/github/actions/workflow/status/OWNER/crypto-daily-discord-bot/test.yml?label=tests&logo=github)](https://github.com/OWNER/crypto-daily-discord-bot/actions/workflows/test.yml)
[![Coverage](https://img.shields.io/badge/coverage-vitest--coverage-blue?logo=vitest)](./package.json)

Bot Discord que entrega análises técnicas, gráficos e alertas diários sobre criptoativos. Ele combina dados de exchanges, cálculos de indicadores e webhooks para manter a comunidade informada sem intervenção manual.

## Visão geral

- Coleta candles e volume da Binance e de outras fontes configuradas.
- Calcula indicadores técnicos e monitora eventos de preço para disparar alertas configuráveis.
- Renderiza gráficos de velas com sobreposições (MAs, bandas, VWAP) e publica imagens diretamente em canais do Discord.
- Agrega notícias, sentimento, métricas on-chain e gera relatórios semanais/mensais via webhook.
- Expõe comandos slash para que qualquer usuário consulte gráficos, análises e configurações on-demand.

## Requisitos

| Ferramenta | Versão recomendada | Observações |
|------------|--------------------|-------------|
| Node.js    | 18 LTS ou superior | Necessário para `discord.js` v14 e para módulos ESM.
| npm        | 9 ou superior      | Instala dependências e executa os scripts definidos em `package.json`.
| Conta Discord | — | É preciso criar um aplicativo/bot e registrar os comandos slash no servidor desejado.

Instale as dependências do projeto após clonar o repositório:

```bash
npm install
```

## Configuração do ambiente (`.env`)

1. Duplique o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```
2. Preencha os tokens do Discord (`DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_*`) e chaves externas (Binance, OpenAI, etc.).
3. Ajuste os parâmetros opcionais de performance e indicadores conforme necessário:
   - `MAX_CONCURRENCY` limita quantas análises paralelas podem ocorrer (defina `1` para execução sequencial).
   - `BINANCE_CACHE_TTL_MINUTES` controla a validade do cache de preços compartilhado.
   - Variáveis `INDICATOR_*` permitem sobrescrever períodos de médias, configurações do MACD, multiplicadores de bandas de Bollinger/Keltner, etc.
4. Revise os IDs dos canais/servidores onde os conteúdos serão publicados (`DISCORD_GUILD_ID`, `DISCORD_CHANNEL_CHARTS_ID`, `DISCORD_WEBHOOK_ALERTS`, ...).

> 📌 Consulte `.env.example` para descrições completas e exemplos de cada variável disponível.

## Execução

| Tarefa | Comando | Descrição |
|--------|---------|-----------|
| Rodar o agendador com todos os jobs | `npm start` | Mantém o bot ativo, publica gráficos, notícias e alertas conforme as rotinas configuradas.
| Executar apenas um ciclo de coleta/postagem | `npm run once` | Útil para validar integrações em ambientes de teste ou CI.
| Limpar relatórios antigos | `npm run cleanup:reports` | Remove arquivos obsoletos em `reports/` e `data/`.
| Testes unitários | `npm test` | Executa a suíte do Vitest.
| Cobertura de testes | `npm run test:coverage` | Gera relatório de cobertura V8 (salvo em `coverage/`).
| Renderização de gráfico isolado | `npm run test:chart` | Gera um gráfico localmente para debug dos assets/timeframes.

## CLI de configuração

Gerencie `config/custom.json` sem editar arquivos manualmente utilizando o helper disponível no diretório `bin/`:

```bash
npm exec config-cli list
```

Comandos comuns:

- `npm exec config-cli list` – imprime a configuração mesclada com formatação legível.
- `npm exec config-cli get alerts.modules.rsi` – inspeciona um valor aninhado usando notação por pontos.
- `npm exec config-cli set alerts.modules.rsi false` – persiste valores (números, booleanos e strings JSON são convertidos automaticamente).

## Comandos do Discord

| Comando | Argumentos | O que faz |
|---------|------------|-----------|
| `/chart ativo:<ticker> tf:<timeframe>` | `ativo` (lista de chaves suportadas), `tf` (timeframes como `15m`, `1h`, `4h`, `1d`, `45m`, etc.) | Renderiza um gráfico de candles com indicadores sobrepostos e devolve a imagem no canal/DM. |
| `/watch add ativo:<ticker>` | — | Adiciona o ativo à watchlist pessoal do usuário. |
| `/watch remove ativo:<ticker>` | — | Remove o ativo da watchlist pessoal. |
| `/status` | — | Mostra uptime do bot e a watchlist do solicitante. |
| `/analysis ativo:<ticker> tf:<timeframe>` | — | Executa a mesma análise automática usada nos alertas, retornando um resumo textual. |
| `/settings risk percent value:<0-5>` | `value` (percentual) | Atualiza o risco por trade aplicado na estratégia automática. |

Todos os comandos são registrados automaticamente quando o bot inicia e exigem permissões de aplicação no servidor configurado.

## Indicadores calculados

Os módulos de indicadores (`src/indicators.js`) oferecem cálculos reutilizados em relatórios, gráficos e alertas. Entre eles:

- **Médias móveis simples (SMA) e exponenciais (EMA)** – usadas em cruzamentos, suporte/resistência dinâmicos e canais.
- **Índice de Força Relativa (RSI)** – sinaliza sobrecompra/sobrevenda com períodos configuráveis.
- **MACD** (linha, sinal e histograma) – identifica convergência/divergência de médias.
- **Bandas de Bollinger e Canal de Keltner** – delimitam volatilidade para alertas de breakout.
- **Parabolic SAR** – monitora reversões de tendência com fator de aceleração ajustável.
- **VWAP** e **divergência de volume** – combinam preço/volume para detecção de fluxos anormais.

Esses cálculos são parametrizados via `CFG.indicators` e podem ser sobrescritos por variáveis de ambiente, permitindo ajustes sem alterar o código.

## Alertas disponíveis

A pasta `src/alerts/` centraliza os módulos responsáveis por disparar notificações quando determinadas condições são atendidas. Exemplos:

- **Tendência e momentum**: `trendAlert`, `adxAlert`, `macdAlert`, `rsiAlert`, `stochasticAlert` e `williamsAlert`.
- **Bandas e volatilidade**: `bollingerAlert`, `atrAlert`, `sarAlert`, `varAlert`.
- **Volume e fluxo**: `volumeAlert`, `obvAlert`, `vwapAlert`, `emaCrossoverAlert`.
- **Preço e níveis**: `highLowAlert`, `roundNumberAlert`, `tradeLevelsAlert`, `priceInfoAlert`, `maPriceAlert`.
- **Heurísticas compostas**: `heuristicAlert` combina múltiplos sinais para priorizar eventos relevantes.

Todos os módulos utilizam `alertCache` para evitar duplicidade e respeitam configurações de intensidade, canais e horários definidas em `config/*.json`.

## Monitoramento e relatórios

- As entradas de deduplicação de alertas são expurgadas diariamente e também no start do processo, mantendo o cache coerente entre execuções longas e jobs efêmeros.
- A watchlist e o cache de alertas são limpos quando vazios, mantendo `data/` organizado em ambientes limpos e na suíte de testes.
- Snapshots de performance são salvos em `reports/weekly.json` para compor gráficos de retorno sem necessidade de postagens diárias.
- No primeiro dia de cada mês, o bot compila o desempenho acumulado e envia um relatório visual via webhook mensal (`DISCORD_WEBHOOK_MONTHLY`).

## Links úteis

- [Discord: criando webhooks](https://support.discord.com/hc/pt-br/articles/228383668)
- [Cron jobs com Node.js](https://blog.logrocket.com/how-to-use-node-cron/)
- [Guia da API Spot Binance](https://binance-docs.github.io/apidocs/spot/en/)

O bot registra avisos quando webhooks obrigatórios não estão configurados e interrompe execuções críticas, garantindo falhas rápidas em ambientes de produção.
