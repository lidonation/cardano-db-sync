-- | The @extract-haddock@ command.
--
-- Usage:
--
-- > extract-haddock --repo-root . --out docs/generated/haddock-annotations.json --input cardano-db/src
--
-- Every file that fails to parse is printed on stderr and the exit code is
-- 1 — a source change that the extractor cannot read must never silently
-- lose documentation.
module Main (main) where

import Control.Exception (IOException, catch)
import Control.Monad (unless)
import qualified Data.ByteString as BS

import qualified Data.Text as T
import GHC.Clock (getMonotonicTimeNSec)
import HaddockExtract (
  Artifact (..),
  TreeStats (..),
  encodeArtifact,
  extractTree,
 )
import System.Directory (canonicalizePath, createDirectoryIfMissing, doesDirectoryExist, makeAbsolute)
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.FilePath (takeDirectory)
import System.IO

main :: IO ()
main = do
  args <- getArgs
  case parseArgs args of
    Left err -> do
      hPutStrLn stderr ("extract-haddock: " <> err)
      hPutStrLn stderr usage
      exitFailure
    Right opts -> run opts `catch` reportIOError

reportIOError :: IOException -> IO ()
reportIOError err = do
  hPutStrLn stderr ("extract-haddock: " <> show err)
  exitFailure

usage :: String
usage =
  unlines
    [ "usage: extract-haddock --repo-root DIR --out FILE [--input PATH]..."
    , "  --repo-root DIR   repository the artifact paths are relative to (default: .)"
    , "  --out FILE        artifact to write (required)"
    , "  --input PATH      file or directory to extract (repeatable; default: cardano-db/src and config Types.hs)."
    , "                   Paths are repository-relative or absolute paths inside the repository."
    ]

data Options = Options
  { optRoot :: FilePath
  , optOut :: FilePath
  , optInputs :: [FilePath]
  }

parseArgs :: [String] -> Either String Options
parseArgs = go (Options "." "" [])
  where
    go opts [] = case optOut opts of
      "" -> Left "missing --out FILE"
      _
        | null (optInputs opts) ->
            Right opts {optInputs = ["cardano-db/src", "cardano-db-sync/src/Cardano/DbSync/Config/Types.hs"]}
        | otherwise -> Right opts
    go opts (flag : value : rest) = case flag of
      "--repo-root" -> go opts {optRoot = value} rest
      "--out" -> go opts {optOut = value} rest
      "--input" -> go opts {optInputs = optInputs opts ++ [value]} rest
      _ -> Left ("unknown argument: " <> flag)
    go _ _ = Left "every flag needs a value"

run :: Options -> IO ()
run options = do
  absoluteRoot <- makeAbsolute (optRoot options)
  rootExists <- doesDirectoryExist absoluteRoot
  unless rootExists (ioError (userError (absoluteRoot <> ": repository root does not exist")))
  root <- canonicalizePath absoluteRoot
  started <- getMonotonicTimeNSec
  (artifact, stats, failures) <- extractTree root (optInputs options)
  unless (null failures) $ do
    hPutStrLn stderr "extract-haddock: some files did not parse:"
    mapM_ (hPutStrLn stderr . T.unpack) failures
    exitFailure
  writeArtifact (optOut options) artifact
  elapsed <- (/ 1e9) . fromIntegral . subtract started <$> getMonotonicTimeNSec
  let summary =
        "extracted "
          <> show (tsFiles stats)
          <> " files ("
          <> show (tsAnnotatedFiles stats)
          <> " with annotations, "
          <> show (tsAnnotations stats)
          <> " annotations) in "
          <> showElapsed elapsed
  hPutStrLn stderr summary
  unless (null (tsCppFiles stats)) $
    hPutStrLn stderr ("CPP-stripped: " <> T.unpack (T.intercalate ", " (tsCppFiles stats)))
  hPutStrLn stderr ("wrote " <> optOut options)

writeArtifact :: FilePath -> Artifact -> IO ()
writeArtifact path artifact = do
  createDirectoryIfMissing True (takeDirectory path)
  BS.writeFile path (encodeArtifact artifact)

showElapsed :: Double -> String
showElapsed s
  | s < 1 = show (round (s * 1000) :: Integer) <> "ms"
  | otherwise = take 5 (show s) <> "s"
