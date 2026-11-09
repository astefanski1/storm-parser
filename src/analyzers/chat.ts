import type { ChatRecipient } from "../types/index.js";

/** A `SChatMessage` (message stream): only lines the recording player could see, with the real recipient. */
export interface SeenLine {
  gameloop: number;
  userId: number | undefined;
  recipient: ChatRecipient;
  text: string;
}

/** A `STriggerChatMessageEvent` (game stream): every player's line, no recipient, emotes already resolved. */
export interface TriggerLine {
  gameloop: number;
  userId: number | undefined;
  text: string;
}

/** A trigger line arrives this many loops (1 s) after its message line at most (corpus: 0–2). */
export const MATCH_WINDOW = 16;

/**
 * One-line chat text: tabs and line breaks become spaces (a line can't pose as several lines in an export or
 * report), other control characters (emote markers `\x0E` / `\x0F`, …) are dropped.
 */
export const cleanChatText = (text: string) =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\t\n\r]/g, " ").replace(/[\x00-\x1F\x7F]/g, "");

/**
 * Every player's chat: trigger lines, each paired with the message line it echoes (same user, in order, within
 * `MATCH_WINDOW`) for the recipient and game loop. Equal text pairs first over the whole chat; a remaining trigger
 * then takes a remaining line of its window (emote text differs between the streams). Unpaired trigger lines were
 * never shown to the recording player, so they are team chat of the other side (`allies`), or observer chat for an
 * observer sender; all-chat would have reached the message stream. Unpaired message lines (e.g. after a game-stream
 * decode error) are kept. Sorted by game loop, stable.
 */
export function mergeChat(
  seen: SeenLine[],
  triggers: TriggerLine[],
  isObserver: (userId: number | undefined) => boolean,
): SeenLine[] {
  const seenText = seen.map((m) => cleanChatText(m.text));
  const pairOf = new Map<number, number>(); // trigger index → seen index
  const used = new Set<number>();
  const pair = (sameText: boolean) =>
    triggers.forEach((t, ti) => {
      if (pairOf.has(ti)) return;
      const text = cleanChatText(t.text);
      for (let i = 0; i < seen.length; i++) {
        const m = seen[i];
        // A direct line (`other`) has no trigger echo: never paired.
        if (used.has(i) || m.userId !== t.userId || m.recipient === "other") continue;
        const lag = t.gameloop - m.gameloop;
        if (lag < 0) break;
        if (lag > MATCH_WINDOW || (sameText && seenText[i] !== text)) continue;
        pairOf.set(ti, i);
        used.add(i);
        return;
      }
    });
  pair(true);
  pair(false);

  const out: SeenLine[] = triggers.map((t, ti) => {
    const text = cleanChatText(t.text);
    const i = pairOf.get(ti);
    if (i !== undefined) return { ...seen[i], text };
    const recipient: ChatRecipient = isObserver(t.userId) ? "observers" : "allies";
    return { gameloop: t.gameloop, userId: t.userId, recipient, text };
  });
  seen.forEach((m, i) => {
    if (!used.has(i)) out.push({ ...m, text: seenText[i] });
  });
  return out.sort((a, b) => a.gameloop - b.gameloop);
}

/**
 * Lobby slot index of each details player: the slot with the same `m_workingSetSlotId`, or on builds without it the
 * next slot that has a hero (observer and empty slots have none), walking both lists in order as `analyze` does.
 * -1 when there is none.
 */
export function lobbySlotIndexes(
  players: { m_workingSetSlotId?: number }[],
  slots: { workingSetSlotId?: number; hasHero: boolean }[],
): number[] {
  let walk = 0;
  return players.map((p) => {
    if (typeof p.m_workingSetSlotId === "number") {
      return slots.findIndex((s) => s.workingSetSlotId === p.m_workingSetSlotId);
    }
    while (walk < slots.length && !slots[walk].hasHero) walk++;
    return walk < slots.length ? walk++ : -1;
  });
}
