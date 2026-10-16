import type { PublicCombo } from "@rims/demo-api/contracts";
export type CartCombo = {
  comboId: string;
  version: number;
  quantity: number;
  title: string;
  components: PublicCombo["components"];
};
import { createContext, useContext, useState, type ReactNode } from "react";
import { scope, read, write, pendingFor } from "../../shared/lib/storage";
import type { OrderInput } from "../../shared/api/types";
const Context = createContext<{
  lines: OrderInput["lines"];
  combos: CartCombo[];
  setCombos: (combos: CartCombo[]) => void;
  locked: boolean;
  error: string;
  setLines: (lines: OrderInput["lines"]) => void;
}>({
  lines: [],
  combos: [],
  setCombos: () => {},
  locked: false,
  error: "",
  setLines: () => {},
});
export function CartProvider({
  user,
  id,
  children,
}: {
  user: string;
  id: string;
  children: ReactNode;
}) {
  const key = scope(user, id) + ".cart";
  const [lines, update] = useState(() => read<OrderInput["lines"]>(key, []));
  const [combos, updateCombos] = useState(() =>
    read<CartCombo[]>(key + ".combos", []),
  );
  const [error, setError] = useState("");
  // Validate pending before showing any body; evaluate again after navigation.
  pendingFor(user, id);
  const setLines = (next: OrderInput["lines"]) => {
    if (pendingFor(user, id)) return;
    try {
      write(key, next);
      update(next);
      setError("");
    } catch {
      setError("Не удалось сохранить корзину: проверьте доступ к хранилищу.");
    }
  };
  const setCombos = (next: CartCombo[]) => {
    if (pendingFor(user, id)) return;
    try {
      write(key + ".combos", next);
      updateCombos(next);
      setError("");
    } catch {
      setError("Cart storage unavailable");
    }
  };
  return (
    <Context.Provider
      value={{
        lines,
        combos,
        setCombos,
        get locked() {
          return !!pendingFor(user, id);
        },
        error,
        setLines,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useCart = () => useContext(Context);
