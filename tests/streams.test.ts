import { describe, it, expect } from "vitest";
import { decodeStream, resolveProtocol, type StreamKind } from "../src/streams";
import { ReplayParser, type Protocol, type ReplayEvent } from "../src/ReplayParser";
import { getAvailableBuilds } from "../src/protocols/map";
import { replayFiles } from "./helpers/replays";

// Bit-packed message-like stream: delta (typeid 2), user id (3), event id (0), body (1).
// Event 5 = SChat { m_a: u8 }; event 6's body typeid 99 does not exist (corrupt stream).
const fake = {
  version: 1,
  svaruint32_typeid: 2,
  replay_userid_typeid: 3,
  message_eventid_typeid: 0,
  message_event_types: { 5: [1, "NNet.Game.SChat"], 6: [99, "NNet.Game.SBroken"] },
  typeinfos: [
    ["_int", [[0, 8]]],
    ["_struct", [[["m_a", 0, 0]]]],
    ["_struct", [[["m_uint6", 0, 0]]]],
    ["_struct", [[["m_userId", 0, 0]]]],
  ],
} as unknown as Protocol;
// Three events: (delta 1, user 3, a 7) (delta 2, user 4, a 8) (delta 4, user 5, a 9), 4 bytes each.
const three = Buffer.from([1, 3, 5, 7, 2, 4, 5, 8, 4, 5, 5, 9]);
const view = (events: ReplayEvent[]) => events.map((e) => [e._gameloop, e._userid, e.m_a]);

describe("decodeStream (raw buffer)", () => {
  it("decodes a whole stream and reports where it ended", () => {
    const chunk = decodeStream(fake, "message", three);
    expect(view(chunk.events)).toEqual([
      [1, 3, 7],
      [3, 4, 8],
      [7, 5, 9],
    ]);
    expect(chunk).toMatchObject({ nextByte: 12, gameloop: 7, truncated: false });
    expect(chunk.warning).toBeUndefined();
  });

  it("keeps the complete events of a buffer cut inside an event", () => {
    const chunk = decodeStream(fake, "message", three.subarray(0, 10));
    expect(view(chunk.events)).toEqual([
      [1, 3, 7],
      [3, 4, 8],
    ]);
    expect(chunk).toMatchObject({ nextByte: 8, gameloop: 3, truncated: true });
  });

  it("continues from nextByte / gameloop once the file has grown", () => {
    const first = decodeStream(fake, "message", three.subarray(0, 6));
    const rest = decodeStream(fake, "message", three, { fromByte: first.nextByte, gameloop: first.gameloop });
    expect(view([...first.events, ...rest.events])).toEqual(view(decodeStream(fake, "message", three).events));
    expect(rest).toMatchObject({ nextByte: 12, gameloop: 7, truncated: false });
  });

  it("returns nothing new for an empty tail", () => {
    expect(decodeStream(fake, "message", three, { fromByte: 12, gameloop: 7 })).toMatchObject({
      events: [],
      nextByte: 12,
      gameloop: 7,
      truncated: false,
    });
  });

  it("stops at an unknown event id with a warning", () => {
    const chunk = decodeStream(fake, "message", Buffer.from([1, 3, 5, 7, 1, 3, 9, 0]));
    expect(view(chunk.events)).toEqual([[1, 3, 7]]);
    expect(chunk.warning).toBe("replay.message.events: unknown eventid(9) at gameloop 2; rest of the stream skipped");
    expect(chunk.nextByte).toBe(4);
  });

  it("keeps the events before another decode error and stops there with a warning", () => {
    const chunk = decodeStream(fake, "message", Buffer.from([1, 3, 5, 7, 1, 3, 6, 7]));
    expect(view(chunk.events)).toEqual([[1, 3, 7]]);
    expect(chunk).toMatchObject({ nextByte: 4, gameloop: 1, truncated: false });
    expect(chunk.warning).toMatch(/^replay\.message\.events: .+ after gameloop 1; rest of the stream skipped$/);
  });

  it("refuses a stream the protocol has no fields for", () => {
    expect(() => decodeStream(fake, "game", three)).toThrow("Protocol 1 has no game event fields");
  });
});

describe("resolveProtocol", () => {
  const builds = getAvailableBuilds();
  it.skipIf(builds.length === 0)("uses the exact or closest older protocol", () => {
    const newest = builds[builds.length - 1];
    expect(resolveProtocol(newest).version).toBe(newest);
    expect(resolveProtocol(newest + 1).version).toBe(newest);
  });
  it.skipIf(builds.length === 0)("rejects a build older than every protocol", () => {
    expect(() => resolveProtocol(builds[0] - 1)).toThrow(/older than every protocol/);
  });
});

describe.skipIf(replayFiles.length === 0)("decodeStream on a replay's stream files", () => {
  const parser = new ReplayParser(replayFiles[0]);
  parser.init();
  const protocol = resolveProtocol(parser.getBuild());
  const strip = (events: ReplayEvent[]) => JSON.stringify(events, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  const cases: [StreamKind, string, () => ReplayEvent[]][] = [
    ["tracker", "replay.tracker.events", () => parser.getTrackerEvents()],
    ["game", "replay.game.events", () => [...parser.iterGameEvents()]],
  ];

  for (const [kind, file, expected] of cases) {
    const buf = parser.extractFile(file)!;

    it(`${kind}: whole file equals the ReplayParser getter`, () => {
      const chunk = decodeStream(protocol, kind, buf);
      expect(chunk.truncated).toBe(false);
      expect(chunk.nextByte).toBe(buf.length);
      expect(strip(chunk.events)).toBe(strip(expected()));
    });

    it(`${kind}: a file read while growing (4 KB blocks) decodes to the same events`, () => {
      const events: ReplayEvent[] = [];
      let at = { fromByte: 0, gameloop: 0 };
      for (let size = 4096; ; size += 4096) {
        const chunk = decodeStream(protocol, kind, buf.subarray(0, Math.min(size, buf.length)), at);
        events.push(...chunk.events);
        at = { fromByte: chunk.nextByte, gameloop: chunk.gameloop };
        if (size >= buf.length) {
          expect(chunk.truncated).toBe(false);
          break;
        }
      }
      expect(at.fromByte).toBe(buf.length);
      expect(strip(events)).toBe(strip(expected()));
    });
  }
});
