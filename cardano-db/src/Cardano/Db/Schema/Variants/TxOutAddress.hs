{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}

module Cardano.Db.Schema.Variants.TxOutAddress where

import Contravariant.Extras (contrazip3, contrazip9)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant ((>$<))
import qualified Data.List.NonEmpty as NE
import Data.Text (Text)
import Data.Word (Word64)
import GHC.Generics (Generic)
import qualified Hasql.Decoders as D
import qualified Hasql.Encoders as E

import qualified Cardano.Db.Schema.Ids as Id
import Cardano.Db.Schema.Types (textDecoder)
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Cardano.Db.Types (DbLovelace, DbWord64 (..), dbLovelaceDecoder, dbLovelaceEncoder, dbLovelaceValueEncoder, dbWord64ValueEncoder)

-- |
-- Table Name: tx_out
-- Description: Represents the outputs of transactions, including addresses and values.
-- Schema reference for @tx_out@:
-- A table for transaction outputs.
data TxOutAddress = TxOutAddress
  { txOutAddressTxId :: !Id.TxId
  -- ^ The Tx table index of the transaction that contains this transaction output.
  , txOutAddressIndex :: !Word64
  -- ^ The index of this transaction output with the transaction.
  , txOutAddressStakeAddressId :: !(Maybe Id.StakeAddressId)
  , txOutAddressValue :: !DbLovelace
  -- ^ The output value (in Lovelace) of the transaction output.
  , txOutAddressDataHash :: !(Maybe ByteString)
  -- ^ The hash of the transaction output datum. (NULL for Txs without scripts).
  , txOutAddressInlineDatumId :: !(Maybe Id.DatumId)
  -- ^ The inline datum of the output, if it has one. New in v13.
  , txOutAddressReferenceScriptId :: !(Maybe Id.ScriptId)
  -- ^ The reference script of the output, if it has one. New in v13.
  , txOutAddressConsumedByTxId :: !(Maybe Id.TxId)
  -- ^ The Tx table index of the transaction that consumes this transaction output. Not populated by
  -- default, can be activated via tx-out configs.
  , txOutAddressAddressId :: !Id.AddressId
  -- ^ The Address table index for the output address.
  }
  deriving (Eq, Show, Generic)

type instance Key TxOutAddress = Id.TxOutAddressId

instance DbInfo TxOutAddress where
  tableName _ = "tx_out"
  unnestParamTypes _ =
    [ ("tx_id", "bigint[]")
    , ("index", "bigint[]")
    , ("stake_address_id", "bigint[]")
    , ("value", "numeric[]")
    , ("data_hash", "bytea[]")
    , ("inline_datum_id", "bigint[]")
    , ("reference_script_id", "bigint[]")
    , ("consumed_by_tx_id", "bigint[]")
    , ("address_id", "bigint[]")
    ]
  columnNames _ =
    NE.fromList
      [ "tx_id"
      , "index"
      , "stake_address_id"
      , "value"
      , "data_hash"
      , "inline_datum_id"
      , "reference_script_id"
      , "consumed_by_tx_id"
      , "address_id"
      ]

entityTxOutAddressDecoder :: D.Row (Entity TxOutAddress)
entityTxOutAddressDecoder =
  Entity
    <$> Id.idDecoder Id.TxOutAddressId
    <*> txOutAddressDecoder

txOutAddressDecoder :: D.Row TxOutAddress
txOutAddressDecoder =
  TxOutAddress
    <$> Id.idDecoder Id.TxId -- txOutAddressTxId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- txOutAddressIndex
    <*> Id.maybeIdDecoder Id.StakeAddressId -- txOutAddressStakeAddressId
    <*> dbLovelaceDecoder -- txOutAddressValue
    <*> D.column (D.nullable D.bytea) -- txOutAddressDataHash
    <*> Id.maybeIdDecoder Id.DatumId -- txOutAddressInlineDatumId
    <*> Id.maybeIdDecoder Id.ScriptId -- txOutAddressReferenceScriptId
    <*> Id.maybeIdDecoder Id.TxId -- txOutAddressConsumedByTxId
    <*> Id.idDecoder Id.AddressId -- txOutAddressAddressId

txOutAddressEncoder :: E.Params TxOutAddress
txOutAddressEncoder =
  mconcat
    [ txOutAddressTxId >$< Id.idEncoder Id.getTxId
    , txOutAddressIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , txOutAddressStakeAddressId >$< Id.maybeIdEncoder Id.getStakeAddressId
    , txOutAddressValue >$< dbLovelaceEncoder
    , txOutAddressDataHash >$< E.param (E.nullable E.bytea)
    , txOutAddressInlineDatumId >$< Id.maybeIdEncoder Id.getDatumId
    , txOutAddressReferenceScriptId >$< Id.maybeIdEncoder Id.getScriptId
    , txOutAddressConsumedByTxId >$< Id.maybeIdEncoder Id.getTxId
    , txOutAddressAddressId >$< Id.idEncoder Id.getAddressId
    ]

txOutAddressBulkEncoder :: E.Params ([Id.TxId], [Word64], [Maybe Id.StakeAddressId], [DbLovelace], [Maybe ByteString], [Maybe Id.DatumId], [Maybe Id.ScriptId], [Maybe Id.TxId], [Id.AddressId])
txOutAddressBulkEncoder =
  contrazip9
    (bulkEncoder $ E.nonNullable $ Id.getTxId >$< E.int8) -- txOutAddressTxId
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8) -- txOutAddressIndex
    (bulkEncoder $ E.nullable $ Id.getStakeAddressId >$< E.int8) -- txOutAddressStakeAddressId
    (bulkEncoder dbLovelaceValueEncoder) -- txOutAddressValue
    (bulkEncoder $ E.nullable E.bytea) -- txOutAddressDataHash
    (bulkEncoder $ E.nullable $ Id.getDatumId >$< E.int8) -- txOutAddressInlineDatumId
    (bulkEncoder $ E.nullable $ Id.getScriptId >$< E.int8) -- txOutAddressReferenceScriptId
    (bulkEncoder $ E.nullable $ Id.getTxId >$< E.int8) -- txOutAddressConsumedByTxId
    (bulkEncoder $ E.nonNullable $ Id.getAddressId >$< E.int8) -- txOutAddressAddressId

-- |
-- Table Name: collateral_tx_out
-- Description: Represents collateral transaction outputs, which are used to cover transaction fees in case of failure.
-- Schema reference for @collateral_tx_out@:
-- A table for transaction collateral outputs. New in v13.
data CollateralTxOutAddress = CollateralTxOutAddress
  { collateralTxOutAddressTxId :: !Id.TxId
  -- ^ The Tx table index of the transaction that contains this collateral output.
  , collateralTxOutAddressIndex :: !Word64
  -- ^ The index of this transaction output with the transaction.
  , collateralTxOutAddressStakeAddressId :: !(Maybe Id.StakeAddressId)
  -- ^ The StakeAddress table index for the stake address part of the Shelley address. (NULL for Byron
  -- addresses).
  , collateralTxOutAddressValue :: !DbLovelace
  -- ^ The output value (in Lovelace) of the transaction output.
  , collateralTxOutAddressDataHash :: !(Maybe ByteString)
  -- ^ The hash of the transaction output datum. (NULL for Txs without scripts).
  , collateralTxOutAddressMultiAssetsDescr :: !Text
  -- ^ This is a description of the multiassets in collateral output. Since the output is not really
  -- created, we don't need to add them in separate tables.
  , collateralTxOutAddressInlineDatumId :: !(Maybe Id.DatumId)
  -- ^ The inline datum of the output, if it has one. New in v13.
  , collateralTxOutAddressReferenceScriptId :: !(Maybe Id.ScriptId)
  -- ^ The reference script of the output, if it has one. New in v13.
  , collateralTxOutAddressAddressId :: !Id.AddressId
  -- ^ The Address table index for the output address.
  }
  deriving (Eq, Show, Generic)

type instance Key CollateralTxOutAddress = Id.CollateralTxOutAddressId

instance DbInfo CollateralTxOutAddress where
  tableName _ = "collateral_tx_out"
  columnNames _ =
    NE.fromList
      [ "tx_id"
      , "index"
      , "stake_address_id"
      , "value"
      , "data_hash"
      , "multi_assets_descr"
      , "inline_datum_id"
      , "reference_script_id"
      , "address_id"
      ]

collateralTxOutAddressEncoder :: E.Params CollateralTxOutAddress
collateralTxOutAddressEncoder =
  mconcat
    [ collateralTxOutAddressTxId >$< Id.idEncoder Id.getTxId
    , collateralTxOutAddressIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , collateralTxOutAddressStakeAddressId >$< Id.maybeIdEncoder Id.getStakeAddressId
    , collateralTxOutAddressValue >$< dbLovelaceEncoder
    , collateralTxOutAddressDataHash >$< E.param (E.nullable E.bytea)
    , collateralTxOutAddressMultiAssetsDescr >$< E.param (E.nonNullable E.text)
    , collateralTxOutAddressInlineDatumId >$< Id.maybeIdEncoder Id.getDatumId
    , collateralTxOutAddressReferenceScriptId >$< Id.maybeIdEncoder Id.getScriptId
    , collateralTxOutAddressAddressId >$< Id.idEncoder Id.getAddressId
    ]

-- |
-- Table Name: address
-- Description: Represents addresses used in transactions, including their raw representation and associated scripts.
-- Schema reference for @address@:
-- A table for addresses that appear in outputs.
data Address = Address
  { addressAddress :: !Text
  -- ^ The human readable encoding of the output address. Will be Base58 for Byron era addresses and
  -- Bech32 for Shelley era.
  , addressRaw :: !ByteString
  -- ^ The raw binary address.
  , addressHasScript :: !Bool
  -- ^ Flag which shows if this address is locked by a script.
  , addressPaymentCred :: !(Maybe ByteString)
  -- ^ The payment credential part of the Shelley address. (NULL for Byron addresses). For a
  -- script-locked address, this is the script hash.
  , addressStakeAddressId :: !(Maybe Id.StakeAddressId)
  -- ^ The StakeAddress table index for the stake address part of the Shelley address. (NULL for Byron
  -- addresses).
  }
  deriving (Eq, Show, Generic)

type instance Key Address = Id.AddressId
instance DbInfo Address

entityAddressDecoder :: D.Row (Entity Address)
entityAddressDecoder =
  Entity
    <$> Id.idDecoder Id.AddressId
    <*> addressDecoder

addressDecoder :: D.Row Address
addressDecoder =
  Address
    <$> D.column (D.nonNullable textDecoder) -- addressAddress
    <*> D.column (D.nonNullable D.bytea) -- addressRaw
    <*> D.column (D.nonNullable D.bool) -- addressHasScript
    <*> D.column (D.nullable D.bytea) -- addressPaymentCred
    <*> Id.maybeIdDecoder Id.StakeAddressId -- addressStakeAddressId

addressEncoder :: E.Params Address
addressEncoder =
  mconcat
    [ addressAddress >$< E.param (E.nonNullable E.text)
    , addressRaw >$< E.param (E.nonNullable E.bytea)
    , addressHasScript >$< E.param (E.nonNullable E.bool)
    , addressPaymentCred >$< E.param (E.nullable E.bytea)
    , addressStakeAddressId >$< Id.maybeIdEncoder Id.getStakeAddressId
    ]

-- |
-- Table Name: ma_tx_out
-- Description: Represents multi-asset transaction outputs, which include various assets and their quantities.
-- Schema reference for @ma_tx_out@:
-- A table containing Multi-Asset transaction outputs.
data MaTxOutAddress = MaTxOutAddress
  { maTxOutAddressIdent :: !Id.MultiAssetId
  -- ^ The Multi Asset transaction output amount (denominated in the Multi Asset).
  , maTxOutAddressQuantity :: !DbWord64
  -- ^ The TxOut table index for the transaction that this Multi Asset transaction output.
  , maTxOutAddressTxOutId :: !Id.TxOutAddressId
  -- ^ The MultiAsset table index specifying the asset.
  }
  deriving (Eq, Show, Generic)

type instance Key MaTxOutAddress = Id.MaTxOutAddressId

instance DbInfo MaTxOutAddress where
  tableName _ = "ma_tx_out"
  columnNames _ = NE.fromList ["quantity", "tx_out_id", "ident"]
  unnestParamTypes _ = [("ident", "bigint[]"), ("quantity", "numeric[]"), ("tx_out_id", "bigint[]")]

maTxOutAddressBulkEncoder :: E.Params ([DbWord64], [Id.TxOutAddressId], [Id.MultiAssetId])
maTxOutAddressBulkEncoder =
  contrazip3
    (bulkEncoder $ E.nonNullable dbWord64ValueEncoder) -- maTxOutAddressQuantity
    (bulkEncoder $ E.nonNullable $ Id.getTxOutAddressId >$< E.int8) -- maTxOutAddressTxOutId
    (bulkEncoder $ E.nonNullable $ Id.getMultiAssetId >$< E.int8) -- maTxOutMultiAssetIdent
