import type { Ref } from "react";
import { Field } from "./index";

type Props = {
  label: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  ref?: Ref<HTMLInputElement>;
};
export function DateTimePicker({
  label,
  error,
  value,
  onChange,
  onBlur,
  name,
  ref,
}: Props) {
  // Native datetime-local controls accept at most millisecond precision.
  // Keep the original value in the form until the user actually edits it.
  const precise = /\.\d{4,6}$/.test(value || "");
  const nativeValue = (value || "").replace(/(\.\d{3})\d+$/, "$1");
  return (
    <Field
      label={label}
      error={error}
      hint={
        precise
          ? `Точное время: ${value.replace("T", " ")} · Москва. Сохраняется до изменения поля.`
          : undefined
      }
    >
      <input
        ref={ref}
        name={name}
        type="datetime-local"
        step="any"
        value={nativeValue}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </Field>
  );
}
