// Token transfers, built on the seed `yarn new:ui` generated: step 1 is the
// template's <DeploymentCard>, then the three families of circuits the Node
// test exercises (src/test/token-transfers.test.ts):
//
//   custom unshielded token  mintAndReceive → sendToUser → receiveTokens
//   NIGHT                    receiveNightTokens → sendNightTokensToUser
//   shielded                 mintShieldedToSelf, mintAndSendShielded →
//                            receiveShieldedTokens (a coin just returned)
//
// The contract has no ledger, so there is nothing to stream from the indexer.
// What changes is who holds the tokens, and the wallet is the counterparty to
// every send and receive, so the template's <WalletBalancesCard> shows the
// wallet's balances (as the Node test asserts on them).
//
// Most circuits keep the template's generic <CircuitForm>: amounts, a
// UserAddress ("Use my address"), and for receiveShieldedTokens a
// ShieldedCoinInfo picked from the coins earlier calls returned
// (lib/coin-book.ts). The two shielded mints take a nonce, which must be fresh
// random bytes on every call, so they get small purpose-built forms that
// generate it and book the coins they return.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CircuitForm, type CircuitOutcome } from "@/components/circuit-form";
import { DeploymentCard } from "@/components/deployment-card";
import { WalletBalancesCard } from "@/components/wallet-balances-card";
import { useDeployment } from "@/hooks/use-deployment";
import type { ArgSpec } from "@/lib/circuit-args";
import { clearCoins, describeCoin, recordCoins, type ShieldedCoinValue } from "@/lib/coin-book";
import {
  customTokenColor,
  deployTokenTransfers,
  domainSepFromLabel,
  joinTokenTransfers,
  mintAndReceive,
  mintAndSendError,
  mintAndSendShielded,
  mintShieldedToSelf,
  myCoinPublicKey,
  randomNonce,
  receiveNightTokens,
  receiveShieldedTokens,
  receiveTokens,
  sendNightTokensToUser,
  sendToUser,
  type CircuitArgs,
  type TokenTransfersContract,
} from "@/midnight/token-transfers-api";

// Argument types from contract-info.json, as generated.
const UINT64 = { kind: "uint", max: 18446744073709551615n } as const;
const UINT128 = { kind: "uint", max: 340282366920938463463374607431768211455n } as const;
const amount64: ArgSpec = { name: "amount", type: UINT64 };
const amount128: ArgSpec = { name: "amount", type: UINT128 };
const userAddr: ArgSpec = { name: "user_addr", type: { kind: "userAddress" } };

/** One generic form per circuit, with what it does in words. */
interface GenericCircuit {
  name: string;
  args: ArgSpec[];
  help: string;
  /** Submits through the api wrapper; resolves to the circuit's return value. */
  call: (contract: TokenTransfersContract, args: unknown[]) => Promise<unknown>;
}

const CUSTOM_TOKEN_CIRCUITS: GenericCircuit[] = [
  {
    name: "mintAndReceive",
    args: [amount64],
    help: "Mint `amount` of the custom token into the contract. Returns the token's color.",
    call: async (c, a) => (await mintAndReceive(c, ...(a as CircuitArgs<"mintAndReceive">))).private.result,
  },
  {
    name: "sendToUser",
    args: [amount64, userAddr],
    help: "Send `amount` of the contract's custom token to an unshielded address.",
    call: async (c, a) => (await sendToUser(c, ...(a as CircuitArgs<"sendToUser">))).private.result,
  },
  {
    name: "receiveTokens",
    args: [amount128],
    help: "Pay `amount` of the custom token from your wallet into the contract. The wallet adds the inputs when it balances the tx.",
    call: async (c, a) => (await receiveTokens(c, ...(a as CircuitArgs<"receiveTokens">))).private.result,
  },
];

const NIGHT_CIRCUITS: GenericCircuit[] = [
  {
    name: "receiveNightTokens",
    args: [amount128],
    help: "Pay `amount` STAR of NIGHT from your wallet into the contract (1 NIGHT = 1,000,000 STAR).",
    call: async (c, a) =>
      (await receiveNightTokens(c, ...(a as CircuitArgs<"receiveNightTokens">))).private.result,
  },
  {
    name: "sendNightTokensToUser",
    args: [amount64, userAddr],
    help: "Send `amount` STAR of the contract's NIGHT to an unshielded address. The contract must hold that much.",
    call: async (c, a) =>
      (await sendNightTokensToUser(c, ...(a as CircuitArgs<"sendNightTokensToUser">))).private.result,
  },
];

const RECEIVE_SHIELDED: GenericCircuit = {
  name: "receiveShieldedTokens",
  args: [{ name: "coin", type: { kind: "shieldedCoin" } }],
  help:
    'Hand a shielded coin back to the contract. Pick one that was sent to you ("→ sent"): ' +
    "the wallet must spend it while balancing. The list only lasts until you reload.",
  call: async (c, a) =>
    (await receiveShieldedTokens(c, ...(a as CircuitArgs<"receiveShieldedTokens">))).private.result,
};

type SendResult = Awaited<ReturnType<typeof mintAndSendShielded>>["private"]["result"];

export function TokenTransfersPanel() {
  const deployment = useDeployment({
    deploy: deployTokenTransfers,
    join: joinTokenTransfers,
  });
  const { providers, contract, address, busy, error, run } = deployment;
  /** The last shielded mint's outcome in words. */
  const [mintOutcome, setMintOutcome] = useState<string | null>(null);
  // Booked coins belong to one contract; another address starts empty.
  useEffect(() => clearCoins(), [address]);

  const customColor = address ? customTokenColor(address) : null;
  const disabled = busy !== null || !contract;

  /** Run a call with the shared busy/error state, as the outcome <CircuitForm> expects. */
  const outcomeOf = async (
    label: string,
    fn: (c: TokenTransfersContract) => Promise<unknown>,
  ): Promise<CircuitOutcome> => {
    let result: unknown;
    const ok = await run(label, async () => {
      if (contract) result = await fn(contract);
    });
    return ok ? { ok: true, result } : { ok: false };
  };

  const genericForm = (c: GenericCircuit) => (
    <div key={c.name} className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{c.help}</p>
      <CircuitForm
        name={c.name}
        args={c.args}
        busy={busy === c.name}
        disabled={disabled}
        onSubmit={(values) => outcomeOf(c.name, (contract) => c.call(contract, values))}
      />
    </div>
  );

  /** A shielded mint: book the coins it returned (for receiveShieldedTokens) and describe them. */
  async function mint<R>(label: string, fn: (c: TokenTransfersContract) => Promise<R>, describe: (r: R) => string) {
    setMintOutcome(null);
    const outcome = await outcomeOf(label, fn);
    if (!outcome.ok) return;
    recordCoins(label, outcome.result);
    setMintOutcome(`${label}: ${describe(outcome.result as R)}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard deployment={deployment} />

      {providers && address && (
        <>
          {/* busy flips when a call starts and ends, so it doubles as a refresh key. */}
          <WalletBalancesCard
            title="2. Your wallet"
            description="The contract has no public ledger, so each call shows up here as tokens moving in or out of your wallet. The contract's own holdings aren't shown: the indexer reports a contract's balance as of its deploy."
            labels={customColor ? { [customColor]: "custom token" } : {}}
            refreshKey={busy}
          >
            {customColor && (
              <p className="break-all text-xs text-muted-foreground">
                This contract's custom token color: <code>{customColor}</code>
              </p>
            )}
          </WalletBalancesCard>

          <Card>
            <CardHeader>
              <CardTitle>3. Unshielded tokens</CardTitle>
              <CardDescription>
                The custom token (its color comes from the contract address), then NIGHT. Each
                call runs the circuit locally, proves it, then asks the wallet to balance and
                submit it. What a circuit returns is shown under its form.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">Custom token</h3>
              {CUSTOM_TOKEN_CIRCUITS.map(genericForm)}
              <h3 className="text-sm font-medium">NIGHT</h3>
              {NIGHT_CIRCUITS.map(genericForm)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Shielded tokens</CardTitle>
              <CardDescription>
                Zswap coins. The label picks the token (it's the mint's domain separator), and
                every mint gets a fresh random nonce.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ShieldedMintForm
                busy={busy === "mintShieldedToSelf"}
                disabled={disabled}
                onSubmit={(domainSep, value) =>
                  void mint(
                    "mintShieldedToSelf",
                    async (c) => (await mintShieldedToSelf(c, domainSep, value, randomNonce())).private.result,
                    (coin: ShieldedCoinValue) => `the contract now holds ${describeCoin(coin)}`,
                  )
                }
              />
              <ShieldedMintAndSendForm
                busy={busy === "mintAndSendShielded"}
                disabled={disabled}
                onSubmit={(domainSep, mintValue, sendValue) =>
                  void mint(
                    "mintAndSendShielded",
                    async (c) =>
                      (
                        await mintAndSendShielded(
                          c,
                          domainSep,
                          mintValue,
                          randomNonce(),
                          myCoinPublicKey(providers),
                          sendValue,
                        )
                      ).private.result,
                    ({ sent, change }: SendResult) =>
                      `you received ${describeCoin(sent)}` +
                      (change.is_some ? `; the contract kept ${change.value.value} as change` : ""),
                  )
                }
              />
              {mintOutcome && <p className="break-all text-xs">{mintOutcome}</p>}
              {genericForm(RECEIVE_SHIELDED)}
              <p className="text-xs text-muted-foreground">
                <code>sendShieldedToUser</code> has no form. It spends a coin the contract
                already holds, identified by its index in the Zswap commitment tree, and this
                UI (like the Node test) doesn't track the contract's coins.{" "}
                <code>mintAndSendShielded</code> exercises <code>sendShielded</code> instead.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Parse a whole number field; null when it isn't one. */
function parseAmount(text: string): bigint | null {
  return /^\d+$/.test(text.trim()) ? BigInt(text.trim()) : null;
}

/** A label field plus the domain separator it gives, or why it can't. */
function useLabel(initial: string) {
  const [label, setLabel] = useState(initial);
  let domainSep: Uint8Array | null = null;
  let reason: string | null = null;
  try {
    domainSep = domainSepFromLabel(label);
  } catch (e) {
    reason = (e as Error).message;
  }
  return { label, setLabel, domainSep, reason };
}

function ShieldedMintForm(props: {
  busy: boolean;
  disabled: boolean;
  onSubmit: (domainSep: Uint8Array, value: bigint) => void;
}) {
  const { label, setLabel, domainSep, reason: labelReason } = useLabel("demo:shielded");
  const [value, setValue] = useState("250");
  const v = parseAmount(value);
  const reason = labelReason ?? (v === null ? "value must be a whole number" : mintAndSendError(v, 0n));

  return (
    <form
      className="flex flex-col gap-1"
      aria-label="mintShieldedToSelf"
      onSubmit={(e) => {
        e.preventDefault();
        if (domainSep && v !== null && reason === null) props.onSubmit(domainSep, v);
      }}
    >
      <h3 className="text-sm font-medium">mintShieldedToSelf</h3>
      <p className="text-xs text-muted-foreground">Mint a shielded coin that the contract keeps.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="mintShieldedToSelf label"
          className="w-48"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          aria-label="mintShieldedToSelf value"
          className="w-32"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" disabled={props.disabled || reason !== null}>
          {props.busy && <Loader2 className="animate-spin" />}
          Mint to contract
        </Button>
      </div>
      {reason && <p className="text-xs text-destructive">{reason}</p>}
    </form>
  );
}

function ShieldedMintAndSendForm(props: {
  busy: boolean;
  disabled: boolean;
  onSubmit: (domainSep: Uint8Array, mintValue: bigint, sendValue: bigint) => void;
}) {
  const { label, setLabel, domainSep, reason: labelReason } = useLabel("demo:shielded");
  const [mintText, setMint] = useState("500");
  const [sendText, setSend] = useState("300");
  const m = parseAmount(mintText);
  const s = parseAmount(sendText);
  const reason =
    labelReason ?? (m === null || s === null ? "values must be whole numbers" : mintAndSendError(m, s));

  return (
    <form
      className="flex flex-col gap-1"
      aria-label="mintAndSendShielded"
      onSubmit={(e) => {
        e.preventDefault();
        if (domainSep && m !== null && s !== null && reason === null) props.onSubmit(domainSep, m, s);
      }}
    >
      <h3 className="text-sm font-medium">mintAndSendShielded</h3>
      <p className="text-xs text-muted-foreground">
        Mint a shielded coin and send part of it to your wallet's coin key. The rest stays in
        the contract as change.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="mintAndSendShielded label"
          className="w-48"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          aria-label="mintAndSendShielded mint value"
          className="w-28"
          inputMode="numeric"
          value={mintText}
          onChange={(e) => setMint(e.target.value)}
        />
        <Input
          aria-label="mintAndSendShielded send value"
          className="w-28"
          inputMode="numeric"
          value={sendText}
          onChange={(e) => setSend(e.target.value)}
        />
        <Button type="submit" disabled={props.disabled || reason !== null}>
          {props.busy && <Loader2 className="animate-spin" />}
          Mint and send to me
        </Button>
      </div>
      {reason && <p className="text-xs text-destructive">{reason}</p>}
    </form>
  );
}
