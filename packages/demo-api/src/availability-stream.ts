// Transport only: no React, mock data or mutations. Shared by staff/customer.
export type StreamState = "connecting" | "connected" | "reconnecting";
export function connectAvailability(options: {
  url: string;
  warehouseId: string;
  changed: () => void;
  state: (state: StreamState) => void;
}) {
  let stopped = false,
    socket: WebSocket | undefined,
    retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0,
    lastMessage = Date.now(),
    version = "";
  const start = () => {
    if (stopped) return;
    options.state(attempt ? "reconnecting" : "connecting");
    if (!navigator.onLine) {
      schedule();
      return;
    }
    version = "";
    lastMessage = Date.now();
    let current: WebSocket;
    try {
      current = new WebSocket(options.url);
    } catch {
      options.state("reconnecting");
      schedule();
      return;
    }
    socket = current;
    current.onmessage = ({ data }) => {
      if (
        stopped ||
        socket !== current ||
        typeof data !== "string" ||
        data.length > 2048
      )
        return;
      try {
        const notice = JSON.parse(data);
        if (
          notice.type !== "availability.changed" ||
          notice.warehouseId !== options.warehouseId ||
          typeof notice.backendInstanceId !== "string" ||
          typeof notice.revision !== "string" ||
          typeof notice.clockVersion !== "string"
        )
          return;
        lastMessage = Date.now();
        attempt = 0;
        const next = `${notice.backendInstanceId}:${notice.revision}:${notice.clockVersion}`;
        options.state("connected");
        if (next !== version) {
          version = next;
          options.changed();
        }
      } catch {
        /* Invalid frames do not establish a healthy connection. */
      }
    };
    current.onopen = () => {
      lastMessage = Date.now();
    };
    current.onerror = () => current.close();
    current.onclose = () => {
      if (stopped || socket !== current) return;
      options.state("reconnecting");
      schedule();
    };
  };
  const schedule = () => {
    if (stopped || retry) return;
    const delay =
      Math.min(15000, 500 * 2 ** Math.min(attempt++, 5)) + Math.random() * 300;
    retry = setTimeout(() => {
      retry = undefined;
      start();
    }, delay);
  };
  const reconnect = () => {
    version = ""; // Full resync after offline/resume, even if the revision is unchanged.
    if (retry) clearTimeout(retry);
    retry = undefined;
    const previous = socket;
    socket = undefined;
    previous?.close();
    start();
  };
  const offline = () => {
    socket?.close();
    options.state("reconnecting");
  };
  const visible = () => {
    if (
      document.visibilityState === "visible" &&
      Date.now() - lastMessage > 20000
    )
      reconnect();
  };
  const watchdog = setInterval(() => {
    if (socket && Date.now() - lastMessage > 25000) socket.close();
  }, 5000);
  window.addEventListener("online", reconnect);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", visible);
  start();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    clearInterval(watchdog);
    window.removeEventListener("online", reconnect);
    window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", visible);
    socket?.close();
  };
}
