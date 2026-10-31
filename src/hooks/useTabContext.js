import React, { createContext, useContext } from 'react';

// Contexto para simular useOutletContext en el sistema de pestañas Keep-Alive
const TabContext = createContext(null);

export const TabProvider = ({ children, value, setTitle }) => {
    const effectiveValue = value || (setTitle ? { setTitle } : { setTitle: () => {} });
    return React.createElement(TabContext.Provider, { value: effectiveValue }, children);
};

export const useTabContext = () => {
    const ctx = useContext(TabContext);
    return ctx || { setTitle: () => {} };
};

export const useIsTabActive = () => true;
