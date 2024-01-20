import { Script, Cell, Hexadecimal, OutPoint, Header, Transaction, Hash } from "@ckb-lumos/base";
import { BI, BIish } from "@ckb-lumos/bi";
import { defaultRpcUrl, defaultScript, getChainInfo } from "./config";
import { EpochSinceValue, parseAbsoluteEpochSince, parseEpoch } from "@ckb-lumos/base/lib/since";
import { I8Cell, I8Header, I8Script, since } from "./cell";
import { TransactionSkeleton, TransactionSkeletonType } from "@ckb-lumos/helpers";
import { ckbDelta, daoWithdrawFrom, isDao } from "./dao";
import { addCells } from "./transaction";
import { LightClientRPC } from "@ckb-lumos/light-client";
import { CKBComponents } from "@ckb-lumos/rpc/lib/types/api";
import { RPC } from "@ckb-lumos/rpc";

export type Asset2Fund = {
    [name: string]: {// All caps names like CKB, ICKB_SUDT ...
        addFunds: ((tx: TransactionSkeletonType) => TransactionSkeletonType)[]
        addChange: (tx: TransactionSkeletonType) => TransactionSkeletonType | undefined
        getDelta: (tx: TransactionSkeletonType) => BI
    }
}

export const errorNotEnoughFunds = "Not enough funds to execute the transaction";
export const errorTooManyOutputs = "A transaction using Nervos DAO script is currently limited to 64 output cells"
export function fund(tx: TransactionSkeletonType, asset2Fund: Asset2Fund) {
    //asset2Fund is iterated in the reverse order, so that CKB is last to be funded
    for (const [name, { addFunds, addChange, getDelta }] of [...Object.entries(asset2Fund)].reverse()) {
        //Try a quick estimation of how many funds it would take to even out input and output balances
        let balanceEstimation = getDelta(tx);
        const reversedAddFunds = [(tx: TransactionSkeletonType) => tx, ...addFunds].reverse();
        while (balanceEstimation.lt(0) && reversedAddFunds.length > 0) {
            const addFund = reversedAddFunds.pop()!;
            tx = addFund(tx);
            balanceEstimation = balanceEstimation.add(getDelta(addFund(TransactionSkeleton())));
        }

        //Use the slow but 100% accurate method for evening out input and output balances
        reversedAddFunds.push((tx: TransactionSkeletonType) => tx);
        for (const addFund of reversedAddFunds.reverse()) {
            tx = addFund(tx);
            const newTx = addChange(tx);
            if (newTx) {
                tx = newTx;
                break;
            }
        }

        if (!getDelta(tx).eq(0)) {
            throw new NotEnoughFundsError(name);
        }
    }

    if ([...tx.inputs, ...tx.outputs].some(c => isDao(c)) && tx.outputs.size > 64) {
        throw Error(errorTooManyOutputs);
    }

    return tx;
}


class NotEnoughFundsError extends Error {
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
    feeRate: BIish,
    addPlaceholders: (tx: TransactionSkeletonType) => TransactionSkeletonType,
    capacities: Iterable<I8Cell>,
    tipHeader?: I8Header,
    withdrawalRequests?: Iterable<I8Cell>,
): Asset2Fund {
    const addFunds: ((tx: TransactionSkeletonType) => TransactionSkeletonType)[] = [];
    if (tipHeader && withdrawalRequests) {
        const tipEpoch = parseEpoch(tipHeader.epoch)
        for (const wr of withdrawalRequests) {
            const withdrawalEpoch = parseAbsoluteEpochSince(wr.cellOutput.type![since]);
            if (epochSinceCompare(tipEpoch, withdrawalEpoch) === -1) {
                continue;
            }
            addFunds.push((tx: TransactionSkeletonType) => daoWithdrawFrom(tx, [wr]));
        }
    }

    for (const c of capacities) {
        addFunds.push((tx: TransactionSkeletonType) => addCells(tx, "append", [c], []));
    }

    const addChange = (tx: TransactionSkeletonType) => {
        let changeCell = I8Cell.from({ lock: accountLock });
        const txWithPlaceholders = addPlaceholders(addCells(tx, "append", [], [changeCell]));
        const delta = ckbDelta(txWithPlaceholders, feeRate);
        if (delta.lt(0)) {
            return undefined;
        }

        changeCell = I8Cell.from({
            ...changeCell,
            capacity: delta.add(changeCell.cellOutput.capacity).toHexString()
        });
        return addPlaceholders(addCells(tx, "append", [], [changeCell]));
    }

    const getDelta = (tx: TransactionSkeletonType) => ckbDelta(tx, feeRate);

    return { "CKB": { addFunds, addChange, getDelta } };
}

export function capacitiesSifter(
    inputs: Iterable<Cell>,
    accountLockExpander: (c: Cell) => I8Script | undefined
) {
    const owned: I8Cell[] = [];
    const unknowns: Cell[] = [];

    for (const c of inputs) {
        if (c.cellOutput.type !== undefined || c.data !== "0x") {
            unknowns.push(c);
            continue;
        }

        const lock = accountLockExpander(c);
        if (!lock) {
            unknowns.push(c);
            continue;
        }

        owned.push(I8Cell.from({
            ...c,
            cellOutput: {
                lock,
                capacity: c.cellOutput.capacity
            }
        }));
    }

    return { owned, unknowns };
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

//Methods that work for both RPC and Light Client RPC
const errorHeaderNotFound = "Unable to reach the Header given the block number and the context";
export async function getHeaderByNumber(
    queries: { blockNum: Hexadecimal, context: OutPoint }[],
    knownHeaders: Iterable<I8Header> = []
) {
    const blockNum2Header: Map<Hexadecimal, I8Header> = new Map();
    const blockHash2Header: Map<Hexadecimal, I8Header> = new Map();
    for (const h of knownHeaders) {
        blockNum2Header.set(h.number, h);
        blockHash2Header.set(h.hash, h);
    }

    const wantedBlockNums = new Set<Hexadecimal>();
    const txHashSuitors = new Set<Hexadecimal>();
    for (const { blockNum, context } of queries) {
        if (blockNum2Header.has(blockNum)) {
            continue;
        }
        wantedBlockNums.add(blockNum);
        txHashSuitors.add(context.txHash);
    }

    const chainInfo = getChainInfo();
    let discoveredHeaders: Header[] = []
    if (!chainInfo.isLightClientRpc) {
        const rpc = new RPC(chainInfo.rpcUrl);
        discoveredHeaders = await Promise.all([...wantedBlockNums].map((blockNum) => rpc.getHeaderByNumber(blockNum)));
    } else {
        const lightClientRPC = new LightClientRPC(chainInfo.rpcUrl);

        const hashSuitors = new Set<Hexadecimal>();
        for (const tx of await Promise.all([...txHashSuitors].map((txHash) => lightClientRPC.getTransaction(txHash)))) {
            //Maybe there are DAO withdrawal request transactions, try also with the transaction headerDeps
            for (const hash of [tx.txStatus.blockHash!, ...tx.transaction.headerDeps]) {
                if (blockHash2Header.has(hash)) {
                    continue;
                }
                hashSuitors.add(hash);
            }
        }
        discoveredHeaders = await Promise.all([...hashSuitors].map(h => lightClientRPC.getHeader(h)));
    }

    for (const h of discoveredHeaders) {
        const i8h = I8Header.from(h);
        blockNum2Header.set(h.number, i8h);
        blockHash2Header.set(h.hash, i8h);
    }

    for (const blockNum of wantedBlockNums) {
        if (!blockNum2Header.has(blockNum)) {
            throw Error(errorHeaderNotFound);
        }
    }

    return [...blockHash2Header.values()];
}

export async function getCells<WithData extends boolean = true>(
    searchKey: CKBComponents.GetCellsSearchKey<WithData>,
    order: CKBComponents.Order = "asc",
    limit: CKBComponents.Hash = "0xffffffff",
    cursor?: CKBComponents.Hash256) {
    //Same signature for both RPC and light client RPC

    const script = searchKey.script;
    searchKey.script = { codeHash: script.codeHash, hashType: script.hashType, args: script.args };

    const chainInfo = getChainInfo();
    const cc = await new RPC(chainInfo.rpcUrl).getCells(searchKey, order, limit, cursor);
    return cc.objects.map(c => Object.freeze(<Cell>{
        cellOutput: {
            capacity: c.output.capacity,
            lock: scriptEq(c.output.lock, script) ? script : c.output.lock,
            type: c.output.type ?? undefined,
        },
        data: c.outputData ?? "0x",
        outPoint: c.outPoint ?? undefined,
        blockNumber: c.blockNumber,
    }));
}

export async function getFeeRate() {
    const chainInfo = getChainInfo();
    const rpc = new RPC(chainInfo.isLightClientRpc ? defaultRpcUrl(chainInfo.chain) : chainInfo.rpcUrl);

    const [feeRateStatistics6, feeRateStatistics101] = await Promise.all([
        rpc.getFeeRateStatistics("0x6"),
        rpc.getFeeRateStatistics("0x101")
    ]);

    const median101 = feeRateStatistics101 === null ? BI.from(1000) : BI.from(feeRateStatistics101.median);
    const median6 = feeRateStatistics6 === null ? median101 : BI.from(feeRateStatistics6.median);

    let res = median6.add(median6.div(10));

    const lowerLimit = median101.add(median101.div(10));
    const upperLimit = BI.from(10 ** 7)

    if (res.lt(lowerLimit)) {
        res = lowerLimit;
    } else if (res.gt(upperLimit)) {
        res = upperLimit;
    }
    return res;
}

export const errorUnexpectedTxState = "Unexpected transaction state";
export const errorTimeOut = "Transaction timed out";
export async function sendTransaction(tx: Transaction, secondsTimeout: number = 600) {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    const rpc = new RPC(chainInfo.rpcUrl);

    const txHashPromise = rpc.sendTransaction(tx);

    if (secondsTimeout <= 0) {
        return txHashPromise;
    }

    const txHash = await txHashPromise;

    //Wait until the transaction is committed or time out
    for (let i = 0; i < secondsTimeout; i++) {
        let status = (await rpc.getTransaction(txHash)).txStatus.status;
        switch (status) {
            case "committed":
                return txHash;
            case "pending":
            case "proposed":
                await new Promise(r => setTimeout(r, 1000));
                break;
            // case "rejected":
            // case "unknown":
            default:
                throw Error(errorUnexpectedTxState);
        }
    }

    throw Error(errorTimeOut);
}

export async function getTipHeader() {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    return new RPC(chainInfo.rpcUrl).getTipHeader();
}

export async function getGenesisBlock() {
    const chainInfo = getChainInfo();
    if (chainInfo.isLightClientRpc) {
        return new LightClientRPC(chainInfo.rpcUrl).getGenesisBlock();
    } else {
        return new RPC(chainInfo.rpcUrl).getBlockByNumber('0x0');
    }
}

export async function getHeader(blockHash: Hash) {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    return new RPC(chainInfo.rpcUrl).getHeader(blockHash);
}

export async function getTransaction(txHash: Hash) {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    return new RPC(chainInfo.rpcUrl).getTransaction(txHash);
}

export async function localNodeInfo() {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    return new RPC(chainInfo.rpcUrl).localNodeInfo();
}

export async function getTransactions<Group extends boolean = false>(
    searchKey: CKBComponents.GetTransactionsSearchKey<Group>,
    order: CKBComponents.Order = "asc",
    limit: CKBComponents.Hash | bigint = "0xffffffff",
    cursor?: CKBComponents.Hash256) {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    return new RPC(chainInfo.rpcUrl).getTransactions(searchKey, order, limit, cursor);
}

export async function getCellsCapacity(searchKey: CKBComponents.SearchKey) {
    //Same signature for both RPC and light client RPC
    const chainInfo = getChainInfo();
    return new RPC(chainInfo.rpcUrl).getCellsCapacity(searchKey);
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