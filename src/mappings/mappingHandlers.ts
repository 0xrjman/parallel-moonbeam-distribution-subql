// Follow https://github.com/parallel-finance/acala-distribution-subql/blob/e8514498b5f487199a5d74f80ac8dbc8be374e4f/src/mappings/mappingHandlers.ts
import { SubstrateBlock, SubstrateEvent } from "@subql/types";
import { SpecVersion, ClaimedTransaction, DistributedTransaction, TotalClaimed, TotalDistributed } from "../types";
import { FrontierEvmCall } from "@subql/frontier-evm-processor"
import { BigNumber } from 'ethers'

type TransferCallArgs = [string, string, BigNumber] & {
    from: string;
    to: string;
    value: BigNumber;
};

type Tx = {
    id: string; // tx hash
    from: string;
    to: string;
    amount: string;
    blockHeight: number;
    timestamp: Date;
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

async function handleDistribution(tx: Tx): Promise<void> {
    try {
        logger.info(`handle distribution call ${tx.blockHeight}-${tx.id}`)
        let txKey = tx.blockHeight + '-' + tx.id
        let disTransaction = await DistributedTransaction.get(txKey);
        if (disTransaction !== undefined) {
            logger.warn(`distribution tx [${txKey}] has been recorded`);
            return;
        }
        disTransaction = DistributedTransaction.create({
            id: tx.blockHeight + '-' + tx.id,
            txHash: tx.id,
            from: tx.from,
            to: tx.to,
            amount: tx.amount,
            blockHeight: tx.blockHeight,
            success: true,
        });
        logger.info(`vest transaction ${disTransaction.from}, amount ${disTransaction.amount}`);
        let totalDistributed = await TotalDistributed.get(tx.from);
        if (totalDistributed === undefined) {
            totalDistributed = TotalDistributed.create({
                id: tx.from,
                amount: tx.amount,
                blockHeight: tx.blockHeight,
            });
        }
        totalDistributed.amount = (BigInt(totalDistributed.amount) + BigInt(tx.amount)).toString();

        await Promise.all([
            disTransaction.save(),
            totalDistributed.save(),
        ]);
        return
    } catch (e) {
        logger.error(`handle account[${tx.from}] total distribution error: %o`, e);
        throw e;
    }
}

async function handleClaim(tx: Tx): Promise<void> {
    try {
        logger.info(`handle claim call ${tx.blockHeight}-${tx.id}`)
        let txKey = tx.blockHeight + '-' + tx.id
        let claimTransaction = await ClaimedTransaction.get(txKey);
        if (claimTransaction !== undefined) {
            logger.warn(`claim tx [${txKey}] has been recorded`);
            return;
        }
        claimTransaction = ClaimedTransaction.create({
            id: txKey,
            txHash: tx.id,
            from: tx.from,
            to: tx.to,
            amount: tx.amount,
            blockHeight: tx.blockHeight,
            success: true,
        });
        logger.info(`claim transaction ${tx.to}, amount ${claimTransaction.amount}`);
        let totalClaimed = await TotalClaimed.get(tx.to);
        if (totalClaimed === undefined) {
            totalClaimed = TotalClaimed.create({
                id: tx.to,
                amount: tx.amount,
                blockHeight: tx.blockHeight,
            });
        }
        totalClaimed.amount = (BigInt(totalClaimed.amount) + BigInt(tx.amount)).toString();

        await Promise.all([
            claimTransaction.save(),
            totalClaimed.save(),
        ]);
        return
    } catch (e) {
        logger.error(`handle account[${tx.to}] total claim error: %o`, e);
        throw e;
    }
}

export async function handleTransferEvent(event: SubstrateEvent): Promise<void> {
    const {
        event: {
            data: [signer, dest, value]
        },
    } = event;
    const from = signer.toString()
    const to = dest.toString()
    const isDistribution = isDistributionTx(from);
    const isClaim = isClaimTx(to);

    if (!isDistribution && !isClaim) return

    const idx = event.idx;
    const blockNumber = event.block.block.header.number.toNumber();
    const txHash = event.extrinsic.extrinsic.hash.toString()
    const amount = value.toString()

    const tx: Tx = {
        id: `${txHash}-${idx}`,
        from,
        to,
        amount,
        blockHeight: blockNumber,
        timestamp: event.block.timestamp,
    };
    if (isDistribution) {
        await handleDistribution(tx);
    } else if (isClaim) {
        await handleClaim(tx);
    }
}

export async function handleFrontierEvmCall(call: FrontierEvmCall<TransferCallArgs>): Promise<void> {
    if (!call.hash || !call.success) return
    logger.info(`handle distribution call ${call.blockNumber}-${call.hash}`)

    // Collect distribute transaction
    if (isDistributionTx(call.from)) {
        const disTransaction = DistributedTransaction.create({
            id: call.hash,
            txHash: call.hash,
            from: call.from,
            to: call.to,
            amount: call.value.toString(),
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
            amount: call.value.toString(),
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