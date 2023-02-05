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

const MAIN_REWARDS_ADDRESS = '0x508eb96dc541c8E88A8A3fce4618B5fB9fA3f209';
const DISTRIBUTION_ADDRESS = '0x1F695652967615cdE319FDF59dD65B22c380EDC1';

const MOONBEAM_CROWDLOAN_ID = '2004-12KHAurRWMFJyxU57S9pQerHsKLCwvWKM1d3dKZVx7gSfkFJ-1';

const PRE_CLAIMED_AMOUNT = '4367295495494540000000000'

const isDistributionTx = (from: string) =>
    from === DISTRIBUTION_ADDRESS

const isClaimTx = (from: string, to: string) =>
    from === MAIN_REWARDS_ADDRESS && to === DISTRIBUTION_ADDRESS

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
            crowdloanId: MOONBEAM_CROWDLOAN_ID,
            txHash,
            from,
            to,
            value,
            func: undefined,
            blockHeight: blockNumber,
            success: true,
        });
        logger.info(`vest transaction: ${JSON.stringify(disTransaction)}`);
        await disTransaction.save();
        return
    }

    if (isClaimTx(from, to)) {
        logger.info(`handle claim call ${blockNumber}-${txHash}`)
        const claimedTransaction = ClaimedTransaction.create({
            id: blockNumber + '-' + idx,
            crowdloanId: MOONBEAM_CROWDLOAN_ID,
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
                amount: (BigInt(PRE_CLAIMED_AMOUNT) + BigInt(value)).toString()
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
    if (call.from === DISTRIBUTION_ADDRESS) {
        const disTransaction = DistributedTransaction.create({
            id: call.hash,
            crowdloanId: MOONBEAM_CROWDLOAN_ID,
            txHash: call.hash,
            from: call.from,
            to: call.to,
            value: call.value.toString(),
            func,
            blockHeight: call.blockNumber,
            success: call.success,
        });
        logger.info(`vest transaction: ${JSON.stringify(disTransaction)}`);

        await disTransaction.save();
        return
    }

    // Collect the claim transaction
    if (
        call.from === MAIN_REWARDS_ADDRESS
        && call.to === DISTRIBUTION_ADDRESS
    ) {
        const idx = `${call.blockNumber}-${call.hash}`
        logger.info(`handle claim call ${idx}`)
        const claimedTransaction = ClaimedTransaction.create({
            id: idx,
            crowdloanId: MOONBEAM_CROWDLOAN_ID,
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
                amount: (BigInt(PRE_CLAIMED_AMOUNT) + BigInt(call.value.toString())).toString()
            });
        }
        logger.info(`totalClaimed: ${JSON.stringify(totalClaimed)}`);

        await Promise.all([
            claimedTransaction.save(),
            totalClaimed.save(),
        ]);
    }
}