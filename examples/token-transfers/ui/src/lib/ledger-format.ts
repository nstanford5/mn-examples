// Best-effort text for a decoded ledger field, used by the generated panel's
// ledger readout.
//
// `yarn new:ui` describes each exported ledger field from contract-info.json
// (`ledger[].storage` and `ledger[].type`) as a LedgerField. The decoded
// values are what the compiler-generated `ledger()` returns (see `Ledger` in
// contract/managed/<c>/contract/index.d.ts):
//
//   storage   decoded as                                  shown as
//   Cell      the value (bigint, Uint8Array, enum number) the value; enum → its name
//   Counter   bigint                                      the number
//   Set       { size(), [Symbol.iterator] }               "N: a, b, c"
//   List      { length(), head(), [Symbol.iterator] }     "N: a, b, c" (head first)
//   Map       { size(), [Symbol.iterator] of [k, v] }     "N: k → v, ..."
//
// Template-owned: edit templates/ui/src/lib/ledger-format.ts, then
// `yarn new:ui <name> --sync`.

export interface LedgerField {
  name: string;
  /** contract-info.json `storage`: Cell, Counter, Set, List, Map, ... */
  storage: string;
  /** Enum member names, when the cell (or the Set/List element) is an enum. */
  enumValues?: readonly string[];
}

/** Collections longer than this are shown as a count plus the first items. */
const MAX_ITEMS = 8;

export function formatLedgerValue(field: LedgerField, value: unknown): string {
  if (field.storage === "Cell" || field.storage === "Counter") {
    return formatScalar(value, field.enumValues);
  }
  if (isIterable(value)) {
    const items: string[] = [];
    let count = 0;
    for (const item of value) {
      if (count < MAX_ITEMS) {
        items.push(
          Array.isArray(item) && item.length === 2
            ? `${formatScalar(item[0])} → ${formatScalar(item[1])}`
            : formatScalar(item, field.enumValues),
        );
      }
      count++;
    }
    const more = count > MAX_ITEMS ? ", …" : "";
    return count === 0 ? "empty" : `${count}: ${items.join(", ")}${more}`;
  }
  return formatScalar(value, field.enumValues);
}

/** One plain value: bigint, boolean, Uint8Array as hex, enum number as its name. */
export function formatScalar(value: unknown, enumValues?: readonly string[]): string {
  if (enumValues && (typeof value === "number" || typeof value === "bigint")) {
    return enumValues[Number(value)] ?? String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  try {
    return JSON.stringify(value, (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? formatScalar(v) : v,
    );
  } catch {
    return "(complex value)";
  }
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

/**
 * A circuit's return value for display, or null when there is nothing to
 * show: a circuit declared `: []` returns an empty array.
 */
export function formatResult(value: unknown): string | null {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return null;
  return formatScalar(value);
}
