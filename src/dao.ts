import { Cell, Hexadecimal, PackedSince } from "@ckb-lumos/base";
import { BI, BIish } from "@ckb-lumos/bi";
import { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { defaultScript } from "./config";
import { hexify } from "@ckb-lumos/codec/lib/bytes";
import { Uint64 } from "@ckb-lumos/codec/lib/number/uint";
import { EpochSinceValue, generateHeaderEpoch, parseAbsoluteEpochSince } from "@ckb-lumos/base/lib/since";
import {
    calculateDaoEarliestSinceCompatible, calculateMaximumWithdrawCompatible
} from "@ckb-lumos/common-scripts/lib/dao";
import {
    epochSinceAdd, epochSinceCompare, I8Cell, I8Script,
    I8Header, scriptEq, cellDeps, headerDeps, since, witness
} from "./cell";
import { addCells, addHeaderDeps, calculateFee, txSize } from "./transaction";

export const errorUndefinedBlockNumber = "Encountered an input cell with blockNumber undefined";
export function daoSifter(
    inputs: Iterable<Cell>,
    getHeader: (blockNumber: string, context: Cell) => I8Header) {
    const deposits: I8Cell[] = [];
    const withdrawalRequests: I8Cell[] = [];
    const unknowns: Cell[] = [];

    const deps = defaultScript("DAO")[cellDeps];
    const extendCell = (c: Cell, header: I8Header, previousHeader?: I8Header, packedSince?: PackedSince) =>
        I8Cell.from({
            ...c,
            blockHash: header.hash,
            type: I8Script.from({
                ...c.cellOutput.type!,
                [cellDeps]: deps,
                [headerDeps]: Object.freeze(previousHeader ? [header, previousHeader] : [header]),
                [since]: packedSince
            })
        });

    for (const c of inputs) {
        if (!isDao(c)) {
            unknowns.push(c);
            continue;
        }

        if (!c.blockNumber) {
            throw Error(errorUndefinedBlockNumber);
        }

        const h = getHeader(c.blockNumber!, c);
        if (c.data === DEPOSIT_DATA) {
            deposits.push(extendCell(c, h));
        } else {
            const h1 = getHeader(Uint64.unpack(c.data).toHexString(), c);
            const since = calculateDaoEarliestSinceCompatible(h1.epoch, h.epoch).toString();
            withdrawalRequests.push(extendCell(c, h, h1, since));
        }
    }

    return { deposits, withdrawalRequests, unknowns };
}

export const DEPOSIT_DATA = "0x0000000000000000";

export function isDao(c: Cell) {
    return scriptEq(c.cellOutput.type, defaultScript("DAO"));
}

export function isDaoDeposit(c: Cell) {
    return isDao(c) && c.data === DEPOSIT_DATA;
}

export function isDaoWithdrawal(c: Cell) {
    return isDao(c) && c.data !== DEPOSIT_DATA;
}

export function deposit(tx: TransactionSkeletonType, accountLock: I8Script, capacities: Iterable<BI>) {
    const baseDeposit = I8Cell.from({
        lock: accountLock,
        type: defaultScript("DAO"),
        data: DEPOSIT_DATA,
    });

    const deposits: I8Cell[] = [];
    for (const capacity of capacities) {
        deposits.push(I8Cell.from({ ...baseDeposit, capacity: capacity.toHexString() }));
    }

    return addCells(tx, "append", [], deposits);
}

export const errorDifferentSizeLock = "Withdrawal request lock has different size";
export function requestWithdrawalFrom(tx: TransactionSkeletonType, deposits: Iterable<I8Cell>, accountLock: I8Script) {

    const withdrawalRequests: I8Cell[] = [];
    for (const d of deposits) {
        if (d.cellOutput.lock.args.length != accountLock.args.length) {
            throw Error(errorDifferentSizeLock);
        }

        withdrawalRequests.push(I8Cell.from({
            cellOutput: d.cellOutput,
            data: hexify(Uint64.pack(BI.from(d.blockNumber!))),
        }));
    }

    return addCells(tx, "matched", deposits, withdrawalRequests);
}

export function withdrawFrom(tx: TransactionSkeletonType, withdrawalRequests: Iterable<I8Cell>) {
    const headerHashes: Hexadecimal[] = [];
    for (let r of withdrawalRequests) {
        headerHashes.push(...r.cellOutput.type![headerDeps].map(h => h.hash));
    }
    tx = addHeaderDeps(tx, ...headerHashes);

    const processedRequests: I8Cell[] = [];
    const header2index = new Map(tx.headerDeps.map((h, i) => [h, i]));
    for (const r of withdrawalRequests) {
        const depositHeader = r.cellOutput.type![headerDeps][-1]!;
        processedRequests.push(I8Cell.from({
            ...r,
            type: I8Script.from({
                ...r.cellOutput.type!,
                [witness]: hexify(Uint64.pack(header2index.get(depositHeader.hash)!))
            })
        }));
    }

    return addCells(tx, "append", processedRequests, []);
}

export const errorNotEnoughFunds = "Not enough funds to execute the transaction";
export function fund(
    tx: TransactionSkeletonType,
    accountLock: I8Script,
    feeRate: BIish,
    addPlaceholders: (tx: TransactionSkeletonType) => TransactionSkeletonType,
    capacities: Iterable<I8Cell>,
    withdrawalRequests: Iterable<I8Cell> = []) {

    const txWithPlaceholders = addPlaceholders(tx);
    if (ckbDelta(txWithPlaceholders, feeRate).eq(0)) {
        return txWithPlaceholders;
    }

    function* funder() {
        yield (tx: TransactionSkeletonType) => tx;

        for (const wr of withdrawalRequests) {
            yield (tx: TransactionSkeletonType) => withdrawFrom(tx, [wr]);
        }
        for (const c of capacities) {
            yield (tx: TransactionSkeletonType) => addCells(tx, "append", [c], []);
        }
    }

    let changeCell = I8Cell.from({ lock: accountLock });
    for (const addFunds of funder()) {
        //Add funding cells
        tx = addFunds(tx);

        const txWithPlaceholders = addPlaceholders(addCells(tx, "append", [], [changeCell]));
        const delta = ckbDelta(txWithPlaceholders, feeRate);
        if (delta.gte(0)) {
            changeCell = I8Cell.from({
                ...changeCell,
                capacity: delta.add(changeCell.cellOutput.capacity).toHexString()
            });
            break;
        }
    }

    tx = addPlaceholders(addCells(tx, "append", [], [changeCell]));
    if (ckbDelta(tx, feeRate).eq(0)) {
        return tx;
    }

    throw Error(errorNotEnoughFunds);
}

export function ckbDelta(tx: TransactionSkeletonType, feeRate: BIish) {
    let ckbDelta = BI.from(0);
    for (const c of tx.inputs) {
        //Second Withdrawal step from NervosDAO
        if (isDaoWithdrawal(c)) {
            const withdrawalRequest = c as I8Cell;
            const [withdrawalHeader, depositHeader] = withdrawalRequest.cellOutput.type![headerDeps];
            const maxWithdrawable = calculateMaximumWithdrawCompatible(c, depositHeader.dao, withdrawalHeader.dao);
            ckbDelta = ckbDelta.add(maxWithdrawable);
        } else {
            ckbDelta = ckbDelta.add(c.cellOutput.capacity);
        }
    }

    tx.outputs.forEach((c) => ckbDelta = ckbDelta.sub(c.cellOutput.capacity));

    if (BI.from(feeRate).gt(0)) {
        ckbDelta = ckbDelta.sub(calculateFee(txSize(tx), feeRate));
    }

    return ckbDelta;
}

export function requestWithdrawalWith(
    tx: TransactionSkeletonType,
    accountLock: I8Script,
    deposits: Iterable<I8Cell>,
    maxWithdrawalAmount: BI,
    tipEpoch: EpochSinceValue,
    minLock: EpochSinceValue = { length: 8, index: 1, number: 0 },// 1/8 epoch (~ 30 minutes)
    maxLock: EpochSinceValue = { length: 4, index: 1, number: 0 }// 1/4 epoch (~ 1 hour)
) {
    //Let's fast forward the tip header of minLock epoch to avoid withdrawals having to wait one more month
    const withdrawalRequestEpoch = epochSinceAdd(tipEpoch, minLock);
    const maxWithdrawalEpoch = epochSinceAdd(tipEpoch, maxLock);

    //Filter deposits as requested and sort by minimum withdrawal epoch
    const filteredDeposits = Array.from(deposits).filter(d => maxWithdrawalAmount.gte(d.cellOutput.capacity))
        .map(d => Object.freeze({ cell: d, withdrawalEpoch: withdrawalEpoch(d, withdrawalRequestEpoch) }))
        .filter(d => epochSinceCompare(d.withdrawalEpoch, maxWithdrawalEpoch) <= 0)
        .sort((a, b) => epochSinceCompare(a.withdrawalEpoch, b.withdrawalEpoch))
        .map(d => d.cell);

    //It does NOT attempt to solve the Knapsack problem, it just withdraw the earliest deposits under budget
    let withdrawalAmount = BI.from(0);
    const optimalDeposits: I8Cell[] = []
    for (const d of filteredDeposits) {
        const newWithdrawalAmount = withdrawalAmount.add(d.cellOutput.capacity);
        if (maxWithdrawalAmount.lte(newWithdrawalAmount)) {
            withdrawalAmount = newWithdrawalAmount;
            optimalDeposits.push(d);
        } else {
            break;
        }
    }

    if (optimalDeposits.length > 0) {
        tx = requestWithdrawalFrom(tx, optimalDeposits, accountLock);
    }

    return tx;
}

export const errorTooManyOutputs = "A transaction containing Nervos DAO script is currently limited to 64 output cells"
export const errorIOBalancing = "The transaction doesn't correctly even out input and output capacities";
export const errorLateWithdrawal = "The transaction includes some deposits" +
    "whose minimum withdrawal epoch is after the maxLock epoch";
export function daoPreSendChecks(
    tx: TransactionSkeletonType,
    feeRate: BIish,
    tipEpoch: EpochSinceValue,
    minLock: EpochSinceValue = { length: 16, index: 1, number: 0 },// 1/16 epoch (~ 15 minutes)
    maxLock: EpochSinceValue = { length: 8, index: 3, number: 0 }// 3/8 (~ 90 minutes)
) {
    if ([...tx.inputs, ...tx.outputs].some(c => isDao(c)) && tx.outputs.size > 64) {
        throw Error(errorTooManyOutputs);
    }

    if (!ckbDelta(tx, feeRate).eq(0)) {
        throw Error(errorIOBalancing);
    }

    //Let's fast forward the tip header of minLock epoch to avoid withdrawals having to wait one more month
    const withdrawalRequestEpoch = epochSinceAdd(tipEpoch, minLock);
    const maxWithdrawalEpoch = epochSinceAdd(tipEpoch, maxLock);

    tx.inputs.filter(isDaoWithdrawal)
        .map(d => Object.freeze({ cell: d, withdrawalEpoch: withdrawalEpoch(d as I8Cell, withdrawalRequestEpoch) }))
        .filter(d => epochSinceCompare(d.withdrawalEpoch, maxWithdrawalEpoch) === 1)
        .forEach(_ => { throw Error(errorLateWithdrawal); })

    return tx;
}

export function withdrawalEpoch(deposit: I8Cell, withdrawalRequestEpoch: EpochSinceValue) {
    //Let's fast forward the tip header of slack epoch to avoid withdrawals having to wait one more month
    const withdrawalRequestEpochString = generateHeaderEpoch(withdrawalRequestEpoch);
    const depositEpoch = deposit.cellOutput.type![headerDeps][0]!.epoch;
    return parseAbsoluteEpochSince(
        calculateDaoEarliestSinceCompatible(depositEpoch, withdrawalRequestEpochString).toHexString()
    );
}