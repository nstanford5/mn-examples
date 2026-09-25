// Token colors and amounts, for showing balances.
//
// Balances from the DApp Connector (`getUnshieldedBalances`,
// `getShieldedBalances`) are keyed by token type: a token's 32-byte color as
// hex. A contract's own token has the color `tokenType(domainSep, contract)`,
// which the UI can compute with `rawTokenType` from
// @midnight-ntwrk/midnight-js-protocol/compact-runtime (see token-transfers).
//
// Template-owned: edit templates/ui/src/lib/tokens.ts, then
// `yarn new:ui --sync-all`.

/** NIGHT's color: `default<Bytes<32>>` in Compact, all zeros. */
export const NIGHT_COLOR = "00".repeat(32);

/** NIGHT's smallest unit: 1 NIGHT = 1,000,000 STAR. On-chain amounts are in STAR. */
export const STAR_PER_NIGHT = 1_000_000n;

/** A NIGHT amount in STAR as "<STAR> STAR (<NIGHT> NIGHT)". */
export function formatStar(star: bigint): string {
  const whole = star / STAR_PER_NIGHT;
  const frac = (star % STAR_PER_NIGHT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${star} STAR (${whole}${frac ? `.${frac}` : ""} NIGHT)`;
}

/** A color for display: its label if it has one, else the first 12 hex digits. */
export function colorLabel(color: string, labels: Readonly<Record<string, string>> = {}): string {
  const key = color.toLowerCase();
  if (key === NIGHT_COLOR) return "NIGHT";
  return labels[key] ?? `${key.slice(0, 12)}…`;
}
