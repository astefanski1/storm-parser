import { MpqReader } from "./mpq/MpqReader";
import {
  BitPackedDecoder,
  VersionedDecoder,
} from "./decoders/BitPackedDecoder";
import { loadProtocol, getAvailableBuilds } from "./protocols/map.js";
import type { RawDetails, RawHeader, RawInitData } from "./types/index.js";

export type TypeInfo = [string, number[]?];

export interface Protocol {
  version: number;
  typeinfos: TypeInfo[];
  game_event_types: Record<number, [number, string]>;
  message_event_types: Record<number, [number, string]>;
  tracker_event_types: Record<number, [number, string]>;
  game_eventid_typeid: number;
  message_eventid_typeid: number;
  tracker_eventid_typeid: number;
  svaruint32_typeid: number;
  replay_userid_typeid: number;
  replay_header_typeid: number;
  game_details_typeid: number;
  replay_initdata_typeid: number;
  replay_attributes_events_typeid: number;
}

export interface ReplayEvent {
  _event: string;
  _eventid: number;
  _gameloop: number;
  _userid?: unknown;
  _bits: number;
  [key: string]: unknown;
}

export class ReplayParser {
  protected mpq!: MpqReader;
  protected header: RawHeader | undefined;
  protected build: number = 0;
  protected protocol?: Protocol;
  protected baseProtocol?: Protocol;

  constructor(filenameOrData?: string | Buffer) {
    if (filenameOrData) {
      this.mpq = new MpqReader(filenameOrData, false);
    }
  }

  public init(): void {
    // Load base protocol to read header (oldest known: 29406)
    const base = loadProtocol(29406);
    if (!base) {
      throw new Error(
        "Base protocol29406 not found. Did postinstall run? " +
          "Try: npx tsx node_modules/@astefanski/storm-parser/scripts/postinstall.ts",
      );
    }
    this.baseProtocol = base;

    const userDataHeader = this.mpq.header.userDataHeader;
    if (!userDataHeader || !userDataHeader.content) {
      throw new Error("Replay does not have a user data header");
    }

    const decoder = new VersionedDecoder(
      userDataHeader.content,
      this.baseProtocol.typeinfos,
    );
    this.header = decoder.instance(
      this.baseProtocol.replay_header_typeid,
    ) as unknown as RawHeader;
    this.build = this.header.m_version.m_baseBuild;

    // Load actual protocol for the replay's build version
    this.protocol = this.loadProtocolForBuild(this.build);
  }

  protected loadProtocolForBuild(build: number): Protocol {
    let protocol = loadProtocol(build);
    if (!protocol) {
      // Find closest available build that is <= the requested build
      const builds = getAvailableBuilds();
      let closestBuild = builds[0];
      for (const v of builds) {
        if (v <= build && v > closestBuild) {
          closestBuild = v;
        }
      }
      protocol = loadProtocol(closestBuild);
    }
    if (!protocol) {
      throw new Error(`No protocol found for build ${build}`);
    }
    return protocol;
  }

  protected *decodeEventStream(
    decoder: BitPackedDecoder | VersionedDecoder,
    eventidTypeid: number,
    eventTypes: Record<number, [number, string]>,
    decodeUserId: boolean,
  ): IterableIterator<ReplayEvent> {
    if (!this.protocol) throw new Error("Protocol not loaded");
    let gameloop = 0;

    while (!decoder.done()) {
      const startBits = decoder.used_bits();

      const deltaInstance = decoder.instance(
        this.protocol.svaruint32_typeid,
      ) as Record<string, number>;
      const deltaKey = Object.keys(deltaInstance)[0];
      const delta = deltaInstance[deltaKey];
      gameloop += delta;

      const userid = decodeUserId
        ? decoder.instance(this.protocol.replay_userid_typeid)
        : undefined;
      const eventid = Number(decoder.instance(eventidTypeid));

      const eventType = eventTypes[eventid];
      if (!eventType) {
        throw new Error(`Unknown eventid(${eventid})`);
      }

      const typeid = eventType[0];
      const typename = eventType[1];

      const event = decoder.instance(typeid) as ReplayEvent;
      event._event = typename;
      event._eventid = eventid;
      event._gameloop = gameloop;
      if (decodeUserId) event._userid = userid;

      decoder.byte_align();
      event._bits = decoder.used_bits() - startBits;

      yield event;
    }
  }

  public getDetails(): RawDetails | null {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const buf = this.mpq.readFile("replay.details");
    if (!buf) return null;
    const decoder = new VersionedDecoder(buf, this.protocol.typeinfos);
    return decoder.instance(
      this.protocol.game_details_typeid,
    ) as unknown as RawDetails;
  }

  public getInitData(): RawInitData | null {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const buf = this.mpq.readFile("replay.initData");
    if (!buf) return null;
    const decoder = new BitPackedDecoder(buf, this.protocol.typeinfos);
    return decoder.instance(
      this.protocol.replay_initdata_typeid,
    ) as unknown as RawInitData;
  }

  public getTrackerEvents(): ReplayEvent[] {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const buf = this.mpq.readFile("replay.tracker.events");
    if (!buf) return [];
    const decoder = new VersionedDecoder(buf, this.protocol.typeinfos);
    return Array.from(
      this.decodeEventStream(
        decoder,
        this.protocol.tracker_eventid_typeid,
        this.protocol.tracker_event_types,
        false,
      ),
    );
  }

  public getGameEvents(): ReplayEvent[] {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const buf = this.mpq.readFile("replay.game.events");
    if (!buf) return [];
    const decoder = new BitPackedDecoder(buf, this.protocol.typeinfos);
    return Array.from(
      this.decodeEventStream(
        decoder,
        this.protocol.game_eventid_typeid,
        this.protocol.game_event_types,
        true,
      ),
    );
  }

  public getAttributeEvents(): unknown {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const buf = this.mpq.readFile("replay.attributes.events");
    if (!buf) return null;
    const decoder = new VersionedDecoder(buf, this.protocol.typeinfos);
    return decoder.instance(this.protocol.replay_attributes_events_typeid);
  }

  public extractFile(filename: string): Buffer | null {
    return this.mpq.readFile(filename);
  }

  public getHeader(): RawHeader | undefined {
    return this.header;
  }

  public getBuild(): number {
    return this.build;
  }
}
