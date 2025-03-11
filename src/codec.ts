import { mol, ccc } from "@ckb-ccc/core";

/**
 * Codec for encoding and decoding 8-bit signed integers.
 */
export const Int8 = mol.Codec.from<ccc.NumLike, number>({
  /**
   * Encodes a number-like value into ccc.Bytes.
   * @param numLike - The number-like value to encode.
   * @returns ccc.Bytes containing the encoded value.
   */
  encode: (numLike) => {
    const encoded = new Uint8Array([0]);
    new DataView(encoded.buffer).setInt8(0, Number(numLike));
    return encoded;
  },
  /**
   * Decodes ccc.Bytes into a number.
   * @param bufferLike - The buffer-like input to decode.
   * @returns The decoded 8-bit signed integer.
   */
  decode: (bufferLike) => {
    const buffer = fixedBytesFrom(bufferLike, 1);
    return new DataView(buffer.buffer).getInt8(0);
  },
});

/**
 * Option codec for 8-bit signed integers.
 */
export const Int8Opt = mol.option(Int8);

/**
 * Vector codec for arrays of 8-bit signed integers.
 */
export const Int8Vec = mol.vector(Int8);

/**
 * Creates a codec for encoding and decoding 16-bit signed integers.
 * @param littleEndian - Indicates whether to use little-endian byte order.
 * @returns A codec for 16-bit signed integers.
 */
function int16Number(littleEndian: boolean): mol.Codec<ccc.NumLike, number> {
  const byteLength = 2;
  return mol.Codec.from({
    byteLength,
    /**
     * Encodes a number-like value into ccc.Bytes.
     * @param numLike - The number-like value to encode.
     * @returns ccc.Bytes containing the encoded value.
     */
    encode: (numLike) => {
      const encoded = new Uint8Array([0, 0]);
      new DataView(encoded.buffer).setInt16(0, Number(numLike), littleEndian);
      return encoded;
    },
    /**
     * Decodes ccc.Bytes into a number.
     * @param bufferLike - The buffer-like input to decode.
     * @returns The decoded 16-bit signed integer.
     */
    decode: (bufferLike) => {
      const buffer = fixedBytesFrom(bufferLike, byteLength);
      return new DataView(buffer.buffer).getInt16(0, littleEndian);
    },
  });
}

/**
 * Codec for little-endian 16-bit signed integers.
 */
export const Int16LE = int16Number(true);

/**
 * Codec for big-endian 16-bit signed integers.
 */
export const Int16BE = int16Number(false);

/**
 * Codec for 16-bit signed integers (alias for little-endian).
 */
export const Int16 = Int16LE;

/**
 * Option codec for 16-bit signed integers.
 */
export const Int16Opt = mol.option(Int16);

/**
 * Vector codec for arrays of 16-bit signed integers.
 */
export const Int16Vec = mol.vector(Int16);

/**
 * Creates a codec for encoding and decoding 32-bit signed integers.
 * @param littleEndian - Indicates whether to use little-endian byte order.
 * @returns A codec for 32-bit signed integers.
 */
function int32Number(littleEndian: boolean): mol.Codec<ccc.NumLike, number> {
  const byteLength = 4;
  return mol.Codec.from({
    byteLength,
    /**
     * Encodes a number-like value into ccc.Bytes.
     * @param numLike - The number-like value to encode.
     * @returns ccc.Bytes containing the encoded value.
     */
    encode: (numLike) => {
      const encoded = new Uint8Array([0, 0, 0, 0]);
      new DataView(encoded.buffer).setInt32(0, Number(numLike), littleEndian);
      return encoded;
    },
    /**
     * Decodes ccc.Bytes into a number.
     * @param bufferLike - The buffer-like input to decode.
     * @returns The decoded 32-bit signed integer.
     */
    decode: (bufferLike) => {
      const buffer = fixedBytesFrom(bufferLike, byteLength);
      return new DataView(buffer.buffer).getInt32(0, littleEndian);
    },
  });
}

/**
 * Codec for little-endian 32-bit signed integers.
 */
export const Int32LE = int32Number(true);

/**
 * Codec for big-endian 32-bit signed integers.
 */
export const Int32BE = int32Number(false);

/**
 * Codec for 32-bit signed integers (alias for little-endian).
 */
export const Int32 = Int32LE;

/**
 * Option codec for 32-bit signed integers.
 */
export const Int32Opt = mol.option(Int32);

/**
 * Vector codec for arrays of 32-bit signed integers.
 */
export const Int32Vec = mol.vector(Int32);

/**
 * Creates a codec for encoding and decoding 64-bit signed integers.
 * @param littleEndian - Indicates whether to use little-endian byte order.
 * @returns A codec for 64-bit signed integers.
 */
function int64(littleEndian: boolean): mol.Codec<ccc.NumLike, ccc.Num> {
  const byteLength = 8;
  return mol.Codec.from({
    byteLength,
    /**
     * Encodes a number-like value into ccc.Bytes.
     * @param numLike - The number-like value to encode.
     * @returns ccc.Bytes containing the encoded value.
     */
    encode: (numLike) => {
      const encoded = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
      new DataView(encoded.buffer).setBigInt64(
        0,
        ccc.numFrom(numLike),
        littleEndian,
      );
      return encoded;
    },
    /**
     * Decodes ccc.Bytes into a number.
     * @param bufferLike - The buffer-like input to decode.
     * @returns The decoded 64-bit signed integer.
     */
    decode: (bufferLike) => {
      const buffer = fixedBytesFrom(bufferLike, byteLength);
      return new DataView(buffer.buffer).getBigInt64(0, littleEndian);
    },
  });
}

/**
 * Codec for little-endian 64-bit signed integers.
 */
export const Int64LE = int64(true);

/**
 * Codec for big-endian 64-bit signed integers.
 */
export const Int64BE = int64(false);

/**
 * Codec for 64-bit signed integers (alias for little-endian).
 */
export const Int64 = Int64LE;

/**
 * Option codec for 64-bit signed integers.
 */
export const Int64Opt = mol.option(Int64);

/**
 * Vector codec for arrays of 64-bit signed integers.
 */
export const Int64Vec = mol.vector(Int64);

/**
 * Converts a buffer-like input to a fixed-length byte buffer.
 * @param bufferLike - The buffer-like input to convert.
 * @param byteLength - The expected byte length of the buffer.
 * @returns A fixed-length byte buffer.
 * @throws Error if the buffer size does not match the expected byte length.
 */
function fixedBytesFrom(
  bufferLike: ccc.BytesLike,
  byteLength: number,
): ccc.Bytes {
  const buffer = ccc.bytesFrom(bufferLike);
  if (buffer.byteLength != byteLength) {
    throw new Error(
      `int${String(byteLength)}: invalid buffer size, expected ${String(byteLength)}, but got ${String(buffer.byteLength)}`,
    );
  }
  return buffer;
}
