import { useEffect, useRef } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

export function useErrorScroll<T extends FieldValues>(
  form: UseFormReturn<T>,
  error?: unknown,
) {
  const ref = useRef<HTMLFormElement>(null);
  const { submitCount, isSubmitting, errors } = form.formState;
  const previous = useRef({ submitCount: 0, error });
  useEffect(() => {
    if (isSubmitting) return;
    const changed =
      previous.current.submitCount !== submitCount ||
      previous.current.error !== error;
    previous.current = { submitCount, error };
    if (!changed || (!error && !Object.keys(errors).length)) return;
    const frame = requestAnimationFrame(() => {
      const candidates = ref.current?.querySelectorAll<HTMLElement>(
        '[aria-invalid="true"], [data-form-error], [role="alert"]',
      );
      const target = [...(candidates || [])].find(
        (element) =>
          element.getClientRects().length &&
          !element.closest('[aria-hidden="true"]') &&
          (element.getAttribute("aria-invalid") === "true" ||
            element.textContent?.trim()),
      );
      if (!target) return;
      const control = target.matches("input,select,textarea,button")
        ? target
        : target.parentElement?.querySelector<HTMLElement>(
            '[aria-invalid="true"]',
          );
      control?.focus({ preventScroll: true });
      target.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [submitCount, isSubmitting, errors, error]);
  return ref;
}
