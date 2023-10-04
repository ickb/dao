import { RPC } from "@ckb-lumos/rpc";
import { getConfig } from "@ckb-lumos/config-manager/lib";
import { Indexer } from "@ckb-lumos/ckb-indexer";
import { Mutex } from "./mutex";

type RpcDataType = {
    url: string,
    rpc: RPC,
    indexer: Indexer
}

function newRpcStateFrom(url: string): RpcDataType {
    return {
        url,
        rpc: new RPC(url, { timeout: 10000 }),
        indexer: new Indexer(url)
    }
}

function _getRpcUrl() {
    if (getConfig().PREFIX == "ckb") {
        return "https://rpc.ankr.com/nervos_ckb";
    } else {
        return "http://127.0.0.1:8114/";
    }
}

const rpcStateMutex = new Mutex<RpcDataType>(newRpcStateFrom(_getRpcUrl()));

async function getRpcState() {
    return new Promise(
        (res: (s: RpcDataType) => void) => rpcStateMutex.update((s: RpcDataType) => {
            let u = _getRpcUrl();
            if (s.url !== u) {
                s = newRpcStateFrom(u);
            }
            res(s);
            return Promise.resolve(s);
        })
    );
}

export async function getRpcUrl() {
    return (await getRpcState()).url;
}

export async function getRpc() {
    return (await getRpcState()).rpc;
}

export async function getSyncedIndexer() {
    const indexer = (await getRpcState()).indexer;
    await indexer.waitForSync();
    return indexer;
}
