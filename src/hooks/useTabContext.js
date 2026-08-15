import React, { createContext, useContext } from 'react';

// Contexto para simular useOutletContext en el sistema de pestañas Keep-Alive
const TabContext = createContext(null);

export const TabProvider = ({ children, value }) => {
    return React.createElement(TabContext.Provider, { value: value }, children);
};

export const useTabContext = () => {
    return useContext(TabContext);
};
