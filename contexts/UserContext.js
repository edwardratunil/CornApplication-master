import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const initialUser = {
  id: null,
  firstName: '',
  lastName: '',
  email: '',
  role: 'user',
  avatar: 'farmer1',
};

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser] = useState(initialUser);

  const updateUser = useCallback((updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetUser = useCallback(() => {
    setUser(initialUser);
  }, []);

  const value = useMemo(() => ({ user, updateUser, resetUser }), [user, updateUser, resetUser]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

