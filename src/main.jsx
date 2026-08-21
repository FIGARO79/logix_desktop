import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './styles/Global.css'

// Polyfill para crypto.randomUUID en entornos no seguros (HTTP)
if (typeof window !== 'undefined' && !window.crypto.randomUUID) {
    window.crypto.randomUUID = function () {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    };
}

import axios from 'axios';
import { handleLocalApiRequest } from './utils/localApiBridge';

// Interceptor global de fetch para operar 100% en modo standalone local sin servidor backend
const originalFetch = window.fetch;
window.fetch = async (resource, options = {}) => {
    const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : String(resource));

    // Si es una ruta de API (/api/...), se resuelve 100% de forma local en SQLite / IndexedDB
    if (url.startsWith('/api/') || url.includes('/api/')) {
        return await handleLocalApiRequest(url, options);
    }

    return await originalFetch(resource, options);
};

// Interceptor global de Axios para resolver 100% de forma local
axios.interceptors.request.use(async (config) => {
    if (config.url && (config.url.startsWith('/api/') || config.url.includes('/api/'))) {
        const fetchOptions = {
            method: (config.method || 'get').toUpperCase(),
            headers: config.headers,
            body: config.data ? (typeof config.data === 'string' ? config.data : JSON.stringify(config.data)) : undefined
        };
        let targetUrl = config.url;
        if (config.params) {
            const sp = new URLSearchParams(config.params);
            targetUrl += (targetUrl.includes('?') ? '&' : '?') + sp.toString();
        }
        const resp = await handleLocalApiRequest(targetUrl, fetchOptions);
        const data = await resp.json().catch(() => ({}));
        config.adapter = () => Promise.resolve({
            data,
            status: resp.status,
            statusText: resp.statusText,
            headers: {},
            config,
            request: {}
        });
    }
    return config;
}, (error) => Promise.reject(error));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from './context/LanguageContext'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: true,
            retry: 1,
            staleTime: 5000,
        },
    },
});

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <LanguageProvider>
                <App />
            </LanguageProvider>
        </QueryClientProvider>
    </React.StrictMode>,
)
