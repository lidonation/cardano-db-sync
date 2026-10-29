-- | Unsupported parser syntax must survive lowering and fail extraction.
module Main (main) where

import ConfigExtract.Interp (extractSchema, schemaPassthrough, schemaUnresolved)
import ConfigExtract.Syntax (lowerModule)
import Control.Monad (when)
import qualified Data.Text as Text
import GHC.Types.SrcLoc (unLoc)
import HaddockExtract.Parse (ParseOutcome (..), parseSource)

main :: IO ()
main = do
  rejects
    "multiple helper equations"
    [ "instance FromJSON Backend where"
    , "  parseJSON = withText \"Backend\" $ \\v -> case onOff v of"
    , "    Just b -> pure (Backend b)"
    , "    Nothing -> fail \"bad\""
    , "onOff \"on\" = Just True"
    , "onOff \"off\" = Just False"
    , "onOff _ = Nothing"
    ]
  rejects
    "boolean guarded text alternative"
    [ "instance FromJSON Backend where"
    , "  parseJSON = withText \"Backend\" $ \\case"
    , "    \"on\" | False -> pure (Backend True)"
    , "    _ -> fail \"bad\""
    ]
  rejects
    "pattern guarded text alternative"
    [ "instance FromJSON Backend where"
    , "  parseJSON = withText \"Backend\" $ \\case"
    , "    \"on\" | Just b <- Nothing -> pure (Backend b)"
    , "    _ -> fail \"bad\""
    ]
  rejects
    "multiple guarded right hand sides"
    [ "instance FromJSON Backend where"
    , "  parseJSON = withText \"Backend\" $ \\case"
    , "    \"on\" | False -> fail \"bad\""
    , "         | otherwise -> pure (Backend True)"
    , "    _ -> fail \"bad\""
    ]
  rejects
    "case alternative local bindings"
    [ "instance FromJSON Backend where"
    , "  parseJSON = withText \"Backend\" $ \\case"
    , "    \"on\" -> pure value where value = Backend True"
    , "    _ -> fail \"bad\""
    ]
  case parseSource traceSource "TraceRegression.hs" of
    Failed err -> fail ("trace fixture did not parse: " <> Text.unpack err)
    Parsed _ _ parsed -> do
      let schema = extractSchema (lowerModule (unLoc parsed)) "Root"
      when (null (schemaPassthrough schema)) $
        fail "boolean guards lost trace passthrough keys"
  putStrLn "config-syntax-regression-test: all checks passed"

rejects :: String -> [Text.Text] -> IO ()
rejects name parser = case parseSource source "SyntaxRegression.hs" of
  Failed err -> fail (name <> ": fixture did not parse: " <> Text.unpack err)
  Parsed _ _ parsed -> do
    let schema = extractSchema (lowerModule (unLoc parsed)) "Root"
    when (null (schemaUnresolved schema)) $
      fail (name <> ": unsupported syntax extracted without an unresolved error")
  where
    source =
      Text.unlines $
        [ "module SyntaxRegression where"
        , "data Root = Root Backend"
        , "data Backend = Backend Bool"
        , "instance FromJSON Root where"
        , "  parseJSON = withObject \"Root\" $ \\o -> Root <$> o .: \"backend\""
        ]
          ++ parser

traceSource :: Text.Text
traceSource =
  Text.unlines
    [ "module TraceRegression where"
    , "data Root = Root Bool"
    , "instance FromJSON Root where"
    , "  parseJSON = withObject \"Root\" $ \\o -> Root <$> o .: \"enabled\""
    , "readTrace v = case v of"
    , "  Object o | any (`KeyMap.member` o) [\"TraceOptions\", \"Options\"] -> readOther o"
    , "  _ -> pure defaultTrace"
    ]
