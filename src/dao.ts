import { ccc, mol } from "@ckb-ccc/core";
import type { SmartTransaction, TransactionHeader } from "./transaction.js";
import { epochCompare, getHeader } from "./utils.js";

/**
 * Represents NervosDAO functionalities.
 */
export class Dao {
  /**
   * Creates an instance of the Dao class.
   *
   * @param script - The script associated with the NervosDAO.
   * @param cellDeps - An array of cell dependencies for the NervosDAO.
   */
  constructor(
    public script: ccc.Script,
    public cellDeps: ccc.CellDep[],
  ) {}

  /**
   * Checks if a given cell is a deposit.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a deposit, otherwise false.
   */
  isDeposit(cell: ccc.CellLike): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = ccc.Cell.from(cell);

    return outputData === Dao.depositData() && type?.eq(this.script) === true;
  }

  /**
   * Checks if a given cell is a withdrawal request.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a withdrawal request, otherwise false.
   */
  isWithdrawalRequest(cell: ccc.CellLike): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = ccc.Cell.from(cell);

    return outputData !== Dao.depositData() && type?.eq(this.script) === true;
  }

  /**
   * Returns the deposit data.
   *
   * @returns The deposit data as a hexadecimal string.
   */
  static depositData(): ccc.Hex {
    return "0x0000000000000000";
  }

  /**
   * Adds a deposit to a transaction.
   *
   * @param tx - The transaction to which the deposit will be added.
   * @param capacities - An array of capacities of the deposits to create.
   * @param lock - The lock script for the outputs.
   * @returns void.
   */
  deposit(
    tx: SmartTransaction,
    capacities: ccc.FixedPoint[],
    lock: ccc.ScriptLike,
  ): void {
    tx.addCellDeps(this.cellDeps);

    const l = ccc.Script.from(lock);
    for (const capacity of capacities) {
      tx.addOutput(
        {
          capacity,
          lock: l,
          type: this.script,
        },
        Dao.depositData(),
      );
    }
  }

  /**
   * Requests withdrawal from NervosDAO deposits.
   *
   * @param tx - The transaction to which the withdrawal request will be added.
   * @param deposits - An array of deposits to request the withdrawal from.
   * @param lock - The lock script for the withdrawal request cells.
   * @param sameSizeArgs - Whether to enforce the same size for lock args (default: true).
   * @returns void.
   * @throws Error if the transaction has different input and output lengths.
   * @throws Error if the withdrawal request lock args have a different size from the deposit.
   * @throws Error if the transaction or header of deposit is not found.
   */
  requestWithdrawal(
    tx: SmartTransaction,
    deposits: Deposit[],
    lock: ccc.ScriptLike,
    sameSizeArgs = true,
  ): SmartTransaction {
    if (
      tx.inputs.length != tx.outputs.length ||
      tx.outputs.length != tx.outputsData.length
    ) {
      throw new Error("Transaction have different inputs and outputs lengths");
    }

    tx.addCellDeps(this.cellDeps);

    const l = ccc.Script.from(lock);
    for (const deposit of deposits) {
      const { cell, transactionHeaders } = deposit;
      if (sameSizeArgs && cell.cellOutput.lock.args.length != l.args.length) {
        throw new Error(
          "Withdrawal request lock args has different size from deposit",
        );
      }

      const depositTransactionHeader = transactionHeaders[0];
      if (!depositTransactionHeader) {
        throw Error("Deposit TransactionHeader not found in Deposit");
      }

      tx.addHeaders(transactionHeaders);
      tx.addInput(cell);
      tx.addOutput(
        {
          capacity: cell.cellOutput.capacity,
          lock: l,
          type: this.script,
        },
        mol.Uint64LE.encode(depositTransactionHeader.header.number),
      );
    }

    return tx;
  }

  /**
   * Withdraws funds from the NervosDAO based on the provided mature withdrawal requests.
   *
   * @param tx - The transaction to which the withdrawal will be added.
   * @param withdrawalRequests - An array of withdrawal requests to process.
   * @returns void.
   */
  withdraw(
    tx: SmartTransaction,
    withdrawalRequests: WithdrawalRequest[],
  ): void {
    tx.addCellDeps(this.cellDeps);

    for (const withdrawalRequest of withdrawalRequests) {
      const {
        cell: { outPoint, cellOutput, outputData },
        transactionHeaders,
        maturity,
      } = withdrawalRequest;
      tx.addHeaders(transactionHeaders);

      const depositTransactionHeader = transactionHeaders[0];
      if (!depositTransactionHeader) {
        throw Error("Deposit TransactionHeader not found in WithdrawalRequest");
      }
      const headerIndex = tx.headerDeps.findIndex(
        (h) => h === depositTransactionHeader.header.hash,
      );

      const inputIndex =
        tx.addInput({
          outPoint,
          cellOutput,
          outputData,
          since: {
            relative: "absolute",
            metric: "epoch",
            value: ccc.epochToHex(maturity),
          },
        }) - 1;

      const witness =
        tx.getWitnessArgsAt(inputIndex) ?? ccc.WitnessArgs.from({});
      if (witness.inputType) {
        throw new Error("Witnesses of withdrawal request already in use");
      }
      witness.inputType = ccc.hexFrom(ccc.numLeToBytes(headerIndex, 8));
      tx.setWitnessArgsAt(inputIndex, witness);
    }
  }

  /**
   * Asynchronously finds deposits associated with a given lock script.
   *
   * @param client - The client used to interact with the blockchain.
   * @param lock - The lock script to filter deposits.
   * @param options - Optional parameters for the search.
   * @param options.tip - An optional tip block header to use as a reference.
   * @param options.onChain - A boolean indicating whether to use the cells cache or directly search on-chain.
   * @returns An async generator that yields Deposit objects.
   */
  async *findDeposits(
    client: ccc.Client,
    lock: ccc.ScriptLike,
    options?: {
      tip?: ccc.ClientBlockHeaderLike;
      onChain?: boolean;
    },
  ): AsyncGenerator<Deposit> {
    const tipHeader = options?.tip
      ? ccc.ClientBlockHeader.from(options.tip)
      : await client.getTipHeader();

    const findCellsArgs = [
      {
        script: lock,
        scriptType: "lock",
        filter: {
          script: this.script,
          outputData: Dao.depositData(),
          outputDataSearchMode: "exact",
        },
        scriptSearchMode: "exact",
        withData: true,
      },
      "asc",
      400, // https://github.com/nervosnetwork/ckb/pull/4576
    ] as const;

    for await (const cell of options?.onChain
      ? client.findCellsOnChain(...findCellsArgs)
      : client.findCells(...findCellsArgs)) {
      if (!this.isDeposit(cell) || !cell.cellOutput.lock.eq(lock)) {
        continue;
      }

      const txHash = cell.outPoint.txHash;
      const header = await getHeader(client, {
        type: "txHash",
        value: txHash,
      });

      yield new Deposit(cell, { header, txHash }, tipHeader);
    }
  }

  /**
   * Asynchronously finds withdrawal requests associated with a given lock script.
   *
   * @param client - The client used to interact with the blockchain.
   * @param lock - The lock script to filter withdrawal requests.
   * @param options - Optional parameters for the search.
   * @param options.onChain - A boolean indicating whether to use the cells cache or directly search on-chain.
   * @returns An async generator that yields WithdrawalRequest objects.
   */
  async *findWithdrawalRequests(
    client: ccc.Client,
    lock: ccc.ScriptLike,
    options?: {
      onChain?: boolean;
    },
  ): AsyncGenerator<WithdrawalRequest> {
    const findCellsArgs = [
      {
        script: lock,
        scriptType: "lock",
        filter: {
          script: this.script,
        },
        scriptSearchMode: "exact",
        withData: true,
      },
      "asc",
      400, // https://github.com/nervosnetwork/ckb/pull/4576
    ] as const;

    for await (const cell of options?.onChain
      ? client.findCellsOnChain(...findCellsArgs)
      : client.findCells(...findCellsArgs)) {
      if (!this.isWithdrawalRequest(cell) || !cell.cellOutput.lock.eq(lock)) {
        continue;
      }

      const txHash = cell.outPoint.txHash;
      const header = await getHeader(client, {
        type: "txHash",
        value: txHash,
      });

      const depositHeader = await getHeader(client, {
        type: "number",
        value: header.number,
      });

      yield new WithdrawalRequest(
        cell,
        { header: depositHeader },
        { header, txHash },
      );
    }
  }
}

/**
 * Abstract class representing a NervosDAO cell.
 * This class serves as a base for specific types of NervosDAO cells, such as deposits and withdrawal requests.
 */
export abstract class DaoCell {
  /** The cell associated with this NervosDAO cell. */
  public cell: ccc.Cell;

  /** An array of transaction headers related to this NervosDAO cell. */
  public transactionHeaders: TransactionHeader[];

  /** The interests accrued for this NervosDAO cell. */
  public interests: ccc.Num;

  /** The maturity epoch of this NervosDAO cell. */
  public maturity: ccc.Epoch;

  /**
   * Creates an instance of DaoCell.
   * @param cell - The cell associated with this NervosDAO cell.
   * @param deposit - The transaction header for the deposit.
   * @param withdrawalRequest - The transaction header for the withdrawal request.
   */
  constructor(
    cell: ccc.Cell,
    deposit: TransactionHeader,
    withdrawalRequest: TransactionHeader,
  ) {
    this.cell = cell;
    this.transactionHeaders = [deposit, withdrawalRequest];
    this.interests = ccc.calcDaoProfit(
      this.cell.capacityFree,
      deposit.header,
      withdrawalRequest.header,
    );
    this.maturity = ccc.calcDaoClaimEpoch(
      deposit.header,
      withdrawalRequest.header,
    );
  }

  /**
   * Compares the maturity of this NervosDAO cell with another NervosDAO cell.
   * @param other - The other NervosDAO cell to compare against.
   * @returns 1 if this cell is more mature, 0 if they are equal, -1 if this cell is less mature.
   */
  maturityCompare(other: DaoCell): 1 | 0 | -1 {
    return epochCompare(this.maturity, other.maturity);
  }
}

/**
 * Class representing a deposit in NervosDAO.
 * Inherits from DaoCell and represents a specific type of NervosDAO cell for deposits.
 */
export class Deposit extends DaoCell {
  /**
   * Creates an instance of Deposit.
   * @param cell - The cell associated with this deposit.
   * @param deposit - The transaction header for the deposit.
   * @param tip - The client block header representing the latest block.
   */
  constructor(
    cell: ccc.Cell,
    deposit: TransactionHeader,
    tip: ccc.ClientBlockHeader,
  ) {
    super(cell, deposit, {
      header: tip,
    });
    this.transactionHeaders.pop(); // Remove the withdrawal request header as it's not applicable for deposits.
  }

  /**
   * Updates the deposit's interests and maturity based on the latest block header.
   * @param tip - The client block header representing the latest block.
   */
  update(tip: ccc.ClientBlockHeader): void {
    const depositHeader = this.transactionHeaders[0]?.header;
    if (!depositHeader) {
      throw Error("Deposit TransactionHeader not found");
    }

    this.interests = ccc.calcDaoProfit(
      this.cell.capacityFree,
      depositHeader,
      tip,
    );
    this.maturity = ccc.calcDaoClaimEpoch(depositHeader, tip);
  }
}

/**
 * Class representing a withdrawal request in NervosDAO.
 * Inherits from DaoCell and represents a specific type of NervosDAO cell for withdrawal requests.
 */
export class WithdrawalRequest extends DaoCell {}
