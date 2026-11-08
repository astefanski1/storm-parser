import { describe, it, expect } from "vitest";
import {
  parsePythonLiteral,
  extractVariable,
  protocolFromPython,
  isComplete,
} from "../scripts/generate-protocols";
import fs from "fs";
import os from "os";
import path from "path";

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
      "message_event_types = {",
      "    0: (100, 'NNet.Game.SChatMessage'),",
      "}",
      "message_eventid_typeid = 3",
      "replay_userid_typeid = 9",
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
      message_event_types: { "0": [100, "NNet.Game.SChatMessage"] },
      message_eventid_typeid: 3,
      replay_userid_typeid: 9,
    });
    expect(() => extractVariable(code, "missing")).toThrow(/not found/);
  });
});

describe("protocol generator: completeness check", () => {
  it("refetches missing, unreadable or incomplete JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-gen-"));
    const file = path.join(dir, "protocol1.json");
    expect(isComplete(file)).toBe(false);
    fs.writeFileSync(file, "{not json");
    expect(isComplete(file)).toBe(false);
    const old = {
      typeinfos: [],
      tracker_event_types: {},
      tracker_eventid_typeid: 0,
      svaruint32_typeid: 0,
      replay_header_typeid: 0,
      game_details_typeid: 0,
      replay_initdata_typeid: 0,
    };
    fs.writeFileSync(file, JSON.stringify(old));
    expect(isComplete(file)).toBe(false);
    fs.writeFileSync(
      file,
      JSON.stringify({ ...old, message_event_types: {}, message_eventid_typeid: 0, replay_userid_typeid: 0 }),
    );
    expect(isComplete(file)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
