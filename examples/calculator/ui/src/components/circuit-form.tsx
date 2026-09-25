// A generic form for one circuit: one field per argument (see
// lib/circuit-args.ts for the supported types), and a submit button labelled
// with the circuit name. The generated panel renders one per circuit; replace
// it with a purpose-built form when the example deserves one.
//
// When `onSubmit` resolves to a CircuitOutcome, the form also:
//   - shows the circuit's return value (anything but `[]`);
//   - records every ShieldedCoinInfo in it (lib/coin-book.ts), so a later
//     `shieldedCoin` argument can pick it;
//   - drops the coins this call took as `shieldedCoin` arguments, which the
//     tx has now spent or handed over.
//
// Template-owned: edit templates/ui/src/components/circuit-form.tsx, then
// `yarn new:ui <name> --sync`.
import { useContext, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { walletCoinPublicKey, walletUserAddress } from "@/lib/addresses";
import { defaultText, parseArgs, type ArgSpec } from "@/lib/circuit-args";
import { describeCoin, recordCoins, removeCoin, useCoinBook } from "@/lib/coin-book";
import { errorMessage } from "@/lib/errors";
import { formatResult } from "@/lib/ledger-format";
import { WalletContext } from "@/providers/wallet-context";

/**
 * What a submitted call came to. `ok: false` means it failed and the error is
 * shown elsewhere (useDeployment's `error`), so the form only resets its
 * result line.
 */
export type CircuitOutcome = { ok: true; result: unknown } | { ok: false };

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
  /** Submit the call. Resolve to its outcome to show and book its result. */
  onSubmit: (values: unknown[]) => void | Promise<CircuitOutcome>;
}) {
  const [texts, setTexts] = useState(() => args.map((a) => defaultText(a.type)));
  const [fillError, setFillError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const coins = useCoinBook();
  // Optional: the form also renders (and is unit-tested) outside a WalletProvider.
  const wallet = useContext(WalletContext);
  const parsed = parseArgs(args, texts, { networkId: wallet?.networkId, coins });
  const set = (i: number, value: string) =>
    setTexts((prev) => prev.map((t, j) => (j === i ? value : t)));
  /** A "Use my ..." button's fill: read from the wallet, or say why not. */
  const fill = (i: number, read: () => Promise<Uint8Array>, what: string) => {
    setFillError(null);
    read()
      .then((bytes) => set(i, toHex(bytes)))
      .catch((e: unknown) => setFillError(errorMessage(e, `couldn't read the wallet's ${what}`)));
  };

  const submit = async (values: unknown[]) => {
    setResult(null);
    const outcome = await onSubmit(values);
    if (!outcome?.ok) return;
    // Coins passed in are gone from the sender's hands once the tx is final.
    args.forEach((a, i) => a.type.kind === "shieldedCoin" && removeCoin(texts[i] ?? ""));
    recordCoins(name, outcome.result);
    setResult(formatResult(outcome.result));
  };

  return (
    <form
      className="flex flex-col gap-2"
      aria-label={name}
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.ok) void submit(parsed.value as unknown[]);
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
            case "userAddress": {
              const api = wallet?.connectedApi;
              const networkId = wallet?.networkId;
              return (
                <div key={arg.name} className="flex min-w-64 flex-1 gap-2">
                  <Input
                    aria-label={label}
                    className="flex-1"
                    placeholder={placeholder(arg)}
                    value={text}
                    onChange={(e) => set(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!api || !networkId}
                    onClick={() =>
                      api &&
                      networkId &&
                      fill(i, async () => (await walletUserAddress(api, networkId)).bytes, "address")
                    }
                  >
                    Use my address
                  </Button>
                </div>
              );
            }
            case "coinPublicKey": {
              const api = wallet?.connectedApi;
              const networkId = wallet?.networkId;
              return (
                <div key={arg.name} className="flex min-w-64 flex-1 gap-2">
                  <Input
                    aria-label={label}
                    className="flex-1"
                    placeholder={placeholder(arg)}
                    value={text}
                    onChange={(e) => set(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!api || !networkId}
                    onClick={() =>
                      api &&
                      networkId &&
                      fill(i, async () => (await walletCoinPublicKey(api, networkId)).bytes, "coin public key")
                    }
                  >
                    Use my key
                  </Button>
                </div>
              );
            }
            case "shieldedCoin":
              return (
                <select
                  key={arg.name}
                  aria-label={label}
                  className="h-9 min-w-64 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={text}
                  onChange={(e) => set(i, e.target.value)}
                >
                  <option value="">
                    {coins.length ? `${arg.name}: pick a coin` : `${arg.name}: no coins yet`}
                  </option>
                  {coins.map((c) => (
                    <option key={c.id} value={c.id}>
                      {describeCoin(c.coin)} ({c.source})
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
      {fillError && <p className="text-xs text-destructive">{fillError}</p>}
      {result !== null && (
        <p className="break-all text-xs">
          <span className="text-muted-foreground">returned </span>
          <code>{result}</code>
        </p>
      )}
    </form>
  );
}

function placeholder({ name, type }: ArgSpec): string {
  switch (type.kind) {
    case "uint":
      return `${name} (0..${type.max})`;
    case "bytes":
      return `${name} (${type.length} bytes, hex)`;
    case "userAddress":
      return `${name} (mn_addr_… or hex)`;
    case "coinPublicKey":
      return `${name} (mn_shield-cpk_… or hex)`;
    default:
      return name;
  }
}
