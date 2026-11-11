# @astefanski/storm-parser

Parser for Heroes of the Storm `.StormReplay` files: players, heroes, BattleTags, talents, draft, score screen, timelines and derived team analytics.

[GitHub Repository](https://github.com/astefanski1/storm-parser)

## Installation

Public package on npm:

```bash
pnpm add @astefanski/storm-parser
# or npm install / yarn add
```

> **Protocols are included.** The package ships one protocol definition per HotS build (≈390, converted from [Blizzard/heroprotocol](https://github.com/Blizzard/heroprotocol)) in its `protocols/` folder. Installing runs no scripts and needs no network. Replays from a newer HotS patch than the package knows are decoded with the newest older protocol; update the package to pick up new builds.
>
> **0.1.0 is a breaking release:** removed LiveStreamParser, `ReplayParser.getGameEvents()`, the game/message event and `replay_attributes_events_typeid` fields of `Protocol`, `ReplayEvent._userid` and `XPBreakdownEntry.theoreticalMinionXP` (was always 0); `new ReplayParser()` requires a path or Buffer; `getAttributeEvents()` now returns `ReplayAttributes`; several analysis values changed meaning (see below).

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

`analyze()` takes a file path. Result: `{ status: 1, match, players, warnings? }` or `{ status: -2, error }`. `warnings` lists non-fatal decoding problems (e.g. an event stream cut short); the result may then be partial.

### Chat

```typescript
import { ReplayAnalyzer } from "@astefanski/storm-parser";

const chat = ReplayAnalyzer.readChat("path/to/replay.StormReplay"); // path or Buffer; sync, never throws
if (chat.status === 1) {
  for (const m of chat.messages!) {
    // m.time: seconds from the gates opening (negative before it); m.recipient: "all" | "allies" | "observers" | "other"
    console.log(m.time, m.player?.name, m.player?.hero, m.text);
  }
}
```

`readChat()` returns `{ status: 1, messages, game, warnings? }` or `{ status: -2, error }`. `messages` holds every player's chat, both teams included, in game order. Each `ChatMessage` has `gameloop`, `time`, `recipient`, `text` and `player` (`{ name, battleTag?, hero?, team?, observer }`, or `null` when the sender isn't in the lobby). The recording player never sees the other team's team chat, so those lines report `recipient: "allies"`. `game` has `map`, `date` (ISO), `duration` (seconds from the gates opening) and `players` (everyone in the match). Chat is not part of `analyze()`.

### ReplayParser (raw data)

```typescript
import { ReplayParser } from "@astefanski/storm-parser";
import * as fs from "fs";

const parser = new ReplayParser(fs.readFileSync("path/to/replay.StormReplay")); // path or Buffer
parser.init();

parser.getHeader();        // replay header (version, build)
parser.getDetails();       // replay.details
parser.getInitData();      // replay.initData (lobby, slots, game options)
parser.getTrackerEvents(); // replay.tracker.events (iterTrackerEvents() decodes lazily)
parser.getMessageEvents(); // replay.message.events (chat, pings, …), each with _userid
parser.iterGameEvents(); // replay.game.events, decoded lazily, each with _userid
parser.getAttributeEvents(); // replay.attributes.events → { source, mapNamespace, scopes }
parser.extractFile("replay.server.battlelobby"); // any raw MPQ file
```

### Raw event streams (no MPQ archive)
Decode one stream file from a buffer, e.g. the files the game writes while a match is running (`%TEMP%/Heroes of the Storm/TempWriteReplayP1/`). Pass the returned position back to read a growing file incrementally; a buffer cut inside an event returns the complete events before it.

```typescript
import { decodeStream, resolveProtocol } from "@astefanski/storm-parser";

const protocol = resolveProtocol(build); // the build's protocol, else the closest older one
let at = { fromByte: 0, gameloop: 0 };
const chunk = decodeStream(protocol, "tracker", buffer, at); // "tracker" | "game" | "message"
chunk.events;    // complete events (game / message events carry _userid)
chunk.truncated; // true when the buffer ended inside an event
chunk.warning;   // set when the stream can't be decoded further (events before that point are kept)
at = { fromByte: chunk.nextByte, gameloop: chunk.gameloop }; // continue here once the file grew
```

### Other exports
- `loadProtocol(build)`, `getAvailableBuilds()`, `resolveProtocol(build)` — protocol access.
- `normalizeMapName(rawTitle, mapFileName?)` and type `MapName` — canonical map names (`analyze()` already returns canonical names).
- `BitPackedDecoder`, `VersionedDecoder` — low-level decoders.
- All result types (`AnalysisResult`, `MatchStat`, `PlayerStat`, `TeamStat`, …, `ChatResult`, `ChatMessage`, `ChatGame`, `ChatPlayer`, `ChatRecipient`).

## What `analyze()` returns

**Match** (`result.match`)
- `map` (canonical English name, any client language), `mode` (Storm League, Hero League, Team League, Unranked Draft, Quick Match, ARAM, Versus AI, Brawl, Practice, Custom), `type`, `date` (ISO UTC), `rawDate` (Windows FILETIME), `length` (seconds), `region`, `version`.
- `winner` (0/1; -1 for a replay without a result, e.g. saved at a disconnect) and `winningPlayers`.
- Draft: `bans` per team `{ hero, order, absolute }`; `picks` per team in draft order and `picks.first` = team that picked first (complete drafts; otherwise player order and `first = -1`).
- Timelines: `takedowns` (`killers` = heroes credited, `x`/`y` in map cells), `levelTimes`, `XPBreakdown` (per team 0/1, XP points; end-of-game totals marked `final`), `mercs` (capturing team), `structures`, `objective` (map objective events with `name`, team, time, score, duration, end), `levelAdvTimeline`.
- `teams["0" | "1"]`: names, heroes, tags, level, takedowns and `stats` (totals, KDA, PPK, structures, level advantage, uptime from real respawns, wipes/aces, passive XP).

**Players** (`result.players`, keyed by ToonHandle `region-programId-realm-id`; AI players sharing a handle get `…:1`, `…:2`)
- `name`, `tag` (BattleTag = `name#tag`, any script; `0` if not found), `hero`, `team`, `win`, cosmetics (skin, mount, banner, spray, announcer), silence flags.
- `talents` (`Tier1Choice` … `Tier7Choice`, internal talent ids), `awards`, `gameStats` (all score-screen values plus computed `DPM`, `HPM`, `XPM`, `KDA` = Takedowns / Deaths, `KillParticipation`, per-death stats).
- `takedowns`, `deaths`, `units` (one entry per hero: its lives with spawn and respawn points).

## Development

```bash
pnpm install
pnpm generate:protocols   # once: protocols/ is not in git (fetches only missing builds)
pnpm test             # vitest; replay tests run on .StormReplay files in tests/replays/ or $STORM_PARSER_REPLAYS
pnpm exec tsc --noEmit
pnpm lint
pnpm build            # tsup → dist/ (cjs + esm + d.ts)
```

## License

ISC
