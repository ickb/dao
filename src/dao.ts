import { ccc } from "@ckb-ccc/core";

export class Dao {
  constructor(
    public script: ccc.Script,
    public cellDepInfos: ccc.CellDep[],
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

  is(cell: ccc.CellLike): boolean {
    const type = cell.cellOutput.type;
    return !!type && this.script.eq(type);
  }

  hasDepositData(cell: ccc.CellLike): boolean {
    return (
      Dao.depositData() ===
      (cell instanceof ccc.Cell
        ? cell.outputData
        : ccc.hexFrom(cell.outputData))
    );
  }

  isDeposit(cell: ccc.CellLike): boolean {
    return this.is(cell) && this.hasDepositData(cell);
  }

  isWithdrawal(cell: ccc.CellLike): boolean {
    return this.is(cell) && !this.hasDepositData(cell);
  }

  static depositData(): ccc.Hex {
    return "0x0000000000000000";
  }

  // Credits to Hanssen from CKB DevRel:
  // https://github.com/ckb-devrel/ccc/blob/master/packages/demo/src/app/connected/(tools)/NervosDao/page.tsx
  static getInterests(
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
  static getMaturity(
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
}
