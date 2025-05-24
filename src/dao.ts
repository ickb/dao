import { ccc, mol } from "@ckb-ccc/core";
import { unique, type ScriptDeps, type SmartTransaction } from "@ickb/utils";
import { daoCellFrom as daoCellFrom, type DaoCell } from "./cells.js";

/**
 * Manage NervosDAO functionalities.
 */
export class DaoManager implements ScriptDeps {
  /**
   * Creates an instance of the DaoManager class.
   *
   * @param script - The script associated with the NervosDAO.
   * @param cellDeps - An array of cell dependencies for the NervosDAO.
   */
  constructor(
    public readonly script: ccc.Script,
    public readonly cellDeps: ccc.CellDep[],
  ) {}

  /**
   * Creates an instance of DaoManager from script dependencies.
   * @param deps - The script dependencies.
   * @param deps.udt - The script dependencies for UDT.
   * @returns An instance of DaoManager.
   */
  static fromDeps(
    { dao }: { dao: ScriptDeps },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._: never[]
  ): DaoManager {
    return new DaoManager(dao.script, dao.cellDeps);
  }

  /**
   * Checks if a given cell is a deposit.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a deposit, otherwise false.
   */
  isDeposit(cell: ccc.Cell): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = cell;

    return (
      outputData === DaoManager.depositData() && type?.eq(this.script) === true
    );
  }

  /**
   * Checks if a given cell is a withdrawal request.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a withdrawal request, otherwise false.
   */
  isWithdrawalRequest(cell: ccc.Cell): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = cell;

    return (
      outputData !== DaoManager.depositData() && type?.eq(this.script) === true
    );
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
    lock: ccc.Script,
  ): void {
    if (capacities.length === 0) {
      return;
    }

    tx.addCellDeps(this.cellDeps);

    for (const capacity of capacities) {
      tx.addOutput(
        {
          capacity,
          lock,
          type: this.script,
        },
        DaoManager.depositData(),
      );
    }

    // Check that there are at most 64 output cells, see:
    // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md#gotchas
    if (tx.outputs.length > 64) {
      throw Error("More than 64 output cells in a NervosDAO transaction");
    }
  }

  /**
   * Requests withdrawal from NervosDAO deposits.
   *
   * @param tx - The transaction to which the withdrawal request will be added.
   * @param deposits - An array of deposits to request the withdrawal from.
   * @param lock - The lock script for the withdrawal request cells.
   * @param options - Optional parameters for the withdrawal request.
   * @param options.sameSizeOnly - Whether to enforce the same size for lock args (default: true).
   * @param options.isReadyOnly - Whether to only process ready deposits (default: false).
   * @returns void
   * @throws Error if the transaction has different input and output lengths.
   * @throws Error if the withdrawal request lock args have a different size from the deposit.
   * @throws Error if the transaction or header of deposit is not found.
   */
  requestWithdrawal(
    tx: SmartTransaction,
    deposits: DaoCell[],
    lock: ccc.Script,
    options?: {
      sameSizeOnly?: boolean;
      isReadyOnly?: boolean;
    },
  ): void {
    const sameSizeOnly = options?.sameSizeOnly ?? true;
    const isReadyOnly = options?.isReadyOnly ?? false;
    if (isReadyOnly) {
      deposits = deposits.filter((d) => d.isReady);
    }
    if (deposits.length === 0) {
      return;
    }

    if (
      tx.inputs.length != tx.outputs.length ||
      tx.outputs.length != tx.outputsData.length
    ) {
      throw Error("Transaction have different inputs and outputs lengths");
    }

    for (const deposit of deposits) {
      const { cell, isDeposit, headers } = deposit;
      if (!isDeposit) {
        throw Error("Not a deposit");
      }
      if (
        sameSizeOnly &&
        cell.cellOutput.lock.args.length != lock.args.length
      ) {
        throw Error(
          "Withdrawal request lock args has different size from deposit",
        );
      }

      tx.addCellDeps(this.cellDeps);
      const depositHeader = headers[0];
      tx.addHeaders(depositHeader);
      tx.addInput(cell);
      tx.addOutput(
        {
          capacity: cell.cellOutput.capacity,
          lock,
          type: this.script,
        },
        mol.Uint64LE.encode(depositHeader.header.number),
      );
    }

    // Check that there are at most 64 output cells, see:
    // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md#gotchas
    if (tx.outputs.length > 64) {
      throw Error("More than 64 output cells in a NervosDAO transaction");
    }
  }

  /**
   * Withdraws funds from the NervosDAO based on the provided mature withdrawal requests.
   *
   * @param tx - The transaction to which the withdrawal will be added.
   * @param withdrawalRequests - An array of withdrawal requests to process.
   * @param options - Optional parameters for the withdrawal process.
   * @param options.isReadyOnly - Whether to only process ready withdrawal requests (default: false).
   * @returns void
   * @throws Error if the withdrawal request is not valid.
   */
  withdraw(
    tx: SmartTransaction,
    withdrawalRequests: DaoCell[],
    options?: {
      isReadyOnly?: boolean;
    },
  ): void {
    const isReadyOnly = options?.isReadyOnly ?? false;
    if (isReadyOnly) {
      withdrawalRequests = withdrawalRequests.filter((d) => d.isReady);
    }
    if (withdrawalRequests.length === 0) {
      return;
    }

    tx.addCellDeps(this.cellDeps);

    for (const withdrawalRequest of withdrawalRequests) {
      const {
        cell: { outPoint, cellOutput, outputData },
        isDeposit,
        headers,
        maturity,
      } = withdrawalRequest;
      if (isDeposit) {
        throw Error("Not a withdrawal request");
      }
      tx.addHeaders(headers);
      const depositHeader = headers[0];
      const headerIndex = tx.headerDeps.findIndex(
        (h) => h === depositHeader.header.hash,
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
        throw Error("Witnesses of withdrawal request already in use");
      }
      witness.inputType = ccc.hexFrom(ccc.numLeToBytes(headerIndex, 8));
      tx.setWitnessArgsAt(inputIndex, witness);
    }

    // Check that there are at most 64 output cells, see:
    // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md#gotchas
    if (tx.outputs.length > 64) {
      throw Error("More than 64 output cells in a NervosDAO transaction");
    }
  }

  /**
   * Asynchronously finds deposits associated with a given lock script.
   *
   * @param client - The client used to interact with the blockchain.
   * @param locks - The lock scripts to filter deposits.
   * @param options - Optional parameters for the search.
   * @param options.tip - An optional tip block header to use as a reference.
   * @param options.onChain - A boolean indicating whether to use the cells cache or directly search on-chain.
   * @param options.minLockUp: An optional minimum lock-up period in epochs (Default 15 minutes)
   * @param options.maxLockUp: An optional maximum lock-up period in epochs (Default 3 days)
   * @returns An async generator that yields deposits in form of DaoCells.
   */
  async *findDeposits(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
      minLockUp?: ccc.Epoch;
      maxLockUp?: ccc.Epoch;
    },
  ): AsyncGenerator<DaoCell> {
    const tip = options?.tip ?? (await client.getTipHeader());

    for (const lock of unique(locks)) {
      const findCellsArgs = [
        {
          script: lock,
          scriptType: "lock",
          filter: {
            script: this.script,
            outputData: DaoManager.depositData(),
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

        yield daoCellFrom({ cell, ...options, isDeposit: true, client, tip });
      }
    }
  }

  /**
   * Asynchronously finds withdrawal requests associated with a given lock script.
   *
   * @param client - The client used to interact with the blockchain.
   * @param locks - The lock scripts to filter withdrawal requests.
   * @param options - Optional parameters for the search.
   * @param options.tip - An optional tip block header to use as a reference.
   * @param options.onChain - A boolean indicating whether to use the cells cache or directly search on-chain.
   * @returns An async generator that yields withdrawal requests in form of DaoCells.
   */
  async *findWithdrawalRequests(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
    },
  ): AsyncGenerator<DaoCell> {
    const tip = options?.tip ?? (await client.getTipHeader());

    for (const lock of unique(locks)) {
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

        yield daoCellFrom({ cell, ...options, isDeposit: false, client, tip });
      }
    }
  }
}
