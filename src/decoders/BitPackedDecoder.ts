import { BitPackedBuffer, CorruptedError } from "./BitPackedBuffer";

import type { TypeInfo } from "../ReplayParser.js";

export type DecodedData =
  | string
  | number
  | boolean
  | bigint
  | null
  | Buffer
  | DecodedData[]
  | { [key: string]: DecodedData };

export class BitPackedDecoder {
  protected _buffer: BitPackedBuffer;
  protected _typeinfos: TypeInfo[];

  constructor(contents: Buffer, typeinfos: TypeInfo[]) {
    this._buffer = new BitPackedBuffer(contents);
    this._typeinfos = typeinfos;
  }

  public instance(typeid: number): DecodedData {
    if (typeid >= this._typeinfos.length) {
      throw new CorruptedError(`Invalid typeid ${typeid}`);
    }
    const typeinfo = this._typeinfos[typeid];
    const methodName = typeinfo[0] as keyof this;
    const args = typeinfo[1] || [];
    const method = this[methodName] as (...args: number[]) => DecodedData;
    if (typeof method !== "function") {
      throw new Error(`Decoder method ${methodName as string} not implemented`);
    }
    return method.apply(this, args);
  }

  public byte_align(): void {
    this._buffer.byte_align();
  }

  public done(): boolean {
    return this._buffer.done();
  }

  public used_bits(): number {
    return this._buffer.used_bits();
  }

  protected _array(bounds: [number, number], typeid: number): DecodedData[] {
    const length = this._int(bounds);
    const arr = new Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = this.instance(typeid);
    }
    return arr;
  }

  protected _bitarray(bounds: [number, number]): [number, number] {
    const length = this._int(bounds);
    return [length, this._buffer.read_bits(length)];
  }

  protected _blob(bounds: [number, number]): Buffer {
    const length = this._int(bounds);
    return this._buffer.read_aligned_bytes(length);
  }

  protected _bool(): boolean {
    return this._int([0, 1]) !== 0;
  }

  protected _choice(
    _bounds: [number, number],
    fields: Record<string, [string, number]>,
  ): Record<string, DecodedData> {
    const tag = this._int(_bounds);
    if (!(tag in fields)) {
      throw new CorruptedError(`Choice tag ${tag} not found`);
    }
    const field = fields[tag];
    return { [field[0]]: this.instance(field[1]) };
  }

  protected _fourcc(): string {
    const num = this._buffer.read_bits(32);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(num, 0);
    return buf.toString("ascii");
  }

  protected _int(bounds: [number, number]): number {
    return bounds[0] + this._buffer.read_bits(bounds[1]);
  }

  protected _null(): null {
    return null;
  }

  protected _optional(typeid: number): DecodedData | null {
    const exists = this._bool();
    return exists ? this.instance(typeid) : null;
  }

  protected _real32(): number {
    const buf = this._buffer.read_unaligned_bytes(4);
    return buf.readFloatBE(0);
  }

  protected _real64(): number {
    const buf = this._buffer.read_unaligned_bytes(8);
    return buf.readDoubleBE(0);
  }

  protected _struct(fields: [string, number][]): Record<string, DecodedData> {
    let result: Record<string, DecodedData> = {};
    for (const field of fields) {
      if (field[0] === "__parent") {
        const parent = this.instance(field[1]);
        if (
          typeof parent === "object" &&
          parent !== null &&
          !Array.isArray(parent) &&
          !Buffer.isBuffer(parent)
        ) {
          result = {
            ...result,
            ...(parent as unknown as Record<string, DecodedData>),
          };
        } else if (fields.length === 1) {
          return parent as unknown as Record<string, DecodedData>;
        } else {
          result[field[0]] = parent;
        }
      } else {
        result[field[0]] = this.instance(field[1]);
      }
    }
    return result;
  }
}

export class VersionedDecoder {
  protected _buffer: BitPackedBuffer;
  protected _typeinfos: TypeInfo[];

  constructor(contents: Buffer, typeinfos: TypeInfo[]) {
    this._buffer = new BitPackedBuffer(contents);
    this._typeinfos = typeinfos;
  }

  public instance(typeid: number): DecodedData {
    if (typeid >= this._typeinfos.length) {
      throw new CorruptedError(`Invalid typeid ${typeid}`);
    }
    const typeinfo = this._typeinfos[typeid];
    const methodName = typeinfo[0] as keyof this;
    const args = typeinfo[1] || [];
    const method = this[methodName] as (...args: number[]) => DecodedData;
    if (typeof method !== "function") {
      throw new Error(`Decoder method ${methodName as string} not implemented`);
    }
    return method.apply(this, args);
  }

  public byte_align(): void {
    this._buffer.byte_align();
  }

  public done(): boolean {
    return this._buffer.done();
  }

  public used_bits(): number {
    return this._buffer.used_bits();
  }

  protected _expect_skip(expected: number): void {
    if (this._buffer.read_bits(8) !== expected) {
      throw new CorruptedError(`Expected skip ${expected}`);
    }
  }

  protected _vint(): number | bigint {
    let b = this._buffer.read_bits(8);
    const negative = (b & 1) !== 0;
    let result = BigInt((b >> 1) & 0x3f);
    let bits = 6n;
    while ((b & 0x80) !== 0) {
      b = this._buffer.read_bits(8);
      result |= BigInt(b & 0x7f) << bits;
      bits += 7n;
    }
    const finalResult = negative ? -result : result;
    // For values that fit in JavaScript's safe Number integer bound, return a native Number.
    // Otherwise keep as BigInt. Windows FileTime epochs definitely exceed Number.MAX_SAFE_INTEGER
    // but the 53-bits boundary is standard for Number logic in ReplayAnalyzer.
    if (
      finalResult >= BigInt(Number.MIN_SAFE_INTEGER) &&
      finalResult <= BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return Number(finalResult);
    }
    return finalResult;
  }

  protected _array(_bounds: [number, number], typeid: number): DecodedData[] {
    this._expect_skip(0);
    const length = Number(this._vint());
    const arr = new Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = this.instance(typeid);
    }
    return arr;
  }

  protected _bitarray(_bounds: [number, number]): [number, Buffer] {
    this._expect_skip(1);
    const length = Number(this._vint());
    return [
      length,
      this._buffer.read_aligned_bytes(Math.floor((length + 7) / 8)),
    ];
  }

  protected _blob(_bounds: [number, number]): Buffer {
    this._expect_skip(2);
    const length = Number(this._vint());
    return this._buffer.read_aligned_bytes(length);
  }

  protected _bool(): boolean {
    this._expect_skip(6);
    return this._buffer.read_bits(8) !== 0;
  }

  protected _choice(
    _bounds: [number, number],
    fields: Record<string, [string, number]>,
  ): Record<string, DecodedData> {
    this._expect_skip(3);
    const tag = Number(this._vint());
    if (!(tag in fields)) {
      this._skip_instance();
      return {};
    }
    const field = fields[tag];
    return { [field[0]]: this.instance(field[1]) };
  }

  protected _fourcc(): Buffer {
    this._expect_skip(7);
    return this._buffer.read_aligned_bytes(4);
  }

  protected _int(_bounds: [number, number]): number {
    this._expect_skip(9);
    return Number(this._vint());
  }

  protected _null(): null {
    return null;
  }

  protected _optional(typeid: number): DecodedData | null {
    this._expect_skip(4);
    const exists = this._buffer.read_bits(8) !== 0;
    return exists ? this.instance(typeid) : null;
  }

  protected _real32(): number {
    this._expect_skip(7);
    return this._buffer.read_aligned_bytes(4).readFloatBE(0);
  }

  protected _real64(): number {
    this._expect_skip(8);
    return this._buffer.read_aligned_bytes(8).readDoubleBE(0);
  }

  protected _struct(
    fields: [string, number, number?][],
  ): Record<string, DecodedData> {
    this._expect_skip(5);
    let result: Record<string, DecodedData> = {};
    const length = Number(this._vint());
    for (let i = 0; i < length; i++) {
      const tag = Number(this._vint());
      const field = fields.find((f) => f[2] === tag);
      if (field) {
        if (field[0] === "__parent") {
          const parent = this.instance(field[1]);
          if (
            typeof parent === "object" &&
            parent !== null &&
            !Array.isArray(parent) &&
            !Buffer.isBuffer(parent)
          ) {
            result = {
              ...result,
              ...(parent as unknown as Record<string, DecodedData>),
            };
          } else if (fields.length === 1) {
            result = parent as unknown as Record<string, DecodedData>; // Wait, actually should be reassigned or returned depending on use-case
          } else {
            result[field[0]] = parent;
          }
        } else {
          result[field[0]] = this.instance(field[1]);
        }
      } else {
        this._skip_instance();
      }
    }
    return result;
  }

  protected _skip_instance(): void {
    const skip = this._buffer.read_bits(8);
    if (skip === 0) {
      // array
      const length = Number(this._vint());
      for (let i = 0; i < length; i++) this._skip_instance();
    } else if (skip === 1) {
      // bitblob
      const length = Number(this._vint());
      this._buffer.read_aligned_bytes(Math.floor((length + 7) / 8));
    } else if (skip === 2) {
      // blob
      const length = Number(this._vint());
      this._buffer.read_aligned_bytes(length);
    } else if (skip === 3) {
      // choice
      this._vint();
      this._skip_instance();
    } else if (skip === 4) {
      // optional
      const exists = this._buffer.read_bits(8) !== 0;
      if (exists) this._skip_instance();
    } else if (skip === 5) {
      // struct
      const length = Number(this._vint());
      for (let i = 0; i < length; i++) {
        this._vint();
        this._skip_instance();
      }
    } else if (skip === 6) {
      // u8
      this._buffer.read_aligned_bytes(1);
    } else if (skip === 7) {
      // u32
      this._buffer.read_aligned_bytes(4);
    } else if (skip === 8) {
      // u64
      this._buffer.read_aligned_bytes(8);
    } else if (skip === 9) {
      // vint
      this._vint();
    }
  }
}
