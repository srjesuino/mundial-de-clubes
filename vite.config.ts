import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// base: relativa por padrão (funciona em qualquer pasta); no deploy do GitHub Pages, BASE=/<repo>/ deixa os
// caminhos absolutos, e o service worker só responde pela raiz do app (uma URL mais funda dá o 404 do Pages)
const base = process.env.BASE || './';
const absolute = base.startsWith('/');
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineConfig({
  base,
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    VitePWA({
      // 'prompt': a versão nova só entra quando é seguro (nunca no meio de uma partida, sorteio ou plantão)
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mundial de Clubes 64',
        short_name: 'Mundial 64',
        description: 'Simulador de torneio de clubes de futebol com partidas jogáveis.',
        lang: 'pt-BR',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        ...(absolute ? { navigateFallbackAllowlist: [new RegExp('^' + escapeRe(base) + '(index\\.html)?$')] } : {}),
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // escudos dos clubes vêm de um servidor externo: cache para jogar offline depois da 1ª visita
        runtimeCaching: [{
          urlPattern: /^https:\/\/tmssl\.akamaized\.net\/images\/wappen\//,
          handler: 'CacheFirst',
          // pedidos com CORS (crossorigin=anonymous): só respostas 200 de verdade, sem o tamanho inflado das opacas
          options: { cacheName: 'escudos-v2', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [200] } }
        }]
      }
    })
  ]
});
