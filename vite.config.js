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
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: true,
                secure: false,
                ws: false,
            }
        }
    },
    build: {
        target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
        minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_DEBUG,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'ui-vendor': ['react-toastify', 'react-to-print'],
                    'scanner-vendor': ['html5-qrcode', 'qrcode'],
                    'http-vendor': ['axios']
                }
            }
        },
        chunkSizeWarningLimit: 1000
    }
})
