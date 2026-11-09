import { MpqReader } from "./mpq/MpqReader";
import {
  BitPackedDecoder,
  VersionedDecoder,
} from "./decoders/BitPackedDecoder";
import { BitPackedBuffer } from "./decoders/BitPackedBuffer";
import { loadProtocol, getAvailableBuilds } from "./protocols/map.js";
import type { RawDetails, RawHeader, RawInitData } from "./types/index.js";

export type TypeInfo = [string, number[]?];

export interface Protocol {
  version: number;
  typeinfos: TypeInfo[];
  tracker_event_types: Record<number, [number, string]>;
  tracker_eventid_typeid: number;
  svaruint32_typeid: number;
  replay_header_typeid: number;
  game_details_typeid: number;
  replay_initdata_typeid: number;
  /** Message stream fields; absent in protocol JSON generated before they were added. */
  message_event_types?: Record<number, [number, string]>;
  message_eventid_typeid?: number;
  replay_userid_typeid?: number;
  /** Game stream fields; absent in protocol JSON generated before they were added. */
  game_event_types?: Record<number, [number, string]>;
  game_eventid_typeid?: number;
}

type EventDecoder = Pick<VersionedDecoder, "instance" | "done" | "used_bits" | "byte_align">;

/** One attribute of `replay.attributes.events` (value: bytes as text). */
export interface AttributeValue {
  namespace: number;
  attrid: number;
  value: string;
}

/** `replay.attributes.events`: attributes per scope (player slot, 16 = global) and id. */
export interface ReplayAttributes {
  source: number;
  mapNamespace: number;
  scopes: Record<number, Record<number, AttributeValue[]>>;
}

export interface ReplayEvent {
  _event: string;
  _eventid: number;
  _gameloop: number;
  _bits: number;
  /** Sender lobby user id; only on streams decoded with a user id (messages). */
  _userid?: number;
  [key: string]: unknown;
}

export class ReplayParser {
  protected mpq!: MpqReader;
  protected header: RawHeader | undefined;
  protected build: number = 0;
  protected protocol?: Protocol;
  protected baseProtocol?: Protocol;
  /** Non-fatal decoding problems (e.g. a stream cut short at an unknown event). */
  public readonly warnings: string[] = [];

  constructor(filenameOrData: string | Buffer) {
    this.mpq = new MpqReader(filenameOrData);
  }

  public init(): void {
    // Load base protocol to read header (oldest known: 29406)
    const base = loadProtocol(29406);
    if (!base) {
      throw new Error(
        "Base protocol29406 not found: the package's protocols/ folder is missing " +
          "(in a clone of the repo run `pnpm generate:protocols`).",
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
      // Closest available build that is <= the requested build. A replay
      // older than every protocol can't be decoded with any of them.
      const builds = getAvailableBuilds();
      const older = builds.filter((v) => v <= build);
      if (older.length === 0) {
        throw new Error(
          `Replay build ${build} is older than every protocol (oldest ${builds[0]})`,
        );
      }
      protocol = loadProtocol(older[older.length - 1]);
    }
    if (!protocol) {
      throw new Error(`No protocol found for build ${build}`);
    }
    return protocol;
  }

  protected *decodeEventStream(
    decoder: EventDecoder,
    eventidTypeid: number,
    eventTypes: Record<number, [number, string]>,
    streamName: string,
    userIdTypeid?: number,
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

      // heroprotocol `_decode_event_stream` order: delta, user id, event id.
      let userid: number | undefined;
      if (userIdTypeid !== undefined) {
        const raw = decoder.instance(userIdTypeid) as { m_userId?: number } | number;
        userid = Number(typeof raw === "object" && raw !== null ? raw.m_userId : raw);
      }

      const eventid = Number(decoder.instance(eventidTypeid));

      const eventType = eventTypes[eventid];
      if (!eventType) {
        // The event's size is unknown, so nothing after it can be decoded.
        // Keep what was decoded and say where the stream was cut.
        this.warnings.push(
          `${streamName}: unknown eventid(${eventid}) at gameloop ${gameloop}; rest of the stream skipped`,
        );
        return;
      }

      const typeid = eventType[0];
      const typename = eventType[1];

      const event = decoder.instance(typeid) as ReplayEvent;
      event._event = typename;
      event._eventid = eventid;
      event._gameloop = gameloop;
      if (userid !== undefined) event._userid = userid;

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
    return Array.from(this.iterTrackerEvents());
  }

  /** Tracker events decoded lazily, so a caller can stop early (e.g. at `GatesOpen`). */
  public *iterTrackerEvents(): IterableIterator<ReplayEvent> {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const buf = this.mpq.readFile("replay.tracker.events");
    if (!buf) return;
    const decoder = new VersionedDecoder(buf, this.protocol.typeinfos);
    yield* this.decodeEventStream(
      decoder,
      this.protocol.tracker_eventid_typeid,
      this.protocol.tracker_event_types,
      "replay.tracker.events",
    );
  }

  /**
   * `replay.message.events` (chat, pings, loading progress, announcements),
   * each with `_userid`. `[]` when the file or the protocol's message fields
   * are missing; a decode error keeps the earlier events and adds a warning.
   */
  public getMessageEvents(): ReplayEvent[] {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const { message_event_types, message_eventid_typeid, replay_userid_typeid } = this.protocol;
    if (
      !message_event_types ||
      message_eventid_typeid === undefined ||
      replay_userid_typeid === undefined
    ) {
      return [];
    }
    const buf = this.mpq.readFile("replay.message.events");
    if (!buf) return [];
    const decoder = new BitPackedDecoder(buf, this.protocol.typeinfos);
    // Non-critical stream: a decode error keeps the events before it (like an unknown event id).
    const events: ReplayEvent[] = [];
    try {
      for (const ev of this.decodeEventStream(
        decoder,
        message_eventid_typeid,
        message_event_types,
        "replay.message.events",
        replay_userid_typeid,
      )) {
        events.push(ev);
      }
    } catch (error) {
      this.warnings.push(`replay.message.events: ${String(error)}; rest of the stream skipped`);
    }
    return events;
  }

  /**
   * `replay.game.events` (every player's commands, camera, trigger chat, …), decoded lazily, each
   * with `_userid`. Yields nothing when the file or the protocol's game fields are missing. A decode
   * error propagates after the events already yielded (the caller decides whether that is fatal).
   */
  public *iterGameEvents(): IterableIterator<ReplayEvent> {
    if (!this.protocol) throw new Error("Protocol not loaded");
    const { game_event_types, game_eventid_typeid, replay_userid_typeid } = this.protocol;
    if (!game_event_types || game_eventid_typeid === undefined || replay_userid_typeid === undefined) {
      return;
    }
    const buf = this.mpq.readFile("replay.game.events");
    if (!buf) return;
    yield* this.decodeEventStream(
      new BitPackedDecoder(buf, this.protocol.typeinfos),
      game_eventid_typeid,
      game_event_types,
      "replay.game.events",
      replay_userid_typeid,
    );
  }

  /**
   * `replay.attributes.events`. Not typeinfo-encoded: a little-endian bit
   * stream (heroprotocol `decode_replay_attributes_events`).
   */
  public getAttributeEvents(): ReplayAttributes | null {
    const buf = this.mpq.readFile("replay.attributes.events");
    return buf ? decodeAttributeEvents(buf) : null;
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

export function decodeAttributeEvents(contents: Buffer): ReplayAttributes {
  const buffer = new BitPackedBuffer(contents, "little");
  const attributes: ReplayAttributes = { source: 0, mapNamespace: 0, scopes: {} };
  if (buffer.done()) return attributes;
  attributes.source = buffer.read_bits(8);
  attributes.mapNamespace = buffer.read_bits(32);
  buffer.read_bits(32); // count
  while (!buffer.done()) {
    const namespace = buffer.read_bits(32);
    const attrid = buffer.read_bits(32);
    const scope = buffer.read_bits(8);
    const raw = Buffer.from(buffer.read_aligned_bytes(4)).reverse();
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    let start = 0;
    while (start < end && raw[start] === 0) start++;
    const value = raw.toString("latin1", start, end);
    ((attributes.scopes[scope] ??= {})[attrid] ??= []).push({ namespace, attrid, value });
  }
  return attributes;
}
