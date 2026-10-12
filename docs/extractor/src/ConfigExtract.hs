-- | The B10 config extractor: the @FromJSON@ instances db-sync parses its
-- config file with, read (never compiled) into a committed JSON schema that
-- the config wizard and its CON-4 gate consume.
module ConfigExtract (
  configSchemaVersion,
  configArtifactFile,
  configSources,
  configRoot,
  extractConfig,
  schemaJson,
  module ConfigExtract.Interp,
)
where

import ConfigExtract.Interp
import ConfigExtract.Syntax
import Data.Aeson (Value (..), object, (.=))
import qualified Data.Aeson.Key as Key
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString as BS
import Data.Either (lefts, rights)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as TE
import GHC.Types.SrcLoc (unLoc)
import HaddockExtract.Parse (ParseOutcome (..), parseSource, stripCpp)
import System.FilePath ((</>))

-- | Version of the config artifact schema. Bump when a field is removed or
-- its meaning changes; consumers refuse unknown versions.
configSchemaVersion :: Int
configSchemaVersion = 2

-- | Where the artifact is committed, relative to @docs/@.
configArtifactFile :: FilePath
configArtifactFile = "generated/config-schema.json"

-- | The modules read, repository-relative: the config types and their
-- parsers, and the reader that hands the tracing keys to trace-dispatcher.
configSources :: [FilePath]
configSources =
  [ "cardano-db-sync/src/Cardano/DbSync/Config.hs"
  , "cardano-db-sync/src/Cardano/DbSync/Config/Types.hs"
  ]

-- | The type the config file parses as.
configRoot :: Text
configRoot = "SyncPreConfig"

-- | Parse the sources under a repository root and extract the schema.
-- 'Left' carries every file that failed to parse.
extractConfig :: FilePath -> [FilePath] -> Text -> IO (Either [Text] Schema)
extractConfig root sources rootType = do
  parsed <- mapM parseOne sources
  case lefts parsed of
    [] -> pure (Right (extractSchema (mconcatSyntax (rights parsed)) rootType))
    errs -> pure (Left errs)
  where
    -- Sources are decoded as UTF-8 whatever the locale, as B07 does: the
    -- extraction must be the same on every machine.
    parseOne path = do
      bytes <- BS.readFile (root </> path)
      pure $ case TE.decodeUtf8' bytes of
        Left err -> Left (Text.pack (path <> ": not valid UTF-8: " <> show err))
        Right src ->
          let (stripped, _) = stripCpp src
           in case parseSource stripped path of
                Parsed _ _ lmod -> Right (lowerModule (unLoc lmod))
                Failed err -> Left err

mconcatSyntax :: [ModuleSyntax] -> ModuleSyntax
mconcatSyntax = foldr merge (ModuleSyntax Map.empty Map.empty Map.empty Map.empty)
  where
    merge a b =
      ModuleSyntax
        (Map.union (msData a) (msData b))
        (Map.union (msInstances a) (msInstances b))
        (Map.union (msBinds a) (msBinds b))
        (Map.union (msSigs a) (msSigs b))

-- | The committed artifact. Keys keep their source order (arrays); objects
-- are rendered with sorted keys by the encoder, so output is byte-stable.
schemaJson :: [FilePath] -> Text -> Schema -> Value
schemaJson sources rootType Schema {..} =
  object
    [ "schemaVersion" .= configSchemaVersion
    , "sources" .= map Text.pack sources
    , "root" .= rootType
    , "config" .= shapeJson schemaRoot
    , "passthrough"
        .= [ object ["keys" .= ptKeys p, "reader" .= ptReader p]
           | p <- schemaPassthrough
           ]
    , "unresolved" .= schemaUnresolved
    ]

shapeJson :: Shape -> Value
shapeJson shape = case shape of
  SBool -> object ["type" .= ("boolean" :: Text)]
  SInt t lo hi ->
    object $
      ["type" .= ("integer" :: Text), "haskell" .= t]
        ++ ["minimum" .= n | Just n <- [lo]]
        ++ ["maximum" .= n | Just n <- [hi]]
  SString -> object ["type" .= ("string" :: Text)]
  SEnum vals -> object ["type" .= ("enum" :: Text), "values" .= vals]
  SArray minItems s ->
    object $
      ["type" .= ("array" :: Text), "items" .= shapeJson s]
        ++ ["minItems" .= minItems | minItems > 0]
  SOpaque t -> object ["type" .= ("opaque" :: Text), "haskell" .= t]
  SNullable s -> case shapeJson s of
    Object o -> Object (KM.insert "nullable" (Bool True) o)
    other -> other
  SObject t line keys presets ->
    object $
      [ "type" .= ("object" :: Text)
      , "haskell" .= t
      , "line" .= line
      , "keys" .= map keyJson keys
      ]
        ++ ["presets" .= map presetJson presets | not (null presets)]

keyJson :: Key -> Value
keyJson Key {..} =
  object $
    [ "name" .= keyName
    , "required" .= keyRequired
    , "shape" .= shapeJson keyShape
    ]
      ++ ["default" .= d | Just d <- [keyDefault]]

presetJson :: Preset -> Value
presetJson Preset {..} =
  object
    [ "key" .= presetKey
    , "values"
        .= Object
          ( KM.fromList
              [ (Key.fromText lit, Object (KM.fromList [(Key.fromText k, v) | (k, v) <- entries]))
              | (lit, entries) <- presetValues
              ]
          )
    ]
