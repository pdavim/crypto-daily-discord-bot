# Introdução

Este guia resume os passos essenciais para colocar o Crypto Daily Discord Bot em funcionamento e entender a estrutura do repositório.

## Arquitetura

O projeto é dividido em módulos que coletam dados de exchanges, calculam indicadores técnicos e publicam mensagens formatadas no Discord. Alguns diretórios importantes:

- `src/` — código fonte principal do bot e dos jobs agendados.
- `config/` — arquivos JSON com as configurações padrão de alerts, ativos e templates.
- `data/` — cache local com candles, resultados de indicadores e snapshots de performance.
- `charts/` — imagens dos gráficos gerados para publicação.
- `docs/` — documentação técnica gerada automaticamente a partir do código via `jsdoc`.

## Pré-requisitos

- Node.js 18 LTS ou superior.
- Conta do Discord com permissão para criar aplicações e webhooks.
- Chaves de APIs externas (Binance, serviços de notícias e métricas on-chain) quando aplicável.

## Configuração inicial

1. Instale as dependências do projeto raiz:
   ```bash
   npm install
   ```
2. Copie o arquivo de variáveis de ambiente e ajuste os valores:
   ```bash
   cp .env.example .env
   ```
3. Atualize tokens, webhooks e parâmetros extras conforme necessidade.
4. Defina `DISCORD_WEBHOOK_GENERAL` (ou `webhookGeneral` via `config-cli`) para direcionar o resumo com recomendações de posição.

## Executando localmente

Use os scripts definidos no `package.json` para iniciar o bot:

```bash
npm start
```

Para um ciclo único de coleta/publicação, utilize:

```bash
npm run once
```

Os testes unitários estão disponíveis via:

```bash
npm test
```

Com isso você valida integrações antes de hospedar o serviço em produção.

## Qualidade transversal

Além das suítes funcionais, o repositório mantém testes de qualidade que garantem conformidade com o estilo (ESM, quatro espaços, `;` ao final das instruções) e verificam se diretórios como `data/`, `reports/` e `charts/` permanecem livres de artefatos antes de um commit.

- Execute `npm run test` para rodar o pacote completo, incluindo `tests/quality/style.test.js` e `tests/quality/artifacts.test.js`.
- Revise o [guia de padrões](./qualidade.md) para detalhes sobre a convenção de aspas, persistência de dados e checklist do PR.
- Gere o JSDoc com `npm run docs` sempre que novas APIs forem expostas, garantindo que `docs/` esteja sincronizado com o código.

Seguir esse ritual evita regressões sutis e mantém o histórico limpo para auditorias futuras.

## Ajustando o lucro mínimo por comando

O bot permite ajustar um alvo mínimo de lucro para filtrar oportunidades de trade e destacar alertas realmente relevantes:

- `/settings profit view` exibe o valor padrão do servidor, o seu limite pessoal (se existir) e o alvo efetivo aplicado nas análises.
- `/settings profit default value:<percentual>` define o lucro mínimo global em porcentagem (por exemplo, `5` para 5%).
- `/settings profit personal value:<percentual>` grava o seu limite individual, sobrescrevendo o padrão para respostas das interações.

Os valores ficam persistidos em `data/settings.json` e influenciam recomendações como o alerta de níveis de trade, que agora sinaliza quando o alvo projetado está abaixo do limite configurado.

## Reexecutando análises manualmente

Quando um analista dispara o comando `/analysis`, o bot ignora o cache de assinaturas utilizado nos jobs agendados e recalcula todos os snapshots antes de responder. Isso garante que a coleta manual reflita o estado mais recente dos indicadores, mesmo que os candles já tenham sido processados anteriormente. Os agendamentos continuam respeitando a deduplicação por assinatura, então rodar o comando manualmente não interfere na rotina automática nem gera duplicidade de alertas.

## Variação por timeframe nos alertas

Os alertas consolidados passaram a incluir uma linha dedicada às variações de preço por timeframe. Sempre que novas métricas são calculadas, o bot combina os movimentos recentes (5m, 15m, 30m, 45m, 1h, 4h) com janelas mais longas (24h, 7d e 30d) para oferecer contexto imediato sobre o momentum do ativo.

- O módulo `varAlert` agrega os percentuais em uma única mensagem, respeitando a ordem configurada em `TIMEFRAMES` e destacando as janelas diárias e semanais.
- A mensagem final no Discord inclui a lista `_Variações: …_`, garantindo que cada ativo mostre como está performando em múltiplos horizontes de tempo.

Essa visão unificada facilita priorizar oportunidades e entender se um movimento forte em timeframes curtos está alinhado (ou não) com a tendência de médio prazo.

## Decisão buy/sell/hold por timeframe

Cada bloco de alertas agora inclui uma linha explícita de decisão (`Decisão: …`) logo abaixo de cada item listado. O bot cruza o resultado do avaliador de postura de mercado (`src/trading/posture.js`) com a estratégia ativa para traduzir os indicadores em uma recomendação prática:

- **Buy (🟢)** quando a estratégia sugere posição comprada com confiança suficiente.
- **Sell (🔴)** caso a leitura aponte para venda/posição vendida.
- **Hold (🟡)** se o cenário estiver neutro ou com convicção insuficiente.

Além do rótulo, a linha de decisão mostra a postura dominante (alta, baixa ou neutra), o nível de confiança e os principais motivos calculados pelo motor de postura. Isso facilita validar rapidamente o racional por trás de cada alerta sem abrir relatórios adicionais.

## Resumo geral com recomendações de posição

A cada execução o bot também gera uma mensagem consolidada por ativo listando guidance, decisão atual e variação percentual de cada timeframe acompanhado de um tamanho de posição sugerido. O cálculo usa `CFG.accountEquity` multiplicado por `CFG.riskPerTrade` para estimar o capital exposto e aparece mesmo quando nenhum alerta específico é disparado, ajudando times de investimento a manter disciplina de sizing.

> 💡 Configure `webhookGeneral` ou `DISCORD_WEBHOOK_GENERAL` para enviar esse resumo a um canal dedicado; quando nenhum webhook geral estiver definido, o bot tenta usar `CFG.webhook` e registra um aviso caso ambos estejam vazios.

### Mapeamento de webhooks do Discord

- `webhookAlerts` concentra os alertas intradiários emitidos pelos módulos em `src/alerts/`, preservando `CFG.webhook` apenas como fallback.
- `webhookAnalysis` recebe os relatórios técnicos de `postAnalysis`; para direcionar ativos específicos use chaves como `webhookAnalysis_BTC`, `webhookAnalysis_ETH` etc., que têm prioridade sobre o webhook global de análise.
- `webhookReports` permanece como destino padrão para relatórios consolidados e para o PDF do resumo diário quando nenhum webhook de análise está disponível.
- `webhookDaily` continua reservado para o resumo agregado do dia (`assetKey === "DAILY"`) quando não existirem canais de análise configurados.
- `webhookMonthly` direciona o relatório mensal com gráficos anexados.

## Alertas organizados por ativo

Para tornar o feed de alertas mais digerível, as notificações agregadas agora são ordenadas por ativo antes de chegarem ao Discord. O dispatcher reúne todos os payloads gerados durante o ciclo e aplica duas regras:

- Se o ativo tiver metadados de capitalização (`marketCapRank`) definidos em `src/assets.js`, a ordenação prioriza os mercados mais relevantes (rank 1 primeiro, rank 2 em seguida, etc.).
- Na ausência desse dado, os ativos são listados alfabeticamente, garantindo previsibilidade mesmo para tickers personalizados ou recém-adicionados.

Com essa organização, fica mais simples acompanhar o que está acontecendo com BTC, ETH e demais moedas sem saltos ou inversões de ordem no canal de alertas.

## Forecasts de fechamento e gráficos históricos

O módulo de forecasting (em `src/forecasting.js`) calcula uma projeção do próximo preço de fechamento para cada timeframe monitorado utilizando regressão linear. A cada execução do bot:

- Os resultados são persistidos em `reports/forecasts/<ATIVO>/<timeframe>.json`, mantendo um histórico com data da previsão, confiança, delta e erro em relação ao fechamento observado posteriormente.
- Quando `forecasting.charts.enabled` está ativo, um gráfico comparativo é renderizado em `charts/forecasts/`, destacando o candle mais recente e o ponto previsto.
- A linha "Previsão" aparece nos alertas do Discord logo após o cabeçalho de cada timeframe, mostrando o preço estimado, variação esperada, confiança percentual, alvo temporal (convertido para o fuso definido em `CFG.tz`) e, quando disponível, a precisão da previsão anterior.
- Se `forecasting.charts.appendToUploads` for verdadeiro, as imagens geradas são anexadas automaticamente ao mesmo post dos gráficos tradicionais.

Os parâmetros padrão (lookback, histórico mínimo, limite de retenção e diretórios) podem ser ajustados em `config/default.json` ou sobrescritos via variáveis de ambiente (`FORECASTING_*`). Isso facilita calibrar a janela de análise conforme a volatilidade de cada exchange e manter os artefatos fora do versionamento.

## Previsões rápidas via `/status`

As previsões armazenadas agora ficam disponíveis diretamente no comando `/status`. Para cada ativo da sua watchlist o bot acrescenta uma seção `🔮` com os horizontes de 5m, 15m, 30m, 1h e 4h, destacando:

- **Direção projetada**: 🐂 representa cenário de alta (delta positivo) e 🐻 sinaliza queda (delta negativo). Quando o modelo indica estabilidade, o rótulo aparece como ➖.
- **Preço previsto**: valor estimado para o próximo fechamento naquele timeframe, usando o formato monetário configurado.
- **Delta percentual**: variação proporcional em relação ao último fechamento conhecido.

Caso não exista histórico para algum timeframe, o campo correspondente mostra `—`, evidenciando que nenhuma projeção foi persistida ainda.

## Simulador 100€ → 10M€ com resumos automáticos

O job `runPortfolioGrowthSimulation` (em `src/portfolio/growth.js`) roda diariamente um backtest de longo prazo para acompanhar a jornada de €100 até €10 milhões. O simulador considera alocações configuráveis, aportes periódicos, controles de risco (drawdown, stop loss, take profit) e rebalanceamentos automáticos, salvando JSONs em `reports/growth/` e gráficos em `charts/growth/`.

- Defina pesos por ativo em `portfolioGrowth.strategies` e personalize aportes, slippage e janelas históricas em `portfolioGrowth.simulation`.
- A cada execução, o bot gera métricas como retorno acumulado, CAGR, volatilidade anualizada, Sharpe ratio e data estimada para alcançar a meta com base no crescimento composto.
- Ative `portfolioGrowth.discord.enabled` para receber um resumo no Discord com menção opcional (`@here`, cargos ou usuários), progresso percentual, capital investido e os links locais dos relatórios gerados.

O módulo respeita diretórios e webhooks definidos em variáveis `PORTFOLIO_*`, garantindo que nenhum arquivo temporário seja versionado e que as notificações possam ser direcionadas a canais específicos do servidor.

