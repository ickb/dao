import type {
  Cell,
  Hexadecimal,
  PackedDao,
  PackedSince,
} from "@ckb-lumos/base";
import type { TransactionSkeletonType } from "@ckb-lumos/helpers";
import type { ConfigAdapter } from "./config.js";
import { hexify } from "@ckb-lumos/codec/lib/bytes.js";
import {
  generateHeaderEpoch,
  parseAbsoluteEpochSince,
} from "@ckb-lumos/base/lib/since.js";
import type { EpochSinceValue } from "@ckb-lumos/base/lib/since.js";
import {
  calculateDaoEarliestSinceCompatible,
  calculateMaximumWithdraw,
} from "@ckb-lumos/common-scripts/lib/dao.js";
import {
  I8Cell,
  I8Script,
  I8Header,
  headerDeps,
  since,
  witness,
} from "./cell.js";
import {
  addCells,
  addHeaderDeps,
  calculateFee,
  txSize,
} from "./transaction.js";
import { hex, scriptEq } from "./utils.js";
import { Uint64 } from "./codec.js";

export const errorUndefinedBlockNumber =
  "Encountered an input cell with blockNumber undefined";
export function daoSifter(
  inputs: readonly Cell[],
  accountLockExpander: (c: Cell) => I8Script | undefined,
  getHeader: (blockNumber: string, context: Cell) => I8Header,
  config: ConfigAdapter,
) {
  const deposits: I8Cell[] = [];
  const withdrawalRequests: I8Cell[] = [];
  const notDaos: Cell[] = [];

  const defaultDaoScript = config.defaultScript("DAO");
  const extendCell = (
    c: Cell,
    lock: I8Script,
    header: I8Header,
    previousHeader?: I8Header,
    packedSince?: PackedSince,
  ) =>
    I8Cell.from({
      ...c,
      cellOutput: {
        lock,
        type: I8Script.from({
          ...defaultDaoScript,
          [headerDeps]: previousHeader ? [header, previousHeader] : [header],
          [since]: packedSince ?? defaultDaoScript[since],
        }),
        capacity: c.cellOutput.capacity,
      },
      blockHash: header.hash,
    });

  for (const c of inputs) {
    const lock = accountLockExpander(c);
    if (!lock || !isDao(c, config)) {
      notDaos.push(c);
      continue;
    }

    if (!c.blockNumber) {
      throw Error(errorUndefinedBlockNumber);
    }

    const h = getHeader(c.blockNumber!, c);
    if (c.data === DEPOSIT_DATA) {
      deposits.push(extendCell(c, lock, h));
    } else {
      const h1 = getHeader(hex(Uint64.unpack(c.data)), c);
      const since = calculateDaoEarliestSinceCompatible(
        h1.epoch,
        h.epoch,
      ).toHexString();
      withdrawalRequests.push(extendCell(c, lock, h, h1, since));
    }
  }

  return { deposits, withdrawalRequests, notDaos };
}

export const DEPOSIT_DATA = "0x0000000000000000";

export function isDao(c: Cell, config: ConfigAdapter) {
  return scriptEq(c.cellOutput.type, config.defaultScript("DAO"));
}

export function isDaoDeposit(c: Cell, config: ConfigAdapter) {
  return isDao(c, config) && c.data === DEPOSIT_DATA;
}

export function isDaoWithdrawalRequest(c: Cell, config: ConfigAdapter) {
  return isDao(c, config) && c.data !== DEPOSIT_DATA;
}

export function daoDeposit(
  tx: TransactionSkeletonType,
  capacities: readonly bigint[],
  accountLock: I8Script,
  config: ConfigAdapter,
) {
  const baseDeposit = I8Cell.from({
    lock: accountLock,
    type: config.defaultScript("DAO"),
    data: DEPOSIT_DATA,
  });

  const deposits = capacities.map((c) =>
    I8Cell.from({ ...baseDeposit, capacity: hex(c) }),
  );

  return addCells(tx, "append", [], deposits);
}

export const errorDifferentSizeLock =
  "Withdrawal request lock has different size";
export function daoRequestWithdrawalFrom(
  tx: TransactionSkeletonType,
  deposits: readonly I8Cell[],
  accountLock: I8Script,
) {
  const withdrawalRequests: I8Cell[] = [];
  for (const d of deposits) {
    if (d.cellOutput.lock.args.length != accountLock.args.length) {
      throw Error(errorDifferentSizeLock);
    }

    withdrawalRequests.push(
      I8Cell.from({
        ...d.cellOutput,
        lock: accountLock,
        data: hexify(Uint64.pack(BigInt(d.blockNumber!))),
      }),
    );
  }

  return addCells(tx, "matched", deposits, withdrawalRequests);
}

export function daoWithdrawFrom(
  tx: TransactionSkeletonType,
  withdrawalRequests: readonly I8Cell[],
) {
  const headerHashes: Hexadecimal[] = [];
  for (const r of withdrawalRequests) {
    headerHashes.push(...r.cellOutput.type![headerDeps].map((h) => h.hash));
  }
  tx = addHeaderDeps(tx, ...headerHashes);

  const processedRequests: I8Cell[] = [];
  const header2index = new Map(tx.headerDeps.map((h, i) => [h, i]));
  for (const r of withdrawalRequests) {
    const depositHeader = r.cellOutput.type![headerDeps][1];
    processedRequests.push(
      I8Cell.from({
        ...r,
        type: I8Script.from({
          ...r.cellOutput.type!,
          [witness]: hexify(Uint64.pack(header2index.get(depositHeader.hash)!)),
        }),
      }),
    );
  }

  return addCells(tx, "append", processedRequests, []);
}

export function withdrawalEpochEstimation(
  deposit: I8Cell,
  withdrawalRequestEpoch: EpochSinceValue,
) {
  const withdrawalRequestEpochString = generateHeaderEpoch(
    withdrawalRequestEpoch,
  );
  const depositEpoch = deposit.cellOutput.type![headerDeps][0]!.epoch;
  return parseAbsoluteEpochSince(
    calculateDaoEarliestSinceCompatible(
      depositEpoch,
      withdrawalRequestEpochString,
    ).toHexString(),
  );
}

export function withdrawalAmountEstimation(
  deposit: I8Cell,
  withdrawalRequestDao: PackedDao,
) {
  const depositDao = deposit.cellOutput.type![headerDeps][0]!.dao;
  return calculateMaximumWithdraw(deposit, depositDao, withdrawalRequestDao);
}

export function ckbDelta(
  tx: TransactionSkeletonType,
  feeRate: bigint,
  config: ConfigAdapter,
) {
  let ckbDelta = 0n;
  for (const c of tx.inputs) {
    //Second Withdrawal step from NervosDAO
    if (isDaoWithdrawalRequest(c, config)) {
      const withdrawalRequest = c as I8Cell;
      const [withdrawalHeader, depositHeader] =
        withdrawalRequest.cellOutput.type![headerDeps];
      const maxWithdrawable = calculateMaximumWithdraw(
        c,
        depositHeader.dao,
        withdrawalHeader.dao,
      );
      ckbDelta += maxWithdrawable;
    } else {
      ckbDelta += BigInt(c.cellOutput.capacity);
    }
  }

  tx.outputs.forEach((c) => (ckbDelta -= BigInt(c.cellOutput.capacity)));

  //Don't account for the tx fee if there are no outputs
  if (tx.outputs.size > 0 && feeRate > 0n) {
    ckbDelta -= calculateFee(txSize(tx), feeRate);
  }

  return ckbDelta;
}

export function addCkbChange(
  tx: TransactionSkeletonType,
  accountLock: I8Script,
  feeRate: bigint,
  addPlaceholders: (tx: TransactionSkeletonType) => TransactionSkeletonType,
  config: ConfigAdapter,
) {
  let changeCell = I8Cell.from({ lock: accountLock });
  const usedCkb = BigInt(changeCell.cellOutput.capacity);

  const txWithPlaceholders = addPlaceholders(
    addCells(tx, "append", [], [changeCell]),
  );
  const delta = ckbDelta(txWithPlaceholders, feeRate, config);

  if (delta > 0n) {
    changeCell = I8Cell.from({
      ...changeCell,
      capacity: hex(usedCkb + delta),
    });
    tx = addPlaceholders(addCells(tx, "append", [], [changeCell]));
  } else {
    // If delta < 0n, it's a safe invalid transaction, it must be checked with sign of freeCkb.
    tx = txWithPlaceholders;
  }

  return {
    tx,
    freeCkb: delta,
  };
}
