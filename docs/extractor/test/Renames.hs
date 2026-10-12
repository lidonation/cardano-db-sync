-- | Tests for the B09 rename extractor.
--
-- The fixture tree @test/rename-fixtures@ must reproduce
-- @test/golden/schema-renames.json@ byte for byte, and direct assertions pin
-- the scanning rules (EXECUTE literals, folding, chains, owners) and the
-- failure modes. Against the real @schema/@ the two renames the DoD names —
-- @pool_offline_data → off_chain_pool_data@ and @deposits → deposits_stake@ —
-- must resolve at their version boundaries.
--
-- Run with @cabal test renames-test@ from @docs/extractor@. When a fixture
-- changes, regenerate the golden with
-- @cabal run renames-test -- --regenerate@.
module Main (main) where

import Control.Monad (unless, when)
import qualified Data.ByteString as BS
import Data.IORef
import Data.List (find)
import Data.Text (Text)
import qualified Data.Text as Text
import HaddockExtract.Model (encodeJson)
import RenameExtract
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.IO

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  args <- getArgs
  failures <- newIORef (0 :: Int)
  let check name ok = do
        putStrLn ((if ok then "ok    " else "FAIL  ") <> name)
        unless ok (modifyIORef' failures (+ 1))

  -- Fixtures
  fixture <- expectRight "fixtures" =<< extractRenames "test/rename-fixtures"
  let (files, fx) = fixture
      golden = "test/golden/schema-renames.json"
      encoded = encodeJson (renamesJson fx)
  when ("--regenerate" `elem` args) (BS.writeFile golden encoded)
  expected <- BS.readFile golden
  check "fixture output matches the golden byte for byte" (encoded == expected)
  check "only files named as migrations are read" (files == 3)
  check "a comment or block comment mentioning RENAME is not a rename" (length (rmRenames fx) == 7)

  check "a chain of table renames is one entity, oldest name first" $
    entity fx KTable "gamma" Nothing `formerIs` [("alpha", 2, 1), ("beta", 2, 2)]
  check "a column renamed before its table joins the table's latest name" $
    entity fx KColumn "newer_col" (Just "gamma") `formerIs` [("old_col", 2, 1), ("new_col", 2, 2)]
  check "unquoted identifiers fold to lower case" $
    any ((== "old_col") . rnFrom) (rmRenames fx)
  check "a doubled quote inside an EXECUTE literal is unescaped" $
    entity fx KConstraint "beta_unique" (Just "gamma") `formerIs` [("it's_unique", 2, 2)]
  check "a sequence rename" $
    entity fx KSequence "gamma_id_seq" Nothing `formerIs` [("beta_id_seq", 2, 2)]
  check "a stage-three index rename keeps its stage" $
    entity fx KIndex "idx_gamma_note" Nothing `formerIs` [("idx_alpha_note", 3, 1)]
  check "renames are listed in application order with their source line" $
    [(rnFrom r, rnLine r) | r <- take 2 (rmRenames fx)] == [("alpha", 9), ("old_col", 11)]

  -- Failure modes: never silently drop a rename
  let mig = Migration 2 8 "migration-2-0008-20200108.sql"
      fails src needle = case scanMigration mig src of
        Left errs -> any (needle `Text.isInfixOf`) errs
        Right _ -> False
  check "an unknown RENAME form fails, naming file and line" $
    fails "\n\nALTER TYPE mood RENAME VALUE 'sad' TO 'blue';" "migration-2-0008-20200108.sql:3: unrecognised RENAME"
  check "a rename assembled at run time fails" $
    fails "EXECUTE 'ALTER TABLE ' || quote_ident(t) || ' RENAME TO x';" "unrecognised RENAME"
  check "a version guard that disagrees with the filename fails" $
    fails "IF next_version = 7 THEN EXECUTE 'SELECT 1'; END IF;" "disagrees with the file's version 8"
  check "an unterminated literal fails" $
    fails "EXECUTE 'ALTER TABLE a RENAME TO b;" "unterminated"
  check "a statement with no rename yields nothing" $
    scanMigration mig "ALTER TABLE a ADD COLUMN renamed_at timestamp;" == Right []

  check "nested PostgreSQL block comments are ignored" $
    scanMigration mig "/* outer /* inner */ ALTER TABLE a RENAME TO b; */" == Right []
  check "uppercase version guards are validated" $
    fails "IF NEXT_VERSION = 7 THEN EXECUTE 'ALTER TABLE a RENAME TO b'; END IF;" "disagrees"
  check "every version guard is validated" $
    fails "IF next_version = 8 THEN SELECT 1; END IF; IF next_version = 7 THEN EXECUTE 'ALTER TABLE a RENAME TO b'; END IF;" "disagrees"
  check "non-public schemas cannot alias public objects" $
    fails "ALTER TABLE private.a RENAME TO b;" "unrecognised"
  check "domain constraints cannot alias table constraints" $
    fails "ALTER DOMAIN a RENAME CONSTRAINT old TO new;" "unrecognised"
  check "migration filenames require numeric stage/version and an eight-digit date" $
    all
      ((== Nothing) . parseMigrationName)
      ["migration-2-0008-garbage.sql", "migration-2-+008-20200108.sql", "migration--2-0008-20200108.sql", "migration-5-0008-20200108.sql"]

  check "stage-four migrations remain supported" $
    parseMigrationName "migration-4-0008-20200108.sql" == Just (Migration 4 8 "migration-4-0008-20200108.sql")
  invalid <- extractRenames "test/invalid-rename-fixtures"
  check "malformed migration filenames fail loudly instead of dropping renames" $
    case invalid of
      Left errs -> any ("invalid migration filename" `Text.isInfixOf`) errs
      Right _ -> False

  check "self-renames fail before emitting an unusable artifact" $
    fails "ALTER TABLE a RENAME TO a;" "unrecognised"
  collision <- extractRenames "test/collision-rename-fixtures"
  check "destination collisions do not silently lose former names" $
    case collision of
      Left errs -> any ("destination collision" `Text.isInfixOf`) errs
      Right _ -> False

  check "ordinary dollar strings do not execute embedded SQL" $
    scanMigration mig "SELECT $$; ALTER TABLE a RENAME TO b; $$;" == Right []
  check "DO dollar bodies still expose executed renames" $
    case scanMigration mig "DO $body$ BEGIN EXECUTE 'ALTER TABLE a RENAME TO b'; END $body$;" of
      Right [r] -> rnFrom r == "a" && rnTo r == "b"
      _ -> False
  check "unterminated dollar strings fail" $
    fails "SELECT $body$ unfinished" "unterminated dollar"

  check "EXECUTE dollar literals expose executed renames" $
    case scanMigration mig "DO $$ BEGIN EXECUTE $sql$ALTER TABLE a RENAME TO b$sql$; END $$;" of
      Right [r] -> rnFrom r == "a" && rnTo r == "b"
      _ -> False
  check "dynamic EXECUTE dollar concatenation fails loudly" $
    fails "DO $$ BEGIN EXECUTE $sql$ALTER TABLE $sql$ || t || $sql$ RENAME TO b$sql$; END $$;" "unrecognised"
  check "procedure dollar bodies expose executed renames" $
    case scanMigration mig "CREATE PROCEDURE migrate() LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'ALTER TABLE a RENAME TO b'; END $$;" of
      Right [r] -> rnFrom r == "a" && rnTo r == "b"
      _ -> False

  -- The real migrations
  real <- extractRenames "../.."
  case real of
    Left errs -> do
      check "the real schema/ scans with nothing unrecognised" False
      mapM_ (hPutStrLn stderr . Text.unpack) errs
    Right (_, rm) -> do
      check "the real schema/ scans with nothing unrecognised" True
      check "pool_offline_data -> off_chain_pool_data resolves at stage_two 26" $
        entity rm KTable "off_chain_pool_data" Nothing `formerIs` [("pool_offline_data", 2, 26)]
      check "deposits -> deposits_stake resolves on ada_pots at stage_two 34" $
        entity rm KColumn "deposits_stake" (Just "ada_pots") `formerIs` [("deposits", 2, 34)]
      check "instant_reward -> reward_rest resolves at stage_two 34" $
        entity rm KTable "reward_rest" Nothing `formerIs` [("instant_reward", 2, 34)]
      check "every RENAME statement in schema/ is in the map (13)" (length (rmRenames rm) == 13)

  n <- readIORef failures
  unless (n == 0) $ do
    hPutStrLn stderr ("renames-test: " <> show n <> " check(s) failed")
    exitFailure
  where
    expectRight what = \case
      Right x -> pure x
      Left errs -> do
        hPutStrLn stderr ("renames-test: " <> what <> " did not scan:")
        mapM_ (hPutStrLn stderr . Text.unpack) errs
        exitFailure

entity :: RenameMap -> ObjectKind -> Text -> Maybe Text -> Maybe Entity
entity rm k name table =
  find (\e -> enKind e == k && enName e == name && enTable e == table) (rmEntities rm)

formerIs :: Maybe Entity -> [(Text, Int, Int)] -> Bool
formerIs me expected = case me of
  Nothing -> False
  Just e -> [(fnName f, migStage (fnUntil f), migVersion (fnUntil f)) | f <- enFormer e] == expected
