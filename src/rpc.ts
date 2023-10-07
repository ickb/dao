import { RPC } from "@ckb-lumos/rpc";
import { getConfig } from "@ckb-lumos/config-manager/lib";
import { Indexer } from "@ckb-lumos/ckb-indexer";
import { Mutex } from "./mutex";
import { Header, Hexadecimal } from "@ckb-lumos/base";

type RpcDataType = {
    url: string,
    rpc: RPC,
    rpcBatcher: {
        get: <T>(request: string, cacheable: boolean) => Promise<T>,
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

export async function getHeaderByNumber(blockNumber: Hexadecimal): Promise<Header> {
    const get = (await getRpcState()).rpcBatcher.get;
    const res = await get("getHeaderByNumber/" + blockNumber, true);
    if (res === undefined) {
        throw Error("Header not found from blockNumber " + blockNumber);
    }
    return res as Header;
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
    const batcherState = new Mutex(
        {
            pending: new Map<string, { cacheable: boolean, callbacks: Callback[] }>(),
            cache: new Map<string, any>()
        }
    );

    function process() {
        batcherState.update(async ({ pending, cache }) => {
            if (pending.size > 0) {
                _process(rpc, pending);
            }
            return { pending: new Map(), cache };
        });
    }

    async function get<T>(request: string, cacheable: boolean) {
        return new Promise<T>((resolve, reject) =>
            batcherState.update(async ({ pending, cache }) => {
                if (cacheable && cache.has(request)) {
                    const res = cache.get(request);
                    resolve(res);
                    cache.set(request, res);
                    return { pending, cache }
                }

                //Set delayed executor for new batch request
                if (pending.size == 0) {
                    setTimeout(process, 50);
                }

                let { callbacks } = pending.get(request) || { callbacks: [] };
                callbacks = [...callbacks, { resolve, reject }];
                pending = pending.set(request, { cacheable, callbacks })
                return { pending, cache };
            })
        );
    }

    async function _process(rpc: RPC, requests: Map<string, { cacheable: boolean, callbacks: Callback[] }>) {
        const batch = rpc.createBatchRequest();
        for (const k of requests.keys()) {
            batch.add(...k.split('/'));
        }

        try {
            const results = await (batch.exec() as Promise<any[]>);
            const entries = [...requests.entries()];
            const newCache = new Map<string, any>();
            for (const i of results.keys()) {
                const res = results[i];
                const [request, { cacheable, callbacks }] = entries[i];
                if (cacheable && res !== undefined) {
                    newCache.set(request, res);
                }
                for (const callback of callbacks) {
                    callback.resolve(res);
                }
            }

            if (newCache.size > 0) {
                batcherState.update(async ({ pending, cache }) => {
                    for (const [req, res] of newCache.entries()) {
                        if (cache.size >= 65536) {
                            cache.delete(cache.keys().next().value);
                        }
                        cache.set(req, res);
                    }
                    return { pending, cache };
                });
            }

        } catch (error) {
            for (const { callbacks } of requests.values()) {
                for (const callback of callbacks) {
                    callback.reject(error);
                }
            }
        }
    }

    return { get, process }
}

