"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fund = void 0;
const chain_adapter_1 = require("./chain_adapter");
const ckb_indexer_1 = require("@ckb-lumos/ckb-indexer");
const utils_1 = require("./utils");
const config_1 = require("./config");
async function fund(transactionBuilder) {
    const is_well_funded = async function () {
        try {
            await transactionBuilder.toTransactionSkeleton();
            return true;
        }
        catch (e) {
            //Improve error typing or define this function on builder itself/////////////////////////////////////////
            if (e.message === "Missing CKB: not enough funds to execute the transaction") {
                return false;
            }
            throw e;
        }
    };
    if (await is_well_funded()) {
        return transactionBuilder;
    }
    const indexer = await (0, chain_adapter_1.getSyncedIndexer)();
    //Try adding dao withdrawal requests
    const tipEpoch = (0, utils_1.parseEpoch)((await (0, chain_adapter_1.getRpc)().getTipHeader()).epoch);
    for await (const cell of new ckb_indexer_1.CellCollector(indexer, {
        scriptSearchMode: "exact",
        withData: true,
        type: (0, config_1.defaultScript)("DAO"),
        lock: transactionBuilder.getAccountLock()
    }).collect()) {
        if (cell.data === utils_1.DAO_DEPOSIT_DATA) {
            continue; //Not a withdrawal request
        }
        const maturityEpoch = (0, utils_1.parseEpoch)(await transactionBuilder.withdrawedDaoSince(cell));
        if ((0, utils_1.epochCompare)(maturityEpoch, tipEpoch) === 1) {
            continue; //Not yet ripe
        }
        transactionBuilder.add("input", "end", cell);
        if (await is_well_funded()) {
            return transactionBuilder;
        }
    }
    //Try adding capacity cells
    for await (const cell of new ckb_indexer_1.CellCollector(indexer, {
        scriptSearchMode: "exact",
        withData: true,
        type: "empty",
        lock: transactionBuilder.getAccountLock()
    }).collect()) {
        if (cell.data !== "0x") {
            continue;
        }
        transactionBuilder.add("input", "end", cell);
        if (await is_well_funded()) {
            return transactionBuilder;
        }
    }
    await transactionBuilder.toTransactionSkeleton(); //Bubble up error
    return transactionBuilder; //Not gonna execute
}
exports.fund = fund;
//# sourceMappingURL=actions.js.map