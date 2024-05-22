import { TransactionSkeleton } from "@ckb-lumos/helpers";
import type { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { isDao } from "./dao.js";

export const errorNoFundingMethods = "No funding method specified";
export const errorNotEnoughFunds = "Not enough funds to execute the transaction";
export const errorIncorrectChange = "Some assets are not balanced correctly between input and output";
export const errorTooManyOutputs = "A transaction using Nervos DAO script is currently limited to 64 output cells"
export function fund(
    tx: TransactionSkeletonType,
    assets: Assets,
    useAll: boolean = false
) {
    const addFunds: ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] = [];
    const addChanges: ((tx: TransactionSkeletonType) => TransactionSkeletonType | undefined)[] = [];

    let txWithChange: TransactionSkeletonType | undefined = undefined;

    if (!useAll) {
        //Assets is iterated in the reverse order, so that CKB is last to be funded
        for (const [name, { getDelta, addChange: ac, addFunds: af }] of [...Object.entries(assets)].reverse()) {
            txWithChange = undefined;
            addChanges.push(...[...Object.values(ac)].reverse());
            addFunds.push(...af);
            addFunds.push((tx: TransactionSkeletonType) => tx);
            let balanceEstimation = getDelta(txWithChange ?? tx);
            while (addFunds.length > 0) {
                const addFund = addFunds.pop()!;
                tx = addFund(tx);

                //Try a quick estimation of how many funds it would take to even out input and output balances
                balanceEstimation += getDelta(addFund(TransactionSkeleton()));
                if (balanceEstimation < 0n) {
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
        for (const [name, { addChange: aacc }] of [...Object.entries(assets)].reverse()) {
            for (const ac of [...Object.values(aacc)].reverse()) {
                txWithChange = ac(txWithChange ?? tx);
                if (!txWithChange) {
                    throw new NotEnoughFundsError(name);
                }
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


export type Assets = Readonly<{
    [name: string]: Readonly<{// All caps names like CKB, ICKB_UDT ...
        getDelta: (tx: TransactionSkeletonType) => bigint,
        addChange: Readonly<{ [name: string]: (tx: TransactionSkeletonType) => TransactionSkeletonType | undefined }>,
        addFunds: readonly ((tx: TransactionSkeletonType) => TransactionSkeletonType)[],
        estimatedAvailable: bigint,
        estimated: bigint,
    }>
}>;

export const errorDefaultAddChangeNotFound = "Default add change not found in first position";
export function addAsset(
    assets: Assets,
    name: string,// All caps names like CKB, ICKB_UDT ...
    getDelta: ((tx: TransactionSkeletonType) => bigint),
    addChange: Readonly<{ [name: string]: (tx: TransactionSkeletonType) => TransactionSkeletonType | undefined }>,
): Assets {
    const old = assets[name] ?? {};
    const oldAddChange = old.addChange ?? {};
    addChange = Object.freeze({ ...oldAddChange, ...addChange });

    //Check that default is correctly populated
    for (const k in addChange) {
        if (k !== "DEFAULT") {
            throw Error(errorDefaultAddChangeNotFound);
        }
        break;
    }

    return Object.freeze({
        ...assets,
        [name]: Object.freeze({
            getDelta,
            addChange,
            addFunds: old.addFunds ?? Object.freeze([]),
            estimatedAvailable: old.estimatedAvailable ?? 0n,
            estimated: old.estimated ?? 0n,
        })
    });
}

export const errorNonPositiveBalance = "Fund add zero or negative balance";
export function addAssetsFunds(
    assets: Assets,
    addFunds: readonly ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] | undefined,
    unavailableFunds?: readonly TransactionSkeletonType[]
): Assets {
    const mutableAssets = Object.fromEntries(Object.entries(assets)
        .map(([name, { getDelta, addChange, addFunds, estimatedAvailable, estimated }]) =>
            [name, { getDelta, addChange, addFunds: [...addFunds], estimatedAvailable, estimated }]));

    for (const tx of unavailableFunds ?? []) {
        for (const [name, { getDelta }] of Object.entries(mutableAssets)) {
            const delta = getDelta(tx);
            if (delta < 0n) {
                throw Error(errorNonPositiveBalance);
            }
            if (delta == 0n) {
                continue;
            }
            mutableAssets[name].estimated += delta;
        }
    }

    for (const addFund of addFunds ?? []) {
        const tx = addFund(TransactionSkeleton());
        let lastNonZeroName = "";
        for (const [name, { getDelta }] of Object.entries(mutableAssets)) {
            const delta = getDelta(tx);
            if (delta < 0n) {
                throw Error(errorNonPositiveBalance);
            }
            if (delta == 0n) {
                continue;
            }
            lastNonZeroName = name;
            mutableAssets[name].estimated += delta;
            mutableAssets[name].estimatedAvailable += delta;
        }
        if (lastNonZeroName !== "") {
            mutableAssets[lastNonZeroName].addFunds.push(addFund);
        } else {
            throw Error(errorNonPositiveBalance);
        }
    }

    return Object.freeze(Object.fromEntries(Object.entries(mutableAssets)
        .map(([name, { estimated, estimatedAvailable, addFunds, addChange, getDelta }]) =>
            [name, Object.freeze({
                getDelta,
                addChange,
                addFunds: Object.freeze(addFunds),
                estimatedAvailable,
                estimated
            })])));
}