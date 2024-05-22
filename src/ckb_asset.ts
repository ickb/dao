import { parseAbsoluteEpochSince, parseEpoch } from "@ckb-lumos/base/lib/since.js";
import { I8Cell, I8Header, I8Script, since } from "./cell.js";
import { TransactionSkeleton } from "@ckb-lumos/helpers";
import type { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { ckbDelta, daoWithdrawFrom } from "./dao.js";
import { addCells } from "./transaction.js";
import { epochSinceCompare, hex, logSplit } from "./utils.js";
import { addAsset, addAssetsFunds } from "./fund.js";
import type { Assets } from "./fund.js";

export const ckbMark = "CKB";

export function addCkbAsset(
    assets: Assets,
    accountLock: I8Script,
    feeRate: bigint,
    addPlaceholders: (tx: TransactionSkeletonType) => TransactionSkeletonType,
    minChange: bigint = 0n
) {
    const getDelta = (tx: TransactionSkeletonType) => ckbDelta(tx, feeRate);

    return addAsset(assets, ckbMark, getDelta, {
        DEFAULT: (tx: TransactionSkeletonType) => {
            if (tx.equals(TransactionSkeleton())) {
                return tx;
            }

            let changeCell = I8Cell.from({ lock: accountLock });
            const txWithPlaceholders = addPlaceholders(addCells(tx, "append", [], [changeCell]));
            const delta = getDelta(txWithPlaceholders);
            const capacity = delta + BigInt(changeCell.cellOutput.capacity);
            if (delta < 0n || capacity < minChange) {
                return undefined;
            }

            changeCell = I8Cell.from({
                ...changeCell,
                capacity: hex(capacity)
            });
            return addPlaceholders(addCells(tx, "append", [], [changeCell]));
        }
    });
}

export function addWithdrawalRequests(assets: Assets, withdrawalRequests: readonly I8Cell[], tipHeader: I8Header) {
    const addFunds: ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] = [];
    const unavailableWithdrawalRequests: I8Cell[] = [];

    const tipEpoch = parseEpoch(tipHeader.epoch);
    const availableWithdrawalRequests: I8Cell[] = [];
    for (const wr of withdrawalRequests) {
        const withdrawalEpoch = parseAbsoluteEpochSince(wr.cellOutput.type![since]);
        if (epochSinceCompare(tipEpoch, withdrawalEpoch) === -1) {
            unavailableWithdrawalRequests.push(wr);
            continue;
        }
        availableWithdrawalRequests.push(wr);
    }
    for (const wwrr of logSplit(availableWithdrawalRequests)) {
        addFunds.push((tx: TransactionSkeletonType) => daoWithdrawFrom(tx, wwrr));
    }

    const unavailableFunds = [TransactionSkeleton().update("inputs", i => i.push(...unavailableWithdrawalRequests))];

    return addAssetsFunds(assets, addFunds, unavailableFunds);
}