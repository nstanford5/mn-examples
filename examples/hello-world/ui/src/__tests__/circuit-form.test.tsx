// The generic circuit form and its argument parsing (lib/circuit-args.ts).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MAX_FIELD } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { CircuitForm } from "../components/circuit-form";
import { parseArg, parseArgs, type ArgSpec } from "../lib/circuit-args";

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
});
