import { describe, it, expect } from "vitest";
import { findBattleTagNumbers } from "../src/analyzers/battleTags";

/** Lobby-like buffer: each `name#tag` preceded by its UTF-8 byte length. */
const lobby = (...entries: string[]): Buffer =>
  Buffer.concat(
    entries.flatMap((e) => {
      const b = Buffer.from(e, "utf8");
      return [Buffer.from([0x00, 0x41, b.length]), b, Buffer.from("zØ\x02", "utf8")];
    }),
  );

describe("findBattleTagNumbers", () => {
  it("finds 2-character CJK names and names with punctuation", () => {
    const buf = lobby("小明#1234", "テスト・・#5678", "Abc#9012");
    expect(findBattleTagNumbers(buf, ["小明", "テスト・・", "Abc"])).toEqual([1234, 5678, 9012]);
  });

  it("does not take a name inside a longer name (length byte check)", () => {
    const buf = lobby("BigTester#11111", "Tester#22222");
    expect(findBattleTagNumbers(buf, ["BigTester", "Tester"])).toEqual([11111, 22222]);
    expect(findBattleTagNumbers(lobby("BigTester#11111"), ["Tester"])).toEqual([0]);
  });

  it("gives the k-th player with a duplicated name the k-th hit", () => {
    const buf = lobby("Tester#3333", "Other#1", "Tester#44444");
    expect(findBattleTagNumbers(buf, ["Tester", "Other", "Tester"])).toEqual([3333, 1, 44444]);
  });

  it("returns 0 for missing names, empty names and a wrong length byte", () => {
    const bad = Buffer.concat([Buffer.from([0x05]), Buffer.from("Abc#1234")]);
    expect(findBattleTagNumbers(bad, ["Abc", "", "Nobody"])).toEqual([0, 0, 0]);
  });
});
