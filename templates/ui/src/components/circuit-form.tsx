// A generic form for one circuit: one field per argument (see
// lib/circuit-args.ts for the supported types), and a submit button labelled
// with the circuit name. The generated panel renders one per circuit; replace
// it with a purpose-built form when the example deserves one.
//
// Template-owned: edit templates/ui/src/components/circuit-form.tsx, then
// `yarn new:ui <name> --sync`.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultText, parseArgs, type ArgSpec } from "@/lib/circuit-args";

export function CircuitForm({
  name,
  args,
  busy,
  disabled,
  onSubmit,
}: {
  name: string;
  args: ArgSpec[];
  /** True while this circuit's call is in flight. */
  busy: boolean;
  disabled: boolean;
  onSubmit: (values: unknown[]) => void;
}) {
  const [texts, setTexts] = useState(() => args.map((a) => defaultText(a.type)));
  const parsed = parseArgs(args, texts);
  const set = (i: number, value: string) =>
    setTexts((prev) => prev.map((t, j) => (j === i ? value : t)));

  return (
    <form
      className="flex flex-col gap-2"
      aria-label={name}
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.ok) onSubmit(parsed.value as unknown[]);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {args.map((arg, i) => {
          const label = `${name} ${arg.name}`;
          const text = texts[i] ?? "";
          switch (arg.type.kind) {
            case "boolean":
              return (
                <label key={arg.name} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={text === "true"}
                    onChange={(e) => set(i, String(e.target.checked))}
                  />
                  {arg.name}
                </label>
              );
            case "enum":
              return (
                <select
                  key={arg.name}
                  aria-label={label}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={text}
                  onChange={(e) => set(i, e.target.value)}
                >
                  {arg.type.values.map((v, j) => (
                    <option key={v} value={String(j)}>
                      {v}
                    </option>
                  ))}
                </select>
              );
            default:
              return (
                <Input
                  key={arg.name}
                  aria-label={label}
                  className="w-auto min-w-32 flex-1"
                  placeholder={placeholder(arg)}
                  inputMode={arg.type.kind === "uint" || arg.type.kind === "field" ? "numeric" : undefined}
                  value={text}
                  onChange={(e) => set(i, e.target.value)}
                />
              );
          }
        })}
        <Button type="submit" disabled={disabled || !parsed.ok}>
          {busy && <Loader2 className="animate-spin" />}
          {name}
        </Button>
      </div>
      {!parsed.ok && <p className="text-xs text-muted-foreground">{parsed.reason}</p>}
    </form>
  );
}

function placeholder({ name, type }: ArgSpec): string {
  switch (type.kind) {
    case "uint":
      return `${name} (0..${type.max})`;
    case "bytes":
      return `${name} (${type.length} bytes, hex)`;
    default:
      return name;
  }
}
