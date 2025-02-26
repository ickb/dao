import { ccc } from "@ckb-ccc/core";

export interface TransactionHeader {
  transaction: ccc.Transaction;
  header: ccc.ClientBlockHeader;
}

export async function getTransactionHeader(
  client: ccc.Client,
  transactionHash: ccc.Hex,
): Promise<TransactionHeader> {
  // Get the TransactionHeader
  const data = await client.getTransactionWithHeader(transactionHash);

  // Validate TransactionHeader
  if (!data) {
    throw new Error("Transaction not found");
  }
  const { transaction, header } = data;
  if (!header) {
    throw new Error("Header not found");
  }

  return { transaction: transaction.transaction, header };
}

export function epochPartition<T>(
  tt: readonly T[],
  get: (t: T) => ccc.Epoch,
  reference: ccc.Epoch,
) {
  const before: T[] = [];
  const after: T[] = [];
  for (const t of tt) {
    if (epochCompare(get(t), reference) <= 0) {
      before.push(t);
    } else {
      after.push(t);
    }
  }
  return { after, before };
}

export function epochCompare(a: ccc.Epoch, b: ccc.Epoch): 1 | 0 | -1 {
  const [aNumber, aIndex, aLength] = a;
  const [bNumber, bIndex, bLength] = b;

  if (aNumber < bNumber) {
    return -1;
  }
  if (aNumber > bNumber) {
    return 1;
  }

  const v0 = aIndex * bLength;
  const v1 = bIndex * aLength;
  if (v0 < v1) {
    return -1;
  }
  if (v0 > v1) {
    return 1;
  }

  return 0;
}

export function epochAdd(epoch: ccc.Epoch, delta: ccc.Epoch): ccc.Epoch {
  const [eNumber, eIndex, eLength] = epoch;
  const [dNumber, dIndex, dLength] = delta;

  if (eLength === 0n || dLength === 0n) {
    throw new Error("Zero EpochSinceValue length");
  }

  let rawIndex = eIndex;
  if (eLength !== dLength) {
    rawIndex += (dIndex * eLength + dLength - 1n) / dLength;
  } else {
    rawIndex += dIndex;
  }

  const length = eLength;
  const index = rawIndex % length;
  const number = eNumber + dNumber + (rawIndex - index) / length;

  return [number, index, length];
}

// Durstenfeld shuffle, see https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
export function shuffle<T>(a: readonly T[]) {
  const array = [...a];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// BinarySearch is translated from https://go.dev/src/sort/search.go, credits to the respective authors.

// BinarySearch uses binary search to find and return the smallest index i
// in [0, n) at which f(i) is true, assuming that on the range [0, n),
// f(i) == true implies f(i+1) == true. That is, Search requires that
// f is false for some (possibly empty) prefix of the input range [0, n)
// and then true for the (possibly empty) remainder; Search returns
// the first true index. If there is no such index, Search returns n.
// Search calls f(i) only for i in the range [0, n).
export function binarySearch(n: number, f: (i: number) => boolean): number {
  // Define f(-1) == false and f(n) == true.
  // Invariant: f(i-1) == false, f(j) == true.
  let [i, j] = [0, n];
  while (i < j) {
    const h = Math.trunc((i + j) / 2);
    // i ≤ h < j
    if (!f(h)) {
      i = h + 1; // preserves f(i-1) == false
    } else {
      j = h; // preserves f(j) == true
    }
  }
  // i == j, f(i-1) == false, and f(j) (= f(i)) == true  =>  answer is i.
  return i;
}

export function max<T>(...numbers: T[]) {
  return numbers.reduce((a, b) => (a > b ? a : b));
}

export function min<T>(...numbers: T[]) {
  return numbers.reduce((a, b) => (a < b ? a : b));
}
