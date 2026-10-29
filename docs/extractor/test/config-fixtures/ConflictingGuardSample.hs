{-# LANGUAGE OverloadedStrings #-}

module ConflictingGuardSample where

import Control.Monad (when)
import Data.Aeson ((.!=), (.:?))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KeyMap

newtype Root = Root {rootEnabled :: Bool}
instance Aeson.FromJSON Root where
  parseJSON = Aeson.withObject "Root" $ \obj -> do
    when (KeyMap.member "enabled" obj) $ fail "enabled is retired"
    Root <$> obj .:? "enabled" .!= True
