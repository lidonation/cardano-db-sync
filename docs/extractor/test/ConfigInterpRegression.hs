module Main (main) where

import ConfigExtract
import ConfigExtract.Syntax (lowerModule)
import Control.Monad (unless)
import Data.Aeson (Value (..))
import qualified Data.Aeson.KeyMap as KM
import Data.Text (Text)
import qualified Data.Text as Text
import GHC.Types.SrcLoc (unLoc)
import HaddockExtract.Parse (ParseOutcome (..), parseSource)
import System.Exit (exitFailure)

main :: IO ()
main = do
  let numeric ty =
        schema $
          Text.unlines
            ["data Root = Root " <> ty, "instance FromJSON Root where", "  parseJSON = Aeson.withObject \"root\" $ \\o -> Root <$> o .: \"n\""]
  check "Word8 bounds" (shapeAt "n" (numeric "Word8") == Just (SInt "Word8" (Just "0") (Just "255")))
  check "Word64 bounds retain full precision" (shapeAt "n" (numeric "Word64") == Just (SInt "Word64" (Just "0") (Just "18446744073709551615")))
  check "integer type mutation changes the artifact" (schemaJson [] "Root" (numeric "Word8") /= schemaJson [] "Root" (numeric "Word64"))
  check "NonEmpty constraint" (shapeAt "n" (numeric "(NonEmpty Word)") == Just (SArray 1 (SInt "Word" (Just "0") (Just "18446744073709551615"))))
  let doNumeric =
        schema $
          Text.unlines
            [ "data Root = Root Word64"
            , "instance FromJSON Root where"
            , "  parseJSON = Aeson.withObject \"root\" $ \\o -> do"
            , "    n <- o .:? \"n\" .!= 580"
            , "    pure (Root n)"
            ]
  check "do-bound numeric default keeps constructor type" (shapeAt "n" doNumeric == Just (SNullable (SInt "Word64" (Just "0") (Just "18446744073709551615"))))
  let optional body =
        schema $
          Text.unlines
            ["data Root = Root (Maybe Word8)", "instance FromJSON Root where", "  parseJSON = Aeson.withObject \"root\" $ \\o -> Root <$> " <> body]
  check "optional without default accepts null" (shapeAt "n" (optional "o .:? \"n\"") == Just (SNullable (SInt "Word8" (Just "0") (Just "255"))))
  check "optional with default accepts null" (shapeAt "n" (optional "o .:? \"n\" .!= Nothing") == Just (SNullable (SInt "Word8" (Just "0") (Just "255"))))
  let unsupported body =
        schema $
          Text.unlines
            ["data Root = Root Bool", "instance FromJSON Root where", "  parseJSON = Aeson.withObject \"root\" $ \\o -> " <> body]
  check "unsupported applicative transformation fails closed" (bad (unsupported "Root <$> (id <$> o .: \"flag\")"))
  check "unsupported object expression fails closed" (bad (unsupported "unknown o"))
  check "unsupported do statement fails closed" (bad (unsupported "do { flag <- o .: \"flag\"; validate flag; pure (Root flag) }"))
  let textBody body =
        schema $
          Text.unlines
            ["data Root = Root", "instance FromJSON Root where", "  parseJSON = Aeson.withText \"root\" $ " <> body]
  check "unknown text parser fails closed" (bad (textBody "unknown"))
  check "guarded text alternative fails closed" (bad (textBody "\\case { \"x\" | False -> pure Root; _ -> fail \"no\" }"))
  check "wildcard accepting text parser fails closed" (bad (textBody "\\case { \"x\" -> pure Root; _ -> pure Root }"))
  check "text parser helper effects fail closed" (bad (textBody "\\case { \"x\" -> validateBackend True; _ -> fail \"no\" }"))
  let restrictedBool =
        schema $
          Text.unlines
            [ "data Root = Root Bool"
            , "instance FromJSON Root where"
            , "  parseJSON = Aeson.withBool \"root\" $ \\b -> if b then pure (Root b) else fail \"disabled\""
            ]
  check "withBool callback cannot bypass extraction checks" (bad restrictedBool)
  real <- extractConfig "../.." configSources configRoot
  case real of
    Left errs -> fail (show errs)
    Right s -> do
      check "real config fully resolved" (not (bad s))
      check
        "object defaults present"
        ( case keyAt "insert_options" s of
            Just Key {keyDefault = Just (Object obj)} -> KM.member "tx_out" obj && KM.member "shelley" obj
            _ -> False
        )
      check
        "snapshot default evaluated"
        ( case keyAt "snapshot_interval" s of
            Just Key {keyDefault = Just (Object obj)} -> KM.lookup "near_tip_epoch" obj == Just (Number 580)
            _ -> False
        )
  let objectDefault enabled =
        schema $
          Text.unlines
            [ "data Root = Root Child"
            , "data Child = Child Bool"
            , "instance FromJSON Root where"
            , "  parseJSON = Aeson.withObject \"root\" $ \\o -> Root <$> o .:? \"child\" .!= def"
            , "instance FromJSON Child where"
            , "  parseJSON = Aeson.withObject \"child\" $ \\o -> Child <$> o .: \"enabled\""
            , "instance Default Child where"
            , "  def = Child " <> enabled
            ]
  check "object default change affects artifact" (not (bad (objectDefault "True")) && schemaJson [] "Root" (objectDefault "True") /= schemaJson [] "Root" (objectDefault "False"))
  putStrLn "config-interp-regression-test: all checks passed"

schema :: Text -> Schema
schema src = case parseSource src "Regression.hs" of
  Parsed _ _ lmod -> extractSchema (lowerModule (unLoc lmod)) "Root"
  Failed err -> error (Text.unpack err)

bad :: Schema -> Bool
bad = not . null . schemaUnresolved

keyAt :: Text -> Schema -> Maybe Key
keyAt name s = case schemaRoot s of
  SObject _ _ keys _ -> case filter ((== name) . keyName) keys of
    k : _ -> Just k
    _ -> Nothing
  _ -> Nothing

shapeAt :: Text -> Schema -> Maybe Shape
shapeAt name = fmap keyShape . keyAt name

check :: String -> Bool -> IO ()
check label passed = unless passed (putStrLn ("FAILED: " <> label) >> exitFailure)
