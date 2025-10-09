import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub discord.js primitives so the module can be imported without a real client
const loginMock = vi.fn();
const onMock = vi.fn();
const setCommandsMock = vi.fn();

vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    login: loginMock.mockResolvedValue(),
    on: onMock,
    application: { commands: { set: setCommandsMock } },
    channels: { fetch: vi.fn() },
  })),
  GatewayIntentBits: { Guilds: 1 },
  ApplicationCommandOptionType: {
    String: 3,
    Subcommand: 1,
    SubcommandGroup: 2,
    Number: 10,
    Boolean: 5,
  },
}));

// mock dependencies
const fetchOHLCV = vi.fn();
const renderChartPNG = vi.fn();
const addAssetToWatch = vi.fn();
const removeAssetFromWatch = vi.fn();
const getWatchlist = vi.fn(() => []);
const getForecastSnapshot = vi.fn(() => ({}));
const getAccountOverview = vi.fn();
const placeOrder = vi.fn();
const transferMargin = vi.fn();
const borrowMargin = vi.fn();
const repayMargin = vi.fn();
const openPosition = vi.fn();
const adjustMargin = vi.fn();
const settingsStore = {};
const loadSettingsMock = vi.fn((defaults = {}) => {
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in settingsStore)) {
      settingsStore[key] = value;
    }
  }
  return settingsStore;
});
const getSettingMock = vi.fn((key, fallback) => (key in settingsStore ? settingsStore[key] : fallback));
const setSettingMock = vi.fn((key, value) => {
  if (value === undefined) {
    delete settingsStore[key];
    return undefined;
  }
  settingsStore[key] = value;
  return settingsStore[key];
});

vi.mock('../src/data/marketData.js', () => ({ fetchOHLCV }));
vi.mock('../src/chart.js', () => ({ renderChartPNG }));
vi.mock('../src/watchlist.js', () => ({ addAssetToWatch, removeAssetFromWatch, getWatchlist }));
vi.mock('../src/store.js', () => ({ getForecastSnapshot }));
const streamCandlesMock = vi.fn();
const getExchangeConnectorMock = vi.fn(() => ({
  id: 'binance',
  getAccountOverview,
  placeOrder,
  transferMargin,
  borrowMargin,
  repayMargin,
  streamCandles: streamCandlesMock,
}));
const resolveConnectorForAssetMock = vi.fn(() => ({
  id: 'binance',
  getAccountOverview,
  placeOrder,
  transferMargin,
  borrowMargin,
  repayMargin,
  streamCandles: streamCandlesMock,
}));
vi.mock('../src/exchanges/index.js', () => ({
  getExchangeConnector: getExchangeConnectorMock,
  resolveConnectorForAsset: resolveConnectorForAssetMock,
}));
vi.mock('../src/trading/executor.js', () => ({ openPosition, adjustMargin }));
vi.mock('../src/settings.js', () => ({
  loadSettings: loadSettingsMock,
  getSetting: getSettingMock,
  setSetting: setSettingMock,
}));

// environment setup for assets
process.env.BINANCE_SYMBOL_BTC = 'BTCUSDT';

const { CFG } = await import("../src/config.js");

async function loadBot() {
  return import("../src/discordBot.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getAccountOverview.mockReset();
  placeOrder.mockReset();
  transferMargin.mockReset();
  borrowMargin.mockReset();
  repayMargin.mockReset();
  streamCandlesMock.mockReset();
  getExchangeConnectorMock.mockReset();
  resolveConnectorForAssetMock.mockReset();
  getExchangeConnectorMock.mockReturnValue({
    id: 'binance',
    getAccountOverview,
    placeOrder,
    transferMargin,
    borrowMargin,
    repayMargin,
    streamCandles: streamCandlesMock,
  });
  resolveConnectorForAssetMock.mockReturnValue({
    id: 'binance',
    getAccountOverview,
    placeOrder,
    transferMargin,
    borrowMargin,
    repayMargin,
    streamCandles: streamCandlesMock,
  });
  openPosition.mockReset();
  adjustMargin.mockReset();
  getForecastSnapshot.mockReset();
  getForecastSnapshot.mockReturnValue({});
  for (const key of Object.keys(settingsStore)) {
    delete settingsStore[key];
  }
  delete process.env.ENABLE_BINANCE_COMMAND;
  CFG.assets = [{
    key: 'BTC',
    exchange: 'binance',
    symbol: 'BTCUSDT',
    symbols: { spot: 'BTCUSDT', stream: 'BTCUSDT', market: 'BTCUSDT' },
    capabilities: {
      candles: true,
      daily: true,
      streaming: true,
      trading: true,
      margin: true,
      forecasting: true,
    },
  }];
  CFG.assetMap = new Map(CFG.assets.map(asset => [asset.key, asset]));
});

describe('discord bot interactions', () => {
  it('handles /chart command and returns chart file', async () => {
    fetchOHLCV.mockResolvedValue([{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }]);
    renderChartPNG.mockResolvedValue('/tmp/chart.png');
    const { handleInteraction } = await loadBot();

    const options = {
      getString: vi.fn((name) => (name === 'ativo' ? 'BTC' : '15m')),
    };

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'chart',
      options,
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(fetchOHLCV).toHaveBeenCalledWith(expect.objectContaining({ key: 'BTC' }), '15m');
    expect(renderChartPNG).toHaveBeenCalledWith(
      'BTC',
      '15m',
      [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }]
    );
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ files: ['/tmp/chart.png'] });
  });

  it('handles /watch add', async () => {
    addAssetToWatch.mockReturnValue(true);
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'watch',
      options: {
        getSubcommand: () => 'add',
        getString: () => 'BTC',
      },
      user: { id: 'user-1' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(addAssetToWatch).toHaveBeenCalledWith('user-1', 'BTC');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Ativo BTC adicionado à watchlist',
      ephemeral: true,
    });
  });

  it('handles /watch remove', async () => {
    removeAssetFromWatch.mockReturnValue(true);
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'watch',
      options: {
        getSubcommand: () => 'remove',
        getString: () => 'BTC',
      },
      user: { id: 'user-1' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(removeAssetFromWatch).toHaveBeenCalledWith('user-1', 'BTC');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Ativo BTC removido da watchlist',
      ephemeral: true,
    });
  });

  it('handles /status command with watchlist forecasts', async () => {
    getWatchlist.mockReturnValue(['btc', 'ETH', 'BTC']);
    getForecastSnapshot.mockImplementation((asset) => {
      if (asset === 'BTC') {
        return {
          '5m': { forecastClose: 101, lastClose: 100, delta: 1 },
          '15m': { forecastClose: 99, lastClose: 100, delta: -1 },
          '30m': { forecastClose: 100, lastClose: 100, delta: 0 },
          '1h': { forecastClose: 102, lastClose: 100, delta: 2 },
          '4h': { forecastClose: 98, lastClose: 100, delta: -2 },
        };
      }
      if (asset === 'ETH') {
        return {
          '5m': { forecastClose: 2010, lastClose: 2000, delta: 10 },
          '15m': { forecastClose: 1990, lastClose: 2000, delta: -10 },
        };
      }
      return {};
    });
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'status',
      user: { id: 'user-5' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(getWatchlist).toHaveBeenCalledWith('user-5');
    expect(getForecastSnapshot).toHaveBeenCalledWith('BTC');
    expect(getForecastSnapshot).toHaveBeenCalledWith('ETH');
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.ephemeral).toBe(true);
    expect(payload.content).toContain('👀 Watchlist: BTC, ETH');
    expect(payload.content).toContain('🔮 BTC');
    expect(payload.content).toContain('5m: 🐂 Alta 101,00 (+1,00%)');
    expect(payload.content).toContain('15m: 🐻 Baixa 99,00 (-1,00%)');
    expect(payload.content).toContain('30m: ➖ Neutro 100,00 (0,00%)');
    expect(payload.content).toContain('1h: 🐂 Alta 102,00 (+2,00%)');
    expect(payload.content).toContain('4h: 🐻 Baixa 98,00 (-2,00%)');
    expect(payload.content).toContain('🔮 ETH');
    expect(payload.content).toContain('30m: —');
  });

  it('handles /status command when no forecasts are stored', async () => {
    getWatchlist.mockReturnValue(['SOL']);
    getForecastSnapshot.mockReturnValue({});
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'status',
      user: { id: 'user-6' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(getWatchlist).toHaveBeenCalledWith('user-6');
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.content).toContain('SOL');
    expect(payload.content).toContain('5m: —');
    expect(payload.content).toContain('15m: —');
    expect(payload.content).toContain('30m: —');
    expect(payload.content).toContain('1h: —');
    expect(payload.content).toContain('4h: —');
  });

  it('lista comandos, subcomandos e argumentos no /help', async () => {
    const botModule = await loadBot();
    const { handleInteraction } = botModule;

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'help',
      reply: vi.fn(),
      followUp: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.any(String),
      ephemeral: true,
    });

    const initialChunk = interaction.reply.mock.calls[0][0].content;
    const followUpChunks = interaction.followUp.mock.calls.map((call) => call[0].content);
    const allChunks = [initialChunk, ...followUpChunks];
    allChunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    });

    const message = allChunks.join('\n\n');
    expect(message).toContain('/chart — Exibe um gráfico de preços com indicadores técnicos.');
    expect(message).toContain('Subcomando add — Adiciona um ativo à watchlist pessoal.');
    expect(message).toContain('value (obrigatório) — Percentual de lucro mínimo global (0 a 100).');
    expect(message).toContain('/help — Lista os comandos disponíveis e seus objetivos.');
  });

  it('pagina a resposta do /help quando excede o limite do Discord', async () => {
    const botModule = await loadBot();
    const longDescription = 'Descrição detalhada para testar paginação '.repeat(12);
    const oversizedCommand = {
      name: 'mega',
      description: 'Comando com muitas opções para validar o fracionamento.',
      helpDetails: ['Esta seção contém um volume grande de parâmetros e deve ser dividida em múltiplas páginas.'],
      options: Array.from({ length: 120 }, (_, index) => ({
        name: `option${index}`,
        description: `${longDescription}${index}`,
        type: 3,
        required: true,
      })),
    };

    const chunkLimit = 500;
    const helpChunks = botModule.buildHelpMessage({ commands: [oversizedCommand], maxChunkLength: chunkLimit });

    expect(helpChunks.length).toBeGreaterThan(1);
    helpChunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(chunkLimit);
    });

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'help',
      reply: vi.fn(),
      followUp: vi.fn(),
    };

    await botModule.handleInteraction(interaction, { helpMessageBuilder: () => helpChunks });

    expect(interaction.reply).toHaveBeenCalledWith({ content: helpChunks[0], ephemeral: true });
    expect(interaction.followUp).toHaveBeenCalledTimes(helpChunks.length - 1);
    helpChunks.slice(1).forEach((chunk, index) => {
      expect(interaction.followUp).toHaveBeenNthCalledWith(index + 1, { content: chunk, ephemeral: true });
    });

    const deliveredChunks = [
      interaction.reply.mock.calls[0][0].content,
      ...interaction.followUp.mock.calls.map((call) => call[0].content),
    ];
    deliveredChunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    });
  });

  it('handles /binance command and formats overview', async () => {
    getAccountOverview.mockResolvedValue({
      assets: [
        { coin: 'BTC', depositAllEnable: true, withdrawAllEnable: false },
        { coin: 'ETH', depositAllEnable: true, withdrawAllEnable: true },
        { coin: 'SOL', depositAllEnable: false, withdrawAllEnable: false },
        { coin: 'ADA', depositAllEnable: true, withdrawAllEnable: true },
        { coin: 'XRP', depositAllEnable: true, withdrawAllEnable: true },
        { coin: 'DOGE', depositAllEnable: true, withdrawAllEnable: true },
      ],
      spotBalances: [
        { asset: 'BTC', free: 1.2, locked: 0.3, total: 1.5 },
        { asset: 'USDT', free: 1000, locked: 0, total: 1000 },
      ],
      marginAccount: {
        totalAssetOfBtc: 0.5,
        totalLiabilityOfBtc: 0.1,
        totalNetAssetOfBtc: 0.4,
        marginLevel: 3.2,
        userAssets: [
          { asset: 'USDT', free: 500, borrowed: 100, interest: 2, netAsset: 398 },
        ],
      },
      marginPositions: [
        {
          symbol: 'BTCUSDT',
          marginType: 'cross',
          positionAmt: 0.01,
          entryPrice: 25000,
          markPrice: 26000,
          unrealizedProfit: 100,
          liquidationPrice: 20000,
        },
      ],
    });
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(getAccountOverview).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.any(String));
    const message = interaction.editReply.mock.calls[0][0];
    expect(message).toContain('**Saldos Spot**');
    expect(message).toContain('BTC: 1,50 (Livre 1,20 | Travado 0,30)');
    expect(message).toContain('USDT: 1.000,00 (Livre 1.000,00 | Travado 0,00)');
    expect(message).toContain('• Patrimônio líquido: 0,4000 BTC');
    expect(message).toContain('• Ativos: 0,5000 BTC | Passivos: 0,1000 BTC');
    expect(message).toContain('• Nível de margem: 3,20x');
    expect(message).toContain('• USDT: Livre 500,00 | Empréstimo 100,00 | Juros 2,00 | Líquido 398,00');
    expect(message).toContain('BTCUSDT (cross)');
    expect(message).toContain('Qtde: 0,0100 | Entrada: 25.000,00 | Marca: 26.000,00 | PnL: 100,00 | Liq.: 20.000,00');
    expect(message).toContain('... e mais 1 ativo');
  });

  it('limita seções extensas do /binance com indicação de overflow', async () => {
    getAccountOverview.mockResolvedValue({
      assets: Array.from({ length: 8 }, (_, index) => ({
        coin: `ASSET${index + 1}`,
        depositAllEnable: true,
        withdrawAllEnable: true,
      })),
      spotBalances: Array.from({ length: 9 }, (_, index) => ({
        asset: `COIN${index + 1}`,
        total: 1000 + index,
        free: 500 + index,
        locked: 100 + index,
      })),
      marginAccount: {
        totalAssetOfBtc: 1.25,
        totalLiabilityOfBtc: 0.2,
        userAssets: Array.from({ length: 8 }, (_, index) => ({
          asset: `MARGIN${index + 1}`,
          free: 10 + index,
          borrowed: 5 + index,
          interest: 0.5 + index,
          netAsset: 20 + index,
        })),
      },
      marginPositions: Array.from({ length: 7 }, (_, index) => ({
        symbol: `PAIR${index + 1}`,
        marginType: 'isolated',
        positionAmt: 0.001 * (index + 1),
        entryPrice: 1000 + index,
        markPrice: 1100 + index,
        unrealizedProfit: 50 + index,
      })),
    });
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    const message = interaction.editReply.mock.calls[0][0];
    expect(message).toContain('... e mais 3 ativos');
    expect(message).toContain('... e mais 3 saldos');
    expect(message).toContain('... e mais 2 ativos');
    expect(message).toContain('... e mais 2 posições');
  });

  it('mantém mensagens amigáveis com dados parciais no /binance', async () => {
    getAccountOverview.mockResolvedValue({
      assets: [{ coin: 'BTC', depositAllEnable: true }],
      spotBalances: [
        { asset: 'BTC', total: 0.5, free: 0.4 },
        { asset: 'BUSD', total: undefined, free: undefined, locked: undefined },
      ],
      marginAccount: {
        totalAssetOfBtc: 0.25,
        userAssets: undefined,
      },
      marginPositions: [
        { symbol: 'ETHUSDT', marginType: 'cross', positionAmt: undefined, entryPrice: undefined, markPrice: undefined, unrealizedProfit: undefined },
      ],
    });
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    const message = interaction.editReply.mock.calls[0][0];
    expect(message).toContain('BTC: 0,50 (Livre 0,40 | Travado 0,00)');
    expect(message).toContain('BUSD: 0,00 (Livre 0,00 | Travado 0,00)');
    expect(message).toContain('• Ativos: 0,2500 BTC | Passivos: 0,00 BTC');
    expect(message).toContain('Sem ativos na conta de margem.');
    expect(message).toContain('ETHUSDT (cross)');
  });

  it('handles /binance command when overview lacks sections', async () => {
    getAccountOverview.mockResolvedValue({
      assets: [],
      spotBalances: undefined,
      marginAccount: null,
      marginPositions: undefined,
    });
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.any(String));
    const message = interaction.editReply.mock.calls[0][0];
    expect(message).toContain('**Ativos Configurados**');
    expect(message).toContain('Sem dados de ativos configurados.');
    expect(message).toContain('**Saldos Spot**');
    expect(message).toContain('Sem saldos spot disponíveis.');
    expect(message).toContain('**Conta de Margem**');
    expect(message).toContain('Sem dados da conta de margem.');
    expect(message).toContain('**Ativos na Margem**');
    expect(message).toContain('Sem ativos na conta de margem.');
    expect(message).toContain('**Posições de Margem**');
    expect(message).toContain('Sem posições de margem abertas.');
  });

  it('informa quando o comando /binance está desativado', async () => {
    process.env.ENABLE_BINANCE_COMMAND = 'false';
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(getAccountOverview).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'O comando Binance está desativado neste servidor.',
      ephemeral: true,
    });
  });

  it('não registra o comando /binance quando desativado', async () => {
    process.env.ENABLE_BINANCE_COMMAND = 'false';
    const { initBot } = await loadBot();

    await initBot();

    expect(setCommandsMock).toHaveBeenCalled();
    const registered = setCommandsMock.mock.calls[0][0];
    expect(registered.some(command => command.name === 'binance')).toBe(false);
  });

  it('reports credential issues on /binance command', async () => {
    getAccountOverview.mockRejectedValue(new Error('Missing Binance API credentials'));
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith('Credenciais da Binance não configuradas.');
  });

  it('reports generic failures on /binance command', async () => {
    getAccountOverview.mockRejectedValue(new Error('rate limit exceeded'));
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'binance',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith('Não foi possível carregar dados da Binance no momento.');
  });

  it('updates global minimum profit threshold through /settings profit default', async () => {
    settingsStore.minimumProfitThreshold = { default: 0.05, users: { existing: 0.12 } };
    const { handleInteraction } = await loadBot();
    const { CFG } = await import("../src/config.js");

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'settings',
      options: {
        getSubcommandGroup: () => 'profit',
        getSubcommand: () => 'default',
        getNumber: () => 15,
      },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(setSettingMock).toHaveBeenCalledWith('minimumProfitThreshold', {
      default: 0.15,
      users: { existing: 0.12 },
    });
    expect(CFG.minimumProfitThreshold.default).toBeCloseTo(0.15);
    expect(CFG.minimumProfitThreshold.users).toEqual({ existing: 0.12 });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Lucro mínimo padrão atualizado para 15%',
      ephemeral: true,
    });
  });

  it('updates personal minimum profit threshold through /settings profit personal', async () => {
    settingsStore.minimumProfitThreshold = { default: 0.03, users: { other: 0.09 } };
    const { handleInteraction } = await loadBot();
    const { CFG } = await import("../src/config.js");

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'settings',
      options: {
        getSubcommandGroup: () => 'profit',
        getSubcommand: () => 'personal',
        getNumber: () => 2.5,
      },
      user: { id: 'user-77' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(setSettingMock).toHaveBeenCalledWith('minimumProfitThreshold', {
      default: 0.03,
      users: { other: 0.09, 'user-77': 0.025 },
    });
    expect(CFG.minimumProfitThreshold.default).toBeCloseTo(0.03);
    expect(CFG.minimumProfitThreshold.users).toEqual({ other: 0.09, 'user-77': 0.025 });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Lucro mínimo pessoal atualizado para 2.50%',
      ephemeral: true,
    });
  });

  it('shows the configured minimum profit thresholds through /settings profit view', async () => {
    settingsStore.minimumProfitThreshold = { default: 0.04, users: { 'user-77': 0.07 } };
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'settings',
      options: {
        getSubcommandGroup: () => 'profit',
        getSubcommand: () => 'view',
      },
      user: { id: 'user-77' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: [
        'Lucro mínimo padrão: 4%',
        'Seu lucro mínimo: 7.00%',
        'Valor aplicado nas análises: 7.00%'
      ].join('\n'),
      ephemeral: true,
    });
  });

  it('falls back to default threshold when personal value is missing on /settings profit view', async () => {
    settingsStore.minimumProfitThreshold = { default: 0.05, users: {} };
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'settings',
      options: {
        getSubcommandGroup: () => 'profit',
        getSubcommand: () => 'view',
      },
      user: { id: 'user-999' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: [
        'Lucro mínimo padrão: 5%',
        'Seu lucro mínimo: usando o padrão do servidor',
        'Valor aplicado nas análises: 5%'
      ].join('\n'),
      ephemeral: true,
    });
  });

  it('validates the minimum profit percentage bounds', async () => {
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'settings',
      options: {
        getSubcommandGroup: () => 'profit',
        getSubcommand: () => 'default',
        getNumber: () => 150,
      },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Informe um percentual entre 0 e 100.',
      ephemeral: true,
    });
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('envia ordens spot respeitando limites de notional e risco', async () => {
    const { handleInteraction } = await loadBot();
    const { CFG } = await import("../src/config.js");
    CFG.accountEquity = 1000;
    CFG.trading = {
      enabled: true,
      minNotional: 50,
      maxPositionPct: 0.5,
      maxLeverage: 1,
    };

    placeOrder.mockResolvedValue({ orderId: 42, fillPrice: 25000 });

    const options = {
      getSubcommand: () => 'buy',
      getString: vi.fn((name) => (name === 'symbol' ? 'BTCUSDT' : null)),
      getNumber: vi.fn((name) => {
        if (name === 'quantity') return 0.01;
        if (name === 'price') return 25000;
        return null;
      }),
      getBoolean: vi.fn(() => false),
    };

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'trade',
      options,
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.01,
        price: undefined,
      }),
      expect.any(Object),
    );
    expect(openPosition).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    const message = interaction.reply.mock.calls[0][0].content;
    expect(message).toContain('Operação BUY BTCUSDT confirmada');
    expect(message).toContain('spot');
  });

  it('executa ordens de margem e realiza transferências automáticas', async () => {
    const { handleInteraction } = await loadBot();
    const { CFG } = await import("../src/config.js");
    CFG.accountEquity = 2000;
    CFG.trading = {
      enabled: true,
      minNotional: 100,
      maxPositionPct: 0.3,
      maxLeverage: 2,
    };

    adjustMargin.mockResolvedValue({ adjusted: true });
    openPosition.mockResolvedValue({ executed: true, order: { orderId: '789', fillPrice: 1600 } });

    const options = {
      getSubcommand: () => 'sell',
      getString: vi.fn((name) => (name === 'symbol' ? 'ETHUSDT' : null)),
      getNumber: vi.fn((name) => {
        if (name === 'quantity') return 0.5;
        if (name === 'price') return 1600;
        return null;
      }),
      getBoolean: vi.fn((name) => name === 'margin'),
    };

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'trade',
      options,
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(adjustMargin).toHaveBeenCalledTimes(2);
    expect(adjustMargin).toHaveBeenNthCalledWith(1, { operation: 'transferIn' });
    expect(adjustMargin).toHaveBeenNthCalledWith(2, { operation: 'borrow' });
    expect(openPosition).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'ETHUSDT',
      direction: 'short',
      quantity: 0.5,
      type: 'MARKET',
    }));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    const message = interaction.reply.mock.calls[0][0].content;
    expect(message).toContain('margin');
    expect(message).toContain('Operação SELL ETHUSDT confirmada');
  });

  it('valida o notional mínimo antes de enviar a ordem', async () => {
    const { handleInteraction } = await loadBot();
    const { CFG } = await import("../src/config.js");
    CFG.accountEquity = 1000;
    CFG.trading = {
      enabled: true,
      minNotional: 200,
      maxPositionPct: 0.5,
      maxLeverage: 1,
    };

    const options = {
      getSubcommand: () => 'buy',
      getString: vi.fn((name) => (name === 'symbol' ? 'SOLUSDT' : null)),
      getNumber: vi.fn((name) => {
        if (name === 'quantity') return 1;
        if (name === 'price') return 50;
        return null;
      }),
      getBoolean: vi.fn(() => false),
    };

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'trade',
      options,
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(placeOrder).not.toHaveBeenCalled();
    expect(openPosition).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(interaction.reply.mock.calls[0][0].content).toContain('abaixo do notional mínimo');
  });
});
