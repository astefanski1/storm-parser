import { BitPackedDecoder, VersionedDecoder } from "./decoders/BitPackedDecoder";
import { TruncatedError } from "./decoders/BitPackedBuffer";
import { loadProtocol, getAvailableBuilds } from "./protocols/map.js";
import type { Protocol, ReplayEvent } from "./ReplayParser";

/** An event stream file: `replay.tracker.events`, `replay.game.events`, `replay.message.events`. */
export type StreamKind = "tracker" | "game" | "message";

/** Result of {@link decodeStream}. */
export interface StreamChunk {
  /** Complete events, in stream order. */
  events: ReplayEvent[];
  /** Byte offset right after the last complete event; pass it back as `fromByte` to continue. */
  nextByte: number;
  /** Cumulative gameloop of the last complete event; pass it back as `gameloop` to continue. */
  gameloop: number;
  /** The buffer ends inside an event (a file still being written); it starts at `nextByte`. */
  truncated: boolean;
  /**
   * Set when the stream can't be decoded past `nextByte` (an unknown event id, or a decode error
   * such as a struct changed in a patch): the events before it are kept, nothing after it is read.
   */
  warning?: string;
}

/** The decoder calls the event loop needs. */
export type EventDecoder = Pick<VersionedDecoder, "instance" | "done" | "used_bits" | "byte_align">;

const STREAM_FILES: Record<StreamKind, string> = {
  tracker: "replay.tracker.events",
  game: "replay.game.events",
  message: "replay.message.events",
};

/**
 * The protocol for a build: its own, else the closest older one (protocols only change when the
 * event structures do). Throws for a build older than every protocol.
 */
export function resolveProtocol(build: number): Protocol {
  let protocol = loadProtocol(build);
  if (!protocol) {
    const builds = getAvailableBuilds();
    const older = builds.filter((v) => v <= build);
    if (older.length === 0) {
      throw new Error(`Replay build ${build} is older than every protocol (oldest ${builds[0]})`);
    }
    protocol = loadProtocol(older[older.length - 1]);
  }
  if (!protocol) throw new Error(`No protocol found for build ${build}`);
  return protocol as Protocol;
}

/**
 * The event loop shared by `ReplayParser` and {@link decodeStream} (heroprotocol
 * `_decode_event_stream` order): gameloop delta, user id (game / message streams), event id,
 * event body, byte align. Adds `_event`, `_eventid`, `_gameloop` (cumulative from `gameloop`),
 * `_bits` and `_userid`. An unknown event id has an unknown size: `onUnknown` gets a warning and
 * the loop ends. Decode errors (e.g. `TruncatedError`) propagate after the events yielded so far.
 */
export function* eventLoop(
  decoder: EventDecoder,
  protocol: Pick<Protocol, "svaruint32_typeid">,
  eventidTypeid: number,
  eventTypes: Record<number, [number, string]>,
  streamName: string,
  userIdTypeid: number | undefined,
  gameloop: number,
  onUnknown: (warning: string) => void,
): IterableIterator<ReplayEvent> {
  while (!decoder.done()) {
    const startBits = decoder.used_bits();

    const deltaInstance = decoder.instance(protocol.svaruint32_typeid) as Record<string, number>;
    gameloop += deltaInstance[Object.keys(deltaInstance)[0]];

    let userid: number | undefined;
    if (userIdTypeid !== undefined) {
      const raw = decoder.instance(userIdTypeid) as { m_userId?: number } | number;
      userid = Number(typeof raw === "object" && raw !== null ? raw.m_userId : raw);
    }

    const eventid = Number(decoder.instance(eventidTypeid));
    const eventType = eventTypes[eventid];
    if (!eventType) {
      onUnknown(`${streamName}: unknown eventid(${eventid}) at gameloop ${gameloop}; rest of the stream skipped`);
      return;
    }

    const event = decoder.instance(eventType[0]) as ReplayEvent;
    event._event = eventType[1];
    event._eventid = eventid;
    event._gameloop = gameloop;
    if (userid !== undefined) event._userid = userid;

    decoder.byte_align();
    event._bits = decoder.used_bits() - startBits;

    yield event;
  }
}

/**
 * Decodes one event stream file from a raw buffer (no MPQ archive needed), e.g. the files HotS
 * writes into `%TEMP%\Heroes of the Storm\TempWriteReplayP1\` during a match. Decoding starts at
 * `fromByte` with the cumulative `gameloop` reached there, so a growing file is read incrementally:
 * pass the returned `nextByte` / `gameloop` back on the next call. A buffer cut inside an event
 * returns the complete events before it with `truncated: true`; an unknown event id or any other
 * decode error returns them with a `warning` (the rest of the buffer can't be decoded). Throws
 * only for a protocol without the stream's event fields.
 */
export function decodeStream(
  protocol: Protocol,
  kind: StreamKind,
  buf: Buffer,
  opts: { fromByte?: number; gameloop?: number } = {},
): StreamChunk {
  const spec =
    kind === "tracker"
      ? { eventidTypeid: protocol.tracker_eventid_typeid, eventTypes: protocol.tracker_event_types, userId: undefined }
      : kind === "game"
        ? { eventidTypeid: protocol.game_eventid_typeid, eventTypes: protocol.game_event_types, userId: protocol.replay_userid_typeid }
        : { eventidTypeid: protocol.message_eventid_typeid, eventTypes: protocol.message_event_types, userId: protocol.replay_userid_typeid };
  if (spec.eventidTypeid === undefined || !spec.eventTypes || (kind !== "tracker" && spec.userId === undefined)) {
    throw new Error(`Protocol ${protocol.version} has no ${kind} event fields`);
  }

  const fromByte = opts.fromByte ?? 0;
  const data = buf.subarray(fromByte);
  const decoder =
    kind === "tracker"
      ? new VersionedDecoder(data, protocol.typeinfos)
      : new BitPackedDecoder(data, protocol.typeinfos);
  const chunk: StreamChunk = { events: [], nextByte: fromByte, gameloop: opts.gameloop ?? 0, truncated: false };
  try {
    for (const event of eventLoop(
      decoder,
      protocol,
      spec.eventidTypeid,
      spec.eventTypes,
      STREAM_FILES[kind],
      spec.userId,
      chunk.gameloop,
      (warning) => (chunk.warning = warning),
    )) {
      chunk.events.push(event);
      // The loop byte-aligns before yielding, so this is the next event's first byte.
      chunk.nextByte = fromByte + decoder.used_bits() / 8;
      chunk.gameloop = event._gameloop;
    }
  } catch (error) {
    if (error instanceof TruncatedError) chunk.truncated = true;
    else {
      const message = error instanceof Error ? error.message : String(error);
      chunk.warning = `${STREAM_FILES[kind]}: ${message} after gameloop ${chunk.gameloop}; rest of the stream skipped`;
    }
  }
  return chunk;
}
