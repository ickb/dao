import { getRpc, getSyncedIndexer } from "./chain_adapter";
import { TransactionBuilder } from "./domain_logic";
import { CellCollector } from "@ckb-lumos/ckb-indexer";
import { DAO_DEPOSIT_DATA, epochCompare, parseEpoch } from "./utils";
import { defaultScript } from "./config";
import { Header } from "@ckb-lumos/base";

export async function fund(transactionBuilder: TransactionBuilder, addAll: boolean = false, tipHeader?: Header): Promise<TransactionBuilder> {
    tipHeader = tipHeader ?? await getRpc().getTipHeader();
    const is_well_funded = addAll ? async () => false : async () => {
        try {
            await transactionBuilder.toTransactionSkeleton()
            return true;
        } catch (e: any) {
            //Improve error typing or define this function on builder itself/////////////////////////////////////////
            if (e.message === "Missing CKB: not enough funds to execute the transaction") {
                return false;
            }
            throw e;
        }
    }

    if (await is_well_funded()) {
        return transactionBuilder;
    }

    const indexer = await getSyncedIndexer();

    //Try adding dao withdrawal requests
    const tipEpoch = parseEpoch((await getRpc().getTipHeader()).epoch);
    for await (const cell of new CellCollector(indexer, {
        scriptSearchMode: "exact",
        withData: true,
        type: defaultScript("DAO"),
        lock: transactionBuilder.getAccountLock()
    }).collect()) {
        if (cell.data === DAO_DEPOSIT_DATA) {
            continue;//Not a withdrawal request
        }

        const maturityEpoch = parseEpoch(await transactionBuilder.withdrawedDaoSince(cell));
        if (epochCompare(maturityEpoch, tipEpoch) === 1) {
            continue;//Not yet ripe
        }

        transactionBuilder.add("input", "end", cell);

        if (await is_well_funded()) {
            return transactionBuilder;
        }
    }

    //Try adding capacity cells
    for await (const cell of new CellCollector(indexer, {
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

    await transactionBuilder.toTransactionSkeleton();//Bubble up error
    return transactionBuilder;//Not gonna execute
}