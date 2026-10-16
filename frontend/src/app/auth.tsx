import { runtimeNamespace } from "@rims/demo-api/runtime";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, HttpError, clearRateLimits } from "../shared/api/client";
import type { Membership, User, Envelope } from "../shared/api/types";
import {
  activateContext,
  renewSession,
  sessionVersion,
  WorkspaceContext,
  scopeKey,
  isCurrentContext,
  type RequestContext,
} from "./workspace";
import { ActionButton, ErrorNotice, s } from "../shared/ui";
import { ExportAuthorContext } from "../shared/ui/TableDownload";
type Auth = {
  operator: User | null;
  loading: boolean;
  workspace: RequestContext | null;
  memberships: Membership[];
  membershipsLoading: boolean;
  membershipsError: unknown;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  select: (warehouseId: string) => Promise<void>;
  refreshMemberships: () => Promise<unknown>;
};
const Context = createContext<Auth>(null!);
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [operator, setOperator] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const memberships = useQuery({
    queryKey: ["memberships", runtimeNamespace(), operator?.id],
    enabled: !!operator,
    queryFn: ({ signal }) =>
      request<Membership[]>("/me/memberships", { signal }),
    refetchInterval: () =>
      document.visibilityState === "visible" && navigator.onLine
        ? 15000
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const membership = memberships.data?.data.find(
    (m) => m.warehouseId === selected,
  );
  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE !== "true" || !operator) return;
    const changed = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === "rims.demo.registry.v2" || event.key === null)
      )
        void client.invalidateQueries({
          queryKey: ["memberships", runtimeNamespace(), operator.id],
        });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [client, operator]);
  const version = sessionVersion();
  const workspace = useMemo<RequestContext | null>(
    () =>
      operator && membership && !validating && !memberships.error
        ? {
            ...membership,
            userId: operator.id,
            sessionVersion: version,
            runtimeScope: runtimeNamespace(),
          }
        : null,
    [operator, membership, validating, memberships.error, version],
  );
  activateContext(workspace);
  const previous = useRef<RequestContext | null>(null);
  useEffect(() => {
    if (validating) return;
    const old = previous.current;
    previous.current = workspace;
    if (
      old &&
      (!workspace ||
        old.role !== workspace.role ||
        old.warehouseId !== workspace.warehouseId)
    ) {
      const queryKey = scopeKey(old);
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    }
  }, [workspace, validating, client]);
  const reset = async () => {
    renewSession();
    clearRateLimits();
    setSelected(null);
    setOperator(null);
    setLoading(false);
    await client.cancelQueries();
    client.clear();
  };
  const check = async () => {
    const checkedVersion = sessionVersion();
    setLoading(true);
    setError(null);
    try {
      const me = await request<User>("/auth/me");
      if (checkedVersion !== sessionVersion()) return;
      setOperator(me.data);
      setSelected(sessionStorage.getItem(`rims.workspace.${me.data.id}`));
    } catch (e) {
      if (checkedVersion !== sessionVersion()) return;
      if (!(e instanceof HttpError && e.status === 401)) setError(e);
    } finally {
      if (checkedVersion === sessionVersion()) setLoading(false);
    }
  };
  useEffect(() => {
    void check();
    const unauthorized = () => {
      void reset();
    };
    window.addEventListener("flagman:unauthorized", unauthorized);
    const changed = () => {
      void reset().then(check);
    };
    const channel =
      import.meta.env.VITE_DEMO_MODE !== "true" &&
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("rims.staff.session")
        : null;
    channel?.addEventListener("message", changed);
    window.addEventListener("rims:session-changed", changed);
    return () => {
      window.removeEventListener("flagman:unauthorized", unauthorized);
      window.removeEventListener("rims:session-changed", changed);
      channel?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const verify = (event: Event) => {
      const ctx = (event as CustomEvent<RequestContext>).detail;
      if (
        ctx.userId !== operator?.id ||
        ctx.warehouseId !== selected ||
        !isCurrentContext(ctx)
      )
        return;
      activateContext(null);
      setValidating(true);
      void memberships.refetch().finally(() => setValidating(false));
    };
    window.addEventListener("rims:access-check", verify);
    return () => window.removeEventListener("rims:access-check", verify);
  }, [client, operator?.id, selected, memberships]);
  const authenticate = async (path: string, body: object) => {
    await reset();
    const me = await request<User>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setOperator(me.data);
    setError(null);
  };
  const select = async (warehouseId: string) => {
    if (
      !client
        .getQueryData<Envelope<Membership[]>>([
          "memberships",
          runtimeNamespace(),
          operator?.id,
        ])
        ?.data.some((m) => m.warehouseId === warehouseId)
    )
      throw new Error("Нет доступа к предприятию");
    activateContext(null);
    setSelected(null);
    await client.cancelQueries({ queryKey: ["warehouse"] });
    client.removeQueries({ queryKey: ["warehouse"] });
    sessionStorage.setItem(`rims.workspace.${operator!.id}`, warehouseId);
    setSelected(warehouseId);
  };
  if (error)
    return (
      <main className={s.panel}>
        <h1>Не удалось проверить сессию</h1>
        <ErrorNotice error={error} />
        <ActionButton onClick={() => void check()}>Повторить</ActionButton>
      </main>
    );
  return (
    <Context.Provider
      value={{
        operator,
        loading,
        workspace,
        memberships: memberships.data?.data || [],
        membershipsLoading: memberships.isLoading || validating,
        membershipsError: memberships.error,
        login: (username, password) =>
          authenticate("/auth/login", { username, password }),
        register: (username, password, displayName) =>
          authenticate("/auth/register", { username, password, displayName }),
        logout: async () => {
          await request("/auth/logout", { method: "POST" });
          await reset();
        },
        select,
        refreshMemberships: async () => {
          const result = await memberships.refetch();
          if (result.error) throw result.error;
          const updated = result.data?.data.find(
            (m) => m.warehouseId === selected,
          );
          if (selected && (!updated || updated.role !== membership?.role)) {
            activateContext(null);
            throw new Error(
              "Права изменились. Выберите доступное предприятие и повторите действие.",
            );
          }
          return result;
        },
      }}
    >
      <WorkspaceContext.Provider value={workspace}>
        <ExportAuthorContext.Provider value={operator}>
          {children}
        </ExportAuthorContext.Provider>
      </WorkspaceContext.Provider>
    </Context.Provider>
  );
}
