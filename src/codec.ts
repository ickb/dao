import { createFixedBytesCodec } from "@ckb-lumos/codec";
import type {
  BytesLike,
  Fixed,
  FixedBytesCodec,
} from "@ckb-lumos/codec/lib/base.js";
import {
  Uint8 as U8,
  Uint16 as U16,
  Uint32 as U32,
  Uint64 as U64,
  Uint128 as U128,
} from "@ckb-lumos/codec/lib/number/uint.js";
import { OutPoint as OP } from "@ckb-lumos/base/lib/blockchain.js";
import type { ObjectLayoutCodec } from "@ckb-lumos/codec/lib/molecule";

// This codec file exists for the sole purpose to move away from BI. The web standard is now bigint.

export const Uint8: FixedBytesCodec<number, number | string | bigint> =
  Object.freeze(U8);
export const Uint16: FixedBytesCodec<number, number | string | bigint> =
  Object.freeze(U16);
export const Uint32: FixedBytesCodec<number, number | string | bigint> =
  Object.freeze(U32);

export const Uint64: FixedBytesCodec<bigint, number | string | bigint> =
  Object.freeze({
    ...U64,
    unpack: (unpackable: BytesLike) => U64.unpack(unpackable).toBigInt(),
  });

export const Uint128: FixedBytesCodec<bigint, number | string | bigint> =
  Object.freeze({
    ...U128,
    unpack: (unpackable: BytesLike) => U128.unpack(unpackable).toBigInt(),
  });

export const Int32 = Object.freeze(
  createFixedBytesCodec<number>({
    byteLength: 4,
    pack: (packable) => {
      const packed = new Uint8Array([0, 0, 0, 0]);
      new DataView(packed.buffer).setInt32(
        0,
        packable,
        true /* littleEndian */,
      );
      return packed;
    },
    unpack: (unpackable) =>
      new DataView(unpackable.buffer).getInt32(0, true /* littleEndian */),
  }),
);

export const OutPoint: ObjectLayoutCodec<{
  txHash: FixedBytesCodec<string, BytesLike>;
  index: FixedBytesCodec<string, number | string | bigint>;
}> &
  Fixed = Object.freeze(OP);
