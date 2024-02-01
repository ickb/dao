import { TransactionSkeletonType, sealTransaction } from "@ckb-lumos/helpers";
import { I8Script, witness } from "./cell";
import { encodeToAddress } from "@ckb-lumos/helpers";
import { randomBytes } from "crypto";
import { key } from "@ckb-lumos/hd";
import { hexify } from "@ckb-lumos/codec/lib/bytes";
import { defaultScript } from "./config";
import { Cell } from "@ckb-lumos/base";
import { scriptEq } from "./utils";
import { prepareSigningEntries } from "@ckb-lumos/common-scripts/lib/secp256k1_blake160";
import { addWitnessPlaceholder } from "./transaction";

export function secp256k1Blake160(privKey?: string) {
    const privateKey = privKey ?? newTestingPrivateKey();

    const publicKey = key.privateToPublic(privateKey);

    const lockScript = I8Script.from({
        ...defaultScript("SECP256K1_BLAKE160"),
        args: key.publicKeyToBlake160(publicKey),
        [witness]: "0x"
    });

    const address = encodeToAddress(lockScript);

    function expander(c: Cell) {
        if (!scriptEq(c.cellOutput.lock, lockScript)) {
            return undefined;
        }

        return lockScript
    }

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

export function newTestingPrivateKey(suppressLogging: boolean = false) {
    const privateKey = hexify(randomBytes(32));
    if (!suppressLogging) {
        console.log("New testing private key:", privateKey);
    }
    return privateKey;
}