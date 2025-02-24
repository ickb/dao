import { ccc } from "@ckb-ccc/core";

// Credits to devrel/ccc/(tools)/NervosDao/page.tsx
export function getDaoInterests(
  dao: ccc.Cell,
  depositHeader: ccc.ClientBlockHeader,
  withdrawHeader: ccc.ClientBlockHeader,
): ccc.Num {
  const occupiedSize = ccc.fixedPointFrom(
    dao.cellOutput.occupiedSize + ccc.bytesFrom(dao.outputData).length,
  );
  const profitableSize = dao.cellOutput.capacity - occupiedSize;

  return (
    (profitableSize * withdrawHeader.dao.ar) / depositHeader.dao.ar -
    profitableSize
  );
}

// Credits to devrel/ccc/(tools)/NervosDao/page.tsx
export function getDaoMaturity(
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

export async function getDaoScript(client: ccc.Client) {
  return ccc.Script.fromKnownScript(client, ccc.KnownScript.NervosDao, "0x");
}

export const DAO_DEPOSIT_DATA = "0x0000000000000000";
