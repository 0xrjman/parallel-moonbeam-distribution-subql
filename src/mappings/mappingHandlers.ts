import { SubstrateBlock, SubstrateEvent } from "@subql/types";
import { SpecVersion, ClaimedTransaction, DistributedTransaction, TotalClaimed, TotalDistributed } from "../types";
import { FrontierEvmCall } from "@subql/frontier-evm-processor"
import { BigNumber } from 'ethers'
import { hexDataSlice } from "@ethersproject/bytes";

type TransferCallArgs = [string, string, BigNumber] & {
    from: string;
    to: string;
    value: BigNumber;
};

const DISTRIBUTION_ADDRESS = '0x1F695652967615cdE319FDF59dD65B22c380EDC1';

const isDistributionTx = (from: string) => from === DISTRIBUTION_ADDRESS

const isClaimTx = (to: string) => to === DISTRIBUTION_ADDRESS

let specVersion: SpecVersion;
export async function handleBlock(block: SubstrateBlock): Promise<void> {
    if (!specVersion) {
        specVersion = await SpecVersion.get(block.specVersion.toString());
    }

    if (!specVersion || specVersion.id !== block.specVersion.toString()) {
        specVersion = new SpecVersion(block.specVersion.toString());
        specVersion.blockHeight = block.block.header.number.toBigInt();
        await specVersion.save();
    }
    // logger.info(`handle block # ${block.block.header.number.toString()}`)
}

export async function handleTransferEvent(event: SubstrateEvent): Promise<void> {
    const {
        idx,
        event: { data: [signer, dest, amount] },
        hash,
        block: { block: { header: { number: blockHeight } } },
    } = event;
    const from = signer.toString()
    const to = dest.toString()
    const value = amount.toString()
    const txHash = hash.toString()
    const blockNumber = blockHeight.toNumber()

    if (isDistributionTx(from)) {
        logger.info(`handle distribution call ${blockNumber}-${txHash}`)
        const disTransaction = DistributedTransaction.create({
            id: blockNumber + '-' + idx,
            txHash,
            from,
            to,
            value,
            func: undefined,
            blockHeight: blockNumber,
            success: true,
        });
        logger.info(`vest transaction: ${JSON.stringify(disTransaction)}`);
        let totalDistributed = await TotalDistributed.get(DISTRIBUTION_ADDRESS);
        if (totalDistributed) {
            totalDistributed.blockHeight = blockNumber;
            totalDistributed.amount = (BigInt(totalDistributed.amount) + BigInt(value)).toString();
        } else {
            totalDistributed = TotalClaimed.create({
                id: DISTRIBUTION_ADDRESS,
                blockHeight: blockNumber,
                amount: (BigInt(value)).toString()
            });
        }
        logger.info(`totalDistributed: ${JSON.stringify(totalDistributed)}`);
        await Promise.all([
            disTransaction.save(),
            totalDistributed.save(),
        ]);
        return
    }

    if (isClaimTx(to)) {
        logger.info(`handle claim call ${blockNumber}-${txHash}`)
        const claimedTransaction = ClaimedTransaction.create({
            id: blockNumber + '-' + idx,
            txHash,
            from,
            to,
            value,
            func: undefined,
            blockHeight: blockNumber,
            success: true,
        });
        logger.info(`claim transaction: ${JSON.stringify(claimedTransaction)}`);
        let totalClaimed = await TotalClaimed.get(DISTRIBUTION_ADDRESS);
        if (totalClaimed) {
            totalClaimed.blockHeight = blockNumber;
            totalClaimed.amount = (BigInt(totalClaimed.amount) + BigInt(value)).toString();
        } else {
            totalClaimed = TotalClaimed.create({
                id: DISTRIBUTION_ADDRESS,
                blockHeight: blockNumber,
                amount: (BigInt(value)).toString()
            });
        }
        logger.info(`totalClaimed: ${JSON.stringify(totalClaimed)}`);

        await Promise.all([
            claimedTransaction.save(),
            totalClaimed.save(),
        ]);
    }
}

export async function handleFrontierEvmCall(call: FrontierEvmCall<TransferCallArgs>): Promise<void> {
    if (!call.hash || !call.success) return
    logger.info(`handle distribution call ${call.blockNumber}-${call.hash}`)

    const func = call.data ? hexDataSlice(call.data, 0, 4) : undefined
    // Collect distribute transaction
    if (isDistributionTx(call.from)) {
        const disTransaction = DistributedTransaction.create({
            id: call.hash,
            txHash: call.hash,
            from: call.from,
            to: call.to,
            value: call.value.toString(),
            func,
            blockHeight: call.blockNumber,
            success: call.success,
        });
        logger.info(`vest transaction: ${JSON.stringify(disTransaction)}`);
        let totalDistributed = await TotalDistributed.get(DISTRIBUTION_ADDRESS);
        if (totalDistributed) {
            totalDistributed.blockHeight = call.blockNumber;
            totalDistributed.amount = (BigInt(totalDistributed.amount) + BigInt(call.value.toString())).toString();
        } else {
            totalDistributed = TotalClaimed.create({
                id: DISTRIBUTION_ADDRESS,
                blockHeight: call.blockNumber,
                amount: (BigInt(call.value.toString())).toString()
            });
        }
        logger.info(`totalDistributed: ${JSON.stringify(totalDistributed)}`);
        await Promise.all([
            disTransaction.save(),
            totalDistributed.save(),
        ]);
        return
    }

    // Collect the claim transaction
    if (isClaimTx(call.to)) {
        const idx = `${call.blockNumber}-${call.hash}`
        logger.info(`handle claim call ${idx}`)
        const claimedTransaction = ClaimedTransaction.create({
            id: idx,
            txHash: call.hash,
            from: call.from,
            to: call.to,
            value: call.value.toString(),
            func,
            blockHeight: call.blockNumber,
            success: call.success,
        });
        logger.info(`claim transaction: ${JSON.stringify(claimedTransaction)}`);
        let totalClaimed = await TotalClaimed.get(DISTRIBUTION_ADDRESS);
        if (totalClaimed) {
            totalClaimed.blockHeight = call.blockNumber;
            totalClaimed.amount = (BigInt(totalClaimed.amount) + BigInt(call.value.toString())).toString();
        } else {
            totalClaimed = TotalClaimed.create({
                id: DISTRIBUTION_ADDRESS,
                blockHeight: call.blockNumber,
                amount: (BigInt(call.value.toString())).toString()
            });
        }
        logger.info(`totalClaimed: ${JSON.stringify(totalClaimed)}`);

        await Promise.all([
            claimedTransaction.save(),
            totalClaimed.save(),
        ]);
    }
}