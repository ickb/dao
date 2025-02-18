import { ccc } from "@ckb-ccc/core";

export class DaoTransaction extends ccc.Transaction {
  override async getInputsCapacity(client: ccc.Client): Promise<ccc.Num> {
    const isDao = await createIsScript(client, ccc.KnownScript.NervosDao, "0x");
    const getTransactionWithHeader = createGetTransactionWithHeader(
      client,
      new Set(this.headerDeps),
    );
    return ccc.reduceAsync(
      this.inputs,
      async (total, input) => {
        // Get all cell info
        await input.completeExtraInfos(client);
        const { previousOutput, cellOutput, outputData } = input;

        // Input is not well defined
        if (!cellOutput || !outputData) {
          throw new Error("Unable to complete input");
        }

        total += cellOutput.capacity;

        // If not NervosDAO cell, so no additional interests, return
        if (!isDao(cellOutput.type)) {
          return total;
        }

        // Get header of NervosDAO cell and check its inclusion in HeaderDeps
        const { transaction, header } = await getTransactionWithHeader(
          previousOutput.txHash,
        );

        // If deposit cell, so no additional interests, return
        if (outputData === depositData) {
          return total;
        }

        // It's a withdrawal request cell, get header of previous deposit cell
        const { header: depositHeader } = await getTransactionWithHeader(
          transaction.transaction.inputs[Number(previousOutput.index)]
            .previousOutput.txHash,
        );

        return (
          total +
          getProfit(
            ccc.Cell.from({ previousOutput, cellOutput, outputData }),
            depositHeader,
            header,
          )
        );
      },
      ccc.numFrom(0),
    );
  }
}

export function createGetTransactionWithHeader(
  client: ccc.Client,
  allowedHeaders?: Set<ccc.Hex>,
) {
  const cache = new Map<
    ccc.Hex,
    {
      transaction: ccc.ClientTransactionResponse;
      header: ccc.ClientBlockHeader;
    }
  >();
  return async function (txHash: ccc.Hex) {
    // Check if it's cached
    let res = cache.get(txHash);
    if (res) {
      return res;
    }

    // Get the data, validate it and add it to the cache
    const d = await client.getTransactionWithHeader(txHash);
    if (!d) {
      throw new Error("Transaction not found");
    }
    const { transaction, header } = d;
    if (!header) {
      throw new Error("Header not found");
    }
    if (allowedHeaders && !allowedHeaders.has(header.hash)) {
      throw new Error("Header not allowed");
    }
    res = { transaction, header };
    cache.set(txHash, res);
    return res;
  };
}

export async function createIsScript(
  client: ccc.Client,
  knownScript: ccc.KnownScript,
  args: ccc.HexLike,
) {
  const s0 = await ccc.Script.fromKnownScript(client, knownScript, args);
  return function (s1: ccc.Script | undefined) {
    if (!s1) {
      return false;
    }
    return (
      s0.codeHash === s1.codeHash &&
      s0.args === s1.args &&
      s0.hashType === s1.hashType
    );
  };
}

export const depositData = "0x0000000000000000";

// Credits to devrel/ccc/(tools)/NervosDao:
// https://github.com/ckb-devrel/ccc/blob/master/packages/demo/src/app/connected/(tools)/NervosDao/page.tsx
function getProfit(
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

// Credits to devrel/ccc/(tools)/NervosDao:
// https://github.com/ckb-devrel/ccc/blob/master/packages/demo/src/app/connected/(tools)/NervosDao/page.tsx
export function getClaimEpoch(
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
