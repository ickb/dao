import { BI, BIish } from "@ckb-lumos/bi"
import { getConfig } from "@ckb-lumos/config-manager/lib";
import { Cell, CellDep, OutPoint, Script, blockchain } from "@ckb-lumos/base";
import { TransactionSkeletonType, createTransactionFromSkeleton } from "@ckb-lumos/helpers";
import { getRpc } from "./chain_adapter";

export function defaultScript(name: string): Script {
    let configData = getConfig().SCRIPTS[name];
    if (!configData) {
        throw Error(name + " not found");
    }

    return {
        codeHash: configData.CODE_HASH,
        hashType: configData.HASH_TYPE,
        args: "0x"
    };
}

export function defaultCellDeps(name: string): CellDep {
    let configData = getConfig().SCRIPTS[name];
    if (!configData) {
        throw Error(name + " not found");
    }

    return {
        outPoint: {
            txHash: configData.TX_HASH,
            index: configData.INDEX,
        },
        depType: configData.DEP_TYPE,
    };
}

export function scriptEq(s0: Script | undefined, s1: Script | undefined) {
    return isScript(s0, s1) && s0!.args === s1!.args;
}

export function isScript(s0: Script | undefined, s1: Script | undefined) {
    if (!s0 && !s1) {
        throw Error("Comparing two undefined Scripts")
    }
    if (!s0 || !s1) {
        return false;
    }
    return s0.codeHash === s1.codeHash &&
        s0.hashType === s1.hashType;
}

export const DAO_DEPOSIT_DATA = "0x0000000000000000";

export function isDAODeposit(c: Cell) {
    return scriptEq(c.cellOutput.type, defaultScript("DAO")) && c.data === DAO_DEPOSIT_DATA;
}

export function isDAOWithdrawal(c: Cell) {
    return scriptEq(c.cellOutput.type, defaultScript("DAO")) && c.data !== DAO_DEPOSIT_DATA;
}

export type Epoch = {
    length: BI;
    index: BI;
    number: BI;
};

export function parseEpoch(epoch: BIish): Epoch {
    const _epoch = BI.from(epoch);
    return {
        length: _epoch.shr(40).and(0xfff),
        index: _epoch.shr(24).and(0xfff),
        number: _epoch.and(0xffffff),
    };
}

export function epochCompare(e0: Epoch, e1: Epoch): 1 | 0 | -1 {
    if (e0.number.lt(e1.number)) {
        return -1;
    }

    if (e0.number.gt(e1.number)) {
        return 1;
    }

    const v0 = e0.index.mul(e1.length);
    const v1 = e1.index.mul(e0.length);

    if (v0.lt(v1)) {
        return -1;
    }

    if (v0.gt(v1)) {
        return 1;
    }

    return 0;
}

export function stringifyEpoch(e: Epoch) {
    return BI.from(e.length.shl(40))
        .add(e.index.shl(24))
        .add(e.number)
        .toHexString();
}

export function txSize(transaction: TransactionSkeletonType) {
    const serializedTx = blockchain.Transaction.pack(createTransactionFromSkeleton(transaction));
    // 4 is serialized offset bytesize;
    return serializedTx.byteLength + 4;
}

export function calculateFee(size: number, feeRate: BIish): BI {
    const ratio = BI.from(1000);
    const base = BI.from(size).mul(feeRate);
    const fee = base.div(ratio);
    if (fee.mul(ratio).lt(base)) {
        return fee.add(1);
    }
    return fee;
}

export async function getLiveCell(outPoint: OutPoint) {
    const rpc = getRpc();
    const res = await rpc.getLiveCell(outPoint, true);
    const blockHash = (await rpc.getTransactionProof([outPoint.txHash])).blockHash;
    const blockNumber = (await rpc.getBlock(blockHash)).header.number

    if (res.status !== "live")
        throw new Error(`Live cell not found at out point: ${outPoint.txHash}-${outPoint.index}`);

    return <Cell>{
        cellOutput: res.cell.output,
        outPoint,
        data: res.cell.data.content,
        blockHash,
        blockNumber
    }
}