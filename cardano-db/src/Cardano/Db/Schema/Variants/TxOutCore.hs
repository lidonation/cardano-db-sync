{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}

module Cardano.Db.Schema.Variants.TxOutCore where

import qualified Cardano.Db.Schema.Ids as Id
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Cardano.Db.Types (DbLovelace, DbWord64 (..), dbLovelaceDecoder, dbLovelaceEncoder, dbLovelaceValueEncoder, dbWord64Decoder, dbWord64ValueEncoder)
import Contravariant.Extras (contrazip11, contrazip3)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant ((>$<))
import qualified Data.List.NonEmpty as NE
import Data.Text (Text)
import Data.Word (Word64)
import GHC.Generics (Generic)
import qualified Hasql.Decoders as D
import qualified Hasql.Encoders as E

-- |
-- Table Name: tx_out
-- Description: Represents a transaction output in the Cardano blockchain.
-- Schema reference for @tx_out@:
-- A table for transaction outputs.
data TxOutCore = TxOutCore
  { txOutCoreTxId :: !Id.TxId
  -- ^ The Tx table index of the transaction that contains this transaction output.
  , txOutCoreIndex :: !Word64
  -- ^ The index of this transaction output with the transaction.
  , txOutCoreAddress :: !Text
  -- ^ The human readable encoding of the output address. Will be Base58 for Byron era addresses and
  -- Bech32 for Shelley era.
  , txOutCoreAddressHasScript :: !Bool
  -- ^ Flag which shows if this address is locked by a script.
  , txOutCorePaymentCred :: !(Maybe ByteString)
  -- ^ The payment credential part of the Shelley address. (NULL for Byron addresses). For a
  -- script-locked address, this is the script hash.
  , txOutCoreStakeAddressId :: !(Maybe Id.StakeAddressId)
  -- ^ The StakeAddress table index for the stake address part of the Shelley address. (NULL for Byron
  -- addresses).
  , txOutCoreValue :: !DbLovelace
  -- ^ The output value (in Lovelace) of the transaction output.
  , txOutCoreDataHash :: !(Maybe ByteString)
  -- ^ The hash of the transaction output datum. (NULL for Txs without scripts).
  , txOutCoreInlineDatumId :: !(Maybe Id.DatumId)
  -- ^ The inline datum of the output, if it has one. New in v13.
  , txOutCoreReferenceScriptId :: !(Maybe Id.ScriptId)
  -- ^ The reference script of the output, if it has one. New in v13.
  , txOutCoreConsumedByTxId :: !(Maybe Id.TxId)
  -- ^ The Tx table index of the transaction that consumes this transaction output. Not populated by
  -- default, can be activated via tx-out configs.
  }
  deriving (Eq, Show, Generic)

type instance Key TxOutCore = Id.TxOutCoreId

instance DbInfo TxOutCore where
  tableName _ = "tx_out"
  columnNames _ =
    NE.fromList
      [ "tx_id"
      , "index"
      , "address"
      , "address_has_script"
      , "payment_cred"
      , "stake_address_id"
      , "value"
      , "data_hash"
      , "inline_datum_id"
      , "reference_script_id"
      , "consumed_by_tx_id"
      ]
  unnestParamTypes _ =
    [ ("tx_id", "bigint[]")
    , ("index", "bigint[]")
    , ("address", "text[]")
    , ("address_has_script", "boolean[]")
    , ("payment_cred", "bytea[]")
    , ("stake_address_id", "bigint[]")
    , ("value", "numeric[]")
    , ("data_hash", "bytea[]")
    , ("inline_datum_id", "bigint[]")
    , ("reference_script_id", "bigint[]")
    , ("consumed_by_tx_id", "bigint[]")
    ]

entityTxOutCoreDecoder :: D.Row (Entity TxOutCore)
entityTxOutCoreDecoder =
  Entity
    <$> Id.idDecoder Id.TxOutCoreId
    <*> txOutCoreDecoder

txOutCoreDecoder :: D.Row TxOutCore
txOutCoreDecoder =
  TxOutCore
    <$> Id.idDecoder Id.TxId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8)
    <*> D.column (D.nonNullable D.text)
    <*> D.column (D.nonNullable D.bool)
    <*> D.column (D.nullable D.bytea)
    <*> Id.maybeIdDecoder Id.StakeAddressId
    <*> dbLovelaceDecoder
    <*> D.column (D.nullable D.bytea)
    <*> Id.maybeIdDecoder Id.DatumId
    <*> Id.maybeIdDecoder Id.ScriptId
    <*> Id.maybeIdDecoder Id.TxId

txOutCoreEncoder :: E.Params TxOutCore
txOutCoreEncoder =
  mconcat
    [ txOutCoreTxId >$< Id.idEncoder Id.getTxId
    , txOutCoreIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , txOutCoreAddress >$< E.param (E.nonNullable E.text)
    , txOutCoreAddressHasScript >$< E.param (E.nonNullable E.bool)
    , txOutCorePaymentCred >$< E.param (E.nullable E.bytea)
    , txOutCoreStakeAddressId >$< Id.maybeIdEncoder Id.getStakeAddressId
    , txOutCoreValue >$< dbLovelaceEncoder
    , txOutCoreDataHash >$< E.param (E.nullable E.bytea)
    , txOutCoreInlineDatumId >$< Id.maybeIdEncoder Id.getDatumId
    , txOutCoreReferenceScriptId >$< Id.maybeIdEncoder Id.getScriptId
    , txOutCoreConsumedByTxId >$< Id.maybeIdEncoder Id.getTxId
    ]

txOutCoreBulkEncoder :: E.Params ([Id.TxId], [Word64], [Text], [Bool], [Maybe ByteString], [Maybe Id.StakeAddressId], [DbLovelace], [Maybe ByteString], [Maybe Id.DatumId], [Maybe Id.ScriptId], [Maybe Id.TxId])
txOutCoreBulkEncoder =
  contrazip11
    (bulkEncoder $ E.nonNullable $ Id.getTxId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)
    (bulkEncoder $ E.nonNullable E.text)
    (bulkEncoder $ E.nonNullable E.bool)
    (bulkEncoder $ E.nullable E.bytea)
    (bulkEncoder $ E.nullable $ Id.getStakeAddressId >$< E.int8)
    (bulkEncoder dbLovelaceValueEncoder)
    (bulkEncoder $ E.nullable E.bytea)
    (bulkEncoder $ E.nullable $ Id.getDatumId >$< E.int8)
    (bulkEncoder $ E.nullable $ Id.getScriptId >$< E.int8)
    (bulkEncoder $ E.nullable $ Id.getTxId >$< E.int8)

-- |
-- Table Name: collateral_tx_out
-- Description: Represents a collateral transaction output in the Cardano blockchain.
-- Schema reference for @collateral_tx_out@:
-- A table for transaction collateral outputs. New in v13.
data CollateralTxOutCore = CollateralTxOutCore
  { collateralTxOutCoreTxId :: !Id.TxId
  -- ^ The Tx table index of the transaction that contains this transaction output.
  , collateralTxOutCoreIndex :: !Word64
  -- ^ The index of this transaction output with the transaction.
  , collateralTxOutCoreAddress :: !Text
  -- ^ The human readable encoding of the output address. Will be Base58 for Byron era addresses and
  -- Bech32 for Shelley era.
  , collateralTxOutCoreAddressHasScript :: !Bool
  -- ^ Flag which shows if this address is locked by a script.
  , collateralTxOutCorePaymentCred :: !(Maybe ByteString)
  -- ^ The payment credential part of the Shelley address. (NULL for Byron addresses). For a
  -- script-locked address, this is the script hash.
  , collateralTxOutCoreStakeAddressId :: !(Maybe Id.StakeAddressId)
  -- ^ The StakeAddress table index for the stake address part of the Shelley address. (NULL for Byron
  -- addresses).
  , collateralTxOutCoreValue :: !DbLovelace
  -- ^ The output value (in Lovelace) of the transaction output.
  , collateralTxOutCoreDataHash :: !(Maybe ByteString)
  -- ^ The hash of the transaction output datum. (NULL for Txs without scripts).
  , collateralTxOutCoreMultiAssetsDescr :: !Text
  -- ^ This is a description of the multiassets in collateral output. Since the output is not really
  -- created, we don't need to add them in separate tables.
  , collateralTxOutCoreInlineDatumId :: !(Maybe Id.DatumId)
  -- ^ The inline datum of the output, if it has one. New in v13.
  , collateralTxOutCoreReferenceScriptId :: !(Maybe Id.ScriptId)
  -- ^ The reference script of the output, if it has one. New in v13.
  }
  deriving (Eq, Show, Generic)

type instance Key CollateralTxOutCore = Id.CollateralTxOutCoreId

instance DbInfo CollateralTxOutCore where
  tableName _ = "collateral_tx_out"
  columnNames _ =
    NE.fromList
      [ "tx_id"
      , "index"
      , "address"
      , "address_has_script"
      , "payment_cred"
      , "stake_address_id"
      , "value"
      , "data_hash"
      , "multi_assets_descr"
      , "inline_datum_id"
      , "reference_script_id"
      ]

collateralTxOutCoreEncoder :: E.Params CollateralTxOutCore
collateralTxOutCoreEncoder =
  mconcat
    [ collateralTxOutCoreTxId >$< Id.idEncoder Id.getTxId
    , collateralTxOutCoreIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , collateralTxOutCoreAddress >$< E.param (E.nonNullable E.text)
    , collateralTxOutCoreAddressHasScript >$< E.param (E.nonNullable E.bool)
    , collateralTxOutCorePaymentCred >$< E.param (E.nullable E.bytea)
    , collateralTxOutCoreStakeAddressId >$< Id.maybeIdEncoder Id.getStakeAddressId
    , collateralTxOutCoreValue >$< dbLovelaceEncoder
    , collateralTxOutCoreDataHash >$< E.param (E.nullable E.bytea)
    , collateralTxOutCoreMultiAssetsDescr >$< E.param (E.nonNullable E.text)
    , collateralTxOutCoreInlineDatumId >$< Id.maybeIdEncoder Id.getDatumId
    , collateralTxOutCoreReferenceScriptId >$< Id.maybeIdEncoder Id.getScriptId
    ]

-- |
-- Table Name: ma_tx_out
-- Description: Represents a multi-asset transaction output in the Cardano blockchain.
-- Schema reference for @ma_tx_out@:
-- A table containing Multi-Asset transaction outputs.
data MaTxOutCore = MaTxOutCore
  { maTxOutCoreQuantity :: !DbWord64
  -- ^ The Multi Asset transaction output amount (denominated in the Multi Asset).
  , maTxOutCoreTxOutId :: !Id.TxOutCoreId
  -- ^ The TxOut table index for the transaction that this Multi Asset transaction output.
  , maTxOutCoreIdent :: !Id.MultiAssetId
  -- ^ The MultiAsset table index specifying the asset.
  }
  deriving (Eq, Show, Generic)

type instance Key MaTxOutCore = Id.MaTxOutCoreId

instance DbInfo MaTxOutCore where
  tableName _ = "ma_tx_out"
  columnNames _ =
    NE.fromList
      [ "quantity"
      , "tx_out_id"
      , "ident"
      ]
  unnestParamTypes _ = [("quantity", "numeric[]"), ("tx_out_id", "bigint[]"), ("ident", "bigint[]")]

maTxOutCoreDecoder :: D.Row MaTxOutCore
maTxOutCoreDecoder =
  MaTxOutCore
    <$> dbWord64Decoder -- maTxOutCoreQuantity
    <*> Id.idDecoder Id.TxOutCoreId -- maTxOutCoreTxOutId
    <*> Id.idDecoder Id.MultiAssetId -- maTxOutCoreIdent

maTxOutCoreBulkEncoder :: E.Params ([DbWord64], [Id.TxOutCoreId], [Id.MultiAssetId])
maTxOutCoreBulkEncoder =
  contrazip3
    (bulkEncoder $ E.nonNullable dbWord64ValueEncoder)
    (bulkEncoder $ E.nonNullable $ Id.getTxOutCoreId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ Id.getMultiAssetId >$< E.int8)
