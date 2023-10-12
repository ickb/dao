"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signer = exports.getEthereumProvider = void 0;
const keccak_1 = __importDefault(require("keccak"));
const codec_1 = require("@ckb-lumos/codec");
const base_1 = require("@ckb-lumos/base");
const helpers_1 = require("@ckb-lumos/helpers");
const common_scripts_1 = require("@ckb-lumos/common-scripts");
const utils_1 = require("./utils");
function getEthereumProvider() {
    // @ts-ignore
    return window.ethereum;
}
exports.getEthereumProvider = getEthereumProvider;
async function signer(transaction, accountLock) {
    // just like P2PKH: https://github.com/nervosnetwork/ckb-system-scripts/wiki/How-to-sign-transaction
    const keccak = (0, keccak_1.default)("keccak256");
    const messageForSigning = (0, common_scripts_1.createP2PKHMessageGroup)(transaction, [accountLock], {
        hasher: {
            update: (message) => keccak.update(Buffer.from(new Uint8Array(message))),
            digest: () => keccak.digest(),
        },
    })[0];
    const ethereum = getEthereumProvider();
    let signedMessage = await ethereum.request({
        method: "personal_sign",
        params: [ethereum.selectedAddress, messageForSigning.message],
    });
    let v = Number.parseInt(signedMessage.slice(-2), 16);
    if (v >= 27)
        v -= 27;
    signedMessage = "0x" + signedMessage.slice(2, -2) + v.toString(16).padStart(2, "0");
    const index = transaction.inputs.findIndex((c) => (0, utils_1.scriptEq)(c.cellOutput.lock, accountLock));
    const unpackedWitness = base_1.blockchain.WitnessArgs.unpack(transaction.witnesses.get(index));
    const packedWitness = codec_1.bytes.hexify(base_1.blockchain.WitnessArgs.pack({
        ...unpackedWitness,
        lock: signedMessage
    }));
    transaction = transaction.update("witnesses", (witnesses) => witnesses.set(index, packedWitness));
    return (0, helpers_1.createTransactionFromSkeleton)(transaction);
}
exports.signer = signer;
//# sourceMappingURL=pwlock_signer.js.map