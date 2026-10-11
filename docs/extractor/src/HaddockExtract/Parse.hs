-- | Parsing a Haskell source with 'ghc-lib-parser', without compiling it.
--
-- The extractor parses module by module (CON-2): no package database, no
-- cabal build, no typechecking. What the parser gives us is the AST with
-- Haddock comments attached, which GHC inserts during parsing when the
-- @-haddock@ option is on (see @GHC.Parser.PostProcess.Haddock@: comments
-- become @DocD@ declarations interleaved with the declarations they document,
-- and a module header comment becomes @hsmodHaddockModHeader@).
module HaddockExtract.Parse (
  ParseOutcome (..),
  parseSource,
  parserExtensions,
  stripCpp,
)
where

import Data.Foldable (toList)
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Data.EnumSet (EnumSet, empty, fromList)
import GHC.Data.FastString (mkFastString)
import GHC.Data.StringBuffer (stringToStringBuffer)
import GHC.Hs (GhcPs, HsModule (..), LHsDoc, XModulePs (..))
import GHC.Hs.Doc (WithHsDocIdentifiers (..))
import GHC.Hs.DocString (renderHsDocString)
import GHC.LanguageExtensions (Extension (..))
import GHC.Parser (parseModule)
import GHC.Parser.Errors.Types (PsMessage)
import GHC.Parser.Lexer (
  ParseResult (PFailed, POk),
  getPsErrorMessages,
  getPsMessages,
  initParserState,
  mkParserOpts,
  unP,
 )
import GHC.Types.Error (Diagnostic (..), Messages)
import GHC.Types.SrcLoc (Located, mkRealSrcLoc, unLoc)
import GHC.Utils.Error (DiagOpts (..), errorsFound, pprMessages)
import GHC.Utils.Outputable (defaultSDocContext, showSDocOneLine)

-- | The result of parsing one file: either the parsed module with Haddock
-- comments attached, or the reason it could not be parsed.
data ParseOutcome
  = -- | @Parsed cpp header module@ — the module, whether the file needed CPP
    -- stripping, and the module-header Haddock comment (if any).
    Parsed Bool (Maybe Text) (Located (HsModule GhcPs))
  | Failed Text

-- | The language extensions the extractor parses with.
--
-- The files we read are compiled with per-package @default-extensions@ plus
-- their own @{-# LANGUAGE ... #-} pragmas. Rather than replicate each
-- package's cabal file, we parse with a generous fixed set: extensions only
-- matter to us where they change the grammar, and enabling more than a file
-- needs never changes how it parses.
parserExtensions :: EnumSet Extension
parserExtensions =
  fromList
    [ Arrows
    , BangPatterns
    , BinaryLiterals
    , BlockArguments
    , ConstraintKinds
    , DataKinds
    , DefaultSignatures
    , DeriveAnyClass
    , DeriveDataTypeable
    , DeriveFoldable
    , DeriveFunctor
    , DeriveGeneric
    , DeriveTraversable
    , DerivingStrategies
    , DerivingVia
    , DisambiguateRecordFields
    , DuplicateRecordFields
    , EmptyCase
    , EmptyDataDecls
    , ExistentialQuantification
    , ExplicitForAll
    , ExplicitNamespaces
    , FlexibleContexts
    , FlexibleInstances
    , ForeignFunctionInterface
    , FunctionalDependencies
    , GADTSyntax
    , GADTs
    , GeneralizedNewtypeDeriving
    , ImplicitParams
    , ImportQualifiedPost
    , ImpredicativeTypes
    , IncoherentInstances
    , InstanceSigs
    , KindSignatures
    , LambdaCase
    , LiberalTypeSynonyms
    , LinearTypes
    , MagicHash
    , MonadComprehensions
    , MonoLocalBinds
    , MultiParamTypeClasses
    , MultiWayIf
    , NamedFieldPuns
    , NamedWildCards
    , NegativeLiterals
    , NumericUnderscores
    , OverloadedLabels
    , OverloadedLists
    , OverloadedRecordDot
    , OverloadedStrings
    , PackageImports
    , PatternGuards
    , PatternSynonyms
    , PolyKinds
    , PostfixOperators
    , QuasiQuotes
    , RankNTypes
    , RecursiveDo
    , RoleAnnotations
    , ScopedTypeVariables
    , StandaloneDeriving
    , StandaloneKindSignatures
    , StarIsType
    , StaticPointers
    , Strict
    , StrictData
    , TupleSections
    , TemplateHaskell
    , TraditionalRecordSyntax
    , TypeApplications
    , TypeFamilies
    , TypeFamilyDependencies
    , TypeOperators
    , TypeSynonymInstances
    , UnboxedSums
    , UnboxedTuples
    , UndecidableInstances
    , UnicodeSyntax
    , UnliftedFFITypes
    , UnliftedNewtypes
    , ViewPatterns
    ]

-- | Strip preprocessor directives so the remaining text parses.
--
-- The Haskell tree must never be compiled to be documented, so there is no
-- CPP pass to depend on: preprocessor lines are removed instead, keeping both
-- sides of a conditional. That keeps the result deterministic (the extractor
-- must regenerate byte-identical output), keeps every Haddock comment in the
-- file, and leaves layout intact — CPP directives always start at the
-- beginning of a line (leading whitespace allowed, which the lexer accepts
-- too). A file that needed this is flagged in the artifact (@cpp: true@).
stripCpp :: Text -> (Text, Bool)
stripCpp src
  | any isDirective (T.lines src) = (T.unlines (filter (not . isDirective) (T.lines src)), True)
  | otherwise = (src, False)
  where
    isDirective line = case T.dropWhile (== ' ') line of
      rest -> not (T.null rest) && T.head rest == '#'

-- | Parse a Haskell source with Haddock comments attached to the AST.
--
-- A file that fails to parse — or that leaves the parser with diagnostics
-- after producing a module — is reported as 'Failed': a file that does not
-- parse cleanly must not silently contribute partial documentation.
parseSource :: Text -> FilePath -> ParseOutcome
parseSource source path =
  case unP parseModule initialState of
    POk final lmod
      | errorsFound errs -> Failed (T.pack path <> ":\n" <> renderMessages errs)
      | otherwise -> Parsed False header lmod
      where
        (_, errs) = getPsMessages final
        header = fmap (T.pack . renderHsDocString . hsDocString . unLoc) (moduleHeader lmod)
    PFailed final ->
      Failed (T.pack path <> ":\n" <> renderMessages (getPsErrorMessages final))
  where
    initialState =
      initParserState
        options
        (stringToStringBuffer (T.unpack source))
        (mkRealSrcLoc (mkFastString path) 1 1)
    options =
      mkParserOpts
        parserExtensions
        diagOpts
        [] -- supported extensions: only used for did-you-mean suggestions
        False -- safe imports off: files may carry Safe Haskell pragmas
        True -- keep Haddock comment tokens — the point of the extractor
        False -- regular comments carry no documentation
        True -- honour LINE/COLUMN pragmas when computing positions

moduleHeader :: Located (HsModule GhcPs) -> Maybe (LHsDoc GhcPs)
moduleHeader = unLoc . fmap (hsmodHaddockModHeader . hsmodExt)

renderMessages :: Messages PsMessage -> Text
renderMessages msgs =
  T.pack (showSDocOneLine defaultSDocContext (pprMessages diag msgs))
  where
    diag = defaultDiagnosticOpts @PsMessage

diagOpts :: DiagOpts
diagOpts =
  DiagOpts
    { diag_warning_flags = empty
    , diag_fatal_warning_flags = empty
    , diag_warn_is_error = False
    , diag_reverse_errors = False
    , diag_max_errors = Just 20
    , diag_ppr_ctx = defaultSDocContext
    }
