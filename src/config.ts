import { BI } from "@ckb-lumos/bi"
import { HashType, Hexadecimal, OutPoint, blockchain } from "@ckb-lumos/base";
import { vector } from "@ckb-lumos/codec/lib/molecule";
import {
    Config, ScriptConfigs, ScriptConfig, generateGenesisScriptConfigs,
    predefined, getConfig, initializeConfig as unadaptedInitializeConfig
} from "@ckb-lumos/config-manager/lib";
import { I8Cell, I8Script, I8OutPoint, I8CellDep, cellDeps, i8ScriptPadding } from "./cell";
import { getGenesisBlock, getTransaction } from "./rpc";

const chain2RpcUrl = Object.freeze({
    mainnet: "https://rpc.ankr.com/nervos_ckb",
    testnet: "https://testnet.ckb.dev",
    devnet: "http://127.0.0.1:8114/"
});

export type Chain = keyof typeof chain2RpcUrl;

export function isChain(x: string): x is Chain {
    return chain2RpcUrl.hasOwnProperty(x);
}

export function defaultRpcUrl(chain: Chain) {
    return chain2RpcUrl[chain];
}

function newChainInfo(chain: Chain, rpcUrl: string = defaultRpcUrl(chain), isLightClientRpc: boolean = false) {
    return <ChainInfo>Object.freeze({
        chain,
        rpcUrl,
        isLightClientRpc
    });
}

export type ChainInfo = {
    chain: Chain,
    rpcUrl: string,
    isLightClientRpc: boolean
}

let _chainInfo = newChainInfo(addressPrefix() == "ckb" ? "mainnet" : "testnet");

export const errorUnresponsiveRpcUrl = "The provided RPC Url is either unresponsive or invalid";
export async function initializeChainAdapter(
    chain: Chain,
    config?: Config,
    rpcUrl: string = defaultRpcUrl(chain),
    isLightClientRpc: boolean = false
) {
    if (chain != _chainInfo.chain || rpcUrl !== _chainInfo.rpcUrl) {
        _chainInfo = newChainInfo(chain, rpcUrl, isLightClientRpc);
    }

    if (config !== undefined) {
        initializeConfig(config);
    } else if (chain === "mainnet") {
        initializeConfig(predefined.LINA);
    } else if (chain === "testnet") {
        initializeConfig(predefined.AGGRON4);
    } else {//Devnet        
        initializeConfig({
            PREFIX: "ckt",
            SCRIPTS: generateGenesisScriptConfigs(await getGenesisBlock()),
        });
    }
}

export function getChainInfo() {
    return Object.freeze({ ..._chainInfo });
}

//Try not to be over-reliant on getConfig as it may become an issue in the future. Use the provided abstractions.
export { getConfig } from "@ckb-lumos/config-manager/lib";

export function initializeConfig(config: Config) {
    unadaptedInitializeConfig(configAdapterFrom(config));
}

export function addressPrefix() {
    return getConfig().PREFIX;
}

export function scriptNames() {
    const res: string[] = [];
    for (const scriptName in getConfig().SCRIPTS) {
        res.push(scriptName);
    }
    return res;
}

export class ScriptConfigAdapter implements ScriptConfig {
    readonly defaultScript: I8Script;
    readonly index: number;
    constructor(defaultScript: I8Script, index: number = 0) {
        defaultScript[cellDeps][index].depType;
        this.defaultScript = defaultScript;
        this.index = index;
        return Object.freeze(this);
    }
    get CODE_HASH() { return this.defaultScript.codeHash; }
    get HASH_TYPE() { return this.defaultScript.hashType; }
    get TX_HASH() { return this.defaultScript[cellDeps][this.index].outPoint.txHash; }
    get INDEX() { return this.defaultScript[cellDeps][this.index].outPoint.index; }
    get DEP_TYPE() { return this.defaultScript[cellDeps][this.index].depType; }
}

export const errorScriptNameNotFound = "Script name not found"
export function defaultScript(name: string) {
    let config = getConfig();

    let scriptConfig = config.SCRIPTS[name];
    if (!scriptConfig) {
        throw Error(errorScriptNameNotFound);
    }

    return scriptConfigAdapterFrom(scriptConfig).defaultScript;
}

export function scriptConfigAdapterFrom(scriptConfig: ScriptConfig): ScriptConfigAdapter {
    if (scriptConfig instanceof ScriptConfigAdapter) {
        return scriptConfig;
    }

    const dep = I8CellDep.from({
        outPoint: I8OutPoint.from({
            txHash: scriptConfig.TX_HASH,
            index: scriptConfig.INDEX,
        }),
        depType: scriptConfig.DEP_TYPE,
    })

    return new ScriptConfigAdapter(I8Script.from({
        ...i8ScriptPadding,
        codeHash: scriptConfig.CODE_HASH,
        hashType: scriptConfig.HASH_TYPE,
        [cellDeps]: [dep]
    }));
}

export function configAdapterFrom(config: Config) {
    const adaptedScriptConfig: ScriptConfigs = {};
    for (const scriptName in config.SCRIPTS) {
        adaptedScriptConfig[scriptName] = scriptConfigAdapterFrom(config.SCRIPTS[scriptName]!);
    }
    return Object.freeze({
        PREFIX: config.PREFIX,
        SCRIPTS: Object.freeze(adaptedScriptConfig)
    })
}

export function serializeConfig(config: Config) {
    const scripts: { [id: string]: ScriptConfig } = {};
    for (const scriptName in config.SCRIPTS) {
        const s = config.SCRIPTS[scriptName]!;

        scripts[scriptName] = Object.freeze(<ScriptConfig>{
            TX_HASH: s.TX_HASH,
            INDEX: s.INDEX,
            DEP_TYPE: s.DEP_TYPE,
            CODE_HASH: s.CODE_HASH,
            HASH_TYPE: s.HASH_TYPE
        });
    }
    return JSON.stringify({ PREFIX: config.PREFIX, SCRIPTS: Object.freeze(scripts) }, undefined, 2);
}

export interface DeployScriptData {
    name: string;
    hexData: Hexadecimal;
    codeHash: Hexadecimal;
    hashType: HashType;
}

export async function deploy(
    scriptData: readonly DeployScriptData[],
    commit: (cells: readonly I8Cell[]) => Promise<I8OutPoint[]>,
    lock: I8Script = i8ScriptPadding,
    type?: I8Script
) {
    if (lock === i8ScriptPadding) {
        lock = defaultScript("SECP256K1_BLAKE160");
    }

    const dataCells: I8Cell[] = [];
    for (const { hexData: data } of scriptData) {
        dataCells.push(I8Cell.from({ lock, type, data }));
    }

    const outPoints = await commit(dataCells);
    const newScriptConfig: ScriptConfigs = {};
    const oldConfig = getConfig();
    scriptData.forEach(({ name, codeHash, hashType }, i) => {
        newScriptConfig[name] = new ScriptConfigAdapter(I8Script.from({
            ...i8ScriptPadding,
            codeHash,
            hashType,
            [cellDeps]: [I8CellDep.from({ outPoint: outPoints[i], depType: "code" })]
        }))
    });

    initializeConfig({
        PREFIX: oldConfig.PREFIX,
        SCRIPTS: { ...oldConfig.SCRIPTS, ...newScriptConfig }
    });

    return getConfig();
}

async function _getCellData(outPoint: I8OutPoint) {
    const index = BI.from(outPoint.index).toNumber();
    const t = (await getTransaction(outPoint.txHash)).transaction;
    return t.outputsData.at(index) ?? "0x";
}

export const errorScriptNotFound = "Script not found in Config";
export async function createDepGroup(
    scriptNames: readonly string[],
    commit: (cells: readonly I8Cell[]) => Promise<I8OutPoint[]>,
    lock: I8Script = i8ScriptPadding,
    type?: I8Script,
    getCellData: (outPoint: I8OutPoint) => Promise<string> = _getCellData
) {
    if (lock === i8ScriptPadding) {
        lock = defaultScript("SECP256K1_BLAKE160");
    }

    const outPointsCodec = vector(blockchain.OutPoint);
    const serializeOutPoint = (p: OutPoint) => `${p.txHash}-${p.index}`;
    const serializedOutPoint2OutPoint: Map<string, I8OutPoint> = new Map();
    for (const name of scriptNames) {
        const s = defaultScript(name);
        if (s === undefined) {
            throw Error(errorScriptNotFound);
        }
        for (const cellDep of s[cellDeps]) {
            if (cellDep.depType === "code") {
                serializedOutPoint2OutPoint.set(serializeOutPoint(cellDep.outPoint), cellDep.outPoint);
            } else { //depGroup
                const cellData = await getCellData(cellDep.outPoint);
                for (const o_ of outPointsCodec.unpack(cellData)) {
                    const o = I8OutPoint.from({ ...o_, index: BI.from(o_.index).toHexString() });
                    serializedOutPoint2OutPoint.set(serializeOutPoint(o), o);
                }
            }
        }
    }

    const packedOutPoints = outPointsCodec.pack([...serializedOutPoint2OutPoint.values()]);
    const data = "0x" + Buffer.from(packedOutPoints).toString('hex');
    const cell = I8Cell.from({ lock, type, data });
    const [outPoint] = await commit([cell]);

    const newScriptConfig: ScriptConfigs = {};
    for (const name of scriptNames) {
        const s = defaultScript(name);
        newScriptConfig[name] = new ScriptConfigAdapter(
            I8Script.from({
                ...s,
                [cellDeps]: [I8CellDep.from({ outPoint, depType: "depGroup" })]
            })
        );
    }

    const oldConfig = getConfig();
    initializeConfig({
        PREFIX: oldConfig.PREFIX,
        SCRIPTS: { ...oldConfig.SCRIPTS, ...newScriptConfig }
    });

    return getConfig();
}