import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./Session";
import { Connect } from "./Connect";
import { Workspace } from "./Workspace";
import { scope } from "../shared/api/operations";
function Screen() {
  const { connection } = useSession();
  return connection ? (
    <Workspace key={scope(connection)} connection={connection} />
  ) : (
    <Connect />
  );
}
export function App() {
  return (
    <BrowserRouter basename="/supplier">
      <SessionProvider>
        <Routes>
          <Route path="/connect" element={<Screen />} />
          <Route path="/requests" element={<Screen />} />
          <Route path="/requests/:id" element={<Screen />} />
          <Route path="*" element={<Navigate to="/requests" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
