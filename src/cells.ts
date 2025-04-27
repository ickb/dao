import { ccc, mol } from "@ckb-ccc/core";
import { getHeader, type TransactionHeader } from "@ickb/utils";

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
}

/**
 * Creates a DaoCell from the provided options.
 *
 * @param options - The options to create a DaoCell. It can be one of the following:
 * - An object omitting "interests" and "maturity" from DaoCell.
 * - An object containing a cell, isDeposit flag, client, and an optional tip.
 * - An object containing an outpoint, isDeposit flag, client, and an optional tip.
 *
 * @returns A promise that resolves to a DaoCell.
 *
 * @throws Error if the cell is not found.
 */

export async function DaoCellFrom(
  options:
    | Omit<DaoCell, "interests" | "maturity">
    | {
        cell: ccc.Cell;
        isDeposit: boolean;
        client: ccc.Client;
        tip?: ccc.ClientBlockHeader;
      }
    | {
        outpoint: ccc.OutPoint;
        isDeposit: boolean;
        client: ccc.Client;
        tip?: ccc.ClientBlockHeader;
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
        : { header: options.tip ?? (await options.client.getTipHeader()) };

  const interests = ccc.calcDaoProfit(
    cell.capacityFree,
    oldest.header,
    newest.header,
  );
  const maturity = ccc.calcDaoClaimEpoch(oldest.header, newest.header);

  return {
    cell,
    isDeposit,
    headers: [oldest, newest],
    interests,
    maturity,
  };
}
