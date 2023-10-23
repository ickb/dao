import { BI, BIish } from "@ckb-lumos/bi";
import { Cell, OutPoint, Script } from "@ckb-lumos/base";
import { TransactionSkeletonType } from "@ckb-lumos/helpers";
export declare function scriptEq(s0: Script | undefined, s1: Script | undefined): boolean;
export declare function scriptIs(s0: Script, name: string): boolean;
export declare const DAO_DEPOSIT_DATA = "0x0000000000000000";
export declare function isDAODeposit(c: Cell): boolean;
export declare function isDAOWithdrawal(c: Cell): boolean;
export type Epoch = {
    length: BI;
    index: BI;
    number: BI;
};
export declare function parseEpoch(epoch: BIish): Epoch;
export declare function epochCompare(e0: Epoch, e1: Epoch): 1 | 0 | -1;
export declare function stringifyEpoch(e: Epoch): string;
export declare function txSize(transaction: TransactionSkeletonType): number;
export declare function calculateFee(size: number, feeRate: BIish): BI;
export declare function getLiveCell(outPoint: OutPoint): Promise<Cell>;
//# sourceMappingURL=utils.d.ts.map