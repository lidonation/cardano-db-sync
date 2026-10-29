-- | Golden test for the config extractor (B10).
--
-- * @test/config-fixtures/ConfigSample.hs@ — one of every parser idiom the
--   config module uses — must reproduce @test/golden/config-schema.json@ byte
--   for byte. The golden is small enough to check by eye against the fixture.
-- * The real config module must extract with nothing unresolved: a parser
--   idiom the rules do not know fails here rather than silently dropping keys
--   from the wizard's schema.
--
-- Run with @cabal test@ from @docs/extractor@. When the fixture changes,
-- regenerate the golden with:
--
-- > cabal run config-golden-test -- --regenerate
module Main (main) where

import ConfigExtract
import Control.Monad (unless)
import qualified Data.ByteString as BS
import qualified Data.Text as Text
import HaddockExtract.Model (encodeJson)
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.IO

fixture :: FilePath
fixture = "test/config-fixtures/ConfigSample.hs"

golden :: FilePath
golden = "test/golden/config-schema.json"

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  args <- getArgs
  fixtureSchema <- expectSchema "." [fixture] "Root"
  let bytes = encodeJson (schemaJson [fixture] "Root" fixtureSchema)
  if "--regenerate" `elem` args
    then BS.writeFile golden bytes >> putStrLn ("wrote " <> golden)
    else do
      expected <- BS.readFile golden
      unless (bytes == expected) $
        failWith ("the fixture no longer extracts to " <> golden <> " (run with --regenerate if intended)")
      putStrLn "ok: fixture matches the golden schema"
  check "fixture: every part read" (null (schemaUnresolved fixtureSchema))

  guarded <- expectSchema "." ["test/config-fixtures/GuardSample.hs"] "Root"
  check "retired-key guard extracts without accepting the retired key" $ case schemaRoot guarded of
    SObject _ _ keys _ -> null (schemaUnresolved guarded) && map keyName keys == ["enabled"]
    _ -> False

  traversed <- expectSchema "." ["test/config-fixtures/TraverseSample.hs"] "Root"
  check "validated nonempty text lists retain their input shape" $ case schemaRoot traversed of
    SObject _ _ keys _ -> any (\k -> keyName k == "values" && keyShape k == SNullable (SArray 1 SString)) keys
    _ -> False

  unsafe <- extractConfig "." ["test/config-fixtures/UnsafeGuardSample.hs"] "Root"
  check "unrecognised guards remain unresolved" $ case unsafe of
    Right schema -> not (null (schemaUnresolved schema))
    Left _ -> False

  conflicting <- extractConfig "." ["test/config-fixtures/ConflictingGuardSample.hs"] "Root"
  check "a rejected key cannot also be advertised as accepted" $ case conflicting of
    Right schema -> not (null (schemaUnresolved schema))
    Left _ -> False

  real <- expectSchema "../.." configSources configRoot
  check "real config: every part read" (null (schemaUnresolved real))
  check "real config: root is an object with keys" $ case schemaRoot real of
    SObject _ _ keys _ -> not (null keys)
    _ -> False
  check "real config: the tracing keys are passed through" (not (null (schemaPassthrough real)))
  check "real config: insert_options carries its presets" $ case schemaRoot real of
    SObject _ _ keys _ ->
      or [not (null ps) | Key "insert_options" _ (SNullable (SObject _ _ _ ps)) _ <- keys]
    _ -> False
  putStrLn "config-golden-test: all checks passed"
  where
    expectSchema root files rootTy = do
      result <- extractConfig root files rootTy
      case result of
        Left errs -> do
          hPutStrLn stderr "config-golden-test: sources did not parse:"
          mapM_ (hPutStrLn stderr . Text.unpack) errs
          exitFailure
        Right s -> do
          unless (null (schemaUnresolved s)) $
            mapM_ (hPutStrLn stderr . ("  unresolved: " <>) . Text.unpack) (schemaUnresolved s)
          pure s

check :: String -> Bool -> IO ()
check name ok
  | ok = putStrLn ("ok: " <> name)
  | otherwise = failWith name

failWith :: String -> IO a
failWith msg = hPutStrLn stderr ("config-golden-test: FAILED — " <> msg) >> exitFailure
