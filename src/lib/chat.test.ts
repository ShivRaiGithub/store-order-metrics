import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./chat";
import { loadOrders } from "./orders";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(loadOrders(), { today: "2025-10-29" });

  it("tells the model to answer Meta ad-spend questions with Instagram sales", () => {
    expect(prompt).toMatch(/ad spend on Meta/);
    expect(prompt).toMatch(/channel "Instagram"/);
    expect(prompt).toMatch(/Sales channels: .*Instagram/);
  });

  it("includes today and the catalog", () => {
    expect(prompt).toContain("(2025-10-29)");
    expect(prompt).toContain("P-1001: Alpine Down Parka (Outerwear)");
  });
});
