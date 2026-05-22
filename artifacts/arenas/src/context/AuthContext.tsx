import { createContext, useContext, useState, ReactNode } from "react";

interface AuthContextValue {
  isLoggedIn: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isLoggedIn: false,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return sessionStorage.getItem("arenas_logged_in") === "1";
  });

  function login() {
    sessionStorage.setItem("arenas_logged_in", "1");
    setIsLoggedIn(true);
  }

  function logout() {
    sessionStorage.removeItem("arenas_logged_in");
    setIsLoggedIn(false);
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
