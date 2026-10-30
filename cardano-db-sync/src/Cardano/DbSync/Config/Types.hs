{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE NoImplicitPrelude #-}

module Cardano.DbSync.Config.Types (
  ConfigFile (..),
  SyncCommand (..),
  SyncNodeParams (..),
  SyncProtocol (..),
  GenesisFile (..),
  GenesisHashShelley (..),
  GenesisHashByron (..),
  GenesisHashAlonzo (..),
  GenesisHashConway (..),
  GenesisHashDijkstra (..),
  RemoveJsonbFromSchemaConfig (..),
  TxOutVariantTypeConfig (..),
  SyncNodeConfig (..),
  SyncPreConfig (..),
  SyncInsertConfig (..),
  SyncInsertPreset (..),
  SyncInsertOptions (..),
  TxCBORConfig (..),
  PoolStatsConfig (..),
  EpochConfig (..),
  TxOutConfig (..),
  UseTxOutAddress (..),
  ForceTxIn (..),
  LedgerBackend (..),
  LedgerInsertConfig (..),
  ShelleyInsertConfig (..),
  RewardsConfig (..),
  MultiAssetConfig (..),
  MetadataConfig (..),
  PlutusConfig (..),
  GovernanceConfig (..),
  OffchainPoolDataConfig (..),
  OffchainVoteDataConfig (..),
  SnapshotIntervalConfig (..),
  LedgerStateDir (..),
  LogFileDir (..),
  NetworkName (..),
  NodeConfigFile (..),
  SocketPath (..),
  adjustGenesisFilePath,
  adjustNodeConfigFilePath,
  pcNodeConfigFilePath,
  isTxOutEnabled,
  hasLedger,
  shouldUseLedger,
  isShelleyEnabled,
  isMultiAssetEnabled,
  isMetadataEnabled,
  isPlutusEnabled,
  isEpochEnabled,
  isTxOutConsumedBootstrap,
  isTxOutConsumed,
  isTxOutConsumedPrune,
  forceTxIn,
  fullInsertOptions,
  onlyUTxOInsertOptions,
  onlyGovInsertOptions,
  disableAllInsertOptions,
) where

import qualified Cardano.Chain.Update as Byron
import Cardano.Crypto (RequiresNetworkMagic (..))
import qualified Cardano.Crypto.Hash as Crypto
import Cardano.Db (MigrationDir, PGPassSource (..), TxOutVariantType (..))
import Cardano.DbSync.Util.Address (deserialiseRewardAccount, serialiseRewardAccount)
import Cardano.Logging.Types (TraceConfig)
import Cardano.Prelude
import Cardano.Slotting.Slot (SlotNo (..))
import Control.Monad (fail)
import Data.Aeson (FromJSON (..), ToJSON (..), Value (..), (.!=), (.:), (.:?), (.=))
import qualified Data.Aeson as Aeson
import Data.Aeson.Key (fromText)
import qualified Data.Aeson.KeyMap as KeyMap
import Data.Aeson.Types (Pair, Parser, typeMismatch)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as Base16
import Data.ByteString.Short (ShortByteString (), fromShort, toShort)
import Data.Default.Class (Default (..))
import Data.String (String)
import qualified Data.Text as Text
import Ouroboros.Consensus.Cardano (CardanoHardForkTrigger (..))
import Ouroboros.Consensus.Cardano.Block (AllegraEra, AlonzoEra, BabbageEra, ConwayEra, DijkstraEra, MaryEra, ShelleyEra, StandardCrypto)
import Ouroboros.Consensus.Protocol.Praos (Praos)
import Ouroboros.Consensus.Protocol.TPraos (TPraos)
import Ouroboros.Consensus.Shelley.Ledger.Block (ShelleyBlock)

{- HLINT ignore "Reduce duplication" -}

newtype LogFileDir = LogFileDir
  { unLogFileDir :: FilePath
  }

newtype ConfigFile = ConfigFile
  { unConfigFile :: FilePath
  }
  deriving (Show)

data SyncCommand
  = CmdRun !SyncNodeParams
  | CmdVersion

-- | The product type of all command line arguments
data SyncNodeParams = SyncNodeParams
  { enpConfigFile :: !ConfigFile
  , enpSocketPath :: !SocketPath
  , enpTracerSocket :: !(Maybe FilePath)
  -- ^ Socket path of a cardano-tracer to forward logs and metrics to.
  , enpMaybeLedgerStateDir :: !(Maybe LedgerStateDir)
  , enpMigrationDir :: !MigrationDir
  , enpPGPassSource :: !PGPassSource
  , enpHasCache :: !Bool
  , enpForceIndexes :: !Bool
  , enpHasInOut :: !Bool
  -- ^ Retained for source compatibility; 'False' is rejected before startup. Use @tx_out@ instead.
  , enpMaybeRollback :: !(Maybe SlotNo)
  , enpAllowPrivateOffChainUrls :: !Bool
  -- ^ When 'True', the off-chain HTTP fetcher (pool and vote metadata) does not
  -- reject URLs whose host or resolved IP is in a private / loopback / link-local
  -- range. Intended for local-cluster testing only; off by default.
  }
  deriving (Show)

-- May have other constructors when we are preparing for a HFC event.
data SyncProtocol
  = SyncProtocolCardano
  deriving (Show)

data SyncNodeConfig = SyncNodeConfig
  { dncNetworkName :: !NetworkName
  , dncTraceConfig :: !TraceConfig
  , dncNodeConfigFile :: !NodeConfigFile
  , dncProtocol :: !SyncProtocol
  , dncRequiresNetworkMagic :: !RequiresNetworkMagic
  , dncEnableLogging :: !Bool
  , dncEnableMetrics :: !Bool
  , dncPrometheusPort :: !Int
  , dncPBftSignatureThreshold :: !(Maybe Double)
  , dncByronGenesisFile :: !GenesisFile
  , dncByronGenesisHash :: !GenesisHashByron
  , dncShelleyGenesisFile :: !GenesisFile
  , dncShelleyGenesisHash :: !GenesisHashShelley
  , dncAlonzoGenesisFile :: !GenesisFile
  , dncAlonzoGenesisHash :: !GenesisHashAlonzo
  , dncConwayGenesisFile :: !GenesisFile
  , dncConwayGenesisHash :: !(Maybe GenesisHashConway)
  , dncDijkstraGenesisFile :: !(Maybe GenesisFile)
  , dncDijkstraGenesisHash :: !(Maybe GenesisHashDijkstra)
  , dncByronProtocolVersion :: !Byron.ProtocolVersion
  , dncExperimentalHardForksEnabled :: !Bool
  -- ^ Mirrors the node's @ExperimentalHardForksEnabled@.
  , dncShelleyHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (TPraos StandardCrypto) ShelleyEra))
  , dncAllegraHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (TPraos StandardCrypto) AllegraEra))
  , dncMaryHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (TPraos StandardCrypto) MaryEra))
  , dncAlonzoHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (TPraos StandardCrypto) AlonzoEra))
  , dncBabbageHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (Praos StandardCrypto) BabbageEra))
  , dncConwayHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (Praos StandardCrypto) ConwayEra))
  , dncDijkstraHardFork :: !(CardanoHardForkTrigger (ShelleyBlock (Praos StandardCrypto) DijkstraEra))
  , dncInsertOptions :: !SyncInsertOptions
  , dncIpfsGateway :: [Text]
  , dncSnapshotInterval :: !SnapshotIntervalConfig
  , dncLedgerBackend :: !LedgerBackend
  }

data SyncPreConfig = SyncPreConfig
  { pcNetworkName :: !NetworkName
  , pcNodeConfigFile :: !NodeConfigFile
  , pcEnableFutureGenesis :: !Bool
  , pcEnableLogging :: !Bool
  , pcEnableMetrics :: !Bool
  , pcPrometheusPort :: !Int
  , pcInsertConfig :: !SyncInsertConfig
  , pcIpfsGateway :: ![Text]
  , pcSnapshotInterval :: !SnapshotIntervalConfig
  , pcLedgerBackend :: !LedgerBackend
  }
  deriving (Show)

-- | The optional @insert_options.preset@ selects base settings: @full@, @only_utxo@, @only_governance@,
-- or @disable_all@. Explicit sibling options override the selected preset. Without a preset the
-- standard defaults apply.
--
-- The formerly ignored @json_type@ selector is rejected before database startup. Remove it and
-- use @remove_jsonb_from_schema@ to select text versus JSONB columns; JSON payload insertion remains
-- enabled. Existing databases follow the existing startup conversion and restart rules.
data SyncInsertConfig = SyncInsertConfig
  { sicPreset :: Maybe SyncInsertPreset
  , sicOptions :: SyncInsertOptions
  }
  deriving (Eq, Show)

-- | Preset choices are @full@, @only_utxo@, @only_governance@ and @disable_all@. These establish base
-- insert options; individual keys may override them.
--
-- The full preset enables pool statistics but leaves transaction CBOR and both off-chain fetchers
-- disabled. The only_utxo preset uses bootstrap outputs and ignores ledger data; only_governance
-- retains governance with ledger enabled; disable_all disables the optional insertion categories.
data SyncInsertPreset
  = FullInsertPreset
  | OnlyUTxOInsertPreset
  | OnlyGovInsertPreset
  | DisableAllInsertPreset
  deriving (Eq, Show)

-- | The @insert_options@ object controls which chain data db-sync inserts. Optional @stop_at_block@
-- stops after the specified block number; absent means no configured stop. Individual settings
-- override a selected preset.
data SyncInsertOptions = SyncInsertOptions
  { sioTxCBOR :: TxCBORConfig
  , sioTxOut :: TxOutConfig
  , sioLedger :: LedgerInsertConfig
  , sioShelley :: ShelleyInsertConfig
  , sioRewards :: RewardsConfig
  , sioMultiAsset :: MultiAssetConfig
  , sioMetadata :: MetadataConfig
  , sioPlutus :: PlutusConfig
  , sioGovernance :: GovernanceConfig
  , sioOffchainPoolData :: OffchainPoolDataConfig
  , sioOffchainVoteData :: OffchainVoteDataConfig
  , sioPoolStats :: PoolStatsConfig
  , sioRemoveJsonbFromSchema :: RemoveJsonbFromSchemaConfig
  , sioEpoch :: EpochConfig
  , sioStopAtBlock :: Maybe Word64
  }
  deriving (Eq, Show)

-- | @tx_cbor@ accepts @enable@ or @disable@ to control collection of transaction CBOR; the default is
-- @disable@.
newtype TxCBORConfig = TxCBORConfig
  { isTxCBOREnabled :: Bool
  }
  deriving (Eq, Show)

-- | @pool_stat@ accepts @enable@ or @disable@ to control pool statistics. It defaults to @disable@
-- without a preset and is enabled by the @full@ preset.
newtype PoolStatsConfig = PoolStatsConfig
  { isPoolStatsEnabled :: Bool
  }
  deriving (Eq, Show)

-- | @disable_epoch@ defaults to false. When true, the public @epoch@ view and @epoch_current@ view
-- return no rows; @epoch_finalized@ contains finalized aggregates. Epoch views are also disabled
-- during bootstrap or when transaction output insertion is disabled, even if this flag is false.
newtype EpochConfig = EpochConfig
  { isEpochDisabled :: Bool
  }
  deriving (Eq, Show)
  deriving newtype (ToJSON, FromJSON)

-- | @tx_out.value@ is required when the object is supplied. @enable@ stores inputs and outputs;
-- @disable@ leaves them empty; @consumed@ tracks consuming transactions; @prune@ removes consumed
-- outputs; @bootstrap@ defers UTxO insertion until near tip using the ledger. The optional
-- @force_tx_in@ and @use_address_table@ booleans default to false. Changing from prune or consumed
-- modes requires care on subsequent runs.
--
-- With disable, tx_in, tx_out and ma_tx_out remain empty; tx.fee may be zero and redeemer.script_hash
-- null. Consumed mode fills consumed_by_tx_id. Prune propagates deletions to ma_tx_out. Bootstrap
-- requires in-memory ledger state; it supports Babbage, Conway and Dijkstra. The LSM backend is not supported.
-- It loads the UTxO in bulk and leaves tx.fee and redeemer.script_hash incomplete during bootstrap.
-- Once used, consumed mode must remain enabled on subsequent runs unless switching to pruning.
-- Once used, pruning must remain enabled on subsequent runs; dropping it is rejected and can cause
-- failures. Bootstrap must remain selected until the UTxO migration completes. After completion,
-- bootstrap can be changed, but the database's consumed/pruning requirements still apply.
data TxOutConfig
  = TxOutEnable UseTxOutAddress
  | TxOutDisable
  | TxOutConsumed ForceTxIn UseTxOutAddress
  | TxOutConsumedPrune ForceTxIn UseTxOutAddress
  | TxOutConsumedBootstrap ForceTxIn UseTxOutAddress
  deriving (Eq, Show)

-- | @tx_out.force_tx_in@ defaults to false. It applies to @consumed@, @prune@ and @bootstrap@; it is
-- ignored for @enable@ and @disable@. Once input/output insertion is active, setting it to true
-- populates @tx_in@ in consumed, prune and bootstrap modes, which otherwise omit transaction
-- inputs. It does not override the disabled insertion phase before bootstrap's UTxO migration.
newtype ForceTxIn = ForceTxIn {unForceTxIn :: Bool}
  deriving (Eq, Show)
  deriving newtype (ToJSON, FromJSON)

-- | @tx_out.use_address_table@ defaults to false. When enabled, address details live in a separate
-- @address@ table referenced by outputs. This schema variant requires an empty database.
--
-- The normalized address table stores address, raw bytes, script flag, payment credential and stake
-- address. Both tx_out and collateral_tx_out then refer to address_id; the variant has payment
-- credential and raw-address indexes. Once selected, this schema variant cannot be reverted on
-- the same database; keep @use_address_table@ enabled on subsequent runs.
newtype UseTxOutAddress = UseTxOutAddress {unUseTxOutAddress :: Bool}
  deriving (Eq, Show)
  deriving newtype (ToJSON, FromJSON)

-- | Choose the backend for storing ledger tables (UTxO set).
-- 'LedgerBackendInMemory' keeps everything in RAM (current default).
-- 'LedgerBackendLSM' uses LSM trees on disk for lower memory usage.
-- The top-level @ledger_backend@ selects @inmemory@ (default) or @lsm@. The former keeps the UTxO set
-- in RAM; the latter uses disk-backed LSM trees.
data LedgerBackend
  = LedgerBackendInMemory
  | LedgerBackendLSM (Maybe FilePath)
  deriving (Eq, Show)

instance FromJSON LedgerBackend where
  parseJSON = Aeson.withText "LedgerBackend" $ \case
    "inmemory" -> pure LedgerBackendInMemory
    "lsm" -> pure (LedgerBackendLSM Nothing)
    other -> fail $ "unexpected ledger_backend: " <> show other <> ". Expected \"inmemory\" or \"lsm\"."

-- | @ledger@ accepts @enable@, @disable@ or @ignore@. Enable maintains and uses the ledger; disable
-- does not maintain one; ignore maintains it for UTxO loading but does not use its other data.
--
-- With disable or ignore, new ledger-derived @reward@, @epoch_stake@, @ada_pots@, @epoch_param@ and
-- @drep_distr@ data are unavailable. @redeemer.fee@ is null; stake-registration and pool-update
-- deposits and ledger-derived governance epochs may be absent. @tx.deposit@ can be computed from resolved inputs,
-- outputs, withdrawals, fees and treasury donations even without ledger data; it is null when the
-- required values cannot be resolved, rather than always null in these modes.
--
-- Starting with either disable or ignore irreversibly clears existing @reward@, @epoch_stake@,
-- @ada_pots@ and @epoch_param@ rows and redeemer fees through the no-ledger migration. Do not change
-- ledger mode casually on an existing database. A supplied @--state-dir@ with ledger disabled
-- produces a warning, not an error; disable does not maintain ledger snapshots, while ignore does.
data LedgerInsertConfig
  = LedgerEnable
  | LedgerDisable
  | LedgerIgnore
  deriving (Eq, Show)

-- | @shelley.enable@ controls transaction-era stake/pool certificates, withdrawals and parameter
-- proposals, not epoch stake or rewards. Genesis-era stake and pool registrations are still inserted.
-- Governance certificates and vote delegations use the separate @governance@ option.
-- A non-empty @stake_addresses@ list selects canonical bech32 stake accounts for Shelley stake
-- certificates, MIR recipients and withdrawals. Identity rows required by transaction outputs,
-- epoch stake, rewards and governance remain available. Pool certificates, parameter proposals,
-- non-address-specific pot transfers and Conway vote delegation are not filtered. A changed
-- selection requires a fresh database and replay.
data ShelleyInsertConfig
  = ShelleyEnable
  | ShelleyDisable
  | ShelleyStakeAddrs (NonEmpty ShortByteString)
  deriving (Eq, Show)

newtype RewardsConfig = RewardsConfig
  {areRewardsEnabled :: Bool}
  deriving (Eq, Show)

-- | @multi_asset.enable@ controls multi-asset entries. An optional non-empty @policies@ list
-- selects 28-byte policy IDs written as hexadecimal, for both minted and output assets.
-- Script and redeemer data are governed independently by @plutus@. A changed selection
-- requires a fresh database and replay.
data MultiAssetConfig
  = MultiAssetEnable
  | MultiAssetDisable
  | MultiAssetPolicies (NonEmpty ShortByteString)
  deriving (Eq, Show)

-- | @metadata.enable@ controls transaction metadata. An optional non-empty @keys@ list restricts enabled
-- insertion to those integer metadata keys.
data MetadataConfig
  = MetadataEnable
  | MetadataDisable
  | MetadataKeys (NonEmpty Word)
  deriving (Eq, Show)

-- | @plutus.enable@ controls Plutus and script data. The non-empty @script_hashes@ list selects
-- 28-byte script hashes in hex for witness, auxiliary and reference scripts. Datums, redeemers,
-- collateral and reference inputs are retained independently; excluded reference-script IDs are null.
-- A changed selection requires a fresh database and replay.
data PlutusConfig
  = PlutusEnable
  | PlutusDisable
  | PlutusScripts (NonEmpty ShortByteString)
  deriving (Eq, Show)

-- | @governance@ accepts @enable@ or @disable@ for governance data; off-chain vote metadata has its own
-- independent setting.
newtype GovernanceConfig = GovernanceConfig
  { isGovernanceEnabled :: Bool
  }
  deriving (Eq, Show)

-- | @offchain_pool_data@ accepts @enable@ or @disable@ for fetching stake-pool metadata and defaults to
-- @disable@. Fetch restrictions and the testing-only private-URL flag also apply.
--
-- Pool metadata includes the registered name, ticker, homepage and description. Fetches are subject to
-- network-address restrictions; the private-URL switch is intended only for local-cluster tests.
newtype OffchainPoolDataConfig = OffchainPoolDataConfig
  { isOffchainPoolDataEnabled :: Bool
  }
  deriving (Eq, Show)

-- | @offchain_vote_data@ accepts @enable@ or @disable@ for governance-anchor metadata and defaults to
-- @disable@. It is independent of the @governance@ option.
--
-- Governance anchors include DRep registrations (CIP-119), governance action proposals (CIP-108), and
-- vote metadata (CIP-100). Prior releases coupled fetching to the governance option.
newtype OffchainVoteDataConfig = OffchainVoteDataConfig
  { isOffchainVoteDataEnabled :: Bool
  }
  deriving (Eq, Show)

-- | @remove_jsonb_from_schema@ accepts @enable@ or @disable@. Enabling removes JSONB types from
-- supported schema columns to improve insertion performance; changing an existing schema requires
-- care. Disabling this option or removing it converts the affected columns back to JSONB on startup;
-- either conversion can take time.
--
-- Affected JSONB columns include tx_metadata.json, script.json, datum.value, redeemer_data.value,
-- cost_model.costs, gov_action_proposal.description, off_chain_pool_data.json and
-- off_chain_vote_data.json.
newtype RemoveJsonbFromSchemaConfig = RemoveJsonbFromSchemaConfig
  { isRemoveJsonbFromSchemaEnabled :: Bool
  }
  deriving (Eq, Show)

newtype TxOutVariantTypeConfig = TxOutVariantTypeConfig
  { unTxOutVariantTypeConfig :: TxOutVariantType
  }
  deriving (Eq, Show)

-- | The top-level @snapshot_interval.near_tip_epoch@ threshold defaults to 580. Snapshot frequency
-- changes when syncing near the tip; earlier syncing uses less frequent snapshots.
--
-- At an epoch boundary above zero, snapshots are taken every epoch at or above this threshold,
-- even while lagging. Below it, snapshots occur on multiples of ten epochs, or on every epoch when
-- the database is consistent and the chain time is within ten days of current time.
newtype SnapshotIntervalConfig = SnapshotIntervalConfig
  { sicNearTipEpoch :: Word64
  }
  deriving (Eq, Show)

newtype GenesisFile = GenesisFile
  { unGenesisFile :: FilePath
  }
  deriving (Show)
  deriving newtype (FromJSON, ToJSON)

newtype GenesisHashByron = GenesisHashByron
  { unGenesisHashByron :: Text
  }
  deriving newtype (Eq, Show, ToJSON, FromJSON)

newtype GenesisHashShelley = GenesisHashShelley
  { unGenesisHashShelley :: Crypto.Hash Crypto.Blake2b_256 ByteString
  }
  deriving newtype (Eq, Show, ToJSON, FromJSON)

newtype GenesisHashAlonzo = GenesisHashAlonzo
  { unGenesisHashAlonzo :: Crypto.Hash Crypto.Blake2b_256 ByteString
  }
  deriving newtype (Eq, Show, ToJSON, FromJSON)

newtype GenesisHashConway = GenesisHashConway
  {unGenesisHashConway :: Crypto.Hash Crypto.Blake2b_256 ByteString}
  deriving newtype (Eq, Show, ToJSON, FromJSON)

newtype GenesisHashDijkstra = GenesisHashDijkstra
  {unGenesisHashDijkstra :: Crypto.Hash Crypto.Blake2b_256 ByteString}
  deriving newtype (Eq, Show, ToJSON, FromJSON)

newtype LedgerStateDir = LedgerStateDir
  { unLedgerStateDir :: FilePath
  }
  deriving (Show)

newtype NetworkName = NetworkName
  { unNetworkName :: Text
  }
  deriving (Show)

newtype NodeConfigFile = NodeConfigFile
  { unNodeConfigFile :: FilePath
  }
  deriving (Show)

newtype SocketPath = SocketPath
  { unSocketPath :: FilePath
  }
  deriving (Show)

adjustGenesisFilePath :: (FilePath -> FilePath) -> GenesisFile -> GenesisFile
adjustGenesisFilePath f (GenesisFile p) = GenesisFile (f p)

adjustNodeConfigFilePath :: (FilePath -> FilePath) -> NodeConfigFile -> NodeConfigFile
adjustNodeConfigFilePath f (NodeConfigFile p) = NodeConfigFile (f p)

pcNodeConfigFilePath :: SyncPreConfig -> FilePath
pcNodeConfigFilePath = unNodeConfigFile . pcNodeConfigFile

isTxOutEnabled :: TxOutConfig -> Bool
isTxOutEnabled TxOutDisable = False
isTxOutEnabled (TxOutEnable _) = True
isTxOutEnabled (TxOutConsumed _ _) = True
isTxOutEnabled (TxOutConsumedPrune _ _) = True
isTxOutEnabled (TxOutConsumedBootstrap _ _) = True

isTxOutConsumedBootstrap :: TxOutConfig -> Bool
isTxOutConsumedBootstrap (TxOutConsumedBootstrap _ _) = True
isTxOutConsumedBootstrap _ = False

isTxOutConsumed :: TxOutConfig -> Bool
isTxOutConsumed (TxOutConsumed _ _) = True
isTxOutConsumed _ = False

isTxOutConsumedPrune :: TxOutConfig -> Bool
isTxOutConsumedPrune (TxOutConsumedPrune _ _) = True
isTxOutConsumedPrune _ = False

forceTxIn :: TxOutConfig -> Bool
forceTxIn (TxOutConsumed f _) = unForceTxIn f
forceTxIn (TxOutConsumedPrune f _) = unForceTxIn f
forceTxIn (TxOutConsumedBootstrap f _) = unForceTxIn f
forceTxIn (TxOutEnable _) = False
forceTxIn TxOutDisable = False

hasLedger :: LedgerInsertConfig -> Bool
hasLedger LedgerDisable = False
hasLedger LedgerEnable = True
hasLedger LedgerIgnore = True

shouldUseLedger :: LedgerInsertConfig -> Bool
shouldUseLedger LedgerDisable = False
shouldUseLedger LedgerEnable = True
shouldUseLedger LedgerIgnore = False

isShelleyEnabled :: ShelleyInsertConfig -> Bool
isShelleyEnabled ShelleyDisable = False
isShelleyEnabled ShelleyEnable = True
isShelleyEnabled (ShelleyStakeAddrs _) = True

isMultiAssetEnabled :: MultiAssetConfig -> Bool
isMultiAssetEnabled MultiAssetDisable = False
isMultiAssetEnabled MultiAssetEnable = True
isMultiAssetEnabled (MultiAssetPolicies _) = True

isMetadataEnabled :: MetadataConfig -> Bool
isMetadataEnabled MetadataDisable = False
isMetadataEnabled MetadataEnable = True
isMetadataEnabled (MetadataKeys _) = True

isPlutusEnabled :: PlutusConfig -> Bool
isPlutusEnabled PlutusDisable = False
isPlutusEnabled PlutusEnable = True
isPlutusEnabled (PlutusScripts _) = True

isEpochEnabled :: EpochConfig -> Bool
isEpochEnabled = not . isEpochDisabled

---------------------------------------------------------------------------------------------------

instance FromJSON SyncPreConfig where
  parseJSON =
    Aeson.withObject "top-level" parseGenSyncNodeConfig

parseGenSyncNodeConfig :: Aeson.Object -> Parser SyncPreConfig
parseGenSyncNodeConfig o =
  SyncPreConfig
    <$> fmap NetworkName (o .: "NetworkName")
    <*> fmap NodeConfigFile (o .: "NodeConfigFile")
    <*> fmap (fromMaybe True) (o .:? "EnableFutureGenesis")
    <*> o .: "EnableLogging"
    <*> o .: "EnableLogMetrics"
    <*> fmap (fromMaybe 8080) (o .:? "PrometheusPort")
    <*> o .:? "insert_options" .!= def
    <*> o .:? "ipfs_gateway" .!= ["https://ipfs.io/ipfs"]
    <*> o .:? "snapshot_interval" .!= def
    <*> o .:? "ledger_backend" .!= LedgerBackendInMemory

instance FromJSON SyncProtocol where
  parseJSON o =
    case o of
      String "Cardano" -> pure SyncProtocolCardano
      x -> typeMismatch "Protocol" x

instance FromJSON SyncInsertPreset where
  parseJSON = Aeson.withText "SyncInsertPreset" $ \case
    "full" -> pure FullInsertPreset
    "only_utxo" -> pure OnlyUTxOInsertPreset
    "only_governance" -> pure OnlyGovInsertPreset
    "disable_all" -> pure DisableAllInsertPreset
    other -> fail $ "unexpected preset: " <> show other

instance ToJSON SyncInsertPreset where
  toJSON FullInsertPreset = "full"
  toJSON OnlyUTxOInsertPreset = "only_utxo"
  toJSON OnlyGovInsertPreset = "only_governance"
  toJSON DisableAllInsertPreset = "disable_all"

instance FromJSON SyncInsertConfig where
  parseJSON = Aeson.withObject "SyncInsertConfig" $ \obj -> do
    preset <- obj .:? "preset"
    baseOptions <- case preset of
      Just FullInsertPreset -> pure fullInsertOptions
      Just OnlyUTxOInsertPreset -> pure onlyUTxOInsertOptions
      Just OnlyGovInsertPreset -> pure onlyGovInsertOptions
      Just DisableAllInsertPreset -> pure disableAllInsertOptions
      Nothing -> pure def -- Default options
    options <- parseOverrides obj baseOptions
    pure $ SyncInsertConfig preset options

parseOverrides :: Aeson.Object -> SyncInsertOptions -> Parser SyncInsertOptions
parseOverrides obj baseOptions = do
  when (KeyMap.member "json_type" obj) $
    fail "insert_options.json_type is retired: remove it; use remove_jsonb_from_schema to choose text or jsonb columns (JSON payload insertion cannot be disabled)"
  SyncInsertOptions
    <$> obj .:? "tx_cbor" .!= sioTxCBOR baseOptions
    <*> obj .:? "tx_out" .!= sioTxOut baseOptions
    <*> obj .:? "ledger" .!= sioLedger baseOptions
    <*> obj .:? "shelley" .!= sioShelley baseOptions
    <*> pure (sioRewards baseOptions)
    <*> obj .:? "multi_asset" .!= sioMultiAsset baseOptions
    <*> obj .:? "metadata" .!= sioMetadata baseOptions
    <*> obj .:? "plutus" .!= sioPlutus baseOptions
    <*> obj .:? "governance" .!= sioGovernance baseOptions
    <*> obj .:? "offchain_pool_data" .!= sioOffchainPoolData baseOptions
    <*> obj .:? "offchain_vote_data" .!= sioOffchainVoteData baseOptions
    <*> obj .:? "pool_stat" .!= sioPoolStats baseOptions
    <*> obj .:? "remove_jsonb_from_schema" .!= sioRemoveJsonbFromSchema baseOptions
    <*> obj .:? "disable_epoch" .!= sioEpoch baseOptions
    <*> obj .:? "stop_at_block" .!= sioStopAtBlock baseOptions

instance ToJSON SyncInsertConfig where
  toJSON (SyncInsertConfig preset options) =
    Aeson.object $ maybe [] (\p -> [fromText "preset" .= p]) preset ++ optionsToList options

optionsToList :: SyncInsertOptions -> [Pair]
optionsToList SyncInsertOptions {..} =
  catMaybes
    [ toJsonIfSet "tx_cbor" sioTxCBOR
    , toJsonIfSet "tx_out" sioTxOut
    , toJsonIfSet "ledger" sioLedger
    , toJsonIfSet "shelley" sioShelley
    , toJsonIfSet "rewards" sioRewards
    , toJsonIfSet "multi_asset" sioMultiAsset
    , toJsonIfSet "metadata" sioMetadata
    , toJsonIfSet "plutus" sioPlutus
    , toJsonIfSet "governance" sioGovernance
    , toJsonIfSet "offchain_pool_data" sioOffchainPoolData
    , toJsonIfSet "offchain_vote_data" sioOffchainVoteData
    , toJsonIfSet "pool_stat" sioPoolStats
    , toJsonIfSet "remove_jsonb_from_schema" sioRemoveJsonbFromSchema
    , toJsonIfSet "disable_epoch" sioEpoch
    , toJsonIfSet "stop_at_block" sioStopAtBlock
    ]

toJsonIfSet :: ToJSON a => Text -> a -> Maybe Pair
toJsonIfSet key value = Just $ fromText key .= value

instance FromJSON SyncInsertOptions where
  parseJSON = Aeson.withObject "SyncInsertOptions" $ \obj -> parseOverrides obj def

instance ToJSON SyncInsertOptions where
  toJSON SyncInsertOptions {..} =
    Aeson.object
      [ "tx_cbor" .= sioTxCBOR
      , "tx_out" .= sioTxOut
      , "ledger" .= sioLedger
      , "shelley" .= sioShelley
      , "multi_asset" .= sioMultiAsset
      , "metadata" .= sioMetadata
      , "plutus" .= sioPlutus
      , "governance" .= sioGovernance
      , "offchain_pool_data" .= sioOffchainPoolData
      , "offchain_vote_data" .= sioOffchainVoteData
      , "pool_stat" .= sioPoolStats
      , "remove_jsonb_from_schema" .= sioRemoveJsonbFromSchema
      , "disable_epoch" .= sioEpoch
      , "stop_at_block" .= sioStopAtBlock
      ]

instance ToJSON RewardsConfig where
  toJSON (RewardsConfig enabled) = Aeson.Bool enabled

instance ToJSON TxCBORConfig where
  toJSON = boolToEnableDisable . isTxCBOREnabled

instance ToJSON PoolStatsConfig where
  toJSON = boolToEnableDisable . isPoolStatsEnabled

instance FromJSON TxCBORConfig where
  parseJSON = Aeson.withText "tx_cbor" $ \v ->
    case enableDisableToBool v of
      Just g -> pure (TxCBORConfig g)
      Nothing -> fail $ "unexpected tx_cbor: " <> show v

instance FromJSON PoolStatsConfig where
  parseJSON = Aeson.withText "pool_stat" $ \v ->
    case enableDisableToBool v of
      Just g -> pure (PoolStatsConfig g)
      Nothing -> fail $ "unexpected pool_stat: " <> show v

instance ToJSON TxOutConfig where
  toJSON cfg =
    Aeson.object
      [ "value" .= value cfg
      , "force_tx_in" .= forceTxIn' cfg
      , "use_address_table" .= useTxOutAddress' cfg
      ]
    where
      value :: TxOutConfig -> Text
      value (TxOutEnable _) = "enable"
      value TxOutDisable = "disable"
      value (TxOutConsumed _ _) = "consumed"
      value (TxOutConsumedPrune _ _) = "prune"
      value (TxOutConsumedBootstrap _ _) = "bootstrap"

      forceTxIn' :: TxOutConfig -> Maybe Bool
      forceTxIn' (TxOutEnable _) = Nothing
      forceTxIn' TxOutDisable = Nothing
      forceTxIn' (TxOutConsumed f _) = Just (unForceTxIn f)
      forceTxIn' (TxOutConsumedPrune f _) = Just (unForceTxIn f)
      forceTxIn' (TxOutConsumedBootstrap f _) = Just (unForceTxIn f)

      useTxOutAddress' :: TxOutConfig -> Maybe Bool
      useTxOutAddress' (TxOutEnable u) = Just (unUseTxOutAddress u)
      useTxOutAddress' TxOutDisable = Nothing
      useTxOutAddress' (TxOutConsumed _ u) = Just (unUseTxOutAddress u)
      useTxOutAddress' (TxOutConsumedPrune _ u) = Just (unUseTxOutAddress u)
      useTxOutAddress' (TxOutConsumedBootstrap _ u) = Just (unUseTxOutAddress u)

instance FromJSON TxOutConfig where
  parseJSON = Aeson.withObject "tx_out" $ \obj -> do
    val <- obj .: "value"
    forceTxIn' <- obj .:? "force_tx_in" .!= ForceTxIn False
    useAddress' <- obj .:? "use_address_table" .!= UseTxOutAddress False

    case val :: Text of
      "enable" -> pure (TxOutEnable useAddress')
      "disable" -> pure TxOutDisable
      "consumed" -> pure (TxOutConsumed forceTxIn' useAddress')
      "prune" -> pure (TxOutConsumedPrune forceTxIn' useAddress')
      "bootstrap" -> pure (TxOutConsumedBootstrap forceTxIn' useAddress')
      other -> fail $ "unexpected tx_out: " <> show other

instance ToJSON LedgerInsertConfig where
  toJSON LedgerEnable = "enable"
  toJSON LedgerDisable = "disable"
  toJSON LedgerIgnore = "ignore"

instance FromJSON LedgerInsertConfig where
  parseJSON = Aeson.withText "ledger" $ \case
    "enable" -> pure LedgerEnable
    "disable" -> pure LedgerDisable
    "ignore" -> pure LedgerIgnore
    other -> fail $ "unexpected ledger: " <> show other

instance ToJSON ShelleyInsertConfig where
  toJSON cfg =
    Aeson.object
      [ "enable" .= isShelleyEnabled cfg
      , "stake_addresses" .= stakeAddrs cfg
      ]
    where
      stakeAddrs (ShelleyStakeAddrs addrs) = toJSON (map shortByteStringToJSON addrs)
      stakeAddrs _ = Aeson.Null

instance FromJSON ShelleyInsertConfig where
  parseJSON = Aeson.withObject "shelley" $ \obj -> do
    enable <- obj .: "enable"
    stakeAddrs <- obj .:? "stake_addresses"

    case (enable, stakeAddrs) of
      (False, _) -> pure ShelleyDisable
      (True, Nothing) -> pure ShelleyEnable
      (True, Just addrs) -> ShelleyStakeAddrs <$> traverse parseStakeAddress addrs
instance ToJSON MultiAssetConfig where
  toJSON cfg =
    Aeson.object
      [ "enable" .= isMultiAssetEnabled cfg
      , "policies" .= policies cfg
      ]
    where
      policies (MultiAssetPolicies ps) = toJSON (map (decodeUtf8 . Base16.encode . fromShort) ps)
      policies _ = Aeson.Null

instance FromJSON MultiAssetConfig where
  parseJSON = Aeson.withObject "multi_asset" $ \obj -> do
    enable <- obj .: "enable"
    policies <- obj .:? "policies"

    case (enable, policies) of
      (False, _) -> pure MultiAssetDisable
      (True, Nothing) -> pure MultiAssetEnable
      (True, Just ps) -> MultiAssetPolicies <$> traverse parsePolicyHash ps
instance ToJSON MetadataConfig where
  toJSON cfg =
    Aeson.object
      [ "enable" .= isMetadataEnabled cfg
      , "keys" .= keys cfg
      ]
    where
      keys (MetadataKeys ks) = toJSON ks
      keys _ = Aeson.Null

instance FromJSON MetadataConfig where
  parseJSON = Aeson.withObject "metadata" $ \obj -> do
    enable <- obj .: "enable"
    keys <- obj .:? "keys"

    pure $
      case (enable, keys) of
        (False, _) -> MetadataDisable
        (True, Nothing) -> MetadataEnable
        (True, Just ks) -> MetadataKeys ks

instance ToJSON PlutusConfig where
  toJSON cfg =
    Aeson.object
      [ "enable" .= isPlutusEnabled cfg
      , "script_hashes" .= scriptHashes cfg
      ]
    where
      scriptHashes (PlutusScripts ps) = toJSON (map (decodeUtf8 . Base16.encode . fromShort) ps)
      scriptHashes _ = Aeson.Null

instance FromJSON PlutusConfig where
  parseJSON = Aeson.withObject "plutus" $ \obj -> do
    enable <- obj .: "enable"
    scriptHashes <- obj .:? "script_hashes"

    case (enable, scriptHashes) of
      (False, _) -> pure PlutusDisable
      (True, Nothing) -> pure PlutusEnable
      (True, Just hs) -> PlutusScripts <$> traverse parseScriptHash hs
instance ToJSON GovernanceConfig where
  toJSON = boolToEnableDisable . isGovernanceEnabled

instance FromJSON GovernanceConfig where
  parseJSON = Aeson.withText "governance" $ \v ->
    case enableDisableToBool v of
      Just g -> pure (GovernanceConfig g)
      Nothing -> fail $ "unexpected governance: " <> show v

instance ToJSON OffchainPoolDataConfig where
  toJSON = boolToEnableDisable . isOffchainPoolDataEnabled

instance FromJSON RemoveJsonbFromSchemaConfig where
  parseJSON = Aeson.withText "remove_jsonb_from_schema" $ \v ->
    case enableDisableToBool v of
      Just g -> pure (RemoveJsonbFromSchemaConfig g)
      Nothing -> fail $ "unexpected remove_jsonb_from_schema: " <> show v

instance ToJSON RemoveJsonbFromSchemaConfig where
  toJSON = boolToEnableDisable . isRemoveJsonbFromSchemaEnabled

instance FromJSON TxOutVariantTypeConfig where
  parseJSON = Aeson.withText "use_address_table" $ \v ->
    case enableDisableToTxOutVariantType v of
      Just g -> pure (TxOutVariantTypeConfig g)
      Nothing -> fail $ "unexpected use_address_table: " <> show v

instance ToJSON TxOutVariantTypeConfig where
  toJSON = addressTypeToEnableDisable . unTxOutVariantTypeConfig

instance FromJSON OffchainPoolDataConfig where
  parseJSON = Aeson.withText "offchain_pool_data" $ \v ->
    case enableDisableToBool v of
      Just g -> pure (OffchainPoolDataConfig g)
      Nothing -> fail $ "unexpected offchain_pool_data: " <> show v

instance ToJSON OffchainVoteDataConfig where
  toJSON = boolToEnableDisable . isOffchainVoteDataEnabled

instance FromJSON OffchainVoteDataConfig where
  parseJSON = Aeson.withText "offchain_vote_data" $ \v ->
    case enableDisableToBool v of
      Just g -> pure (OffchainVoteDataConfig g)
      Nothing -> fail $ "unexpected offchain_vote_data: " <> show v

instance ToJSON SnapshotIntervalConfig where
  toJSON cfg =
    Aeson.object
      [ "near_tip_epoch" .= sicNearTipEpoch cfg
      ]

instance FromJSON SnapshotIntervalConfig where
  parseJSON = Aeson.withObject "snapshot_interval" $ \obj ->
    SnapshotIntervalConfig
      <$> obj .:? "near_tip_epoch" .!= sicNearTipEpoch def

instance Default SnapshotIntervalConfig where
  def =
    SnapshotIntervalConfig
      { sicNearTipEpoch = 580 -- Epoch threshold to consider being near tip
      }

instance Default SyncInsertConfig where
  def = SyncInsertConfig Nothing def

instance Default SyncInsertOptions where
  def =
    SyncInsertOptions
      { sioTxCBOR = TxCBORConfig False
      , sioTxOut = TxOutEnable (UseTxOutAddress False)
      , sioLedger = LedgerEnable
      , sioShelley = ShelleyEnable
      , sioRewards = RewardsConfig True
      , sioMultiAsset = MultiAssetEnable
      , sioMetadata = MetadataEnable
      , sioPlutus = PlutusEnable
      , sioGovernance = GovernanceConfig True
      , sioOffchainPoolData = OffchainPoolDataConfig False
      , sioOffchainVoteData = OffchainVoteDataConfig False
      , sioPoolStats = PoolStatsConfig False
      , sioRemoveJsonbFromSchema = RemoveJsonbFromSchemaConfig False
      , sioEpoch = EpochConfig False
      , sioStopAtBlock = Nothing
      }

fullInsertOptions :: SyncInsertOptions
fullInsertOptions =
  SyncInsertOptions
    { sioTxCBOR = TxCBORConfig False
    , sioTxOut = TxOutEnable (UseTxOutAddress False)
    , sioLedger = LedgerEnable
    , sioShelley = ShelleyEnable
    , sioRewards = RewardsConfig True
    , sioMultiAsset = MultiAssetEnable
    , sioMetadata = MetadataEnable
    , sioPlutus = PlutusEnable
    , sioGovernance = GovernanceConfig True
    , sioOffchainPoolData = OffchainPoolDataConfig False
    , sioOffchainVoteData = OffchainVoteDataConfig False
    , sioPoolStats = PoolStatsConfig True
    , sioRemoveJsonbFromSchema = RemoveJsonbFromSchemaConfig False
    , sioEpoch = EpochConfig False
    , sioStopAtBlock = Nothing
    }

onlyUTxOInsertOptions :: SyncInsertOptions
onlyUTxOInsertOptions =
  SyncInsertOptions
    { sioTxCBOR = TxCBORConfig False
    , sioTxOut = TxOutConsumedBootstrap (ForceTxIn False) (UseTxOutAddress False)
    , sioLedger = LedgerIgnore
    , sioShelley = ShelleyDisable
    , sioRewards = RewardsConfig True
    , sioMultiAsset = MultiAssetEnable
    , sioMetadata = MetadataDisable
    , sioPlutus = PlutusDisable
    , sioGovernance = GovernanceConfig True
    , sioOffchainPoolData = OffchainPoolDataConfig False
    , sioOffchainVoteData = OffchainVoteDataConfig False
    , sioPoolStats = PoolStatsConfig False
    , sioRemoveJsonbFromSchema = RemoveJsonbFromSchemaConfig False
    , sioEpoch = EpochConfig True
    , sioStopAtBlock = Nothing
    }

onlyGovInsertOptions :: SyncInsertOptions
onlyGovInsertOptions =
  disableAllInsertOptions
    { sioLedger = LedgerEnable
    , sioGovernance = GovernanceConfig True
    , sioPoolStats = PoolStatsConfig True
    }

disableAllInsertOptions :: SyncInsertOptions
disableAllInsertOptions =
  SyncInsertOptions
    { sioTxCBOR = TxCBORConfig False
    , sioTxOut = TxOutDisable
    , sioLedger = LedgerDisable
    , sioShelley = ShelleyDisable
    , sioRewards = RewardsConfig False
    , sioMultiAsset = MultiAssetDisable
    , sioMetadata = MetadataDisable
    , sioPlutus = PlutusDisable
    , sioOffchainPoolData = OffchainPoolDataConfig False
    , sioOffchainVoteData = OffchainVoteDataConfig False
    , sioPoolStats = PoolStatsConfig False
    , sioGovernance = GovernanceConfig False
    , sioRemoveJsonbFromSchema = RemoveJsonbFromSchemaConfig False
    , sioEpoch = EpochConfig True
    , sioStopAtBlock = Nothing
    }

addressTypeToEnableDisable :: IsString s => TxOutVariantType -> s
addressTypeToEnableDisable TxOutVariantAddress = "enable"
addressTypeToEnableDisable TxOutVariantCore = "disable"

enableDisableToTxOutVariantType :: (Eq s, IsString s) => s -> Maybe TxOutVariantType
enableDisableToTxOutVariantType = \case
  "enable" -> Just TxOutVariantAddress
  "disable" -> Just TxOutVariantCore
  _ -> Nothing

boolToEnableDisable :: IsString s => Bool -> s
boolToEnableDisable True = "enable"
boolToEnableDisable False = "disable"

enableDisableToBool :: (Eq s, IsString s) => s -> Maybe Bool
enableDisableToBool = \case
  "enable" -> Just True
  "disable" -> Just False
  _ -> Nothing

parseStakeAddress :: Text -> Parser ShortByteString
parseStakeAddress txt = case deserialiseRewardAccount txt of
  Just account
    | Text.toLower txt == serialiseRewardAccount account ->
        pure (parseShortByteString $ serialiseRewardAccount account)
  _ -> fail "shelley.stake_addresses entries must be valid bech32 stake addresses"

parsePolicyHash :: Text -> Parser ShortByteString
parsePolicyHash = parseHash28 "multi_asset.policies entries must be 28-byte hexadecimal policy IDs"

parseScriptHash :: Text -> Parser ShortByteString
parseScriptHash = parseHash28 "plutus.script_hashes entries must be 28-byte hexadecimal script hashes"

parseHash28 :: String -> Text -> Parser ShortByteString
parseHash28 message txt = case Base16.decode (encodeUtf8 txt) of
  Right bytes | BS.length bytes == 28 -> pure (toShort bytes)
  _ -> fail message

parseShortByteString :: Text -> ShortByteString
parseShortByteString = toShort . encodeUtf8

shortByteStringToJSON :: ShortByteString -> Aeson.Value
shortByteStringToJSON = toJSON . decodeUtf8 . fromShort
