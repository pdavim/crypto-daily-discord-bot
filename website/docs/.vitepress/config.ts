import { defineConfig } from 'vitepress'

const siteTitle = 'Crypto Daily Discord Bot'
const siteDescription =
  'Documentação oficial do bot que entrega análises, gráficos e alertas diários de cripto no Discord.'

const repoName = 'crypto-daily-discord-bot'
const githubOwner = process.env.DOCS_GITHUB_OWNER ?? 'OWNER'
const siteUrl = process.env.DOCS_SITE_URL ?? `https://${githubOwner}.github.io/${repoName}/`
const docsBase = process.env.DOCS_BASE ?? `/${repoName}/`
const ogImage = `${siteUrl}social-card.svg`

export default defineConfig({
  title: siteTitle,
  description: siteDescription,
  lang: 'pt-BR',
  base: docsBase,
  lastUpdated: true,
  cleanUrls: true,
  sitemap: {
    hostname: siteUrl
  },
  head: [
    ['meta', { name: 'description', content: siteDescription }],
    ['meta', { name: 'keywords', content: 'discord bot, criptomoedas, indicadores técnicos, alertas de preço' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: siteTitle }],
    ['meta', { property: 'og:description', content: siteDescription }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:type', content: 'image/svg+xml' }],
    ['meta', { property: 'og:site_name', content: siteTitle }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: siteTitle }],
    ['meta', { name: 'twitter:description', content: siteDescription }],
    ['meta', { name: 'twitter:image', content: ogImage }],
    ['link', { rel: 'canonical', href: siteUrl }]
  ],
  themeConfig: {
    nav: [
      { text: 'Início', link: '/' },
      { text: 'Guia rápido', link: '/guide/introducao' },
      { text: 'Notas de versão', link: '/guide/releases' },
      { text: 'Identidade visual', link: '/guide/identidade-visual' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guia',
          items: [
            { text: 'Introdução', link: '/guide/introducao' },
            { text: 'Deploy no Discord', link: '/guide/deploy-discord' },
            { text: 'Hospedagem na GitHub Pages', link: '/guide/github-pages' },
            { text: 'Identidade visual e assets', link: '/guide/identidade-visual' },
            { text: 'Release Notes', link: '/guide/releases' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: `https://github.com/${githubOwner}/${repoName}` }
    ],
    footer: {
      message: 'Conteúdo licenciado sob MIT License.',
      copyright: `© ${new Date().getFullYear()} Equipe Crypto Daily`
    }
  }
})
