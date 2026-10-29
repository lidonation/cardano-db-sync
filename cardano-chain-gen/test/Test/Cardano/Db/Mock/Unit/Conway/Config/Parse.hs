{-# LANGUAGE OverloadedStrings #-}

module Test.Cardano.Db.Mock.Unit.Conway.Config.Parse (
  conwayGenesis,
  missingConwayGenesis,
  noConwayGenesisHash,
  wrongConwayGenesisHash,
  insertConfig,
  defaultInsertConfig,
  policySelectionParsing,
  stakeSelectionParsing,
  scriptSelectionParsing,
  retiredJsonType,
  selectionPropagation,
  presetFilterOverrides,
  legacyProgrammaticOption,
) where

import Cardano.DbSync (extractSyncOptions, validateLegacyInOut)
import Cardano.DbSync.Api.Types (InsertOptions (..), SyncOptions (..))
import Cardano.DbSync.Config
import Cardano.DbSync.Config.Types
import Cardano.DbSync.Error
import Cardano.Prelude hiding (NonEmpty (..), from, isLeft, isNothing)
import qualified Data.Aeson as Aeson
import qualified Data.ByteString as BS
import Data.ByteString.Short (fromShort, toShort)
import Data.Default.Class (Default (..))
import Data.Either (isLeft)
import Data.List.NonEmpty (NonEmpty (..))
import qualified Data.Set as Set
import qualified Data.Strict.Maybe as Strict
import Data.String (String)
import qualified Data.Text as Text
import Test.Cardano.Db.Mock.Config
import Test.Tasty.HUnit (Assertion (), assertBool, (@?=))
import Prelude ()

conwayGenesis :: Assertion
conwayGenesis = do
  cfg <- mkSyncNodeConfig configDir initCommandLineArgs
  withConfig configDir mutableDir cmdLineArgs cfg (\_ -> pure ())
  where
    configDir = "config-conway"
    mutableDir = mkMutableDir "conwayConfigSimple"
    cmdLineArgs = initCommandLineArgs

missingConwayGenesis :: Assertion
missingConwayGenesis = do
  res <- try $ do
    cfg <- mkSyncNodeConfig configDir initCommandLineArgs
    withConfig configDir mutableDir cmdLineArgs cfg pure
  assertBool "Not a SyncNodeError" (isConwayConfigError res)
  where
    configDir = "config-conway-missing-genesis"
    mutableDir = mkMutableDir "conwayConfigMissingGenesis"
    cmdLineArgs = initCommandLineArgs

noConwayGenesisHash :: Assertion
noConwayGenesisHash = do
  cfg <- mkSyncNodeConfig configDir initCommandLineArgs
  let cfg' = cfg {dncConwayGenesisHash = Nothing}
  withConfig configDir mutableDir initCommandLineArgs cfg' (\_ -> pure ())
  where
    configDir = "config-conway"
    mutableDir = mkMutableDir "conwayConfigNoGenesis"

wrongConwayGenesisHash :: Assertion
wrongConwayGenesisHash = do
  cfg <- mkSyncNodeConfig configDir initCommandLineArgs
  hash <- Aeson.throwDecode "\"0000000000000000000000000000000000000000000000000000000000000000\""
  let cfg' = cfg {dncConwayGenesisHash = Just hash}
  res <- try (withConfig configDir mutableDir initCommandLineArgs cfg' (\_ -> pure ()))
  assertBool "Not a SyncNodeError" (isConwayConfigError res)
  where
    configDir = "config-conway"
    mutableDir = mkMutableDir "configConwayWrongGenesis"

isConwayConfigError :: Either SyncNodeError a -> Bool
isConwayConfigError = either isConwayConfigError' (const False)
  where
    isConwayConfigError' (SNErrConwayConfig _ _) = True
    isConwayConfigError' _ = False

defaultInsertConfig :: Assertion
defaultInsertConfig = do
  cfg <- mkSyncNodeConfig configDir initCommandLineArgs
  dncInsertOptions cfg @?= def
  where
    configDir = "config-conway"

insertConfig :: Assertion
insertConfig = do
  cfg <- mkSyncNodeConfig configDir initCommandLineArgs
  let expected =
        SyncInsertOptions
          { sioTxCBOR = TxCBORConfig False
          , sioTxOut = TxOutDisable
          , sioLedger = LedgerDisable
          , sioShelley = ShelleyDisable
          , sioRewards = RewardsConfig True
          , sioMultiAsset = MultiAssetDisable
          , sioMetadata = MetadataDisable
          , sioPlutus = PlutusDisable
          , sioGovernance = GovernanceConfig False
          , sioOffchainPoolData = OffchainPoolDataConfig False
          , sioOffchainVoteData = OffchainVoteDataConfig False
          , sioPoolStats = PoolStatsConfig False
          , sioRemoveJsonbFromSchema = RemoveJsonbFromSchemaConfig False
          , sioEpoch = EpochConfig False
          , sioStopAtBlock = Nothing
          }

  dncInsertOptions cfg @?= expected
  where
    configDir = "config-conway-insert-options"

-- Policy IDs are 28-byte script hashes, not the UTF-8 bytes of their hex text.
policySelectionParsing :: Assertion
policySelectionParsing = do
  let valid = "{\"enable\":true,\"policies\":[\"00000000000000000000000000000000000000000000000000000000\"]}"
      invalid = "{\"enable\":true,\"policies\":[\"xyz\"]}"
      emptyList = "{\"enable\":true,\"policies\":[]}"
      unfiltered = "{\"enable\":true}"
      disabled = "{\"enable\":false}"
      parsed = Aeson.eitherDecode valid :: Either String MultiAssetConfig
  assertBool "valid policy must parse" (either (const False) (const True) parsed)
  case parsed of
    Right (MultiAssetPolicies (value :| _)) -> BS.length (fromShort value) @?= 28
    _ -> assertBool "expected a policy list" False
  fmap (Aeson.decode . Aeson.encode) parsed @?= Right (Aeson.decode valid :: Maybe Aeson.Value)
  assertBool "malformed policy rejected" (isLeft (Aeson.eitherDecode invalid :: Either String MultiAssetConfig))
  assertBool "empty selection rejected" (isLeft (Aeson.eitherDecode emptyList :: Either String MultiAssetConfig))
  Aeson.eitherDecode unfiltered @?= Right MultiAssetEnable
  Aeson.eitherDecode disabled @?= Right MultiAssetDisable

-- Selection values are canonical stake addresses, not arbitrary strings.
stakeSelectionParsing :: Assertion
stakeSelectionParsing = do
  let valid = "{\"enable\":true,\"stake_addresses\":[\"stake_test1uz7nhfssw7e2p8pr4hwvlsv9x920famnd5ngz42zpk7rh2q3rg0ut\"]}"
      invalid = "{\"enable\":true,\"stake_addresses\":[\"not-a-stake-address\"]}"
      emptyList = "{\"enable\":true,\"stake_addresses\":[]}"
      parsed = Aeson.eitherDecode valid :: Either String ShelleyInsertConfig
  assertBool "valid address must parse" (either (const False) (const True) parsed)
  fmap (Aeson.decode . Aeson.encode) parsed @?= Right (Aeson.decode valid :: Maybe Aeson.Value)
  assertBool "malformed stake address rejected" (isLeft (Aeson.eitherDecode invalid :: Either String ShelleyInsertConfig))
  assertBool "empty stake selection rejected" (isLeft (Aeson.eitherDecode emptyList :: Either String ShelleyInsertConfig))

scriptSelectionParsing :: Assertion
scriptSelectionParsing = do
  let valid = "{\"enable\":true,\"script_hashes\":[\"00000000000000000000000000000000000000000000000000000000\"]}"
      invalid = "{\"enable\":true,\"script_hashes\":[\"xyz\"]}"
      emptyList = "{\"enable\":true,\"script_hashes\":[]}"
      parsed = Aeson.eitherDecode valid :: Either String PlutusConfig
  assertBool "valid script hash must parse" (either (const False) (const True) parsed)
  case parsed of
    Right (PlutusScripts (value :| _)) -> BS.length (fromShort value) @?= 28
    _ -> assertBool "expected a script list" False
  fmap (Aeson.decode . Aeson.encode) parsed @?= Right (Aeson.decode valid :: Maybe Aeson.Value)
  assertBool "malformed script hash rejected" (isLeft (Aeson.eitherDecode invalid :: Either String PlutusConfig))
  assertBool "empty script selection rejected" (isLeft (Aeson.eitherDecode emptyList :: Either String PlutusConfig))

retiredJsonType :: Assertion
retiredJsonType = do
  let rejects value = isLeft (Aeson.eitherDecode value :: Either String SyncInsertConfig)
  assertBool "text selector must not silently override schema conversion" (rejects "{\"json_type\":\"text\"}")
  assertBool "jsonb selector must not silently override schema conversion" (rejects "{\"json_type\":\"jsonb\"}")
  assertBool "disable selector cannot suppress payloads" (rejects "{\"json_type\":\"disable\"}")
  Aeson.eitherDecode "{}" @?= Right (def :: SyncInsertConfig)

selectionPropagation :: Assertion
selectionPropagation = do
  cfg <- mkSyncNodeConfig "config-conway" initCommandLineArgs
  params <- mkSyncNodeParams "config-conway" (mkMutableDir "selectionPropagation") initCommandLineArgs
  let address = toShort "stake_test1uz7nhfssw7e2p8pr4hwvlsv9x920famnd5ngz42zpk7rh2q3rg0ut"
      policy = toShort (BS.replicate 28 42)
      script = toShort (BS.replicate 28 24)
      iopts = (dncInsertOptions cfg) {sioShelley = ShelleyStakeAddrs (address :| [address]), sioMultiAsset = MultiAssetPolicies (policy :| [policy]), sioPlutus = PlutusScripts (script :| [script])}
      runtime = soptInsertOptions $ extractSyncOptions params False (cfg {dncInsertOptions = iopts})
  ioKeepStakeAddresses runtime @?= Strict.Just (Set.singleton address)
  ioKeepPolicies runtime @?= Strict.Just (Set.singleton policy)
  ioKeepScripts runtime @?= Strict.Just (Set.singleton script)
  ioShelley runtime @?= True
  ioMultiAssets runtime @?= True
  ioPlutusExtra runtime @?= True

-- Explicit overrides remain authoritative over presets, including disable.
presetFilterOverrides :: Assertion
presetFilterOverrides = do
  let selected = "{\"preset\":\"only_utxo\",\"multi_asset\":{\"enable\":true,\"policies\":[\"00000000000000000000000000000000000000000000000000000000\"]}}"
      disabled = "{\"preset\":\"full\",\"multi_asset\":{\"enable\":false,\"policies\":[\"ignored\"]}}"
  case Aeson.eitherDecode selected :: Either String SyncInsertConfig of
    Right cfg -> case sioMultiAsset (sicOptions cfg) of
      MultiAssetPolicies (value :| _) -> BS.length (fromShort value) @?= 28
      _ -> assertBool "preset override must select policies" False
    Left _ -> assertBool "selected override must parse" False
  case Aeson.eitherDecode disabled :: Either String SyncInsertConfig of
    Right cfg -> sioMultiAsset (sicOptions cfg) @?= MultiAssetDisable
    Left _ -> assertBool "disabled override must parse" False

-- The legacy field stays source-compatible, but false can never be silently ignored.
legacyProgrammaticOption :: Assertion
legacyProgrammaticOption = do
  params <- mkSyncNodeParams "config-conway" (mkMutableDir "legacyProgrammaticOption") initCommandLineArgs
  validateLegacyInOut params
  result <- try (validateLegacyInOut (params {enpHasInOut = False})) :: IO (Either IOException ())
  case result of
    Left err -> assertBool "failure explains the tx_out replacement" ("tx_out" `Text.isInfixOf` Text.pack (show err))
    Right () -> assertBool "false legacy option must fail before startup" False
