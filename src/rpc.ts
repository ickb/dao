import { RPC } from "@ckb-lumos/rpc";
import { getConfig } from "@ckb-lumos/config-manager/lib";
import { Indexer } from "@ckb-lumos/ckb-indexer";
import { Mutex } from "./mutex";

type RpcDataType = {
    url: string,
    rpc: RPC,
    rpcBatcher: {
        add: <T>(request: string) => Promise<T>,
        process: () => void
    }
    indexer: Indexer
}

function newRpcStateFrom(url: string) {
    const rpc = new RPC(url, { timeout: 10000 })
    return {
        url,
        rpc,
        rpcBatcher: createRPCBatcher(rpc),
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

export async function getRpcBatcher() {
    return (await getRpcState()).rpcBatcher;
}

export async function getSyncedIndexer() {
    const indexer = (await getRpcState()).indexer;
    await indexer.waitForSync();
    return indexer;
}

type Callback = {
    resolve: (x: any) => void;
    reject: (x: any) => void;
}

function createRPCBatcher(rpc: RPC) {
    const batcherState = new Mutex(new Map<string, Callback[]>());

    function process() {
        batcherState.update(async (_requests) => {
            if (_requests.size > 0) {
                _process(rpc, _requests);
            }
            return new Map();
        });
    }

    async function add<T>(request: string) {
        return new Promise<T>((resolve, reject) =>
            batcherState.update(async (requests) => {
                //Set delayed executor for new batch request
                if (requests.size == 0) {
                    setTimeout(process, 50);
                }

                let callbacks = requests.get(request) || [];
                callbacks = [...callbacks, { resolve, reject }];
                return requests.set(request, callbacks);
            })
        );
    }

    return { add, process }
}

async function _process(rpc: RPC, requests: Map<string, Callback[]>) {
    const batch = rpc.createBatchRequest();
    for (const k of requests.keys()) {
        batch.add(...k.split('/'));
    }

    try {
        const results = await (batch.exec() as Promise<any[]>);
        const allCallbacks = [...requests.values()];
        for (const i of results.keys()) {
            const res = results[i];
            for (const callback of allCallbacks[i]) {
                callback.resolve(res);
            }
        }
    } catch (error) {
        for (const callbacks of requests.values()) {
            for (const callback of callbacks) {
                callback.reject(error);
            }
        }
    }
}