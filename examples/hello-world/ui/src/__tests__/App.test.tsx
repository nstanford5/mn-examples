import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "../App";

// App pulls in the whole Midnight provider stack through its imports. Rendering
// it in jsdom also checks that those modules load without a wallet present.
describe("App", () => {
  it("renders the connect prompt when no wallet is connected", () => {
    render(<App />);
    expect(screen.getByText("Midnight Hello World")).toBeInTheDocument();
    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
    expect(screen.getByLabelText("Network")).toHaveValue("undeployed");
  });
});
