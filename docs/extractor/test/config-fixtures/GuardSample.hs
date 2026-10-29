{-# LANGUAGE OverloadedStrings #-}

module GuardSample where

import Control.Monad (when)
import Data.Aeson ((.!=), (.:?))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KeyMap

newtype Root = Root {rootEnabled :: Bool}
instance Aeson.FromJSON Root where
  parseJSON = Aeson.withObject "Root" $ \obj -> do
    when (KeyMap.member "retired" obj) $ fail "retired selector"
    Root <$> obj .:? "enabled" .!= True
