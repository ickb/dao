import { TransactionBuilder } from "./domain_logic";
import { ScriptConfig } from "@ckb-lumos/config-manager/lib";
import { HashType, Hexadecimal, Script } from "@ckb-lumos/base";
export declare function defaultSecp256k1Blake160Config(): Promise<ScriptConfig>;
export declare function defaultDaoConfig(): Promise<ScriptConfig>;
export type ScriptData = {
    name: string;
    hexData: Hexadecimal;
    codeHash: Hexadecimal;
    hashType: HashType;
};
export declare function deploy(transactionBuilder: TransactionBuilder, scriptData: ScriptData[], newCellLock?: Script): Promise<void>;
export declare function createDepGroup(transactionBuilder: TransactionBuilder, names: string[], newCellLock?: Script): Promise<string>;
