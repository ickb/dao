"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.secp256k1SignerFrom = void 0;
const common_scripts_1 = require("@ckb-lumos/common-scripts");
const helpers_1 = require("@ckb-lumos/helpers");
const hd_1 = require("@ckb-lumos/hd");
function secp256k1SignerFrom(PRIVATE_KEY) {
    return (transaction, accountLock) => {
        transaction = common_scripts_1.secp256k1Blake160.prepareSigningEntries(transaction);
        const message = transaction.get("signingEntries").get(0)?.message;
        const Sig = hd_1.key.signRecoverable(message, PRIVATE_KEY);
        const tx = (0, helpers_1.sealTransaction)(transaction, [Sig]);
        return Promise.resolve(tx);
    };
}
exports.secp256k1SignerFrom = secp256k1SignerFrom;
//# sourceMappingURL=secp256k1_signer.js.map