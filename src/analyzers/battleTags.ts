/**
 * BattleTag numbers from `replay.server.battlelobby`.
 *
 * The lobby stores each player's `name#digits` as UTF-8, preceded by one byte
 * holding its total byte length. Searching for every player's own `name#` and
 * checking that length byte finds names of any length or script (2-character
 * CJK names, punctuation such as `・`) and rejects hits inside longer names
 * (`Tester` in `BigTester`). Players are matched in details order; the k-th
 * player with a duplicated name takes the k-th hit.
 *
 * @returns one tag per name, 0 when the lobby has no valid hit
 */
export function findBattleTagNumbers(lobby: Buffer, names: string[]): number[] {
  const taken = new Set<number>();
  return names.map((name) => {
    if (!name) return 0;
    const needle = Buffer.from(`${name}#`, "utf8");
    for (
      let at = lobby.indexOf(needle);
      at !== -1;
      at = lobby.indexOf(needle, at + 1)
    ) {
      if (taken.has(at) || at === 0) continue;
      let end = at + needle.length;
      while (end < lobby.length && lobby[end] >= 0x30 && lobby[end] <= 0x39) end++;
      const digits = end - at - needle.length;
      if (digits === 0 || digits > 10) continue;
      if (lobby[at - 1] !== needle.length + digits) continue;
      taken.add(at);
      return Number(lobby.toString("latin1", at + needle.length, end));
    }
    return 0;
  });
}
