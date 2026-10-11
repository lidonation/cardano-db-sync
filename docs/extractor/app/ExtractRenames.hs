-- | The @extract-renames@ command (B09).
--
-- Usage:
--
-- > extract-renames --repo-root ../.. --out ../generated/schema-renames.json
--
-- Scans every migration under @schema/@ and writes the rename map. Any
-- @RENAME@ the scanner cannot read is printed on stderr with its file and
-- line, and the exit code is 1: a rename is never silently dropped.
module Main (main) where

import qualified Data.ByteString as BS
import qualified Data.Text as Text
import qualified Data.Text.IO as TIO
import HaddockExtract.Model (encodeJson)
import RenameExtract
import System.Directory (createDirectoryIfMissing)
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.FilePath (takeDirectory)
import System.IO

main :: IO ()
main = do
  args <- getArgs
  case parseArgs args of
    Left err -> do
      hPutStrLn stderr ("extract-renames: " <> err)
      hPutStrLn stderr usage
      exitFailure
    Right (root, out) ->
      extractRenames root >>= \case
        Left errs -> do
          hPutStrLn stderr "extract-renames: the migrations could not be read:"
          mapM_ (TIO.hPutStrLn stderr . ("  " <>)) errs
          exitFailure
        Right (files, rmap) -> do
          createDirectoryIfMissing True (takeDirectory out)
          BS.writeFile out (encodeJson (renamesJson rmap))
          putStrLn $
            "extract-renames: "
              <> show (length (rmRenames rmap))
              <> " renames across "
              <> show files
              <> " migrations, "
              <> show (length (rmEntities rmap))
              <> " renamed entities -> "
              <> out
          mapM_ (TIO.putStrLn . describe) (rmRenames rmap)
  where
    describe r =
      "  "
        <> Text.pack (migFile (rnMigration r))
        <> ":"
        <> Text.pack (show (rnLine r))
        <> "  "
        <> kindText (rnKind r)
        <> " "
        <> maybe "" (<> ".") (rnTable r)
        <> rnFrom r
        <> " -> "
        <> rnTo r

usage :: String
usage =
  unlines
    [ "usage: extract-renames --repo-root DIR --out FILE"
    , "  --repo-root DIR   repository whose schema/ is scanned (default: .)"
    , "  --out FILE        artifact to write (required)"
    ]

parseArgs :: [String] -> Either String (FilePath, FilePath)
parseArgs = go (".", "")
  where
    go (root, out) [] = if null out then Left "missing --out FILE" else Right (root, out)
    go (root, out) (flag : value : rest) = case flag of
      "--repo-root" -> go (value, out) rest
      "--out" -> go (root, value) rest
      _ -> Left ("unknown argument: " <> flag)
    go _ _ = Left "every flag needs a value"
