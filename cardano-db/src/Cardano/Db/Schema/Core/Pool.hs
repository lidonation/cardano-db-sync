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

module Cardano.Db.Schema.Core.Pool where

import Contravariant.Extras (contrazip6)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant ((>$<))
import Data.Text (Text)
import Data.Word (Word16, Word64)
import GHC.Generics (Generic)
import Hasql.Decoders as D
import Hasql.Encoders as E

import qualified Cardano.Db.Schema.Ids as Id
import Cardano.Db.Schema.Types (
  PoolUrl (..),
  unPoolUrl,
 )
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Cardano.Db.Types (
  DbLovelace (..),
  DbWord64 (..),
  dbLovelaceEncoder,
  dbWord64ValueEncoder,
 )

-----------------------------------------------------------------------------------------------------------------------------------
-- POOLS
-- These tables manage stake pool-related data, including pool registration, updates, and retirements.
-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: pool_hash
-- Description: A table containing information about pool hashes.
-- Schema reference for @pool_hash@:
-- A table for every unique pool key hash. The existance of an entry doesn't mean the pool is
-- registered or in fact that is was ever registered.
data PoolHash = PoolHash
  { poolHashHashRaw :: !ByteString -- unique hashRaw sqltype=hash28type

  -- ^ The raw bytes of the pool hash.
  , poolHashView :: !Text
  -- ^ The Bech32 encoding of the pool hash.
  }
  deriving (Eq, Show, Generic)

type instance Key PoolHash = Id.PoolHashId
instance DbInfo PoolHash where
  uniqueFields _ = ["hash_raw"]

poolHashEncoder :: E.Params PoolHash
poolHashEncoder =
  mconcat
    [ poolHashHashRaw >$< E.param (E.nonNullable E.bytea) -- poolHashHashRaw
    , poolHashView >$< E.param (E.nonNullable E.text) -- poolHashView
    ]

-- |
-- Table Name: pool_stat
-- Description: A table containing information about pool metadata.
-- Schema reference for @pool_stat@:
-- Stats per pool and per epoch.
data PoolStat = PoolStat
  { poolStatPoolHashId :: !Id.PoolHashId -- noreference

  -- ^ The pool_hash_id reference.
  , poolStatEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch number.
  , poolStatNumberOfBlocks :: !DbWord64 -- sqltype=word64type

  -- ^ Number of blocks created on the previous epoch.
  , poolStatNumberOfDelegators :: !DbWord64 -- sqltype=word64type

  -- ^ Number of delegators in the mark snapshot.
  , poolStatStake :: !DbWord64 -- sqltype=word64type

  -- ^ Total stake in the mark snapshot.
  , poolStatVotingPower :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Voting power of the SPO.
  }
  deriving (Eq, Show, Generic)

type instance Key PoolStat = Id.PoolStatId

instance DbInfo PoolStat where
  unnestParamTypes _ =
    [ ("pool_hash_id", "bigint[]")
    , ("epoch_no", "integer[]")
    , ("number_of_blocks", "numeric[]")
    , ("number_of_delegators", "numeric[]")
    , ("stake", "numeric[]")
    , ("voting_power", "numeric[]")
    ]

poolStatBulkEncoder :: E.Params ([Id.PoolHashId], [Word64], [DbWord64], [DbWord64], [DbWord64], [Maybe DbWord64])
poolStatBulkEncoder =
  contrazip6
    (bulkEncoder $ E.nonNullable $ Id.getPoolHashId >$< E.int8) -- poolHashId
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int4) -- epoch_no
    (bulkEncoder $ E.nonNullable dbWord64ValueEncoder) -- number_of_blocks
    (bulkEncoder $ E.nonNullable dbWord64ValueEncoder) -- number_of_delegators
    (bulkEncoder $ E.nonNullable dbWord64ValueEncoder) -- stake
    (bulkEncoder $ E.nullable dbWord64ValueEncoder) -- voting_power

-- |
-- Table Name: pool_update
-- Description: A table containing information about pool updates.
-- Schema reference for @pool_update@:
-- An on-chain pool update.
data PoolUpdate = PoolUpdate
  { poolUpdateHashId :: !Id.PoolHashId -- noreference

  -- ^ The PoolHash table index of the pool this update refers to.
  , poolUpdateCertIndex :: !Word16
  -- ^ The index of this pool update within the certificates of this transaction.
  , poolUpdateVrfKeyHash :: !ByteString -- sqltype=hash32type

  -- ^ The hash of the pool's VRF key.
  , poolUpdatePledge :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount (in Lovelace) the pool owner pledges to the pool.
  , poolUpdateActiveEpochNo :: !Word64
  -- ^ The epoch number where this update becomes active.
  , poolUpdateMetaId :: !(Maybe Id.PoolMetadataRefId) -- noreference

  -- ^ The PoolMetadataRef table index this pool update refers to.
  , poolUpdateMargin :: !Double -- sqltype=percentage????

  -- ^ The margin (as a percentage) this pool charges.
  , poolUpdateFixedCost :: !DbLovelace -- sqltype=lovelace

  -- ^ The fixed per epoch fee (in Lovelace) this pool charges.
  , poolUpdateRegisteredTxId :: !Id.TxId -- noreference -- Slot number in which the pool was registered.

  -- ^ The Tx table index of the transaction in which provided this pool update.
  , poolUpdateRewardAddrId :: !Id.StakeAddressId -- noreference

  -- ^ The StakeAddress table index of this pool's rewards address. New in v13: Replaced reward_addr.
  , poolUpdateDeposit :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ The deposit payed for this pool update. Null for reregistrations.
  }
  deriving (Eq, Show, Generic)

type instance Key PoolUpdate = Id.PoolUpdateId
instance DbInfo PoolUpdate

poolUpdateEncoder :: E.Params PoolUpdate
poolUpdateEncoder =
  mconcat
    [ poolUpdateHashId >$< Id.idEncoder Id.getPoolHashId
    , poolUpdateCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , poolUpdateVrfKeyHash >$< E.param (E.nonNullable E.bytea)
    , poolUpdatePledge >$< dbLovelaceEncoder
    , poolUpdateActiveEpochNo >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , poolUpdateMetaId >$< Id.maybeIdEncoder Id.getPoolMetadataRefId
    , poolUpdateMargin >$< E.param (E.nonNullable E.float8)
    , poolUpdateFixedCost >$< dbLovelaceEncoder
    , poolUpdateRegisteredTxId >$< Id.idEncoder Id.getTxId
    , poolUpdateRewardAddrId >$< Id.idEncoder Id.getStakeAddressId
    , poolUpdateDeposit >$< E.param (E.nullable $ fromIntegral . unDbLovelace >$< E.int8)
    ]

-- |
-- Table Name: pool_metadata_ref
-- Description: A table containing references to pool metadata.
-- Schema reference for @pool_metadata_ref@:
-- An on-chain reference to off-chain pool metadata.
data PoolMetadataRef = PoolMetadataRef
  { poolMetadataRefPoolId :: !Id.PoolHashId -- noreference

  -- ^ The PoolHash table index of the pool for this reference.
  , poolMetadataRefUrl :: !PoolUrl -- sqltype=varchar

  -- ^ The URL for the location of the off-chain data.
  , poolMetadataRefHash :: !ByteString -- sqltype=hash32type

  -- ^ The expected hash for the off-chain data.
  , poolMetadataRefRegisteredTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the transaction in which provided this metadata reference.
  }
  deriving (Eq, Show, Generic)

type instance Key PoolMetadataRef = Id.PoolMetadataRefId
instance DbInfo PoolMetadataRef

poolMetadataRefEncoder :: E.Params PoolMetadataRef
poolMetadataRefEncoder =
  mconcat
    [ poolMetadataRefPoolId >$< Id.idEncoder Id.getPoolHashId
    , poolMetadataRefUrl >$< E.param (E.nonNullable (unPoolUrl >$< E.text))
    , poolMetadataRefHash >$< E.param (E.nonNullable E.bytea)
    , poolMetadataRefRegisteredTxId >$< Id.idEncoder Id.getTxId
    ]

-- |
-- Table Name: pool_owner
-- Description: A table containing information about pool owners.
-- Schema reference for @pool_owner@:
-- A table containing pool owners.
data PoolOwner = PoolOwner
  { poolOwnerAddrId :: !Id.StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the pool owner's stake address.
  , poolOwnerPoolUpdateId :: !Id.PoolUpdateId -- noreference

  -- ^ The PoolUpdate table index for the pool. New in v13.
  }
  deriving (Eq, Show, Generic)

type instance Key PoolOwner = Id.PoolOwnerId
instance DbInfo PoolOwner

poolOwnerEncoder :: E.Params PoolOwner
poolOwnerEncoder =
  mconcat
    [ poolOwnerAddrId >$< Id.idEncoder Id.getStakeAddressId
    , poolOwnerPoolUpdateId >$< Id.idEncoder Id.getPoolUpdateId
    ]

-- |
-- Table Name: pool_retire
-- Description: A table containing information about pool retirements.
-- Schema reference for @pool_retire@:
-- A table containing information about pools retiring.
data PoolRetire = PoolRetire
  { poolRetireHashId :: !Id.PoolHashId -- noreference

  -- ^ The PoolHash table index of the pool this retirement refers to.
  , poolRetireCertIndex :: !Word16
  -- ^ The index of this pool retirement within the certificates of this transaction.
  , poolRetireAnnouncedTxId :: !Id.TxId -- noreference -- Slot number in which the pool announced it was retiring.

  -- ^ The Tx table index of the transaction where this pool retirement was announced.
  , poolRetireRetiringEpoch :: !Word64 -- sqltype=word31type -- Epoch number in which the pool will retire.

  -- ^ The epoch where this pool retires.
  }
  deriving (Eq, Show, Generic)

type instance Key PoolRetire = Id.PoolRetireId
instance DbInfo PoolRetire

poolRetireEncoder :: E.Params PoolRetire
poolRetireEncoder =
  mconcat
    [ poolRetireHashId >$< Id.idEncoder Id.getPoolHashId
    , poolRetireCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , poolRetireAnnouncedTxId >$< Id.idEncoder Id.getTxId
    , poolRetireRetiringEpoch >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-- |
-- Table Name: pool_relay
-- Description: A table containing information about pool relays.
-- Schema reference for @pool_relay@:
data PoolRelay = PoolRelay
  { poolRelayUpdateId :: !Id.PoolUpdateId -- noreference

  -- ^ The PoolUpdate table index this PoolRelay entry refers to.
  , poolRelayIpv4 :: !(Maybe Text)
  -- ^ The IPv4 address of the relay (NULLable).
  , poolRelayIpv6 :: !(Maybe Text)
  -- ^ The IPv6 address of the relay (NULLable).
  , poolRelayDnsName :: !(Maybe Text)
  -- ^ The DNS name of the relay (NULLable).
  , poolRelayDnsSrvName :: !(Maybe Text)
  -- ^ The DNS service name of the relay (NULLable).
  , poolRelayPort :: !(Maybe Word16)
  -- ^ The port number of relay (NULLable).
  }
  deriving (Eq, Show, Generic)

type instance Key PoolRelay = Id.PoolRelayId
instance DbInfo PoolRelay

poolRelayEncoder :: E.Params PoolRelay
poolRelayEncoder =
  mconcat
    [ poolRelayUpdateId >$< Id.idEncoder Id.getPoolUpdateId
    , poolRelayIpv4 >$< E.param (E.nullable E.text)
    , poolRelayIpv6 >$< E.param (E.nullable E.text)
    , poolRelayDnsName >$< E.param (E.nullable E.text)
    , poolRelayDnsSrvName >$< E.param (E.nullable E.text)
    , -- NB: the SQL column is int4 and the field is an unsigned Word16, so it must
      -- be encoded as int4. Using int2 (signed 16-bit) wraps ports > 32767 to
      -- negative values (port - 65536). See issue #2135.
      poolRelayPort >$< E.param (E.nullable $ fromIntegral >$< E.int4)
    ]

-- |
-- Table Name: delisted_pool
-- Description: A table containing a managed list of delisted pools.
-- Schema reference for @delisted_pool@:
-- A table containing pools that have been delisted.
newtype DelistedPool = DelistedPool
  { delistedPoolHashRaw :: ByteString -- sqltype=hash28type

  -- ^ The pool hash
  }
  deriving (Eq, Show, Generic)

type instance Key DelistedPool = Id.DelistedPoolId
instance DbInfo DelistedPool where
  uniqueFields _ = ["hash_raw"]

delistedPoolDecoder :: D.Row DelistedPool
delistedPoolDecoder =
  DelistedPool
    <$> D.column (D.nonNullable D.bytea) -- delistedPoolHashRaw

delistedPoolEncoder :: E.Params DelistedPool
delistedPoolEncoder = delistedPoolHashRaw >$< E.param (E.nonNullable E.bytea)

-- |
-- Table Name: resser_pool_ticker
-- Description: A table containing a managed list of reserved ticker names.
-- For now they are grouped under the specific hash of the pool.
-- Schema reference for @reserved_pool_ticker@:
-- A table containing a managed list of reserved ticker names.
data ReservedPoolTicker = ReservedPoolTicker
  { reservedPoolTickerName :: !Text
  -- ^ The ticker name.
  , reservedPoolTickerPoolHash :: !ByteString -- sqltype=hash28type

  -- ^ The hash of the pool that owns this ticker.
  }
  deriving (Eq, Show, Generic)

type instance Key ReservedPoolTicker = Id.ReservedPoolTickerId
instance DbInfo ReservedPoolTicker where
  uniqueFields _ = ["name"]

entityReservedPoolTickerDecoder :: D.Row (Entity ReservedPoolTicker)
entityReservedPoolTickerDecoder =
  Entity
    <$> Id.idDecoder Id.ReservedPoolTickerId
    <*> reservedPoolTickerDecoder

reservedPoolTickerDecoder :: D.Row ReservedPoolTicker
reservedPoolTickerDecoder =
  ReservedPoolTicker
    <$> D.column (D.nonNullable D.text) -- reservedPoolTickerName
    <*> D.column (D.nonNullable D.bytea) -- reservedPoolTickerPoolHash

reservedPoolTickerEncoder :: E.Params ReservedPoolTicker
reservedPoolTickerEncoder =
  mconcat
    [ reservedPoolTickerName >$< E.param (E.nonNullable E.text)
    , reservedPoolTickerPoolHash >$< E.param (E.nonNullable E.bytea)
    ]
