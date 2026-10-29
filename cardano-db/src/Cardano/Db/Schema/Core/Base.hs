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

module Cardano.Db.Schema.Core.Base where

import Contravariant.Extras (contrazip4)
import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant
import Data.Int (Int64)
import Data.Text (Text)
import Data.Time.Clock (UTCTime)
import Data.Word (Word16, Word64)
import GHC.Generics (Generic)
import Hasql.Decoders as D
import Hasql.Encoders as E

import Cardano.Db.Schema.Ids
import qualified Cardano.Db.Schema.Ids as Id
import Cardano.Db.Schema.Types (utcTimeAsTimestampDecoder, utcTimeAsTimestampEncoder)
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Cardano.Db.Types (
  DbLovelace (..),
  DbWord64 (..),
  ScriptPurpose,
  ScriptType,
  dbLovelaceDecoder,
  dbLovelaceEncoder,
  dbWord64ValueEncoder,
  maybeDbWord64Decoder,
  maybeDbWord64Encoder,
  scriptPurposeEncoder,
  scriptTypeEncoder,
 )

-- We use camelCase here in the Haskell schema definition and 'persistLowerCase'
-- specifies that all the table and column names are converted to lower snake case.

-- All NULL-able fields other than 'epochNo' are NULL for EBBs, whereas 'epochNo' is
-- only NULL for the genesis block.

-----------------------------------------------------------------------------------------------------------------------------------
-- BASE TABLES
-- These tables store fundamental blockchain data, such as blocks, transactions, and UTXOs.
-----------------------------------------------------------------------------------------------------------------------------------

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: block
-- Description: Stores information about individual blocks in the blockchain, including their hash, size,
--   and the transactions they contain.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @block@:
-- A table for blocks on the chain.
data Block = Block
  { blockHash :: !ByteString -- sqltype=hash32type

  -- ^ The hash identifier of the block.
  , blockEpochNo :: !(Maybe Word64) -- sqltype=word31type

  -- ^ The epoch number.
  , blockSlotNo :: !(Maybe Word64) -- sqltype=word63type

  -- ^ The slot number.
  , blockEpochSlotNo :: !(Maybe Word64) -- sqltype=word31type

  -- ^ The slot number within an epoch (resets to zero at the start of each epoch).
  , blockBlockNo :: !(Maybe Word64) -- sqltype=word31type

  -- ^ The block number.
  , blockPreviousId :: !(Maybe BlockId) -- noreference

  -- ^ The Block table index of the previous block.
  , blockSlotLeaderId :: !SlotLeaderId -- noreference

  -- ^ The SlotLeader table index of the creator of this block.
  , blockSize :: !Word64 -- sqltype=word31type

  -- ^ The block size (in bytes). Note, this size value is not expected to be the same as the sum of
  -- the tx sizes due to the fact that txs being stored in segwit format and oddities in the CBOR
  -- encoding.
  , blockTime :: !UTCTime -- sqltype=timestamp

  -- ^ The block time (UTCTime).
  , blockTxCount :: !Word64
  -- ^ The number of transactions in this block.
  , blockProtoMajor :: !Word16 -- sqltype=word31type

  -- ^ The block's major protocol number.
  , blockProtoMinor :: !Word16 -- sqltype=word31type

  -- ^ The block's minor protocol number.
  , blockVrfKey :: !(Maybe Text) -- Shelley specific

  -- ^ The VRF key of the creator of this block.
  , blockOpCert :: !(Maybe ByteString) -- sqltype=hash32type

  -- ^ The raw KES hot verification key from the block producer's operational certificate.
  , blockOpCertCounter :: !(Maybe Word64) -- sqltype=hash63type

  -- ^ The value of the counter used to produce the operational certificate.
  }
  deriving (Eq, Show, Generic)

type instance Key Block = BlockId
instance DbInfo Block where
  uniqueFields _ = ["hash"]

entityBlockDecoder :: D.Row (Entity Block)
entityBlockDecoder =
  Entity
    <$> idDecoder BlockId
    <*> blockDecoder

blockDecoder :: D.Row Block
blockDecoder =
  Block
    <$> D.column (D.nonNullable D.bytea) -- blockHash
    <*> D.column (D.nullable $ fromIntegral <$> D.int8) -- blockEpochNo
    <*> D.column (D.nullable $ fromIntegral <$> D.int8) -- blockSlotNo
    <*> D.column (D.nullable $ fromIntegral <$> D.int8) -- blockEpochSlotNo
    <*> D.column (D.nullable $ fromIntegral <$> D.int8) -- blockBlockNo
    <*> maybeIdDecoder BlockId -- blockPreviousId
    <*> idDecoder SlotLeaderId -- blockSlotLeaderId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- blockSize
    <*> D.column (D.nonNullable utcTimeAsTimestampDecoder) -- blockTime
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- blockTxCount
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int2) -- blockProtoMajor
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int2) -- blockProtoMinor
    <*> D.column (D.nullable D.text) -- blockVrfKey
    <*> D.column (D.nullable D.bytea) -- blockOpCert
    <*> D.column (D.nullable $ fromIntegral <$> D.int8) -- blockOpCertCounter

blockEncoder :: E.Params Block
blockEncoder =
  mconcat
    [ blockHash >$< E.param (E.nonNullable E.bytea)
    , blockEpochNo >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , blockSlotNo >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , blockEpochSlotNo >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , blockBlockNo >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , blockPreviousId >$< maybeIdEncoder getBlockId
    , blockSlotLeaderId >$< idEncoder getSlotLeaderId
    , blockSize >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , blockTime >$< E.param (E.nonNullable utcTimeAsTimestampEncoder)
    , blockTxCount >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , blockProtoMajor >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , blockProtoMinor >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , blockVrfKey >$< E.param (E.nullable E.text)
    , blockOpCert >$< E.param (E.nullable E.bytea)
    , blockOpCertCounter >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @tx@:
-- A table for transactions within a block on the chain.
data Tx = Tx
  { txHash :: !ByteString -- sqltype=hash32type

  -- ^ The hash identifier of the transaction.
  , txBlockId :: !BlockId -- noreference -- This type is the primary key for the 'block' table.

  -- ^ The Block table index of the block that contains this transaction.
  , txBlockIndex :: !Word64 -- sqltype=word31type -- The index of this transaction within the block.

  -- ^ The index of this transaction with the block (zero based).
  , txOutSum :: !DbLovelace -- sqltype=lovelace

  -- ^ The sum of the transaction outputs (in Lovelace).
  , txFee :: !DbLovelace -- sqltype=lovelace

  -- ^ The fees paid for this transaction.
  , txDeposit :: !(Maybe Int64) -- Needs to allow negaitve values.

  -- ^ Deposit (or deposit refund) in this transaction. Deposits are positive, refunds negative.
  , txSize :: !Word64 -- sqltype=word31type

  -- ^ The size of the transaction in bytes.
  , txInvalidBefore :: !(Maybe DbWord64) -- sqltype=word64type -- New for Allega

  -- ^ Transaction in invalid before this slot number.
  , txInvalidHereafter :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Transaction in invalid at or after this slot number.
  , txValidContract :: !Bool -- False if the contract is invalid, True otherwise. -- New for Alonzo

  -- ^ False if the contract is invalid. True if the contract is valid or there is no contract.
  , txScriptSize :: !Word64 -- sqltype=word31type

  -- ^ The sum of the script sizes (in bytes) of scripts in the transaction.
  , txTreasuryDonation :: !DbLovelace -- sqltype=lovelace default=0 -- New for Conway
  }
  deriving (Show, Eq, Generic)

type instance Key Tx = TxId
instance DbInfo Tx where
  uniqueFields _ = ["hash"]

entityTxDecoder :: D.Row (Entity Tx)
entityTxDecoder =
  Entity
    <$> idDecoder TxId
    <*> txDecoder

txDecoder :: D.Row Tx
txDecoder =
  Tx
    <$> D.column (D.nonNullable D.bytea) -- txHash
    <*> idDecoder BlockId -- txBlockId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- txBlockIndex
    <*> dbLovelaceDecoder -- txOutSum
    <*> dbLovelaceDecoder -- txFee
    <*> D.column (D.nullable D.int8) -- txDeposit
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- txSize
    <*> maybeDbWord64Decoder -- txInvalidBefore
    <*> maybeDbWord64Decoder -- txInvalidHereafter
    <*> D.column (D.nonNullable D.bool) -- txValidContract
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- txScriptSize
    <*> dbLovelaceDecoder -- txTreasuryDonation

txEncoder :: E.Params Tx
txEncoder =
  mconcat
    [ txHash >$< E.param (E.nonNullable E.bytea)
    , txBlockId >$< idEncoder getBlockId
    , txBlockIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , txOutSum >$< dbLovelaceEncoder
    , txFee >$< dbLovelaceEncoder
    , txDeposit >$< E.param (E.nullable E.int8)
    , txSize >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , txInvalidBefore >$< maybeDbWord64Encoder
    , txInvalidHereafter >$< maybeDbWord64Encoder
    , txValidContract >$< E.param (E.nonNullable E.bool)
    , txScriptSize >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , txTreasuryDonation >$< dbLovelaceEncoder
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: txmetadata
-- Description: Contains metadata associated with transactions, such as metadata ID, key, and date.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @tx_metadata@:
-- A table for metadata attached to a transaction.
data TxMetadata = TxMetadata
  { txMetadataKey :: !DbWord64 -- sqltype=word64type

  -- ^ The metadata key (a Word64/unsigned 64 bit number).
  , txMetadataJson :: !(Maybe Text) -- sqltype=jsonb

  -- ^ The JSON payload if it can be decoded as JSON.
  , txMetadataBytes :: !ByteString -- sqltype=bytea

  -- ^ The raw bytes of the payload.
  , txMetadataTxId :: !TxId -- noreference

  -- ^ The Tx table index of the transaction where this metadata was included.
  }
  deriving (Eq, Show, Generic)

type instance Key TxMetadata = TxMetadataId

instance DbInfo TxMetadata where
  jsonbFields _ = ["json"]
  unnestParamTypes _ =
    [ ("key", "numeric[]")
    , ("json", "text[]")
    , ("bytes", "bytea[]")
    , ("tx_id", "bigint[]")
    ]

txMetadataBulkEncoder :: E.Params ([DbWord64], [Maybe Text], [ByteString], [TxId])
txMetadataBulkEncoder =
  contrazip4
    (bulkEncoder $ E.nonNullable dbWord64ValueEncoder)
    (bulkEncoder $ E.nullable E.text)
    (bulkEncoder $ E.nonNullable E.bytea)
    (bulkEncoder $ E.nonNullable $ getTxId >$< E.int8)

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: txin
-- Description: Represents the input side of a transaction, linking to previous transaction outputs being spent
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @tx_in@:
-- A table for transaction inputs.
data TxIn = TxIn
  { txInTxInId :: !TxId -- The transaction where this is used as an input.

  -- ^ The Tx table index of the transaction that contains this transaction input.
  , txInTxOutId :: !TxId -- The transaction where this was created as an output.

  -- ^ The Tx table index of the transaction that contains the referenced transaction output.
  , txInTxOutIndex :: !Word64 -- sqltype=txindex

  -- ^ The index within the transaction outputs.
  , txInRedeemerId :: !(Maybe RedeemerId)
  -- ^ The Redeemer table index which is used to validate this input.
  }
  deriving (Show, Eq, Generic)

type instance Key TxIn = TxInId

instance DbInfo TxIn where
  unnestParamTypes _ =
    [ ("tx_in_id", "bigint[]")
    , ("tx_out_id", "bigint[]")
    , ("tx_out_index", "bigint[]")
    , ("redeemer_id", "bigint[]")
    ]

entityTxInDecoder :: D.Row (Entity TxIn)
entityTxInDecoder =
  Entity
    <$> idDecoder TxInId
    <*> txInDecoder

txInDecoder :: D.Row TxIn
txInDecoder =
  TxIn
    <$> idDecoder TxId -- txInTxInId
    <*> idDecoder TxId -- txInTxOutId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- txInTxOutIndex
    <*> maybeIdDecoder RedeemerId -- txInRedeemerId

entityTxInEncoder :: E.Params (Entity TxIn)
entityTxInEncoder =
  mconcat
    [ entityKey >$< idEncoder getTxInId
    , entityVal >$< txInEncoder
    ]

txInEncoder :: E.Params TxIn
txInEncoder =
  mconcat
    [ txInTxInId >$< idEncoder getTxId
    , txInTxOutId >$< idEncoder getTxId
    , txInTxOutIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , txInRedeemerId >$< maybeIdEncoder getRedeemerId
    ]

encodeTxInBulk :: E.Params ([TxId], [TxId], [Word64], [Maybe RedeemerId])
encodeTxInBulk =
  contrazip4
    (bulkEncoder $ E.nonNullable $ getTxId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ getTxId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)
    (bulkEncoder $ E.nullable $ getRedeemerId >$< E.int8)

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: collateral_txin
-- Description: Represents the input side of a transaction, linking to previous transaction outputs being spent
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @collateral_tx_in@:
-- A table for transaction collateral inputs.
data CollateralTxIn = CollateralTxIn
  { collateralTxInTxInId :: !TxId -- noreference -- The transaction where this is used as an input.

  -- ^ The Tx table index of the transaction that contains this transaction input
  , collateralTxInTxOutId :: !TxId -- noreference -- The transaction where this was created as an output.

  -- ^ The Tx table index of the transaction that contains the referenced transaction output.
  , collateralTxInTxOutIndex :: !Word64 -- sqltype=txindex

  -- ^ The index within the transaction outputs.
  }
  deriving (Show, Eq, Generic)

type instance Key CollateralTxIn = CollateralTxInId
instance DbInfo CollateralTxIn

collateralTxInEncoder :: E.Params CollateralTxIn
collateralTxInEncoder =
  mconcat
    [ collateralTxInTxInId >$< idEncoder getTxId
    , collateralTxInTxOutId >$< idEncoder getTxId
    , collateralTxInTxOutIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: reference_txin
-- Description: Represents the input side of a transaction, linking to previous transaction outputs being spent
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @reference_tx_in@:
-- A table for reference transaction inputs. New in v13.
data ReferenceTxIn = ReferenceTxIn
  { referenceTxInTxInId :: !TxId -- noreference -- The transaction where this is used as an input.

  -- ^ The Tx table index of the transaction that contains this transaction input
  , referenceTxInTxOutId :: !TxId -- noreference -- The transaction where this was created as an output.

  -- ^ The Tx table index of the transaction that contains the referenced output.
  , referenceTxInTxOutIndex :: !Word64 -- sqltype=txindex

  -- ^ The index within the transaction outputs.
  }
  deriving (Show, Eq, Generic)

type instance Key ReferenceTxIn = ReferenceTxInId
instance DbInfo ReferenceTxIn

referenceTxInEncoder :: E.Params ReferenceTxIn
referenceTxInEncoder =
  mconcat
    [ referenceTxInTxInId >$< idEncoder getTxId
    , referenceTxInTxOutId >$< idEncoder getTxId
    , referenceTxInTxOutIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: reverse_index
-- Description: Provides a reverse lookup mechanism for transaction inputs, allowing efficient querying of the origin of funds.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @reverse_index@:
-- A table for reverse indexes for the minimum input output and multi asset output related with this
-- block. New in v13.1
data ReverseIndex = ReverseIndex
  { reverseIndexBlockId :: !BlockId -- noreference

  -- ^ The Block table index related with these indexes
  , reverseIndexMinIds :: !Text
  -- ^ The Reverse indexes associated with this block, as Text separated by :
  }
  deriving (Show, Eq, Generic)

type instance Key ReverseIndex = ReverseIndexId
instance DbInfo ReverseIndex

entityReverseIndexEncoder :: E.Params (Entity ReverseIndex)
entityReverseIndexEncoder =
  mconcat
    [ entityKey >$< idEncoder getReverseIndexId
    , entityVal >$< reverseIndexEncoder
    ]

reverseIndexEncoder :: E.Params ReverseIndex
reverseIndexEncoder =
  mconcat
    [ reverseIndexBlockId >$< idEncoder getBlockId
    , reverseIndexMinIds >$< E.param (E.nonNullable E.text)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: txcbor
-- Description: Stores the raw CBOR (Concise Binary Object Representation) encoding of transactions, useful for validation
--   and serialization purposes.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @tx_cbor@:
-- A table holding raw CBOR encoded transactions.
data TxCbor = TxCbor
  { txCborTxId :: !TxId -- noreference

  -- ^ The Tx table index of the transaction encoded in this table.
  , txCborBytes :: !ByteString -- sqltype=bytea

  -- ^ CBOR encoded transaction.
  }
  deriving (Show, Eq, Generic)

type instance Key TxCbor = TxCborId
instance DbInfo TxCbor

txCborEncoder :: E.Params TxCbor
txCborEncoder =
  mconcat
    [ txCborTxId >$< idEncoder getTxId
    , txCborBytes >$< E.param (E.nonNullable E.bytea)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: datum
-- Description: Contains the data associated with a transaction output, which can be used as input for a script.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @datum@:
-- A table containing Plutus Datum, found in witnesses or inlined in outputs
data Datum = Datum
  { datumHash :: !ByteString -- sqltype=hash32type

  -- ^ The Hash of the Datum
  , datumTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction where this datum first became available.
  , datumValue :: !(Maybe Text) -- sqltype=jsonb

  -- ^ The actual data in JSON format (detailed schema)
  , datumBytes :: !ByteString -- sqltype=bytea

  -- ^ The actual data in CBOR format
  }
  deriving (Eq, Show, Generic)

type instance Key Datum = DatumId
instance DbInfo Datum where
  uniqueFields _ = ["hash"]
  jsonbFields _ = ["value"]

datumEncoder :: E.Params Datum
datumEncoder =
  mconcat
    [ datumHash >$< E.param (E.nonNullable E.bytea)
    , datumTxId >$< idEncoder getTxId
    , datumValue >$< E.param (E.nullable E.text)
    , datumBytes >$< E.param (E.nonNullable E.bytea)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: script
-- Description: Contains the script associated with a transaction output, which can be used as input for a script.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @script@:
-- A table containing scripts available, found in witnesses, inlined in outputs (reference outputs) or
-- auxdata of transactions.
data Script = Script
  { scriptTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction where this script first became available.
  , scriptHash :: !ByteString -- sqltype=hash28type

  -- ^ The Hash of the Script.
  , scriptType :: !ScriptType -- sqltype=scripttype

  -- ^ The schema type: @multisig@, @timelock@, @plutusV1@, @plutusV2@ or @plutusV3@. The Haskell
  -- type also defines @plutusV4@, which is not yet in the SQL enum.
  , scriptJson :: !(Maybe Text) -- sqltype=jsonb

  -- ^ JSON representation of native multisig or timelock scripts where supplied by the era converter;
  -- null for Plutus and Dijkstra scripts, or when JSON decoding fails.
  , scriptBytes :: !(Maybe ByteString) -- sqltype=bytea

  -- ^ CBOR script bytes when supplied by the era converter, including Plutus and Dijkstra native
  -- scripts. Earlier native scripts have no stored CBOR bytes.
  , scriptSerialisedSize :: !(Maybe Word64) -- sqltype=word31type

  -- ^ The size of the CBOR serialised script, if it is a Plutus script.
  }
  deriving (Eq, Show, Generic)

type instance Key Script = ScriptId

instance DbInfo Script where
  uniqueFields _ = ["hash"]
  jsonbFields _ = ["json"]
  enumFields _ = [("type", "scripttype")]

scriptEncoder :: E.Params Script
scriptEncoder =
  mconcat
    [ scriptTxId >$< idEncoder getTxId
    , scriptHash >$< E.param (E.nonNullable E.bytea)
    , scriptType >$< E.param (E.nonNullable scriptTypeEncoder)
    , scriptJson >$< E.param (E.nullable E.text)
    , scriptBytes >$< E.param (E.nullable E.bytea)
    , scriptSerialisedSize >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: redeemer
-- Description: Holds the redeemer data used to satisfy script conditions during transaction processing.
-----------------------------------------------------------------------------------------------------------------------------------

-- Unit step is in picosends, and `maxBound :: !Int64` picoseconds is over 100 days, so using
-- Word64/word63type is safe here. Similarly, `maxBound :: !Int64` if unit step would be an

-- * enormous* amount a memory which would cost a fortune.

-- | Schema reference for @redeemer@:
-- A table containing redeemers. Redeemers supply data and execution budgets for Plutus script validation.
data Redeemer = Redeemer
  { redeemerTxId :: !TxId -- noreference

  -- ^ The Tx table index that contains this redeemer.
  , redeemerUnitMem :: !Word64 -- sqltype=word63type

  -- ^ The budget in Memory to run a script.
  , redeemerUnitSteps :: !Word64 -- sqltype=word63type

  -- ^ The budget in Cpu steps to run a script.
  , redeemerFee :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ The budget in fees to run a script. The fees depend on the ExUnits and the current prices. Is
  -- null when ledger is disabled. New in v13: became nullable.
  , redeemerPurpose :: !ScriptPurpose -- sqltype=scriptpurposetype

  -- ^ The SQL script purpose: @spend@, @mint@, @cert@, @reward@, @vote@ or @propose@.
  , redeemerIndex :: !Word64 -- sqltype=word31type

  -- ^ The index of the redeemer pointer in the transaction.
  , redeemerScriptHash :: !(Maybe ByteString) -- sqltype=hash28type

  -- ^ The script hash this redeemer is used for.
  , redeemerRedeemerDataId :: !RedeemerDataId -- noreference

  -- ^ The data related to this redeemer. New in v13: renamed from datum_id.
  }
  deriving (Eq, Show, Generic)

type instance Key Redeemer = RedeemerId

instance DbInfo Redeemer where
  enumFields _ = [("purpose", "scriptpurposetype")]

redeemerEncoder :: E.Params Redeemer
redeemerEncoder =
  mconcat
    [ redeemerTxId >$< idEncoder getTxId
    , redeemerUnitMem >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , redeemerUnitSteps >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , redeemerFee >$< E.param (E.nullable $ fromIntegral . unDbLovelace >$< E.int8)
    , redeemerPurpose >$< E.param (E.nonNullable scriptPurposeEncoder)
    , redeemerIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , redeemerScriptHash >$< E.param (E.nullable E.bytea)
    , redeemerRedeemerDataId >$< idEncoder getRedeemerDataId
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: redeemer_data
-- Description: Additional details about the redeemer, including its type and any associated metadata.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @redeemer_data@:
-- A table containing Plutus Redeemer Data. These are always referenced by at least one redeemer. New
-- in v13: split from datum table.
data RedeemerData = RedeemerData
  { redeemerDataHash :: !ByteString -- sqltype=hash32type

  -- ^ The Hash of the Plutus Data
  , redeemerDataTxId :: !TxId -- noreference

  -- ^ The Tx table index for the transaction where this redeemer data first became available.
  , redeemerDataValue :: !(Maybe Text) -- sqltype=jsonb

  -- ^ The actual data in JSON format (detailed schema)
  , redeemerDataBytes :: !ByteString -- sqltype=bytea

  -- ^ The actual data in CBOR format
  }
  deriving (Eq, Show, Generic)

type instance Key RedeemerData = RedeemerDataId
instance DbInfo RedeemerData where
  uniqueFields _ = ["hash"]
  jsonbFields _ = ["value"]

redeemerDataEncoder :: E.Params RedeemerData
redeemerDataEncoder =
  mconcat
    [ redeemerDataHash >$< E.param (E.nonNullable E.bytea)
    , redeemerDataTxId >$< idEncoder getTxId
    , redeemerDataValue >$< E.param (E.nullable E.text)
    , redeemerDataBytes >$< E.param (E.nonNullable E.bytea)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: extra_key_witness
-- Description: Contains additional key witnesses for transactions, which are used to validate the transaction's signature.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @extra_key_witness@:
-- A table containing transaction extra key witness hashes.
data ExtraKeyWitness = ExtraKeyWitness
  { extraKeyWitnessHash :: !ByteString -- sqltype=hash28type

  -- ^ The hash of the witness.
  , extraKeyWitnessTxId :: !TxId -- noreference

  -- ^ The id of the tx this witness belongs to.
  }
  deriving (Eq, Show, Generic)

type instance Key ExtraKeyWitness = ExtraKeyWitnessId
instance DbInfo ExtraKeyWitness

extraKeyWitnessEncoder :: E.Params ExtraKeyWitness
extraKeyWitnessEncoder =
  mconcat
    [ extraKeyWitnessHash >$< E.param (E.nonNullable E.bytea)
    , extraKeyWitnessTxId >$< idEncoder getTxId
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: slot_leader
-- Description:Contains information about the slot leader for a given block, including the slot leader's ID, hash, and description.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @slot_leader@:
-- Every unique slot leader (ie an entity that mines a block). It could be a pool or a leader defined
-- in genesis.
data SlotLeader = SlotLeader
  { slotLeaderHash :: !ByteString -- sqltype=hash28type

  -- ^ The hash of of the block producer identifier.
  , slotLeaderPoolHashId :: !(Maybe PoolHashId) -- This will be non-null when a block is mined by a pool

  -- ^ If the slot leader is a pool, an index into the @PoolHash@ table.
  , slotLeaderDescription :: !Text -- Description of the Slots leader

  -- ^ An auto-generated description of the slot leader.
  }
  deriving (Eq, Show, Generic)

type instance Key SlotLeader = SlotLeaderId
instance DbInfo SlotLeader where
  uniqueFields _ = ["hash"]

slotLeaderEncoder :: E.Params SlotLeader
slotLeaderEncoder =
  mconcat
    [ slotLeaderHash >$< E.param (E.nonNullable E.bytea)
    , slotLeaderPoolHashId >$< Id.maybeIdEncoder Id.getPoolHashId
    , slotLeaderDescription >$< E.param (E.nonNullable E.text)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- SYSTEM
-- These tables are used for database maintenance, versioning, and migrations.
-----------------------------------------------------------------------------------------------------------------------------------

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: schema_version
-- Description: A table for schema versioning.
-----------------------------------------------------------------------------------------------------------------------------------
-- Schema versioning has three stages to best allow handling of schema migrations.
--    Stage 1: Set up PostgreSQL data types (using SQL 'DOMAIN' statements).
--    Stage 2: Apply ordered schema migrations.
--    Stage 3: Set up 'VIEW' tables (for use by other languages and applications).
-- This table should have a single row.

-- | Schema reference for @schema_version@:
-- The version of the database schema. Schema versioning is split into three stages as detailed below.
-- This table should only ever have a single row.
data SchemaVersion = SchemaVersion
  { schemaVersionStageOne :: !Int
  -- ^ Set up PostgreSQL data types (using SQL 'DOMAIN' statements).
  , schemaVersionStageTwo :: !Int
  -- ^ Apply ordered stage-two schema migrations.
  , schemaVersionStageThree :: !Int
  -- ^ Set up database views, indices etc.
  }
  deriving (Eq, Show, Generic)

type instance Key SchemaVersion = SchemaVersionId
instance DbInfo SchemaVersion

schemaVersionDecoder :: D.Row SchemaVersion
schemaVersionDecoder =
  SchemaVersion
    <$> D.column (D.nonNullable $ fromIntegral <$> D.int4) -- schemaVersionStageOne
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int4) -- schemaVersionStageTwo
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int4) -- schemaVersionStageThree

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: meta
-- Description: A table containing metadata about the chain. There will probably only ever be one value in this table
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @meta@:
-- A table containing metadata about the chain. There will probably only ever be one row in this table.
data Meta = Meta
  { metaStartTime :: !UTCTime -- sqltype=timestamp

  -- ^ The start time of the network.
  , metaNetworkName :: !Text
  -- ^ The network name.
  , metaVersion :: !Text
  }
  deriving (Show, Eq, Generic)

type instance Key Meta = MetaId
instance DbInfo Meta where
  uniqueFields _ = ["start_time"]

entityMetaDecoder :: D.Row (Entity Meta)
entityMetaDecoder =
  Entity
    <$> idDecoder MetaId
    <*> metaDecoder

metaDecoder :: D.Row Meta
metaDecoder =
  Meta
    <$> D.column (D.nonNullable utcTimeAsTimestampDecoder) -- metaStartTime
    <*> D.column (D.nonNullable D.text) -- metaNetworkName
    <*> D.column (D.nonNullable D.text) -- metaVersion

metaEncoder :: E.Params Meta
metaEncoder =
  mconcat
    [ metaStartTime >$< E.param (E.nonNullable utcTimeAsTimestampEncoder)
    , metaNetworkName >$< E.param (E.nonNullable E.text)
    , metaVersion >$< E.param (E.nonNullable E.text)
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: migration
-- Description: A table containing information about migrations.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @withdrawal@:
-- A table for withdrawals from a reward account.
data Withdrawal = Withdrawal
  { withdrawalAddrId :: !StakeAddressId
  -- ^ The StakeAddress table index for the stake address for which the withdrawal is for.
  , withdrawalAmount :: !DbLovelace
  -- ^ The withdrawal amount (in Lovelace).
  , withdrawalRedeemerId :: !(Maybe RedeemerId)
  -- ^ The Redeemer table index that is related with this withdrawal.
  , withdrawalTxId :: !TxId
  -- ^ The Tx table index for the transaction that contains this withdrawal.
  }
  deriving (Eq, Show, Generic)

type instance Key Withdrawal = WithdrawalId
instance DbInfo Withdrawal

entityWithdrawalDecoder :: D.Row (Entity Withdrawal)
entityWithdrawalDecoder =
  Entity
    <$> idDecoder WithdrawalId
    <*> withdrawalDecoder

withdrawalDecoder :: D.Row Withdrawal
withdrawalDecoder =
  Withdrawal
    <$> idDecoder StakeAddressId -- withdrawalAddrId
    <*> dbLovelaceDecoder -- withdrawalAmount
    <*> maybeIdDecoder RedeemerId -- withdrawalRedeemerId
    <*> idDecoder TxId -- withdrawalTxId

withdrawalEncoder :: E.Params Withdrawal
withdrawalEncoder =
  mconcat
    [ withdrawalAddrId >$< idEncoder getStakeAddressId
    , withdrawalAmount >$< dbLovelaceEncoder
    , withdrawalRedeemerId >$< maybeIdEncoder getRedeemerId
    , withdrawalTxId >$< idEncoder getTxId
    ]

-----------------------------------------------------------------------------------------------------------------------------------
-- Table Name: extra_migrations
-- Description: = A table containing information about extra migrations.
-----------------------------------------------------------------------------------------------------------------------------------

-- | Schema reference for @extra_migrations@:
-- Extra optional migrations. New in 13.2.
data ExtraMigrations = ExtraMigrations
  { extraMigrationsToken :: !Text
  , extraMigrationsDescription :: !(Maybe Text)
  -- ^ A description of the migration
  }
  deriving (Eq, Show, Generic)

type instance Key ExtraMigrations = ExtraMigrationsId
instance DbInfo ExtraMigrations

extraMigrationsEncoder :: E.Params ExtraMigrations
extraMigrationsEncoder =
  mconcat
    [ extraMigrationsToken >$< E.param (E.nonNullable E.text)
    , extraMigrationsDescription >$< E.param (E.nullable E.text)
    ]
