// The operations form: previews what each circuit would store, disables the
// buttons the contract would reject (with the reason), and hands the circuit
// bigint operands.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OperationsCard } from "../components/calculator-panel";

async function setOperands(a: string, b: string) {
  await userEvent.clear(screen.getByLabelText("num1"));
  if (a) await userEvent.type(screen.getByLabelText("num1"), a);
  await userEvent.clear(screen.getByLabelText("num2"));
  if (b) await userEvent.type(screen.getByLabelText("num2"), b);
}

describe("OperationsCard", () => {
  it("previews every operation and submits bigint operands", async () => {
    const onRun = vi.fn();
    render(<OperationsCard busy={null} disabled={false} onRun={onRun} />);

    // Defaults 20 and 6, as in the Node test's divide step.
    expect(screen.getByTestId("preview-add")).toHaveTextContent("20 + 6 = 26");
    expect(screen.getByTestId("preview-subtract")).toHaveTextContent("20 − 6 = 14");
    expect(screen.getByTestId("preview-multiply")).toHaveTextContent("20 × 6 = 120");
    expect(screen.getByTestId("preview-square")).toHaveTextContent("20² = 400");
    expect(screen.getByTestId("preview-divide")).toHaveTextContent("20 ÷ 6 = 3");

    await userEvent.click(screen.getByRole("button", { name: "divide" }));
    expect(onRun).toHaveBeenCalledWith("divide", 20n, 6n);
  });

  it("disables operations the contract would reject, with the reason", async () => {
    render(<OperationsCard busy={null} disabled={false} onRun={vi.fn()} />);

    await setOperands("3", "0");
    expect(screen.getByRole("button", { name: "divide" })).toBeDisabled();
    expect(screen.getByTestId("preview-divide")).toHaveTextContent("cannot divide by zero");
    expect(screen.getByRole("button", { name: "add" })).toBeEnabled();

    await setOperands("1", "2");
    expect(screen.getByRole("button", { name: "subtract" })).toBeDisabled();
    expect(screen.getByTestId("preview-subtract")).toHaveTextContent("the result would be negative");

    await setOperands("256", "256");
    expect(screen.getByRole("button", { name: "multiply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "square" })).toBeDisabled();
    expect(screen.getByTestId("preview-square")).toHaveTextContent("exceed 65535");

    // square only needs num1, so an empty num2 disables the others but not it.
    await setOperands("12", "");
    expect(screen.getByRole("button", { name: "square" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "add" })).toBeDisabled();
  });

  it("disables everything while another operation is in flight", () => {
    render(<OperationsCard busy="add" disabled onRun={vi.fn()} />);
    for (const op of ["add", "subtract", "multiply", "square", "divide"]) {
      expect(screen.getByRole("button", { name: op })).toBeDisabled();
    }
    expect(screen.getByText(/waiting for wallet approval/)).toBeInTheDocument();
  });
});
