{-# LANGUAGE TupleSections #-}

-- | A small expression language for the config extractor (B10), and the one
-- place that touches the @ghc-lib-parser@ AST.
--
-- The config schema is read out of the @FromJSON@ instances in
-- @Cardano.DbSync.Config.Types@ without compiling them. Interpreting GHC's
-- full syntax tree directly would tie every rule to GHC's constructor shapes,
-- so the parsed module is first lowered into this deliberately small language
-- ('Ex', 'Pat', 'Ty') and everything else works on that.
--
-- Two things the lowering does that the parser does not:
--
-- * Operator chains are re-associated. GHC's parser leaves every operator
--   application left-nested and lets the renamer fix precedence; we never run
--   the renamer, so 'fixity' carries the fixities the config parsers use.
-- * @f $ x@ becomes plain application, and parentheses disappear.
module ConfigExtract.Syntax (
  Ex (..),
  Pat (..),
  Alt (..),
  Stmt (..),
  Ty (..),
  Bind (..),
  ConInfo (..),
  DataInfo (..),
  ModuleSyntax (..),
  lowerModule,
  lowerExpr,
  fixity,
)
where

import Data.Char (isAsciiUpper)
import Data.Foldable (toList)
import Data.List (foldl')
import qualified Data.Map.Strict as Map
import Data.Maybe (mapMaybe)
import Data.Text (Text)
import qualified Data.Text as Text
import GHC.Data.Bag (bagToList)
import GHC.Data.FastString (unpackFS)
import GHC.Hs hiding (Pat, Stmt)
import GHC.Types.Name.Occurrence (occNameString)
import GHC.Types.Name.Reader (RdrName, rdrNameOcc)
import GHC.Types.SourceText (IntegralLit (..))
import GHC.Types.SrcLoc (GenLocated (..), SrcSpan (..), srcSpanStartLine, unLoc)

-- | Expressions. Names are unqualified (@Aeson.withObject@ is @withObject@):
-- the config module imports each name once, and the rules match on names.
data Ex
  = EVar Text
  | ECon Text
  | EStr Text
  | EInt Integer
  | EApp Ex Ex
  | EOp Text Ex Ex
  | ELam [Pat] Ex
  | ELamCase [Alt]
  | ECase Ex [Alt]
  | EIf Ex Ex Ex
  | EDo [Stmt]
  | EList [Ex]
  | ETuple [Ex]
  | ERecCon Text [(Text, Ex)]
  | ERecUpd Ex [(Text, Ex)]
  | ESig Ex Ty
  | ELet [Bind] Ex
  | EOther
  deriving (Eq, Show)

data Pat
  = PVar Text
  | PWild
  | PStr Text
  | PInt Integer
  | PCon Text [Pat]
  | PTuple [Pat]
  | POther
  deriving (Eq, Show)

-- | A case alternative: its pattern and its (first, unguarded) body.
data Alt = Alt Pat Ex
  deriving (Eq, Show)

data Stmt
  = SBind Pat Ex
  | SBody Ex
  | SLet [Bind]
  deriving (Eq, Show)

data Ty
  = TCon Text
  | TApp Ty Ty
  | TList Ty
  | TFun Ty Ty
  | TTuple [Ty]
  | TOther
  deriving (Eq, Ord, Show)

-- | A function or value binding: name, parameters, body, its own @where@
-- bindings, and the line it starts on.
data Bind = Bind
  { bName :: Text
  , bParams :: [Pat]
  , bBody :: Ex
  , bWhere :: [Bind]
  , bLine :: Int
  }
  deriving (Eq, Show)

-- | A data constructor and its fields: record field names when it has them,
-- and the field types in order.
data ConInfo = ConInfo
  { ciName :: Text
  , ciFields :: [(Maybe Text, Ty)]
  }
  deriving (Eq, Show)

data DataInfo = DataInfo
  { diName :: Text
  , diNewtype :: Bool
  , diCons :: [ConInfo]
  , diNewtypeDerivesFromJSON :: Bool
  , diLine :: Int
  }
  deriving (Eq, Show)

-- | Everything the interpreter needs from one parsed module.
data ModuleSyntax = ModuleSyntax
  { msData :: Map.Map Text DataInfo
  , msInstances :: Map.Map (Text, Text) (Bind, [Bind])
  -- ^ @(class, type)@ to the instance's first method binding and all its bindings.
  , msBinds :: Map.Map Text Bind
  , msSigs :: Map.Map Text Ty
  }
  deriving (Show)

-- Lowering a module ---------------------------------------------------------

lowerModule :: HsModule GhcPs -> ModuleSyntax
lowerModule hsmod = foldl' add empty (hsmodDecls hsmod)
  where
    empty = ModuleSyntax Map.empty Map.empty Map.empty Map.empty
    add ms (L loc decl) = case decl of
      TyClD _ DataDecl {tcdLName, tcdDataDefn} ->
        let name = rdr (unLoc tcdLName)
            info = dataInfo name (startLine (locA loc)) tcdDataDefn
         in ms {msData = Map.insert name info (msData ms)}
      InstD _ (ClsInstD _ ClsInstDecl {cid_poly_ty, cid_binds}) ->
        case instanceHead (sig_body (unLoc cid_poly_ty)) of
          Just key ->
            let binds = mapMaybe lowerBind (bagToList cid_binds)
             in case binds of
                  b : _ -> ms {msInstances = Map.insert key (b, binds) (msInstances ms)}
                  [] -> ms
          Nothing -> ms
      ValD _ bind -> case lowerBind (L loc bind) of
        Just b -> ms {msBinds = Map.insert (bName b) b (msBinds ms)}
        Nothing -> ms
      SigD _ (TypeSig _ names sigTy) ->
        let ty = lowerTy (sig_body (unLoc (hswc_body sigTy)))
         in ms {msSigs = foldl' (\m n -> Map.insert (rdr (unLoc n)) ty m) (msSigs ms) names}
      _ -> ms

instanceHead :: LHsType GhcPs -> Maybe (Text, Text)
instanceHead lty = case lowerTy lty of
  TApp (TCon cls) ty -> fmap (cls,) (tyHead ty)
  _ -> Nothing
  where
    tyHead (TCon t) = Just t
    tyHead (TApp f _) = tyHead f
    tyHead _ = Nothing

dataInfo :: Text -> Int -> HsDataDefn GhcPs -> DataInfo
dataInfo name ln defn =
  DataInfo
    { diName = name
    , diNewtype = case dd_cons defn of
        NewTypeCon _ -> True
        DataTypeCons _ _ -> False
    , diCons = map (conInfo . unLoc) (toList (dd_cons defn))
    , diNewtypeDerivesFromJSON = any derivesNewtypeFromJSON (dd_derivs defn)
    , diLine = ln
    }

derivesNewtypeFromJSON :: LHsDerivingClause GhcPs -> Bool
derivesNewtypeFromJSON (L _ HsDerivingClause {deriv_clause_strategy, deriv_clause_tys}) =
  isNewtype && "FromJSON" `elem` classes
  where
    isNewtype = case fmap unLoc deriv_clause_strategy of
      Just (NewtypeStrategy _) -> True
      _ -> False
    classes = case unLoc deriv_clause_tys of
      DctSingle _ t -> [className t]
      DctMulti _ ts -> map className ts
    className t = case lowerTy (sig_body (unLoc t)) of
      TCon c -> c
      _ -> ""

conInfo :: ConDecl GhcPs -> ConInfo
conInfo con = case con of
  ConDeclH98 {con_name, con_args} -> ConInfo (rdr (unLoc con_name)) (args con_args)
  ConDeclGADT {con_names} -> ConInfo (rdr (unLoc (headNE con_names))) []
  where
    headNE ne = case toList ne of
      x : _ -> x
      [] -> errorWithoutStackTrace "a GADT constructor always has a name"
    args details = case details of
      PrefixCon _ tys -> [(Nothing, lowerTy (hsScaledThing t)) | t <- tys]
      InfixCon a b -> [(Nothing, lowerTy (hsScaledThing a)), (Nothing, lowerTy (hsScaledThing b))]
      RecCon (L _ flds) ->
        [ (Just (rdr (unLoc (foLabel (unLoc n)))), lowerTy cd_fld_type)
        | L _ ConDeclField {cd_fld_names, cd_fld_type} <- flds
        , n <- cd_fld_names
        ]

-- Bindings -------------------------------------------------------------------

lowerBind :: LHsBind GhcPs -> Maybe Bind
lowerBind (L loc bind) = case bind of
  FunBind {fun_id, fun_matches} -> case matchesOf fun_matches of
    (pats, body, wh) : _ -> Just (Bind (rdr (unLoc fun_id)) pats body wh (startLine (locA loc)))
    [] -> Nothing
  _ -> Nothing

-- | Every match of a match group: patterns, the first right-hand side, and
-- the match's @where@ bindings.
matchesOf :: MatchGroup GhcPs (LHsExpr GhcPs) -> [([Pat], Ex, [Bind])]
matchesOf MG {mg_alts = L _ ms} =
  [ (map lowerPat m_pats, rhs, localBinds (grhssLocalBinds m_grhss))
  | L _ Match {m_pats, m_grhss} <- ms
  , rhs <- take 1 [guarded guards (lowerExpr body) | L _ (GRHS _ guards body) <- grhssGRHSs m_grhss]
  ]
  where
    -- A guarded right-hand side keeps its boolean guards as the condition of
    -- an 'EIf', so rules that look inside conditions (the trace-dispatcher
    -- key list sits in a guard) can see them.
    guarded guards body = case [lowerExpr g | L _ (BodyStmt _ g _ _) <- guards] of
      [] -> body
      conds -> EIf (foldr1 (EOp "&&") conds) body EOther

localBinds :: HsLocalBinds GhcPs -> [Bind]
localBinds binds = case binds of
  HsValBinds _ (ValBinds _ bag _) -> mapMaybe lowerBind (bagToList bag)
  _ -> []

alts :: MatchGroup GhcPs (LHsExpr GhcPs) -> [Alt]
alts mg = [Alt p body | (p : _, body, _) <- matchesOf mg]

-- Expressions ------------------------------------------------------------------

lowerExpr :: LHsExpr GhcPs -> Ex
lowerExpr le@(L _ expr) = case expr of
  HsVar _ n -> nameEx (rdr (unLoc n))
  HsOverLit _ ol -> overLit (ol_val ol)
  HsLit _ lit -> case lit of
    HsString _ fs -> EStr (Text.pack (unpackFS fs))
    HsInt _ il -> EInt (il_value il)
    HsInteger _ i _ -> EInt i
    _ -> EOther
  HsPar _ _ inner _ -> lowerExpr inner
  HsApp _ f a -> EApp (lowerExpr f) (lowerExpr a)
  HsAppType _ f _ _ -> lowerExpr f
  OpApp {} -> uncurry associate (flatten le)
  SectionL _ arg op -> EApp (lowerExpr op) (lowerExpr arg)
  SectionR _ op arg -> EApp (EApp (EVar "flip") (lowerExpr op)) (lowerExpr arg)
  NegApp _ inner _ -> case lowerExpr inner of
    EInt n -> EInt (negate n)
    other -> EApp (EVar "negate") other
  HsLam _ mg -> case matchesOf mg of
    (pats, body, _) : _ -> ELam pats body
    [] -> EOther
  HsLamCase _ _ mg -> ELamCase (alts mg)
  HsCase _ scrut mg -> ECase (lowerExpr scrut) (alts mg)
  HsIf _ c t f -> EIf (lowerExpr c) (lowerExpr t) (lowerExpr f)
  HsDo _ _ (L _ stmts) -> EDo (mapMaybe lowerStmt stmts)
  ExplicitList _ xs -> EList (map lowerExpr xs)
  ExplicitTuple _ args _ -> ETuple [lowerExpr x | Present _ x <- args]
  RecordCon {rcon_con, rcon_flds} -> ERecCon (rdr (unLoc rcon_con)) (recFields rcon_flds)
  RecordUpd {rupd_expr, rupd_flds} -> ERecUpd (lowerExpr rupd_expr) (updFields rupd_flds)
  ExprWithTySig _ inner sigTy -> ESig (lowerExpr inner) (lowerTy (sig_body (unLoc (hswc_body sigTy))))
  HsLet _ _ binds _ body -> ELet (localBinds binds) (lowerExpr body)
  _ -> EOther

recFields :: HsRecordBinds GhcPs -> [(Text, Ex)]
recFields HsRecFields {rec_flds} =
  [ (name, if hfbPun then nameEx name else lowerExpr hfbRHS)
  | L _ HsFieldBind {hfbLHS, hfbRHS, hfbPun} <- rec_flds
  , let name = rdr (unLoc (foLabel (unLoc hfbLHS)))
  ]

updFields :: Either [LHsRecUpdField GhcPs] [LHsRecUpdProj GhcPs] -> [(Text, Ex)]
updFields flds = case flds of
  Left fs ->
    [ (rdr (rdrNameAmbiguousFieldOcc (unLoc hfbLHS)), lowerExpr hfbRHS)
    | L _ HsFieldBind {hfbLHS, hfbRHS} <- fs
    ]
  Right _ -> []

lowerStmt :: ExprLStmt GhcPs -> Maybe Stmt
lowerStmt (L _ stmt) = case stmt of
  BindStmt _ pat body -> Just (SBind (lowerPat pat) (lowerExpr body))
  BodyStmt _ body _ _ -> Just (SBody (lowerExpr body))
  LastStmt _ body _ _ -> Just (SBody (lowerExpr body))
  LetStmt _ binds -> Just (SLet (localBinds binds))
  _ -> Nothing

overLit :: OverLitVal -> Ex
overLit val = case val of
  HsIntegral il -> EInt (il_value il)
  HsIsString _ fs -> EStr (Text.pack (unpackFS fs))
  HsFractional _ -> EOther

nameEx :: Text -> Ex
nameEx n = case Text.uncons n of
  Just (c, _) | isAsciiUpper c -> ECon n
  _ -> EVar n

-- Operators ----------------------------------------------------------------------

-- | An unparenthesised operator chain as operands and operators, left to right.
flatten :: LHsExpr GhcPs -> ([Ex], [Text])
flatten (L _ (OpApp _ l op r)) =
  let (ls, lops) = flatten l
      (rs, rops) = flatten r
   in (ls ++ rs, lops ++ [opName op] ++ rops)
flatten e = ([lowerExpr e], [])

opName :: LHsExpr GhcPs -> Text
opName (L _ e) = case e of
  HsVar _ n -> rdr (unLoc n)
  _ -> "?"

data Assoc = AssocL | AssocR | AssocN
  deriving (Eq)

-- | Fixities of the operators the config parsers use. Anything not listed is
-- @infixl 9@, Haskell's default — which is what aeson's @.:@, @.:?@ and @.!=@
-- are.
fixity :: Text -> (Int, Assoc)
fixity op = case op of
  "$" -> (0, AssocR)
  "$!" -> (0, AssocR)
  ">>=" -> (1, AssocL)
  ">>" -> (1, AssocL)
  "||" -> (2, AssocR)
  "&&" -> (3, AssocR)
  "<$>" -> (4, AssocL)
  "<$" -> (4, AssocL)
  "<*>" -> (4, AssocL)
  "<*" -> (4, AssocL)
  "*>" -> (4, AssocL)
  "<&>" -> (1, AssocL)
  "==" -> (4, AssocN)
  "/=" -> (4, AssocN)
  "<>" -> (6, AssocR)
  "++" -> (5, AssocR)
  "." -> (9, AssocR)
  _ -> (9, AssocL)

-- | Precedence climbing over a flattened chain.
associate :: [Ex] -> [Text] -> Ex
associate operands ops = case climb 0 operands ops of
  (e, _, _) -> e
  where
    climb :: Int -> [Ex] -> [Text] -> (Ex, [Ex], [Text])
    climb minPrec (lhs : rest) opsLeft = loop lhs rest opsLeft
      where
        loop acc rs os = case (os, rs) of
          (op : os', r : rs')
            | fst (fixity op) >= minPrec ->
                let (prec, assoc) = fixity op
                    next = if assoc == AssocR then prec else prec + 1
                    (rhs, rs'', os'') = climbFrom next r rs' os'
                 in loop (apply op acc rhs) rs'' os''
          _ -> (acc, rs, os)
    climb _ [] os = (EOther, [], os)
    climbFrom p first rs = climb p (first : rs)
    apply op a b = case op of
      "$" -> EApp a b
      "$!" -> EApp a b
      _ -> EOp op a b

-- Patterns -------------------------------------------------------------------------

lowerPat :: LPat GhcPs -> Pat
lowerPat (L _ pat) = case pat of
  VarPat _ n -> PVar (rdr (unLoc n))
  WildPat _ -> PWild
  LitPat _ (HsString _ fs) -> PStr (Text.pack (unpackFS fs))
  NPat _ (L _ ol) _ _ -> case ol_val ol of
    HsIsString _ fs -> PStr (Text.pack (unpackFS fs))
    HsIntegral il -> PInt (il_value il)
    _ -> POther
  ConPat {pat_con, pat_args} -> PCon (rdr (unLoc pat_con)) $ case pat_args of
    PrefixCon _ ps -> map lowerPat ps
    InfixCon a b -> [lowerPat a, lowerPat b]
    RecCon _ -> []
  TuplePat _ ps _ -> PTuple (map lowerPat ps)
  ParPat _ _ p _ -> lowerPat p
  BangPat _ p -> lowerPat p
  SigPat _ p _ -> lowerPat p
  AsPat _ _ _ p -> lowerPat p
  _ -> POther

-- Types ---------------------------------------------------------------------------

lowerTy :: LHsType GhcPs -> Ty
lowerTy (L _ ty) = case ty of
  HsTyVar _ _ n -> TCon (rdr (unLoc n))
  HsAppTy _ f a -> TApp (lowerTy f) (lowerTy a)
  HsListTy _ t -> TList (lowerTy t)
  HsParTy _ t -> lowerTy t
  HsBangTy _ _ t -> lowerTy t
  HsDocTy _ t _ -> lowerTy t
  HsFunTy _ _ a b -> TFun (lowerTy a) (lowerTy b)
  HsTupleTy _ _ ts -> TTuple (map lowerTy ts)
  HsQualTy _ _ t -> lowerTy t
  HsForAllTy _ _ t -> lowerTy t
  _ -> TOther

-- Names and positions ----------------------------------------------------------------

rdr :: RdrName -> Text
rdr = Text.pack . occNameString . rdrNameOcc

startLine :: SrcSpan -> Int
startLine (RealSrcSpan r _) = srcSpanStartLine r
startLine _ = 0
