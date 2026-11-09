import { describe, it, expect } from "vitest";
import { cleanChatText, lobbySlotIndexes, mergeChat, type SeenLine, type TriggerLine } from "../src/analyzers/chat";
import { ReplayParser, type Protocol } from "../src/ReplayParser";

const seen = (gameloop: number, userId: number, text: string, recipient: SeenLine["recipient"] = "allies"): SeenLine => ({
  gameloop,
  userId,
  recipient,
  text,
});
const trig = (gameloop: number, userId: number, text: string): TriggerLine => ({ gameloop, userId, text });
const noObservers = () => false;

describe("mergeChat", () => {
  it("takes the recipient and loop of the paired message line and the trigger text", () => {
    const out = mergeChat(
      [seen(100, 1, "hi", "all"), seen(200, 2, "\x0E:chenhappy:\x0F")],
      [trig(101, 1, "hi"), trig(202, 2, ":)")],
      noObservers,
    );
    expect(out).toEqual([seen(100, 1, "hi", "all"), seen(200, 2, ":)")]);
  });

  it("marks lines the recording player never saw as team chat, or observer chat for observers", () => {
    const out = mergeChat([], [trig(50, 3, "gg"), trig(60, 9, "nice")], (id) => id === 9);
    expect(out.map((l) => [l.userId, l.recipient])).toEqual([
      [3, "allies"],
      [9, "observers"],
    ]);
  });

  it("pairs in order per user, prefers equal text, and ignores lines outside the window", () => {
    const out = mergeChat(
      [seen(100, 1, "a", "all"), seen(101, 1, "b"), seen(300, 1, "c", "all")],
      [trig(102, 1, "b"), trig(103, 1, "a"), trig(400, 1, "c")],
      noObservers,
    );
    // "c" at 400 is 100 loops after its message: not paired → kept as both lines.
    expect(out.map((l) => [l.gameloop, l.text, l.recipient])).toEqual([
      [100, "a", "all"],
      [101, "b", "allies"],
      [300, "c", "all"],
      [400, "c", "allies"],
    ]);
  });

  it("keeps message lines with no trigger line (no game stream, or a decode error)", () => {
    const lines = [seen(10, 1, "x\x0Fy", "all"), seen(20, 2, "z")];
    expect(mergeChat(lines, [], noObservers)).toEqual([seen(10, 1, "xy", "all"), seen(20, 2, "z")]);
  });

  it("keeps a line on one line and drops other control characters", () => {
    expect(cleanChatText("a\x00b\x0E\x0Fc\td\ne\r\nf\x7F")).toBe("abc d e  f");
  });

  it("pairs equal text first, so unseen team chat can't take a seen all-chat line", () => {
    // Same loop: team chat "ez" (never shown to the recorder) comes before all-chat "gg" in the game stream.
    const out = mergeChat([seen(101, 4, "gg", "all")], [trig(101, 4, "ez"), trig(101, 4, "gg")], noObservers);
    expect(out.map((l) => [l.text, l.recipient])).toEqual([
      ["ez", "allies"],
      ["gg", "all"],
    ]);
  });
});

describe("mergeChat direct lines", () => {
  it("never pairs a direct line (`other`), which has no trigger echo", () => {
    const out = mergeChat([seen(100, 2, "psst", "other")], [trig(105, 2, "team plan")], noObservers);
    expect(out.map((l) => [l.text, l.recipient])).toEqual([
      ["psst", "other"],
      ["team plan", "allies"],
    ]);
  });
});

describe("lobbySlotIndexes", () => {
  it("matches by working-set slot id when the build has it", () => {
    const slots = [{ workingSetSlotId: 3, hasHero: true }, { workingSetSlotId: 0, hasHero: true }];
    expect(lobbySlotIndexes([{ m_workingSetSlotId: 0 }, { m_workingSetSlotId: 3 }, { m_workingSetSlotId: 9 }], slots)).toEqual([1, 0, -1]);
  });

  it("walks slots in order skipping observer and empty slots on builds without it", () => {
    const slots = [{ hasHero: false }, { hasHero: true }, { hasHero: false }, { hasHero: true }];
    expect(lobbySlotIndexes([{}, {}, {}], slots)).toEqual([1, 3, -1]);
  });
});

describe("iterGameEvents", () => {
  const bare = (protocol: Partial<Protocol>) => {
    const p = Object.create(ReplayParser.prototype) as ReplayParser;
    Object.assign(p, { warnings: [], protocol, mpq: { readFile: () => Buffer.from([1, 3, 32, 7]) } });
    return p;
  };

  it("yields nothing when the protocol lacks the game fields", () => {
    expect(Array.from(bare({ svaruint32_typeid: 0 }).iterGameEvents())).toEqual([]);
  });

  it("decodes delta, user id, event id and body", () => {
    const p = bare({
      svaruint32_typeid: 2,
      replay_userid_typeid: 3,
      game_eventid_typeid: 0,
      game_event_types: { 32: [1, "NNet.Game.STriggerChatMessageEvent"] },
      typeinfos: [
        ["_int", [[0, 8]]],
        ["_struct", [[["m_chatMessage", 0, 0]]]],
        ["_struct", [[["m_uint6", 0, 0]]]],
        ["_struct", [[["m_userId", 0, 0]]]],
      ] as never,
    });
    const events = Array.from(p.iterGameEvents());
    expect(events.map((e) => [e._event, e._gameloop, e._userid, e.m_chatMessage])).toEqual([
      ["NNet.Game.STriggerChatMessageEvent", 1, 3, 7],
    ]);
  });
});
