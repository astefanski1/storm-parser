import * as fs from "fs";
import * as zlib from "zlib";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bzip = require("seek-bzip");

const MPQ_FILE_COMPRESS = 0x00000200;
const MPQ_FILE_ENCRYPTED = 0x00010000;
const MPQ_FILE_SINGLE_UNIT = 0x01000000;
const MPQ_FILE_SECTOR_CRC = 0x04000000;
const MPQ_FILE_EXISTS = 0x80000000;

interface MPQFileHeader {
  magic: string;
  headerSize: number;
  archiveSize: number;
  formatVersion: number;
  sectorSizeShift: number;
  hashTableOffset: number;
  blockTableOffset: number;
  hashTableEntries: number;
  blockTableEntries: number;
  offset?: number;
  userDataHeader?: MPQUserDataHeader;
  extendedBlockTableOffset?: number;
  hashTableOffsetHigh?: number;
  blockTableOffsetHigh?: number;
}

interface MPQUserDataHeader {
  magic: string;
  userDataSize: number;
  mpqHeaderOffset: number;
  userDataHeaderSize: number;
  content?: Buffer;
}

interface MPQHashTableEntry {
  hashA: number;
  hashB: number;
  locale: number;
  platform: number;
  blockTableIndex: number;
}

interface MPQBlockTableEntry {
  offset: number;
  archivedSize: number;
  size: number;
  flags: number;
}

const hashTypes = {
  TABLE_OFFSET: 0,
  HASH_A: 1,
  HASH_B: 2,
  TABLE: 3,
};

function buildEncryptionTable(): Uint32Array {
  let seed = 0x00100001;
  const table = new Uint32Array(256 * 5);

  for (let i = 0; i < 256; i++) {
    let index = i;
    for (let j = 0; j < 5; j++) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 0x10;

      seed = (seed * 125 + 3) % 0x2aaaab;
      const t2 = seed & 0xffff;

      table[index] = (t1 | t2) >>> 0;
      index += 0x100;
    }
  }

  return table;
}

const encryptionTable = buildEncryptionTable();

/** Sector compression masks HotS replays use (first byte of a compressed sector). */
const COMPRESSION_ZLIB = 0x02;
const COMPRESSION_BZIP2 = 0x10;

/**
 * Decompresses one sector. HotS replays only use zlib or bzip2; anything else
 * (Huffman, PKWARE, LZMA, sparse, ADPCM, combined masks) is rejected.
 */
export function decompressSector(data: Buffer, filename: string): Buffer {
  const mask = data[0];
  if (mask === 0) return data;
  if (mask === COMPRESSION_ZLIB) return zlib.inflateSync(data.subarray(1));
  if (mask === COMPRESSION_BZIP2) return bzip.decode(data.subarray(1));
  throw new Error(
    `Unsupported MPQ compression 0x${mask.toString(16)} in ${filename} (only zlib and bzip2)`,
  );
}

export class MpqReader {
  file: Buffer;
  header: MPQFileHeader;
  hashTable: MPQHashTableEntry[];
  blockTable: MPQBlockTableEntry[];

  constructor(filenameOrData: string | Buffer) {
    if (Buffer.isBuffer(filenameOrData)) {
      this.file = filenameOrData;
    } else {
      this.file = fs.readFileSync(filenameOrData);
    }

    this.header = this.readHeader();
    if (!this.header.hashTableEntries) {
      throw new Error(
        "MPQ archive has no hash table (HET/BET-only archives are not supported)",
      );
    }
    this.hashTable = this.readTable("hash") as MPQHashTableEntry[];
    this.blockTable = this.readTable("block") as MPQBlockTableEntry[];
    this.applyHighBlockOffsets();
  }

  /** MPQ v2+ (formatVersion ≥ 1): the hi-block table holds bits 32–47 of every block offset. */
  private applyHighBlockOffsets(): void {
    const hiOffset = this.header.extendedBlockTableOffset;
    if (!hiOffset) return;
    const start = hiOffset + (this.header.offset || 0);
    for (let i = 0; i < this.blockTable.length; i++) {
      this.blockTable[i].offset += this.file.readUInt16LE(start + i * 2) * 0x100000000;
    }
  }

  private readHeader(): MPQFileHeader {
    const magic = this.file.toString("utf8", 0, 4);
    let header: MPQFileHeader;

    if (magic === "MPQ\x1a") {
      header = this.readMPQHeader();
      header.offset = 0;
    } else if (magic === "MPQ\x1b") {
      const userDataHeader = this.readMPQUserDataHeader();
      header = this.readMPQHeader(userDataHeader.mpqHeaderOffset);
      header.offset = userDataHeader.mpqHeaderOffset;
      header.userDataHeader = userDataHeader;
    } else {
      throw new Error("Invalid MPQ file header");
    }

    return header;
  }

  private readMPQHeader(offset: number = 0): MPQFileHeader {
    const data = this.file.subarray(offset, offset + 32);
    const header: MPQFileHeader = {
      magic: data.toString("utf8", 0, 4),
      headerSize: data.readUInt32LE(4),
      archiveSize: data.readUInt32LE(8),
      formatVersion: data.readUInt16LE(12),
      sectorSizeShift: data.readUInt16LE(14),
      hashTableOffset: data.readUInt32LE(16),
      blockTableOffset: data.readUInt32LE(20),
      hashTableEntries: data.readUInt32LE(24),
      blockTableEntries: data.readUInt32LE(28),
    };

    // formatVersion is 0-based: every header from MPQ v2 (1) on carries the
    // hi-block table offset and the tables' high offset bits at bytes 32–43.
    if (header.formatVersion >= 1) {
      const extData = this.file.subarray(offset + 32, offset + 32 + 12);
      header.extendedBlockTableOffset =
        extData.readUInt32LE(0) + extData.readUInt32LE(4) * 0x100000000;
      header.hashTableOffsetHigh = extData.readUInt16LE(8);
      header.blockTableOffsetHigh = extData.readUInt16LE(10);
    }

    return header;
  }

  private readMPQUserDataHeader(): MPQUserDataHeader {
    const data = this.file.subarray(0, 16);
    const header: MPQUserDataHeader = {
      magic: data.toString("utf8", 0, 4),
      userDataSize: data.readUInt32LE(4),
      mpqHeaderOffset: data.readUInt32LE(8),
      userDataHeaderSize: data.readUInt32LE(12),
    };
    header.content = this.file.subarray(16, 16 + header.userDataHeaderSize);
    return header;
  }

  private readTable(tableType: "hash" | "block") {
    const tableOffsetField =
      tableType === "hash" ? "hashTableOffset" : "blockTableOffset";
    const tableEntriesField =
      tableType === "hash" ? "hashTableEntries" : "blockTableEntries";

    const high =
      (tableType === "hash"
        ? this.header.hashTableOffsetHigh
        : this.header.blockTableOffsetHigh) ?? 0;
    const tableOffset = this.header[tableOffsetField] + high * 0x100000000;
    const tableEntries = this.header[tableEntriesField];

    if (tableOffset == null || tableEntries == null) {
      throw new Error("Missing " + tableType + " offset or entries");
    }

    const key = this.hash("(" + tableType + " table)", "TABLE");

    let data = this.file.subarray(
      tableOffset + (this.header.offset || 0),
      tableOffset + (this.header.offset || 0) + tableEntries * 16,
    );
    data = this.decrypt(data, key);

    const entries = [];
    for (let i = 0; i < tableEntries; i++) {
      const slice = data.subarray(i * 16, i * 16 + 16);
      if (tableType === "hash") {
        entries.push({
          hashA: slice.readUInt32LE(0),
          hashB: slice.readUInt32LE(4),
          locale: slice.readUInt16LE(8),
          platform: slice.readUInt16LE(10),
          blockTableIndex: slice.readUInt32LE(12),
        } as MPQHashTableEntry);
      } else {
        entries.push({
          offset: slice.readUInt32LE(0),
          archivedSize: slice.readUInt32LE(4),
          size: slice.readUInt32LE(8),
          flags: slice.readUInt32LE(12),
        } as MPQBlockTableEntry);
      }
    }

    return entries;
  }

  public getHashTableEntry(filename: string): MPQHashTableEntry | undefined {
    const hashA = this.hash(filename, "HASH_A");
    const hashB = this.hash(filename, "HASH_B");

    for (const entry of this.hashTable) {
      if (entry.hashA === hashA && entry.hashB === hashB) return entry;
    }
    return undefined;
  }

  public readFile(filename: string): Buffer | null {

    const hashEntry = this.getHashTableEntry(filename);
    if (!hashEntry) return null;
    const blockEntry = this.blockTable[hashEntry.blockTableIndex];
    if (!blockEntry) return null;

    if (!(blockEntry.flags & MPQ_FILE_EXISTS)) return null;
    if (blockEntry.archivedSize === 0) return Buffer.alloc(0);

    const offset = blockEntry.offset + (this.header.offset || 0);
    let fileData = this.file.subarray(offset, offset + blockEntry.archivedSize);

    if (blockEntry.flags & MPQ_FILE_ENCRYPTED) {
      throw new Error(`MPQ file ${filename} is encrypted (not supported)`);
    }

    if (!(blockEntry.flags & MPQ_FILE_SINGLE_UNIT)) {
      const sectorSize = 512 << this.header.sectorSizeShift;
      let sectors = Math.trunc(blockEntry.size / sectorSize) + 1;
      let crc = false;

      if (blockEntry.flags & MPQ_FILE_SECTOR_CRC) {
        crc = true;
        sectors += 1;
      }

      const positions: number[] = [];
      for (let i = 0; i < sectors + 1; i++) {
        positions.push(fileData.readUInt32LE(4 * i));
      }

      const ln = positions.length - (crc ? 2 : 1);
      const buffers: Buffer[] = [];
      let sectorBytesLeft = blockEntry.size;

      for (let i = 0; i < ln; i++) {
        let sector = fileData.subarray(positions[i], positions[i + 1]);
        if (
          blockEntry.flags & MPQ_FILE_COMPRESS &&
          sectorBytesLeft > sector.length
        ) {
          sector = decompressSector(sector, filename);
        }
        sectorBytesLeft -= sector.length;
        buffers.push(sector);
      }
      fileData = Buffer.concat(buffers);
    } else {
      if (
        blockEntry.flags & MPQ_FILE_COMPRESS &&
        blockEntry.size > blockEntry.archivedSize
      ) {
        fileData = decompressSector(fileData, filename);
      }
    }

    return fileData;
  }

  private hash(str: string, hashType: keyof typeof hashTypes): number {
    let seed1 = 0x7fed7fed;
    let seed2 = 0xeeeeeeee;

    for (let i = 0; i < str.length; i++) {
      const ch = str.toUpperCase().charCodeAt(i);

      const val = encryptionTable[(hashTypes[hashType] << 8) + ch];
      seed1 = (val ^ (seed1 + seed2)) >>> 0;
      seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
    }

    return seed1;
  }

  private decrypt(data: Buffer, key: number): Buffer {
    let seed1 = key >>> 0;
    let seed2 = 0xeeeeeeee;

    const result = Buffer.alloc(data.length);
    const ln = data.length / 4;

    for (let i = 0; i < ln; i++) {
      seed2 = (seed2 + encryptionTable[0x400 + (seed1 & 0xff)]) >>> 0;
      let value = data.readUInt32LE(i * 4);
      value = (value ^ (seed1 + seed2)) >>> 0;

      seed1 = (((~seed1 << 0x15) + 0x11111111) | (seed1 >>> 0x0b)) >>> 0;
      seed2 = (value + seed2 + (seed2 << 5) + 3) >>> 0;

      result.writeUInt32LE(value, i * 4);
    }

    return result;
  }
}
