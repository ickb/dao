import { sealTransaction } from "@ckb-lumos/helpers";
import type { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { I8Script, witness } from "./cell.js";
import { encodeToAddress } from "@ckb-lumos/helpers";
import { key } from "@ckb-lumos/hd";
import { defaultScript } from "./config.js";
import { lockExpanderFrom } from "./utils.js";
import { prepareSigningEntries } from "@ckb-lumos/common-scripts/lib/secp256k1_blake160.js";
import { addWitnessPlaceholder } from "./transaction.js";

export function secp256k1Blake160(privateKey: string) {
    const publicKey = key.privateToPublic(privateKey);

    const lockScript = I8Script.from({
        ...defaultScript("SECP256K1_BLAKE160"),
        args: key.publicKeyToBlake160(publicKey),
        [witness]: "0x"
    });

    const address = encodeToAddress(lockScript);

    const expander = lockExpanderFrom(lockScript);

    function preSigner(tx: TransactionSkeletonType) {
        return addWitnessPlaceholder(tx, lockScript);
    }

    function signer(tx: TransactionSkeletonType) {
        tx = prepareSigningEntries(tx);
        const message = tx.get("signingEntries").get(0)!.message;//How to improve in case of multiple locks?
        const sig = key.signRecoverable(message!, privateKey);

        return sealTransaction(tx, [sig]);
    }

    return {
        publicKey, lockScript, address,
        expander, preSigner, signer
    };
}