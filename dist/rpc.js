"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSyncedIndexer = exports.getHeaderByNumber = exports.getRpcBatcher = exports.getRpc = exports.getRpcUrl = void 0;
const rpc_1 = require("@ckb-lumos/rpc");
const lib_1 = require("@ckb-lumos/config-manager/lib");
const ckb_indexer_1 = require("@ckb-lumos/ckb-indexer");
const mutex_1 = require("./mutex");
function newRpcStateFrom(url) {
    const rpc = new rpc_1.RPC(url, { timeout: 10000 });
    return {
        url,
        rpc,
        rpcBatcher: createRPCBatcher(rpc),
        indexer: new ckb_indexer_1.Indexer(url)
    };
}
function _getRpcUrl() {
    if ((0, lib_1.getConfig)().PREFIX == "ckb") {
        return "https://rpc.ankr.com/nervos_ckb";
    }
    else {
        return "http://127.0.0.1:8114/";
    }
}
const rpcStateMutex = new mutex_1.Mutex(newRpcStateFrom(_getRpcUrl()));
async function getRpcState() {
    return new Promise((res) => rpcStateMutex.update((s) => {
        let u = _getRpcUrl();
        if (s.url !== u) {
            s = newRpcStateFrom(u);
        }
        res(s);
        return Promise.resolve(s);
    }));
}
async function getRpcUrl() {
    return (await getRpcState()).url;
}
exports.getRpcUrl = getRpcUrl;
async function getRpc() {
    return (await getRpcState()).rpc;
}
exports.getRpc = getRpc;
async function getRpcBatcher() {
    return (await getRpcState()).rpcBatcher;
}
exports.getRpcBatcher = getRpcBatcher;
async function getHeaderByNumber(blockNumber) {
    const get = (await getRpcState()).rpcBatcher.get;
    const res = await get("getHeaderByNumber/" + blockNumber, true);
    if (res === undefined) {
        throw Error("Header not found from blockNumber " + blockNumber);
    }
    return res;
}
exports.getHeaderByNumber = getHeaderByNumber;
async function getSyncedIndexer() {
    const indexer = (await getRpcState()).indexer;
    await indexer.waitForSync();
    return indexer;
}
exports.getSyncedIndexer = getSyncedIndexer;
function createRPCBatcher(rpc) {
    const batcherState = new mutex_1.Mutex({
        pending: new Map(),
        cache: new Map()
    });
    function process() {
        batcherState.update(async ({ pending, cache }) => {
            if (pending.size > 0) {
                _process(rpc, pending);
            }
            return { pending: new Map(), cache };
        });
    }
    async function get(request, cacheable) {
        return new Promise((resolve, reject) => batcherState.update(async ({ pending, cache }) => {
            if (cacheable && cache.has(request)) {
                const res = cache.get(request);
                resolve(res);
                cache.set(request, res);
                return { pending, cache };
            }
            //Set delayed executor for new batch request
            if (pending.size == 0) {
                setTimeout(process, 50);
            }
            let { callbacks } = pending.get(request) || { callbacks: [] };
            callbacks = [...callbacks, { resolve, reject }];
            pending = pending.set(request, { cacheable, callbacks });
            return { pending, cache };
        }));
    }
    async function _process(rpc, requests) {
        const batch = rpc.createBatchRequest();
        for (const k of requests.keys()) {
            batch.add(...k.split('/'));
        }
        try {
            const results = await batch.exec();
            const entries = [...requests.entries()];
            const newCache = new Map();
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
        }
        catch (error) {
            for (const { callbacks } of requests.values()) {
                for (const callback of callbacks) {
                    callback.reject(error);
                }
            }
        }
    }
    return { get, process };
}
