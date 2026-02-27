import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, resetCsrf } from "./queryClient";

export interface User {
  id: string;
  email: string;
  role: string;
  companyId: string;
  isAdmin?: boolean;
  firstName?: string | null;
  lastName?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userInitialized, setUserInitialized] = useState(false);

  const { data, isLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
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
    mutationFn: async ({ email, password }: { email: string; password: string }) =>
      apiRequest<User>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (userData) => {
      resetCsrf(); // session changed → force fresh CSRF token
      setUser(userData);
      queryClient.setQueryData(["/api/auth/me"], userData);
    },
  });

  const signupMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) =>
      apiRequest<User>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (userData) => {
      resetCsrf(); // session changed → force fresh CSRF token
      setUser(userData);
      queryClient.setQueryData(["/api/auth/me"], userData);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () =>
      apiRequest("/api/auth/logout", { method: "POST" }),
    onMutate: () => {
      setUser(null);
      queryClient.cancelQueries();
    },
    onSuccess: () => {
      resetCsrf(); // session destroyed → clear CSRF
      queryClient.clear();
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isLoading || !userInitialized,
        login: (e, p) => loginMutation.mutateAsync({ email: e, password: p }),
        signup: (e, p) => signupMutation.mutateAsync({ email: e, password: p }),
        logout: () => logoutMutation.mutateAsync(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
