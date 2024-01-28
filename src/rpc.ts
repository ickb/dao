import { Cell, Hexadecimal, OutPoint, Header, Transaction, Hash } from "@ckb-lumos/base";
import { BI } from "@ckb-lumos/bi";
import { defaultRpcUrl, getChainInfo } from "./config";
import { I8Header } from "./cell";
import { LightClientRPC } from "@ckb-lumos/light-client";
import { CKBComponents } from "@ckb-lumos/rpc/lib/types/api";
import { RPC } from "@ckb-lumos/rpc";
import { scriptEq } from "./utils";

//RPC methods that work for both RPC and Light Client RPC

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