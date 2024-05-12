import { createFixedBytesCodec } from "@ckb-lumos/codec";
import {
    Uint8 as U8, Uint16 as U16, Uint32 as U32, Uint64 as U64, Uint128 as U128
} from "@ckb-lumos/codec/lib/number/uint.js";

// This codec file exists for the sole purpose to move away from BI. The web standard is now bigint.

export const Boolean = createFixedBytesCodec<boolean>(
    {
        byteLength: 1,
        pack: (packable) => new Uint8Array([packable ? 1 : 0]),
        unpack: (unpackable) => unpackable.at(0)! === 0 ? false : true,
    },
);

export const Uint8 = createFixedBytesCodec<number, number | string | bigint>(U8);
export const Uint16 = createFixedBytesCodec<number, number | string | bigint>(U16);
export const Uint32 = createFixedBytesCodec<number, number | string | bigint>(U32);

export const Uint64 = createFixedBytesCodec<bigint, number | string | bigint>(
    {
        ...U64,
        unpack: (unpackable) => U64.unpack(unpackable).toBigInt(),
    },
);

export const Uint128 = createFixedBytesCodec<bigint, number | string | bigint>(
    {
        ...U128,
        unpack: (unpackable) => U128.unpack(unpackable).toBigInt(),
    },
);

export const Int32 = createFixedBytesCodec<number>(
    {
        byteLength: 4,
        pack: (packable) => {
            const packed = new Uint8Array([0, 0, 0, 0]);
            new DataView(packed.buffer).setInt32(0, packable, true /* littleEndian */);
            return packed;
        },
        unpack: (unpackable) => new DataView(unpackable.buffer).getInt32(0, true /* littleEndian */),
    },
);