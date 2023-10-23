import { BI } from "@ckb-lumos/bi";
import { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { Cell, Header, Hexadecimal, Script, Transaction } from "@ckb-lumos/base";
export declare class TransactionBuilder {
    protected readonly accountLock: Script;
    protected readonly signer: (tx: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>;
    protected readonly getHeaderByNumber: (blockNumber: Hexadecimal) => Promise<Header>;
    protected readonly feeRate: BI;
    protected inputs: Cell[];
    protected outputs: Cell[];
    constructor(accountLock: Script, signer: (tx: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>, getHeaderByNumber?: (blockNumber: Hexadecimal) => Promise<Header>, feeRate?: BI);
    add(source: "input" | "output", position: "start" | "end", ...cells: Cell[]): this;
    buildAndSend(secondsTimeout?: number): Promise<{
        transaction: import("immutable").Record<import("@ckb-lumos/helpers").TransactionSkeletonInterface> & Readonly<import("@ckb-lumos/helpers").TransactionSkeletonInterface>;
        fee: BI;
        signedTransaction: Transaction;
        txHash: string;
    }>;
    toTransactionSkeleton(): Promise<{
        transaction: import("immutable").Record<import("@ckb-lumos/helpers").TransactionSkeletonInterface> & Readonly<import("@ckb-lumos/helpers").TransactionSkeletonInterface>;
        fee: BI;
    }>;
    protected buildWithChange(ckbDelta: BI, ...changeCells: Cell[]): Promise<import("immutable").Record<import("@ckb-lumos/helpers").TransactionSkeletonInterface> & Readonly<import("@ckb-lumos/helpers").TransactionSkeletonInterface>>;
    getCkbDelta(): Promise<BI>;
    protected withdrawedDaoSince(c: Cell): Promise<BI>;
    getAccountLock(): Script;
}
//# sourceMappingURL=domain_logic.d.ts.map