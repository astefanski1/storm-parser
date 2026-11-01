# @astefanski/storm-parser

Parser for Heroes of the Storm `.StormReplay` files: players, heroes, BattleTags, talents, draft, score screen, timelines and derived team analytics.

[GitHub Repository](https://github.com/astefanski1/storm-parser)

## Installation

Public package on npm:

```bash
pnpm add @astefanski/storm-parser
# or npm install / yarn add
```

> **Protocols are downloaded on install.** A `postinstall` script fetches every protocol definition from [Blizzard/heroprotocol](https://github.com/Blizzard/heroprotocol) into the package's `protocols/` folder (≈390 builds). It needs network access to the GitHub API and is skipped when `protocols/` already contains JSON — delete the folder and run `pnpm generate:protocols` to refresh after a new HotS patch.

## Usage

### ReplayAnalyzer (high level)

```typescript
import { ReplayAnalyzer } from "@astefanski/storm-parser";

const result = await ReplayAnalyzer.analyze("path/to/replay.StormReplay");

if (result.status === 1) {
  console.log(result.match?.map, result.match?.mode, result.match?.length, result.match?.winner);
} else {
  console.error(result.error); // status -2: any failure; analyze() never throws
}
```

`analyze()` takes a file path. Result: `{ status: 1, match, players }` or `{ status: -2, error }`.

### ReplayParser (raw data)

```typescript
import { ReplayParser } from "@astefanski/storm-parser";
import * as fs from "fs";

const parser = new ReplayParser(fs.readFileSync("path/to/replay.StormReplay")); // path or Buffer
parser.init();

parser.getHeader();        // replay header (version, build)
parser.getDetails();       // replay.details
parser.getInitData();      // replay.initData (lobby, slots, game options)
parser.getTrackerEvents(); // replay.tracker.events
parser.getGameEvents();    // replay.game.events
parser.extractFile("replay.server.battlelobby"); // any raw MPQ file
```

`getAttributeEvents()` is currently broken (missing typeid in generated protocols).

### Other exports
- `LiveStreamParser` — decodes raw tracker/game/details/initData buffers for a given (or newest) build without an MPQ archive.
- `loadProtocol(build)`, `getAvailableBuilds()` — protocol access.
- `normalizeMapName(rawTitle, mapFileName?)` and type `MapName` — canonical map names (not applied automatically by `analyze()`).
- `BitPackedDecoder`, `VersionedDecoder` — low-level decoders.
- All result types (`AnalysisResult`, `MatchStat`, `PlayerStat`, `TeamStat`, …).

## What `analyze()` returns

**Match** (`result.match`)
- `map` (raw localized map title), `mode` (Storm League, Hero League, Quick Match, ARAM, Unranked Draft, Team League, Custom), `type`, `date` (ISO UTC), `rawDate` (Windows FILETIME), `length` (seconds), `region`, `version`.
- `winner` (0/1; -1 if unresolved) and `winningPlayers` (ToonHandles).
- Draft: `bans` per team `{ hero, order, absolute }`; `picks` per team (player-list order) and `picks.first` (falls back to 0 when unknown).
- Timelines: `takedowns`, `levelTimes`, `XPBreakdown`, `mercs`, `structures`, `objective` (generic objective events: team, time, score), `levelAdvTimeline`.
- `teams["0" | "1"]`: names, heroes, tags, level, takedowns and `stats` (totals, KDA, PPK, structures, level advantage, uptime, wipes/aces, passive XP).

**Players** (`result.players`, keyed by ToonHandle `region-programId-realm-id`)
- `name`, `tag` (BattleTag = `name#tag`; `0` if not found), `hero`, `team`, `win`, cosmetics (skin, mount, banner, spray, announcer), silence flags.
- `talents` (`Tier1Choice` … `Tier7Choice`, internal talent ids), `awards`, `gameStats` (all score-screen values plus computed `DPM`, `HPM`, `XPM`, `KDA` = Takedowns / Deaths, `KillParticipation`, per-death stats).
- `takedowns`, `deaths`, `units` (hero lives; spawn location only).

## Development

```bash
pnpm install          # also downloads protocols
pnpm test             # vitest
pnpm exec tsc --noEmit
pnpm lint
pnpm build            # tsup → dist/ (cjs + esm + d.ts)
```

## License

ISC
