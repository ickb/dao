import { type TransactionSkeletonType, TransactionSkeleton, sealTransaction } from "@ckb-lumos/helpers";
import { I8Cell, I8Script, witness } from "./cell.js";
import { encodeToAddress } from "@ckb-lumos/helpers";
import { key } from "@ckb-lumos/hd";
import { defaultScript } from "./config.js";
import { capacitySifter, hex, lockExpanderFrom } from "./utils.js";
import { prepareSigningEntries } from "@ckb-lumos/common-scripts/lib/secp256k1_blake160.js";
import { addCells, addWitnessPlaceholder } from "./transaction.js";
import { getCells, getFeeRate, sendTransaction } from "./rpc.js";
import { ckbFundAdapter, fund } from "./fund.js";

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

    async function transfer(
        to: I8Script,
        ckbAmount: bigint,
        feeRate?: bigint,
        secondsTimeout: number = 600 // non-positive number means do not await for transaction to be committed
    ) {
        const capacities = await getCapacities();

        const cell = I8Cell.from({
            capacity: hex(ckbAmount),
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

export const genesisDevnetKey = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";