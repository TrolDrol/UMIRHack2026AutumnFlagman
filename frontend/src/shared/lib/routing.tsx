import { useContext } from "react";
import {
  Link,
  useNavigate,
  type LinkProps,
  type To,
  type NavigateOptions,
} from "react-router-dom";
import {
  WorkspaceContext,
  isCurrentContext,
  type RequestContext,
} from "../../app/workspace";
export function scopedTarget(to: To, context: RequestContext | null): To {
  if (!context) return to;
  const pathname = typeof to === "string" ? to.split(/[?#]/)[0] : to.pathname;
  if (
    !pathname?.startsWith("/") ||
    ["/login", "/register", "/enterprises"].includes(pathname)
  )
    return to;
  if (typeof to === "string") {
    const url = new URL(to, window.location.origin);
    if (!url.searchParams.has("warehouse"))
      url.searchParams.set("warehouse", context.warehouseId);
    return url.pathname + url.search + url.hash;
  }
  const search = new URLSearchParams(to.search);
  if (!search.has("warehouse")) search.set("warehouse", context.warehouseId);
  return { ...to, search: `?${search}` };
}
export function ScopedLink({ to, state, ...props }: LinkProps) {
  const context = useContext(WorkspaceContext);
  return (
    <Link
      {...props}
      to={scopedTarget(to, context)}
      state={{ ...state, warehouseId: context?.warehouseId }}
    />
  );
}
export function useScopedNavigate() {
  const navigate = useNavigate();
  const context = useContext(WorkspaceContext);
  return (to: To, options?: NavigateOptions) => {
    if (context && !isCurrentContext(context)) return;
    return navigate(scopedTarget(to, context), {
      ...options,
      state: options?.state
        ? { ...options.state, warehouseId: context?.warehouseId }
        : options?.state,
    });
  };
}
