import type {
    Hash, Header, HexNumber, HexString, Script, OutPoint,
    PackedSince, Cell, DepType, CellDep, HashType
} from "@ckb-lumos/base";
import { BI } from "@ckb-lumos/bi";
import { minimalCellCapacityCompatible } from "@ckb-lumos/helpers";
import type { CellOutput } from "@ckb-lumos/ckb-indexer/lib/indexerType.js";

//Declarations of immutable data structures
export const immutable = Symbol("immutable");
export const cellDeps = Symbol("cellDeps");
export const headerDeps = Symbol("headerDeps");
export const witness = Symbol("witness");
export const since = Symbol("since");

export interface I8Scriptable extends Omit<I8Script, typeof immutable> { };
export class I8Script implements Script {
    readonly [immutable] = true
    readonly codeHash: Hash;
    readonly hashType: HashType;
    readonly args: HexString;

    readonly [cellDeps]: readonly I8CellDep[];
    readonly [headerDeps]: readonly I8Header[];
    readonly [witness]: HexString | undefined;
    readonly [since]: PackedSince;
    private constructor(i: I8Scriptable) {
        this.codeHash = i.codeHash;
        this.hashType = i.hashType;
        this.args = i.args;

        this[cellDeps] = Object.freeze(i[cellDeps]);
        this[headerDeps] = Object.freeze(i[headerDeps]);
        this[witness] = i[witness];
        this[since] = i[since];
    }
    static from(i: I8Scriptable) { return Object.freeze(i instanceof I8Script ? i : new I8Script(i)); }
}
export const i8ScriptPadding = I8Script.from({
    codeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    hashType: "data",
    args: "0x",
    [cellDeps]: [],
    [headerDeps]: [],
    [witness]: undefined,
    [since]: "0x0",
});

export class I8OutPoint implements OutPoint {
    readonly [immutable] = true
    readonly txHash: Hash;
    readonly index: HexNumber;
    private constructor(i: OutPoint) {
        this.txHash = i.txHash;
        this.index = i.index;
    }
    static from(i: OutPoint) { return Object.freeze(i instanceof I8OutPoint ? i : new I8OutPoint(i)); }
}

export interface I8CellOutputable extends CellOutput {
    lock: I8Scriptable;
    type?: I8Scriptable;
};
export class I8CellOutput implements I8CellOutputable {
    readonly [immutable] = true
    readonly capacity: HexNumber;
    readonly lock: I8Script;
    readonly type?: I8Script;
    private constructor(i: I8CellOutputable) {
        this.capacity = i.capacity;
        this.lock = I8Script.from(i.lock);
        this.type = i.type ? I8Script.from(i.type) : undefined;
    }
    static from(i: I8CellOutputable) { return Object.freeze(i instanceof I8CellOutput ? i : new I8CellOutput(i)); }
}

export interface I8Cellable extends Cell {
    cellOutput: I8CellOutputable
}
export class I8Cell implements I8Cellable {
    readonly [immutable] = true
    readonly cellOutput: I8CellOutput;
    readonly data: HexString;
    readonly outPoint?: I8OutPoint;
    readonly blockHash?: Hash;
    readonly blockNumber?: HexNumber;
    readonly txIndex?: HexNumber;
    private constructor(i: Partial<I8Cellable> & Partial<I8CellOutputable>) {
        let { capacity, lock, type } = {
            lock: i8ScriptPadding,
            capacity: "0x0",
            ...i.cellOutput,
            ...i
        };
        this.cellOutput = I8CellOutput.from({ capacity, lock, type });
        this.data = i.data ?? "0x";
        this.outPoint = i.outPoint ? I8OutPoint.from(i.outPoint) : undefined;
        this.blockHash = i.blockHash;
        this.blockNumber = i.blockNumber;
        this.txIndex = i.txIndex;
        if (BI.from(capacity).lte(0)) {
            capacity = minimalCellCapacityCompatible(this, { validate: false }).toHexString();
            this.cellOutput = I8CellOutput.from({ capacity, lock, type });
        }
    }
    static from(i: Partial<I8Cellable> & Partial<I8CellOutputable>) {
        return Object.freeze(i instanceof I8Cell ? i : new I8Cell(i));
    }
}

export class I8CellDep implements CellDep {
    readonly [immutable] = true
    readonly outPoint: I8OutPoint;
    readonly depType: DepType;
    private constructor(i: CellDep) {
        this.outPoint = I8OutPoint.from(i.outPoint);
        this.depType = i.depType;
    }
    static from(i: CellDep) { return Object.freeze(i instanceof I8CellDep ? i : new I8CellDep(i)); }
}

export class I8Header implements Header {
    readonly [immutable] = true
    readonly timestamp: HexNumber;
    readonly number: HexNumber;
    readonly epoch: HexNumber;
    readonly compactTarget: HexNumber;
    readonly dao: Hash;
    readonly hash: Hash;
    readonly nonce: HexNumber;
    readonly parentHash: Hash;
    readonly proposalsHash: Hash;
    readonly transactionsRoot: Hash;
    readonly extraHash: Hash;
    readonly version: HexNumber;
    private constructor(i: Header) {
        this.timestamp = i.timestamp;
        this.number = i.number;
        this.epoch = i.epoch;
        this.compactTarget = i.compactTarget;
        this.dao = i.dao;
        this.hash = i.hash;
        this.nonce = i.nonce;
        this.parentHash = i.parentHash;
        this.proposalsHash = i.proposalsHash;
        this.transactionsRoot = i.transactionsRoot;
        this.extraHash = i.extraHash;
        this.version = i.version;
    }
    static from(i: Header) { return Object.freeze(i instanceof I8Header ? i : new I8Header(i)); }
}