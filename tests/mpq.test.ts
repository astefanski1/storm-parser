import { describe, it, expect } from "vitest";
import * as zlib from "zlib";
import { MpqReader, decompressSector } from "../src/mpq/MpqReader";

// ── Synthetic MPQ v2 archives (formatVersion 1, 44-byte header) ──────────────
const cryptTable = (() => {
  let seed = 0x00100001;
  const t = new Uint32Array(0x500);
  for (let i = 0; i < 0x100; i++) {
    let idx = i;
    for (let j = 0; j < 5; j++) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 0x10;
      seed = (seed * 125 + 3) % 0x2aaaab;
      t[idx] = (t1 | (seed & 0xffff)) >>> 0;
      idx += 0x100;
    }
  }
  return t;
})();
const HASH_A = 1, HASH_B = 2, TABLE = 3;
const hash = (str: string, type: number): number => {
  let s1 = 0x7fed7fed;
  let s2 = 0xeeeeeeee;
  for (const c of str.toUpperCase()) {
    const ch = c.charCodeAt(0);
    s1 = (cryptTable[(type << 8) + ch] ^ (s1 + s2)) >>> 0;
    s2 = (ch + s1 + s2 + (s2 << 5) + 3) >>> 0;
  }
  return s1;
};
const encrypt = (data: Buffer, key: number): Buffer => {
  let s1 = key >>> 0;
  let s2 = 0xeeeeeeee;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length / 4; i++) {
    s2 = (s2 + cryptTable[0x400 + (s1 & 0xff)]) >>> 0;
    const v = data.readUInt32LE(i * 4);
    out.writeUInt32LE((v ^ (s1 + s2)) >>> 0, i * 4);
    s1 = (((~s1 << 0x15) + 0x11111111) | (s1 >>> 0x0b)) >>> 0;
    s2 = (v + s2 + (s2 << 5) + 3) >>> 0;
  }
  return out;
};

const EXISTS = 0x80000000, SINGLE_UNIT = 0x01000000, COMPRESS = 0x200, ENCRYPTED = 0x10000;

/** One-file archive: header (44) | hash table (16) | block table (16) | hi-block (2) | data. */
function buildMpq(opts: {
  name: string;
  data: Buffer;
  size?: number;
  flags: number;
  hashEntries?: number;
  hiBlock?: number;
  hashTableHigh?: number;
}): Buffer {
  const hashOff = 44, blockOff = 60, hiOff = 76, dataOff = 78;
  const header = Buffer.alloc(44);
  header.write("MPQ\x1a", 0, "latin1");
  header.writeUInt32LE(44, 4);
  header.writeUInt32LE(dataOff + opts.data.length, 8);
  header.writeUInt16LE(1, 12); // formatVersion 1 = MPQ v2
  header.writeUInt16LE(3, 14);
  header.writeUInt32LE(hashOff, 16);
  header.writeUInt32LE(blockOff, 20);
  header.writeUInt32LE(opts.hashEntries ?? 1, 24);
  header.writeUInt32LE(1, 28);
  header.writeUInt32LE(opts.hiBlock !== undefined ? hiOff : 0, 32); // hi-block table offset (low)
  header.writeUInt16LE(opts.hashTableHigh ?? 0, 40);
  const hashTable = Buffer.alloc(16);
  hashTable.writeUInt32LE(hash(opts.name, HASH_A), 0);
  hashTable.writeUInt32LE(hash(opts.name, HASH_B), 4);
  hashTable.writeUInt32LE(0, 12);
  const blockTable = Buffer.alloc(16);
  blockTable.writeUInt32LE(dataOff, 0);
  blockTable.writeUInt32LE(opts.data.length, 4);
  blockTable.writeUInt32LE(opts.size ?? opts.data.length, 8);
  blockTable.writeUInt32LE(opts.flags >>> 0, 12);
  const hi = Buffer.alloc(2);
  hi.writeUInt16LE(opts.hiBlock ?? 0, 0);
  return Buffer.concat([
    header,
    encrypt(hashTable, hash("(hash table)", TABLE)),
    encrypt(blockTable, hash("(block table)", TABLE)),
    hi,
    opts.data,
  ]);
}

describe("MPQ sector decompression", () => {
  it("inflates zlib sectors", () => {
    const data = Buffer.concat([Buffer.from([0x02]), zlib.deflateSync(Buffer.from("hots"))]);
    expect(decompressSector(data, "replay.details").toString()).toBe("hots");
  });

  it("rejects compression types HotS replays never use", () => {
    for (const mask of [0x01, 0x08, 0x12, 0x20, 0x22, 0x40, 0x80]) {
      expect(() => decompressSector(Buffer.from([mask, 1, 2, 3]), "x")).toThrow(
        new RegExp(`Unsupported MPQ compression 0x${mask.toString(16)} in x`),
      );
    }
  });
});

describe("MPQ archive", () => {
  it("reads a stored file (builder sanity)", () => {
    const buf = buildMpq({ name: "replay.x", data: Buffer.from("abcd"), flags: EXISTS | SINGLE_UNIT });
    expect(new MpqReader(buf).readFile("replay.x")?.toString()).toBe("abcd");
  });

  it("adds the hi-block table as bits 32–47 of block offsets", () => {
    const buf = buildMpq({ name: "x", data: Buffer.from("abcd"), flags: EXISTS | SINGLE_UNIT, hiBlock: 2 });
    expect(new MpqReader(buf).blockTable[0].offset).toBe(78 + 2 * 0x100000000);
  });

  it("applies the hash table's high offset bits", () => {
    // Bits 32–47 = 1 → the table lies beyond this small buffer
    const buf = buildMpq({ name: "x", data: Buffer.from("abcd"), flags: EXISTS | SINGLE_UNIT, hashTableHigh: 1 });
    expect(() => new MpqReader(buf)).toThrow(RangeError);
  });

  it("rejects an archive without a hash table (HET/BET only)", () => {
    const buf = buildMpq({ name: "x", data: Buffer.from("abcd"), flags: EXISTS | SINGLE_UNIT, hashEntries: 0 });
    expect(() => new MpqReader(buf)).toThrow(/no hash table/);
  });

  it("names encrypted files and unsupported compression", () => {
    const enc = buildMpq({ name: "replay.e", data: Buffer.from("abcd"), flags: EXISTS | SINGLE_UNIT | ENCRYPTED });
    expect(() => new MpqReader(enc).readFile("replay.e")).toThrow(/replay\.e is encrypted/);
    const pk = buildMpq({
      name: "replay.p",
      data: Buffer.from([0x08, 1, 2, 3]),
      size: 16,
      flags: EXISTS | SINGLE_UNIT | COMPRESS,
    });
    expect(() => new MpqReader(pk).readFile("replay.p")).toThrow(
      /Unsupported MPQ compression 0x8 in replay\.p/,
    );
  });
});
