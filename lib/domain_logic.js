"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionBuilder = void 0;
const bi_1 = require("@ckb-lumos/bi");
const helpers_1 = require("@ckb-lumos/helpers");
const codec_1 = require("@ckb-lumos/codec");
const base_1 = require("@ckb-lumos/base");
const dao_1 = require("@ckb-lumos/common-scripts/lib/dao");
const uint_1 = require("@ckb-lumos/codec/lib/number/uint");
const utils_1 = require("./utils");
const chain_adapter_1 = require("./chain_adapter");
const config_1 = require("./config");
class TransactionBuilder {
    constructor(accountLock, signer, getHeaderByNumber = chain_adapter_1.getHeaderByNumber, feeRate = bi_1.BI.from(1000), padAllLockOccurrences = false //PW_LOCK compatibility
    ) {
        this.accountLock = accountLock;
        this.signer = signer;
        this.getHeaderByNumber = getHeaderByNumber;
        this.feeRate = feeRate;
        this.padAllLockOccurrences = padAllLockOccurrences;
        this.inputs = [];
        this.outputs = [];
    }
    add(source, position, ...cells) {
        if (source === "input") {
            if (position === "start") {
                this.inputs.unshift(...cells);
            }
            else {
                this.inputs.push(...cells);
            }
            if (this.inputs.some((c) => !c.blockNumber)) {
                throw Error("All input cells must have blockNumber populated");
            }
        }
        else {
            if (position === "start") {
                this.outputs.unshift(...cells);
            }
            else {
                this.outputs.push(...cells);
            }
        }
        return this;
    }
    async buildAndSend(secondsTimeout = 600) {
        const { transaction, fee } = await this.toTransactionSkeleton();
        const signedTransaction = await this.signer(transaction, this.accountLock);
        const txHash = await sendTransaction(signedTransaction, (0, chain_adapter_1.getRpc)(), secondsTimeout);
        return { transaction, fee, signedTransaction, txHash };
    }
    async toTransactionSkeleton() {
        const ckbDelta = await this.getCkbDelta();
        const fee = (0, utils_1.calculateFee)((0, utils_1.txSize)(await this.build(ckbDelta)), this.feeRate);
        return { transaction: await this.build(ckbDelta.sub(fee)), fee };
    }
    async build(ckbDelta) {
        const changeCells = await this.toChange(ckbDelta);
        let transaction = (0, helpers_1.TransactionSkeleton)();
        transaction = transaction.update("inputs", (i) => i.push(...this.inputs));
        transaction = transaction.update("outputs", (o) => o.push(...this.outputs, ...changeCells));
        transaction = addCellDeps(transaction);
        const getBlockHash = async (blockNumber) => (await this.getHeaderByNumber(blockNumber)).hash;
        transaction = await addHeaderDeps(transaction, getBlockHash);
        transaction = await addInputSinces(transaction, async (c) => this.withdrawedDaoSince(c));
        transaction = await addWitnessPlaceholders(transaction, this.accountLock, this.padAllLockOccurrences, getBlockHash);
        transaction = transaction.update("fixedEntries", (e) => e.push({ field: "inputs", index: transaction.inputs.size }, { field: "outputs", index: transaction.outputs.size - changeCells.length }, { field: "headerDeps", index: transaction.headerDeps.size }, { field: "inputSinces", index: transaction.inputSinces.size }));
        return transaction;
    }
    async toChange(ckbDelta, changeCells = []) {
        if (ckbDelta.lt(0)) {
            throw Error("Missing CKB: not enough funds to execute the transaction");
        }
        else if (ckbDelta.eq(0)) {
            //Do nothing
        }
        else {
            const changeCell = {
                cellOutput: {
                    capacity: ckbDelta.toHexString(),
                    lock: this.accountLock,
                    type: undefined,
                },
                data: "0x"
            };
            changeCells.push(changeCell);
            const minimalCapacity = (0, helpers_1.minimalCellCapacityCompatible)(changeCell, { validate: false });
            if (ckbDelta.lt(minimalCapacity)) {
                throw Error("Missing CKB: not enough funds to execute the transaction");
            }
        }
        return changeCells;
    }
    async getCkbDelta() {
        let ckbDelta = bi_1.BI.from(0);
        for (const c of this.inputs) {
            //Second Withdrawal step from NervosDAO
            if ((0, utils_1.isDAODeposit)(c)) {
                const depositHeader = await this.getHeaderByNumber(uint_1.Uint64LE.unpack(c.data).toHexString());
                const withdrawalHeader = await this.getHeaderByNumber(c.blockNumber);
                const maxWithdrawable = (0, dao_1.calculateMaximumWithdrawCompatible)(c, depositHeader.dao, withdrawalHeader.dao);
                ckbDelta = ckbDelta.add(maxWithdrawable);
            }
            else {
                ckbDelta = ckbDelta.add(c.cellOutput.capacity);
            }
        }
        this.outputs.forEach((c) => ckbDelta = ckbDelta.sub(c.cellOutput.capacity));
        return ckbDelta;
    }
    async withdrawedDaoSince(c) {
        if (!(0, utils_1.isDAOWithdrawal)(c)) {
            throw Error("Not a withdrawed dao cell");
        }
        const withdrawalHeader = await this.getHeaderByNumber(c.blockNumber);
        const depositHeader = await this.getHeaderByNumber(uint_1.Uint64LE.unpack(c.data).toHexString());
        return (0, dao_1.calculateDaoEarliestSinceCompatible)(depositHeader.epoch, withdrawalHeader.epoch);
    }
    getAccountLock() {
        return { ...this.accountLock };
    }
}
exports.TransactionBuilder = TransactionBuilder;
function addCellDeps(transaction) {
    if (transaction.cellDeps.size !== 0) {
        throw new Error("This function can only be used on an empty cell deps structure.");
    }
    const prefix2Name = new Map();
    for (const scriptName of (0, config_1.scriptNames)()) {
        prefix2Name.set(scriptName.split("$")[0], scriptName);
    }
    const serializeScript = (s) => `${s.codeHash}-${s.hashType}`;
    const serializedScript2CellDeps = new Map();
    for (const scriptName of (0, config_1.scriptNames)()) {
        const s = (0, config_1.defaultScript)(scriptName);
        const cellDeps = [];
        for (const prefix of scriptName.split("$")) {
            cellDeps.push((0, config_1.defaultCellDeps)(prefix2Name.get(prefix)));
        }
        serializedScript2CellDeps.set(serializeScript(s), cellDeps);
    }
    const scripts = [];
    for (const c of transaction.inputs) {
        scripts.push(c.cellOutput.lock);
    }
    for (const c of [...transaction.outputs, ...transaction.inputs]) {
        if (c.cellOutput.type) {
            scripts.push(c.cellOutput.type);
        }
    }
    const serializeCellDep = (d) => `${d.outPoint.txHash}-${d.outPoint.index}-${d.depType}`;
    const serializedCellDep2CellDep = new Map();
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
async function addHeaderDeps(transaction, blockNumber2BlockHash) {
    if (transaction.headerDeps.size !== 0) {
        throw new Error("This function can only be used on an empty header deps structure.");
    }
    const uniqueBlockHashes = new Set();
    for (const c of transaction.inputs) {
        if (!c.blockNumber) {
            throw Error("Cell must have blockNumber populated");
        }
        if ((0, utils_1.isDAODeposit)(c)) {
            uniqueBlockHashes.add(await blockNumber2BlockHash(c.blockNumber));
            continue;
        }
        if ((0, utils_1.isDAOWithdrawal)(c)) {
            uniqueBlockHashes.add(await blockNumber2BlockHash(c.blockNumber));
            uniqueBlockHashes.add(await blockNumber2BlockHash(uint_1.Uint64LE.unpack(c.data).toHexString()));
        }
    }
    transaction = transaction.update("headerDeps", (h) => h.push(...uniqueBlockHashes.keys()));
    return transaction;
}
async function addInputSinces(transaction, withdrawedDaoSince) {
    if (transaction.inputSinces.size !== 0) {
        throw new Error("This function can only be used on an empty input sinces structure.");
    }
    for (const [index, c] of transaction.inputs.entries()) {
        if ((0, utils_1.isDAOWithdrawal)(c)) {
            const since = await withdrawedDaoSince(c);
            transaction = transaction.update("inputSinces", (inputSinces) => {
                return inputSinces.set(index, since.toHexString());
            });
        }
    }
    return transaction;
}
async function addWitnessPlaceholders(transaction, accountLock, padAllLockOccurrences, blockNumber2BlockHash) {
    if (transaction.witnesses.size !== 0) {
        throw new Error("This function can only be used on an empty witnesses structure.");
    }
    let paddingCountDown = padAllLockOccurrences ? transaction.inputs.size : 1;
    for (const c of transaction.inputs) {
        const witnessArgs = { lock: "0x" };
        if (paddingCountDown > 0 && (0, utils_1.scriptEq)(c.cellOutput.lock, accountLock)) {
            witnessArgs.lock = "0x" + "00".repeat(65);
            paddingCountDown -= 1;
        }
        if ((0, utils_1.isDAODeposit)(c)) {
            const blockHash = await blockNumber2BlockHash(uint_1.Uint64LE.unpack(c.data).toHexString());
            const headerDepIndex = transaction.headerDeps.findIndex((v) => v == blockHash);
            if (headerDepIndex === -1) {
                throw Error("Block hash not found in Header Dependencies");
            }
            witnessArgs.inputType = codec_1.bytes.hexify(uint_1.Uint64LE.pack(headerDepIndex));
        }
        const packedWitness = codec_1.bytes.hexify(base_1.blockchain.WitnessArgs.pack(witnessArgs));
        transaction = transaction.update("witnesses", (w) => w.push(packedWitness));
    }
    return transaction;
}
async function sendTransaction(signedTransaction, rpc, secondsTimeout) {
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
//# sourceMappingURL=domain_logic.js.map