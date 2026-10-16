import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  request,
  ApiError,
  mode,
  currentSessionEpoch,
} from "../shared/api/client";
import type { User } from "../shared/api/types";
const Context = createContext<{
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  user: null,
  loading: true,
  error: "",
  refresh: async () => {},
  logout: async () => {},
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const epoch = currentSessionEpoch();
    setLoading(true);
    setError("");
    try {
      const u = await request<User>("/auth/me");
      if (epoch !== currentSessionEpoch()) return;
      if (u.role !== "customer")
        throw new Error("Требуется аккаунт покупателя");
      setUser(u);
    } catch (e) {
      if (epoch !== currentSessionEpoch()) return;
      setUser(null);
      if (!(e instanceof ApiError && e.status === 401))
        setError(
          e instanceof Error ? e.message : "Не удалось проверить сессию",
        );
    } finally {
      if (epoch === currentSessionEpoch()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const clear = () => {
      setUser(null);
      void cache.cancelQueries();
      cache.clear();
    };
    window.addEventListener("customer:unauthorized", clear);
    const changed = () => {
      clear();
      void refresh();
    };
    window.addEventListener("customer:session-changed", changed);
    return () => {
      window.removeEventListener("customer:unauthorized", clear);
      window.removeEventListener("customer:session-changed", changed);
    };
  }, [cache, refresh]);
  const logout = async () => {
    await request("/auth/logout", { method: "POST" });
    setUser(null);
    await cache.cancelQueries();
    cache.clear();
  };
  return (
    <Context.Provider value={{ user, loading, error, refresh, logout }}>
      {mode === "demo" && (
        <div role="note" className="demo">
          Демонстрация · учебные заказы · данные только в этом браузере
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
