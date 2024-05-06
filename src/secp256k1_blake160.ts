import { TransactionSkeleton, sealTransaction } from "@ckb-lumos/helpers";
import type { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { I8Cell, I8Script, witness } from "./cell.js";
import { encodeToAddress } from "@ckb-lumos/helpers";
import { randomBytes } from "crypto";
import { key } from "@ckb-lumos/hd";
import { hexify } from "@ckb-lumos/codec/lib/bytes.js";
import { defaultScript } from "./config.js";
import type { Cell } from "@ckb-lumos/base";
import { capacitySifter, scriptEq } from "./utils.js";
import { prepareSigningEntries } from "@ckb-lumos/common-scripts/lib/secp256k1_blake160.js";
import { addCells, addWitnessPlaceholder } from "./transaction.js";
import { BI } from "@ckb-lumos/bi";
import { getCells, getFeeRate, sendTransaction } from "./rpc.js";
import { ckbFundAdapter, fund } from "./fund.js";

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

    async function transfer(
        to: I8Script,
        ckbAmount: BI,
        feeRate?: BI,
        secondsTimeout: number = 600 // non-positive number means do not await for transaction to be committed
    ) {
        const capacities = await getCapacities();

        const cell = I8Cell.from({
            capacity: ckbAmount.toHexString(),
            lock: to,
        });

        let tx = TransactionSkeleton();
        tx = addCells(tx, "append", [], [cell]);
        tx = fund(tx, ckbFundAdapter(lockScript, feeRate ?? await getFeeRate(), preSigner, capacities));
        return sendTransaction(signer(tx), secondsTimeout);
    }

    async function getCapacities() {
        const { capacities } = capacitySifter(
            await getCells({
                script: lockScript,
                scriptType: "lock",
                filter: {
                    scriptLenRange: ["0x0", "0x1"],
                    outputDataLenRange: ["0x0", "0x1"],
                },
                scriptSearchMode: "exact"
            }),
            expander
        );
        return capacities;
    }

    return {
        publicKey, lockScript, address,
        expander, preSigner, signer,
        transfer, getCapacities
    };
}

export function newTestingPrivateKey(suppressLogging: boolean = false) {
    const privateKey = hexify(randomBytes(32));
    if (!suppressLogging) {
        console.log("New testing private key:", privateKey);
    }
    return privateKey;
}

export const genesisDevnetKey = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";