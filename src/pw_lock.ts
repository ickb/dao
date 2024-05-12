import create from "keccak";
import { bytes } from "@ckb-lumos/codec";
import { blockchain } from "@ckb-lumos/base";
import { createTransactionFromSkeleton, encodeToAddress } from "@ckb-lumos/helpers";
import type { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { createP2PKHMessageGroup } from "@ckb-lumos/common-scripts";
import { I8Script, witness } from "./cell.js";
import { defaultScript } from "./config.js";
import { scriptEq, lockExpanderFrom } from "./utils.js";

export interface EthereumRpc {
    (payload: { method: 'personal_sign'; params: [string /*from*/, string /*message*/] }): Promise<string>;
}

export interface EthereumProvider {
    selectedAddress: string;
    isMetaMask?: boolean;
    enable: () => Promise<string[]>;
    addListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    removeEventListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    request: EthereumRpc;
}

export function getEthereumProvider() {
    // @ts-ignore
    return window.ethereum as EthereumProvider;
}

export function pwLock(provider?: EthereumProvider) {
    const lockScript = I8Script.from({
        ...defaultScript("PW_LOCK"),
        args: (provider ?? getEthereumProvider()).selectedAddress,
        [witness]: "0x" + "00".repeat(65)
    });

    const address = encodeToAddress(lockScript);

    const expander = lockExpanderFrom(lockScript);

    async function signer(transaction: TransactionSkeletonType, provider?: EthereumProvider) {
        // just like P2PKH: https://github.com/nervosnetwork/ckb-system-scripts/wiki/How-to-sign-transaction    
        const keccak = create.default("keccak256");

        const messageForSigning = createP2PKHMessageGroup(transaction, [lockScript], {
            hasher: {
                update: (message) => keccak.update(Buffer.from(new Uint8Array(message))),
                digest: () => keccak.digest(),
            },
        })[0];

        const ethereum = provider ?? getEthereumProvider();

        let signedMessage = await ethereum.request({
            method: "personal_sign",
            params: [ethereum.selectedAddress, messageForSigning.message],
        });

        let v = Number.parseInt(signedMessage.slice(-2), 16);
        if (v >= 27) v -= 27;
        signedMessage = "0x" + signedMessage.slice(2, -2) + v.toString(16).padStart(2, "0");

        const index = transaction.inputs.findIndex((c) => scriptEq(c.cellOutput.lock, lockScript));
        const unpackedWitness = blockchain.WitnessArgs.unpack(transaction.witnesses.get(index)!)
        const packedWitness = bytes.hexify(
            blockchain.WitnessArgs.pack({
                ...unpackedWitness,
                lock: signedMessage
            })
        );

        transaction = transaction.update("witnesses", (witnesses) => witnesses.set(index, packedWitness));

        return createTransactionFromSkeleton(transaction);
    }

    return {
        lockScript, address,
        expander, signer
    }
}

