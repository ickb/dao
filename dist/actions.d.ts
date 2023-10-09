import { TransactionBuilder } from "./domain_logic";
export declare function fund(transactionBuilder: TransactionBuilder): Promise<TransactionBuilder>;
export declare function daoWithdrawAll(transactionBuilder: TransactionBuilder): Promise<TransactionBuilder>;
