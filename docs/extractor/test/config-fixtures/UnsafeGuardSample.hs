{-# LANGUAGE OverloadedStrings #-}

module UnsafeGuardSample where

import Control.Monad (when)
import Data.Aeson ((.!=), (.:?))
import qualified Data.Aeson as Aeson

newtype Root = Root {rootEnabled :: Bool}
instance Aeson.FromJSON Root where
  parseJSON = Aeson.withObject "Root" $ \obj -> do
    when (unsupportedPredicate obj) $ fail "unsupported conditional"
    Root <$> obj .:? "enabled" .!= True
