import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [
        react()
    ],
    // Evitar que Vite borre la consola para ver logs de Tauri
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
        host: '127.0.0.1',
        // No proxy needed: localApiBridge.js intercepts all /api/* fetches
        // and routes them directly to Tauri invoke commands (100% offline desktop)
    },
    build: {
        target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
        minify: !process.env.TAURI_DEBUG,
        sourcemap: !!process.env.TAURI_DEBUG,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('react/') || id.includes('react-dom/') || id.includes('react-router-dom/')) {
                            return 'react-vendor';
                        }
                        if (id.includes('react-toastify') || id.includes('react-to-print')) {
                            return 'ui-vendor';
                        }
                        if (id.includes('html5-qrcode') || id.includes('qrcode')) {
                            return 'scanner-vendor';
                        }
                        if (id.includes('axios')) {
                            return 'http-vendor';
                        }
                    }
                }
            }
        },
        chunkSizeWarningLimit: 1000
    }
})
