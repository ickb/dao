import {
  generateGenesisScriptConfigs,
  predefined,
  initializeConfig,
} from "@ckb-lumos/config-manager";
import type { Config, ScriptConfig } from "@ckb-lumos/config-manager";
import {
  I8Script,
  I8OutPoint,
  I8CellDep,
  cellDeps,
  i8ScriptPadding,
} from "./cell.js";
import type {
  Cell,
  Hash,
  HashType,
  HexNumber,
  HexString,
  Hexadecimal,
  Script,
} from "@ckb-lumos/base";
import { ParamsFormatter, RPC, type CKBRPC } from "@ckb-lumos/rpc";
export interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  rpc: ExtendedRPC;
  config: ConfigAdapter;
}

export async function chainConfigFrom(
  chain: Chain,
  rpcUrl: string = defaultRpcUrl(chain),
  neuterLumosConfig: boolean = false,
  ...customizations: ((
    chain: Chain,
    scriptConfigs: { [id: string]: ScriptConfigAdapter },
  ) => { [id: string]: ScriptConfigAdapter })[]
): Promise<ChainConfig> {
  const rpc = extendedRPC(rpcUrl);

  let config = configAdapterFrom(
    chain === "mainnet"
      ? predefined.LINA
      : chain === "testnet"
        ? predefined.AGGRON4
        : {
            //Devnet
            PREFIX: "ckt",
            SCRIPTS: generateGenesisScriptConfigs(
              await rpc.getBlockByNumber("0x0"),
            ),
          },
  );

  let scriptConfigs = config.SCRIPTS;
  for (const customize of customizations) {
    scriptConfigs = Object.freeze({
      ...scriptConfigs,
      ...customize(chain, scriptConfigs),
    });
  }

  config = new ConfigAdapter(config.prefix, scriptConfigs);

  // Lumos config global creates troubles
  initializeConfig(
    neuterLumosConfig
      ? {
          PREFIX: "",
          SCRIPTS: {},
        }
      : config,
  );

  return {
    chain,
    rpcUrl,
    rpc,
    config,
  };
}

const chain2RpcUrl = Object.freeze({
  mainnet: "https://rpc.ankr.com/nervos_ckb",
  testnet: "https://testnet.ckb.dev",
  // testnet: "https://testnet.ckbapp.dev",
  devnet: "http://127.0.0.1:8114/",
});

export type Chain = keyof typeof chain2RpcUrl;

export function isChain(x: string | undefined): x is Chain {
  return x ? x in chain2RpcUrl : false;
}

export function defaultRpcUrl(chain: Chain) {
  return chain2RpcUrl[chain];
}

export interface ExtendedRPC extends CKBRPC {
  getCellsByLock: (
    lock: Script,
    order: "asc" | "desc",
    limit: bigint | HexNumber | number,
  ) => Promise<Cell[]>;
  getFeeRate: (number: bigint | HexNumber) => Promise<bigint>;
}

export function extendedRPC(rpcUrl: string) {
  const rpc = new RPC(rpcUrl) as ExtendedRPC;

  rpc.addMethod({
    name: "getCellsByLock",
    method: "get_cells",
    paramsFormatters: [
      (lock: Script) => ({
        script: {
          code_hash: lock.codeHash,
          hash_type: lock.hashType,
          args: lock.args,
        },
        script_type: "lock",
        script_search_mode: "exact",
      }),
      (order: "desc" | "asc") => order,
      (limit: bigint | HexNumber | "max") => {
        if (limit === "max") {
          return "0xffffffff";
        }
        return ParamsFormatter.toNumber(limit);
      },
    ],
    resultFormatters: (res: {
      objects: {
        output: {
          capacity: Hexadecimal;
          lock: {
            code_hash: Hash;
            hash_type: HashType;
            args: HexString;
          };
          type?: {
            code_hash: Hash;
            hash_type: HashType;
            args: HexString;
          };
        };
        output_data: HexString;
        block_number: HexNumber;
        out_point: {
          tx_hash: Hash;
          index: HexNumber;
        };
        tx_index: HexNumber;
      }[];
    }): Cell[] =>
      res.objects.map(
        ({
          output: { capacity, lock, type },
          block_number,
          out_point,
          output_data,
          tx_index,
        }) => ({
          cellOutput: {
            capacity: capacity,
            lock: {
              codeHash: lock.code_hash,
              hashType: lock.hash_type,
              args: lock.args,
            },
            type: type
              ? {
                  codeHash: type.code_hash,
                  hashType: type.hash_type,
                  args: type.args,
                }
              : undefined,
          },
          data: output_data ?? "0x",
          outPoint: { index: out_point.index, txHash: out_point.tx_hash },
          blockNumber: block_number,
          txIndex: tx_index,
        }),
      ),
  });

  rpc.addMethod({
    name: "getFeeRate",
    method: "get_fee_rate_statistics",
    paramsFormatters: [
      // Target as default ten minutes median fee-rate
      (target: bigint | string) => ParamsFormatter.toNumber(target),
    ],
    resultFormatters: (res?: { median?: string }) => {
      return !res || !res.median ? 1000n : BigInt(res.median);
    },
  });

  return rpc;
}

export class ScriptNameNotFound extends Error {
  readonly missingScriptName: string;

  constructor(missingScriptName: string) {
    super(errorScriptNameNotFound);

    this.missingScriptName = missingScriptName;

    Object.setPrototypeOf(this, ScriptNameNotFound.prototype);
  }
}

export const errorScriptNameNotFound = "Script name not found";
export class ConfigAdapter implements Config {
  readonly prefix: string;
  readonly scripts: { [id: string]: ScriptConfigAdapter };

  constructor(prefix: string, scripts: { [id: string]: ScriptConfigAdapter }) {
    this.prefix = prefix;
    this.scripts = Object.freeze(scripts);
    return Object.freeze(this);
  }

  defaultScript(name: string) {
    const scriptConfig = this.scripts[name];
    if (!scriptConfig) {
      throw new ScriptNameNotFound(name);
    }
    return scriptConfig.defaultScript;
  }

  get PREFIX() {
    return this.prefix;
  }
  get SCRIPTS() {
    return this.scripts;
  }
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
  get CODE_HASH() {
    return this.defaultScript.codeHash;
  }
  get HASH_TYPE() {
    return this.defaultScript.hashType;
  }
  get TX_HASH() {
    return this.defaultScript[cellDeps][this.index].outPoint.txHash;
  }
  get INDEX() {
    return this.defaultScript[cellDeps][this.index].outPoint.index;
  }
  get DEP_TYPE() {
    return this.defaultScript[cellDeps][this.index].depType;
  }
}

export function scriptConfigAdapterFrom(
  scriptConfig: ScriptConfig,
): ScriptConfigAdapter {
  if (scriptConfig instanceof ScriptConfigAdapter) {
    return scriptConfig;
  }

  const dep = I8CellDep.from({
    outPoint: I8OutPoint.from({
      txHash: scriptConfig.TX_HASH,
      index: scriptConfig.INDEX,
    }),
    depType: scriptConfig.DEP_TYPE,
  });

  return new ScriptConfigAdapter(
    I8Script.from({
      ...i8ScriptPadding,
      codeHash: scriptConfig.CODE_HASH,
      hashType: scriptConfig.HASH_TYPE,
      [cellDeps]: [dep],
    }),
  );
}

export function configAdapterFrom(config: Config): ConfigAdapter {
  const adaptedScriptConfig: { [id: string]: ScriptConfigAdapter } = {};
  for (const scriptName in config.SCRIPTS) {
    adaptedScriptConfig[scriptName] = scriptConfigAdapterFrom(
      config.SCRIPTS[scriptName]!,
    );
  }

  return new ConfigAdapter(config.PREFIX, adaptedScriptConfig);
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
      HASH_TYPE: s.HASH_TYPE,
    });
  }
  return JSON.stringify(
    { PREFIX: config.PREFIX, SCRIPTS: Object.freeze(scripts) },
    undefined,
    2,
  );
}
