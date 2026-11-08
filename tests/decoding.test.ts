import { describe, it, expect } from "vitest";
import { VersionedDecoder } from "../src/decoders/BitPackedDecoder";
import {
  ReplayParser,
  decodeAttributeEvents,
  type Protocol,
  type ReplayEvent,
} from "../src/ReplayParser";
import { getAvailableBuilds } from "../src/protocols/map";
import { analyzeReplay, replayFiles } from "./helpers/replays";

/** A parser without an archive, for exercising protected decoding helpers. */
const bareParser = (protocol?: Partial<Protocol>) => {
  const p = Object.create(ReplayParser.prototype) as ReplayParser & {
    protocol?: Partial<Protocol>;
    decodeEventStream: (
      d: unknown,
      eventidTypeid: number,
      types: Record<number, [number, string]>,
      name: string,
      userIdTypeid?: number,
    ) => IterableIterator<ReplayEvent>;
    loadProtocolForBuild: (build: number) => Protocol;
  };
  Object.assign(p, { warnings: [], protocol });
  return p;
};

describe("event streams", () => {
  it("keeps the events before an unknown event id and records a warning", () => {
    // Fake decoder: delta, event id, event body, … as decoder.instance() results
    const values: unknown[] = [{ m_uint6: 2 }, 1, { m_a: 1 }, { m_uint6: 3 }, 99];
    const decoder = {
      done: () => values.length === 0,
      used_bits: () => 0,
      byte_align: () => {},
      instance: () => values.shift(),
    };
    const p = bareParser({ svaruint32_typeid: 0 });
    const events = Array.from(
      p.decodeEventStream(decoder, 1, { 1: [2, "NNet.Test.SEvent"] }, "replay.tracker.events"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]._event).toBe("NNet.Test.SEvent");
    expect(events[0]._gameloop).toBe(2);
    expect(p.warnings).toEqual([
      "replay.tracker.events: unknown eventid(99) at gameloop 5; rest of the stream skipped",
    ]);
  });
});

describe("message event stream", () => {
  it("reads the user id between the gameloop delta and the event id", () => {
    const calls: number[] = [];
    // typeid → next value: 0 delta, 8 user id, 1 event id, 178 chat body
    const queue: Record<number, unknown[]> = {
      0: [{ m_uint6: 10 }, { m_uint14: 300 }],
      8: [{ m_userId: 3 }, { m_userId: 12 }],
      1: [0, 0],
      178: [{ m_recipient: 1, m_string: "gl" }, { m_recipient: 0, m_string: "gg" }],
    };
    let left = 8;
    const decoder = {
      done: () => left === 0,
      used_bits: () => 0,
      byte_align: () => {},
      instance: (typeid: number) => {
        calls.push(typeid);
        left--;
        return queue[typeid].shift();
      },
    };
    const p = bareParser({ svaruint32_typeid: 0 });
    const events = Array.from(
      p.decodeEventStream(
        decoder,
        1,
        { 0: [178, "NNet.Game.SChatMessage"] },
        "replay.message.events",
        8,
      ),
    );
    expect(calls).toEqual([0, 8, 1, 178, 0, 8, 1, 178]);
    expect(events.map((e) => [e._gameloop, e._userid, e.m_string])).toEqual([
      [10, 3, "gl"],
      [310, 12, "gg"],
    ]);
  });

  it("returns no messages when the protocol lacks the message fields", () => {
    const p = bareParser({ svaruint32_typeid: 0 });
    Object.assign(p, { mpq: { readFile: () => Buffer.alloc(4) } });
    expect(p.getMessageEvents()).toEqual([]);
  });

  it("keeps the messages before a decode error and records a warning", () => {
    // Bytes: delta, user id, event id, body (event 5) · delta, user id, event 6 → typeid 99 throws.
    const p = bareParser({
      svaruint32_typeid: 2,
      replay_userid_typeid: 3,
      message_eventid_typeid: 0,
      message_event_types: { 5: [1, "NNet.Game.SChatMessage"], 6: [99, "NNet.Game.SBroken"] },
      typeinfos: [
        ["_int", [[0, 8]]],
        ["_struct", [[["m_a", 0, 0]]]],
        ["_struct", [[["m_uint6", 0, 0]]]],
        ["_struct", [[["m_userId", 0, 0]]]],
      ] as never,
    });
    Object.assign(p, { mpq: { readFile: () => Buffer.from([1, 3, 5, 7, 1, 4, 6]) } });
    const events = p.getMessageEvents();
    expect(events.map((e) => [e._event, e._gameloop, e._userid, e.m_a])).toEqual([
      ["NNet.Game.SChatMessage", 1, 3, 7],
    ]);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatch(/^replay\.message\.events: .*rest of the stream skipped$/);
  });
});

describe("protocol selection", () => {
  const builds = getAvailableBuilds();
  it.skipIf(builds.length === 0)("rejects a build older than every protocol", () => {
    expect(() => bareParser().loadProtocolForBuild(builds[0] - 1)).toThrow(
      /older than every protocol/,
    );
  });
  it.skipIf(builds.length === 0)("uses the closest older protocol for an unknown build", () => {
    const newest = builds[builds.length - 1];
    expect(bareParser().loadProtocolForBuild(newest + 1).version).toBe(newest);
  });
});

describe("versioned decoder", () => {
  it("throws on an unknown skip code instead of desyncing", () => {
    // struct (skip 5), 1 field, tag 7 (not declared) → skip code 10 (unknown)
    const buf = Buffer.from([0x05, 0x02, 0x0e, 0x0a]);
    const decoder = new VersionedDecoder(buf, [
      ["_struct", [[["m_a", 1, 0]]]],
      ["_int", [[0, 8]]],
    ] as never);
    expect(() => decoder.instance(0)).toThrow(/Unknown skip code 10/);
  });
});

describe("attribute events", () => {
  it("decodes the little-endian attribute stream", () => {
    const le32 = (v: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(v);
      return b;
    };
    const buf = Buffer.concat([
      Buffer.from([0x00]), // source
      le32(999), // map namespace
      le32(1), // count
      le32(999), // namespace
      le32(3009), // attrid
      Buffer.from([0x10]), // scope 16 (global)
      Buffer.from("\0\0Ds", "latin1").reverse(), // value "Ds" stored reversed
    ]);
    const attrs = decodeAttributeEvents(buf);
    expect(attrs.mapNamespace).toBe(999);
    expect(attrs.scopes[16][3009]).toEqual([{ namespace: 999, attrid: 3009, value: "Ds" }]);
  });

  it.skipIf(replayFiles.length === 0)("decodes the attributes of every corpus replay", async () => {
    for (const file of replayFiles.slice(0, 20)) {
      const p = new ReplayParser(file);
      p.init();
      const attrs = p.getAttributeEvents();
      expect(attrs, file).not.toBeNull();
      expect(Object.keys(attrs!.scopes).length, file).toBeGreaterThan(0);
      expect((await analyzeReplay(file)).warnings, file).toBeUndefined();
    }
  });
});
