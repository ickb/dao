import { secp256k1Blake160 } from "@ckb-lumos/common-scripts";
import { TransactionSkeletonType, sealTransaction } from "@ckb-lumos/helpers";
import { key } from "@ckb-lumos/hd";
import { Script, Transaction } from "@ckb-lumos/base";

export function secp256k1SignerFrom(PRIVATE_KEY: string) {
    return (transaction: TransactionSkeletonType, accountLock: Script): Promise<Transaction> => {
        transaction = secp256k1Blake160.prepareSigningEntries(transaction);
        const message = transaction.get("signingEntries").get(0)?.message;
        const Sig = key.signRecoverable(message!, PRIVATE_KEY);
        const tx = sealTransaction(transaction, [Sig]);

        return Promise.resolve(tx);
    }
}