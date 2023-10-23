"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daoWithdrawAll = exports.fund = void 0;
const chain_adapter_1 = require("./chain_adapter");
const ckb_indexer_1 = require("@ckb-lumos/ckb-indexer");
const utils_1 = require("./utils");
const config_1 = require("./config");
async function fund(transactionBuilder) {
    const indexer = await (0, chain_adapter_1.getSyncedIndexer)();
    const collector = new ckb_indexer_1.CellCollector(indexer, {
        scriptSearchMode: "exact",
        withData: true,
        type: "empty",
        lock: transactionBuilder.getAccountLock()
    });
    for await (const cell of collector.collect()) {
        if (cell.data !== "0x") {
            continue;
        }
        transactionBuilder.add("input", "end", cell);
        try {
            transactionBuilder.toTransactionSkeleton();
        }
        catch {
            continue;
        }
        return transactionBuilder;
    }
    throw Error("Not enough funds to cover the output cells occupied capacity");
}
exports.fund = fund;
async function daoWithdrawAll(transactionBuilder) {
    const indexer = await (0, chain_adapter_1.getSyncedIndexer)();
    const collector = new ckb_indexer_1.CellCollector(indexer, {
        scriptSearchMode: "exact",
        withData: true,
        type: (0, config_1.defaultScript)("DAO"),
        lock: transactionBuilder.getAccountLock()
    });
    for await (const cell of collector.collect()) {
        if (cell.data === utils_1.DAO_DEPOSIT_DATA) {
            continue;
        }
        transactionBuilder.add("input", "end", cell);
    }
    return transactionBuilder;
}
exports.daoWithdrawAll = daoWithdrawAll;
//# sourceMappingURL=actions.js.map