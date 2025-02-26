import { ccc } from "@ckb-ccc/core";
import { getTransactionHeader, type TransactionHeader } from "./utils.js";
import { Dao } from "./dao.js";

export interface UdtHandler {
  udt: ccc.Script;
  getInputsUdtBalance?: (
    client: ccc.Client,
    tx: SmartTransaction,
  ) => Promise<bigint>;
  getOutputsUdtBalance?: (tx: SmartTransaction) => bigint;
}

// udtHandlers and transactionHeaders are always shared among descendants.
// transactionHeaders may not contain all headers referenced by headerDeps.
export class SmartTransaction extends ccc.Transaction {
  constructor(
    version: ccc.Num,
    cellDeps: ccc.CellDep[],
    headerDeps: ccc.Hex[],
    inputs: ccc.CellInput[],
    outputs: ccc.CellOutput[],
    outputsData: ccc.Hex[],
    witnesses: ccc.Hex[],
    public udtHandlers: Map<string, UdtHandler>,
    public transactionHeaders: Map<ccc.Hex, TransactionHeader>,
  ) {
    super(
      version,
      cellDeps,
      headerDeps,
      inputs,
      outputs,
      outputsData,
      witnesses,
    );
  }

  // Automatically add change cells for both capacity and UDTs for which a handler is defined
  override async completeFee(
    ...args: Parameters<ccc.Transaction["completeFee"]>
  ): Promise<[number, boolean]> {
    const signer = args[0];

    // Add change cells for all defined UDTs
    for (const { udt } of this.udtHandlers.values()) {
      await this.completeInputsByUdt(signer, udt);
    }

    // Double check that all UDTs are even out
    for (const { udt } of this.udtHandlers.values()) {
      const addedCount = await this.completeInputsByUdt(signer, udt);
      if (addedCount > 0) {
        throw new Error("UDT Handlers did not produce a balanced Transaction");
      }
    }

    // Add capacity change cells
    return super.completeFee(...args);
  }

  // Use input UDT handler if it exists, otherwise the use default one
  override getInputsUdtBalance(
    client: ccc.Client,
    udtLike: ccc.ScriptLike,
  ): Promise<bigint> {
    const udt = ccc.Script.from(udtLike);
    return (
      this.getUdtHandler(udt)?.getInputsUdtBalance?.(client, this) ??
      super.getInputsUdtBalance(client, udt)
    );
  }

  // Use output UDT handler if it exists, otherwise the use default one
  override getOutputsUdtBalance(udtLike: ccc.ScriptLike): bigint {
    const udt = ccc.Script.from(udtLike);
    return (
      this.getUdtHandler(udt)?.getOutputsUdtBalance?.(this) ??
      super.getOutputsUdtBalance(udt)
    );
  }

  // Account for deposit withdrawals extra capacity
  override async getInputsCapacity(client: ccc.Client): Promise<ccc.Num> {
    const dao = await Dao.from(client);
    return ccc.reduceAsync(
      this.inputs,
      async (total, input) => {
        // Get all cell info
        await input.completeExtraInfos(client);
        const { previousOutput, cellOutput, outputData } = input;

        // Input is not well defined
        if (!cellOutput || !outputData) {
          throw new Error("Unable to complete input");
        }
        const cell = ccc.Cell.from({ previousOutput, cellOutput, outputData });

        total += cellOutput.capacity;

        // If not Withdrawal Request cell, so no additional interests, return
        if (!dao.isWithdrawalRequest(cell)) {
          return total;
        }

        // Get header of NervosDAO cell and check its inclusion in HeaderDeps
        const { transaction, header } = await this.getTransactionHeader(
          client,
          previousOutput.txHash,
        );

        // It's a withdrawal request cell, get header of previous deposit cell
        const { header: depositHeader } = await this.getTransactionHeader(
          client,
          transaction.inputs[Number(previousOutput.index)].previousOutput
            .txHash,
        );

        return total + Dao.getInterests(cell, depositHeader, header);
      },
      ccc.numFrom(0),
    );
  }

  static getUdtKey(udt: ccc.ScriptLike): string {
    return ccc.Script.from(udt).toBytes().toString();
  }

  getUdtHandler(udt: ccc.ScriptLike): UdtHandler | undefined {
    return this.udtHandlers.get(SmartTransaction.getUdtKey(udt));
  }

  hasUdtHandler(udt: ccc.ScriptLike): boolean {
    return this.udtHandlers.has(SmartTransaction.getUdtKey(udt));
  }

  // Add UDT Handlers, substitute in-place if present
  addUdtHandlers(...udtHandlers: (UdtHandler | UdtHandler[])[]): void {
    udtHandlers.flat().forEach((udtHandler) => {
      this.udtHandlers.set(
        SmartTransaction.getUdtKey(udtHandler.udt),
        udtHandler,
      );
    });
  }

  // Add Headers both to headerDeps and transactionHeaders,
  // substituted in-place if already present
  addTransactionHeaders(
    ...transactionHeaders: (TransactionHeader | TransactionHeader[])[]
  ): void {
    transactionHeaders.flat().forEach((transactionHeader) => {
      const headerDep = transactionHeader.header.hash;
      const headerDepIndex = this.headerDeps.findIndex((h) => h === headerDep);
      if (headerDepIndex === -1) {
        this.headerDeps.push(headerDep);
      } /*else { // Commented out as it doesn't change anything
        this.headerDeps[headerDepIndex] = headerDep;
      }*/

      this.transactionHeaders.set(
        transactionHeader.transaction.hash(),
        transactionHeader,
      );
    });
  }

  // Get a TransactionHeader when its Header hash already exists in HeaderDeps
  // Possibly recording it to transaction's transactionHeaders
  async getTransactionHeader(
    client: ccc.Client,
    transactionHash: ccc.Hex,
  ): Promise<TransactionHeader> {
    let result = this.transactionHeaders.get(transactionHash);
    if (!result) {
      result = await getTransactionHeader(client, transactionHash);
      // Record it in transactionHeaders
      this.transactionHeaders.set(transactionHash, result);
    }

    // Check that its Header hash already exists in HeaderDeps
    const headerDep = result.header.hash;
    if (!this.headerDeps.some((h) => h === headerDep)) {
      throw new Error("Header not found in HeaderDeps");
    }

    return result;
  }

  // Override all methods that transform ccc.Transaction(s)

  static override default(): SmartTransaction {
    return new SmartTransaction(
      0n,
      [],
      [],
      [],
      [],
      [],
      [],
      new Map(),
      new Map(),
    );
  }

  // Clone the Transaction part and share udtHandlers and transactionHeaders
  override clone(): SmartTransaction {
    const result = SmartTransaction.from(super.clone());
    result.udtHandlers = this.udtHandlers;
    result.transactionHeaders = this.transactionHeaders;
    return result;
  }

  // Copy from input transaction
  override copy(txLike: SmartTransactionLike): void {
    const tx = SmartTransaction.from(txLike);
    this.version = tx.version;
    this.cellDeps = tx.cellDeps;
    this.headerDeps = tx.headerDeps;
    this.inputs = tx.inputs;
    this.outputs = tx.outputs;
    this.outputsData = tx.outputsData;
    this.witnesses = tx.witnesses;
    this.udtHandlers = tx.udtHandlers;
    this.transactionHeaders = tx.transactionHeaders;
  }

  static override fromLumosSkeleton(
    skeleton: ccc.LumosTransactionSkeletonType,
  ): SmartTransaction {
    return SmartTransaction.from(super.fromLumosSkeleton(skeleton));
  }

  // Create a transaction from an input transaction and share udtHandlers and transactionHeaders
  static override from(txLike: SmartTransactionLike): SmartTransaction {
    if (txLike instanceof SmartTransaction) {
      return txLike;
    }

    const {
      version,
      cellDeps,
      headerDeps,
      inputs,
      outputs,
      outputsData,
      witnesses,
    } = ccc.Transaction.from(txLike);

    const udtHandlers = txLike.udtHandlers ?? new Map<string, UdtHandler>();
    const transactionHeaders =
      txLike.transactionHeaders ?? new Map<ccc.Hex, TransactionHeader>();

    return new SmartTransaction(
      version,
      cellDeps,
      headerDeps,
      inputs,
      outputs,
      outputsData,
      witnesses,
      udtHandlers,
      transactionHeaders,
    );
  }
}

export type SmartTransactionLike = ccc.TransactionLike & {
  udtHandlers?: Map<string, UdtHandler>;
  transactionHeaders?: Map<ccc.Hex, TransactionHeader>;
};
