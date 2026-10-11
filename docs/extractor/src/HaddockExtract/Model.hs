{-# LANGUAGE OverloadedStrings #-}

-- | The committed annotation artifact: its shape, its JSON encoding, and the
-- enumeration of declaration kinds every writer and consumer agrees on.
--
-- The artifact is deliberately free of timestamps, tool versions and absolute
-- paths so that regeneration is byte-identical (CON-2).
module HaddockExtract.Model (
  Artifact (..),
  ModuleAnnotations (..),
  Annotation (..),
  Constructor (..),
  ConField (..),
  Kind (..),
  Position (..),
  kindText,
  positionText,
  schemaVersion,
  artifactFile,
  encodeArtifact,
)
where

import Data.Aeson (ToJSON (..), Value (..), object, (.=))
import qualified Data.Aeson.Key as Key
import qualified Data.Aeson.KeyMap as KM
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.ByteString.Builder (Builder, byteString, stringUtf8, toLazyByteString)
import qualified Data.ByteString.Lazy as BL
import Data.List (sortOn)
import Data.Scientific (Scientific)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.Vector as V

-- | Version of the artifact schema. Bump when a field is removed or its
-- meaning changes; consumers refuse unknown versions.
schemaVersion :: Int
schemaVersion = 1

-- | Where the artifact is committed, relative to the @docs/@ directory.
artifactFile :: FilePath
artifactFile = "generated/haddock-annotations.json"

-- | What kind of declaration an annotation documents.
data Kind
  = DataKind
  | NewtypeKind
  | TypeSynonymKind
  | TypeFamilyKind
  | DataFamilyKind
  | ClassKind
  | FunctionKind
  | BindingKind
  | SignatureKind
  | InstanceKind
  | ForeignKind
  | ClassMethodKind
  | SectionKind
  | NamedKind
  deriving (Eq, Show)

-- | How the annotation was written in the source.
--
-- * @Before@ — a @-- |@ (or @{-|@) comment above the declaration.
-- * @After@ — a @-- ^@ comment after the declaration.
-- * @Section@ — a @-- *@ heading.
-- * @Named@ — a @-- $name@ chunk.
data Position
  = Before
  | After
  | Section
  | Named
  deriving (Eq, Show)

kindText :: Kind -> Text
kindText = \case
  DataKind -> "data"
  NewtypeKind -> "newtype"
  TypeSynonymKind -> "type-synonym"
  TypeFamilyKind -> "type-family"
  DataFamilyKind -> "data-family"
  ClassKind -> "class"
  FunctionKind -> "function"
  BindingKind -> "binding"
  SignatureKind -> "signature"
  InstanceKind -> "instance"
  ForeignKind -> "foreign"
  ClassMethodKind -> "class-method"
  SectionKind -> "section"
  NamedKind -> "named"

positionText :: Position -> Text
positionText = \case
  Before -> "before"
  After -> "after"
  Section -> "section"
  Named -> "named"

-- | A documented data constructor (or GADT constructor) of a data type.
data Constructor = Constructor
  { conName :: Text
  , conDoc :: Text
  , conFields :: [ConField]
  }
  deriving (Eq, Show)

-- | A documented record field, in the constructor that carries it.
data ConField = ConField
  { fieldName :: Text
  , fieldDoc :: Text
  }
  deriving (Eq, Show)

-- | One Haddock annotation, attached to the declaration it documents.
data Annotation = Annotation
  { annName :: Text
  , annKind :: Kind
  , annLine :: Int
  , annDoc :: Text
  , annPosition :: Position
  , annConstructors :: [Constructor]
  , annSectionLevel :: Maybe Int
  }
  deriving (Eq, Show)

-- | Everything extracted from one Haskell file.
data ModuleAnnotations = ModuleAnnotations
  { modPath :: Text
  , modModule :: Maybe Text
  , modHeader :: Maybe Text
  , modCpp :: Bool
  , modAnnotations :: [Annotation]
  }
  deriving (Eq, Show)

-- | The whole committed artifact.
data Artifact = Artifact
  { artFiles :: [ModuleAnnotations]
  }
  deriving (Eq, Show)

instance ToJSON ConField where
  toJSON ConField {..} =
    object
      [ "name" .= fieldName
      , "doc" .= fieldDoc
      ]

instance ToJSON Constructor where
  toJSON Constructor {..}
    | null conFields =
        object
          [ "name" .= conName
          , "doc" .= conDoc
          ]
    | otherwise =
        object
          [ "name" .= conName
          , "doc" .= conDoc
          , "fields" .= conFields
          ]

instance ToJSON Annotation where
  toJSON Annotation {..} =
    object $
      [ "name" .= annName
      , "kind" .= kindText annKind
      , "line" .= annLine
      , "doc" .= annDoc
      , "position" .= positionText annPosition
      ]
        ++ ["constructors" .= annConstructors | not (null annConstructors)]
        ++ ["sectionLevel" .= level | Just level <- [annSectionLevel]]

instance ToJSON ModuleAnnotations where
  toJSON ModuleAnnotations {..} =
    object $
      [ "path" .= modPath
      , "module" .= modModule
      , "header" .= modHeader
      , "annotations" .= modAnnotations
      ]
        ++ ["cpp" .= True | modCpp]

instance ToJSON Artifact where
  toJSON Artifact {..} =
    object
      [ "schemaVersion" .= schemaVersion
      , "files" .= artFiles
      ]

-- | Encode the artifact as the exact bytes that get committed: a two-space
-- indented JSON document followed by a single trailing newline — precisely
-- what @prettier@ emits for JSON, so the committed artifact passes
-- @prettier --check@ and regeneration is byte-identical (CON-2).
encodeArtifact :: Artifact -> ByteString
encodeArtifact art =
  BL.toStrict (toLazyByteString (render 0 (toJSON art) <> byteString "\n"))

-- | Render a JSON value the way prettier's JSON printer does: two-space
-- indentation, no line is ever wrapped or broken across lines, and empty
-- objects and arrays stay on one line.
render :: Int -> Value -> Builder
render indent value = case value of
  Object pairs -> renderObject indent pairs
  Array items -> renderArray indent (V.toList items)
  String t -> renderString t
  Number n -> renderNumber n
  Bool b -> if b then "true" else "false"
  Null -> "null"

renderObject :: Int -> KM.KeyMap Value -> Builder
renderObject indent pairs
  | null entries = "{}"
  | otherwise =
      mconcat
        [ "{\n"
        , sepBy ",\n" (map (renderPair indent) entries)
        , "\n"
        , pad indent
        , "}"
        ]
  where
    -- aeson's KeyMap makes no ordering promise, so the encoded order is fixed
    -- here: the artifact must regenerate byte-identically.
    entries = sortOn fst (KM.toList pairs)

renderPair :: Int -> (Key.Key, Value) -> Builder
renderPair indent (k, v) =
  pad (indent + 1) <> renderString (Key.toText k) <> ": " <> render (indent + 1) v

renderArray :: Int -> [Value] -> Builder
renderArray indent items
  | null items = "[]"
  | otherwise =
      mconcat
        [ "[\n"
        , sepBy ",\n" (map (renderItem indent) items)
        , "\n"
        , pad indent
        , "]"
        ]

renderItem :: Int -> Value -> Builder
renderItem indent v = pad (indent + 1) <> render (indent + 1) v

sepBy :: Builder -> [Builder] -> Builder
sepBy sep = mconcat . intercalate' sep
  where
    -- Go through the 'intersperse' dance without allocating separators where
    -- there is nothing to separate.
    intercalate' _ [] = []
    intercalate' _ [x] = [x]
    intercalate' s (x : xs) = x : s : intercalate' s xs

pad :: Int -> Builder
pad n = byteString (BS.replicate (fromIntegral (2 * n)) 0x20)

renderString :: Text -> Builder
renderString t = byteString "\"" <> foldMap escapeChar (T.unpack t) <> byteString "\""

escapeChar :: Char -> Builder
escapeChar c = case c of
  '"' -> "\\\""
  '\\' -> "\\\\"
  '\b' -> "\\b"
  '\f' -> "\\f"
  '\n' -> "\\n"
  '\r' -> "\\r"
  '\t' -> "\\t"
  _
    | c < '\x20' -> "\\u" <> hex4 (fromEnum c)
    | otherwise -> TE.encodeUtf8Builder (T.singleton c)

hex4 :: Int -> Builder
hex4 n =
  mconcat
    [ "0"
    , hexD (n `div` 4096)
    , hexD ((n `div` 256) `mod` 16)
    , hexD ((n `div` 16) `mod` 16)
    , hexD (n `mod` 16)
    ]
  where
    hexD d = byteString (BS.singleton (toEnum (fromEnum '0' + d + (if d < 10 then 0 else fromEnum 'a' - fromEnum '0' - 10))))

-- | Every number in the artifact is an @Int@ (line numbers, schema version,
-- section levels); integral scientifics render without an exponent or a
-- trailing @.0@, exactly as prettier prints JSON numbers.
renderNumber :: Scientific -> Builder
renderNumber n = stringUtf8 (show (round n :: Integer))
