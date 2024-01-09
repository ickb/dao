import { secp256k1Blake160 } from "@ckb-lumos/common-scripts";
import { TransactionSkeletonType, sealTransaction } from "@ckb-lumos/helpers";
import { I8Cell, I8Script, scriptEq, scriptIs } from "./cell";
import { encodeToAddress } from "@ckb-lumos/helpers";
import { randomBytes } from "crypto";
import { key } from "@ckb-lumos/hd";
import { hexify } from "@ckb-lumos/codec/lib/bytes";
import { defaultScript } from "./config";
import { Cell, blockchain } from "@ckb-lumos/base";
import { WitnessArgs } from "@ckb-lumos/base/lib/blockchain";
import { List } from "immutable";

export function secp256k1Sifter(inputs: Iterable<Cell>, account: I8Secp256k1Account) {
    const owned: I8Cell[] = [];
    const unknowns: Cell[] = [];

    for (const c of inputs) {
        if (!scriptEq(c.cellOutput.lock, account.lockScript)) {
            unknowns.push(c);
            continue;
        }

        owned.push(I8Cell.from({ ...c, lock: account.lockScript }));
    }

    return { owned, unknowns };
}

const witnessPadding = hexify(blockchain.WitnessArgs.pack({ lock: "0x" }));
export function secp256k1WitnessPlaceholder(tx: TransactionSkeletonType) {
    const seenArgs = new Set<string>();
    const witnesses: string[] = [];
    const witnessesLength = [
        tx.inputs.size,
        tx.outputs.size
    ].reduce((a, b) => a > b ? a : b);
    for (let i = 0; i < witnessesLength; i++) {
        const packedWitness = tx.witnesses.get(i, witnessPadding)
        const lock = tx.inputs.get(i)?.cellOutput.lock;

        if (!lock || !scriptIs(lock, "SECP256K1_BLAKE160") || seenArgs.has(lock.args)) {
            witnesses.push(packedWitness);
            continue;
        }

        seenArgs.add(lock.args);
        const unpackedWitness = WitnessArgs.unpack(packedWitness);
        unpackedWitness.lock = "0x" + "00".repeat(65);
        witnesses.push(hexify(WitnessArgs.pack(unpackedWitness)));
    }

    //Trim padding at the end
    while (witnesses[-1] === witnessPadding) {
        witnesses.pop();
    }

    return tx.set("witnesses", List(witnesses));
}

export function secp256k1Signer(tx: TransactionSkeletonType, account: I8Secp256k1Account) {
    tx = secp256k1Blake160.prepareSigningEntries(tx);
    const message = tx.get("signingEntries").get(0)!.message;//How to improve in case of multiple locks?
    const sig = key.signRecoverable(message!, account[privateKeySymbol]);

    return sealTransaction(tx, [sig]);
}

const privateKeySymbol = Symbol("secret");

export class I8Secp256k1Account {
    readonly lockScript: I8Script;
    readonly address: string;
    readonly publicKey: string;
    readonly [privateKeySymbol]: string;

    constructor(privKey: string = hexify(randomBytes(32))) {
        this[privateKeySymbol] = privKey;
        this.publicKey = key.privateToPublic(privKey);
        const args = key.publicKeyToBlake160(this.publicKey);

        this.lockScript = I8Script.from({ ...defaultScript("SECP256K1_BLAKE160"), args: args });

        this.address = encodeToAddress(this.lockScript);

        return Object.freeze(this);
    };
}