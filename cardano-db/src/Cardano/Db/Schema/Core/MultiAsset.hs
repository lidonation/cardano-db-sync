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

module Cardano.Db.Schema.Core.MultiAsset where

import Contravariant.Extras (contrazip3)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant ((>$<))
import Data.Text (Text)
import GHC.Generics (Generic)
import Hasql.Encoders as E

import Cardano.Db.Schema.Ids
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Key)
import Cardano.Db.Types (DbInt65, dbInt65Encoder)

-----------------------------------------------------------------------------------------------------------------------------------
-- MULTI ASSETS
-- These tables manage governance-related data, including DReps, committees, and voting procedures.
-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: multi_asset
-- Description: Contains information about multi-assets, including the policy and name of the asset.
-- Schema reference for @multi_asset@:
-- A table containing all the unique policy/name pairs along with a CIP14 asset fingerprint
data MultiAsset = MultiAsset
  { multiAssetPolicy :: !ByteString -- sqltype=hash28type

  -- ^ The MultiAsset policy hash.
  , multiAssetName :: !ByteString -- sqltype=asset32type

  -- ^ The MultiAsset name.
  , multiAssetFingerprint :: !Text
  -- ^ The CIP14 fingerprint for the MultiAsset.
  }
  deriving (Eq, Show, Generic)

type instance Key MultiAsset = MultiAssetId
instance DbInfo MultiAsset where
  uniqueFields _ = ["policy", "name"]

multiAssetEncoder :: E.Params MultiAsset
multiAssetEncoder =
  mconcat
    [ multiAssetPolicy >$< E.param (E.nonNullable E.bytea)
    , multiAssetName >$< E.param (E.nonNullable E.bytea)
    , multiAssetFingerprint >$< E.param (E.nonNullable E.text)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: ma_tx_mint
-- Description: Contains information about the minting of multi-assets, including the quantity of the asset and the transaction in which it was minted.
-- Schema reference for @ma_tx_mint@:
-- A table containing Multi-Asset mint events.
data MaTxMint = MaTxMint
  { maTxMintQuantity :: !DbInt65 -- sqltype=int65type

  -- ^ The amount of the Multi Asset to mint (can be negative to "burn" assets).
  , maTxMintTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction that contains this minting event.
  , maTxMintIdent :: !MultiAssetId -- noreference

  -- ^ The MultiAsset table index specifying the asset.
  }
  deriving (Eq, Show, Generic)

type instance Key MaTxMint = MaTxMintId

instance DbInfo MaTxMint where
  unnestParamTypes _ =
    [ ("quantity", "bigint[]")
    , ("tx_id", "bigint[]")
    , ("ident", "bigint[]")
    ]

maTxMintBulkEncoder :: E.Params ([DbInt65], [TxId], [MultiAssetId])
maTxMintBulkEncoder =
  contrazip3
    (bulkEncoder $ E.nonNullable dbInt65Encoder)
    (bulkEncoder $ E.nonNullable $ getTxId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ getMultiAssetId >$< E.int8)
