import { BI } from "@ckb-lumos/bi"
import { Cell, Hash, HashType, Header, Hexadecimal, OutPoint, Transaction, blockchain } from "@ckb-lumos/base";
import { vector } from "@ckb-lumos/codec/lib/molecule";
import {
    Config, ScriptConfigs, ScriptConfig, generateGenesisScriptConfigs,
    predefined, getConfig, initializeConfig as unadaptedInitializeConfig
} from "@ckb-lumos/config-manager/lib";
import { I8Cell, I8Script, I8OutPoint, I8Header, scriptEq, I8CellDep, cellDeps } from "./cell";
import { LightClientRPC } from "@ckb-lumos/light-client";
import { RPC } from "@ckb-lumos/rpc";
import { CKBComponents } from "@ckb-lumos/rpc/lib/types/api";

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
        codeHash: scriptConfig.CODE_HASH,
        hashType: scriptConfig.HASH_TYPE,
        args: "0x",
        [cellDeps]: Object.freeze([dep])
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
    return JSON.stringify(Object.freeze({ PREFIX: config.PREFIX, SCRIPTS: Object.freeze(scripts) }), undefined, 2);
}

export async function deploy(
    scriptData: Iterable<{
        name: string;
        hexData: Hexadecimal;
        codeHash: Hexadecimal;
        hashType: HashType;
    }>,
    commit: (cells: Iterable<I8Cell>) => Promise<Iterable<I8OutPoint>>,
    lock: I8Script = defaultScript("SECP256K1_BLAKE160"),
    type?: I8Script
) {
    const dataCells: I8Cell[] = [];
    for (const { hexData: data } of scriptData) {
        dataCells.push(I8Cell.from({ lock, type, data }));
    }

    const outPoints = Array.from(await commit(dataCells));
    const newScriptConfig: ScriptConfigs = {};
    const oldConfig = getConfig();
    Array.from(scriptData).forEach(({ name, codeHash, hashType }, i) => {
        newScriptConfig[name] = new ScriptConfigAdapter(I8Script.from({
            codeHash,
            hashType,
            args: "0x",
            [cellDeps]: Object.freeze([I8CellDep.from({ outPoint: outPoints[i], depType: "code" })])
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
    scriptNames: Iterable<string>,
    commit: (cells: Iterable<I8Cell>) => Promise<Iterable<I8OutPoint>>,
    lock: I8Script = defaultScript("SECP256K1_BLAKE160"),
    type?: I8Script,
    getCellData: (outPoint: I8OutPoint) => Promise<string> = _getCellData
) {
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
                [cellDeps]: Object.freeze([I8CellDep.from({ outPoint, depType: "depGroup" })])
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

export function getChainInfo() {
    return Object.freeze({ ..._chainInfo });
}

//Methods that work for both RPC and Light Client RPC
const errorHeaderNotFound = "Unable to reach the Header given the block number and the context";
export async function getHeaderByNumber(
    queries: { blockNum: Hexadecimal, context: OutPoint }[],
    knownHeaders: Iterable<I8Header> = []
) {
    const blockNum2Header: Map<Hexadecimal, I8Header> = new Map();
    const blockHash2Header: Map<Hexadecimal, I8Header> = new Map();
    for (const h of knownHeaders) {
        blockNum2Header.set(h.number, h);
        blockHash2Header.set(h.hash, h);
    }

    const wantedBlockNums = new Set<Hexadecimal>();
    const txHashSuitors = new Set<Hexadecimal>();
    for (const { blockNum, context } of queries) {
        if (blockNum2Header.has(blockNum)) {
            continue;
        }
        wantedBlockNums.add(blockNum);
        txHashSuitors.add(context.txHash);
    }

    let discoveredHeaders: Header[] = []
    if (!_chainInfo.isLightClientRpc) {
        const rpc = new RPC(_chainInfo.rpcUrl);
        discoveredHeaders = await Promise.all([...wantedBlockNums].map((blockNum) => rpc.getHeaderByNumber(blockNum)));
    } else {
        const lightClientRPC = new LightClientRPC(_chainInfo.rpcUrl);

        const hashSuitors = new Set<Hexadecimal>();
        for (const tx of await Promise.all([...txHashSuitors].map((txHash) => lightClientRPC.getTransaction(txHash)))) {
            //Maybe there are DAO withdrawal request transactions, try also with the transaction headerDeps
            for (const hash of [tx.txStatus.blockHash!, ...tx.transaction.headerDeps]) {
                if (blockHash2Header.has(hash)) {
                    continue;
                }
                hashSuitors.add(hash);
            }
        }
        discoveredHeaders = await Promise.all([...hashSuitors].map(h => lightClientRPC.getHeader(h)));
    }

    for (const h of discoveredHeaders) {
        const i8h = I8Header.from(h);
        blockNum2Header.set(h.number, i8h);
        blockHash2Header.set(h.hash, i8h);
    }

    for (const blockNum of wantedBlockNums) {
        if (!blockNum2Header.has(blockNum)) {
            throw Error(errorHeaderNotFound);
        }
    }

    return [...blockHash2Header.values()];
}

export async function getCells<WithData extends boolean = true>(
    searchKey: CKBComponents.GetCellsSearchKey<WithData>,
    order: CKBComponents.Order = "asc",
    limit: CKBComponents.Hash = "0xffffffff",
    cursor?: CKBComponents.Hash256) {
    //Same signature for both RPC and light client RPC

    const script = searchKey.script;
    searchKey.script = { codeHash: script.codeHash, hashType: script.hashType, args: script.args };

    const cc = await new RPC(_chainInfo.rpcUrl).getCells(searchKey, order, limit, cursor);
    return cc.objects.map(c => Object.freeze(<Cell>{
        cellOutput: {
            capacity: c.output.capacity,
            lock: scriptEq(c.output.lock, script) ? script : c.output.lock,
            type: c.output.type ?? undefined,
        },
        data: c.outputData ?? "0x",
        outPoint: c.outPoint ?? undefined,
        blockNumber: c.blockNumber,
    }));
}

export async function getFeeRate() {
    const rpc = new RPC(_chainInfo.isLightClientRpc ? defaultRpcUrl(_chainInfo.chain) : _chainInfo.rpcUrl);

    const [feeRateStatistics6, feeRateStatistics101] = await Promise.all([
        rpc.getFeeRateStatistics("0x6"),
        rpc.getFeeRateStatistics("0x101")
    ]);

    const median101 = feeRateStatistics101 === null ? BI.from(1000) : BI.from(feeRateStatistics101.median);
    const median6 = feeRateStatistics6 === null ? median101 : BI.from(feeRateStatistics6.median);

    let res = median6.add(median6.div(10));

    const lowerLimit = median101.add(median101.div(10));
    const upperLimit = BI.from(10 ** 7)

    if (res.lt(lowerLimit)) {
        res = lowerLimit;
    } else if (res.gt(upperLimit)) {
        res = upperLimit;
    }
    return res;
}

export const errorUnexpectedTxState = "Unexpected transaction state";
export const errorTimeOut = "Transaction timed out";
export async function sendTransaction(tx: Transaction, secondsTimeout: number = 600) {
    //Same signature for both RPC and light client RPC
    const rpc = new RPC(_chainInfo.rpcUrl);

    const txHashPromise = rpc.sendTransaction(tx);

    if (secondsTimeout <= 0) {
        return txHashPromise;
    }

    const txHash = await txHashPromise;

    //Wait until the transaction is committed or time out
    for (let i = 0; i < secondsTimeout; i++) {
        let status = (await rpc.getTransaction(txHash)).txStatus.status;
        switch (status) {
            case "committed":
                return txHash;
            case "pending":
            case "proposed":
                await new Promise(r => setTimeout(r, 1000));
                break;
            // case "rejected":
            // case "unknown":
            default:
                throw Error(errorUnexpectedTxState);
        }
    }

    throw Error(errorTimeOut);
}

export async function getTipHeader() {
    //Same signature for both RPC and light client RPC
    return new RPC(_chainInfo.rpcUrl).getTipHeader();
}

export async function getGenesisBlock() {
    if (_chainInfo.isLightClientRpc) {
        return new LightClientRPC(_chainInfo.rpcUrl).getGenesisBlock();
    } else {
        return new RPC(_chainInfo.rpcUrl).getBlockByNumber('0x0');
    }
}

export async function getHeader(blockHash: Hash) {
    //Same signature for both RPC and light client RPC
    return new RPC(_chainInfo.rpcUrl).getHeader(blockHash);
}

export async function getTransaction(txHash: Hash) {
    //Same signature for both RPC and light client RPC
    return new RPC(_chainInfo.rpcUrl).getTransaction(txHash);
}

export async function localNodeInfo() {
    //Same signature for both RPC and light client RPC
    return new RPC(_chainInfo.rpcUrl).localNodeInfo();
}

export async function getTransactions<Group extends boolean = false>(
    searchKey: CKBComponents.GetTransactionsSearchKey<Group>,
    order: CKBComponents.Order = "asc",
    limit: CKBComponents.Hash | bigint = "0xffffffff",
    cursor?: CKBComponents.Hash256) {
    //Same signature for both RPC and light client RPC
    return new RPC(_chainInfo.rpcUrl).getTransactions(searchKey, order, limit, cursor);
}

export async function getCellsCapacity(searchKey: CKBComponents.SearchKey) {
    //Same signature for both RPC and light client RPC
    return new RPC(_chainInfo.rpcUrl).getCellsCapacity(searchKey);
}