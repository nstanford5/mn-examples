// The generic circuit form and its argument parsing (lib/circuit-args.ts).
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FIELD } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { CircuitForm } from "../components/circuit-form";
import { parseArg, parseArgs, type ArgSpec } from "../lib/circuit-args";
import { bookedCoins, clearCoins, recordCoins } from "../lib/coin-book";
import { WalletContext, type WalletContextValue } from "../providers/wallet-context";

// Bech32m decoding itself is tested in addresses.test.ts (node environment:
// the codec trips over jsdom's Uint8Array realm). Here it's stubbed.
const { MY_ADDRESS, MY_KEY } = vi.hoisted(() => ({
  MY_ADDRESS: new Uint8Array(32).fill(0xab),
  MY_KEY: new Uint8Array(32).fill(0xcc),
}));
vi.mock("@/lib/addresses", () => ({
  userAddressFromBech32: (s: string) => {
    if (s !== "mn_addr_undeployed1me") throw new Error("not an unshielded address");
    return { bytes: MY_ADDRESS };
  },
  walletUserAddress: async () => ({ bytes: MY_ADDRESS }),
  coinPublicKeyFromBech32: (s: string) => {
    if (s !== "mn_shield-cpk_undeployed1me") throw new Error("not a coin public key");
    return { bytes: MY_KEY };
  },
  walletCoinPublicKey: async () => ({ bytes: MY_KEY }),
}));

/** A ShieldedCoinInfo whose nonce, color and value all derive from `n`. */
const coin = (n: number) => ({
  nonce: new Uint8Array(32).fill(n),
  color: new Uint8Array(32).fill(0xee),
  value: BigInt(n) * 100n,
});

beforeEach(() => clearCoins());

describe("parseArg", () => {
  it("bounds Uint by maxval and Field by the field modulus", () => {
    expect(parseArg({ kind: "uint", max: 255n }, " 255 ")).toEqual({ ok: true, value: 255n });
    expect(parseArg({ kind: "uint", max: 255n }, "256").ok).toBe(false);
    for (const bad of ["", "-1", "1.5", "0x10"]) expect(parseArg({ kind: "uint", max: 9n }, bad).ok).toBe(false);
    expect(parseArg({ kind: "field" }, MAX_FIELD.toString())).toEqual({ ok: true, value: MAX_FIELD });
    expect(parseArg({ kind: "field" }, (MAX_FIELD + 1n).toString()).ok).toBe(false);
  });

  it("parses booleans, strings, enums and exact-length hex bytes", () => {
    expect(parseArg({ kind: "boolean" }, "true")).toEqual({ ok: true, value: true });
    expect(parseArg({ kind: "string" }, " hi ")).toEqual({ ok: true, value: " hi " });
    expect(parseArg({ kind: "enum", values: ["A", "B"] }, "1")).toEqual({ ok: true, value: 1 });
    expect(parseArg({ kind: "enum", values: ["A", "B"] }, "2").ok).toBe(false);
    expect(parseArg({ kind: "bytes", length: 2 }, "0xAB01")).toEqual({
      ok: true,
      value: new Uint8Array([0xab, 0x01]),
    });
    expect(parseArg({ kind: "bytes", length: 2 }, "ab").ok).toBe(false);
    expect(parseArg({ kind: "bytes", length: 1 }, "zz").ok).toBe(false);
  });

  it("parses a UserAddress from hex or, with a network, from Bech32m", () => {
    const hex = "cd".repeat(32);
    expect(parseArg({ kind: "userAddress" }, `0x${hex}`)).toEqual({
      ok: true,
      value: { bytes: new Uint8Array(32).fill(0xcd) },
    });
    expect(parseArg({ kind: "userAddress" }, "cd".repeat(31)).ok).toBe(false);
    expect(parseArg({ kind: "userAddress" }, "mn_addr_undeployed1me")).toEqual({
      ok: false,
      reason: "connect a wallet to read mn_addr_ addresses",
    });
    expect(parseArg({ kind: "userAddress" }, "mn_addr_undeployed1me", { networkId: "undeployed" })).toEqual({
      ok: true,
      value: { bytes: MY_ADDRESS },
    });
    expect(parseArg({ kind: "userAddress" }, "mn_addr_undeployed1xx", { networkId: "undeployed" }).ok).toBe(false);
  });

  it("parses a ZswapCoinPublicKey from hex or, with a network, from Bech32m", () => {
    expect(parseArg({ kind: "coinPublicKey" }, "cd".repeat(32))).toEqual({
      ok: true,
      value: { bytes: new Uint8Array(32).fill(0xcd) },
    });
    expect(parseArg({ kind: "coinPublicKey" }, "mn_shield-cpk_undeployed1me").ok).toBe(false);
    expect(parseArg({ kind: "coinPublicKey" }, "mn_shield-cpk_undeployed1me", { networkId: "undeployed" })).toEqual({
      ok: true,
      value: { bytes: MY_KEY },
    });
    expect(parseArg({ kind: "coinPublicKey" }, "mn_addr_undeployed1me", { networkId: "undeployed" }).ok).toBe(false);
  });

  it("parses a shielded coin by picking a booked one by its nonce", () => {
    recordCoins("mint", coin(1));
    const coins = bookedCoins();
    expect(parseArg({ kind: "shieldedCoin" }, "01".repeat(32), { coins })).toEqual({ ok: true, value: coin(1) });
    expect(parseArg({ kind: "shieldedCoin" }, "", { coins })).toEqual({ ok: false, reason: "pick a coin" });
    expect(parseArg({ kind: "shieldedCoin" }, "")).toEqual({
      ok: false,
      reason: "no coins yet: run a circuit that returns one first",
    });
  });

  it("names the first invalid argument", () => {
    const specs: ArgSpec[] = [
      { name: "a", type: { kind: "uint", max: 9n } },
      { name: "b", type: { kind: "uint", max: 9n } },
    ];
    expect(parseArgs(specs, ["1", "10"])).toEqual({ ok: false, reason: "b: at most 9" });
    expect(parseArgs(specs, ["1", "2"])).toEqual({ ok: true, value: [1n, 2n] });
  });
});

describe("CircuitForm", () => {
  it("submits parsed values and disables the button on invalid input", async () => {
    const onSubmit = vi.fn();
    render(
      <CircuitForm
        name="bet"
        args={[
          { name: "amount", type: { kind: "uint", max: 100n } },
          { name: "color", type: { kind: "enum", values: ["RED", "BLACK"] } },
          { name: "double", type: { kind: "boolean" } },
        ]}
        busy={false}
        disabled={false}
        onSubmit={onSubmit}
      />,
    );
    const amount = screen.getByLabelText("bet amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "101");
    expect(screen.getByRole("button", { name: "bet" })).toBeDisabled();
    expect(screen.getByText("amount: at most 100")).toBeInTheDocument();

    await userEvent.clear(amount);
    await userEvent.type(amount, "42");
    await userEvent.selectOptions(screen.getByLabelText("bet color"), "BLACK");
    await userEvent.click(screen.getByLabelText("bet double"));
    await userEvent.click(screen.getByRole("button", { name: "bet" }));
    expect(onSubmit).toHaveBeenCalledWith([42n, 1, true]);
  });

  it("fills a UserAddress with the connected wallet's own address", async () => {
    const onSubmit = vi.fn();
    const wallet = { connectedApi: {}, networkId: "undeployed" } as unknown as WalletContextValue;
    render(
      <WalletContext.Provider value={wallet}>
        <CircuitForm
          name="pay"
          args={[{ name: "to", type: { kind: "userAddress" } }]}
          busy={false}
          disabled={false}
          onSubmit={onSubmit}
        />
      </WalletContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "pay" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Use my address" }));
    expect(await screen.findByDisplayValue("ab".repeat(32))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pay" }));
    expect(onSubmit).toHaveBeenCalledWith([{ bytes: MY_ADDRESS }]);
  });

  it("disables Use my address without a wallet", () => {
    render(
      <CircuitForm
        name="pay"
        args={[{ name: "to", type: { kind: "userAddress" } }]}
        busy={false}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Use my address" })).toBeDisabled();
  });

  it("fills a ZswapCoinPublicKey with the connected wallet's own key", async () => {
    const onSubmit = vi.fn();
    const wallet = { connectedApi: {}, networkId: "undeployed" } as unknown as WalletContextValue;
    render(
      <WalletContext.Provider value={wallet}>
        <CircuitForm
          name="pay"
          args={[{ name: "to", type: { kind: "coinPublicKey" } }]}
          busy={false}
          disabled={false}
          onSubmit={onSubmit}
        />
      </WalletContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Use my key" }));
    expect(await screen.findByDisplayValue("cc".repeat(32))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pay" }));
    expect(onSubmit).toHaveBeenCalledWith([{ bytes: MY_KEY }]);
  });

  it("shows the result, books the coins it returned, and drops the coin it took", async () => {
    // A mint-and-send: returns a ShieldedSendResult with sent + change.
    const sendResult = { change: { is_some: true, value: coin(2) }, sent: coin(3) };
    render(
      <>
        <CircuitForm
          name="mintAndSend"
          args={[]}
          busy={false}
          disabled={false}
          onSubmit={async () => ({ ok: true, result: sendResult })}
        />
        <CircuitForm
          name="giveBack"
          args={[{ name: "coin", type: { kind: "shieldedCoin" } }]}
          busy={false}
          disabled={false}
          onSubmit={async () => ({ ok: true, result: [] })}
        />
      </>,
    );
    expect(screen.getByRole("button", { name: "giveBack" })).toBeDisabled();
    expect(screen.getByText("coin: no coins yet: run a circuit that returns one first")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "mintAndSend" }));
    expect(await screen.findByText(/"sent":\{"nonce":"0303/)).toBeInTheDocument();
    expect(bookedCoins().map((c) => c.source)).toEqual(["mintAndSend → change", "mintAndSend → sent"]);

    await userEvent.selectOptions(screen.getByLabelText("giveBack coin"), "03".repeat(32));
    await userEvent.click(screen.getByRole("button", { name: "giveBack" }));
    // [] shows nothing; the coin it took is gone, the other stays.
    await vi.waitFor(() => expect(bookedCoins().map((c) => c.source)).toEqual(["mintAndSend → change"]));
    expect(screen.queryAllByText(/^returned/)).toHaveLength(1);
  });

  it("keeps the coins when the call fails", async () => {
    act(() => void recordCoins("mint", coin(4)));
    render(
      <CircuitForm
        name="giveBack"
        args={[{ name: "coin", type: { kind: "shieldedCoin" } }]}
        busy={false}
        disabled={false}
        onSubmit={async () => ({ ok: false })}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("giveBack coin"), "04".repeat(32));
    await userEvent.click(screen.getByRole("button", { name: "giveBack" }));
    expect(bookedCoins()).toHaveLength(1);
  });
});
