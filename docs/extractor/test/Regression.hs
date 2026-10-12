module Main (main) where

import Control.Monad (unless)
import Data.Aeson (Value (Number), decodeStrict', toJSON)
import Data.List (find)
import qualified Data.Text as Text
import GHC.Types.SrcLoc (unLoc)
import HaddockExtract
import HaddockExtract.Model (encodeJson)

main :: IO ()
main = do
  let parse text = case parseSource text "Regression.hs" of
        Parsed _ _ ast -> walkModule (unLoc ast)
        Failed err -> error (Text.unpack err)
      check label ok = unless ok (error label)
      sample = parse "module Regression where\n-- | first\na :: Int\na = 1\n-- | second\nb :: Int\nb = 2\n"
  check "source order" (map annName sample == ["a", "b"])
  let nested = parse "module Regression where\ndata Record = Record { field :: Int -- ^ field docs\n }\n"
  check "field-only documentation" (map annName nested == ["Record"])
  let multi = parse "module Regression where\n-- | both\na, b :: Int\na = 1\nb = 2\n"
  check "multi-name signature" (map annName multi == ["a", "b"])
  let fields = parse "module Regression where\n-- | record\ndata Record = Record { x, y :: Int -- ^ coordinates\n }\n"
  check "multi-name fields" (map fieldName (concatMap conFields (concatMap annConstructors fields)) == ["x", "y"])
  let inst = parse "module Regression where\n-- | instance docs\ninstance Show Int where\n show _ = \"value\"\n"
  check "named instance" (not (any (Text.null . annName) inst))
  let binding = parse "module Regression where\n-- | pair\n(x, y) = (1, 2)\n"
  check "pattern binding names" (map annName binding == ["x", "y"])
  let methods = parse "module Regression where\nclass C a where\n -- | method\n f :: a -> Int\n -- ^ additional\n"
  check
    "class method joined and at signature"
    ( case methods of
        [a] -> annName a == "f" && annLine a == 4 && annDoc a == "method\nadditional"
        _ -> False
    )
  let associated = parse "module Regression where\nclass C a where\n -- | associated docs\n type Assoc a\n f :: a -> Int\n"
  check "associated types are association barriers" (map annName associated == ["Assoc"])
  let gadt = parse "module Regression where\n-- | GADT\ndata G a where\n -- | alternatives\n A, B :: G Int\n"
  check "multi-name GADT constructors" (map conName (concatMap annConstructors gadt) == ["A", "B"])
  let (stripped, cpp) = stripCpp "module Regression where\n#if FLAG\n-- | before\nf = 1\n#endif\n"
      docs = parse stripped
  check "CPP keeps line positions" (cpp && maybe False ((== 4) . annLine) (find ((== "f") . annName) docs))
  let normalized = parse "module Regression where\n-- |\n-- hello\nf = 1\n"
  check "leading blank normalization" (map annDoc normalized == ["hello"])
  let barrier = parse "module Regression where\n-- | pattern docs\npattern P = 1\nf = 2\n"
  check "unsupported declarations do not transfer docs" (all ((/= "f") . annName) barrier)
  let value = Artifact [ModuleAnnotations "Regression.hs" (Just "Regression") (Just (Text.pack ['\0', '\1', '\31', 'é'])) False []]
  check "JSON control characters round trip" (decodeStrict' (encodeArtifact value) == Just (toJSON value))
  mapM_ (\n -> check "JSON numbers preserve fractions" (decodeStrict' (encodeJson (Number n)) == Just (Number n))) [1.5, -2.25, 0.00000001, 8080]
  putStrLn "regression-test: all extraction cases passed"
