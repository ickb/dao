import { mol, ccc } from "@ckb-ccc/core";

/**
 * Boundary-checked codec for little-endian 32-bit signed integers.
 */
export const CheckedInt32LE = mol.Codec.from<ccc.NumLike, number>({
  byteLength: 4,
  encode: (numLike) => {
    const num = Number(numLike);
    if (num < -2147483648 || num > 2147483647) {
      throw Error("NumLike out of int32 bounds");
    }
    const encoded = new Uint8Array(4);
    new DataView(encoded.buffer).setInt32(0, num, true);
    return encoded;
  },
  decode: (bytesLike) => {
    const bytes = ccc.bytesFrom(bytesLike);
    return new DataView(bytes.buffer).getInt32(0, true);
  },
});

/**
 * General union codec, if all items are of the same fixed size, it will create a fixed-size union codec, otherwise an usual dynamic-size union codec will be created.
 * Serializing a union has two steps:
 * - Serialize an item type id in bytes as a 32 bit unsigned integer in little-endian. The item type id is the index of the inner items, and it's starting at 0.
 * - Serialize the inner item.
 * @param codecLayout the union item record
 * @param fields the custom item type id record
 * @example
 * // without custom id
 * union({ cafe: Uint8, bee: Uint8 })
 * // with custom id
 * union({ cafe: Uint8, bee: Uint8 }, { cafe: 0xcafe, bee: 0xbee })
 *
 * @credits Hanssen from CKB DevRel:
 * https://github.com/ckb-devrel/ccc/blob/master/packages/core/src/molecule/codec.ts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function union<T extends Record<string, mol.CodecLike<any, any>>>(
  codecLayout: T,
  fields?: Record<keyof T, number | undefined | null>,
): mol.Codec<UnionEncodable<T>, UnionDecoded<T>> {
  const keys = Object.keys(codecLayout);
  const values = Object.values(codecLayout);
  let byteLength = values[0]?.byteLength;
  for (const { byteLength: l } of values.slice(1)) {
    if (l === undefined || l !== byteLength) {
      // byteLength is undefined if any of the codecs byteLength is undefined or different
      byteLength = undefined;
      break;
    }
  }
  if (byteLength !== undefined) {
    // Account for header size
    byteLength += 4;
  }

  return mol.Codec.from({
    byteLength,
    encode({ type, value }) {
      const typeStr = type.toString();
      const codec = codecLayout[typeStr];
      if (!codec) {
        throw new Error(
          `union: invalid type, expected ${keys.toString()}, but got ${typeStr}`,
        );
      }
      const fieldId = fields ? (fields[typeStr] ?? -1) : keys.indexOf(typeStr);
      if (fieldId < 0) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`union: invalid field id ${fieldId} of ${typeStr}`);
      }
      const header = uint32To(fieldId);
      try {
        const body = codec.encode(value);
        return ccc.bytesConcat(header, body);
      } catch (e: unknown) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`union.(${typeStr})(${e?.toString()})`);
      }
    },
    decode(buffer) {
      const value = ccc.bytesFrom(buffer);
      const fieldIndex = uint32From(value.slice(0, 4));
      const keys = Object.keys(codecLayout);
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      const field = (() => {
        if (!fields) {
          return keys[fieldIndex];
        }
        const entry = Object.entries(fields).find(
          ([, id]) => id === fieldIndex,
        );
        return entry?.[0];
      })();

      if (!field) {
        if (!fields) {
          throw new Error(
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `union: unknown union field index ${fieldIndex}, only ${keys.toString()} are allowed`,
          );
        }
        const fieldKeys = Object.keys(fields);
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `union: unknown union field index ${fieldIndex}, only ${fieldKeys.toString()} and ${keys.toString()} are allowed`,
        );
      }

      return {
        type: field,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-non-null-assertion
        value: codecLayout[field]!.decode(value.slice(4)),
      } as UnionDecoded<T>;
    },
  });
}

type UnionEncodable<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Record<string, mol.CodecLike<any, any>>,
  K extends keyof T = keyof T,
> = K extends unknown
  ? {
      type: K;
      value: mol.EncodableType<T[K]>;
    }
  : never;
type UnionDecoded<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Record<string, mol.CodecLike<any, any>>,
  K extends keyof T = keyof T,
> = K extends unknown
  ? {
      type: K;
      value: mol.DecodedType<T[K]>;
    }
  : never;

function uint32To(numLike: ccc.NumLike): ccc.Bytes {
  return ccc.numToBytes(numLike, 4);
}

function uint32From(bytesLike: ccc.BytesLike): number {
  return Number(ccc.numFromBytes(bytesLike));
}
