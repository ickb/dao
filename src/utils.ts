import { Script, Cell } from "@ckb-lumos/base";
import { BI } from "@ckb-lumos/bi";
import { defaultScript } from "./config";
import { EpochSinceValue } from "@ckb-lumos/base/lib/since";
import { I8Cell, I8Script } from "./cell";

export function capacitySifter(
    inputs: readonly Cell[],
    accountLockExpander: (c: Cell) => I8Script | undefined
) {
    const capacities: I8Cell[] = [];
    const notCapacities: Cell[] = [];

    for (const c of inputs) {
        if (c.cellOutput.type !== undefined || c.data !== "0x") {
            notCapacities.push(c);
            continue;
        }

        const lock = accountLockExpander(c);
        if (!lock) {
            notCapacities.push(c);
            continue;
        }

        capacities.push(I8Cell.from({
            ...c,
            cellOutput: {
                lock,
                capacity: c.cellOutput.capacity
            }
        }));
    }

    return { capacities, notCapacities };
}

export function sudtSifter(
    inputs: readonly Cell[],
    sudtType: I8Script,
    accountLockExpander: (c: Cell) => I8Script | undefined
) {
    const sudts: I8Cell[] = [];
    const notSudts: Cell[] = [];

    for (const c of inputs) {
        if (!scriptEq(c.cellOutput.type, sudtType)) {
            notSudts.push(c);
            continue;
        }

        const lock = accountLockExpander(c);
        if (!lock) {
            notSudts.push(c);
            continue;
        }

        sudts.push(I8Cell.from({
            ...c,
            cellOutput: {
                lock,
                type: sudtType,
                capacity: c.cellOutput.capacity
            }
        }));
    }

    return { sudts, notSudts };
}

export function simpleSifter(
    inputs: readonly Cell[],
    sudtType: I8Script,
    accountLockExpander: (c: Cell) => I8Script | undefined
) {
    const { capacities, notCapacities } = capacitySifter(inputs, accountLockExpander);
    const { sudts, notSudts } = sudtSifter(notCapacities, sudtType, accountLockExpander);

    return {
        capacities,
        sudts,
        notSimples: notSudts
    };
}

export const errorBothScriptUndefined = "Comparing two Scripts that both are undefined";
export function scriptEq(s0: Script | undefined, s1: Script | undefined) {
    if (!s0 && !s1) {
        throw Error(errorBothScriptUndefined);
    }
    if (!s0 || !s1) {
        return false;
    }
    return s0.codeHash === s1.codeHash &&
        s0.hashType === s1.hashType &&
        s0.args === s1.args;
}

export function scriptIs(s0: Script, name: string) {
    return scriptEq(s0, { ...defaultScript(name), args: s0.args });
}

export function epochSinceCompare(
    e0: EpochSinceValue,
    e1: EpochSinceValue
): 1 | 0 | -1 {
    if (e0.number < e1.number) {
        return -1;
    }
    if (e0.number > e1.number) {
        return 1;
    }

    const v0 = BI.from(e0.index).mul(e1.length);
    const v1 = BI.from(e1.index).mul(e0.length);
    if (v0.lt(v1)) {
        return -1;
    }
    if (v0.gt(v1)) {
        return 1;
    }

    return 0;
}

export function epochSinceAdd(e: EpochSinceValue, delta: EpochSinceValue): EpochSinceValue {
    if (e.length !== delta.length) {
        delta = {
            length: e.length,
            index: Math.ceil(delta.index * e.length / delta.length),
            number: delta.number
        };
    }

    const rawIndex = e.index + delta.index;

    const length = e.length;
    const index = rawIndex % length;
    const number = e.number + (rawIndex - index) / length;

    return { length, index, number };
}

export function logSplit<T>(array: readonly T[]) {
    let splits: T[][] = [];

    while (array.length > 0) {
        const half = Math.floor(array.length / 2);
        splits.push(array.slice(half));
        array = array.slice(0, half);
    }

    return splits;
}

// Durstenfeld shuffle, see https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
export function shuffle<T>(a: readonly T[]) {
    let array = [...a];
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// BinarySearch is translated from https://go.dev/src/sort/search.go, credits to the respective authors.

// BinarySearch uses binary search to find and return the smallest index i
// in [0, n) at which f(i) is true, assuming that on the range [0, n),
// f(i) == true implies f(i+1) == true. That is, Search requires that
// f is false for some (possibly empty) prefix of the input range [0, n)
// and then true for the (possibly empty) remainder; Search returns
// the first true index. If there is no such index, Search returns n.
// Search calls f(i) only for i in the range [0, n).
export function binarySearch(n: number, f: (i: number) => boolean): number {
    // Define f(-1) == false and f(n) == true.
    // Invariant: f(i-1) == false, f(j) == true.
    let [i, j] = [0, n];
    while (i < j) {
        const h = Math.trunc((i + j) / 2);
        // i ≤ h < j
        if (!f(h)) {
            i = h + 1; // preserves f(i-1) == false
        } else {
            j = h; // preserves f(j) == true
        }
    }
    // i == j, f(i-1) == false, and f(j) (= f(i)) == true  =>  answer is i.
    return i;
}