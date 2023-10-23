import { TransactionBuilder } from "./domain_logic";
import { ScriptConfig } from "@ckb-lumos/config-manager/lib";
import { CellDep, HashType, Hexadecimal, Script } from "@ckb-lumos/base";
export { getConfig, initializeConfig } from "@ckb-lumos/config-manager/lib";
export declare function addressPrefix(): string;
export declare function scriptNames(): string[];
export declare function defaultScript(name: string): Script;
export declare function defaultCellDeps(name: string): CellDep;
export declare function secp256k1Blake160Config(): Promise<ScriptConfig>;
export declare function daoConfig(): Promise<ScriptConfig>;
export type ScriptData = {
    name: string;
    hexData: Hexadecimal;
    codeHash: Hexadecimal;
    hashType: HashType;
};
export declare function deploy(transactionBuilder: TransactionBuilder, scriptData: ScriptData[], newCellLock?: Script): Promise<string>;
export declare function createDepGroup(transactionBuilder: TransactionBuilder, names: string[], newCellLock?: Script): Promise<string>;
//# sourceMappingURL=config.d.ts.map