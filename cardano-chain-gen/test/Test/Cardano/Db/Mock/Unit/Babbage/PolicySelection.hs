module Test.Cardano.Db.Mock.Unit.Babbage.PolicySelection (selectedPoliciesCore, selectedPoliciesAddress, selectedPoliciesRollback, unfilteredPolicies, disabledPolicies) where

import Control.Monad (void, when)
import Data.ByteString.Short (toShort)
import Data.List.NonEmpty (NonEmpty (..))
import qualified Data.Map as Map
import Data.Maybe (isJust)
import Data.Text (Text)
import Test.Tasty.HUnit (Assertion)

import qualified Cardano.Db as DB
import Cardano.DbSync.Config.Types (MultiAssetConfig (..), PlutusConfig (..), SyncInsertOptions (..), SyncNodeConfig (..), TxOutConfig (..), UseTxOutAddress (..))
import Cardano.DbSync.Era.Shelley.Generic.Util (unScriptHash)
import Cardano.Ledger.Coin (Coin (..))
import Cardano.Ledger.Mary.Value (MaryValue (..), MultiAsset (..), PolicyID (..))
import Cardano.Mock.ChainSync.Server (IOManager)
import Cardano.Mock.Forging.Tx.Alonzo.ScriptsExamples (alwaysMintScriptHash, alwaysSucceedsScriptHash, assetNames)
import qualified Cardano.Mock.Forging.Tx.Babbage as Babbage
import Cardano.Mock.Forging.Types (UTxOIndex (..))
import Ouroboros.Network.Block (genesisPoint)
import Test.Cardano.Db.Mock.Config (babbageConfigDir, initCommandLineArgs, startDBSync, withCustomConfigDropDB)
import Test.Cardano.Db.Mock.UnifiedApi (rollbackTo, withBabbageFindLeaderAndSubmitTx)
import Test.Cardano.Db.Mock.Validate (assertBlockNoBackoff, assertEqQuery)

-- Mint and output rows must use the same selected policy in both schemas.
selectedPoliciesCore :: IOManager -> [(Text, Text)] -> Assertion
selectedPoliciesCore = selectedPolicies False False selectedPolicy "policySelectionCore"

selectedPoliciesAddress :: IOManager -> [(Text, Text)] -> Assertion
selectedPoliciesAddress = selectedPolicies True False selectedPolicy "policySelectionAddress"

selectedPoliciesRollback :: IOManager -> [(Text, Text)] -> Assertion
selectedPoliciesRollback = selectedPolicies False True selectedPolicy "policySelectionRollback"

unfilteredPolicies :: IOManager -> [(Text, Text)] -> Assertion
unfilteredPolicies = selectedPolicies False False MultiAssetEnable "unfilteredPolicies"

disabledPolicies :: IOManager -> [(Text, Text)] -> Assertion
disabledPolicies = selectedPolicies False False MultiAssetDisable "disabledPolicies"

selectedPolicy :: MultiAssetConfig
selectedPolicy = MultiAssetPolicies (toShort (unScriptHash alwaysMintScriptHash) :| [])

selectedPolicies :: Bool -> Bool -> MultiAssetConfig -> FilePath -> IOManager -> [(Text, Text)] -> Assertion
selectedPolicies addressVariant shouldRollback policyMode label =
  withCustomConfigDropDB initCommandLineArgs (Just selectPolicy) babbageConfigDir label $ \interpreter mockServer dbSync -> do
    startDBSync dbSync
    let forge = void $ withBabbageFindLeaderAndSubmitTx interpreter mockServer $ \st -> do
          let assets = Map.singleton (head assetNames) 1
              minted = MultiAsset $ Map.fromList [(PolicyID alwaysMintScriptHash, assets), (PolicyID alwaysSucceedsScriptHash, assets)]
              output = MaryValue (Coin 10000) minted
          Babbage.mkMAssetsScriptTx [UTxOIndex 0] (UTxOIndex 1) [(UTxOAddressNew 0, output)] [] minted True 100 st
    forge
    assertBlockNoBackoff dbSync 1
    let firstExpected = if policyMode == MultiAssetDisable then (0, 0, 0) else (1, 1, 1)
        secondExpected = if policyMode == MultiAssetEnable then (1, 1, 1) else (0, 0, 0)
    assertEqQuery dbSync (DB.queryPolicyRowCounts $ unScriptHash alwaysMintScriptHash) firstExpected "first policy rows"
    assertEqQuery dbSync (DB.queryPolicyRowCounts $ unScriptHash alwaysSucceedsScriptHash) secondExpected "second policy rows"
    assertEqQuery dbSync (isJust <$> DB.queryScriptWithId (unScriptHash alwaysMintScriptHash)) True "selected script retained"
    assertEqQuery dbSync (isJust <$> DB.queryScriptWithId (unScriptHash alwaysSucceedsScriptHash)) False "unselected script omitted"
    assertEqQuery dbSync DB.queryRedeemerCount 2 "redeemers remain intact for both scripts"
    when shouldRollback $ do
      void $ rollbackTo interpreter mockServer genesisPoint
      forge
      assertBlockNoBackoff dbSync 2
      assertEqQuery dbSync (DB.queryPolicyRowCounts $ unScriptHash alwaysMintScriptHash) firstExpected "selected policy rows after replay"
      assertEqQuery dbSync (DB.queryPolicyRowCounts $ unScriptHash alwaysSucceedsScriptHash) secondExpected "unselected policy rows after replay"
      assertEqQuery dbSync DB.queryRedeemerCount 2 "redeemers remain intact after replay"
  where
    selectPolicy cfg =
      cfg {dncInsertOptions = (dncInsertOptions cfg) {sioMultiAsset = policyMode, sioPlutus = PlutusScripts (toShort (unScriptHash alwaysMintScriptHash) :| []), sioTxOut = TxOutEnable (UseTxOutAddress addressVariant)}}
