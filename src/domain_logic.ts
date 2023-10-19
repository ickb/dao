import { RPC } from "@ckb-lumos/rpc";
import { BI } from "@ckb-lumos/bi"
import { TransactionSkeleton, TransactionSkeletonType, minimalCellCapacityCompatible } from "@ckb-lumos/helpers";
import { bytes } from "@ckb-lumos/codec";
import { Cell, CellDep, Header, Hexadecimal, Script, Transaction, WitnessArgs, blockchain } from "@ckb-lumos/base";
import { calculateDaoEarliestSinceCompatible, calculateMaximumWithdrawCompatible } from "@ckb-lumos/common-scripts/lib/dao";
import { Uint64LE } from "@ckb-lumos/codec/lib/number/uint";
import { calculateFee, defaultCellDeps, defaultScript, isDAODeposit, isDAOWithdrawal, scriptEq, scriptIs, txSize } from "./utils";
import { getRpc, getHeaderByNumber as getHeaderByNumber_ } from "./chain_adapter";
import { getConfig } from "./config";

export class TransactionBuilder {
    protected readonly accountLock: Script;
    protected readonly signer: (tx: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>;

    protected readonly getHeaderByNumber: (blockNumber: Hexadecimal) => Promise<Header>;

    protected readonly feeRate: BI

    protected inputs: Cell[];
    protected outputs: Cell[];

    constructor(
        accountLock: Script,
        signer: (tx: TransactionSkeletonType, accountLock: Script) => Promise<Transaction>,
        getHeaderByNumber: (blockNumber: Hexadecimal) => Promise<Header> = getHeaderByNumber_,
        feeRate: BI = BI.from(1000),
    ) {
        this.accountLock = accountLock;
        this.signer = signer;

        this.getHeaderByNumber = getHeaderByNumber;

        this.feeRate = feeRate;

        this.inputs = [];
        this.outputs = [];
    }

    add(source: "input" | "output", position: "start" | "end", ...cells: Cell[]) {
        if (source === "input") {
            if (position === "start") {
                this.inputs.unshift(...cells);
            } else {
                this.inputs.push(...cells);
            }

            if (this.inputs.some((c) => !c.blockNumber)) {
                throw Error("All input cells must have blockNumber populated");
            }
        } else {
            if (position === "start") {
                this.outputs.unshift(...cells);
            } else {
                this.outputs.push(...cells);
            }
        }

        return this;
    }

    async buildAndSend(secondsTimeout: number = 600) {
        const { transaction, fee } = await this.toTransactionSkeleton();

        const signedTransaction = await this.signer(transaction, this.accountLock);

        const txHash = await sendTransaction(signedTransaction, getRpc(), secondsTimeout);

        return { transaction, fee, signedTransaction, txHash }
    }

    async toTransactionSkeleton() {
        const ckbDelta = await this.getCkbDelta();

        const fee = calculateFee(txSize(await this.buildWithChange(ckbDelta)), this.feeRate);

        return { transaction: await this.buildWithChange(ckbDelta.sub(fee)), fee };
    }

    protected async buildWithChange(ckbDelta: BI) {
        const changeCells: Cell[] = [];
        if (ckbDelta.eq(0)) {
            //Do nothing
        } else {
            const changeCell = {
                cellOutput: {
                    capacity: ckbDelta.toHexString(),
                    lock: this.accountLock,
                    type: undefined,
                },
                data: "0x"
            }
            changeCells.push(changeCell);
            const minimalCapacity = minimalCellCapacityCompatible(changeCell, { validate: false });
            if (!ckbDelta.gte(minimalCapacity)) {
                throw Error("Not enough funds to execute the transaction");
            }
        }
        let transaction = TransactionSkeleton();
        transaction = transaction.update("inputs", (i) => i.push(...this.inputs));
        transaction = transaction.update("outputs", (o) => o.push(...this.outputs, ...changeCells));

        transaction = addCellDeps(transaction);

        const getBlockHash = async (blockNumber: Hexadecimal) => (await this.getHeaderByNumber(blockNumber)).hash;

        transaction = await addHeaderDeps(transaction, getBlockHash);

        transaction = await addInputSinces(transaction, async (c: Cell) => this.withdrawedDaoSince(c));

        transaction = await addWitnessPlaceholders(transaction, this.accountLock, getBlockHash);

        transaction = transaction.update(
            "fixedEntries", (e) => e.push(
                { field: "inputs", index: transaction.inputs.size },
                { field: "outputs", index: transaction.outputs.size - changeCells.length },
                { field: "headerDeps", index: transaction.headerDeps.size },
                { field: "inputSinces", index: transaction.inputSinces.size }
            )
        );

        return transaction;
    }

    async getCkbDelta() {
        let ckbDelta = BI.from(0);
        for (const c of this.inputs) {
            //Second Withdrawal step from NervosDAO
            if (isDAODeposit(c)) {
                const depositHeader = await this.getHeaderByNumber(Uint64LE.unpack(c.data).toHexString());
                const withdrawalHeader = await this.getHeaderByNumber(c.blockNumber!);
                const maxWithdrawable = calculateMaximumWithdrawCompatible(c, depositHeader.dao, withdrawalHeader.dao)
                ckbDelta = ckbDelta.add(maxWithdrawable);
            } else {
                ckbDelta = ckbDelta.add(c.cellOutput.capacity);
            }
        }

        this.outputs.forEach((c) => ckbDelta = ckbDelta.sub(c.cellOutput.capacity));

        return ckbDelta;
    }

    protected async withdrawedDaoSince(c: Cell) {
        if (!isDAOWithdrawal(c)) {
            throw Error("Not a withdrawed dao cell")
        }

        const withdrawalHeader = await this.getHeaderByNumber(c.blockNumber!);
        const depositHeader = await this.getHeaderByNumber(Uint64LE.unpack(c.data).toHexString());

        return calculateDaoEarliestSinceCompatible(depositHeader.epoch, withdrawalHeader.epoch);
    }

    getAccountLock(): Script {
        return { ...this.accountLock }
    }
}

function addCellDeps(transaction: TransactionSkeletonType) {
    if (transaction.cellDeps.size !== 0) {
        throw new Error("This function can only be used on an empty cell deps structure.");
    }

    const prefix2Name: Map<string, string> = new Map();
    for (const scriptName in getConfig().SCRIPTS) {
        prefix2Name.set(scriptName.split("$")[0], scriptName);
    }

    const serializeScript = (s: Script) => `${s.codeHash}-${s.hashType}`
    const serializedScript2CellDeps: Map<string, CellDep[]> = new Map();
    for (const scriptName in getConfig().SCRIPTS) {
        const s = defaultScript(scriptName);
        const cellDeps: CellDep[] = [];
        for (const prefix of scriptName.split("$")) {
            cellDeps.push(defaultCellDeps(prefix2Name.get(prefix)!));
        }
        serializedScript2CellDeps.set(serializeScript(s), cellDeps);
    }

    const scripts: Script[] = [];
    for (const c of transaction.inputs) {
        scripts.push(c.cellOutput.lock)
    }
    for (const c of [...transaction.outputs, ...transaction.inputs]) {
        if (c.cellOutput.type) {
            scripts.push(c.cellOutput.type)
        }
    }

    const serializeCellDep = (d: CellDep) => `${d.outPoint.txHash}-${d.outPoint.index}-${d.depType}`;
    const serializedCellDep2CellDep: Map<string, CellDep> = new Map();
    for (const script of scripts) {
        const cellDeps = serializedScript2CellDeps.get(serializeScript(script));
        if (cellDeps === undefined) {
            throw Error("CellDep not found for script " + String(script));
        }
        for (const cellDep of cellDeps) {
            serializedCellDep2CellDep.set(serializeCellDep(cellDep), cellDep);
        }
    }

    return transaction.update("cellDeps", (cellDeps) => cellDeps.push(...serializedCellDep2CellDep.values()));
}

async function addHeaderDeps(transaction: TransactionSkeletonType, blockNumber2BlockHash: (h: Hexadecimal) => Promise<Hexadecimal>) {
    if (transaction.headerDeps.size !== 0) {
        throw new Error("This function can only be used on an empty header deps structure.");
    }

    const uniqueBlockHashes: Set<string> = new Set();
    for (const c of transaction.inputs) {
        if (!c.blockNumber) {
            throw Error("Cell must have blockNumber populated");
        }

        if (isDAODeposit(c)) {
            uniqueBlockHashes.add(await blockNumber2BlockHash(c.blockNumber));
            continue;
        }

        if (isDAOWithdrawal(c)) {
            uniqueBlockHashes.add(await blockNumber2BlockHash(c.blockNumber));
            uniqueBlockHashes.add(await blockNumber2BlockHash(Uint64LE.unpack(c.data).toHexString()));
        }
    }

    transaction = transaction.update("headerDeps", (h) => h.push(...uniqueBlockHashes.keys()));

    return transaction;
}

async function addInputSinces(transaction: TransactionSkeletonType, withdrawedDaoSince: (c: Cell) => Promise<BI>) {
    if (transaction.inputSinces.size !== 0) {
        throw new Error("This function can only be used on an empty input sinces structure.");
    }

    for (const [index, c] of transaction.inputs.entries()) {
        if (isDAOWithdrawal(c)) {
            const since = await withdrawedDaoSince(c);
            transaction = transaction.update("inputSinces", (inputSinces) => {
                return inputSinces.set(index, since.toHexString());
            });
        }
    }

    return transaction;
}

async function addWitnessPlaceholders(transaction: TransactionSkeletonType, accountLock: Script, blockNumber2BlockHash: (h: Hexadecimal) => Promise<Hexadecimal>) {
    if (transaction.witnesses.size !== 0) {
        throw new Error("This function can only be used on an empty witnesses structure.");
    }

    let paddingCountDown = 1//Only first occurrence
    const pwLock = "PW_LOCK$SECP256K1_BLAKE160";
    if (pwLock in getConfig().SCRIPTS && scriptIs(accountLock, pwLock)) {
        paddingCountDown = transaction.inputs.size;//All occurrences
    }

    for (const c of transaction.inputs) {
        const witnessArgs: WitnessArgs = { lock: "0x" };

        if (paddingCountDown > 0 && scriptEq(c.cellOutput.lock, accountLock)) {
            witnessArgs.lock = "0x" + "00".repeat(65);
            paddingCountDown -= 1;
        }

        if (isDAODeposit(c)) {
            const blockHash = await blockNumber2BlockHash(Uint64LE.unpack(c.data).toHexString());
            const headerDepIndex = transaction.headerDeps.findIndex((v) => v == blockHash);
            if (headerDepIndex === -1) {
                throw Error("Block hash not found in Header Dependencies")
            }
            witnessArgs.inputType = bytes.hexify(Uint64LE.pack(headerDepIndex));
        }

        const packedWitness = bytes.hexify(blockchain.WitnessArgs.pack(witnessArgs));
        transaction = transaction.update("witnesses", (w) => w.push(packedWitness));
    }

    return transaction;
}

async function sendTransaction(signedTransaction: Transaction, rpc: RPC, secondsTimeout: number) {
    //Send the transaction
    const txHash = await rpc.sendTransaction(signedTransaction);

    //Wait until the transaction is committed or time out after ten minutes
    for (let i = 0; i < secondsTimeout; i++) {
        let transactionData = await rpc.getTransaction(txHash);
        switch (transactionData.txStatus.status) {
            case "committed":
                return txHash;
            case "pending":
            case "proposed":
                await new Promise(r => setTimeout(r, 1000));
                break;
            default:
                throw new Error("Unexpected transaction state: " + transactionData.txStatus.status);
        }
    }

    throw new Error("Transaction timed out, 10 minutes elapsed from submission.");
}