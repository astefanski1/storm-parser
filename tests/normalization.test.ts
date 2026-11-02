import { describe, it, expect } from "vitest";
import { normalizeHeroName } from "../src/analyzers/heroesList";
import { normalizeMapName, validMaps } from "../src/analyzers/mapsList";
import { AMM_MODES } from "../src/ReplayAnalyzer";

describe("hero, map and mode identity", () => {
  it("maps the internal names the draft events use", () => {
    expect(normalizeHeroName("Firebat")).toBe("Blaze");
    expect(normalizeHeroName("MeiOW")).toBe("Mei");
    expect(normalizeHeroName("NexusHunter")).toBe("Qhira");
    expect(normalizeHeroName("Lucio")).toBe("Lucio");
    expect(normalizeHeroName("Lúcio")).toBe("Lucio");
    expect(normalizeHeroName("HeroLucio")).toBe("Lucio");
  });

  it("knows the ARAM map Braxis Outpost", () => {
    expect(validMaps).toContain("Braxis Outpost");
    expect(normalizeMapName("Braxis Outpost", undefined)).toBe("Braxis Outpost");
  });

  it("maps matchmaking queue ids to modes", () => {
    expect(AMM_MODES[50091]).toBe("Storm League");
    expect(AMM_MODES[50101]).toBe("ARAM");
    expect(AMM_MODES[50021]).toBe("Versus AI");
    expect(AMM_MODES[50031]).toBe("Brawl");
    expect(AMM_MODES[12345]).toBeUndefined();
  });
});
