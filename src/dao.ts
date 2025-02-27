import { ccc } from "@ckb-ccc/core";
import type { SmartTransaction } from "./transaction.js";
import {
  epochCompare,
  getTransactionHeader,
  type TransactionHeader,
} from "./utils.js";

export class Dao {
  constructor(
    public script: ccc.Script,
    public cellDep: ccc.CellDep[],
  ) {}

  static async from(client: ccc.Client): Promise<Dao> {
    const { hashType, codeHash, cellDeps } = await client.getKnownScript(
      ccc.KnownScript.NervosDao,
    );
    const script = ccc.Script.from({ codeHash, hashType, args: "0x" });
    return new Dao(
      script,
      cellDeps.map((d) => d.cellDep),
    );
  }

  isDeposit(cell: ccc.CellLike): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = ccc.Cell.from(cell);

    return outputData === Dao.depositData() && type?.eq(this.script) === true;
  }

  isWithdrawalRequest(cell: ccc.CellLike): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = ccc.Cell.from(cell);

    return outputData !== Dao.depositData() && type?.eq(this.script) === true;
  }

  static depositData(): ccc.Hex {
    return "0x0000000000000000";
  }

  deposit(
    tx: SmartTransaction,
    capacities: ccc.Num[],
    lock: ccc.ScriptLike,
  ): SmartTransaction {
    tx.addCellDeps(this.cellDep);

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

    return tx;
  }

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

    tx.addCellDeps(this.cellDep);

    const l = ccc.Script.from(lock);
    for (const deposit of deposits) {
      const { cell, transactionHeaders } = deposit;
      if (sameSizeArgs && cell.cellOutput.lock.args.length != l.args.length) {
        throw new Error(
          "Withdrawal request lock args has different size from deposit",
        );
      }

      tx.addTransactionHeaders(transactionHeaders);
      tx.addInput(cell);
      tx.addOutput(
        {
          capacity: cell.cellOutput.capacity,
          lock: l,
          type: this.script,
        },
        ccc.numLeToBytes(transactionHeaders[0].header.number, 8),
      );
    }

    return tx;
  }

  withdraw(
    tx: SmartTransaction,
    withdrawalRequests: WithdrawalRequest[],
  ): SmartTransaction {
    tx.addCellDeps(this.cellDep);

    for (const withdrawalRequest of withdrawalRequests) {
      const {
        cell: { outPoint, cellOutput, outputData },
        transactionHeaders,
        maturity,
      } = withdrawalRequest;
      tx.addTransactionHeaders(transactionHeaders);
      const headerIndex = tx.headerDeps.findIndex(
        (h) => h === transactionHeaders[0].header.hash,
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

    return tx;
  }

  async *findDeposits(
    client: ccc.Client,
    lock: ccc.ScriptLike,
    tip?: ccc.ClientBlockHeaderLike,
  ): AsyncGenerator<Deposit> {
    const tipHeader = tip
      ? ccc.ClientBlockHeader.from(tip)
      : await client.getTipHeader();
    for await (const cell of client.findCells(
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
    )) {
      if (!this.isDeposit(cell) || !cell.cellOutput.lock.eq(lock)) {
        continue;
      }
      const transactionHeader = await getTransactionHeader(
        client,
        cell.outPoint.txHash,
      );
      yield new Deposit(cell, transactionHeader, tipHeader);
    }
  }

  async *findWithdrawalRequests(
    client: ccc.Client,
    lock: ccc.ScriptLike,
  ): AsyncGenerator<WithdrawalRequest> {
    for await (const cell of client.findCells(
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
    )) {
      if (!this.isWithdrawalRequest(cell) || !cell.cellOutput.lock.eq(lock)) {
        continue;
      }

      const transactionHeader = await getTransactionHeader(
        client,
        cell.outPoint.txHash,
      );

      const depositTransactionHeader = await getTransactionHeader(
        client,
        transactionHeader.transaction.inputs[Number(cell.outPoint.index)]
          .previousOutput.txHash,
      );

      yield new WithdrawalRequest(
        cell,
        depositTransactionHeader,
        transactionHeader,
      );
    }
  }
}

export class WithdrawalRequest {
  public cell: ccc.Cell;
  public transactionHeaders: TransactionHeader[];
  public interests: ccc.Num;
  public maturity: ccc.Epoch;
  constructor(
    cell: ccc.Cell,
    deposit: TransactionHeader,
    withdrawalRequest: TransactionHeader,
  ) {
    this.cell = cell;
    this.transactionHeaders = [deposit, withdrawalRequest];
    this.interests = getInterests(
      this.cell,
      deposit.header,
      withdrawalRequest.header,
    );
    this.maturity = getMaturity(deposit.header, withdrawalRequest.header);
  }

  maturityCompare(other: WithdrawalRequest): 0 | 1 | -1 {
    return epochCompare(this.maturity, other.maturity);
  }
}

export class Deposit extends WithdrawalRequest {
  constructor(
    cell: ccc.Cell,
    deposit: TransactionHeader,
    tip: ccc.ClientBlockHeader,
  ) {
    super(cell, deposit, {
      transaction: undefined as unknown as ccc.Transaction,
      header: tip,
    });
    this.transactionHeaders.pop();
  }

  update(tip: ccc.ClientBlockHeader): void {
    const depositHeader = this.transactionHeaders[0].header;
    this.interests = getInterests(this.cell, depositHeader, tip);
    this.maturity = getMaturity(depositHeader, tip);
  }
}

// Credits to Hanssen from CKB DevRel:
// https://github.com/ckb-devrel/ccc/blob/master/packages/demo/src/app/connected/(tools)/NervosDao/page.tsx
function getInterests(
  cell: ccc.Cell,
  depositHeader: ccc.ClientBlockHeader,
  withdrawHeader: ccc.ClientBlockHeader,
): ccc.Num {
  const occupiedSize = ccc.fixedPointFrom(
    cell.cellOutput.occupiedSize + ccc.bytesFrom(cell.outputData).length,
  );
  const profitableSize = cell.cellOutput.capacity - occupiedSize;

  return (
    (profitableSize * withdrawHeader.dao.ar) / depositHeader.dao.ar -
    profitableSize
  );
}

// Credits to Hanssen from CKB DevRel:
// https://github.com/ckb-devrel/ccc/blob/master/packages/demo/src/app/connected/(tools)/NervosDao/page.tsx
function getMaturity(
  depositHeader: ccc.ClientBlockHeader,
  withdrawHeader: ccc.ClientBlockHeader,
): ccc.Epoch {
  const depositEpoch = depositHeader.epoch;
  const withdrawEpoch = withdrawHeader.epoch;
  const intDiff = withdrawEpoch[0] - depositEpoch[0];
  // deposit[1]    withdraw[1]
  // ---------- <= -----------
  // deposit[2]    withdraw[2]
  if (
    intDiff % ccc.numFrom(180) !== ccc.numFrom(0) ||
    depositEpoch[1] * withdrawEpoch[2] <= depositEpoch[2] * withdrawEpoch[1]
  ) {
    return [
      depositEpoch[0] +
        (intDiff / ccc.numFrom(180) + ccc.numFrom(1)) * ccc.numFrom(180),
      depositEpoch[1],
      depositEpoch[2],
    ];
  }

  return [
    depositEpoch[0] + (intDiff / ccc.numFrom(180)) * ccc.numFrom(180),
    depositEpoch[1],
    depositEpoch[2],
  ];
}
