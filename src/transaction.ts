import { ccc } from "@ckb-ccc/core";
import { getTransactionHeader, type TransactionHeader } from "./utils.js";
import { Dao, WithdrawalRequest } from "./dao.js";

/**
 * Interface representing a handler for User Defined Tokens (UDTs).
 */
export interface UdtHandler {
  /** The script associated with the UDT. */
  script: ccc.Script;

  /** The cellDeps associated with the UDT. */
  cellDeps: ccc.CellDep[];

  /**
   * Asynchronously retrieves the balance of UDT inputs for a given transaction.
   * @param client - The client instance used to interact with the blockchain.
   * @param tx - The SmartTransaction for which to retrieve the UDT Inputs balance.
   * @returns A promise that resolves to the balance of UDT inputs.
   */
  getInputsUdtBalance?: (
    client: ccc.Client,
    tx: SmartTransaction,
  ) => Promise<bigint>;

  /**
   * Retrieves the balance of UDT outputs for a given transaction.
   * @param tx - The SmartTransaction for which to retrieve the UDT Outputs balance.
   * @returns The balance of UDT outputs.
   */
  getOutputsUdtBalance?: (tx: SmartTransaction) => bigint;
}

/**
 * Class representing a smart transaction that extends the base ccc.Transaction.
 * This class manages UDT handlers and transaction headers, providing additional functionality
 * for handling UDTs and ensuring balanced transactions.
 *
 * Notes:
 * - udtHandlers and transactionHeaders are always shared among descendants.
 * - transactionHeaders may not contain all headers referenced by headerDeps.
 */
export class SmartTransaction extends ccc.Transaction {
  /**
   * Creates an instance of SmartTransaction.
   * @param version - The version of the transaction.
   * @param cellDeps - The cell dependencies for the transaction.
   * @param headerDeps - The header dependencies for the transaction.
   * @param inputs - The inputs for the transaction.
   * @param outputs - The outputs for the transaction.
   * @param outputsData - The data associated with the outputs.
   * @param witnesses - The witnesses for the transaction.
   * @param udtHandlers - A map of UDT handlers associated with the transaction.
   * @param transactionHeaders - A map of transaction headers associated with the transaction.
   */
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

  /**
   * Automatically adds change cells for both capacity and UDTs for which a handler is defined.
   * @param args - The parameters for the completeFee method.
   * @returns A promise that resolves to a tuple containing the quantity of added capacity cells
   * and a boolean indicating if an output capacity change cells was added.
   */
  override async completeFee(
    ...args: Parameters<ccc.Transaction["completeFee"]>
  ): Promise<[number, boolean]> {
    const signer = args[0];

    // Add change cells for all defined UDTs
    for (const { script: udt } of this.udtHandlers.values()) {
      await this.completeInputsByUdt(signer, udt);
    }

    // Double check that all UDTs are even out
    for (const { script: udt } of this.udtHandlers.values()) {
      const addedCount = await this.completeInputsByUdt(signer, udt);
      if (addedCount > 0) {
        throw new Error("UDT Handlers did not produce a balanced Transaction");
      }
    }

    // Add capacity change cells
    return super.completeFee(...args);
  }

  /**
   * Retrieves the balance of UDT inputs using the appropriate handler if it exists.
   * @param client - The client instance used to interact with the blockchain.
   * @param udtLike - The UDT script or script-like object.
   * @returns A promise that resolves to the balance of UDT inputs.
   */
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

  /**
   * Retrieves the balance of UDT outputs using the appropriate handler if it exists.
   * @param client - The client instance used to interact with the blockchain.
   * @param udtLike - The UDT script or script-like object.
   * @returns A promise that resolves to the balance of UDT outputs.
   */
  override getOutputsUdtBalance(udtLike: ccc.ScriptLike): bigint {
    const udt = ccc.Script.from(udtLike);
    return (
      this.getUdtHandler(udt)?.getOutputsUdtBalance?.(this) ??
      super.getOutputsUdtBalance(udt)
    );
  }

  /**
   * Asynchronously retrieves the total capacity of inputs, accounting for deposit withdrawals' extra capacity.
   * @param client - The client instance used to interact with the blockchain.
   * @returns A promise that resolves to the total capacity of inputs.
   */
  override async getInputsCapacity(client: ccc.Client): Promise<ccc.Num> {
    const { hashType, codeHash } = await client.getKnownScript(
      ccc.KnownScript.NervosDao,
    );
    const dao = new Dao(
      ccc.Script.from({ codeHash, hashType, args: "0x" }),
      [],
    );

    return ccc.reduceAsync(
      this.inputs,
      async (total, input) => {
        // Get all cell info
        await input.completeExtraInfos(client);
        const { previousOutput: outPoint, cellOutput, outputData } = input;

        // Input is not well defined
        if (!cellOutput || !outputData) {
          throw new Error("Unable to complete input");
        }
        const cell = ccc.Cell.from({
          outPoint,
          cellOutput,
          outputData,
        });

        total += cellOutput.capacity;

        // If not a NervosDAO Withdrawal Request cell, return
        if (!dao.isWithdrawalRequest(cell)) {
          return total;
        }

        // Get header of NervosDAO cell and check its inclusion in HeaderDeps
        const transactionHeader = await this.getTransactionHeader(
          client,
          outPoint.txHash,
        );

        // It's a withdrawal request cell, get header of previous deposit cell
        const depositTransactionHeader = await this.getTransactionHeader(
          client,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          transactionHeader.transaction.inputs[Number(outPoint.index)]!
            .previousOutput.txHash,
        );

        const withdrawalRequest = new WithdrawalRequest(
          cell,
          depositTransactionHeader,
          transactionHeader,
        );

        return total + withdrawalRequest.interests;
      },
      ccc.numFrom(0),
    );
  }

  /**
   * Generates a unique key for a UDT based on its script.
   * @param udt - The UDT script or script-like object.
   * @returns A string representing the unique key for the UDT in udtHandlers.
   */
  static getUdtKey(udt: ccc.ScriptLike): string {
    return ccc.Script.from(udt).toBytes().toString();
  }

  /**
   * Retrieves the UDT handler associated with a given UDT.
   * @param udt - The UDT script or script-like object.
   * @returns The UdtHandler associated with the UDT, or undefined if not found.
   */
  getUdtHandler(udt: ccc.ScriptLike): UdtHandler | undefined {
    return this.udtHandlers.get(SmartTransaction.getUdtKey(udt));
  }

  /**
   * Checks if a UDT handler exists for a given UDT.
   * @param udt - The UDT script or script-like object.
   * @returns A boolean indicating whether a UDT handler exists for the UDT.
   */
  hasUdtHandler(udt: ccc.ScriptLike): boolean {
    return this.udtHandlers.has(SmartTransaction.getUdtKey(udt));
  }

  /**
   * Adds UDT handlers to the transaction, substituting in-place if a handler for the same UDT already exists.
   * @param udtHandlers - One or more UDT handlers to add.
   */
  addUdtHandlers(...udtHandlers: (UdtHandler | UdtHandler[])[]): void {
    udtHandlers.flat().forEach((udtHandler) => {
      this.udtHandlers.set(
        SmartTransaction.getUdtKey(udtHandler.script),
        udtHandler,
      );
      this.addCellDeps(udtHandler.cellDeps);
    });
  }

  /**
   * Adds transaction headers to both headerDeps and transactionHeaders if not already present.
   * @param transactionHeaders - One or more transaction headers to add.
   */
  addTransactionHeaders(
    ...transactionHeaders: (TransactionHeader | TransactionHeader[])[]
  ): void {
    transactionHeaders.flat().forEach((transactionHeader) => {
      const txhash = transactionHeader.transaction.hash();
      const headerDep = transactionHeader.header.hash;

      if (!this.transactionHeaders.has(txhash)) {
        this.transactionHeaders.set(txhash, transactionHeader);
      } else if (
        headerDep !== this.transactionHeaders.get(txhash)?.header.hash
      ) {
        throw new Error(
          "The same transaction cannot have two distinct headers",
        );
      }

      if (!this.headerDeps.some((h) => h === headerDep)) {
        this.headerDeps.push(headerDep);
      }
    });
  }

  /**
   * Retrieves a TransactionHeader when its header hash already exists in headerDeps,
   * possibly recording it to the transaction's transactionHeaders
   * @param client - The client instance used to interact with the blockchain.
   * @param transactionHash - The hash of the transaction for which to retrieve the header.
   * @returns A promise that resolves to the TransactionHeader associated with the given transaction hash.
   * @throws An error if the header hash is not found in headerDeps.
   */
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

  /**
   * Creates a default instance of SmartTransaction.
   * @returns A new instance of SmartTransaction with default values.
   */
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

  /**
   * Clones the transaction part and shares udtHandlers and transactionHeaders.
   * @returns A new instance of SmartTransaction that is a clone of the current instance.
   */
  override clone(): SmartTransaction {
    const result = SmartTransaction.from(super.clone());
    result.udtHandlers = this.udtHandlers;
    result.transactionHeaders = this.transactionHeaders;
    return result;
  }

  /**
   * Copies data from an input transaction.
   * @param txLike - The transaction-like object to copy from.
   */
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

  /**
   * Creates a SmartTransaction from a Lumos transaction skeleton.
   * @param skeleton - The Lumos transaction skeleton to convert.
   * @returns A new instance of SmartTransaction created from the skeleton.
   */
  static override fromLumosSkeleton(
    skeleton: ccc.LumosTransactionSkeletonType,
  ): SmartTransaction {
    return SmartTransaction.from(super.fromLumosSkeleton(skeleton));
  }

  /**
   * Creates a SmartTransaction from an input transaction and shares udtHandlers and transactionHeaders.
   * @param txLike - The transaction-like object to create the SmartTransaction from.
   * @returns A new instance of SmartTransaction created from the input transaction.
   */
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

/**
 * Type representing a transaction-like object that includes optional UDT handlers and transaction headers.
 */
export type SmartTransactionLike = ccc.TransactionLike & {
  /** Optional map of UDT handlers associated with the transaction. */
  udtHandlers?: Map<string, UdtHandler>;
  /** Optional map of transaction headers associated with the transaction. */
  transactionHeaders?: Map<ccc.Hex, TransactionHeader>;
};
