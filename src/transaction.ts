import { ccc } from "@ckb-ccc/core";
import {
  getTransactionHeader,
  getDaoInterests,
  type TransactionHeader,
} from "./utils.js";

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

  // Automatically add change cells for UDT for which a handler is defined
  override async completeFee(
    ...args: Parameters<ccc.Transaction["completeFee"]>
  ): ReturnType<ccc.Transaction["completeFee"]> {
    const signer = args[0];
    for (const { udt: udt } of this.udtHandlers) {
      await this.completeInputsByUdt(signer, udt);
    }
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
    const dao = await ccc.Script.fromKnownScript(
      client,
      ccc.KnownScript.NervosDao,
      "0x",
    );
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
    return this.udtHandlers.find((h) => h.udt.eq(udt));
  }

  addUdtHandlers(...udtHandlers: (UdtHandler | UdtHandler[])[]): void {
    udtHandlers.flat().forEach((udtHandler) => {
      if (this.udtHandlers.some((h) => h.udt.eq(udtHandler.udt))) {
        return;
      }

      this.udtHandlers.push(udtHandler);
    });
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

  override copy(txLike: SmartTransactionLike): void {
    // Preserve old UDT handlers with lower priority
    const oldUdtHandlers = this.udtHandlers;

    super.copy(txLike);
    this.udtHandlers = Array.from(txLike.udtHandlers ?? []);
    this.addUdtHandlers(oldUdtHandlers);
  }

  static override fromLumosSkeleton(
    skeleton: ccc.LumosTransactionSkeletonType,
    options?: { udtHandlers?: UdtHandler[] },
  ): SmartTransaction {
    return SmartTransaction.from(super.fromLumosSkeleton(skeleton), options);
  }

  static override from(
    txLike: SmartTransactionLike,
    options?: { udtHandlers?: UdtHandler[] },
  ): SmartTransaction {
    const optUdtHandlers = options?.udtHandlers;
    if (txLike instanceof SmartTransaction && !optUdtHandlers) {
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

    const udtHandlers = Array.from(optUdtHandlers ?? txLike.udtHandlers ?? []);

    const res = new SmartTransaction(
      version,
      cellDeps,
      headerDeps,
      inputs,
      outputs,
      outputsData,
      witnesses,
      udtHandlers,
    );

    // Preserve old txLike UDT handlers with lower priority
    if (optUdtHandlers && txLike.udtHandlers) {
      res.addUdtHandlers(txLike.udtHandlers);
    }

    return res;
  }
}

export type SmartTransactionLike = ccc.TransactionLike & {
  udtHandlers?: UdtHandler[];
};

const DAO_DEPOSIT_DATA = "0x0000000000000000";
