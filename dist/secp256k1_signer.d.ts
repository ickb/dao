import { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { Script, Transaction } from "@ckb-lumos/base";
export declare function secp256k1SignerFrom(PRIVATE_KEY: string): (transaction: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>;
