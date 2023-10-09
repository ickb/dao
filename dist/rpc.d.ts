import { RPC } from "@ckb-lumos/rpc";
import { Indexer } from "@ckb-lumos/ckb-indexer";
import { Header, Hexadecimal } from "@ckb-lumos/base";
export declare function getRpcUrl(): Promise<string>;
export declare function getRpc(): Promise<RPC>;
export declare function getRpcBatcher(): Promise<{
    get: <T>(request: string, cacheable: boolean) => Promise<T>;
    process: () => void;
}>;
export declare function getHeaderByNumber(blockNumber: Hexadecimal): Promise<Header>;
export declare function getSyncedIndexer(): Promise<Indexer>;
