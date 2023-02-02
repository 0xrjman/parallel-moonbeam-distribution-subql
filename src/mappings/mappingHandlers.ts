import { SubstrateBlock } from "@subql/types";
import { SpecVersion, ClaimedTransaction, DistributedTransaction, TotalClaimed } from "../types";
import { FrontierEvmCall } from "@subql/frontier-evm-processor"
import { BigNumber } from 'ethers'
import { hexDataSlice, stripZeros } from "@ethersproject/bytes";

// type TransferEventArgs = [string, string, BigNumber] & { from: string; to: string; value: BigNumber; };

const MAIN_REWARDS_ADDRESS = '0x508eb96dc541c8e88a8a3fce4618b5fb9fa3f209';
const DISTRIBUTION_ADDRESS = '0x1f695652967615cde319fdf59dd65b22c380edc1';

const MOONBEAM_CROWDLOAN_ID = '2004-12KHAurRWMFJyxU57S9pQerHsKLCwvWKM1d3dKZVx7gSfkFJ-1';

const PRE_CLAIMED_AMOUNT = '4367295495494540000000000'

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
    logger.info(`handle block # ${block.block.header.number.toString()}`)
}

export async function handleMoonbeamCall(call: FrontierEvmCall): Promise<void> {
    logger.info(`handle call ${call.blockNumber}-${call.hash}`)
    if (!call.hash || !call.success) {
        return;
    }
    // Collect distribute transaction
    if (call.from === DISTRIBUTION_ADDRESS) {
        const disTransaction = DistributedTransaction.create({
            id: call.hash,
            crowdloanId: MOONBEAM_CROWDLOAN_ID,
            txHash: call.hash,
            from: call.from,
            to: call.to,
            value: call.value.toString(),
            func: call.data,
            blockHeight: call.blockNumber,
            success: call.success,
        });
        logger.info(`vest transaction: ${JSON.stringify(disTransaction)}`);
        await disTransaction.save();
        return
    }

    // Collect the claim transaction
    if (call.from != MAIN_REWARDS_ADDRESS || call.to != DISTRIBUTION_ADDRESS) {
        return;
    }
    const func = stripZeros(call.data).length === 0 ? undefined : hexDataSlice(call.data, 0, 4)
    const idx = `${call.blockNumber}-${call.blockHash}`
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
        totalClaimed.amount = (BigNumber.from(totalClaimed.amount).add(call.value)).toString();
    } else {
        totalClaimed = TotalClaimed.create({
            id: DISTRIBUTION_ADDRESS,
            blockHeight: call.blockNumber,
            amount: (BigNumber.from(PRE_CLAIMED_AMOUNT).add(call.value)).toString()
        });
    }
    logger.info(`totalClaimed: ${JSON.stringify(totalClaimed)}`);

    await Promise.all([
        claimedTransaction.save(),
        totalClaimed.save(),
    ]);
}