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

module Cardano.Db.Schema.Core.OffChain where

import Contravariant.Extras (contrazip3, contrazip4, contrazip5, contrazip6, contrazip8)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant
import Data.Text (Text)
import Data.Time.Clock (UTCTime)
import GHC.Generics (Generic)
import Hasql.Encoders as E

import qualified Cardano.Db.Schema.Ids as Id
import Cardano.Db.Schema.Types (utcTimeAsTimestampEncoder)
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)

-----------------------------------------------------------------------------------------------------------------------------------
-- OFFCHAIN
-- These tables manage off-chain data, including pool and vote data.
----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: off_chain_pool_data
-- Description:
-- Schema reference for @off_chain_pool_data@:
-- The pool offchain (ie not on chain) for a stake pool.
data OffChainPoolData = OffChainPoolData
  { offChainPoolDataPoolId :: !Id.PoolHashId -- noreference

  -- ^ The PoolHash table index for the pool this offchain data refers.
  , offChainPoolDataTickerName :: !Text
  -- ^ The pool's ticker name (as many as 5 characters).
  , offChainPoolDataHash :: !ByteString -- sqltype=hash32type

  -- ^ The hash of the offchain data.
  , offChainPoolDataJson :: !Text -- sqltype=jsonb

  -- ^ The payload as JSON.
  , offChainPoolDataBytes :: !ByteString -- sqltype=bytea

  -- ^ The raw bytes of the payload.
  , offChainPoolDataPmrId :: !Id.PoolMetadataRefId -- noreference

  -- ^ The PoolMetadataRef table index for this offchain data.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainPoolData = Id.OffChainPoolDataId

instance DbInfo OffChainPoolData where
  uniqueFields _ = ["pool_id", "pmr_id"]
  jsonbFields _ = ["json"]

offChainPoolDataEncoder :: E.Params OffChainPoolData
offChainPoolDataEncoder =
  mconcat
    [ offChainPoolDataPoolId >$< Id.idEncoder Id.getPoolHashId
    , offChainPoolDataTickerName >$< E.param (E.nonNullable E.text)
    , offChainPoolDataHash >$< E.param (E.nonNullable E.bytea)
    , offChainPoolDataJson >$< E.param (E.nonNullable E.text)
    , offChainPoolDataBytes >$< E.param (E.nonNullable E.bytea)
    , offChainPoolDataPmrId >$< Id.idEncoder Id.getPoolMetadataRefId
    ]

-- |
-- Table Name: off_chain_pool_fetch_error
-- Description:
-- The pool metadata fetch error. We duplicate the poolId for easy access.
-- TODO(KS): Debatable whether we need to persist this between migrations!
-- Schema reference for @off_chain_pool_fetch_error@:
-- A table containing pool offchain data fetch errors.
data OffChainPoolFetchError = OffChainPoolFetchError
  { offChainPoolFetchErrorPoolId :: !Id.PoolHashId -- noreference

  -- ^ The PoolHash table index for the pool this offchain fetch error refers.
  , offChainPoolFetchErrorFetchTime :: !UTCTime -- sqltype=timestamp

  -- ^ The UTC time stamp of the error.
  , offChainPoolFetchErrorPmrId :: !Id.PoolMetadataRefId -- noreference

  -- ^ The PoolMetadataRef table index for this offchain data.
  , offChainPoolFetchErrorFetchError :: !Text
  -- ^ The text of the error.
  , offChainPoolFetchErrorRetryCount :: !Word -- sqltype=word31type

  -- ^ The number of retries.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainPoolFetchError = Id.OffChainPoolFetchErrorId
instance DbInfo OffChainPoolFetchError where
  uniqueFields _ = ["pool_id", "fetch_time", "retry_count"]

offChainPoolFetchErrorEncoder :: E.Params OffChainPoolFetchError
offChainPoolFetchErrorEncoder =
  mconcat
    [ offChainPoolFetchErrorPoolId >$< Id.idEncoder Id.getPoolHashId
    , offChainPoolFetchErrorFetchTime >$< E.param (E.nonNullable utcTimeAsTimestampEncoder)
    , offChainPoolFetchErrorPmrId >$< Id.idEncoder Id.getPoolMetadataRefId
    , offChainPoolFetchErrorFetchError >$< E.param (E.nonNullable E.text)
    , offChainPoolFetchErrorRetryCount >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-- |
-- Table Name: off_chain_vote_data
-- Description: Stores off-chain voting anchor data with validation status
--
-- The is_valid column indicates the parsing status:
--   • TRUE: Content is valid JSON AND conforms to CIP schema
--           All related tables are populated
--   • FALSE: Content is valid JSON BUT does not conform to CIP schema
--           The json column contains the actual JSON, but related tables are empty
--   • NULL: Content is not valid JSON at all
--           The json column contains an error message, bytes column has raw data
-- Schema reference for @off_chain_vote_data@:
-- Stores off-chain voting anchor data with validation status. The table accepts metadata in a more
-- lenient way than what's described in CIP-100. Only data with hash matches are stored here; hash
-- mismatches are stored in off_chain_vote_fetch_error for retry. The is_valid column indicates the
-- parsing status: • TRUE: Content is valid JSON AND conforms to CIP-100 schema. All related fields
-- (language, comment) and related tables (off_chain_vote_gov_action_data, off_chain_vote_drep_data,
-- off_chain_vote_author, off_chain_vote_reference, off_chain_vote_external_update) are populated. •
-- FALSE: Hash matches and content is valid JSON BUT does not conform to CIP-100 schema. The json
-- column contains the actual JSON, but language/comment fields and related tables remain empty. •
-- NULL: Hash matches but content is not valid JSON at all. The json column contains an error message,
-- bytes column has raw data. Language/comment fields and related tables remain empty. New in
-- 13.2-Conway.
data OffChainVoteData = OffChainVoteData
  { offChainVoteDataVotingAnchorId :: !Id.VotingAnchorId -- noreference

  -- ^ The VotingAnchor table index this offchain data refers.
  , offChainVoteDataHash :: !ByteString
  -- ^ The hash of the offchain data.
  , offChainVoteDataJson :: !Text -- sqltype=jsonb

  -- ^ The payload as JSON.
  , offChainVoteDataBytes :: !ByteString -- sqltype=bytea

  -- ^ The raw bytes of the payload.
  , offChainVoteDataWarning :: !(Maybe Text)
  -- ^ A warning that occured while validating the metadata.
  , offChainVoteDataLanguage :: !Text
  -- ^ The langauge described in the context of the metadata. Described in CIP-100. New in 13.3-Conway.
  , offChainVoteDataComment :: !(Maybe Text)
  , offChainVoteDataIsValid :: !(Maybe Bool)
  -- ^ Indicates validation status: TRUE for valid JSON conforming to CIP-100 schema, FALSE for valid
  -- JSON not conforming to CIP-100 schema, NULL for content that is not valid JSON at all.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteData = Id.OffChainVoteDataId

instance DbInfo OffChainVoteData where
  uniqueFields _ = ["hash", "voting_anchor_id"]
  jsonbFields _ = ["json"]
  unnestParamTypes _ =
    [ ("voting_anchor_id", "bigint[]")
    , ("hash", "bytea[]")
    , ("json", "text[]")
    , ("bytes", "bytea[]")
    , ("warning", "text[]")
    , ("language", "text[]")
    , ("comment", "text[]")
    , ("is_valid", "boolean[]")
    ]

offChainVoteDataBulkEncoder :: E.Params ([Id.VotingAnchorId], [ByteString], [Text], [ByteString], [Maybe Text], [Text], [Maybe Text], [Maybe Bool])
offChainVoteDataBulkEncoder =
  contrazip8
    (bulkEncoder (Id.idBulkEncoder Id.getVotingAnchorId))
    (bulkEncoder (E.nonNullable E.bytea))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nonNullable E.bytea))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nullable E.bool))

-- |
-- Table Name: off_chain_vote_gov_action_data
-- Description:
-- Schema reference for @off_chain_vote_gov_action_data@:
-- The table with offchain metadata for Governance Actions. Implementes CIP-108. New in 13.3-Conway.
data OffChainVoteGovActionData = OffChainVoteGovActionData
  { offChainVoteGovActionDataOffChainVoteDataId :: !Id.OffChainVoteDataId -- noreference

  -- ^ The vote metadata table index this offchain data belongs to.
  , offChainVoteGovActionDataTitle :: !Text
  -- ^ The title
  , offChainVoteGovActionDataAbstract :: !Text
  -- ^ The abstract
  , offChainVoteGovActionDataMotivation :: !Text
  -- ^ The motivation
  , offChainVoteGovActionDataRationale :: !Text
  -- ^ The rationale
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteGovActionData = Id.OffChainVoteGovActionDataId

instance DbInfo OffChainVoteGovActionData where
  unnestParamTypes _ =
    [ ("off_chain_vote_data_id", "bigint[]")
    , ("title", "text[]")
    , ("abstract", "text[]")
    , ("motivation", "text[]")
    , ("rationale", "text[]")
    ]

entityOffChainVoteGovActionDataEncoder :: E.Params (Entity OffChainVoteGovActionData)
entityOffChainVoteGovActionDataEncoder =
  mconcat
    [ entityKey >$< Id.idEncoder Id.getOffChainVoteGovActionDataId
    , entityVal >$< offChainVoteGovActionDataEncoder
    ]

offChainVoteGovActionDataEncoder :: E.Params OffChainVoteGovActionData
offChainVoteGovActionDataEncoder =
  mconcat
    [ offChainVoteGovActionDataOffChainVoteDataId >$< Id.idEncoder Id.getOffChainVoteDataId
    , offChainVoteGovActionDataTitle >$< E.param (E.nonNullable E.text)
    , offChainVoteGovActionDataAbstract >$< E.param (E.nonNullable E.text)
    , offChainVoteGovActionDataMotivation >$< E.param (E.nonNullable E.text)
    , offChainVoteGovActionDataRationale >$< E.param (E.nonNullable E.text)
    ]

offChainVoteGovActionDataBulkEncoder :: E.Params ([Id.OffChainVoteDataId], [Text], [Text], [Text], [Text])
offChainVoteGovActionDataBulkEncoder =
  contrazip5
    (bulkEncoder (Id.idBulkEncoder Id.getOffChainVoteDataId))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nonNullable E.text))

-- |
-- Table Name: off_chain_vote_drep_data
-- Description:
-- Schema reference for @off_chain_vote_drep_data@:
-- The table with offchain metadata for Drep Registrations. Implementes CIP-119. New in 13.3-Conway.
data OffChainVoteDrepData = OffChainVoteDrepData
  { offChainVoteDrepDataOffChainVoteDataId :: !Id.OffChainVoteDataId -- noreference

  -- ^ The vote metadata table index this offchain data belongs to.
  , offChainVoteDrepDataPaymentAddress :: !(Maybe Text)
  -- ^ The payment address
  , offChainVoteDrepDataGivenName :: !Text
  -- ^ The name. This is the only mandatory field
  , offChainVoteDrepDataObjectives :: !(Maybe Text)
  -- ^ The objectives
  , offChainVoteDrepDataMotivations :: !(Maybe Text)
  -- ^ The motivations
  , offChainVoteDrepDataQualifications :: !(Maybe Text)
  -- ^ The qualifications
  , offChainVoteDrepDataImageUrl :: !(Maybe Text)
  , offChainVoteDrepDataImageHash :: !(Maybe Text)
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteDrepData = Id.OffChainVoteDrepDataId
instance DbInfo OffChainVoteDrepData where
  unnestParamTypes _ =
    [ ("off_chain_vote_data_id", "bigint[]")
    , ("payment_address", "text[]")
    , ("given_name", "text[]")
    , ("objectives", "text[]")
    , ("motivations", "text[]")
    , ("qualifications", "text[]")
    , ("image_url", "text[]")
    , ("image_hash", "text[]")
    ]

offChainVoteDrepDataBulkEncoder :: E.Params ([Id.OffChainVoteDataId], [Maybe Text], [Text], [Maybe Text], [Maybe Text], [Maybe Text], [Maybe Text], [Maybe Text])
offChainVoteDrepDataBulkEncoder =
  contrazip8
    (bulkEncoder (Id.idBulkEncoder Id.getOffChainVoteDataId))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nullable E.text))
    (bulkEncoder (E.nullable E.text))

-- |
-- Table Name: off_chain_vote_author
-- Description:
-- Schema reference for @off_chain_vote_author@:
-- The table with offchain metadata authors, as decribed in CIP-100. New in 13.3-Conway.
data OffChainVoteAuthor = OffChainVoteAuthor
  { offChainVoteAuthorOffChainVoteDataId :: !Id.OffChainVoteDataId -- noreference

  -- ^ The OffChainVoteData table index this offchain data refers.
  , offChainVoteAuthorName :: !(Maybe Text)
  -- ^ The name of the author.
  , offChainVoteAuthorWitnessAlgorithm :: !Text
  -- ^ The witness algorithm used by the author.
  , offChainVoteAuthorPublicKey :: !Text
  -- ^ The public key used by the author.
  , offChainVoteAuthorSignature :: !Text
  -- ^ The signature of the author.
  , offChainVoteAuthorWarning :: !(Maybe Text)
  -- ^ A warning related to verifying this metadata.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteAuthor = Id.OffChainVoteAuthorId

instance DbInfo OffChainVoteAuthor where
  unnestParamTypes _ =
    [ ("off_chain_vote_data_id", "bigint[]")
    , ("name", "text[]")
    , ("witness_algorithm", "text[]")
    , ("public_key", "text[]")
    , ("signature", "text[]")
    , ("warning", "text[]")
    ]

offChainVoteAuthorBulkEncoder ::
  E.Params ([Id.OffChainVoteDataId], [Maybe Text], [Text], [Text], [Text], [Maybe Text])
offChainVoteAuthorBulkEncoder =
  contrazip6
    (bulkEncoder $ Id.idBulkEncoder Id.getOffChainVoteDataId)
    (bulkEncoder $ E.nullable E.text)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nullable E.text)

-- |
-- Table Name: off_chain_vote_reference
-- Description:
-- Schema reference for @off_chain_vote_reference@:
-- The table with offchain metadata references, as decribed in CIP-100. New in 13.3-Conway.
data OffChainVoteReference = OffChainVoteReference
  { offChainVoteReferenceOffChainVoteDataId :: !Id.OffChainVoteDataId -- noreference

  -- ^ The OffChainVoteData table index this entry refers.
  , offChainVoteReferenceLabel :: !Text
  -- ^ The label of this vote reference.
  , offChainVoteReferenceUri :: !Text
  -- ^ The uri of this vote reference.
  , offChainVoteReferenceHashDigest :: !(Maybe Text)
  -- ^ The hash digest of this vote reference, as described in CIP-108. This only appears for
  -- governance action metadata.
  , offChainVoteReferenceHashAlgorithm :: !(Maybe Text)
  -- ^ The hash algorithm of this vote reference, as described in CIP-108. This only appears for
  -- governance action metadata.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteReference = Id.OffChainVoteReferenceId
instance DbInfo OffChainVoteReference where
  unnestParamTypes _ =
    [ ("off_chain_vote_data_id", "bigint[]")
    , ("label", "text[]")
    , ("uri", "text[]")
    , ("hash_digest", "text[]")
    , ("hash_algorithm", "text[]")
    ]

offChainVoteReferenceBulkEncoder :: E.Params ([Id.OffChainVoteDataId], [Text], [Text], [Maybe Text], [Maybe Text])
offChainVoteReferenceBulkEncoder =
  contrazip5
    (bulkEncoder $ Id.idBulkEncoder Id.getOffChainVoteDataId)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nullable E.text)
    (bulkEncoder $ E.nullable E.text)

-- |
-- Table Name: off_chain_vote_external_update
-- Description:
-- Schema reference for @off_chain_vote_external_update@:
-- The table with offchain metadata external updates, as decribed in CIP-100. New in 13.3-Conway.
data OffChainVoteExternalUpdate = OffChainVoteExternalUpdate
  { offChainVoteExternalUpdateOffChainVoteDataId :: !Id.OffChainVoteDataId -- noreference

  -- ^ The OffChainVoteData table index this entry refers.
  , offChainVoteExternalUpdateTitle :: !Text
  -- ^ The title of this external update.
  , offChainVoteExternalUpdateUri :: !Text
  -- ^ The uri of this external update.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteExternalUpdate = Id.OffChainVoteExternalUpdateId
instance DbInfo OffChainVoteExternalUpdate where
  unnestParamTypes _ =
    [ ("off_chain_vote_data_id", "bigint[]")
    , ("title", "text[]")
    , ("uri", "text[]")
    ]

offChainVoteExternalUpdatesBulkEncoder :: E.Params ([Id.OffChainVoteDataId], [Text], [Text])
offChainVoteExternalUpdatesBulkEncoder =
  contrazip3
    (bulkEncoder $ Id.idBulkEncoder Id.getOffChainVoteDataId)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nonNullable E.text)

-- |
-- Table Name: off_chain_vote_fetch_error
-- Description:
-- Schema reference for @off_chain_vote_fetch_error@:
-- Errors while fetching or validating offchain Voting Anchor metadata. New in 13.2-Conway.
data OffChainVoteFetchError = OffChainVoteFetchError
  { offChainVoteFetchErrorVotingAnchorId :: !Id.VotingAnchorId -- noreference

  -- ^ The VotingAnchor table index this offchain fetch error refers.
  , offChainVoteFetchErrorFetchError :: !Text
  -- ^ The text of the error.
  , offChainVoteFetchErrorFetchTime :: !UTCTime -- sqltype=timestamp
  , offChainVoteFetchErrorRetryCount :: !Word -- sqltype=word31type

  -- ^ The number of retries.
  }
  deriving (Eq, Show, Generic)

type instance Key OffChainVoteFetchError = Id.OffChainVoteFetchErrorId
instance DbInfo OffChainVoteFetchError where
  uniqueFields _ = ["voting_anchor_id", "retry_count"]
  unnestParamTypes _ =
    [ ("voting_anchor_id", "bigint[]")
    , ("fetch_error", "text[]")
    , ("fetch_time", "timestamp[]")
    , ("retry_count", "bigint[]")
    ]

offChainVoteFetchErrorBulkEncoder :: E.Params ([Id.VotingAnchorId], [Text], [UTCTime], [Word])
offChainVoteFetchErrorBulkEncoder =
  contrazip4
    (bulkEncoder (Id.idBulkEncoder Id.getVotingAnchorId))
    (bulkEncoder (E.nonNullable E.text))
    (bulkEncoder (E.nonNullable utcTimeAsTimestampEncoder))
    (bulkEncoder (E.nonNullable (fromIntegral >$< E.int4)))
