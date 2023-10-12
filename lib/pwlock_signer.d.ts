import { Script } from "@ckb-lumos/base";
import { TransactionSkeletonType } from "@ckb-lumos/helpers";
interface EthereumRpc {
    (payload: {
        method: 'personal_sign';
        params: [string, string];
    }): Promise<string>;
}
export interface EthereumProvider {
    selectedAddress: string;
    isMetaMask?: boolean;
    enable: () => Promise<string[]>;
    addListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    removeEventListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    request: EthereumRpc;
}
export declare function getEthereumProvider(): EthereumProvider;
export declare function signer(transaction: TransactionSkeletonType, accountLock: Script): Promise<import("@ckb-lumos/base").Transaction>;
export {};
//# sourceMappingURL=pwlock_signer.d.ts.map