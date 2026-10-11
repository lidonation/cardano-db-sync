-- | Golden test for the extractor.
--
-- Extracting @test/fixtures/Sample.hs@ must reproduce
-- @test/golden/haddock-annotations.json@ byte for byte, and a handful of
-- direct assertions pin the association rules: a @-- |@ above a signature
-- documents the function it names, constructor comments land on the
-- constructor, record-field comments on the field, and class-body docs join
-- their method signature by source position.
--
-- Run with @cabal test@ from @docs/extractor@. When the fixture changes,
-- regenerate the golden with:
--
-- > cabal run extract-haddock -- --repo-root . --out test/golden/haddock-annotations.json --input test/fixtures
module Main (main) where

import Control.Monad (forM_, unless)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BC
import Data.List (find)
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import HaddockExtract
import System.Directory (listDirectory)
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.IO

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  args <- getArgs
  let fixtureDir = case args of
        (d : _) -> d
        [] -> "test/fixtures"
  fixtures <- listDirectory fixtureDir
  (artifact, stats, failures) <- extractTree "." [fixtureDir]
  unless (null failures) $ do
    hPutStrLn stderr "golden-test: fixtures did not parse:"
    forM_ failures (hPutStrLn stderr . T.unpack)
    exitFailure

  -- One artifact entry per fixture file, and the fixture is documented.
  unless (tsFiles stats == length fixtures) $
    failWith ("expected one artifact entry per fixture file, got " <> show (tsFiles stats))
  unless (tsAnnotatedFiles stats >= 1) $
    failWith "no annotations extracted"

  let annotations = concatMap modAnnotations (artFiles artifact)

  assertEntity
    "area above its signature"
    (\a -> annName a == "area" && annKind a == FunctionKind && annPosition a == Before)
    annotations
    $ \a ->
      [ "doc"
          `holds` ( annDoc a
                      == "Compute the area of a shape.\n\nUsed by the schema explorer to show relative sizes."
                  )
      , "kind" `holds` (annKind a == FunctionKind)
      ]

  assertEntity
    "class method documented above"
    (\a -> annKind a == ClassMethodKind && annName a == "describe")
    annotations
    $ \a ->
      [ "doc" `holds` (annDoc a == "Render the value as a single line.")
      ]

  assertEntity
    "class method documented below"
    (\a -> annKind a == ClassMethodKind && annName a == "area" && annPosition a == After)
    annotations
    $ \a ->
      [ "doc" `holds` (annDoc a == "Attached to the method above.")
      ]

  assertEntity
    "class method documented above"
    (\a -> annKind a == ClassMethodKind && annName a == "area" && annPosition a == Before)
    annotations
    $ \a ->
      [ "doc" `holds` (annDoc a == "The area of the value.")
      ]

  assertEntity
    "data type"
    (\a -> annName a == "Shape" && annKind a == DataKind)
    annotations
    $ \a -> case annConstructors a of
      [s, c] ->
        [ "square" `holds` (conName s == "Square" && conDoc s == "A square, sized by its side.")
        , "side" `holds` (map fieldName (conFields s) == ["side"] && map fieldDoc (conFields s) == ["The side length, in drawing units."])
        , "circle" `holds` (conName c == "Circle" && conDoc c == "A circle, sized by its radius.")
        , "radius" `holds` (map fieldName (conFields c) == ["radius"] && map fieldDoc (conFields c) == ["The radius, in drawing units."])
        ]
      other ->
        [ "constructors" `holds` (length other == 2)
        ]

  assertEntity
    "section heading"
    (\a -> annKind a == SectionKind)
    annotations
    $ \a ->
      [ "doc" `holds` (annDoc a == "Rendering")
      ]

  assertEntity
    "named chunk"
    (\a -> annKind a == NamedKind && annName a == "setup")
    annotations
    $ \a ->
      [ "doc" `holds` ("How to draw the shape described above." `T.isInfixOf` annDoc a)
      ]

  assertEntity
    "instance"
    (\a -> annKind a == InstanceKind)
    annotations
    $ \a ->
      [ "doc" `holds` (annDoc a == "Shapes describe themselves.")
      ]

  -- The module header comment is the module's documentation.
  let headerChecks = case artFiles artifact of
        [moduleAnn] ->
          [
            ( "header"
            , "Fixture module for the golden test." `T.isPrefixOf` fromMaybe "" (modHeader moduleAnn)
            )
          , ("module", modModule moduleAnn == Just "Sample")
          , ("path", modPath moduleAnn == "test/fixtures/Sample.hs")
          ]
        other -> [("files", length other == 1)]
  forM_ [name | (name, False) <- headerChecks] $ \name ->
    failWith ("module-level check failed: " <> name)

  -- The whole artifact is byte-identical to the committed golden.
  let goldenPath = "test/golden/haddock-annotations.json"
  expected <- BS.readFile goldenPath
  let actual = encodeArtifact artifact
  if actual == expected
    then hPutStrLn stdout "golden-test: the artifact matches the golden file"
    else do
      hPutStrLn stderr ("golden-test: artifact differs from " <> goldenPath)
      hPutStrLn stderr (diff expected actual)
      exitFailure

failWith :: String -> IO a
failWith msg = do
  hPutStrLn stderr ("golden-test: " <> msg)
  exitFailure

holds :: String -> Bool -> (String, Bool)
holds = (,)

assertEntity :: String -> (Annotation -> Bool) -> [Annotation] -> (Annotation -> [(String, Bool)]) -> IO ()
assertEntity label pick anns checks = case find pick anns of
  Nothing -> failWith ("no annotation matched: " <> label)
  Just a -> do
    let failed = [n | (n, False) <- checks a]
    unless (null failed) $
      failWith (label <> " failed checks: " <> unwords failed)

diff :: BS.ByteString -> BS.ByteString -> String
diff expected actual =
  unlines
    [ "- " <> show e <> "\n+ " <> show a
    | (e, a) <- zip (split expected) (split actual)
    , e /= a
    ]
  where
    split = lines . BC.unpack
