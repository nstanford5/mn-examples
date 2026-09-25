/**
 * Turn anything thrown by the wallet or midnight-js into a readable message.
 *
 * Shapes seen in practice:
 *  - DApp Connector errors: plain objects shaped like
 *    `{ type: "DAppConnectorAPIError", code, reason }`. They can cross the
 *    extension boundary, so check `type` rather than using `instanceof`.
 *  - Wallet (Effect) failures, e.g. from `balanceUnsealedTransaction`:
 *    `{ _id: "FiberFailure", message: "", cause: { _tag: "Fail", failure:
 *    { _tag: "Wallet.InsufficientFunds", message: "Insufficient Funds: could
 *    not balance dust" } } }`. The top-level message is empty, so dig out the
 *    failure.
 *  - Ordinary Errors, possibly wrapping another error in `cause`.
 */
export function errorMessage(err: unknown, fallback: string): string {
  return describe(err, 0) ?? fallback;
}

function describe(err: unknown, depth: number): string | null {
  if (depth > 5 || err == null) return null;
  if (typeof err === "string") return err.length > 0 ? err : null;
  if (typeof err !== "object") return String(err);

  const e = err as {
    type?: unknown;
    code?: unknown;
    reason?: unknown;
    message?: unknown;
    _tag?: unknown;
    failure?: unknown;
    defect?: unknown;
    cause?: unknown;
  };

  if (e.type === "DAppConnectorAPIError" && typeof e.reason === "string") {
    return typeof e.code === "string" ? `${e.reason} (${e.code})` : e.reason;
  }
  // Effect Cause: the real error sits in `failure` (expected) or `defect`.
  const inner = describe(e.failure, depth + 1) ?? describe(e.defect, depth + 1);
  if (inner) return inner;
  if (typeof e.message === "string" && e.message.length > 0) {
    return withHint(e.message, e._tag);
  }
  return describe(e.cause, depth + 1);
}

/** Add what to do next for failures a new user is likely to hit. */
function withHint(message: string, tag: unknown): string {
  if (tag === "Wallet.InsufficientFunds" && /dust/i.test(message)) {
    return `${message}. The wallet needs DUST to pay fees: hold NIGHT registered for DUST generation, then wait for DUST to accrue.`;
  }
  return message;
}
