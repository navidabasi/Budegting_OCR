import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg', 'pwa-maskable-192x192.png', 'pwa-maskable-512x512.png'],
            manifest: {
                name: 'Where my money went?',
                short_name: 'Where my money went?',
                description: 'Track where your money goes with receipt scanning and expense management',
                theme_color: '#00573F',
                background_color: '#F4F6F3',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                orientation: 'portrait',
                // Web Share Target: receive receipts (images/PDF) shared from other apps.
                // The /share handler (service worker) is implemented in plan task P2-T6.
                share_target: {
                    action: '/share',
                    method: 'POST',
                    enctype: 'multipart/form-data',
                    params: {
                        files: [{ name: 'files', accept: ['image/*', 'application/pdf'] }]
                    }
                },
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-maskable-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'maskable'
                    },
                    {
                        src: 'pwa-maskable-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            workbox: {
                // PGlite ships large wasm/data assets required for true offline startup.
                // Increase precache file-size cap so Workbox includes them.
                maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,data}'],
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api/],
                runtimeCaching: [
                    {
                        urlPattern: /\.wasm$/,
                        handler: 'CacheFirst',
                        options: { cacheName: 'wasm-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } }
                    },
                    {
                        urlPattern: /\.data$/,
                        handler: 'CacheFirst',
                        options: { cacheName: 'wasm-data-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } }
                    }
                ]
            }
        })
    ],
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.{js,jsx}'],
        globals: false
    },
    optimizeDeps: {
        include: ['react', 'react-dom', 'react-router-dom', '@supabase/supabase-js', 'dexie', 'zustand']
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '/api')
            }
        }
    },
    // Exclude SQL files and other non-JS files from processing
    assetsInclude: ['**/*.sql'],
    build: {
        rollupOptions: {
            external: (id) => id.endsWith('.sql')
        }
    }
})
