import {
  useWorkspace,
  sameScope,
  type RequestContext,
} from "../../app/workspace";
import { useEffect, useRef, useState } from "react";
import { useBlocker, useLocation } from "react-router-dom";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { HttpError } from "../api/client";
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
export function useUnsaved(dirty: boolean) {
  const context = useWorkspace();
  const confirmed = useRef(false);
  const location = useLocation();
  useEffect(() => {
    if (!dirty) confirmed.current = false;
  }, [dirty]);
  useEffect(() => {
    const resolve = (event: Event) => {
      if (
        sameScope(
          (event as CustomEvent<{ context: RequestContext }>).detail.context,
          context,
        ) &&
        location.pathname ===
          `${(event as CustomEvent<{ path: string }>).detail.path}/new`
      )
        confirmed.current = true;
    };
    window.addEventListener("flagman:confirmed", resolve);
    return () => window.removeEventListener("flagman:confirmed", resolve);
  }, [location.pathname, context]);
  const blocker = useBlocker(() => dirty && !confirmed.current);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("Есть несохранённые изменения. Покинуть страницу?"))
        blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
export function fieldErrors<T extends FieldValues>(
  error: unknown,
  form: UseFormReturn<T>,
) {
  if (error instanceof HttpError)
    for (const field of error.payload.error.details.fields || [])
      form.setError(field.path as Path<T>, {
        type: "server",
        message: field.message,
      });
}
export function draftKey(context: RequestContext, name: string) {
  return `rims.draft.v3.${context.runtimeScope}.staff.${context.userId}.${context.warehouseId}.${name}`;
}
export function loadDraft<T>(
  context: RequestContext,
  name: string,
  fallback: T,
): T {
  try {
    return (
      JSON.parse(sessionStorage.getItem(draftKey(context, name)) || "null") ||
      fallback
    );
  } catch {
    return fallback;
  }
}
export function useDraft<T extends FieldValues>(
  context: RequestContext,
  name: string,
  form: UseFormReturn<T>,
) {
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const sub = form.watch((values) => {
      try {
        sessionStorage.setItem(draftKey(context, name), JSON.stringify(values));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    });
    return () => sub.unsubscribe();
  }, [context, name, form]);
  return storageError;
}
export function clearDraft(context: RequestContext, name: string) {
  try {
    sessionStorage.removeItem(draftKey(context, name));
    return true;
  } catch {
    return false;
  }
}
