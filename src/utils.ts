import { ccc } from "@ckb-ccc/core";

export interface TransactionHeader {
  transaction: ccc.Transaction;
  header: ccc.ClientBlockHeader;
}

export async function getTransactionHeader(
  client: ccc.Client,
  txHash: ccc.Hex,
  knownTransactionHeaders?: Map<ccc.Hex, TransactionHeader>,
  allowedHeaders?: Set<ccc.Hex>,
): Promise<TransactionHeader> {
  // Check if it's an already known TransactionHeader
  let res = knownTransactionHeaders?.get(txHash);
  if (res) {
    return res;
  }

  // Get the TransactionHeader
  const data = await client.getTransactionWithHeader(txHash);

  // Validate TransactionHeader
  if (!data) {
    throw new Error("Transaction not found");
  }
  const { transaction, header } = data;
  if (!header) {
    throw new Error("Header not found");
  }
  if (allowedHeaders?.has(header.hash) === false) {
    throw new Error("Header not allowed");
  }
  res = { transaction: transaction.transaction, header };

  // Possibly add it to the known TransactionHeaders
  knownTransactionHeaders?.set(txHash, res);

  return res;
}

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
export function getDaoClaimEpoch(
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
