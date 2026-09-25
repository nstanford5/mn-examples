import { describe, expect, it } from "vitest";
import { colorLabel, formatStar, NIGHT_COLOR } from "../lib/tokens";

describe("tokens", () => {
  it("formats STAR with its NIGHT equivalent", () => {
    expect(formatStar(0n)).toBe("0 STAR (0 NIGHT)");
    expect(formatStar(2_000n)).toBe("2000 STAR (0.002 NIGHT)");
    expect(formatStar(1_500_000n)).toBe("1500000 STAR (1.5 NIGHT)");
  });

  it("labels NIGHT and known colors, and shortens the rest", () => {
    expect(colorLabel(NIGHT_COLOR)).toBe("NIGHT");
    expect(colorLabel("AB".repeat(32), { ["ab".repeat(32)]: "custom" })).toBe("custom");
    expect(colorLabel("cd".repeat(32))).toBe("cdcdcdcdcdcd…");
  });
});
