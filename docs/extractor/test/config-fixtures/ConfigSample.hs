{-# LANGUAGE OverloadedStrings #-}

-- | Fixture for the config extractor golden test (B10): one of every parser
-- idiom @Cardano.DbSync.Config.Types@ uses, small enough to read the expected
-- schema off by eye.
module ConfigSample where

import Data.Aeson (FromJSON (..), Value (..), (.!=), (.:), (.:?))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KeyMap
import Data.Default.Class (Default (..))
import Data.Text (Text)
import Data.Word (Word64)

data Root = Root
  { rName :: NetworkName
  , rLogging :: Bool
  , rPort :: Int
  , rFuture :: Bool
  , rGateways :: [Text]
  , rBackend :: Backend
  , rInsert :: InsertConfig
  }

newtype NetworkName = NetworkName {unNetworkName :: Text}

newtype Flag = Flag {unFlag :: Bool}
  deriving newtype (FromJSON)

data Backend = InMemory | OnDisk (Maybe FilePath)

newtype Toggle = Toggle {isOn :: Bool}

data Ledger = LedgerOn | LedgerOff | LedgerIgnore

data Out = OutEnable Flag | OutDisable | OutPrune Flag Flag

data Assets = AssetsOn | AssetsOff | AssetsPolicies [Text]

data Preset = PresetFull | PresetMinimal

data InsertConfig = InsertConfig (Maybe Preset) Options

data Options = Options
  { oToggle :: Toggle
  , oLedger :: Ledger
  , oOut :: Out
  , oAssets :: Assets
  , oStop :: Maybe Word64
  }

instance FromJSON Root where
  parseJSON = Aeson.withObject "Root" parseRoot

parseRoot :: Aeson.Object -> Aeson.Parser Root
parseRoot o =
  Root
    <$> fmap NetworkName (o .: "Name")
    <*> o .: "Logging"
    <*> fmap (fromMaybe 8080) (o .:? "Port")
    <*> fmap (fromMaybe True) (o .:? "Future")
    <*> o .:? "gateways" .!= ["https://ipfs.io/ipfs"]
    <*> o .:? "backend" .!= InMemory
    <*> o .:? "insert" .!= def

instance FromJSON Backend where
  parseJSON = Aeson.withText "Backend" $ \case
    "memory" -> pure InMemory
    "disk" -> pure (OnDisk Nothing)
    other -> fail ("unexpected backend: " <> show other)

instance FromJSON Toggle where
  parseJSON = Aeson.withText "toggle" $ \v ->
    case onOff v of
      Just b -> pure (Toggle b)
      Nothing -> fail "unexpected toggle"

instance FromJSON Ledger where
  parseJSON = Aeson.withText "ledger" $ \case
    "enable" -> pure LedgerOn
    "disable" -> pure LedgerOff
    "ignore" -> pure LedgerIgnore
    other -> fail ("unexpected ledger: " <> show other)

instance FromJSON Out where
  parseJSON = Aeson.withObject "out" $ \obj -> do
    val <- obj .: "value"
    force <- obj .:? "force" .!= Flag False
    addr <- obj .:? "address" .!= Flag False
    case val :: Text of
      "enable" -> pure (OutEnable addr)
      "disable" -> pure OutDisable
      "prune" -> pure (OutPrune force addr)
      other -> fail ("unexpected out: " <> show other)

instance FromJSON Assets where
  parseJSON = Aeson.withObject "assets" $ \obj -> do
    enable <- obj .: "enable"
    policies <- obj .:? "policies"
    pure $
      case (enable, policies) of
        (False, _) -> AssetsOff
        (True, Nothing) -> AssetsOn
        (True, Just ps) -> AssetsPolicies (map parsePolicy ps)

instance FromJSON Preset where
  parseJSON = Aeson.withText "Preset" $ \case
    "full" -> pure PresetFull
    "minimal" -> pure PresetMinimal
    other -> fail ("unexpected preset: " <> show other)

instance FromJSON InsertConfig where
  parseJSON = Aeson.withObject "InsertConfig" $ \obj -> do
    preset <- obj .:? "preset"
    base <- case preset of
      Just PresetFull -> pure fullOptions
      Just PresetMinimal -> pure minimalOptions
      Nothing -> pure def
    options <- parseOverrides obj base
    pure $ InsertConfig preset options

parseOverrides :: Aeson.Object -> Options -> Aeson.Parser Options
parseOverrides obj base = do
  Options
    <$> obj .:? "toggle" .!= oToggle base
    <*> obj .:? "ledger" .!= oLedger base
    <*> obj .:? "out" .!= oOut base
    <*> obj .:? "assets" .!= oAssets base
    <*> obj .:? "stop" .!= oStop base

instance Default InsertConfig where
  def = InsertConfig Nothing def

instance Default Options where
  def =
    Options
      { oToggle = Toggle False
      , oLedger = LedgerOn
      , oOut = OutEnable (Flag False)
      , oAssets = AssetsOn
      , oStop = Nothing
      }

fullOptions :: Options
fullOptions = def {oToggle = Toggle True}

minimalOptions :: Options
minimalOptions =
  Options
    { oToggle = Toggle False
    , oLedger = LedgerIgnore
    , oOut = OutPrune (Flag True) (Flag False)
    , oAssets = AssetsOff
    , oStop = Just 100
    }

onOff :: Text -> Maybe Bool
onOff = \case
  "on" -> Just True
  "off" -> Just False
  _ -> Nothing

parsePolicy :: Text -> Text
parsePolicy = id

readTrace :: Value -> Bool
readTrace v = case v of
  Object o -> any (`KeyMap.member` o) ["TraceOptions", "Options"]
  _ -> False
