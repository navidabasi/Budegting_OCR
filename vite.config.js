import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
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
                // POST /share is handled by the service worker (src/sw.js) and redirects to /scan?shared=1.
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
            injectManifest: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
                // pdf.js (renderer + worker, ~1.7 MB) is cached on first use by src/sw.js
                globIgnores: ['**/pdf.worker*', '**/assets/pdf-*']
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
