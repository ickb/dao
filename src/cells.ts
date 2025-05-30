import { ccc, mol } from "@ckb-ccc/core";
import {
  Epoch,
  getHeader,
  type TransactionHeader,
  type ValueComponents,
} from "@ickb/utils";

/**
 * Represents a DAO cell with its associated properties.
 */
export interface DaoCell extends ValueComponents {
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

  /** The maturity epoch of the DAO cell. In case of deposit, it's calculated from tip plus minLockUp. */
  maturity: Epoch;

  /**
   * Indicates the readiness to be consumed by a transaction.
   * In case of deposit, it is false if the cycle renewal is less than minLockUp or more than maxLockUp away,
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
 * - `minLockUp`: An optional minimum lock-up period in epochs (Default 15 minutes)
 * - `maxLockUp`: An optional maximum lock-up period in epochs (Default 3 days)
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
  ) & {
    tip: ccc.ClientBlockHeader;
    minLockUp?: Epoch;
    maxLockUp?: Epoch;
  },
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
  let maturity = Epoch.from(
    ccc.calcDaoClaimEpoch(oldest.header, newest.header),
  );

  const minLockUp = options.minLockUp ?? defaultMinLockUp;
  const maxLockUp = options.maxLockUp ?? defaultMaxLockUp;

  // Deposit: maturity > minLockUp + tip.epoch
  // WithdrawalRequest: maturity > tip.epoch
  let isReady = isDeposit
    ? maturity.compare(minLockUp.add(tip.epoch)) > 0
    : maturity.compare(tip.epoch) > 0;

  if (isDeposit) {
    // Deposit: maturity < tip.epoch + maxLockUp
    if (!isReady) {
      // This deposit is late for this cycle and it will be withdrawable in the next cycle
      maturity = maturity.add([180n, 0n, 1n]);
      // isReady = true; // Ready for next cycle
    }
    isReady = maxLockUp.add(tip.epoch).compare(maturity) > 0;
  }

  const ckbValue = cell.cellOutput.capacity + interests;
  const udtValue = 0n;

  return {
    cell,
    isDeposit,
    headers: [oldest, newest],
    interests,
    maturity,
    isReady,
    ckbValue,
    udtValue,
  };
}

/**
 * The default minimum lock-up period represented as an Epoch.
 *
 * Calculated from the tuple [0n, 1n, 24n]:
 * - 0 whole epochs,
 * - plus 1/24 of an epoch.
 *
 * Given each epoch represents 4 hours (14400000 milliseconds),
 * then 1/24 of an epoch equals: (14400000 / 24) = 600000 milliseconds, i.e. 10 minutes.
 */
const defaultMinLockUp = Epoch.from([0n, 1n, 24n]); // 10 minutes

/**
 * The default maximum lock-up period represented as an Epoch.
 *
 * Calculated from the tuple [18n, 0n, 1n]:
 * - 18 whole epochs,
 * - plus 0/1 of an additional epoch.
 *
 * With each epoch lasting 4 hours, 18 epochs equal 18 * 4 hours = 72 hours,
 * i.e. 3 days.
 */
const defaultMaxLockUp = Epoch.from([18n, 0n, 1n]); // 3 days
