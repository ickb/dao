import { secp256k1Blake160 } from "@ckb-lumos/common-scripts";
import { TransactionSkeletonType, sealTransaction } from "@ckb-lumos/helpers";
import { I8Script, witness } from "./cell";
import { encodeToAddress } from "@ckb-lumos/helpers";
import { randomBytes } from "crypto";
import { key } from "@ckb-lumos/hd";
import { hexify } from "@ckb-lumos/codec/lib/bytes";
import { defaultScript } from "./config";
import { Cell } from "@ckb-lumos/base";
import { scriptEq } from "./utils";

export function secp256k1Blake160Expander(c: Cell, account: I8Secp256k1Blake160Account) {
    if (!scriptEq(c.cellOutput.lock, account.lockScript)) {
        return undefined;
    }

    return account.lockScript
}

export function secp256k1Blake160Signer(tx: TransactionSkeletonType, account: I8Secp256k1Blake160Account) {
    tx = secp256k1Blake160.prepareSigningEntries(tx);
    const message = tx.get("signingEntries").get(0)!.message;//How to improve in case of multiple locks?
    const sig = key.signRecoverable(message!, account[privateKeySymbol]);

    return sealTransaction(tx, [sig]);
}

const privateKeySymbol = Symbol("secret");

export class I8Secp256k1Blake160Account {
    readonly lockScript: I8Script;
    readonly address: string;
    readonly publicKey: string;
    readonly [privateKeySymbol]: string;

    constructor(privKey: string = hexify(randomBytes(32))) {
        this[privateKeySymbol] = privKey;
        this.publicKey = key.privateToPublic(privKey);
        const args = key.publicKeyToBlake160(this.publicKey);

        this.lockScript = I8Script.from({
            ...defaultScript("SECP256K1_BLAKE160"),
            args: args,
            [witness]: "0x"
        });

        this.address = encodeToAddress(this.lockScript);

        return Object.freeze(this);
    };
}