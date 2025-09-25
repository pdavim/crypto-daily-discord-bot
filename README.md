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
- Automatiza execução de trades com salvaguardas, detecção de postura de mercado e logs auditáveis.
- Simula crescimento de portfólio com rebalanceamento, controle de risco e relatórios históricos.
- Prevê fechamentos do próximo timeframe e gera gráficos comparando históricos e projeções.

## O que há de novo

- **Integração Binance de ponta a ponta**: coleta spot/margin, executa ordens e apresenta resumos com o comando `/binance`.
- **Estratégia automática dinâmica**: postura bull/bear altera módulos ativos e o executor respeita limites de drawdown configurados.
- **Previsões e gráficos de tendência**: o módulo de forecasting salva históricos em `reports/forecasts/` e publica visualizações para cada ativo monitorado.
- **Simulação de crescimento 100€ → 10M€**: experimentos longos rodam em background e produzem dashboards com suposições documentadas.
- **Alertas enriquecidos**: payloads ordenados por ativo exibem variação por timeframe e linhas claras de buy/sell/hold.

## Documentação online

- [Site do projeto](https://OWNER.github.io/crypto-daily-discord-bot/) — documentação construída com VitePress e publicada automaticamente via GitHub Pages (ajuste `DOCS_GITHUB_OWNER`, `DOCS_SITE_URL` e `DOCS_BASE` ao gerar o site).

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

## Boas práticas para credenciais da Binance

- Gere chaves **apenas com permissões necessárias**: leitura para alertas e dashboards; ativar "Enable Spot & Margin Trading" somente quando o executor automático for utilizado.
- Restrinja o acesso por **IP allowlist** sempre que possível e mantenha as chaves fora de repositórios, tickets ou screenshots.
- Armazene `BINANCE_API_KEY` e `BINANCE_SECRET` apenas em `.env` locais ou nos segredos do provedor de deploy (GitHub Actions, Railway, etc.).
- Utilize `npm exec config-cli secrets check` (ou pipelines equivalentes) para validar se as variáveis estão presentes antes do deploy.
- Rotacione as chaves periodicamente e monitore os logs de `src/trading/executor.js` para detectar tentativas de uso indevido.

## Execução

| Tarefa | Comando | Descrição |
|--------|---------|-----------|
| Rodar o agendador com todos os jobs | `npm start` | Mantém o bot ativo, publica gráficos, notícias e alertas conforme as rotinas configuradas. |
| Executar apenas um ciclo de coleta/postagem | `npm run once` | Útil para validar integrações em ambientes de teste ou CI. |
| Limpar relatórios antigos | `npm run cleanup:reports` | Remove arquivos obsoletos em `reports/` e `data/`. |
| Documentação do site (modo dev) | `npm run site:dev` | Sobe o VitePress em `http://localhost:5173/crypto-daily-discord-bot/` para edição local. |
| Gerar build estática do site | `npm run site:build` | Compila a documentação para `.vitepress/dist`, usada no deploy do GitHub Pages. |
| Testes unitários | `npm test` | Executa a suíte do Vitest. |
| Cobertura de testes | `npm run test:coverage` | Gera relatório de cobertura V8 (salvo em `coverage/`). |
| Renderização de gráfico isolado | `npm run test:chart` | Gera um gráfico localmente para debug dos assets/timeframes. |
| Lint e formatação | `npm run lint` | Valida sintaxe ESM, indentação (4 espaços) e convenções de aspas. |
| Ajustes automáticos | `npm run lint:fix` | Executa o lint com correções automáticas sempre que possível. |

## Estrutura dos módulos

O repositório segue uma organização modular para manter responsabilidades isoladas e refletidas na suíte de testes:

- **`src/alerts/`** — Coleção de detectores especializados (`trendAlert`, `bollingerAlert`, `variationMetrics`, etc.) que transformam indicadores em payloads prontos para publicação. Os arquivos `dispatcher.js`, `messageBuilder.js` e `decision.js` centralizam enfileiramento, formatação e priorização dos alertas antes de chegarem ao Discord.
- **`src/ai.js`** — Orquestra o agente de análise assistido por IA. Usa indicadores técnicos, notícias (`news.js`), buscas na web (`websearch.js`) e fallback heurístico para gerar relatórios detalhados quando a API da OpenRouter está indisponível.
- **`src/data/`** — Adaptadores para dados externos. `binance.js` e `binanceStream.js` fazem coleta/cache de candles; `economic.js` monitora calendário macroeconômico; `newsapi.js` e `serpapi.js` fornecem notícias e snippets para enriquecer relatórios.
- **`src/reporter.js`** — Converte snapshots técnicos em PDFs, aplica heurísticas de pontuação e exporta helpers (`pct`, `fmt`, `buildSnapshotForReport`) reutilizados em relatórios semanais/mensais e no site.

Cada diretório de `tests/` espelha essa estrutura (`tests/alerts/`, `tests/ai.test.js`, `tests/data/`, `tests/reporter.test.js`) garantindo que novas funcionalidades venham acompanhadas de cobertura automatizada.

### Logs e compatibilidade

- Em ambientes Windows ou com Node.js 22+, o bot força o modo de escrita síncrona dos logs para evitar falhas no worker do transporte rotativo.
- Defina `LOG_SYNC=false` caso queira reativar o transporte assíncrono manualmente (por exemplo, em servidores Linux). Use `LOG_SYNC=true` ou o comando `npm run once` para garantir flush imediato em execuções únicas.
- Se o transporte rotativo não puder ser inicializado, o bot faz fallback automático para o `stdout`, garantindo que as mensagens continuem disponíveis no console.

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
| `/settings profit percent value:<0-20>` | `value` (percentual) | Define o lucro mínimo global ou pessoal antes que sinais de venda sejam destacados. |
| `/binance` | — | Exibe saldo spot, métricas de margem e posições agregadas com base nas credenciais configuradas. |

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

## FAQ

### O que é este crypto trading bot?

É uma automação que coleta dados de exchanges, calcula indicadores técnicos e envia decisões recomendadas diretamente para o seu servidor. Apesar de não executar ordens por você, o crypto trading bot concentra insights prontos para orientar entradas, saídas e estratégias diárias.

### Como funcionam os Discord alerts do projeto?

Os módulos de alertas monitoram variações de preço, volume e sentimento em tempo real. Quando uma condição configurada é disparada, o bot gera Discord alerts com gráficos, texto e links relevantes no canal escolhido, mantendo todo o time informado sem precisar abrir dashboards externos.

### Posso personalizar indicadores e frequência dos envios?

Sim. Ajuste os indicadores ativos, thresholds e cadência diretamente nos arquivos de configuração ou variáveis de ambiente. Assim, os avisos chegam de acordo com o perfil de risco desejado, seja para acompanhar scalps, swing trades ou relatórios semanais para a comunidade.
