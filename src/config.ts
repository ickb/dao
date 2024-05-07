import type { Config, ScriptConfigs, ScriptConfig } from "@ckb-lumos/config-manager/lib";
import {
    generateGenesisScriptConfigs, predefined, getConfig, initializeConfig as unadaptedInitializeConfig
} from "@ckb-lumos/config-manager";
import { I8Script, I8OutPoint, I8CellDep, cellDeps, i8ScriptPadding } from "./cell.js";
import { getGenesisBlock } from "./rpc.js";

const chain2RpcUrl = Object.freeze({
    mainnet: "https://rpc.ankr.com/nervos_ckb",
    testnet: "https://testnet.ckb.dev",
    devnet: "http://127.0.0.1:8114/"
});

export type Chain = keyof typeof chain2RpcUrl;

export function isChain(x: string | undefined): x is Chain {
    return x ? chain2RpcUrl.hasOwnProperty(x) : false;
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