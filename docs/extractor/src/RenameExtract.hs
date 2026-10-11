-- | The B09 rename extractor: scans the migration SQL under @schema/@ for
-- @RENAME TO@, @RENAME COLUMN@ and @RENAME CONSTRAINT@ statements and emits a
-- rename map, so a rename reads as continuity rather than remove-plus-add
-- (GDE-9).
--
-- The SQL is tokenised, never executed. Statements inside a migration's
-- PL/pgSQL body (@EXECUTE '…'@ string literals) are scanned like top-level
-- ones. Anything that mentions @RENAME@ but is not a form this module
-- understands fails the extraction, naming the file and line: a rename is
-- never silently dropped.
module RenameExtract (
  renamesSchemaVersion,
  renamesArtifactFile,
  schemaDir,
  ObjectKind (..),
  kindText,
  Migration (..),
  Rename (..),
  FormerName (..),
  Entity (..),
  RenameMap (..),
  parseMigrationName,
  scanMigration,
  buildRenameMap,
  extractRenames,
  renamesJson,
)
where

import Control.Monad (unless)
import Data.Aeson (Value, object, (.=))
import qualified Data.ByteString as BS
import Data.Char (isAlphaNum, isDigit, isSpace)
import Data.Either (partitionEithers)
import Data.List (sort, sortOn)
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe, mapMaybe)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as TE
import System.Directory (listDirectory)
import System.FilePath ((</>))
import Text.Read (readMaybe)

-- | Version of the rename artifact schema. Bump when a field is removed or
-- its meaning changes; consumers refuse unknown versions.
renamesSchemaVersion :: Int
renamesSchemaVersion = 1

-- | Where the artifact is committed, relative to @docs/@.
renamesArtifactFile :: FilePath
renamesArtifactFile = "generated/schema-renames.json"

-- | The migration directory, repository-relative.
schemaDir :: FilePath
schemaDir = "schema"

-- | What a rename renames.
data ObjectKind
  = KTable
  | KColumn
  | KConstraint
  | KSequence
  | KIndex
  | KView
  | KType
  | KDomain
  deriving (Eq, Ord, Show, Enum, Bounded)

kindText :: ObjectKind -> Text
kindText = \case
  KTable -> "table"
  KColumn -> "column"
  KConstraint -> "constraint"
  KSequence -> "sequence"
  KIndex -> "index"
  KView -> "view"
  KType -> "type"
  KDomain -> "domain"

-- | A migration file: @migration-<stage>-<version>-<date>.sql@.
data Migration = Migration
  { migStage :: Int
  , migVersion :: Int
  , migFile :: FilePath
  }
  deriving (Eq, Ord, Show)

-- | One rename statement, in the order the migrations apply it.
data Rename = Rename
  { rnKind :: ObjectKind
  , rnTable :: Maybe Text
  -- ^ The owning table as named when the statement ran (columns and
  -- constraints only).
  , rnFrom :: Text
  , rnTo :: Text
  , rnMigration :: Migration
  , rnLine :: Int
  }
  deriving (Eq, Show)

-- | A name an entity carried until a migration renamed it away.
data FormerName = FormerName
  { fnName :: Text
  , fnUntil :: Migration
  -- ^ the first migration in which the entity no longer has this name
  }
  deriving (Eq, Show)

-- | One renamed entity: its latest name and every name it had before.
data Entity = Entity
  { enKind :: ObjectKind
  , enTable :: Maybe Text
  -- ^ The owning table's latest name (columns and constraints only).
  , enName :: Text
  , enFormer :: [FormerName]
  -- ^ oldest first
  }
  deriving (Eq, Show)

data RenameMap = RenameMap
  { rmRenames :: [Rename]
  , rmEntities :: [Entity]
  }
  deriving (Eq, Show)

-- | Parse @migration-2-0026-20231017.sql@. Files not named this way are not
-- migrations.
parseMigrationName :: FilePath -> Maybe Migration
parseMigrationName file = case Text.splitOn "-" (Text.pack file) of
  ["migration", stage, version, rest]
    | Just s <- readMaybe (Text.unpack stage)
    , Text.length version == 4
    , Just v <- readMaybe (Text.unpack version)
    , ".sql" `Text.isSuffixOf` rest ->
        Just (Migration s v file)
  _ -> Nothing

-- * Tokens

data Tok
  = TWord Text
  | -- | a double-quoted identifier, unescaped
    TQuoted Text
  | -- | a single-quoted string literal, unescaped
    TString Text
  | TSemi
  | TSym Char
  deriving (Eq, Show)

data Located = Located {locLine :: Int, locTok :: Tok}
  deriving (Show)

-- | Tokenise SQL. Comments are dropped and dollar-quote delimiters are
-- transparent, so a function body is tokenised like top-level SQL.
tokenise :: Int -> Text -> Either (Int, Text) [Located]
tokenise = go
  where
    go line s = case Text.uncons s of
      Nothing -> Right []
      Just (c, rest)
        | c == '\n' -> go (line + 1) rest
        | isSpace c -> go line rest
        | "--" `Text.isPrefixOf` s -> go line (Text.dropWhile (/= '\n') s)
        | "/*" `Text.isPrefixOf` s ->
            let (body, after) = Text.breakOn "*/" (Text.drop 2 s)
             in if Text.null after
                  then Left (line, "unterminated block comment")
                  else go (line + Text.count "\n" body) (Text.drop 2 after)
        | c == '$', Just after <- dollarTag rest -> go line after
        | c == '\'' -> quoted '\'' TString line rest
        | c == '"' -> quoted '"' TQuoted line rest
        | c == ';' -> (Located line TSemi :) <$> go line rest
        | isWordChar c ->
            let (w, after) = Text.span isWordChar s
             in (Located line (TWord w) :) <$> go line after
        | otherwise -> (Located line (TSym c) :) <$> go line rest

    -- @$$@ or @$tag$@: the rest of the input after the closing @$@
    dollarTag rest =
      let (tag, after) = Text.span (\x -> isAlphaNum x || x == '_') rest
       in case Text.uncons after of
            Just ('$', after') | Text.all (not . isDigit) (Text.take 1 tag) -> Just after'
            _ -> Nothing

    -- a quoted token, with the quote doubled as its escape
    quoted q mk line = scan ""
      where
        scan acc t = case Text.breakOn (Text.singleton q) t of
          (_, after) | Text.null after -> Left (line, "unterminated " <> Text.singleton q <> " quote")
          (chunk, after)
            | Text.singleton q `Text.isPrefixOf` Text.drop 1 after ->
                scan (acc <> chunk <> Text.singleton q) (Text.drop 2 after)
            | otherwise ->
                let body = acc <> chunk
                 in (Located line (mk body) :)
                      <$> go (line + Text.count "\n" body) (Text.drop 1 after)

    isWordChar x = isAlphaNum x || x == '_'

-- | Split tokens into statements on @;@.
statements :: [Located] -> [[Located]]
statements toks = case break ((== TSemi) . locTok) toks of
  ([], []) -> []
  (stmt, []) -> [stmt]
  ([], _ : rest) -> statements rest
  (stmt, _ : rest) -> stmt : statements rest

-- * Scanning

-- | Every rename in one migration file, in statement order, or every reason
-- the file could not be read as @file:line: message@.
scanMigration :: Migration -> Text -> Either [Text] [Rename]
scanMigration mig src = do
  toks <- either (\(l, e) -> Left [at l e]) Right (tokenise 1 src)
  guardCheck toks
  let (errs, found) = partitionEithers (concatMap (statement 0) (statements toks))
  unless (null errs) (Left errs)
  pure (concat found)
  where
    at :: Int -> Text -> Text
    at l msg = Text.pack (migFile mig) <> ":" <> Text.pack (show l) <> ": " <> msg

    -- A versioned migration guards its body with @IF next_version = N@; the
    -- rename map keys renames by that version, so it must agree with the
    -- filename.
    guardCheck toks = case [(locLine l, n) | (l@(Located _ (TWord "next_version")), Located _ (TSym '='), Located _ (TWord n)) <- triples toks] of
      (l, n) : _
        | readMaybe (Text.unpack n) /= Just (migVersion mig) ->
            Left [at l ("guard `next_version = " <> n <> "` disagrees with the file's version " <> Text.pack (show (migVersion mig)))]
      _ -> Right ()

    triples xs = zip3 xs (drop 1 xs) (drop 2 xs)

    -- One statement: an @EXECUTE 'sql'@ is scanned as the SQL it runs.
    statement :: Int -> [Located] -> [Either Text [Rename]]
    -- The literal may follow control flow in the same statement
    -- (@IF next_version = 26 THEN EXECUTE '…'@), so the prefix is scanned too.
    statement depth stmt = case reverse stmt of
      Located _ (TString body) : Located l (TWord w) : before
        | upper w == "EXECUTE" ->
            statement depth (reverse before) ++ case tokenise l body of
              Left (l', e) -> [Left (at l' e)]
              Right inner
                | depth > 4 -> [Left (at l "EXECUTE nested too deeply")]
                | otherwise -> concatMap (statement (depth + 1)) (statements inner)
      _
        | any (isRename . locTok) stmt -> [rename stmt]
        | otherwise -> []

    isRename = \case
      TWord w -> upper w == "RENAME"
      -- a rename assembled at run time (concatenation, format()) cannot be
      -- read; fail rather than miss it
      TString s -> "RENAME" `Text.isInfixOf` Text.toUpper s
      _ -> False

    rename :: [Located] -> Either Text [Rename]
    rename stmt = maybe (Left (at line ("unrecognised RENAME statement: " <> render stmt))) Right (parseRename (map locTok stmt))
      where
        line = maybe 1 locLine (safeHead stmt)
        parseRename toks = do
          rest0 <- keyword "ALTER" toks
          (kind, rest1) <- objectKind rest0
          let rest2 = optional ["IF", "EXISTS"] rest1
              rest3 = optional ["ONLY"] rest2
          (name, rest4) <- qualifiedName rest3
          let rest5 = case rest4 of TSym '*' : r -> r; r -> r
          rest6 <- keyword "RENAME" rest5
          let mk k tbl from to = Rename k tbl from to mig line
          case rest6 of
            TWord t : new | upper t == "TO" -> do
              (to, []) <- identifier new
              pure [mk kind Nothing name to]
            TWord c : old
              | upper c == "CONSTRAINT"
              , kind `elem` [KTable, KDomain] -> do
                  (from, rest7) <- identifier old
                  (to, []) <- identifier =<< keyword "TO" rest7
                  pure [mk KConstraint (Just name) from to]
            _ | kind == KTable -> do
              let cols = optional ["COLUMN"] rest6
              (from, rest7) <- identifier cols
              (to, []) <- identifier =<< keyword "TO" rest7
              pure [mk KColumn (Just name) from to]
            _ -> Nothing

    objectKind = \case
      TWord w : rest -> case upper w of
        "TABLE" -> Just (KTable, rest)
        "INDEX" -> Just (KIndex, rest)
        "SEQUENCE" -> Just (KSequence, rest)
        "VIEW" -> Just (KView, rest)
        "TYPE" -> Just (KType, rest)
        "DOMAIN" -> Just (KDomain, rest)
        _ -> Nothing
      _ -> Nothing

    keyword k = \case
      TWord w : rest | upper w == k -> Just rest
      _ -> Nothing

    optional ks toks = fromMaybe toks (foldr (\k acc t -> keyword k t >>= acc) Just ks toks)

    -- @name@ or @schema.name@; the schema is dropped.
    qualifiedName toks = do
      (first, rest) <- identifier toks
      case rest of
        TSym '.' : more -> identifier more
        _ -> pure (first, rest)

    -- Unquoted identifiers fold to lower case, as PostgreSQL folds them.
    identifier = \case
      TWord w : rest | not (isReserved w) -> Just (Text.toLower w, rest)
      TQuoted q : rest -> Just (q, rest)
      _ -> Nothing

    isReserved w = upper w `elem` ["TO", "RENAME", "COLUMN", "CONSTRAINT"]

    upper = Text.toUpper

    render = Text.unwords . map (renderTok . locTok)
    renderTok = \case
      TWord w -> w
      TQuoted q -> "\"" <> q <> "\""
      TString s -> "'" <> s <> "'"
      TSemi -> ";"
      TSym c -> Text.singleton c

safeHead :: [a] -> Maybe a
safeHead = \case
  x : _ -> Just x
  [] -> Nothing

-- * The map

-- | Fold renames (in application order) into entities. A rename of a name
-- an entity already carries extends that entity, so chains
-- (@a → b → c@) read as one entity with two former names. Columns and
-- constraints are keyed by their owning table's latest name, so a column
-- renamed before its table was renamed still joins the right table.
buildRenameMap :: [Rename] -> RenameMap
buildRenameMap renames = RenameMap ordered (sortOn entityKey (Map.elems final))
  where
    ordered = sortOn (\r -> (rnMigration r, rnLine r)) renames
    indexed = zip [0 :: Int ..] ordered

    -- the latest name of a table named @t@ just after rename @i@ ran
    tableAfter i t = foldl step t [r | (j, r) <- indexed, j > i, rnKind r == KTable]
      where
        step name r = if rnFrom r == name then rnTo r else name

    final = foldl add Map.empty indexed

    add acc (i, r) =
      let owner = tableAfter i <$> rnTable r
          key = (rnKind r, owner, rnFrom r)
          former = FormerName (rnFrom r) (rnMigration r)
          entity = case Map.lookup key acc of
            Just e -> e {enName = rnTo r, enFormer = enFormer e ++ [former]}
            Nothing -> Entity (rnKind r) owner (rnTo r) [former]
       in Map.insert (rnKind r, owner, rnTo r) entity (Map.delete key acc)

    entityKey e = (enKind e, enTable e, enName e)

-- | Scan every migration under @schema/@ in a repository root. 'Left'
-- carries every problem found, across all files.
extractRenames :: FilePath -> IO (Either [Text] (Int, RenameMap))
extractRenames root = do
  files <- sort <$> listDirectory (root </> schemaDir)
  let migrations = mapMaybe parseMigrationName files
  results <- mapM scanFile migrations
  let (errs, found) = partitionEithers results
  pure $
    if null errs && not (null migrations)
      then Right (length migrations, buildRenameMap (concat found))
      else Left (if null migrations then ["no migration files under " <> Text.pack schemaDir] else concat errs)
  where
    scanFile mig = do
      bytes <- BS.readFile (root </> schemaDir </> migFile mig)
      pure $ case TE.decodeUtf8' bytes of
        Left err -> Left [Text.pack (migFile mig) <> ": not valid UTF-8: " <> Text.pack (show err)]
        Right src -> scanMigration mig src

-- * JSON

-- | The committed artifact.
renamesJson :: RenameMap -> Value
renamesJson RenameMap {..} =
  object
    [ "schemaVersion" .= renamesSchemaVersion
    , "source" .= Text.pack schemaDir
    , "renames" .= map renameJson rmRenames
    , "entities" .= map entityJson rmEntities
    ]

renameJson :: Rename -> Value
renameJson Rename {..} =
  object $
    [ "kind" .= kindText rnKind
    , "from" .= rnFrom
    , "to" .= rnTo
    , "migration" .= migrationJson rnMigration
    , "line" .= rnLine
    ]
      ++ ["table" .= t | Just t <- [rnTable]]

entityJson :: Entity -> Value
entityJson Entity {..} =
  object $
    [ "kind" .= kindText enKind
    , "name" .= enName
    , "formerNames" .= [object ["name" .= fnName f, "until" .= migrationJson (fnUntil f)] | f <- enFormer]
    ]
      ++ ["table" .= t | Just t <- [enTable]]

migrationJson :: Migration -> Value
migrationJson Migration {..} =
  object ["stage" .= migStage, "version" .= migVersion, "file" .= Text.pack migFile]
