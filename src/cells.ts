import { ccc } from "@ckb-ccc/core";
import { epochCompare, getHeader, type TransactionHeader } from "@ickb/utils";

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
 * Class representing a deposit cell in NervosDAO.
 * Inherits from DaoCell and represents a specific type of NervosDAO cell for deposits.
 */
export class DepositCell extends DaoCell {
  /**
   * Creates an instance of DepositCell.
   * @param {ccc.Cell} cell - The cell associated with this deposit.
   * @param {TransactionHeader} deposit - The transaction header for the deposit.
   * @param {ccc.ClientBlockHeader} tip - The client block header representing the latest block.
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
   * Creates a DepositCell instance from a client and a cell or outPoint.
   * @param {ccc.Client} client - The client used to fetch the cell.
   * @param {ccc.Cell | ccc.OutPoint} c - The cell or outPoint to retrieve the deposit cell.
   * @param {ccc.ClientBlockHeader} tip - The client block header representing the latest block.
   * @returns {Promise<DepositCell>} A promise that resolves to a DepositCell instance.
   * @throws {Error} If the deposit cell is not found at the outPoint.
   */
  static async fromClient(
    client: ccc.Client,
    c: ccc.Cell | ccc.OutPoint,
    tip: ccc.ClientBlockHeader,
  ): Promise<DepositCell> {
    const cell = "cellOutput" in c ? c : await client.getCell(c);
    if (!cell) {
      throw Error("No Deposit Cell not found at the outPoint");
    }

    const txHash = cell.outPoint.txHash;
    const header = await getHeader(client, {
      type: "txHash",
      value: txHash,
    });

    return new DepositCell(cell, { header, txHash }, tip);
  }

  /**
   * Updates the deposit's interests and maturity based on the latest block header.
   * @param {ccc.ClientBlockHeader} tip - The client block header representing the latest block.
   * @throws {Error} If the deposit TransactionHeader is not found.
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
 * Class representing a withdrawal request cell in NervosDAO.
 * Inherits from DaoCell and represents a specific type of NervosDAO cell for withdrawal requests.
 */
export class WithdrawalRequestCell extends DaoCell {
  /**
   * Creates a WithdrawalRequestCell instance from a client and a cell or outPoint.
   * @param {ccc.Client} client - The client used to fetch the cell.
   * @param {ccc.Cell | ccc.OutPoint} c - The cell or outPoint to retrieve the withdrawal request cell.
   * @returns {Promise<WithdrawalRequestCell>} A promise that resolves to a WithdrawalRequestCell instance.
   * @throws {Error} If the withdrawal request cell is not found at the outPoint.
   */
  static async fromClient(
    client: ccc.Client,
    c: ccc.Cell | ccc.OutPoint,
  ): Promise<WithdrawalRequestCell> {
    const cell = "cellOutput" in c ? c : await client.getCell(c);
    if (!cell) {
      throw Error("No Withdrawal Request Cell not found at the outPoint");
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

    return new WithdrawalRequestCell(
      cell,
      { header: depositHeader },
      { header, txHash },
    );
  }
}
