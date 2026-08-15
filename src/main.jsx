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

// Interceptor global de fetch para manejar sesiones expiradas (Errores 401)
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401) {
        if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
        }
    }
    return response;
};

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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
            <App />
        </QueryClientProvider>
    </React.StrictMode>,
)
