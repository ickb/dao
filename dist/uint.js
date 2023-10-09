"use strict";
// Code taken as it is from:
// https://raw.githubusercontent.com/ckb-js/lumos/develop/packages/codec/src/number/uint.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUintBICodec = void 0;
const bi_1 = require("@ckb-lumos/bi");
const base_1 = require("@ckb-lumos/codec/lib/base");
const error_1 = require("@ckb-lumos/codec/lib/error");
function assertNumberRange(value, min, max, typeName) {
    value = bi_1.BI.from(value);
    if (value.lt(min) || value.gt(max)) {
        throw new error_1.CodecBaseParseError(`Value must be between ${min.toString()} and ${max.toString()}, but got ${value.toString()}`, typeName);
    }
}
const createUintBICodec = (byteLength, littleEndian = false) => {
    const max = bi_1.BI.from(1)
        .shl(byteLength * 8)
        .sub(1);
    return (0, base_1.createFixedBytesCodec)({
        byteLength,
        pack(biIsh) {
            let endianType = littleEndian ? "LE" : "BE";
            if (byteLength <= 1) {
                endianType = "";
            }
            const typeName = `Uint${byteLength * 8}${endianType}`;
            if (typeof biIsh === "number" && !Number.isSafeInteger(biIsh)) {
                throw new error_1.CodecBaseParseError(`${biIsh} is not a safe integer`, typeName);
            }
            let num = bi_1.BI.from(biIsh);
            assertNumberRange(num, 0, max, typeName);
            const result = new DataView(new ArrayBuffer(byteLength));
            for (let i = 0; i < byteLength; i++) {
                if (littleEndian) {
                    result.setUint8(i, num.and(0xff).toNumber());
                }
                else {
                    result.setUint8(byteLength - i - 1, num.and(0xff).toNumber());
                }
                num = num.shr(8);
            }
            return new Uint8Array(result.buffer);
        },
        unpack: (buf) => {
            const view = new DataView(Uint8Array.from(buf).buffer);
            let result = bi_1.BI.from(0);
            for (let i = 0; i < byteLength; i++) {
                if (littleEndian) {
                    result = result.or(bi_1.BI.from(view.getUint8(i)).shl(i * 8));
                }
                else {
                    result = result.shl(8).or(view.getUint8(i));
                }
            }
            return result;
        },
    });
};
exports.createUintBICodec = createUintBICodec;
