import { TransactionBuilder } from "./domain_logic";
import { BI } from "@ckb-lumos/bi"
import { ScriptConfig, ScriptConfigs, getConfig, initializeConfig, } from "@ckb-lumos/config-manager/lib";
import { Cell, HashType, Hexadecimal, OutPoint, Script, blockchain } from "@ckb-lumos/base";
import { vector } from "@ckb-lumos/codec/lib/molecule";
import { getRpc } from "./chain_adapter";
import { defaultScript } from "./utils";
import { minimalCellCapacityCompatible } from "@ckb-lumos/helpers";
import { fund } from "./actions";

async function getGenesisBlock() {
    return getRpc().getBlockByNumber("0x0");
}

export async function secp256k1Blake160Config(): Promise<ScriptConfig> {
    return {
        CODE_HASH: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
        HASH_TYPE: "type",
        TX_HASH: (await getGenesisBlock()).transactions[1].hash!,
        INDEX: "0x0",
        DEP_TYPE: "depGroup",
    };
}

export async function daoConfig(): Promise<ScriptConfig> {
    return {
        CODE_HASH: "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
        HASH_TYPE: "type",
        TX_HASH: (await getGenesisBlock()).transactions[0].hash!,
        INDEX: "0x2",
        DEP_TYPE: "code",
    };
}

export type ScriptData = {
    name: string,
    hexData: Hexadecimal,
    codeHash: Hexadecimal,
    hashType: HashType
}

export async function deploy(transactionBuilder: TransactionBuilder, scriptData: ScriptData[], newCellLock: Script = defaultScript("SECP256K1_BLAKE160")) {
    const dataCells: Cell[] = [];
    for (const { name, hexData, codeHash, hashType } of scriptData) {
        const dataCell: Cell = {
            cellOutput: {
                capacity: "0x42",
                lock: newCellLock,
                type: undefined
            },
            data: hexData
        };
        dataCell.cellOutput.capacity = minimalCellCapacityCompatible(dataCell).toHexString();
        dataCells.push(dataCell);
    }

    const { txHash } = await (await fund(transactionBuilder.add("output", "start", ...dataCells))).buildAndSend();

    const oldConfig = getConfig();
    const newScriptConfig: ScriptConfigs = {};
    let index = BI.from(0);
    for (const { name, codeHash, hashType } of scriptData) {
        newScriptConfig[name] = {
            CODE_HASH: codeHash,
            HASH_TYPE: hashType,
            TX_HASH: txHash,
            INDEX: index.toHexString(),
            DEP_TYPE: "code"
        }
        index = index.add(1);
    }

    initializeConfig({
        PREFIX: oldConfig.PREFIX,
        SCRIPTS: { ...oldConfig.SCRIPTS, ...newScriptConfig }
    });

    return txHash;
}

export async function createDepGroup(transactionBuilder: TransactionBuilder, names: string[], newCellLock: Script = defaultScript("SECP256K1_BLAKE160")) {
    const rpc = getRpc();
    const oldConfig = getConfig();
    const outPointsCodec = vector(blockchain.OutPoint);
    const serializeOutPoint = (p: OutPoint) => `${p.txHash}-${p.index}`;
    const serializedOutPoint2OutPoint: Map<string, OutPoint> = new Map();
    for (const name of names) {
        const s = oldConfig.SCRIPTS[name];
        if (s === undefined) {
            throw Error(`Script ${s} not found in Config`);
        }

        const o: OutPoint = { txHash: s.TX_HASH, index: s.INDEX };
        if (s.DEP_TYPE === "code") {
            serializedOutPoint2OutPoint.set(serializeOutPoint(o), o);
        } else { //depGroup
            const cell = (await rpc.getLiveCell(o, true)).cell;
            for (const o_ of outPointsCodec.unpack(cell.data.content)) {
                const o: OutPoint = { ...o_, index: BI.from(o_.index).toHexString() };
                serializedOutPoint2OutPoint.set(serializeOutPoint(o), o);
            }
        }
    }

    let packedOutPoints = outPointsCodec.pack([...serializedOutPoint2OutPoint.values()]);
    const cell: Cell = {
        cellOutput: {
            capacity: "0x42",
            lock: newCellLock,
            type: undefined
        },
        data: "0x" + Buffer.from(packedOutPoints).toString('hex')
    };
    cell.cellOutput.capacity = minimalCellCapacityCompatible(cell).toHexString();

    const { txHash } = await (await fund(transactionBuilder.add("output", "start", cell))).buildAndSend();

    const newScriptConfig: ScriptConfigs = {};
    let index = BI.from(0).toHexString();
    for (const name of names) {
        const s = oldConfig.SCRIPTS[name]!;
        newScriptConfig[name] = {
            ...s,
            TX_HASH: txHash,
            INDEX: index,
            DEP_TYPE: "depGroup",
        }
    }

    initializeConfig({
        PREFIX: oldConfig.PREFIX,
        SCRIPTS: { ...oldConfig.SCRIPTS, ...newScriptConfig }
    });

    return txHash;
}