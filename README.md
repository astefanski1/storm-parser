# @astefanski/storm-parser

A tool for parsing Heroes of the Storm (`.StormReplay`) replay files. Extract valuable match data including players, heroes, builds, match results, and more.

[GitHub Repository](https://github.com/astefanski1/storm-parser)

## Installation

This is a private scoped package. Ensure you have access and are authenticated with npm, then install it via:

```bash
npm install @astefanski/storm-parser
# or using pnpm
pnpm add @astefanski/storm-parser
# or using yarn
yarn add @astefanski/storm-parser
```

> **Note:** During installation, a `postinstall` script automatically downloads protocol definitions from the [Blizzard/heroprotocol](https://github.com/Blizzard/heroprotocol) GitHub repository. This requires internet access and may take 1-2 minutes on first install.

## Usage

The package exports two main classes: `ReplayParser` and `ReplayAnalyzer`.

### ReplayParser

Used for reading the replay file and extracting the raw protocol data and events.

```typescript
import { ReplayParser } from "@astefanski/storm-parser";
import * as fs from "fs";

// Read the replay file into a buffer
const replayBuffer = fs.readFileSync("path/to/your/replay.StormReplay");

// Initialize the parser
const parser = new ReplayParser(replayBuffer);
parser.init();

// Access the parsed replay data
console.log("Details:", parser.getDetails());
console.log("Init Data:", parser.getInitData());
console.log("Tracker Events Count:", parser.getTrackerEvents().length);
```

### ReplayAnalyzer

Used for higher-level analysis, transforming the raw replay data into structured match information, team compositions, and player stats.

```typescript
import { ReplayAnalyzer } from "@astefanski/storm-parser";

const result = await ReplayAnalyzer.analyze("path/to/your/replay.StormReplay");

if (result.status === 1) {
  console.log("Map Name:", result.match?.map);
  console.log("Match Length (seconds):", result.match?.length);
  console.log("Winning Team:", result.match?.winner);
}
```

## Retrievable Data

The `ReplayAnalyzer` provides a comprehensive `AnalysisResult` containing structured data about the match, teams, and players.

### Match Metadata

- **Basic Info**: Map name, match date (UTC), match length (seconds), game mode, game type, and region.
- **Result**: Winning team ID and a list of winning player handles.
- **Draft**:
  - Hero picks for both teams.
  - Hero bans for both teams (including ban order).
  - First pick team identification.

### In-Game Events

- **Takedowns**: Detailed kill events including killers, victim, time, and map coordinates (X, Y).
- **XP Breakdown**: Periodic and end-of-game breakdown of XP sources (Minion, Creep, Structure, Hero, and Trickle XP).
- **Mercenaries**:
  - Capture events (camp type, team, time).
  - Unit tracking (locations over time and total active duration).
- **Structures**: Tracking of all destroyed structures (Forts, Keeps, Towers, Wells) with destruction time and team ownership.
- **Objectives**: Map-specific objective progress, scores, and event types (e.g., Cursed Hollow Tributes, Volskaya Protectors).

### Player Statistics

Each player object contains:

- **Profile**: Name, BattleTag, Hero played, Team, and Win/Loss status.
- **Game Stats**: All standard end-of-game stats (Damage, Healing, Deaths, Assists, Experience Contribution, Time Spent Dead, etc.).
- **Computed Analytics**:
  - **DPM/HPM/XPM**: Damage/Healing/Experience per minute.
  - **KDA**: Kill/Death/Assist ratio.
  - **Kill Participation**: Percentage of team kills the player participated in.
  - **Per-Death Stats**: Damage taken/done and healing per death.
- **Build**: Full talent choices for all tiers (Tier 1-7).
- **Awards**: Match awards (e.g., MVP, Siege Master).
- **Position Tracking**: Movement paths and life cycles of the player's hero unit.

### Team Analytics

- **Performance Totals**: Aggregated stats for the entire team (Total Hero Damage, Self Healing, protection given, etc.).
- **Combat Stats**: KDA, average time spent dead, team wipes, and aces (enemy team wipes).
- **Level Dynamics**:
  - Level-up timestamps.
  - Level advantage timeline (who had the lead and by how much).
  - Time spent with level/hero advantage.
- **Passive XP**: Passive XP gain rates and differences between teams.
- **Structure Control**: Counts of lost/destroyed Forts and Keeps, and identification of who destroyed the first Fort/Keep.

## Technical Reference

After calling `ReplayAnalyzer.analyze()`, you receive an `AnalysisResult` object. Below are examples of how to access specific data points.

### Accessing Player Data

Player data is stored in the `players` map, keyed by a unique `ToonHandle` (format: `region-programId-realm-id`).

```typescript
const result = await ReplayAnalyzer.analyze("replay.StormReplay");

if (result.status === 1 && result.players) {
  // result.match.playerIDs contains the list of all ToonHandles
  const firstPlayerHandle = result.match.playerIDs[0];
  const player = result.players[firstPlayerHandle];

  console.log(`Hero: ${player.hero}`);
  console.log(`BattleTag: ${player.name}#${player.tag}`);

  // Accessing specific game stats
  console.log(`Hero Damage: ${player.gameStats.HeroDamage}`);
  console.log(`Deaths: ${player.gameStats.Deaths}`);

  // Computed analytics
  console.log(`DPM: ${player.gameStats.DPM}`);
  console.log(`Kill Participation: ${player.gameStats.KillParticipation}`);
}
```

### Accessing Team Analytics

Team-specific data is located under `result.match.teams`, separated into "0" (Blue) and "1" (Red).

```typescript
const team0 = result.match.teams["0"];

console.log(`Team Level: ${team0.level}`);
console.log(`Team Takedowns: ${team0.takedowns}`);

// Aggregated totals for the whole team
console.log(`Total Team Healing: ${team0.stats.totals.Healing}`);

// Team-level advantage stats
console.log(`Level Adv Time: ${team0.stats.levelAdvTime} seconds`);
console.log(`Average Heroes Alive: ${team0.stats.avgHeroesAlive}`);
```

### Accessing Match Events

The match object contains timelines for various game events.

```typescript
// Takedowns (kills) with coordinates and participants
result.match.takedowns.forEach((event) => {
  console.log(
    `[${event.time}s] ${event.killers[0].hero} killed ${event.victim.hero} at (${event.x}, ${event.y})`,
  );
});

// XP Breakdown over time
result.match.XPBreakdown.forEach((entry) => {
  console.log(
    `[${entry.time}s] Team ${entry.team} Level ${entry.teamLevel} - Minion XP: ${entry.breakdown.MinionXP}`,
  );
});

// Mercenary captures
result.match.mercs.captures.forEach((capture) => {
  console.log(
    `Team ${capture.team} captured ${capture.type} at ${capture.time}s`,
  );
});
```

### Accessing Draft Information

Draft data is split between picks and bans.

```typescript
// Hero Bans by team and order
const team0Bans = result.match.bans["0"]; // Array of { hero: string, order: number }

// Hero Picks by team
const team1Picks = result.match.picks["1"]; // Array of hero names

// Which team had the first pick (0 or 1)
const firstPickTeam = result.match.picks.first;
```

## Features

- Parses `replay.details`, `replay.initData`, `replay.tracker.events`, and more.
- Extracts detailed player information, including BattleTags and selected heroes.
- Decodes tracker events for in-depth match analysis (e.g., score screens, talent choices).
- Protocols are downloaded on install — package stays lightweight (~15KB).
- Provides a clean, typed API for easy integration.

## License

ISC
