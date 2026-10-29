{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE UndecidableInstances #-}

module Cardano.Db.Schema.Core.EpochAndProtocol where

import Cardano.Db.Schema.Ids
import Cardano.Db.Types (
  DbInt65,
  DbLovelace (..),
  DbWord64,
  SyncState,
  dbInt65Encoder,
  dbLovelaceDecoder,
  dbLovelaceEncoder,
  maybeDbLovelaceDecoder,
  maybeDbLovelaceEncoder,
  maybeDbWord64Decoder,
  maybeDbWord64Encoder,
  syncStateEncoder,
  word128Decoder,
 )
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant
import Data.Text (Text)
import Data.Time.Clock (UTCTime)
import Data.WideWord.Word128 (Word128)
import Data.Word (Word16, Word64)
import GHC.Generics (Generic)

import Cardano.Db.Schema.Types (utcTimeAsTimestampDecoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Hasql.Decoders as D
import Hasql.Encoders as E

-----------------------------------------------------------------------------------------------------------------------------------
-- EPOCH AND PROTOCOL PARAMETER
-- These tables store fundamental blockchain data, such as blocks, transactions, and UTXOs.
-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: epoch
-- Description: The Epoch table is an aggregation of data in the 'Block' table, but is kept in this form
--   because having it as a 'VIEW' is incredibly slow and inefficient.
--   The 'outsum' type in the PostgreSQL world is 'bigint >= 0' so it will error out if an
--   overflow (sum of tx outputs in an epoch) is detected. 'maxBound :: !Int` is big enough to
--   hold 204 times the total Lovelace distribution. The chance of that much being transacted
--   in a single epoch is relatively low.
-- Schema reference for @epoch@:
-- A view aggregating data within an epoch. As of schema stage-two v49 (migration-2-0049) @epoch@ is a
-- view, not a table: the @UNION ALL@ of @epoch_finalized@ (materialised past epochs) and
-- @epoch_current@ (the live, in-progress epoch). It returns rows only when epoch sync is enabled (see
-- @epoch_sync_enabled@); otherwise it is empty.
data Epoch = Epoch
  { epochOutSum :: !Word128 -- sqltype=word128type

  -- ^ The sum of the transaction output values (in Lovelace) in this epoch.
  , epochFees :: !DbLovelace -- sqltype=lovelace

  -- ^ The sum of the fees (in Lovelace) in this epoch.
  , epochTxCount :: !Word64 -- sqltype=word31type

  -- ^ The number of transactions in this epoch.
  , epochBlkCount :: !Word64 -- sqltype=word31type

  -- ^ The number of blocks in this epoch.
  , epochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch number.
  , epochStartTime :: !UTCTime -- sqltype=timestamp

  -- ^ The epoch start time.
  , epochEndTime :: !UTCTime -- sqltype=timestamp

  -- ^ The epoch end time.
  }
  deriving (Eq, Show, Generic)

type instance Key Epoch = EpochId
instance DbInfo Epoch where
  uniqueFields _ = ["no"]

entityEpochDecoder :: D.Row (Entity Epoch)
entityEpochDecoder =
  Entity
    <$> idDecoder EpochId
    <*> epochDecoder

epochDecoder :: D.Row Epoch
epochDecoder =
  Epoch
    <$> D.column (D.nonNullable word128Decoder) -- epochOutSum
    <*> dbLovelaceDecoder -- epochFees
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochTxCount
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochBlkCount
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochNo
    <*> D.column (D.nonNullable utcTimeAsTimestampDecoder) -- epochStartTime
    <*> D.column (D.nonNullable utcTimeAsTimestampDecoder) -- epochEndTime

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: epochparam
-- Description: Stores parameters relevant to each epoch, such as the number of slots per epoch or the block size limit.
-- Schema reference for @epoch_param@:
-- The accepted protocol parameters for an epoch.
data EpochParam = EpochParam
  { epochParamEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The first epoch for which these parameters are valid.
  , epochParamMinFeeA :: !Word64 -- sqltype=word31type

  -- ^ The 'a' parameter to calculate the minimum transaction fee.
  , epochParamMinFeeB :: !Word64 -- sqltype=word31type

  -- ^ The 'b' parameter to calculate the minimum transaction fee.
  , epochParamMaxBlockSize :: !Word64 -- sqltype=word31type

  -- ^ The maximum block size (in bytes).
  , epochParamMaxTxSize :: !Word64 -- sqltype=word31type

  -- ^ The maximum transaction size (in bytes).
  , epochParamMaxBhSize :: !Word64 -- sqltype=word31type

  -- ^ The maximum block header size (in bytes).
  , epochParamKeyDeposit :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) require for a deposit to register a StakeAddress.
  , epochParamPoolDeposit :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) require for a deposit to register a stake pool.
  , epochParamMaxEpoch :: !Word64 -- sqltype=word31type

  -- ^ The maximum number of epochs in the future that a pool retirement is allowed to be scheduled
  -- for.
  , epochParamOptimalPoolCount :: !Word64 -- sqltype=word31type

  -- ^ The optimal number of stake pools.
  , epochParamInfluence :: !Double
  -- ^ The influence of the pledge on a stake pool's probability on minting a block.
  , epochParamMonetaryExpandRate :: !Double
  -- ^ The monetary expansion rate.
  , epochParamTreasuryGrowthRate :: !Double
  -- ^ The treasury growth rate.
  , epochParamDecentralisation :: !Double
  -- ^ The decentralisation parameter (1 fully centralised, 0 fully decentralised).
  , epochParamProtocolMajor :: !Word16 -- sqltype=word31type

  -- ^ The protocol major number.
  , epochParamProtocolMinor :: !Word16 -- sqltype=word31type

  -- ^ The protocol minor number.
  , epochParamMinUtxoValue :: !DbLovelace -- sqltype=lovelace

  -- ^ The minimum value of a UTxO entry.
  , epochParamMinPoolCost :: !DbLovelace -- sqltype=lovelace

  -- ^ The minimum pool cost.
  , epochParamNonce :: !(Maybe ByteString) -- sqltype=hash32type

  -- ^ The nonce value for this epoch.
  , epochParamCostModelId :: !(Maybe CostModelId) -- noreference

  -- ^ The CostModel table index for the params.
  , epochParamPriceMem :: !(Maybe Double)
  -- ^ The per word cost of script memory usage.
  , epochParamPriceStep :: !(Maybe Double)
  -- ^ The cost of script execution step usage.
  , epochParamMaxTxExMem :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution memory allowed to be used in a single transaction.
  , epochParamMaxTxExSteps :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution steps allowed to be used in a single transaction.
  , epochParamMaxBlockExMem :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution memory allowed to be used in a single block.
  , epochParamMaxBlockExSteps :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution steps allowed to be used in a single block.
  , epochParamMaxValSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum Val size.
  , epochParamCollateralPercent :: !(Maybe Word16) -- sqltype=word31type

  -- ^ The percentage of the txfee which must be provided as collateral when including non-native
  -- scripts.
  , epochParamMaxCollateralInputs :: !(Maybe Word16) -- sqltype=word31type

  -- ^ The maximum number of collateral inputs allowed in a transaction.
  , epochParamBlockId :: !BlockId -- noreference -- The first block where these parameters are valid.

  -- ^ The Block table index for the first block where these parameters are valid.
  , epochParamExtraEntropy :: !(Maybe ByteString) -- sqltype=hash32type

  -- ^ The 32 byte string of extra random-ness to be added into the protocol's entropy pool. New in
  -- v13: renamed from entopy.
  , epochParamCoinsPerUtxoSize :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ For Alonzo this is the cost per UTxO word. For Babbage and later per UTxO byte. New in v13:
  -- Renamed from coins_per_utxo_word.
  , epochParamPvtMotionNoConfidence :: !(Maybe Double)
  -- ^ Pool Voting threshold for motion of no-confidence. New in 13.2-Conway.
  , epochParamPvtCommitteeNormal :: !(Maybe Double)
  -- ^ Pool Voting threshold for new committee/threshold (normal state). New in 13.2-Conway.
  , epochParamPvtCommitteeNoConfidence :: !(Maybe Double)
  -- ^ Pool Voting threshold for new committee/threshold (state of no-confidence). New in 13.2-Conway.
  , epochParamPvtHardForkInitiation :: !(Maybe Double)
  -- ^ Pool Voting threshold for hard-fork initiation. New in 13.2-Conway.
  , epochParamDvtMotionNoConfidence :: !(Maybe Double)
  -- ^ DRep Vote threshold for motion of no-confidence. New in 13.2-Conway.
  , epochParamDvtCommitteeNormal :: !(Maybe Double)
  -- ^ DRep Vote threshold for new committee/threshold (normal state). New in 13.2-Conway.
  , epochParamDvtCommitteeNoConfidence :: !(Maybe Double)
  -- ^ DRep Vote threshold for new committee/threshold (state of no-confidence). New in 13.2-Conway.
  , epochParamDvtUpdateToConstitution :: !(Maybe Double)
  -- ^ DRep Vote threshold for update to the Constitution. New in 13.2-Conway.
  , epochParamDvtHardForkInitiation :: !(Maybe Double)
  -- ^ DRep Vote threshold for hard-fork initiation. New in 13.2-Conway.
  , epochParamDvtPPNetworkGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, network group. New in 13.2-Conway.
  , epochParamDvtPPEconomicGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, economic group. New in 13.2-Conway.
  , epochParamDvtPPTechnicalGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, technical group. New in 13.2-Conway.
  , epochParamDvtPPGovGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, governance group. New in 13.2-Conway.
  , epochParamDvtTreasuryWithdrawal :: !(Maybe Double)
  -- ^ DRep Vote threshold for treasury withdrawal. New in 13.2-Conway.
  , epochParamCommitteeMinSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Minimal constitutional committee size. New in 13.2-Conway.
  , epochParamCommitteeMaxTermLength :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Constitutional committee term limits. New in 13.2-Conway.
  , epochParamGovActionLifetime :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Governance action expiration. New in 13.2-Conway.
  , epochParamGovActionDeposit :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Governance action deposit. New in 13.2-Conway.
  , epochParamDrepDeposit :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ DRep deposit amount. New in 13.2-Conway.
  , epochParamDrepActivity :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ DRep activity period. New in 13.2-Conway.
  , epochParamPvtppSecurityGroup :: !(Maybe Double)
  , epochParamMinFeeRefScriptCostPerByte :: !(Maybe Double)
  }
  deriving (Eq, Show, Generic)

type instance Key EpochParam = EpochParamId
instance DbInfo EpochParam

entityEpochParamDecoder :: D.Row (Entity EpochParam)
entityEpochParamDecoder =
  Entity
    <$> idDecoder EpochParamId
    <*> epochParamDecoder

epochParamDecoder :: D.Row EpochParam
epochParamDecoder =
  EpochParam
    <$> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamEpochNo
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamMinFeeA
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamMinFeeB
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamMaxBlockSize
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamMaxTxSize
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamMaxBhSize
    <*> dbLovelaceDecoder -- epochParamKeyDeposit
    <*> dbLovelaceDecoder -- epochParamPoolDeposit
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamMaxEpoch
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- epochParamOptimalPoolCount
    <*> D.column (D.nonNullable D.float8) -- epochParamInfluence
    <*> D.column (D.nonNullable D.float8) -- epochParamMonetaryExpandRate
    <*> D.column (D.nonNullable D.float8) -- epochParamTreasuryGrowthRate
    <*> D.column (D.nonNullable D.float8) -- epochParamDecentralisation
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int2) -- epochParamProtocolMajor
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int2) -- epochParamProtocolMinor
    <*> dbLovelaceDecoder -- epochParamMinUtxoValue
    <*> dbLovelaceDecoder -- epochParamMinPoolCost
    <*> D.column (D.nullable D.bytea) -- epochParamNonce
    <*> maybeIdDecoder CostModelId -- epochParamCostModelId
    <*> D.column (D.nullable D.float8) -- epochParamPriceMem
    <*> D.column (D.nullable D.float8) -- epochParamPriceStep
    <*> maybeDbWord64Decoder -- epochParamMaxTxExMem
    <*> maybeDbWord64Decoder -- epochParamMaxTxExSteps
    <*> maybeDbWord64Decoder -- epochParamMaxBlockExMem
    <*> maybeDbWord64Decoder -- epochParamMaxBlockExSteps
    <*> maybeDbWord64Decoder -- epochParamMaxValSize
    <*> D.column (D.nullable $ fromIntegral <$> D.int2) -- epochParamCollateralPercent
    <*> D.column (D.nullable $ fromIntegral <$> D.int2) -- epochParamMaxCollateralInputs
    <*> idDecoder BlockId -- epochParamBlockId
    <*> D.column (D.nullable D.bytea) -- epochParamExtraEntropy
    <*> maybeDbLovelaceDecoder -- epochParamCoinsPerUtxoSize
    -- <*> D.column (D.nullable $ DbLovelace . fromIntegral <$> D.int8) -- epochParamCoinsPerUtxoSize
    <*> D.column (D.nullable D.float8) -- epochParamPvtMotionNoConfidence
    <*> D.column (D.nullable D.float8) -- epochParamPvtCommitteeNormal
    <*> D.column (D.nullable D.float8) -- epochParamPvtCommitteeNoConfidence
    <*> D.column (D.nullable D.float8) -- epochParamPvtHardForkInitiation
    <*> D.column (D.nullable D.float8) -- epochParamDvtMotionNoConfidence
    <*> D.column (D.nullable D.float8) -- epochParamDvtCommitteeNormal
    <*> D.column (D.nullable D.float8) -- epochParamDvtCommitteeNoConfidence
    <*> D.column (D.nullable D.float8) -- epochParamDvtUpdateToConstitution
    <*> D.column (D.nullable D.float8) -- epochParamDvtHardForkInitiation
    <*> D.column (D.nullable D.float8) -- epochParamDvtPPNetworkGroup
    <*> D.column (D.nullable D.float8) -- epochParamDvtPPEconomicGroup
    <*> D.column (D.nullable D.float8) -- epochParamDvtPPTechnicalGroup
    <*> D.column (D.nullable D.float8) -- epochParamDvtPPGovGroup
    <*> D.column (D.nullable D.float8) -- epochParamDvtTreasuryWithdrawal
    <*> maybeDbWord64Decoder -- epochParamCommitteeMinSize
    <*> maybeDbWord64Decoder -- epochParamCommitteeMaxTermLength
    <*> maybeDbWord64Decoder -- epochParamGovActionLifetime
    <*> maybeDbWord64Decoder -- epochParamGovActionDeposit
    <*> maybeDbWord64Decoder -- epochParamDrepDeposit
    <*> maybeDbWord64Decoder -- epochParamDrepActivity
    <*> D.column (D.nullable D.float8) -- epochParamPvtppSecurityGroup
    <*> D.column (D.nullable D.float8) -- epochParamMinFeeRefScriptCostPerByte

epochParamEncoder :: E.Params EpochParam
epochParamEncoder =
  mconcat
    [ epochParamEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamMinFeeA >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamMinFeeB >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamMaxBlockSize >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamMaxTxSize >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamMaxBhSize >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamKeyDeposit >$< dbLovelaceEncoder
    , epochParamPoolDeposit >$< dbLovelaceEncoder
    , epochParamMaxEpoch >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamOptimalPoolCount >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochParamInfluence >$< E.param (E.nonNullable E.float8)
    , epochParamMonetaryExpandRate >$< E.param (E.nonNullable E.float8)
    , epochParamTreasuryGrowthRate >$< E.param (E.nonNullable E.float8)
    , epochParamDecentralisation >$< E.param (E.nonNullable E.float8)
    , epochParamProtocolMajor >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , epochParamProtocolMinor >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , epochParamMinUtxoValue >$< dbLovelaceEncoder
    , epochParamMinPoolCost >$< dbLovelaceEncoder
    , epochParamNonce >$< E.param (E.nullable E.bytea)
    , epochParamCostModelId >$< maybeIdEncoder getCostModelId
    , epochParamPriceMem >$< E.param (E.nullable E.float8)
    , epochParamPriceStep >$< E.param (E.nullable E.float8)
    , epochParamMaxTxExMem >$< maybeDbWord64Encoder
    , epochParamMaxTxExSteps >$< maybeDbWord64Encoder
    , epochParamMaxBlockExMem >$< maybeDbWord64Encoder
    , epochParamMaxBlockExSteps >$< maybeDbWord64Encoder
    , epochParamMaxValSize >$< maybeDbWord64Encoder
    , epochParamCollateralPercent >$< E.param (E.nullable $ fromIntegral >$< E.int2)
    , epochParamMaxCollateralInputs >$< E.param (E.nullable $ fromIntegral >$< E.int2)
    , epochParamBlockId >$< idEncoder getBlockId
    , epochParamExtraEntropy >$< E.param (E.nullable E.bytea)
    , epochParamCoinsPerUtxoSize >$< maybeDbLovelaceEncoder
    , epochParamPvtMotionNoConfidence >$< E.param (E.nullable E.float8)
    , epochParamPvtCommitteeNormal >$< E.param (E.nullable E.float8)
    , epochParamPvtCommitteeNoConfidence >$< E.param (E.nullable E.float8)
    , epochParamPvtHardForkInitiation >$< E.param (E.nullable E.float8)
    , epochParamDvtMotionNoConfidence >$< E.param (E.nullable E.float8)
    , epochParamDvtCommitteeNormal >$< E.param (E.nullable E.float8)
    , epochParamDvtCommitteeNoConfidence >$< E.param (E.nullable E.float8)
    , epochParamDvtUpdateToConstitution >$< E.param (E.nullable E.float8)
    , epochParamDvtHardForkInitiation >$< E.param (E.nullable E.float8)
    , epochParamDvtPPNetworkGroup >$< E.param (E.nullable E.float8)
    , epochParamDvtPPEconomicGroup >$< E.param (E.nullable E.float8)
    , epochParamDvtPPTechnicalGroup >$< E.param (E.nullable E.float8)
    , epochParamDvtPPGovGroup >$< E.param (E.nullable E.float8)
    , epochParamDvtTreasuryWithdrawal >$< E.param (E.nullable E.float8)
    , epochParamCommitteeMinSize >$< maybeDbWord64Encoder
    , epochParamCommitteeMaxTermLength >$< maybeDbWord64Encoder
    , epochParamGovActionLifetime >$< maybeDbWord64Encoder
    , epochParamGovActionDeposit >$< maybeDbWord64Encoder
    , epochParamDrepDeposit >$< maybeDbWord64Encoder
    , epochParamDrepActivity >$< maybeDbWord64Encoder
    , epochParamPvtppSecurityGroup >$< E.param (E.nullable E.float8)
    , epochParamMinFeeRefScriptCostPerByte >$< E.param (E.nullable E.float8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: epochstate
-- Description: Contains the state of the blockchain at the end of each epoch, including the committee, constitution, and no-confidence votes.
-- Schema reference for @epoch_state@:
-- Table with governance (and in the future other) stats per epoch.
data EpochState = EpochState
  { epochStateCommitteeId :: !(Maybe CommitteeId) -- noreference

  -- ^ The reference to the current committee.
  , epochStateNoConfidenceId :: !(Maybe GovActionProposalId) -- noreference

  -- ^ The reference to the current gov_action_proposal of no confidence. TODO: This remains NULL.
  , epochStateConstitutionId :: !(Maybe ConstitutionId) -- noreference

  -- ^ The reference to the current constitution. Should never be null.
  , epochStateEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch in question (unique).
  }
  deriving (Eq, Show, Generic)

type instance Key EpochState = EpochStateId

instance DbInfo EpochState where
  uniqueFields _ = ["epoch_no"]
  unnestParamTypes _ =
    [ ("committee_id", "bigint[]")
    , ("no_confidence_id", "bigint[]")
    , ("constitution_id", "bigint[]")
    , ("epoch_no", "bigint[]")
    ]

epochStateEncoder :: E.Params EpochState
epochStateEncoder =
  mconcat
    [ epochStateCommitteeId >$< maybeIdEncoder getCommitteeId
    , epochStateNoConfidenceId >$< maybeIdEncoder getGovActionProposalId
    , epochStateConstitutionId >$< maybeIdEncoder getConstitutionId
    , epochStateEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: epochsync_time
-- Description: Tracks synchronization times for epochs, ensuring nodes are in consensus regarding the current state.
-- Schema reference for @epoch_sync_time@:
-- A table containing the time required to fully sync an epoch.
data EpochSyncTime = EpochSyncTime
  { epochSyncTimeNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch number for this sync time.
  , epochSyncTimeSeconds :: !Word64 -- sqltype=word63type

  -- ^ The time (in seconds) recorded for syncing this epoch. This column is non-nullable.
  , epochSyncTimeState :: !SyncState -- sqltype=syncstatetype

  -- ^ The sync state when the sync time is recorded (either 'lagging' or 'following').
  }
  deriving (Show, Eq, Generic)

type instance Key EpochSyncTime = EpochSyncTimeId
instance DbInfo EpochSyncTime where
  uniqueFields _ = ["no"]
  enumFields _ = [("state", "syncstatetype")]

epochSyncTimeEncoder :: E.Params EpochSyncTime
epochSyncTimeEncoder =
  mconcat
    [ epochSyncTimeNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochSyncTimeSeconds >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , epochSyncTimeState >$< E.param (E.nonNullable syncStateEncoder)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: ada_pots
-- Description: A table with all the different types of total balances.
--   This is only populated for the Shelley and later eras, and only on epoch boundaries.
--   The treasury and rewards fields will be correct for the whole epoch, but all other
--   fields change block by block.
-- Schema reference for @ada_pots@:
-- A table with all the different types of total balances (Shelley only). The treasury and rewards
-- fields will be correct for the whole epoch, but all other fields change block by block.
data AdaPots = AdaPots
  { adaPotsSlotNo :: !Word64 -- sqltype=word63type

  -- ^ The slot number where this AdaPots snapshot was taken.
  , adaPotsEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch number where this AdaPots snapshot was taken.
  , adaPotsTreasury :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the treasury pot.
  , adaPotsReserves :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the reserves pot.
  , adaPotsRewards :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the rewards pot.
  , adaPotsUtxo :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the UTxO set.
  , adaPotsDepositsStake :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the obligation pot coming from stake key and pool deposits. Renamed
  -- from deposits in 13.3.
  , adaPotsFees :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the fee pot.
  , adaPotsBlockId :: !BlockId -- noreference

  -- ^ The Block table index of the block for which this snapshot was taken.
  , adaPotsDepositsDrep :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the obligation pot coming from drep registrations deposits. New in
  -- 13.3.
  , adaPotsDepositsProposal :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) in the obligation pot coming from governance proposal deposits. New in
  -- 13.3.
  }
  deriving (Show, Eq, Generic)

type instance Key AdaPots = AdaPotsId
instance DbInfo AdaPots

entityAdaPotsDecoder :: D.Row (Entity AdaPots)
entityAdaPotsDecoder =
  Entity
    <$> idDecoder AdaPotsId
    <*> adaPotsDecoder

adaPotsDecoder :: D.Row AdaPots
adaPotsDecoder =
  AdaPots
    <$> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- adaPotsSlotNo
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- adaPotsEpochNo
    <*> dbLovelaceDecoder -- adaPotsTreasury
    <*> dbLovelaceDecoder -- adaPotsReserves
    <*> dbLovelaceDecoder -- adaPotsRewards
    <*> dbLovelaceDecoder -- adaPotsUtxo
    <*> dbLovelaceDecoder -- adaPotsDepositsStake
    <*> dbLovelaceDecoder -- adaPotsFees
    <*> idDecoder BlockId -- adaPotsBlockId
    <*> dbLovelaceDecoder -- adaPotsDepositsDrep
    <*> dbLovelaceDecoder -- adaPotsDepositsProposal

adaPotsEncoder :: E.Params AdaPots
adaPotsEncoder =
  mconcat
    [ adaPotsSlotNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , adaPotsEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , adaPotsTreasury >$< dbLovelaceEncoder
    , adaPotsReserves >$< dbLovelaceEncoder
    , adaPotsRewards >$< dbLovelaceEncoder
    , adaPotsUtxo >$< dbLovelaceEncoder
    , adaPotsDepositsStake >$< dbLovelaceEncoder
    , adaPotsFees >$< dbLovelaceEncoder
    , adaPotsBlockId >$< idEncoder getBlockId
    , adaPotsDepositsDrep >$< dbLovelaceEncoder
    , adaPotsDepositsProposal >$< dbLovelaceEncoder
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: pot_transfer
-- Description: Records transfers between different pots (e.g., from the rewards pot to the treasury pot).
-- Schema reference for @pot_transfer@:
-- A table containing transfers between the reserves pot and the treasury pot.
data PotTransfer = PotTransfer
  { potTransferCertIndex :: !Word16
  -- ^ The index of this transfer certificate within the certificates of this transaction.
  , potTransferTreasury :: !DbInt65 -- sqltype=int65type

  -- ^ The amount (in Lovelace) the treasury balance changes by.
  , potTransferReserves :: !DbInt65 -- sqltype=int65type

  -- ^ The amount (in Lovelace) the reserves balance changes by.
  , potTransferTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction that contains this transfer.
  }
  deriving (Show, Eq, Generic)

instance DbInfo PotTransfer
type instance Key PotTransfer = PotTransferId

potTransferEncoder :: E.Params PotTransfer
potTransferEncoder =
  mconcat
    [ potTransferCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , potTransferTreasury >$< E.param (E.nonNullable dbInt65Encoder)
    , potTransferReserves >$< E.param (E.nonNullable dbInt65Encoder)
    , potTransferTxId >$< idEncoder getTxId
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: treasury
-- Description: Holds funds allocated to the treasury, which can be used for network upgrades or other community initiatives.
-- Schema reference for @treasury@:
-- A table for payments from the treasury to a StakeAddress. Note: Before protocol version 5.0 (Alonzo)
-- if more than one payment was made to a stake address in a single epoch, only the last payment was
-- kept and earlier ones removed. For protocol version 5.0 and later, they are summed and produce a
-- single reward with type @treasury@.
data Treasury = Treasury
  { treasuryAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address for this Treasury entry.
  , treasuryCertIndex :: !Word16
  -- ^ The index of this payment certificate within the certificates of this transaction.
  , treasuryAmount :: !DbInt65 -- sqltype=int65type

  -- ^ The payment amount (in Lovelace).
  , treasuryTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction that contains this payment.
  }
  deriving (Show, Eq, Generic)

instance DbInfo Treasury
type instance Key Treasury = TreasuryId

treasuryEncoder :: E.Params Treasury
treasuryEncoder =
  mconcat
    [ treasuryAddrId >$< idEncoder getStakeAddressId
    , treasuryCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , treasuryAmount >$< E.param (E.nonNullable dbInt65Encoder)
    , treasuryTxId >$< idEncoder getTxId
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: reserve
-- Description: Stores reserves set aside by the protocol to stabilize the cryptocurrency's value or fund future activities.
-- Schema reference for @reserve@:
-- A table for payments from the reserves to a StakeAddress. Note: Before protocol version 5.0 (Alonzo)
-- if more than one payment was made to a stake address in a single epoch, only the last payment was
-- kept and earlier ones removed. For protocol version 5.0 and later, they are summed and produce a
-- single reward with type @reserves@
data Reserve = Reserve
  { reserveAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address for this Treasury entry.
  , reserveCertIndex :: !Word16
  -- ^ The index of this payment certificate within the certificates of this transaction.
  , reserveAmount :: !DbInt65 -- sqltype=int65type

  -- ^ The payment amount (in Lovelace).
  , reserveTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction that contains this payment.
  }
  deriving (Show, Eq, Generic)

type instance Key Reserve = ReserveId
instance DbInfo Reserve

reserveEncoder :: E.Params Reserve
reserveEncoder =
  mconcat
    [ reserveAddrId >$< idEncoder getStakeAddressId
    , reserveCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , reserveAmount >$< E.param (E.nonNullable dbInt65Encoder)
    , reserveTxId >$< idEncoder getTxId
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: cost_model
-- Description: Defines the cost model used for estimating transaction fees, ensuring efficient resource allocation on the network.
-- Schema reference for @cost_model@:
-- CostModel for EpochParam and ParamProposal.
data CostModel = CostModel
  { costModelCosts :: !Text -- sqltype=jsonb

  -- ^ The actual costs formatted as json.
  , costModelHash :: !ByteString -- sqltype=hash32type

  -- ^ The hash of cost model. It ensures uniqueness of entries. New in v13.
  }
  deriving (Eq, Show, Generic)

type instance Key CostModel = CostModelId
instance DbInfo CostModel where
  uniqueFields _ = ["hash"]
  jsonbFields _ = ["costs"]

costModelEncoder :: E.Params CostModel
costModelEncoder =
  mconcat
    [ costModelCosts >$< E.param (E.nonNullable E.text)
    , costModelHash >$< E.param (E.nonNullable E.bytea)
    ]
