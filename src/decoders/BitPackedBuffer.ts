export class TruncatedError extends Error {
  constructor(message = "Truncated Buffer") {
    super(message);
    this.name = "TruncatedError";
  }
}

export class CorruptedError extends Error {
  constructor(message = "Corrupted Buffer") {
    super(message);
    this.name = "CorruptedError";
  }
}

export class BitPackedBuffer {
  private _data: Buffer;
  private _used: number;
  private _next: number;
  private _nextbits: number;
  private _bigendian: boolean;

  constructor(contents: Buffer, endian: "big" | "little" = "big") {
    this._data = contents;
    this._used = 0;
    this._next = 0;
    this._nextbits = 0;
    this._bigendian = endian === "big";
  }

  public done(): boolean {
    return this._nextbits === 0 && this._used >= this._data.length;
  }

  public used_bits(): number {
    return this._used * 8 - this._nextbits;
  }

  public byte_align(): void {
    this._nextbits = 0;
  }

  public read_aligned_bytes(bytes: number): Buffer {
    this.byte_align();
    if (this._used + bytes > this._data.length) {
      throw new TruncatedError();
    }
    const data = this._data.subarray(this._used, this._used + bytes);
    this._used += bytes;
    return data;
  }

  public read_bits(bits: number): number {
    let result = 0;
    let resultbits = 0;

    while (resultbits !== bits) {
      if (this._nextbits === 0) {
        if (this.done()) {
          throw new TruncatedError();
        }
        this._next = this._data[this._used];
        this._used += 1;
        this._nextbits = 8;
      }

      const copybits = Math.min(bits - resultbits, this._nextbits);
      const copy = this._next & ((1 << copybits) - 1);

      if (this._bigendian) {
        // use Math.pow to avoid 32-bit bitwise limits for bits > 31
        result += copy * Math.pow(2, bits - resultbits - copybits);
      } else {
        result += copy * Math.pow(2, resultbits);
      }

      this._next >>= copybits;
      this._nextbits -= copybits;
      resultbits += copybits;
    }

    return result;
  }

  public read_bits_bigint(bits: number): bigint {
    let result = 0n;
    let resultbits = 0;

    while (resultbits !== bits) {
      if (this._nextbits === 0) {
        if (this.done()) {
          throw new TruncatedError();
        }
        this._next = this._data[this._used];
        this._used += 1;
        this._nextbits = 8;
      }

      const copybits = Math.min(bits - resultbits, this._nextbits);
      const copy = BigInt(this._next & ((1 << copybits) - 1));

      if (this._bigendian) {
        result |= copy << BigInt(bits - resultbits - copybits);
      } else {
        result |= copy << BigInt(resultbits);
      }

      this._next >>= copybits;
      this._nextbits -= copybits;
      resultbits += copybits;
    }

    return result;
  }

  public read_unaligned_bytes(bytes: number): Buffer {
    const buf = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i++) {
      buf[i] = this.read_bits(8);
    }
    return buf;
  }
}
