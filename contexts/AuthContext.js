import React, { createContext, useCallback, useContext, useMemo } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children, isAuthenticated, setIsAuthenticated }) {
  const login = useCallback(() => setIsAuthenticated(true), [setIsAuthenticated]);
  const logout = useCallback(() => setIsAuthenticated(false), [setIsAuthenticated]);

  const value = useMemo(
    () => ({ isAuthenticated, login, logout, setIsAuthenticated }),
    [isAuthenticated, login, logout, setIsAuthenticated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}


