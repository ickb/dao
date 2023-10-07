import { getSyncedIndexer } from "./rpc";
import { TransactionBuilder } from "./domain_logic";
import { CellCollector } from "@ckb-lumos/ckb-indexer";
import { DAO_DEPOSIT_DATA, defaultScript } from "./utils";

export async function fund(transactionBuilder: TransactionBuilder) {
    const indexer = await getSyncedIndexer();

    const collector = new CellCollector(indexer, {
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
            transactionBuilder.toTransactionSkeleton()
        } catch {
            continue;
        }
        return transactionBuilder;
    }

    throw Error("Not enough funds to cover the output cells occupied capacity");
}

export async function daoWithdrawAll(transactionBuilder: TransactionBuilder) {
    const indexer = await getSyncedIndexer();

    const collector = new CellCollector(indexer, {
        scriptSearchMode: "exact",
        withData: true,
        type: defaultScript("DAO"),
        lock: transactionBuilder.getAccountLock()
    });

    for await (const cell of collector.collect()) {
        if (cell.data === DAO_DEPOSIT_DATA) {
            continue;
        }

        transactionBuilder.add("input", "end", cell);
    }

    return transactionBuilder;
}