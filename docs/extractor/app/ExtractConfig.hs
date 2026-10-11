-- | The @extract-config@ command (B10).
--
-- > extract-config --repo-root ../.. --out ../generated/config-schema.json
--
-- Exits 1 when a source does not parse or when any part of the schema could
-- not be read (the artifact's @unresolved@ list is not empty): the wizard's
-- CON-4 gate is only as good as the schema, so a gap fails the run.
module Main (main) where

import ConfigExtract
import Control.Monad (unless)
import qualified Data.ByteString as BS
import qualified Data.Text as Text
import HaddockExtract.Model (encodeJson)
import System.Directory (createDirectoryIfMissing)
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.FilePath (takeDirectory)
import System.IO

main :: IO ()
main = do
  args <- getArgs
  case parseArgs args (".", "") of
    Left err -> do
      hPutStrLn stderr ("extract-config: " <> err)
      hPutStrLn stderr "usage: extract-config --repo-root DIR --out FILE"
      exitFailure
    Right (root, out) -> do
      result <- extractConfig root configSources configRoot
      case result of
        Left errs -> do
          hPutStrLn stderr "extract-config: some files did not parse:"
          mapM_ (hPutStrLn stderr . Text.unpack) errs
          exitFailure
        Right schema -> do
          createDirectoryIfMissing True (takeDirectory out)
          BS.writeFile out (encodeJson (schemaJson configSources configRoot schema))
          hPutStrLn stderr ("wrote " <> out)
          unless (null (schemaUnresolved schema)) $ do
            hPutStrLn stderr "extract-config: parts of the config schema could not be read:"
            mapM_ (hPutStrLn stderr . ("  " <>) . Text.unpack) (schemaUnresolved schema)
            exitFailure
  where
    parseArgs [] (root, out)
      | null out = Left "missing --out FILE"
      | otherwise = Right (root, out)
    parseArgs ("--repo-root" : v : rest) (_, out) = parseArgs rest (v, out)
    parseArgs ("--out" : v : rest) (root, _) = parseArgs rest (root, v)
    parseArgs (flag : _) _ = Left ("unknown or incomplete argument: " <> flag)
