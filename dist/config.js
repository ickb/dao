"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDepGroup = exports.deploy = exports.defaultDaoConfig = exports.defaultSecp256k1Blake160Config = void 0;
const bi_1 = require("@ckb-lumos/bi");
const lib_1 = require("@ckb-lumos/config-manager/lib");
const base_1 = require("@ckb-lumos/base");
const molecule_1 = require("@ckb-lumos/codec/lib/molecule");
const rpc_1 = require("./rpc");
const utils_1 = require("./utils");
const helpers_1 = require("@ckb-lumos/helpers");
const actions_1 = require("./actions");
async function getGenesisBlock() {
    return (await (0, rpc_1.getRpc)()).getBlockByNumber("0x0");
}
async function defaultSecp256k1Blake160Config() {
    return {
        CODE_HASH: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
        HASH_TYPE: "type",
        TX_HASH: (await getGenesisBlock()).transactions[1].hash,
        INDEX: "0x0",
        DEP_TYPE: "depGroup",
    };
}
exports.defaultSecp256k1Blake160Config = defaultSecp256k1Blake160Config;
async function defaultDaoConfig() {
    return {
        CODE_HASH: "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
        HASH_TYPE: "type",
        TX_HASH: (await getGenesisBlock()).transactions[0].hash,
        INDEX: "0x2",
        DEP_TYPE: "code",
    };
}
exports.defaultDaoConfig = defaultDaoConfig;
// async function ScriptDataFrom(folderPath: string) {
//     const result: ScriptData[] = [];
//     for (const name of (await readdir(folderPath)).sort()) {
//         const rawData = await readFile(folderPath + name);
//         const hexData = "0x" + rawData.toString("hex");
//         const codeHash = ckbHash(rawData);
//         const hashType = "data1";
//         result.push({ name, hexData, codeHash, hashType });
//     }
//     return result;
// }
async function deploy(transactionBuilder, scriptData, newCellLock = (0, utils_1.defaultScript)("SECP256K1_BLAKE160")) {
    const dataCells = [];
    for (const { name, hexData, codeHash, hashType } of scriptData) {
        const dataCell = {
            cellOutput: {
                capacity: "0x42",
                lock: newCellLock,
                type: undefined
            },
            data: hexData
        };
        dataCell.cellOutput.capacity = (0, helpers_1.minimalCellCapacityCompatible)(dataCell).toHexString();
        dataCells.push(dataCell);
    }
    const { txHash } = await (await (0, actions_1.fund)(transactionBuilder.add("output", "start", ...dataCells))).buildAndSend();
    const oldConfig = (0, lib_1.getConfig)();
    const newScriptConfig = {};
    let index = bi_1.BI.from(0);
    for (const { name, codeHash, hashType } of scriptData) {
        newScriptConfig[name] = {
            CODE_HASH: codeHash,
            HASH_TYPE: hashType,
            TX_HASH: txHash,
            INDEX: index.toHexString(),
            DEP_TYPE: "code"
        };
        index = index.add(1);
    }
    (0, lib_1.initializeConfig)({
        PREFIX: oldConfig.PREFIX,
        SCRIPTS: { ...oldConfig.SCRIPTS, ...newScriptConfig }
    });
}
exports.deploy = deploy;
async function createDepGroup(transactionBuilder, names, newCellLock = (0, utils_1.defaultScript)("SECP256K1_BLAKE160")) {
    const rpc = (await (0, rpc_1.getRpc)());
    const oldConfig = (0, lib_1.getConfig)();
    const outPoints = [];
    const outPointsCodec = (0, molecule_1.vector)(base_1.blockchain.OutPoint);
    for (const name of names) {
        const s = oldConfig.SCRIPTS[name];
        if (s === undefined) {
            throw Error(`Script ${s} not found in Config`);
        }
        if (s.DEP_TYPE === "code") {
            outPoints.push({
                txHash: s.TX_HASH,
                index: s.INDEX
            });
        }
        else { //depGroup
            const cell = (await rpc.getLiveCell({
                txHash: s.TX_HASH,
                index: s.INDEX
            }, true)).cell;
            for (const outPoint of outPointsCodec.unpack(cell.data.content)) {
                outPoints.push({
                    txHash: outPoint.txHash,
                    index: bi_1.BI.from(outPoint.index).toHexString()
                });
            }
        }
    }
    let packedOutPoints = (0, molecule_1.vector)(base_1.blockchain.OutPoint).pack(outPoints);
    let hexOutPoints = "0x" + Buffer.from(packedOutPoints).toString('hex');
    const cell = {
        cellOutput: {
            capacity: "0x42",
            lock: newCellLock,
            type: undefined
        },
        data: hexOutPoints
    };
    cell.cellOutput.capacity = (0, helpers_1.minimalCellCapacityCompatible)(cell).toHexString();
    const { txHash } = await (await (0, actions_1.fund)(transactionBuilder.add("output", "start", cell))).buildAndSend();
    const newScriptConfig = {};
    let index = bi_1.BI.from(0).toHexString();
    for (const name of names) {
        const s = oldConfig.SCRIPTS[name];
        newScriptConfig[name] = {
            ...s,
            TX_HASH: txHash,
            INDEX: index,
            DEP_TYPE: "depGroup",
        };
    }
    (0, lib_1.initializeConfig)({
        PREFIX: oldConfig.PREFIX,
        SCRIPTS: { ...oldConfig.SCRIPTS, ...newScriptConfig }
    });
    return txHash;
}
exports.createDepGroup = createDepGroup;
