import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./queryClient";

interface User {
  id: string;
  email: string;
  role: string;
  companyId: string;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userInitialized, setUserInitialized] = useState(false);

  const { data, isLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  useEffect(() => {
    if (data) {
      setUser(data);
      setUserInitialized(true);
    } else if (isError || data === null) {
      setUser(null);
      setUserInitialized(true);
    }
  }, [data, isError]);

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      // Fixed: Use correct apiRequest signature (url, options)
      return await apiRequest<User>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    },
    onSuccess: (userData) => {
      setUser(userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
    },
  });

  const signupMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      // Fixed: Use correct apiRequest signature (url, options)
      return await apiRequest<User>("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    },
    onSuccess: (userData) => {
      setUser(userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Fixed: Use correct apiRequest signature (url, options)
      await apiRequest("/api/auth/logout", {
        method: "POST",
      });
    },
    onMutate: () => {
      setUser(null);
      queryClient.cancelQueries();
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });

  const login = async (email: string, password: string) => {
    await loginMutation.mutateAsync({ email, password });
  };

  const signup = async (email: string, password: string) => {
    await signupMutation.mutateAsync({ email, password });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: isLoading || !userInitialized, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}