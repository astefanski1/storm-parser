import { describe, it, expect } from "vitest";
import {
  parsePythonLiteral,
  extractVariable,
  protocolFromPython,
} from "../scripts/generate-protocols";

describe("protocol generator: strict Python literal parser", () => {
  it("parses heroprotocol literals without eval", () => {
    const src = `[
    ('_int',[(0,7)]),  #0
    ('_choice',[(0,2),{0:('None',88),1:('TargetPoint',90)}]),  #1
    ('_struct',[[('m_a',2,-1)]]),
]`;
    expect(parsePythonLiteral(src).value).toEqual([
      ["_int", [[0, 7]]],
      ["_choice", [[0, 2], { "0": ["None", 88], "1": ["TargetPoint", 90] }]],
      ["_struct", [[["m_a", 2, -1]]]],
    ]);
    expect(parsePythonLiteral("(True, False, None)").value).toEqual([true, false, null]);
  });

  it("rejects anything that isn't a plain literal", () => {
    expect(() => parsePythonLiteral("__import__('os')")).toThrow(/unexpected token/);
    expect(() => parsePythonLiteral(String.raw`('a\x00')`)).toThrow(/escape/);
    expect(() => parsePythonLiteral("[1 2]")).toThrow(/expected ,/);
  });

  it("extracts top-level assignments and the protocol fields", () => {
    const code = [
      "typeinfos = [('_int',[(0,7)])]",
      "tracker_event_types = {",
      "    1: (5, 'NNet.Replay.Tracker.SUnitBornEvent'),",
      "}",
      "tracker_eventid_typeid = 2",
      "svaruint32_typeid = 7",
      "replay_header_typeid = 18",
      "game_details_typeid = 40",
      "replay_initdata_typeid = 73",
    ].join("\n");
    expect(extractVariable(code, "svaruint32_typeid")).toBe(7);
    expect(protocolFromPython(12345, code)).toEqual({
      version: 12345,
      typeinfos: [["_int", [[0, 7]]]],
      tracker_event_types: { "1": [5, "NNet.Replay.Tracker.SUnitBornEvent"] },
      tracker_eventid_typeid: 2,
      svaruint32_typeid: 7,
      replay_header_typeid: 18,
      game_details_typeid: 40,
      replay_initdata_typeid: 73,
    });
    expect(() => extractVariable(code, "missing")).toThrow(/not found/);
  });
});
