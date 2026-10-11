{-# LANGUAGE DeriveGeneric #-}

module Sample where

-- A record with every shape the schema modules use.
data SampleBlock = SampleBlock -- trailing comment on the header
  { sampleBlockHash :: !ByteString -- sqltype=hash32type
  , sampleBlockEpochNo :: !(Maybe Word64) -- sqltype=word31type
  -- Shelley specific
  , sampleBlockVrfKey :: !(Maybe Text)
  , sampleBlockTxCount :: !Word64
  }
  deriving (Eq, Show, Generic)

instance DbInfo SampleBlock where
  uniqueFields _ = ["hash"]

newtype Delisted = Delisted
  { delistedHashRaw :: ByteString -- sqltype=hash28type
  }
  deriving (Eq, Show, Generic)

instance DbInfo Delisted

data MaTxOutSample = MaTxOutSample
  { maTxOutSampleQuantity :: !DbWord64
  , maTxOutSampleTxOutId :: !Id.TxOutId
  }

instance DbInfo MaTxOutSample where
  tableName _ = "ma_tx_out"
  columnNames _ = NE.fromList ["quantity", "tx_out_id"]

-- Not a table: a sum type.
data Kind = KindA | KindB

alterQuery =
  Text.unlines
    [ "ALTER TABLE \"tx_out\""
    , "  DROP COLUMN \"address\""
    ]

singleQuery =
  "CREATE INDEX IF NOT EXISTS idx ON t(c);"
