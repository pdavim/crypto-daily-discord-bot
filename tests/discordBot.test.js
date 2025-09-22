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

vi.mock('../src/data/binance.js', () => ({ fetchOHLCV }));
vi.mock('../src/chart.js', () => ({ renderChartPNG }));
vi.mock('../src/watchlist.js', () => ({ addAssetToWatch, removeAssetFromWatch, getWatchlist }));

// environment setup for assets
process.env.BINANCE_SYMBOL_BTC = 'BTCUSDT';

async function loadBot() {
  return import('../src/discordBot.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
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
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(addAssetToWatch).toHaveBeenCalledWith('BTC');
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
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(removeAssetFromWatch).toHaveBeenCalledWith('BTC');
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
      reply: vi.fn(),
    };

    await handleInteraction(interaction);

    expect(getWatchlist).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('BTC, ETH'),
      ephemeral: true,
    });
  });
});
