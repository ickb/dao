import type { CellDep, Header, Hexadecimal, PackedSince, Script } from "@ckb-lumos/base";
import { createTransactionFromSkeleton, type TransactionSkeletonType } from "@ckb-lumos/helpers";
import { Map as ImmutableMap, List, Record } from "immutable";
import { cellDeps, headerDeps, I8Cell, i8ScriptPadding, since, witness } from "./cell.js";
import { bytes } from "@ckb-lumos/codec";
import { parseAbsoluteEpochSince } from "@ckb-lumos/base/lib/since.js";
import { Transaction as TransactionCodec, WitnessArgs } from "@ckb-lumos/base/lib/blockchain.js";
import { hexify } from "@ckb-lumos/codec/lib/bytes.js";
import { epochSinceCompare, scriptEq } from "./utils.js";

export const errorDifferentIOFixedEntries = "Unable to modify entries without messing up fixed entries";
export const errorDifferentIOLength = "Input and output have different length";
export const errorNotEmptySigningEntries = "Signing Entries are not empty"
export function addCells(
    tx: TransactionSkeletonType,
    mode: "matched" | "append",
    inputs: readonly I8Cell[],
    outputs: readonly I8Cell[],
): TransactionSkeletonType {
    const fixedEntries = parseFixedEntries(tx);

    const i8inputs = List(inputs);
    const i8outputs = List(outputs);
    if (mode === "matched") {
        //Check if it's safe to add same index cells
        if (i8inputs.size !== i8outputs.size) {
            throw Error(errorDifferentIOLength);
        }
        if (fixedEntries.inputs !== fixedEntries.outputs) {
            throw Error(errorDifferentIOFixedEntries);
        }
        if (tx.signingEntries.size > 0) {
            throw Error(errorNotEmptySigningEntries);
        }
    }

    const fix = mode == "matched";
    const inputSplicingIndex = fix ? fixedEntries.inputs + 1 : tx.inputs.size;
    const outputSplicingIndex = fix ? fixedEntries.outputs + 1 : tx.outputs.size;

    //Add all the ancillary to the cells
    tx = addCellDepsFrom(tx, i8inputs, i8outputs);
    tx = addHeaderDepsFrom(tx, i8inputs, i8outputs);
    tx = addSincesFrom(tx, inputSplicingIndex, i8inputs);
    tx = addWitnessesFrom(tx, inputSplicingIndex, i8inputs, outputSplicingIndex, i8outputs);

    //Add the cells themselves
    tx = tx.update("inputs", i => i.splice(inputSplicingIndex, 0, ...i8inputs));
    tx = tx.update("outputs", o => o.splice(outputSplicingIndex, 0, ...i8outputs));

    if (fix) {
        tx = setFixedEntries(tx, fixedEntries
            .set("inputs", fixedEntries.inputs + i8inputs.size)
            .set("outputs", fixedEntries.outputs + i8outputs.size)
        );
    }

    return tx;
}

const witnessPadding = hexify(WitnessArgs.pack({}));
function addWitnessesFrom(
    tx: TransactionSkeletonType,
    inputSplicingIndex: number,
    inputs: List<I8Cell>,
    outputSplicingIndex: number,
    outputs: List<I8Cell>
) {
    //Unfold witnesses, estimate the current correct length of witnesses
    let witnessesLength = [
        tx.inputs.size,
        tx.outputs.size,
        tx.witnesses.size,
        inputSplicingIndex,
        outputSplicingIndex
    ].reduce((a, b) => a > b ? a : b);
    const lockWs: (string | undefined)[] = [];
    const inputTypeWs: (string | undefined)[] = [];
    const outputTypeWs: (string | undefined)[] = [];
    for (let i = 0; i < witnessesLength; i++) {
        const { lock, inputType, outputType } = WitnessArgs.unpack(tx.witnesses.get(i, witnessPadding));
        lockWs.push(lock);
        inputTypeWs.push(inputType);
        outputTypeWs.push(outputType);
    }

    //Add new witnesses
    lockWs.splice(inputSplicingIndex, 0, ...inputs.map(c => c.cellOutput.lock[witness]));
    inputTypeWs.splice(inputSplicingIndex, 0, ...inputs.map(c => c.cellOutput.type ?
        c.cellOutput.type[witness] : undefined));
    outputTypeWs.splice(outputSplicingIndex, 0, ...outputs.map(c => c.cellOutput.type ?
        c.cellOutput.type[witness] : undefined));

    //Fold witnesses
    witnessesLength = inputTypeWs.length > outputTypeWs.length ? inputTypeWs.length : outputTypeWs.length;
    let witnesses: string[] = [];
    for (let i = 0; i < witnessesLength; i++) {
        witnesses.push(bytes.hexify(WitnessArgs.pack({
            lock: lockWs.at(i),
            inputType: inputTypeWs.at(i),
            outputType: outputTypeWs.at(i),
        })));
    }

    //Trim padding at the end
    while (witnesses[-1] === witnessPadding) {
        witnesses.pop();
    }

    return tx.set("witnesses", List(witnesses));
}

export function addWitnessPlaceholder(
    tx: TransactionSkeletonType,
    accountLock: Script,
    firstPlaceholder: Hexadecimal = "0x" + "00".repeat(65),
    restPlaceholder: Hexadecimal = "0x",
) {
    let lockPlaceholder = firstPlaceholder;
    let inputTypePlaceholder = firstPlaceholder;
    let outputTypePlaceholder = firstPlaceholder;

    const witnesses: string[] = [];
    const witnessesLength = [
        tx.inputs.size,
        tx.outputs.size
    ].reduce((a, b) => a > b ? a : b);
    for (let i = 0; i < witnessesLength; i++) {
        const unpackedWitness = WitnessArgs.unpack(tx.witnesses.get(i, witnessPadding));
        const { lock, type: inputType } = tx.inputs.get(i)?.cellOutput ?? { lock: undefined, type: undefined };
        const outputType = tx.outputs.get(i)?.cellOutput.type;

        if (scriptEq(lock, accountLock)) {
            unpackedWitness.lock = lockPlaceholder;
            lockPlaceholder = restPlaceholder;
        }

        if (scriptEq(inputType, accountLock)) {
            unpackedWitness.inputType = inputTypePlaceholder;
            inputTypePlaceholder = restPlaceholder;
        }

        if (scriptEq(outputType, accountLock)) {
            unpackedWitness.outputType = outputTypePlaceholder;
            outputTypePlaceholder = restPlaceholder;
        }

        witnesses.push(hexify(WitnessArgs.pack(unpackedWitness)));
    }

    //Trim padding at the end
    while (witnesses[-1] === witnessPadding) {
        witnesses.pop();
    }

    return tx.set("witnesses", List(witnesses));
}

function addSincesFrom(
    tx: TransactionSkeletonType,
    inputSplicingIndex: number,
    inputs: List<I8Cell>
) {
    // Convert tx.inputSinces to sinces
    const sincePadding = i8ScriptPadding[since];
    let sinces = Array.from({ length: tx.inputs.size }, (_, index) => tx.inputSinces.get(index, sincePadding));

    // Convert cells to their sinces
    let newSinces: PackedSince[] = [];
    for (const c of inputs) {
        const lockSince = c.cellOutput.lock[since];
        const typeSince = c.cellOutput.type ? c.cellOutput.type[since] : lockSince;
        if (lockSince === sincePadding || lockSince === typeSince) {
            newSinces.push(typeSince);
        } else if (typeSince === sincePadding) {
            newSinces.push(lockSince);
        } else if (epochSinceCompare(parseAbsoluteEpochSince(lockSince), parseAbsoluteEpochSince(typeSince)) == -1) {
            newSinces.push(typeSince);
        } else {
            newSinces.push(lockSince);
        }
    }

    //Insert newSinces in the correct location
    sinces.splice(inputSplicingIndex, 0, ...newSinces);

    return tx.set("inputSinces", ImmutableMap(sinces
        .map((since, index) => [index, since] as [number, string])
        .filter(([_, since]) => since !== sincePadding)));
}


function addHeaderDepsFrom(tx: TransactionSkeletonType, inputs: List<I8Cell>, outputs: List<I8Cell>) {
    const deps: Header[] = [];

    for (const c of inputs) {
        const lock = c.cellOutput.lock;
        deps.push(...lock[headerDeps]);
    }
    for (const c of [...inputs, ...outputs]) {
        const type = c.cellOutput.type;
        if (type === undefined) {
            continue;
        }
        deps.push(...type[headerDeps]);
    }

    return addHeaderDeps(tx, ...deps.map(h => h.hash));
}

export function addHeaderDeps(tx: TransactionSkeletonType, ...headers: readonly Hexadecimal[]) {
    const fixedEntries = parseFixedEntries(tx);
    let headerDeps = tx.headerDeps.push(...headers);
    //Use a Set (preserving order) to remove duplicates
    headerDeps = List(new Set(headerDeps));
    tx = setFixedEntries(tx, fixedEntries.set("headerDeps", headerDeps.size - 1));
    return tx.set("headerDeps", headerDeps);
}

function addCellDepsFrom(tx: TransactionSkeletonType, inputs: List<I8Cell>, outputs: List<I8Cell>) {
    const deps: CellDep[] = [];

    for (const c of inputs) {
        const lock = c.cellOutput.lock;
        deps.push(...lock[cellDeps]);
    }
    for (const c of [...inputs, ...outputs]) {
        const type = c.cellOutput.type;
        if (type === undefined) {
            continue;
        }
        deps.push(...type[cellDeps]);
    }

    return addCellDeps(tx, ...deps);
}

const serializeCellDep = (d: CellDep) => `${d.outPoint.txHash}-${d.outPoint.index}-${d.depType}`;
export function addCellDeps(tx: TransactionSkeletonType, ...deps: CellDep[]) {
    const fixedEntries = parseFixedEntries(tx);
    let cellDeps = tx.cellDeps.push(...deps);
    //Use a Map (preserving order) to remove duplicates
    cellDeps = List(new Map(cellDeps.map(d => [serializeCellDep(d), d])).values());
    tx = setFixedEntries(tx, fixedEntries.set("cellDeps", cellDeps.size - 1));
    return tx.set("cellDeps", cellDeps);
}

export function parseFixedEntries(tx: TransactionSkeletonType) {
    return I8FixedEntriesFrom(
        tx.fixedEntries.sort((a, b) => a.index - b.index)
            .map(e => [e.field, e.index] as [string, number])
    );
}

const keys: List<keyof I8FixedEntriable> = List(["cellDeps", "headerDeps", "inputs", "outputs"]);
export function setFixedEntries(tx: TransactionSkeletonType, e: I8FixedEntriable) {
    return tx.set("fixedEntries",
        keys.map(k => Object.freeze({ field: k, index: e[k] }))
            .filter(({ index }) => index >= 0)
    );
}

export function txSize(tx: TransactionSkeletonType) {
    const serializedTx = TransactionCodec.pack(createTransactionFromSkeleton(tx));
    // 4 is serialized offset bytesize;
    return serializedTx.byteLength + 4;
}

export function calculateFee(size: number, feeRate: bigint) {
    const ratio = 1000n;
    const base = BigInt(size) * feeRate;
    const fee = base / ratio;
    if (fee * ratio < base) {
        return fee + 1n;
    }
    return fee;
}

//Declarations of immutable data structures

export interface I8FixedEntriable {
    cellDeps: number;
    headerDeps: number;
    inputs: number;
    outputs: number;
}
export type I8FixedEntries = Record<I8FixedEntriable> & Readonly<I8FixedEntriable>;
export const I8FixedEntriesFrom = Record<I8FixedEntriable>({
    cellDeps: -1,
    headerDeps: -1,
    inputs: -1,
    outputs: -1,
});