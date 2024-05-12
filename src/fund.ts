import { parseAbsoluteEpochSince, parseEpoch } from "@ckb-lumos/base/lib/since.js";
import { I8Cell, I8Header, I8Script, since } from "./cell.js";
import { TransactionSkeleton, type TransactionSkeletonType } from "@ckb-lumos/helpers";
import { ckbDelta, daoWithdrawFrom, isDao } from "./dao.js";
import { addCells } from "./transaction.js";
import { epochSinceCompare, hex, logSplit } from "./utils.js";

export const errorNoFundingMethods = "No funding method specified";
export const errorNotEnoughFunds = "Not enough funds to execute the transaction";
export const errorIncorrectChange = "Some assets are not balanced correctly between input and output";
export const errorTooManyOutputs = "A transaction using Nervos DAO script is currently limited to 64 output cells"
export const errorUnknownAsset = "Unknown asset name found in minChanges"
export function fund(
    tx: TransactionSkeletonType,
    assets: Assets,
    useAll: boolean = false,
    minChanges: Readonly<{ [name: string]: bigint }> = {}
) {
    for (const name of Object.keys(minChanges)) {
        if (!assets[name]) {
            throw Error(errorUnknownAsset);
        }
    }

    const addFunds: ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] = [];
    const addChanges: ((tx: TransactionSkeletonType) => TransactionSkeletonType | undefined)[] = [];

    let txWithChange: TransactionSkeletonType | undefined = undefined;

    if (!useAll) {
        //Assets is iterated in the reverse order, so that CKB is last to be funded
        for (const [name, { getDelta, addChange: ac, addFunds: af }] of [...Object.entries(assets)].reverse()) {
            txWithChange = undefined;
            const minChange = minChanges[name] ?? 0n;
            addChanges.push((tx: TransactionSkeletonType) => ac(tx, minChange));
            addFunds.push(...af);
            addFunds.push((tx: TransactionSkeletonType) => tx);
            let balanceEstimation = getDelta(txWithChange ?? tx);
            while (addFunds.length > 0) {
                const addFund = addFunds.pop()!;
                tx = addFund(tx);

                //Try a quick estimation of how many funds it would take to even out input and output balances
                balanceEstimation += getDelta(addFund(TransactionSkeleton()));
                if (balanceEstimation < minChange) {
                    continue;
                }

                //Use the slow but 100% accurate method to check that enough funds has been added to input
                txWithChange = tx;
                for (const ac of addChanges) {
                    txWithChange = ac(txWithChange);
                    if (!txWithChange) {
                        break;
                    }
                }
                if (txWithChange) {
                    break;
                }
            }

            if (!txWithChange) {
                throw new NotEnoughFundsError(name);
            }
        }
    } else {
        //Use all funds to fund the current transaction
        for (const [_, { addFunds }] of Object.entries(assets)) {
            for (const addFund of addFunds) {
                tx = addFund(tx);
            }
        }
        //Use the slow but 100% accurate method to check that enough funds has been added to input
        //Assets is iterated in the reverse order, so that CKB is last to be funded
        for (const [name, { addChange }] of [...Object.entries(assets)].reverse()) {
            txWithChange = addChange(txWithChange ?? tx, minChanges[name] ?? 0n);
            if (!txWithChange) {
                throw new NotEnoughFundsError(name);
            }
        }
    }

    if (!txWithChange) {
        throw Error(errorNoFundingMethods);
    }
    tx = txWithChange;

    //Double check that all assets are accounted for correctly
    for (const [_, { getDelta }] of Object.entries(assets)) {
        if (getDelta(tx) != 0n) {
            throw Error(errorIncorrectChange);
        }
    }

    if ([...tx.inputs, ...tx.outputs].some(isDao) && tx.outputs.size > 64) {
        throw Error(errorTooManyOutputs);
    }

    return tx;
}

export class NotEnoughFundsError extends Error {
    readonly missingAssetName: string;

    constructor(missingAssetName: string) {
        super(errorNotEnoughFunds);

        this.missingAssetName = missingAssetName;

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, NotEnoughFundsError.prototype);
    }
}

export function ckbFundAdapter(
    accountLock: I8Script,
    feeRate: bigint,
    addPlaceholders: (tx: TransactionSkeletonType) => TransactionSkeletonType,
    capacities: readonly I8Cell[],
    tipHeader?: I8Header,
    withdrawalRequests?: readonly I8Cell[],
) {
    const getDelta = (tx: TransactionSkeletonType) => ckbDelta(tx, feeRate);

    const addChange = (tx: TransactionSkeletonType, minChange: bigint) => {
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

    const addFunds: ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] = [];
    for (const cc of logSplit(capacities)) {
        addFunds.push((tx: TransactionSkeletonType) => addCells(tx, "append", cc, []));
    }

    const unavailableWithdrawalRequests: I8Cell[] = [];
    if (tipHeader && withdrawalRequests) {
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
    }

    const unavailableFunds = [TransactionSkeleton().update("inputs", i => i.push(...unavailableWithdrawalRequests))];

    return addAsset({}, "CKB", getDelta, addChange, addFunds, unavailableFunds);
}

export type Assets = Readonly<{
    [name: string]: Readonly<{// All caps names like CKB, ICKB_UDT ...
        getDelta: (tx: TransactionSkeletonType) => bigint
        addChange: (tx: TransactionSkeletonType, minChange: bigint) => TransactionSkeletonType | undefined
        addFunds: readonly ((tx: TransactionSkeletonType) => TransactionSkeletonType)[],
        availableBalance: bigint,
        balance: bigint,
    }>
}>;

export const errorDuplicatedAsset = "Asset already exists";
export function addAsset(
    assets: Assets,
    name: string,// All caps names like CKB, ICKB_UDT ...
    getDelta: (tx: TransactionSkeletonType) => bigint,
    addChange: (tx: TransactionSkeletonType, minChange: bigint) => TransactionSkeletonType | undefined,
    addFunds?: readonly ((tx: TransactionSkeletonType) => TransactionSkeletonType)[],
    unavailableFunds?: readonly TransactionSkeletonType[]
): Assets {
    if (assets[name]) {
        throw Error(errorDuplicatedAsset);
    }

    assets = Object.freeze({
        ...assets,
        [name]: Object.freeze({
            getDelta,
            addChange,
            addFunds: Object.freeze([]),
            availableBalance: 0n,
            balance: 0n,
        })
    });

    if (addFunds || unavailableFunds) {
        assets = addAssetsFunds(assets, addFunds, unavailableFunds);
    }

    return assets;
}

export const errorNonPositiveBalance = "Fund add zero or negative balance";
export function addAssetsFunds(
    assets: Assets,
    addFunds: readonly ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] | undefined,
    unavailableFunds?: readonly TransactionSkeletonType[]
): Assets {
    const mutableAssets = Object.fromEntries(Object.entries(assets)
        .map(([name, { getDelta, addChange, addFunds, availableBalance, balance }]) =>
            [name, { getDelta, addChange, addFunds: [...addFunds], availableBalance, balance }]));

    for (const tx of unavailableFunds ?? []) {
        for (const [name, { getDelta, balance }] of Object.entries(mutableAssets)) {
            const delta = getDelta(tx);
            if (delta < 0n) {
                throw Error(errorNonPositiveBalance);
            }
            if (delta == 0n) {
                continue;
            }
            mutableAssets[name].balance += delta;
        }
    }

    for (const addFund of addFunds ?? []) {
        const tx = addFund(TransactionSkeleton());
        let lastNonZeroName = "";
        for (const [name, { getDelta, availableBalance, balance }] of Object.entries(mutableAssets)) {
            const delta = getDelta(tx);
            if (delta < 0n) {
                throw Error(errorNonPositiveBalance);
            }
            if (delta == 0n) {
                continue;
            }
            lastNonZeroName = name;
            mutableAssets[name].balance += delta;
            mutableAssets[name].availableBalance += delta;
        }
        if (lastNonZeroName !== "") {
            mutableAssets[lastNonZeroName].addFunds.push(addFund);
        } else {
            throw Error(errorNonPositiveBalance);
        }
    }

    return Object.freeze(Object.fromEntries(Object.entries(mutableAssets)
        .map(([name, { balance, availableBalance, addFunds, addChange, getDelta }]) =>
            [name, Object.freeze({
                getDelta,
                addChange,
                addFunds: Object.freeze(addFunds),
                availableBalance,
                balance
            })])));
}