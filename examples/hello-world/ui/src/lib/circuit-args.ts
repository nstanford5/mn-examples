// Text-field parsing for circuit arguments, used by <CircuitForm>.
//
// `yarn new:ui` turns each circuit argument's type in contract-info.json into
// an ArgType when it has a simple TypeScript counterpart. The counterparts are
// the ones the compiler emits in contract/managed/<c>/contract/index.d.ts:
//
//   contract-info.json                TypeScript     ArgType
//   Uint (maxval)                     bigint         { kind: "uint", max }
//   Field                             bigint         { kind: "field" }
//   Boolean                           boolean        { kind: "boolean" }
//   Opaque (tsType "string")          string         { kind: "string" }
//   Bytes (length)                    Uint8Array     { kind: "bytes", length }
//   Enum (elements)                   numeric enum   { kind: "enum", values }
//   Struct UserAddress { bytes: Bytes<32> }
//                                     { bytes }      { kind: "userAddress" }
//   Alias                             its target type (unwrapped)
//
// A UserAddress field takes a Bech32m unshielded address (mn_addr_...) or
// 32 bytes of hex, and the form can fill it with the wallet's own address.
// Other structs, tuples, vectors and opaque types get no generic form, and
// neither does a Bytes argument named like a secret (see scripts/new-ui.mjs);
// the generated panel leaves a TODO for those circuits instead.
//
// Template-owned: edit templates/ui/src/lib/circuit-args.ts, then
// `yarn new:ui <name> --sync`.
import { MAX_FIELD } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { userAddressFromBech32 } from "@/lib/addresses";

export type ArgType =
  | { kind: "uint"; max: bigint }
  | { kind: "field" }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "bytes"; length: number }
  | { kind: "enum"; values: string[] }
  | { kind: "userAddress" };

/** What parsing needs beyond the text: the wallet's network, for Bech32m. */
export interface ParseContext {
  networkId?: string | null;
}

export interface ArgSpec {
  name: string;
  type: ArgType;
}

export type Parsed = { ok: true; value: unknown } | { ok: false; reason: string };

/** The initial text for an argument's field. */
export function defaultText(type: ArgType): string {
  switch (type.kind) {
    case "boolean":
      return "false";
    case "uint":
    case "field":
    case "enum":
      return "0";
    default:
      return "";
  }
}

/**
 * Parse one field's text into the value the circuit takes. Range checks match
 * the type (Uint maxval, the field modulus, exact byte length), so the circuit
 * isn't run with a value it would reject as a type error. Contract-level
 * checks (asserts, overflowing casts) still happen when the circuit runs.
 */
export function parseArg(type: ArgType, text: string, ctx: ParseContext = {}): Parsed {
  const t = text.trim();
  switch (type.kind) {
    case "uint":
    case "field": {
      if (!/^\d+$/.test(t)) return { ok: false, reason: "a whole number ≥ 0" };
      const n = BigInt(t);
      const max = type.kind === "uint" ? type.max : MAX_FIELD;
      return n > max ? { ok: false, reason: `at most ${max}` } : { ok: true, value: n };
    }
    case "boolean":
      return t === "true" || t === "false"
        ? { ok: true, value: t === "true" }
        : { ok: false, reason: "true or false" };
    case "string":
      return { ok: true, value: text };
    case "bytes":
      return parseHex(t, type.length);
    case "userAddress": {
      if (t.startsWith("mn_addr")) {
        if (!ctx.networkId) return { ok: false, reason: "connect a wallet to read mn_addr_ addresses" };
        try {
          return { ok: true, value: userAddressFromBech32(t, ctx.networkId) };
        } catch {
          return { ok: false, reason: `an unshielded address for ${ctx.networkId}` };
        }
      }
      const bytes = parseHex(t, 32);
      return bytes.ok
        ? { ok: true, value: { bytes: bytes.value } }
        : { ok: false, reason: "an mn_addr_ address, or 32 bytes as 64 hex characters" };
    }
    case "enum": {
      const i = Number(t);
      return Number.isInteger(i) && i >= 0 && i < type.values.length
        ? { ok: true, value: i }
        : { ok: false, reason: `one of ${type.values.join(", ")}` };
    }
  }
}

/** Exactly `length` bytes as hex, with an optional 0x prefix. */
function parseHex(t: string, length: number): { ok: true; value: Uint8Array } | { ok: false; reason: string } {
  const hex = t.startsWith("0x") ? t.slice(2) : t;
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== length * 2) {
    return { ok: false, reason: `${length} bytes as ${length * 2} hex characters` };
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return { ok: true, value: bytes };
}

/** Parse every field; the first failure names its argument. */
export function parseArgs(specs: ArgSpec[], texts: string[], ctx: ParseContext = {}): Parsed {
  const values: unknown[] = [];
  for (const [i, spec] of specs.entries()) {
    const parsed = parseArg(spec.type, texts[i] ?? "", ctx);
    if (!parsed.ok) return { ok: false, reason: `${spec.name}: ${parsed.reason}` };
    values.push(parsed.value);
  }
  return { ok: true, value: values };
}
