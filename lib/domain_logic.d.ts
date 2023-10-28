import { BI } from "@ckb-lumos/bi";
import { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { Cell, Header, Hexadecimal, Script, Transaction } from "@ckb-lumos/base";
export declare class TransactionBuilder {
    protected readonly accountLock: Script;
    protected readonly signer: (tx: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>;
    protected readonly getHeaderByNumber: (blockNumber: Hexadecimal) => Promise<Header>;
    protected readonly feeRate: BI;
    protected readonly padAllLockOccurrences: boolean;
    protected inputs: Cell[];
    protected outputs: Cell[];
    constructor(accountLock: Script, signer: (tx: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>, getHeaderByNumber?: (blockNumber: Hexadecimal) => Promise<Header>, feeRate?: BI, padAllLockOccurrences?: boolean);
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
    protected build(ckbDelta: BI): Promise<import("immutable").Record<import("@ckb-lumos/helpers").TransactionSkeletonInterface> & Readonly<import("@ckb-lumos/helpers").TransactionSkeletonInterface>>;
    protected toChange(ckbDelta: BI, changeCells?: Cell[]): Promise<Cell[]>;
    getCkbDelta(inputs?: Cell[], outputs?: Cell[]): Promise<BI>;
    withdrawedDaoSince(c: Cell): Promise<BI>;
    getAccountLock(): Script;
    protected addCellDeps(transaction: TransactionSkeletonType): TransactionSkeletonType;
    protected addHeaderDeps(transaction: TransactionSkeletonType): Promise<TransactionSkeletonType>;
    protected getHeaderDepsBlockNumbers(transaction: TransactionSkeletonType): Promise<Hexadecimal[]>;
    protected addInputSinces(transaction: TransactionSkeletonType): Promise<TransactionSkeletonType>;
    protected addWitnessPlaceholders(transaction: TransactionSkeletonType): Promise<TransactionSkeletonType>;
    protected sendTransaction(signedTransaction: Transaction, secondsTimeout: number): Promise<string>;
}
//# sourceMappingURL=domain_logic.d.ts.map