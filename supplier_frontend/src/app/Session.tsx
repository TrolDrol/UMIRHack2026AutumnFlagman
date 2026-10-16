import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  HttpError,
  identify,
  type Connection,
  type Mode,
} from "../shared/api/client";
type SessionValue = {
  connection: Connection | null;
  connect: (mode: Mode, warehouseId: string, key: string) => Promise<void>;
  disconnect: () => void;
  handleError: (error: unknown) => void;
  error: string;
  connecting: boolean;
};
const SessionContext = createContext<SessionValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const generation = useRef(0);
  const disconnect = useCallback(() => {
    generation.current++;
    setConnection(null);
    setConnecting(false);
  }, []);
  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof HttpError && error.status === 401) {
        disconnect();
        setError("Ключ недействителен. Подключитесь повторно.");
      }
    },
    [disconnect],
  );
  const connect = async (mode: Mode, warehouseId: string, key: string) => {
    const current = ++generation.current;
    setConnecting(true);
    setError("");
    setConnection(null);
    try {
      const next = await identify(mode, warehouseId, key);
      if (current === generation.current) setConnection(next);
    } catch (error) {
      if (current === generation.current) setError((error as Error).message);
      throw error;
    } finally {
      if (current === generation.current) setConnecting(false);
    }
  };
  return (
    <SessionContext.Provider
      value={{
        connection,
        connect,
        disconnect,
        handleError,
        error,
        connecting,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Нет подключения");
  return value;
}
