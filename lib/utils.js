"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLiveCell = exports.calculateFee = exports.txSize = exports.stringifyEpoch = exports.epochCompare = exports.parseEpoch = exports.isDAOWithdrawal = exports.isDAODeposit = exports.DAO_DEPOSIT_DATA = exports.isScript = exports.scriptEq = exports.defaultCellDeps = exports.defaultScript = void 0;
const bi_1 = require("@ckb-lumos/bi");
const lib_1 = require("@ckb-lumos/config-manager/lib");
const base_1 = require("@ckb-lumos/base");
const helpers_1 = require("@ckb-lumos/helpers");
const chain_adapter_1 = require("./chain_adapter");
function defaultScript(name) {
    let configData = (0, lib_1.getConfig)().SCRIPTS[name];
    if (!configData) {
        throw Error(name + " not found");
    }
    return {
        codeHash: configData.CODE_HASH,
        hashType: configData.HASH_TYPE,
        args: "0x"
    };
}
exports.defaultScript = defaultScript;
function defaultCellDeps(name) {
    let configData = (0, lib_1.getConfig)().SCRIPTS[name];
    if (!configData) {
        throw Error(name + " not found");
    }
    return {
        outPoint: {
            txHash: configData.TX_HASH,
            index: configData.INDEX,
        },
        depType: configData.DEP_TYPE,
    };
}
exports.defaultCellDeps = defaultCellDeps;
function scriptEq(s0, s1) {
    return isScript(s0, s1) && s0.args === s1.args;
}
exports.scriptEq = scriptEq;
function isScript(s0, s1) {
    if (!s0 && !s1) {
        throw Error("Comparing two undefined Scripts");
    }
    if (!s0 || !s1) {
        return false;
    }
    return s0.codeHash === s1.codeHash &&
        s0.hashType === s1.hashType;
}
exports.isScript = isScript;
exports.DAO_DEPOSIT_DATA = "0x0000000000000000";
function isDAODeposit(c) {
    return scriptEq(c.cellOutput.type, defaultScript("DAO")) && c.data === exports.DAO_DEPOSIT_DATA;
}
exports.isDAODeposit = isDAODeposit;
function isDAOWithdrawal(c) {
    return scriptEq(c.cellOutput.type, defaultScript("DAO")) && c.data !== exports.DAO_DEPOSIT_DATA;
}
exports.isDAOWithdrawal = isDAOWithdrawal;
function parseEpoch(epoch) {
    const _epoch = bi_1.BI.from(epoch);
    return {
        length: _epoch.shr(40).and(0xfff),
        index: _epoch.shr(24).and(0xfff),
        number: _epoch.and(0xffffff),
    };
}
exports.parseEpoch = parseEpoch;
function epochCompare(e0, e1) {
    if (e0.number.lt(e1.number)) {
        return -1;
    }
    if (e0.number.gt(e1.number)) {
        return 1;
    }
    const v0 = e0.index.mul(e1.length);
    const v1 = e1.index.mul(e0.length);
    if (v0.lt(v1)) {
        return -1;
    }
    if (v0.gt(v1)) {
        return 1;
    }
    return 0;
}
exports.epochCompare = epochCompare;
function stringifyEpoch(e) {
    return bi_1.BI.from(e.length.shl(40))
        .add(e.index.shl(24))
        .add(e.number)
        .toHexString();
}
exports.stringifyEpoch = stringifyEpoch;
function txSize(transaction) {
    const serializedTx = base_1.blockchain.Transaction.pack((0, helpers_1.createTransactionFromSkeleton)(transaction));
    // 4 is serialized offset bytesize;
    return serializedTx.byteLength + 4;
}
exports.txSize = txSize;
function calculateFee(size, feeRate) {
    const ratio = bi_1.BI.from(1000);
    const base = bi_1.BI.from(size).mul(feeRate);
    const fee = base.div(ratio);
    if (fee.mul(ratio).lt(base)) {
        return fee.add(1);
    }
    return fee;
}
exports.calculateFee = calculateFee;
async function getLiveCell(outPoint) {
    const rpc = (0, chain_adapter_1.getRpc)();
    const res = await rpc.getLiveCell(outPoint, true);
    const blockHash = (await rpc.getTransactionProof([outPoint.txHash])).blockHash;
    const blockNumber = (await rpc.getBlock(blockHash)).header.number;
    if (res.status !== "live")
        throw new Error(`Live cell not found at out point: ${outPoint.txHash}-${outPoint.index}`);
    return {
        cellOutput: res.cell.output,
        outPoint,
        data: res.cell.data.content,
        blockHash,
        blockNumber
    };
}
exports.getLiveCell = getLiveCell;
//# sourceMappingURL=utils.js.map