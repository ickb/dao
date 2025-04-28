import { ccc, mol } from "@ckb-ccc/core";
import {
  epochAdd,
  epochCompare,
  getHeader,
  type TransactionHeader,
} from "@ickb/utils";

/**
 * Represents a DAO cell with its associated properties.
 */
export interface DaoCell {
  /** The DAO cell. */
  cell: ccc.Cell;

  /** Indicates whether the cell is a deposit. */
  isDeposit: boolean;

  /**
   * The headers associated with the transaction.
   * In case of deposit, it contains [depositHeader, tipHeader],
   * while in case of withdrawal request, it contains [depositHeader, withdrawalRequestHeader].
   */
  headers: [TransactionHeader, TransactionHeader];

  /** The interests accrued on the DAO cell. */
  interests: ccc.Num;

  /** The maturity epoch of the DAO cell. */
  maturity: ccc.Epoch;

  /**
   * Indicates the readiness to be consumed by a transaction.
   * In case of deposit, it is false if the cycle renewal is less than minLockUp away,
   * while in case of withdrawal request, it indicates the readiness for withdrawal.
   */
  isReady: boolean;
}

/**
 * Creates a DaoCell from the provided options.
 *
 * @param options - The options to create a DaoCell. It can be one of the following:
 * - An object omitting "interests" and "maturity" from DaoCell.
 * - An object containing a cell, isDeposit flag and client.
 * - An object containing an outpoint, isDeposit flag and client.
 *
 * The options object also include:
 * - `tip`: The current tip block header.
 * - `minLockUp`: An optional minimum lock-up period in epochs.
 *
 * @returns A promise that resolves to a DaoCell.
 *
 * @throws Error if the cell is not found.
 */
export async function daoCellFrom(
  options: (
    | Omit<DaoCell, "interests" | "maturity">
    | {
        cell: ccc.Cell;
        isDeposit: boolean;
        client: ccc.Client;
      }
    | {
        outpoint: ccc.OutPoint;
        isDeposit: boolean;
        client: ccc.Client;
      }
  ) & { tip: ccc.ClientBlockHeader; minLockUp?: ccc.Epoch },
): Promise<DaoCell> {
  const isDeposit = options.isDeposit;
  const cell =
    "cell" in options
      ? options.cell
      : await options.client.getCell(options.outpoint);
  if (!cell) {
    throw Error("Cell not found");
  }

  const tip = options.tip;
  const txHash = cell.outPoint.txHash;
  const oldest =
    "headers" in options
      ? options.headers[0]
      : !isDeposit
        ? {
            header: await getHeader(options.client, {
              type: "number",
              value: mol.Uint64LE.decode(cell.outputData),
            }),
          }
        : {
            header: await getHeader(options.client, {
              type: "txHash",
              value: txHash,
            }),
            txHash,
          };

  const newest =
    "headers" in options
      ? options.headers[1]
      : !isDeposit
        ? {
            header: await getHeader(options.client, {
              type: "txHash",
              value: txHash,
            }),
            txHash,
          }
        : { header: tip };

  const interests = ccc.calcDaoProfit(
    cell.capacityFree,
    oldest.header,
    newest.header,
  );
  const maturity = ccc.calcDaoClaimEpoch(oldest.header, newest.header);

  // Deposit: maturity > tip.epoch + minLockUp (default minLockUp 15 minutes)
  // WithdrawalRequest: maturity > tip.epoch
  const isReady =
    epochCompare(
      maturity,
      isDeposit
        ? epochAdd(tip.epoch, options.minLockUp ?? [0n, 1n, 16n])
        : tip.epoch,
    ) == 1;

  return {
    cell,
    isDeposit,
    headers: [oldest, newest],
    interests,
    maturity,
    isReady,
  };
}
