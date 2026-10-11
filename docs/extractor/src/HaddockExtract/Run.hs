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

import Data.Either (lefts, rights)
import Data.List (nub, sort, sortBy)
import Data.Ord (comparing)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import GHC.Types.SrcLoc (unLoc)
import HaddockExtract.Model
import HaddockExtract.Parse (ParseOutcome (..), parseSource, stripCpp)
import HaddockExtract.Walk (moduleAnnotations)
import System.Directory (doesDirectoryExist, doesFileExist, listDirectory)
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
  source <- TIO.readFile (root </> path)
  let (stripped, cpp) = stripCpp source
  pure $ case parseSource stripped path of
    Parsed _ _ lmod ->
      Right (moduleAnnotations cpp (T.pack (posixPath path)) (unLoc lmod))
    Failed err -> Left err

-- | Every Haskell file under the given repository-relative paths, path-sorted
-- and de-duplicated. Directories are walked recursively; non-Haskell files
-- are ignored. The order is what makes regeneration byte-identical.
collectHaskellFiles :: FilePath -> [FilePath] -> IO [FilePath]
collectHaskellFiles root inputs = do
  files <- concat <$> traverse walk inputs
  pure (sort (nub (map posixPath files)))
  where
    walk path = do
      isDir <- doesDirectoryExist (root </> path)
      if isDir
        then do
          entries <- listDirectory (root </> path)
          concat <$> traverse (walk . (path </>)) entries
        else do
          isFile <- doesFileExist (root </> path)
          pure [path | isFile && FP.isExtensionOf ".hs" path]

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
