import { ccc } from "@ckb-ccc/core";
import { getTransactionHeader, type TransactionHeader } from "./utils.js";
import { DAO_DEPOSIT_DATA, getDaoInterests, getDaoScript } from "./dao.js";

export interface UdtHandler {
  udt: ccc.Script;
  getInputsUdtBalance?: (
    client: ccc.Client,
    udt: ccc.Script,
    tx: ccc.Transaction,
  ) => Promise<bigint>;
  getOutputsUdtBalance?: (udt: ccc.Script, tx: ccc.Transaction) => bigint;
}

export class SmartTransaction extends ccc.Transaction {
  constructor(
    version: ccc.Num,
    cellDeps: ccc.CellDep[],
    headerDeps: ccc.Hex[],
    inputs: ccc.CellInput[],
    outputs: ccc.CellOutput[],
    outputsData: ccc.Hex[],
    witnesses: ccc.Hex[],
    public udtHandlers: UdtHandler[],
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
  ): ReturnType<ccc.Transaction["completeFee"]> {
    const signer = args[0];

    // Add change cells for all defined UDTs
    for (const { udt: udt } of this.udtHandlers) {
      await this.completeInputsByUdt(signer, udt);
    }

    // Double check that all UDTs are even out
    for (const { udt: udt } of this.udtHandlers) {
      const addedCount = await this.completeInputsByUdt(signer, udt);
      if (addedCount > 0) {
        throw new Error("UDT Handlers did not produce a balanced Transaction");
      }
    }

    // Add capacity change cells
    return super.completeFee(...args);
  }

  // Use input UDT handler if it exists
  override async getInputsUdtBalance(
    client: ccc.Client,
    udtLike: ccc.ScriptLike,
  ): Promise<bigint> {
    const udt = ccc.Script.from(udtLike);
    const getInputsBalance = this.getUdtHandler(udt)?.getInputsUdtBalance;
    if (getInputsBalance) {
      return getInputsBalance(client, udt, this);
    }
    return super.getInputsUdtBalance(client, udt);
  }

  // Use output UDT handler if it exists
  override getOutputsUdtBalance(udtLike: ccc.ScriptLike): bigint {
    const udt = ccc.Script.from(udtLike);
    const getOutputsBalance = this.getUdtHandler(udt)?.getOutputsUdtBalance;
    if (getOutputsBalance) {
      return getOutputsBalance(udt, this);
    }
    return super.getOutputsUdtBalance(udt);
  }

  // Account for deposit withdrawals extra capacity
  override async getInputsCapacity(client: ccc.Client): Promise<ccc.Num> {
    const dao = await getDaoScript(client);
    const knownTransactionHeaders = new Map<ccc.Hex, TransactionHeader>();
    const allowedHeaders = new Set(this.headerDeps);
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

        total += cellOutput.capacity;

        // If not NervosDAO cell, so no additional interests, return
        if (!cellOutput.type || !dao.eq(cellOutput.type)) {
          return total;
        }

        // Get header of NervosDAO cell and check its inclusion in HeaderDeps
        const { transaction, header } = await getTransactionHeader(
          client,
          previousOutput.txHash,
          knownTransactionHeaders,
          allowedHeaders,
        );

        // If deposit cell, so no additional interests, return
        if (outputData === DAO_DEPOSIT_DATA) {
          return total;
        }

        // It's a withdrawal request cell, get header of previous deposit cell
        const { header: depositHeader } = await getTransactionHeader(
          client,
          transaction.inputs[Number(previousOutput.index)].previousOutput
            .txHash,
          knownTransactionHeaders,
          allowedHeaders,
        );

        return (
          total +
          getDaoInterests(
            ccc.Cell.from({ previousOutput, cellOutput, outputData }),
            depositHeader,
            header,
          )
        );
      },
      ccc.numFrom(0),
    );
  }

  getUdtHandler(udt: ccc.ScriptLike): UdtHandler | undefined {
    const s = ccc.Script.from(udt);
    return this.udtHandlers.find((h) => h.udt.eq(s));
  }

  hasUdtHandler(udt: ccc.ScriptLike): boolean {
    return this.getUdtHandler(udt) !== undefined;
  }

  // Add UDT Handlers at the end, if not already present
  addUdtHandlers(...udtHandlers: (UdtHandler | UdtHandler[])[]): void {
    udtHandlers.flat().forEach((udtHandler) => {
      if (this.hasUdtHandler(udtHandler.udt)) {
        return;
      }

      this.udtHandlers.push(udtHandler);
    });
  }

  // Add UDT Handlers at the start, replacing any existing handler for the same UDTs
  addUdtHandlersAtStart(...udtHandlers: (UdtHandler | UdtHandler[])[]): void {
    const handlers = udtHandlers.flat().concat(this.udtHandlers);
    this.udtHandlers = [];
    this.addUdtHandlers(handlers);
  }

  addHeaderDeps(...headerDepLikes: (ccc.HexLike | ccc.HexLike[])[]): void {
    headerDepLikes.flat().forEach((headerDepLike) => {
      const headerDep = ccc.hexFrom(headerDepLike);
      if (this.headerDeps.some((h) => h === headerDep)) {
        return;
      }

      this.headerDeps.push(headerDep);
    });
  }

  // Override all methods that transform ccc.Transaction(s)

  static override default(): SmartTransaction {
    return new SmartTransaction(0n, [], [], [], [], [], [], []);
  }

  override clone(): SmartTransaction {
    return SmartTransaction.from(super.clone(), {
      udtHandlers: this.udtHandlers,
    });
  }

  // Copy from input transaction, while keeping all unique UDT handlers with the following priority:
  // 1. options.udtHandlers
  // 2. txLike.udtHandlers
  // 3. this.udtHandlers
  override copy(
    txLike: SmartTransactionLike,
    options?: { udtHandlers?: UdtHandler[] },
  ): void {
    const oldUdtHandlers = this.udtHandlers;

    const tx = SmartTransaction.from(txLike, options);
    this.version = tx.version;
    this.cellDeps = tx.cellDeps;
    this.headerDeps = tx.headerDeps;
    this.outputs = tx.outputs;
    this.outputsData = tx.outputsData;
    this.witnesses = tx.witnesses;
    this.udtHandlers = tx.udtHandlers;

    this.addUdtHandlers(oldUdtHandlers);
  }

  static override fromLumosSkeleton(
    skeleton: ccc.LumosTransactionSkeletonType,
    options?: { udtHandlers?: UdtHandler[] },
  ): SmartTransaction {
    return SmartTransaction.from(super.fromLumosSkeleton(skeleton), options);
  }

  // Create a transaction from an input transaction,
  // while keeping all unique UDT handlers with the following priority:
  // 1. options.udtHandlers
  // 2. txLike.udtHandlers
  static override from(
    txLike: SmartTransactionLike,
    options?: { udtHandlers?: UdtHandler[] },
  ): SmartTransaction {
    const optionsUdtHandlers = options?.udtHandlers ?? [];

    if (txLike instanceof SmartTransaction && optionsUdtHandlers.length === 0) {
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
    } =
      txLike instanceof SmartTransaction
        ? txLike
        : ccc.Transaction.from(txLike);
    const udtHandlers = txLike.udtHandlers ?? [];

    const result = new SmartTransaction(
      version,
      cellDeps,
      headerDeps,
      inputs,
      outputs,
      outputsData,
      witnesses,
      udtHandlers,
    );
    result.addUdtHandlersAtStart(optionsUdtHandlers);
    return result;
  }
}

export type SmartTransactionLike = ccc.TransactionLike & {
  udtHandlers?: UdtHandler[];
};
