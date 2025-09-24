import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  },
}));

// mock dependencies
const fetchOHLCV = vi.fn();
const renderChartPNG = vi.fn();
const addAssetToWatch = vi.fn();
const removeAssetFromWatch = vi.fn();
const getWatchlist = vi.fn(() => []);
const getAccountOverview = vi.fn();

vi.mock('../src/data/binance.js', () => ({ fetchOHLCV }));
vi.mock('../src/chart.js', () => ({ renderChartPNG }));
vi.mock('../src/watchlist.js', () => ({ addAssetToWatch, removeAssetFromWatch, getWatchlist }));
vi.mock('../src/trading/binance.js', () => ({ getAccountOverview }));

// environment setup for assets
process.env.BINANCE_SYMBOL_BTC = 'BTCUSDT';

async function loadBot() {
  return import('../src/discordBot.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getAccountOverview.mockReset();
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

    expect(fetchOHLCV).toHaveBeenCalledWith('BTCUSDT', '15m');
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

  it('handles /status command', async () => {
    getWatchlist.mockReturnValue(['BTC', 'ETH']);
    const { handleInteraction } = await loadBot();

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'status',
      user: { id: 'user-5' },
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(getWatchlist).toHaveBeenCalledWith('user-5');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('BTC, ETH'),
      ephemeral: true,
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
    expect(message).toContain('... e mais 1 ativos');
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
});
