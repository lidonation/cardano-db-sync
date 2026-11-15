{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module Test.Cardano.Db.Mock.Unit.Conway.Config.JsonbInSchema (
  configRemoveJsonbFromSchemaEnabled,
  configRemoveJsonbFromSchemaDisabled,
  configJsonbInSchemaShouldRemoveThenAdd,
) where

import qualified Cardano.Db as DB
import Cardano.DbSync.Config (SyncNodeConfig (..))
import Cardano.DbSync.Config.Types (RemoveJsonbFromSchemaConfig (..), SyncInsertOptions (..))
import Cardano.Ledger.Shelley.TxAuxData (Metadatum (..))
import Cardano.Mock.ChainSync.Server (IOManager (), ServerHandle)
import Cardano.Mock.Forging.Interpreter (Interpreter, withConwayLedgerState)
import qualified Cardano.Mock.Forging.Tx.Conway as Conway
import Cardano.Mock.Forging.Types
import Cardano.Prelude hiding (head)
import qualified Data.Aeson as Aeson
import qualified Data.Map.Strict as Map
import Test.Cardano.Db.Mock.Config
import qualified Test.Cardano.Db.Mock.UnifiedApi as Api
import Test.Cardano.Db.Mock.Validate
import Test.Tasty.HUnit (Assertion, assertBool, assertFailure, (@?=))

configRemoveJsonbFromSchemaEnabled :: IOManager -> [(Text, Text)] -> Assertion
configRemoveJsonbFromSchemaEnabled =
  withCustomConfigDropDB initCommandLineArgs (Just configRemoveJsonFromSchema) conwayConfigDir "conwayConfigRemoveJsonbFromSchemaEnabled" $ \interpreter mockServer dbSync -> do
    startDBSync dbSync
    assertJsonColumnTypes dbSync True
    populateJsonPayloads interpreter mockServer dbSync
    void $ readJsonPayloads dbSync
    checkStillRuns dbSync

configRemoveJsonbFromSchemaDisabled :: IOManager -> [(Text, Text)] -> Assertion
configRemoveJsonbFromSchemaDisabled =
  withCustomConfigDropDB initCommandLineArgs (Just configRemoveJsonFromSchemaFalse) conwayConfigDir "conwayConfigRemoveJsonbFromSchemaDisabled" $ \interpreter mockServer dbSync -> do
    startDBSync dbSync
    assertJsonColumnTypes dbSync False
    populateJsonPayloads interpreter mockServer dbSync
    void $ readJsonPayloads dbSync
    checkStillRuns dbSync

-- Populate an existing database before changing its schema, then verify both directions.
-- JSONB may change whitespace and object-key ordering, so compare parsed values, not bytes.
configJsonbInSchemaShouldRemoveThenAdd :: IOManager -> [(Text, Text)] -> Assertion
configJsonbInSchemaShouldRemoveThenAdd =
  withCustomConfigDropDB initCommandLineArgs (Just configRemoveJsonFromSchema) conwayConfigDir "configJsonbInSchemaShouldRemoveThenAdd" $ \interpreter mockServer textEnv -> do
    startDBSync textEnv
    assertJsonColumnTypes textEnv True
    populateJsonPayloads interpreter mockServer textEnv
    before <- readJsonPayloads textEnv
    stopDBSync textEnv

    let cfg = dbSyncConfig textEnv
        jsonbEnv = textEnv {dbSyncConfig = cfg {dncInsertOptions = (dncInsertOptions cfg) {sioRemoveJsonbFromSchema = RemoveJsonbFromSchemaConfig False}}}
    startDBSync jsonbEnv
    assertJsonColumnTypes jsonbEnv False
    -- A persisted height alone could pass while the restarted worker has failed.
    void $ Api.forgeNextFindLeaderAndSubmit interpreter mockServer []
    assertBlockNoBackoff jsonbEnv 5
    afterJsonb <- readJsonPayloads jsonbEnv
    afterJsonb @?= before
    stopDBSync jsonbEnv

    startDBSync textEnv
    assertJsonColumnTypes textEnv True
    void $ Api.forgeNextFindLeaderAndSubmit interpreter mockServer []
    assertBlockNoBackoff textEnv 6
    afterText <- readJsonPayloads textEnv
    afterText @?= before
    checkStillRuns textEnv

assertJsonColumnTypes :: DBSyncEnv -> Bool -> Assertion
assertJsonColumnTypes env removeJsonb =
  assertEqQuery env DB.queryJsonColumnTypes expected "Every JSON payload column must use the configured storage type"
  where
    expected =
      map
        (,if removeJsonb then "varchar" else "jsonb")
        [ "cost_model.costs"
        , "datum.value"
        , "gov_action_proposal.description"
        , "off_chain_pool_data.json"
        , "off_chain_vote_data.json"
        , "redeemer_data.value"
        , "script.json"
        , "tx_metadata.json"
        ]

-- Exercise actual insertion in each schema mode, including JSON strings needing escaping.
-- The Plutus transaction supplies datum/redeemer payloads and a script whose JSON is NULL.
populateJsonPayloads :: Interpreter -> ServerHandle IO CardanoBlock -> DBSyncEnv -> Assertion
populateJsonPayloads interpreter mockServer env = do
  void $ Api.registerAllStakeCreds interpreter mockServer
  void $ Api.withConwayFindLeaderAndSubmitTx interpreter mockServer $ \_ ->
    Right $ Conway.mkAuxDataTx True Conway.mkDummyTxBody (Map.singleton 42 $ S metadataText)
  lockTx <-
    withConwayLedgerState interpreter $
      Conway.mkLockByScriptTx (UTxOIndex 0) [Conway.TxOutInline True Conway.InlineDatum Conway.NoReferenceScript] 20_000 20_000
  void $ Api.forgeNextAndSubmit interpreter mockServer $ MockBlock [TxConway lockTx] (NodeId 1)
  locked <- case Conway.mkUTxOConway lockTx of
    first : _ -> pure first
    [] -> assertFailure "JSON fixture must create a script output"
  void $
    Api.withConwayFindLeaderAndSubmitTx interpreter mockServer $
      Conway.mkUnlockScriptTxBabbage [UTxOPair locked] (UTxOIndex 1) (UTxOIndex 2) [UTxOPair locked] False True 10_000 500
  assertBlockNoBackoff env 4

type JsonPayloads = [(Text, Word64, Maybe Aeson.Value)]

readJsonPayloads :: DBSyncEnv -> IO JsonPayloads
readJsonPayloads env = do
  rows <- queryDBSync env DB.queryJsonPayloads
  values <- forM rows $ \(source, rowId, payload) -> do
    decoded <- case payload of
      Nothing -> pure Nothing
      Just raw -> case Aeson.eitherDecodeStrict' (encodeUtf8 raw) of
        Left err -> assertFailure $ "Invalid stored JSON in " <> show source <> ": " <> err
        Right value -> pure $ Just value
    pure (source, rowId, decoded)
  forM_ ["tx_metadata", "datum", "redeemer_data"] $ \source ->
    assertBool ("Missing non-NULL JSON fixture in " <> show source) $
      any (\(table, _, value) -> table == source && isJust value) values
  assertBool "Escaped metadata JSON must match the inserted value" $
    any (\(table, _, value) -> table == "tx_metadata" && value == Just (Aeson.String metadataText)) values
  assertBool "Plutus script JSON must stay NULL, not become JSON null" $
    any (\(table, _, value) -> table == "script" && isNothing value) values
  pure values

metadataText :: Text
metadataText = "JSON restart: λ, quote \" and slash \\"
