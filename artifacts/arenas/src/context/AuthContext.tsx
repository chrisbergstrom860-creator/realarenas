import { createContext, useContext, useState, ReactNode } from "react";

interface AuthContextValue {
  isLoggedIn: boolean;
  isClub: boolean;
  login: () => void;
  loginAsClub: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isLoggedIn: false,
  isClub: false,
  login: () => {},
  loginAsClub: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => sessionStorage.getItem("arenas_logged_in") === "1");
  const [isClub, setIsClub]         = useState(() => sessionStorage.getItem("arenas_club") === "1");

  function login() {
    sessionStorage.setItem("arenas_logged_in", "1");
    sessionStorage.removeItem("arenas_club");
    setIsLoggedIn(true);
    setIsClub(false);
  }

  function loginAsClub() {
    sessionStorage.setItem("arenas_logged_in", "1");
    sessionStorage.setItem("arenas_club", "1");
    setIsLoggedIn(true);
    setIsClub(true);
  }

  function logout() {
    sessionStorage.removeItem("arenas_logged_in");
    sessionStorage.removeItem("arenas_club");
    setIsLoggedIn(false);
    setIsClub(false);
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, isClub, login, loginAsClub, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
