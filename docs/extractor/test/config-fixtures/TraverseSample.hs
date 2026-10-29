{-# LANGUAGE OverloadedStrings #-}

module TraverseSample where

import Data.Aeson ((.:), (.:?))
import qualified Data.Aeson as Aeson
import Data.ByteString.Short (ShortByteString)
import Data.List.NonEmpty (NonEmpty)
import Data.Text (Text)

data Root = Disabled | Enabled | Selected (NonEmpty ShortByteString)
parseHash :: Text -> Aeson.Parser ShortByteString
parseHash = undefined
instance Aeson.FromJSON Root where
  parseJSON = Aeson.withObject "Root" $ \obj -> do
    enable <- obj .: "enable"
    values <- obj .:? "values"
    case (enable, values) of
      (False, _) -> pure Disabled
      (True, Nothing) -> pure Enabled
      (True, Just xs) -> Selected <$> traverse parseHash xs
