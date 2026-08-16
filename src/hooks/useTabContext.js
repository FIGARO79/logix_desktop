import React, { createContext, useContext } from 'react';

// Contexto para simular useOutletContext en el sistema de pestañas Keep-Alive
const TabContext = createContext({ setTitle: () => {} });

export const TabProvider = ({ children, value }) => {
    return React.createElement(TabContext.Provider, { value: value || { setTitle: () => {} } }, children);
};

export const useTabContext = () => {
    const ctx = useContext(TabContext);
    return ctx || { setTitle: () => {} };
};
