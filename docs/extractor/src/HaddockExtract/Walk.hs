-- | Walking the parsed AST and turning declarations and their attached
-- Haddock comments into the artifact model.
--
-- How GHC 9.6 surfaces Haddock comments (see
-- @GHC.Parser.PostProcess.Haddock@):
--
-- * A @-- |@ comment before a declaration becomes a @DocCommentNext@ @DocD@
--   declaration inserted /before/ it in @hsmodDecls@.
-- * A @-- ^@ comment after a declaration becomes a @DocCommentPrev@ @DocD@
--   inserted /after/ it.
-- * @-- *@ headings and @-- $name@ chunks become @DocGroup@ and
--   @DocCommentNamed@ @DocD@ declarations in place.
-- * Constructor comments land on @con_doc@, record-field comments on
--   @cd_fld_doc@, and a module header comment on @hsmodHaddockModHeader@.
--
-- Only documented declarations enter the artifact: an undocumented file
-- still appears in @files@ with no annotations.
module HaddockExtract.Walk (
  moduleAnnotations,
  walkModule,
)
where

import Data.Foldable (toList)
import Data.List (foldl')
import Data.List.NonEmpty (NonEmpty (..))
import Data.Maybe (fromMaybe, mapMaybe)
import Data.Set (Set)
import qualified Data.Set as Set
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Hs
import GHC.Types.Name.Occurrence (occNameString)
import GHC.Types.Name.Reader (RdrName, rdrNameOcc)
import GHC.Types.SrcLoc (GenLocated (..), SrcSpan (..), srcSpanStartLine, unLoc)
import HaddockExtract.Model

-- | The module name, if the module header carries one.
moduleNameText :: HsModule GhcPs -> Maybe Text
moduleNameText = fmap (T.pack . moduleNameString . unLoc) . hsmodName

-- | Everything extracted from one parsed module.
moduleAnnotations :: Bool -> Text -> HsModule GhcPs -> ModuleAnnotations
moduleAnnotations cpp path hsmod =
  ModuleAnnotations
    { modPath = path
    , modModule = moduleNameText hsmod
    , modHeader = fmap renderDoc (hsmodHaddockModHeader (hsmodExt hsmod))
    , modCpp = cpp
    , modAnnotations = walkModule hsmod
    }

-- | Extract every annotation from a parsed module, in source order. Only
-- documented declarations enter the artifact; the walker keeps entities with
-- an empty document while it runs (so a following @-- ^@ can still attach to
-- the right declaration) and drops them here.
walkModule :: HsModule GhcPs -> [Annotation]
walkModule hsmod =
  filter (not . T.null . annDoc) (wOut (foldl' step initWalker (declItems bound decls)))
  where
    decls = hsmodDecls hsmod
    bound = boundValueNames decls

-- Bound value names -------------------------------------------------------

-- | Names bound by a value declaration in the module. A signature whose name
-- is bound by a value declaration right after it is reported as a
-- @function@ rather than a @signature@: the @-- |@ above @f :: T@ documents
-- @f@, whichever of the two declarations it sits above.
boundValueNames :: [LHsDecl GhcPs] -> Set Text
boundValueNames = foldMap names
  where
    names (L _ decl) = case decl of
      ValD _ FunBind {fun_id} -> Set.singleton (rdrNameText (unLoc fun_id))
      _ -> Set.empty

-- Items -------------------------------------------------------------------

-- | One element of the linearised module body.
data Item
  = -- | A @-- |@ comment, waiting for the declaration that follows it.
    ItemNext Text
  | -- | A @-- ^@ comment, belonging to the declaration before it.
    ItemPrev Int Text
  | ItemNamed String Int Text
  | ItemSection Int Int Text
  | -- | A real declaration: its line, its skeleton (when the extractor
    -- recognises it) and any nested annotations it yields (class methods).
    ItemDecl Int (Maybe AnnSkeleton) [Annotation]

-- | Everything the extractor knows about a declaration before its Haddock
-- comment is attached.
data AnnSkeleton = AnnSkeleton
  { skName :: Text
  , skKind :: Kind
  , skConstructors :: [Constructor]
  }

declItems :: Set Text -> [LHsDecl GhcPs] -> [Item]
declItems bound = mapMaybe classify
  where
    classify :: LHsDecl GhcPs -> Maybe Item
    classify ldecl = case unLoc ldecl of
      DocD _ docDecl -> Just (docItem (startLine (getLocA ldecl)) docDecl)
      TyClD _ tyCl ->
        Just (ItemDecl (startLine (getLocA ldecl)) (tyClSkeleton bound tyCl) (tyClExtras tyCl))
      SigD _ sig ->
        Just (ItemDecl (startLine (getLocA ldecl)) (sigSkeleton bound sig) [])
      ValD _ bind ->
        Just (ItemDecl (startLine (getLocA ldecl)) (bindSkeleton bind) [])
      InstD _ _ ->
        Just (ItemDecl (startLine (getLocA ldecl)) (Just (AnnSkeleton "" InstanceKind [])) [])
      ForD _ fd ->
        Just
          ( ItemDecl
              (startLine (getLocA ldecl))
              (Just (AnnSkeleton (rdrNameText (unLoc (fd_name fd))) ForeignKind []))
              []
          )
      _ -> Nothing

startLine :: SrcSpan -> Int
startLine (RealSrcSpan r _) = srcSpanStartLine r
startLine _ = 0

docItem :: Int -> DocDecl GhcPs -> Item
docItem ln docDecl = case docDecl of
  DocCommentNext doc -> ItemNext (renderDoc doc)
  DocCommentPrev doc -> ItemPrev ln (renderDoc doc)
  DocCommentNamed nm doc -> ItemNamed nm ln (renderDoc doc)
  DocGroup lvl doc -> ItemSection lvl ln (renderDoc doc)

-- | Render a Haddock comment as document text.
--
-- GHC keeps the single space that follows the decorator (@-- \| foo@
-- documents as @" foo"@); that one space is comment syntax, not content, so
-- it is dropped from every line. Leading and trailing blank lines go too, so
-- consumers see the documentation exactly as the author wrote it.
renderDoc :: LHsDoc GhcPs -> Text
renderDoc = normaliseDoc . T.pack . renderHsDocString . hsDocString . unLoc

normaliseDoc :: Text -> Text
normaliseDoc = T.stripEnd . T.intercalate "\n" . map dropDecoratorSpace . T.lines
  where
    dropDecoratorSpace t = case T.uncons t of
      Just (' ', rest) -> rest
      _ -> t

rdrNameText :: RdrName -> Text
rdrNameText = T.pack . occNameString . rdrNameOcc

-- Skeletons ----------------------------------------------------------------

tyClSkeleton :: Set Text -> TyClDecl GhcPs -> Maybe AnnSkeleton
tyClSkeleton _bound tyCl = case tyCl of
  FamDecl {tcdFam} ->
    Just (AnnSkeleton (rdrNameText (unLoc (fdLName tcdFam))) (familyKind (fdInfo tcdFam)) [])
  SynDecl {tcdLName} ->
    Just (AnnSkeleton (rdrNameText (unLoc tcdLName)) TypeSynonymKind [])
  DataDecl {tcdLName, tcdDataDefn} ->
    let defn = tcdDataDefn
     in Just (AnnSkeleton (rdrNameText (unLoc tcdLName)) (dataKind (dd_cons defn)) (dataConstructors defn))
  ClassDecl {tcdLName} ->
    Just (AnnSkeleton (rdrNameText (unLoc tcdLName)) ClassKind [])

familyKind :: FamilyInfo GhcPs -> Kind
familyKind info = case info of
  DataFamily -> DataFamilyKind
  _ -> TypeFamilyKind

dataKind :: DataDefnCons (LConDecl GhcPs) -> Kind
dataKind cons = case cons of
  NewTypeCon _ -> NewtypeKind
  DataTypeCons _ _ -> DataKind

dataConstructors :: HsDataDefn GhcPs -> [Constructor]
dataConstructors defn =
  [ Constructor (conDeclName con) (fromMaybe "" (fmap renderDoc (conDeclDoc con))) (conDeclFields con)
  | (L _ con) <- toList (dd_cons defn)
  ]

conDeclName :: ConDecl GhcPs -> Text
conDeclName con = case con of
  ConDeclH98 {con_name} -> rdrNameText (unLoc con_name)
  ConDeclGADT {con_names} -> case con_names of
    name :| _ -> rdrNameText (unLoc name)

conDeclDoc :: ConDecl GhcPs -> Maybe (LHsDoc GhcPs)
conDeclDoc con = case con of
  ConDeclH98 {con_doc} -> con_doc
  ConDeclGADT {con_doc} -> con_doc

conDeclFields :: ConDecl GhcPs -> [ConField]
conDeclFields con = case con of
  ConDeclH98 {con_args = RecCon flds} -> map conField (unLoc flds)
  ConDeclGADT {con_g_args = RecConGADT flds _} -> map conField (unLoc flds)
  _ -> []
  where
    conField (L _ ConDeclField {cd_fld_names, cd_fld_doc}) =
      ConField
        (fieldOccName (firstField cd_fld_names))
        (fromMaybe "" (fmap renderDoc cd_fld_doc))

fieldOccName :: LFieldOcc GhcPs -> Text
fieldOccName = rdrNameText . unLoc . foLabel . unLoc

firstField :: [a] -> a
firstField [] = errorWithoutStackTrace "a record field always has a name"
firstField (x : _) = x

sigSkeleton :: Set Text -> Sig GhcPs -> Maybe AnnSkeleton
sigSkeleton bound sig = case sig of
  TypeSig _ names _ -> case names of
    [] -> Nothing
    name : _ ->
      let nm = rdrNameText (unLoc name)
       in Just (AnnSkeleton nm (if Set.member nm bound then FunctionKind else SignatureKind) [])
  _ -> Nothing

bindSkeleton :: HsBind GhcPs -> Maybe AnnSkeleton
bindSkeleton bind = case bind of
  FunBind {fun_id} -> Just (AnnSkeleton (rdrNameText (unLoc fun_id)) FunctionKind [])
  PatBind {} -> Just (AnnSkeleton "" BindingKind [])
  _ -> Nothing

-- Class bodies --------------------------------------------------------------

-- | Documentation inside a class body: the parser records it in @tcdDocs@
-- and method signatures in @tcdSigs@, so the two are re-joined here by
-- source position. A doc before a signature documents that method; a doc
-- after one attaches to it; a named chunk or section heading stands alone.
tyClExtras :: TyClDecl GhcPs -> [Annotation]
tyClExtras ClassDecl {tcdSigs, tcdDocs} =
  methodDocs methodEntities tcdDocs
  where
    methodEntities =
      [ (startLine (getLocA s), nm)
      | s@(L _ sig) <- tcdSigs
      , nm <- sigNames sig
      ]
tyClExtras _ = []

sigNames :: Sig GhcPs -> [Text]
sigNames sig = case sig of
  TypeSig _ names _ -> map (rdrNameText . unLoc) names
  ClassOpSig _ _ names _ -> map (rdrNameText . unLoc) names
  _ -> []

methodDocs :: [(Int, Text)] -> [LDocDecl GhcPs] -> [Annotation]
methodDocs entities = mapMaybe attach
  where
    attach :: LDocDecl GhcPs -> Maybe Annotation
    attach dloc = case unLoc dloc of
      DocCommentNext doc ->
        Just (method (startLine (getLocA dloc)) (renderDoc doc) Before)
      DocCommentPrev doc ->
        Just (method (startLine (getLocA dloc)) (renderDoc doc) After)
      DocCommentNamed nm doc ->
        Just (namedAnnotation nm (renderDoc doc) (startLine (getLocA dloc)))
      DocGroup lvl doc ->
        Just (sectionAnnotation lvl (renderDoc doc) (startLine (getLocA dloc)))
    method ln doc pos =
      Annotation
        { annName = lookupEntity ln pos
        , annKind = ClassMethodKind
        , annLine = ln
        , annDoc = doc
        , annPosition = pos
        , annConstructors = []
        , annSectionLevel = Nothing
        }
    lookupEntity ln pos = case pos of
      -- A "-- |" doc sits above the signature it documents.
      Before -> fromMaybe "" (firstAfterEntities ln)
      -- A "-- ^" doc sits below the signature it documents.
      After -> fromMaybe "" (lastBeforeEntities ln)
      _ -> ""
    firstAfterEntities ln = case dropWhile ((<= ln) . fst) entities of
      ((_, nm) : _) -> Just nm
      [] -> Nothing
    lastBeforeEntities ln = case filter ((< ln) . fst) entities of
      xs -> case reverse xs of
        ((_, nm) : _) -> Just nm
        [] -> Nothing

-- Folding ------------------------------------------------------------------

-- | The walker state. 'wOut' is kept reversed, and 'wLastPos' indexes it from
-- the head (0 = most recently emitted annotation).
data Walker = Walker
  { wPendingNext :: Maybe Text
  , wLastPos :: Maybe Int
  , wOut :: [Annotation]
  }

initWalker :: Walker
initWalker = Walker Nothing Nothing []

step :: Walker -> Item -> Walker
step w item = case item of
  ItemNext doc -> w {wPendingNext = Just doc}
  ItemPrev ln doc -> case wLastPos w of
    Just pos -> w {wOut = patch pos (attachPrevDoc doc) (wOut w)}
    Nothing ->
      w {wOut = Annotation "" BindingKind ln doc After [] Nothing : wOut w, wLastPos = Just 0}
  ItemNamed nm ln doc -> emitGroup w [namedAnnotation nm doc ln]
  ItemSection lvl ln doc -> emitGroup w [sectionAnnotation lvl doc ln]
  ItemDecl ln mskel extras -> case fmap (\sk -> skeletonToAnnotation sk ln (wPendingNext w)) mskel of
    Just ann -> emitGroup (w {wPendingNext = Nothing}) (ann : extras)
    Nothing -> emitGroup w extras

-- | A @-- ^@ document attaches to an entity that already has its @-- |@
-- document by appending: both are part of the declaration's documentation.
attachPrevDoc :: Text -> Annotation -> Annotation
attachPrevDoc doc ann
  | T.null (annDoc ann) = ann {annDoc = doc}
  | otherwise = ann {annDoc = annDoc ann <> "\n" <> doc}

patch :: Int -> (a -> a) -> [a] -> [a]
patch n f = go n
  where
    go _ [] = []
    go 0 (x : xs) = f x : xs
    go k (x : xs) = x : go (k - 1) xs

-- | Emit a group of annotations. The LAST emitter is the most recent, except
-- that a following @-- ^@ must still attach to the group's first member (the
-- declaration itself), so the position is kept on the first item.
emitGroup :: Walker -> [Annotation] -> Walker
emitGroup w anns
  | null anns = w
  | otherwise = w {wLastPos = Just (length anns - 1), wOut = reverse anns ++ wOut w}

namedAnnotation :: String -> Text -> Int -> Annotation
namedAnnotation nm doc ln =
  Annotation {annName = T.pack nm, annKind = NamedKind, annLine = ln, annDoc = doc, annPosition = Named, annConstructors = [], annSectionLevel = Nothing}

sectionAnnotation :: Int -> Text -> Int -> Annotation
sectionAnnotation lvl doc ln =
  Annotation {annName = "", annKind = SectionKind, annLine = ln, annDoc = doc, annPosition = Section, annConstructors = [], annSectionLevel = Just lvl}

skeletonToAnnotation :: AnnSkeleton -> Int -> Maybe Text -> Annotation
skeletonToAnnotation AnnSkeleton {..} ln pending =
  Annotation
    { annName = skName
    , annKind = skKind
    , annLine = ln
    , annDoc = fromMaybe "" pending
    , annPosition = maybe After (const Before) pending
    , annConstructors = skConstructors
    , annSectionLevel = Nothing
    }
