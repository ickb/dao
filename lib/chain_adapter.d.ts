import { RPC } from "@ckb-lumos/rpc";
import { Config } from "@ckb-lumos/config-manager/lib";
import { Indexer } from "@ckb-lumos/ckb-indexer";
import { Header, Hexadecimal } from "@ckb-lumos/base";
declare const chain2RpcUrl: {
    mainnet: string;
    testnet: string;
    devnet: string;
};
export type Chain = keyof typeof chain2RpcUrl;
export declare function isChain(x: string): x is Chain;
export declare function defaultRpcUrl(chain: Chain): string;
export declare function initializeChainAdapter(chain: Chain, config?: Config, url?: string): Promise<void>;
export declare function getRpcUrl(): string;
export declare function getRpc(): RPC;
export declare function getRpcBatcher(): {
    get: <T>(request: string, cacheable: boolean) => Promise<T>;
    process: () => void;
};
export declare function getHeaderByNumber(blockNumber: Hexadecimal): Promise<Header>;
export declare function getSyncedIndexer(): Promise<Indexer>;
export {};
//# sourceMappingURL=chain_adapter.d.ts.map