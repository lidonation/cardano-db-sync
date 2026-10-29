{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}

module Cardano.Db.Schema.Core.StakeDelegation where

import Contravariant.Extras (contrazip4, contrazip5)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant
import Data.Text (Text)
import Data.Word (Word16, Word64)
import GHC.Generics (Generic)
import Hasql.Decoders as D
import Hasql.Encoders as E

import Cardano.Db.Schema.Ids
import Cardano.Db.Schema.Types (textDecoder)
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Cardano.Db.Types (
  DbLovelace (..),
  RewardSource,
  maybeDbLovelaceEncoder,
  rewardSourceEncoder,
 )

-----------------------------------------------------------------------------------------------------------------------------------

-- STAKE DELEGATION
-- These tables handle stake addresses, delegation, and reward

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @stake_address@:
-- A table of unique stake addresses. Can be an actual address or a script hash. The existance of an
-- entry doesn't mean the address is registered or in fact that is was ever registered.
data StakeAddress = StakeAddress -- Can be an address of a script hash
  { stakeAddressHashRaw :: !ByteString -- sqltype=addr29type

  -- ^ The raw bytes of the stake address hash.
  , stakeAddressView :: !Text
  -- ^ The Bech32 encoded version of the stake address.
  , stakeAddressScriptHash :: !(Maybe ByteString) -- sqltype=hash28type

  -- ^ The script hash, in case this address is locked by a script.
  }
  deriving (Show, Eq, Generic)

type instance Key StakeAddress = StakeAddressId
instance DbInfo StakeAddress where
  uniqueFields _ = ["hash_raw"]

entityStakeAddressDecoder :: D.Row (Entity StakeAddress)
entityStakeAddressDecoder =
  Entity
    <$> idDecoder StakeAddressId
    <*> stakeAddressDecoder

stakeAddressDecoder :: D.Row StakeAddress
stakeAddressDecoder =
  StakeAddress
    <$> D.column (D.nonNullable D.bytea) -- stakeAddressHashRaw
    <*> D.column (D.nonNullable textDecoder) -- stakeAddressView
    <*> D.column (D.nullable D.bytea) -- stakeAddressScriptHash

stakeAddressEncoder :: E.Params StakeAddress
stakeAddressEncoder =
  mconcat
    [ stakeAddressHashRaw >$< E.param (E.nonNullable E.bytea)
    , stakeAddressView >$< E.param (E.nonNullable E.text)
    , stakeAddressScriptHash >$< E.param (E.nullable E.bytea)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @stake_registration@:
-- A table containing stake address registrations.
data StakeRegistration = StakeRegistration
  { stakeRegistrationAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address.
  , stakeRegistrationCertIndex :: !Word16
  -- ^ The index of this stake registration within the certificates of this transaction.
  , stakeRegistrationEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch in which the registration took place.
  , stakeRegistrationTxId :: !TxId -- noreference

  -- ^ The Tx table index of the transaction where this stake address was registered.
  , stakeRegistrationDeposit :: !(Maybe DbLovelace) -- sqltype=lovelace
  }
  deriving (Eq, Show, Generic)

type instance Key StakeRegistration = StakeRegistrationId
instance DbInfo StakeRegistration

stakeRegistrationEncoder :: E.Params StakeRegistration
stakeRegistrationEncoder =
  mconcat
    [ stakeRegistrationAddrId >$< idEncoder getStakeAddressId
    , stakeRegistrationCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , stakeRegistrationEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , stakeRegistrationTxId >$< idEncoder getTxId
    , stakeRegistrationDeposit >$< maybeDbLovelaceEncoder
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @stake_deregistration@:
-- A table containing stake address deregistrations.
data StakeDeregistration = StakeDeregistration
  { stakeDeregistrationAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address.
  , stakeDeregistrationCertIndex :: !Word16
  -- ^ The index of this stake deregistration within the certificates of this transaction.
  , stakeDeregistrationEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch in which the deregistration took place.
  , stakeDeregistrationTxId :: !TxId -- noreference

  -- ^ The Tx table index of the transaction where this stake address was deregistered.
  , stakeDeregistrationRedeemerId :: !(Maybe RedeemerId) -- noreference

  -- ^ The Redeemer table index that is related with this certificate.
  }
  deriving (Eq, Show, Generic)

type instance Key StakeDeregistration = StakeDeregistrationId
instance DbInfo StakeDeregistration

stakeDeregistrationDecoder :: D.Row StakeDeregistration
stakeDeregistrationDecoder =
  StakeDeregistration
    <$> idDecoder StakeAddressId -- stakeDeregistrationAddrId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int2) -- stakeDeregistrationCertIndex
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- stakeDeregistrationEpochNo
    <*> idDecoder TxId -- stakeDeregistrationTxId
    <*> maybeIdDecoder RedeemerId -- stakeDeregistrationRedeemerId

stakeDeregistrationEncoder :: E.Params StakeDeregistration
stakeDeregistrationEncoder =
  mconcat
    [ stakeDeregistrationAddrId >$< idEncoder getStakeAddressId
    , stakeDeregistrationCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , stakeDeregistrationEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , stakeDeregistrationTxId >$< idEncoder getTxId
    , stakeDeregistrationRedeemerId >$< maybeIdEncoder getRedeemerId
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @delegation@:
-- A table containing delegations from a stake address to a stake pool.
data Delegation = Delegation
  { delegationAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address.
  , delegationCertIndex :: !Word16
  -- ^ The index of this delegation within the certificates of this transaction.
  , delegationPoolHashId :: !PoolHashId -- noreference

  -- ^ The PoolHash table index for the pool being delegated to.
  , delegationActiveEpochNo :: !Word64
  -- ^ The epoch number where this delegation becomes active.
  , delegationTxId :: !TxId -- noreference

  -- ^ The Tx table index of the transaction that contained this delegation.
  , delegationSlotNo :: !Word64 -- sqltype=word63type

  -- ^ The slot number of the block that contained this delegation.
  , delegationRedeemerId :: !(Maybe RedeemerId) -- noreference

  -- ^ The Redeemer table index that is related with this certificate.
  }
  deriving (Eq, Show, Generic)

type instance Key Delegation = DelegationId
instance DbInfo Delegation

entityDelegationDecoder :: D.Row (Entity Delegation)
entityDelegationDecoder =
  Entity
    <$> idDecoder DelegationId
    <*> delegationDecoder

delegationDecoder :: D.Row Delegation
delegationDecoder =
  Delegation
    <$> idDecoder StakeAddressId -- delegationAddrId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int2) -- delegationCertIndex
    <*> idDecoder PoolHashId -- delegationPoolHashId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- delegationActiveEpochNo
    <*> idDecoder TxId -- delegationTxId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- delegationSlotNo
    <*> maybeIdDecoder RedeemerId -- delegationRedeemerId

delegationEncoder :: E.Params Delegation
delegationEncoder =
  mconcat
    [ delegationAddrId >$< idEncoder getStakeAddressId
    , delegationCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , delegationPoolHashId >$< idEncoder getPoolHashId
    , delegationActiveEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , delegationTxId >$< idEncoder getTxId
    , delegationSlotNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , delegationRedeemerId >$< maybeIdEncoder getRedeemerId
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @reward@:
-- A table for earned staking rewards. After 13.2 release it includes only 3 types of rewards: member,
-- leader and refund, since the other 2 types have moved to a separate table reward_rest. The
-- rewards are inserted incrementally and this procedure is finalised when the spendable epoch comes.
-- Before the epoch comes, some entries may be missing.
data Reward = Reward
  { rewardAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address that earned the reward.
  , rewardType :: !RewardSource -- sqltype=rewardtype

  -- ^ The type of the rewards
  , rewardAmount :: !DbLovelace -- sqltype=lovelace

  -- ^ The reward amount (in Lovelace).
  , rewardSpendableEpoch :: !Word64
  -- ^ The epoch in which the reward is actually distributed and can be spent.
  , rewardPoolId :: !PoolHashId -- noreference

  -- ^ The PoolHash table index for the pool the stake address was delegated to when the reward is
  -- earned or for the pool that there is a deposit refund.
  , rewardEarnedEpoch :: !Word64 -- generated="((CASE WHEN (type='refund') then spendable_epoch else (CASE WHEN spendable_epoch >= 2 then spendable_epoch-2 else 0 end) end) STORED)"

  -- ^ The epoch in which the reward was earned. For @member@ and @leader@ rewards spendable in epoch
  -- @N@, this will be @N - 2@, @refund@ N.
  }
  deriving (Show, Eq, Generic)

type instance Key Reward = RewardId

instance DbInfo Reward where
  enumFields _ = [("type", "rewardtype"), ("amount", "lovelace")]
  generatedFields _ = ["earned_epoch"]
  unnestParamTypes _ = [("addr_id", "bigint[]"), ("type", "text[]"), ("amount", "bigint[]"), ("spendable_epoch", "bigint[]"), ("pool_id", "bigint[]")]

rewardBulkEncoder :: E.Params ([StakeAddressId], [RewardSource], [DbLovelace], [Word64], [PoolHashId])
rewardBulkEncoder =
  contrazip5
    (bulkEncoder $ idBulkEncoder getStakeAddressId)
    (bulkEncoder $ E.nonNullable rewardSourceEncoder)
    (bulkEncoder $ E.nonNullable $ fromIntegral . unDbLovelace >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)
    (bulkEncoder $ idBulkEncoder getPoolHashId)

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @reward_rest@:
-- A table for rewards which are not correlated to a pool. It includes 3 types of rewards: reserves,
-- treasury and proposal_refund. Instant rewards are depredated after Conway.  New in 13.2
data RewardRest = RewardRest
  { rewardRestAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address that earned the reward.
  , rewardRestType :: !RewardSource -- sqltype=rewardtype

  -- ^ The type of the rewards.
  , rewardRestAmount :: !DbLovelace -- sqltype=lovelace

  -- ^ The reward amount (in Lovelace).
  , rewardRestSpendableEpoch :: !Word64
  -- ^ The epoch in which the reward is actually distributed and can be spent.
  , rewardRestEarnedEpoch :: !Word64 -- generated="(CASE WHEN spendable_epoch >= 1 then spendable_epoch-1 else 0 end)"

  -- ^ The epoch in which the reward was earned. For rewards spendable in epoch @N@, this will be @N -
  -- 1@.
  }
  deriving (Show, Eq, Generic)

type instance Key RewardRest = RewardRestId

instance DbInfo RewardRest where
  enumFields _ = [("type", "rewardtype"), ("amount", "lovelace")]
  generatedFields _ = ["earned_epoch"]
  unnestParamTypes _ =
    [ ("addr_id", "bigint[]")
    , ("type", "text[]")
    , ("amount", "bigint[]")
    , ("spendable_epoch", "bigint[]")
    ]

rewardRestBulkEncoder :: E.Params ([StakeAddressId], [RewardSource], [DbLovelace], [Word64])
rewardRestBulkEncoder =
  contrazip4
    (bulkEncoder $ idBulkEncoder getStakeAddressId)
    (bulkEncoder $ E.nonNullable rewardSourceEncoder)
    (bulkEncoder $ E.nonNullable $ fromIntegral . unDbLovelace >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @epoch_stake@:
-- The epoch stake distribution, read from the ledger's @mark@ snapshot and tagged for the current
-- epoch plus one. Normal syncing inserts slices during the preceding epoch after the security
-- parameter's block delay; migration can catch up earlier slices. See Shelley specs Sec. 11.2.
data EpochStake = EpochStake
  { epochStakeAddrId :: !StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address for this EpochStake entry.
  , epochStakePoolId :: !PoolHashId -- noreference

  -- ^ The PoolHash table index for the pool this entry is delegated to.
  , epochStakeAmount :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) being staked.
  , epochStakeEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch number.
  }
  deriving (Show, Eq, Generic)

-- similar scenario as in Reward the constraint that was here is now set manually in
-- `applyAndInsertBlockMaybe` at a more optimal time.

type instance Key EpochStake = EpochStakeId

instance DbInfo EpochStake where
  uniqueFields _ = ["addr_id", "pool_id", "epoch_no"]
  unnestParamTypes _ =
    [ ("addr_id", "bigint[]")
    , ("pool_id", "bigint[]")
    , ("amount", "bigint[]")
    , ("epoch_no", "bigint[]")
    ]

epochStakeBulkEncoder :: E.Params ([StakeAddressId], [PoolHashId], [DbLovelace], [Word64])
epochStakeBulkEncoder =
  contrazip4
    (bulkEncoder $ idBulkEncoder getStakeAddressId)
    (bulkEncoder $ idBulkEncoder getPoolHashId)
    (bulkEncoder $ E.nonNullable $ fromIntegral . unDbLovelace >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @epoch_stake_progress@:
-- A table which shows when the epoch_stake for an epoch is complete
data EpochStakeProgress = EpochStakeProgress
  { epochStakeProgressEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The related epoch
  , epochStakeProgressCompleted :: !Bool
  -- ^ True if completed. If not completed the entry won't exist or more rarely be False.
  }
  deriving (Show, Eq, Generic)

type instance Key EpochStakeProgress = EpochStakeProgressId

instance DbInfo EpochStakeProgress where
  uniqueFields _ = ["epoch_no"]
  unnestParamTypes _ =
    [ ("epoch_no", "bigint[]")
    , ("completed", "boolean[]")
    ]
