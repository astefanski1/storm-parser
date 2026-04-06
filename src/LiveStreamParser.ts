import {
  BitPackedDecoder,
  VersionedDecoder,
} from "./decoders/BitPackedDecoder.js";
import { getAvailableBuilds } from "./protocols/map.js";
import type { RawDetails, RawInitData } from "./types/index.js";
import type { ReplayEvent } from "./ReplayParser.js";
import { ReplayParser } from "./ReplayParser";

export class LiveStreamParser extends ReplayParser {
  constructor(build?: number) {
    super(); // No file passed, mpq won't be initialized, which is fine for raw streams
    let selectedBuild = build;
    if (!selectedBuild) {
      const builds = getAvailableBuilds();
      selectedBuild = builds[builds.length - 1];
    }

    this.protocol = this.loadProtocolForBuild(selectedBuild);
  }

  public parseTracker(buffer: Buffer): ReplayEvent[] {
    if (!this.protocol) return [];
    try {
      const decoder = new VersionedDecoder(buffer, this.protocol.typeinfos);
      return Array.from(
        this.decodeEventStream(
          decoder,
          this.protocol.tracker_eventid_typeid,
          this.protocol.tracker_event_types,
          false,
        ),
      );
    } catch (e: unknown) {
      // Buffer was truncated or invalid (since stream is written by chunks)
      console.error("[LiveStreamParser] Failed to parse tracker events", e);
      return [];
    }
  }

  public parseGame(buffer: Buffer): ReplayEvent[] {
    if (!this.protocol) return [];
    try {
      const decoder = new BitPackedDecoder(buffer, this.protocol.typeinfos);
      return Array.from(
        this.decodeEventStream(
          decoder,
          this.protocol.game_eventid_typeid,
          this.protocol.game_event_types,
          true,
        ),
      );
    } catch (e: unknown) {
      // Buffer was truncated or invalid
      console.error("[LiveStreamParser] Failed to parse game events", e);
      return [];
    }
  }
  public parseDetails(buffer: Buffer): RawDetails | null {
    if (!this.protocol) return null;
    try {
      const decoder = new VersionedDecoder(buffer, this.protocol.typeinfos);
      return decoder.instance(
        this.protocol.game_details_typeid,
      ) as unknown as RawDetails;
    } catch (e: unknown) {
      console.error("[LiveStreamParser] Failed to parse details", e);
      return null;
    }
  }

  public parseInitData(buffer: Buffer): RawInitData | null {
    if (!this.protocol) return null;
    try {
      const decoder = new BitPackedDecoder(buffer, this.protocol.typeinfos);
      return decoder.instance(
        this.protocol.replay_initdata_typeid,
      ) as unknown as RawInitData;
    } catch (e: unknown) {
      console.error("[LiveStreamParser] Failed to parse initData", e);
      return null;
    }
  }
}
