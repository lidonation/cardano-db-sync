-- | Running the extractor over a set of files.
--
-- This is the layer the CLI and the golden test share: given a repository
-- root and a list of paths (files or directories, repository-relative), it
-- returns the artifact plus per-run statistics. A file that fails to parse is
-- reported through the failures list instead of being dropped: silently
-- partial documentation is worse than a hard failure.
module HaddockExtract.Run (
  extractFile,
  collectHaskellFiles,
  extractTree,
  TreeStats (..),
) where

import Control.Exception (IOException, try)
import Control.Monad (unless, when)
import qualified Data.ByteString as BS
import Data.Either (lefts, rights)
import Data.List (nub, sort, sortBy)
import Data.Ord (comparing)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as TE
import GHC.Types.SrcLoc (unLoc)
import HaddockExtract.Model
import HaddockExtract.Parse (ParseOutcome (..), parseSource, stripCpp)
import HaddockExtract.Walk (moduleAnnotations)
import System.Directory (canonicalizePath, doesDirectoryExist, doesFileExist, doesPathExist, listDirectory, pathIsSymbolicLink)
import System.FilePath ((</>))
import qualified System.FilePath as FP

-- | Everything the run needs to report.
data TreeStats = TreeStats
  { tsFiles :: Int
  , tsAnnotatedFiles :: Int
  , tsAnnotations :: Int
  , tsCppFiles :: [Text]
  }

-- | Extract one file. @path@ is repository-relative (it is the path written
-- to the artifact); the file itself is read at @root '</>' path@.
extractFile :: FilePath -> FilePath -> IO (Either Text ModuleAnnotations)
extractFile root path = do
  result <- try (BS.readFile (root </> path)) :: IO (Either IOException BS.ByteString)
  pure $ case result of
    Left err -> Left (Text.pack path <> ": cannot read source: " <> Text.pack (show err))
    Right bytes -> case TE.decodeUtf8' bytes of
      Left err -> Left (Text.pack path <> ": invalid UTF-8: " <> Text.pack (show err))
      Right source ->
        let (stripped, cpp) = stripCpp source
         in case parseSource stripped path of
              Parsed _ _ lmod ->
                Right (moduleAnnotations cpp (Text.pack (posixPath path)) (unLoc lmod))
              Failed err -> Left err

-- | Every Haskell file under the given repository-relative paths, path-sorted
-- and de-duplicated. Directories are walked recursively; non-Haskell files
-- are ignored. The order is what makes regeneration byte-identical.
collectHaskellFiles :: FilePath -> [FilePath] -> IO [FilePath]
collectHaskellFiles root inputs = do
  canonicalRoot <- canonicalizePath root
  files <- concat <$> traverse (walk canonicalRoot True . (canonicalRoot </>)) inputs
  let selected = sort (nub (map posixPath files))
  when (null selected) (ioError (userError "no Haskell source files selected"))
  pure selected
  where
    walk canonicalRoot explicit path = do
      exists <- doesPathExist path
      unless exists (ioError (userError (path <> ": input does not exist")))
      canonical <- canonicalizePath path
      let relative = FP.makeRelative canonicalRoot canonical
          outside = FP.isAbsolute relative || ".." `elem` FP.splitDirectories relative
      when outside (ioError (userError (path <> ": input escapes repository root")))
      isDir <- doesDirectoryExist canonical
      symbolic <- pathIsSymbolicLink path
      if isDir
        then
          if symbolic
            then
              if explicit
                then ioError (userError (path <> ": symbolic-link directories are not supported"))
                else pure [] -- Never follow directory links, including cycles.
            else do
              entries <- listDirectory canonical
              concat <$> traverse (walk canonicalRoot False . (canonical </>)) entries
        else do
          isFile <- doesFileExist canonical
          pure [relative | isFile && FP.isExtensionOf ".hs" canonical]

posixPath :: FilePath -> FilePath
posixPath = map (\c -> if c == '\\' then '/' else c)

-- | Extract every Haskell file under the inputs.
extractTree :: FilePath -> [FilePath] -> IO (Artifact, TreeStats, [Text])
extractTree root inputs = do
  paths <- collectHaskellFiles root inputs
  results <- mapM (extractFile root) paths
  let modules = rights results
      failures = lefts results
      artifact = Artifact (sortBy (comparing modPath) modules)
      stats =
        TreeStats
          { tsFiles = length modules
          , tsAnnotatedFiles = length [() | m <- modules, not (null (modAnnotations m))]
          , tsAnnotations = sum [length (modAnnotations m) | m <- modules]
          , tsCppFiles = [modPath m | m <- modules, modCpp m]
          }
  pure (artifact, stats, failures)
