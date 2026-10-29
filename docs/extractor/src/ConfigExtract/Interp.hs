{-# LANGUAGE TupleSections #-}

-- | Reading the config schema out of the @FromJSON@ instances (B10).
--
-- The binary's own parsers are the specification of what a config file may
-- say, so the extractor interprets them symbolically instead of keeping a
-- hand-written list that drifts (CON-4). Every rule here matches an idiom the
-- config module actually uses:
--
-- * @withObject@ bodies — either an applicative chain @C <$> a <*> b …@,
--   whose positions are typed by @C@'s fields, or a @do@ block whose bound
--   variables are typed by how they are used afterwards — yield object keys:
--   @o .: "k"@ is required, @o .:? "k"@ optional, @.!= d@ and
--   @fmap (fromMaybe d)@ give the default.
-- * @withText@ bodies yield the accepted strings: the string patterns of a
--   @\\case@, or of a helper such as @enableDisableToBool@ whose @Just@
--   results the instance accepts. A pattern on @String "x"@ does the same.
-- * @deriving newtype FromJSON@ reads as the wrapped type.
-- * Defaults are evaluated (@def@ through @Default@ instances, record
--   selectors, record updates, named option sets) and turned back into JSON
--   by matching the value against the parser's own alternatives — the same
--   route the binary takes, in reverse.
--
-- Anything the rules cannot read is reported in 'unresolved'; the golden test
-- requires that list to be empty for the real config module, so a new parser
-- idiom fails loudly instead of disappearing from the schema.
module ConfigExtract.Interp (
  Shape (..),
  Key (..),
  Preset (..),
  Schema (..),
  Passthrough (..),
  extractSchema,
)
where

import ConfigExtract.Syntax
import Control.Monad (forM, zipWithM)
import Control.Monad.Trans.State.Strict (State, gets, modify', runState)
import Data.Aeson (Value (..))
import qualified Data.Aeson.Key as Key
import qualified Data.Aeson.KeyMap as KM
import Data.List (nub)
import qualified Data.Map.Strict as Map
import Data.Maybe (catMaybes, fromMaybe, isNothing, listToMaybe, mapMaybe)
import qualified Data.Set as Set
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Vector as V

-- | The JSON a key accepts.
data Shape
  = SBool
  | SInt Text (Maybe Text) (Maybe Text)
  | SString
  | SEnum [Text]
  | SArray Int Shape
  | -- | Haskell type, the line of its parser, keys, and presets the object defines.
    SObject Text Int [Key] [Preset]
  | SNullable Shape
  | SOpaque Text
  deriving (Eq, Show)

data Key = Key
  { keyName :: Text
  , keyRequired :: Bool
  , keyShape :: Shape
  , keyDefault :: Maybe Value
  }
  deriving (Eq, Show)

-- | A key whose value switches a whole set of defaults (@preset@): for every
-- accepted value, the effective value of each sibling key.
data Preset = Preset
  { presetKey :: Text
  , presetValues :: [(Text, [(Text, Value)])]
  }
  deriving (Eq, Show)

-- | Top-level keys read by something other than the config types — the
-- trace-dispatcher options, which db-sync hands to another library whole.
data Passthrough = Passthrough
  { ptKeys :: [Text]
  , ptReader :: Text
  }
  deriving (Eq, Show)

data Schema = Schema
  { schemaRoot :: Shape
  , schemaPassthrough :: [Passthrough]
  , schemaUnresolved :: [Text]
  }
  deriving (Eq, Show)

-- Environment -----------------------------------------------------------------

data Env = Env
  { envMod :: ModuleSyntax
  , envConType :: Map.Map Text Text
  -- ^ constructor -> its type
  , envSelectors :: Map.Map Text (Text, Ty)
  -- ^ record field -> (its type, the field's type)
  }

mkEnv :: ModuleSyntax -> Env
mkEnv ms =
  Env
    { envMod = ms
    , envConType = Map.fromList [(ciName c, diName d) | d <- Map.elems (msData ms), c <- diCons d]
    , envSelectors =
        Map.fromList
          [ (f, (diName d, ty))
          | d <- Map.elems (msData ms)
          , c <- diCons d
          , (Just f, ty) <- ciFields c
          ]
    }

data St = St
  { stUnresolved :: [Text]
  , stVisiting :: Set.Set Text
  , stCache :: Map.Map Text Shape
  }

type M = State St

unresolved :: Text -> M ()
unresolved msg = modify' (\s -> s {stUnresolved = stUnresolved s ++ [msg]})

-- | Extract the schema rooted at a type (@SyncPreConfig@).
extractSchema :: ModuleSyntax -> Text -> Schema
extractSchema ms root =
  let env = mkEnv ms
      (shape, st) = runState (namedShape env root) (St [] Set.empty Map.empty)
   in Schema shape (passthroughs ms) (nub (stUnresolved st))

-- Types to shapes ----------------------------------------------------------------

intTypes :: [Text]
intTypes = ["Int", "Integer", "Word", "Word8", "Word16", "Word32", "Word64", "Int64", "Natural"]

-- Bounds are decimal text so consumers can compare them without losing Word64 precision.
integerShape :: Text -> Shape
integerShape t = SInt t lo hi
  where
    dec = Just . Text.pack . show
    (lo, hi) = case t of
      "Word8" -> unsigned 8
      "Word16" -> unsigned 16
      "Word32" -> unsigned 32
      "Word64" -> unsigned 64
      "Word" -> unsigned 64
      "Int64" -> signed 64
      "Int" -> signed 64
      "Natural" -> (Just "0", Nothing)
      _ -> (Nothing, Nothing)
    unsigned n = (Just "0", dec (2 ^ (n :: Int) - 1 :: Integer))
    signed :: Int -> (Maybe Text, Maybe Text)
    signed n = (dec (negate (2 ^ (n - 1) :: Integer)), dec (2 ^ (n - 1) - 1 :: Integer))

typeShape :: Env -> Ty -> M Shape
typeShape env ty = case ty of
  TCon "Bool" -> pure SBool
  TCon t | t `elem` ["Text", "String", "FilePath"] -> pure SString
  TCon t | t `elem` intTypes -> pure (integerShape t)
  TApp (TCon "Maybe") t -> SNullable <$> typeShape env t
  TList t -> SArray 0 <$> typeShape env t
  TApp (TCon c) t | c `elem` ["NonEmpty", "Vector", "Set"] -> SArray (if c == "NonEmpty" then 1 else 0) <$> typeShape env t
  TCon t -> namedShape env t
  _ -> unresolved ("type " <> renderTy ty <> ": unrecognised form") >> pure (SOpaque (renderTy ty))

namedShape :: Env -> Text -> M Shape
namedShape env t = do
  cached <- gets (Map.lookup t . stCache)
  visiting <- gets (Set.member t . stVisiting)
  case cached of
    Just s -> pure s
    Nothing
      | visiting -> unresolved ("type " <> t <> ": recursive parser") >> pure (SOpaque t)
      | otherwise -> do
          modify' (\s -> s {stVisiting = Set.insert t (stVisiting s)})
          shape <- case Map.lookup ("FromJSON", t) (msInstances (envMod env)) of
            Just (b, others) -> instanceShape env t b others
            Nothing -> case Map.lookup t (msData (envMod env)) of
              Just d
                | diNewtypeDerivesFromJSON d
                , [ConInfo _ [(_, fty)]] <- diCons d ->
                    typeShape env fty
              _ -> unresolved ("type " <> t <> ": parser not found") >> pure (SOpaque t)
          modify' (\s -> s {stVisiting = Set.delete t (stVisiting s), stCache = Map.insert t shape (stCache s)})
          pure shape

instanceShape :: Env -> Text -> Bind -> [Bind] -> M Shape
instanceShape env t b others =
  parserShape env t (scopeOf env (others ++ bWhere b)) (lambda (bParams b) (bBody b))

lambda :: [Pat] -> Ex -> Ex
lambda [] body = body
lambda ps body = ELam ps body

-- | Bindings visible to a parser: its own @where@ clause, then the module.
newtype Scope = Scope (Map.Map Text Bind)

scopeOf :: Env -> [Bind] -> Scope
scopeOf env locals = Scope (Map.union (Map.fromList [(bName l, l) | l <- locals]) (msBinds (envMod env)))

lookupBind :: Scope -> Text -> Maybe Bind
lookupBind (Scope m) n = Map.lookup n m

-- | The shape a parser expression for type @t@ accepts.
parserShape :: Env -> Text -> Scope -> Ex -> M Shape
parserShape env t scope ex = case ex of
  EApp (EApp (EVar "withObject") _) f -> objectShape env t scope f
  EApp (EApp (EVar "withText") _) f -> do
    let vals = textAlternatives scope f
    if null vals || not (textComplete scope f)
      then unknown
      else pure (SEnum (map fst vals))
  EApp (EApp (EVar "withBool") _) _ -> unknown
  EApp (EApp (EVar "withScientific") _) _ -> unknown
  ELam [PVar v] (ECase (EVar v') alts) | v == v' -> case [s | Alt (PCon "String" [PStr s]) _ <- alts] of
    [] -> unknown
    _
      | textComplete scope (ELamCase (map textAlt alts))
      , vals@(_ : _) <- [s | Alt (PCon "String" [PStr s]) body <- alts, not (isFail body)] ->
          pure (SEnum vals)
      | otherwise -> unknown
  ELam [PVar v] (EApp f (EVar v')) | v == v' -> parserShape env t scope f
  EVar fn | Just b <- lookupBind scope fn -> parserShape env t scope (lambda (bParams b) (bBody b))
  _ -> unknown
  where
    textAlt (Alt (PCon "String" [PStr s]) body) = Alt (PStr s) body
    textAlt other = other
    unknown = do
      unresolved ("parser for " <> t <> ": unrecognised form")
      pure (SOpaque t)

-- Text parsers ----------------------------------------------------------------------

-- | The strings a @withText@ parser accepts, each with the Haskell value it
-- produces (used to turn defaults back into JSON).
textAlternatives :: Scope -> Ex -> [(Text, Ex)]
textAlternatives scope f = case f of
  ELamCase alts -> literalAlts alts
  ELam [PVar v] (ECase (EVar v') alts) | v == v' -> literalAlts alts
  -- case helper v of Just g -> ...; Nothing -> fail ...
  ELam [PVar v] (ECase (EApp (EVar helper) (EVar v')) outer)
    | v == v'
    , Just hb <- lookupBind scope helper ->
        [ (s, rhs)
        | (s, result) <- helperAlts hb
        , Just rhs <- [matchAlt outer result]
        ]
  _ -> []
  where
    literalAlts alts = [(s, stripPure body) | Alt (PStr s) body <- alts, not (isFail body)]
    helperAlts hb = case bBody hb of
      ELamCase alts -> [(s, body) | Alt (PStr s) body <- alts]
      ECase _ alts -> [(s, body) | Alt (PStr s) body <- alts]
      _ -> []

-- A text parser is finite only when every nonliteral alternative fails.
-- Guards and arbitrary helper applications cannot be interpreted safely.
textComplete :: Scope -> Ex -> Bool
textComplete scope f = case f of
  ELamCase as -> complete as
  ELam [PVar v] (ECase (EVar v') as) | v == v' -> complete as
  ELam [PVar v] (ECase (EApp (EVar h) (EVar v')) as)
    | v == v'
    , Just hb <- lookupBind scope h ->
        let helper = case bBody hb of
              ELamCase xs -> xs
              ECase _ xs -> xs
              _ -> []
         in not (null helper)
              && all literalOrNothing helper
              && all (\(Alt _ e) -> isFail e || accepted e) as
  _ -> False
  where
    complete as =
      not (null as)
        && all
          ( \(Alt p e) -> case p of
              PStr _ -> isFail e || accepted e
              _ -> isFail e
          )
          as
    literalOrNothing (Alt p e) = case p of
      PStr _ -> accepted e
      _ -> e == ECon "Nothing"
    accepted e = case stripPure e of
      ECon _ -> True
      EVar _ -> False
      EApp a b -> case spine (EApp a b) of
        (ECon _, args) -> all argument args
        _ -> False
      EStr _ -> True
      EInt _ -> True
      _ -> False
    argument e = case e of
      EVar _ -> True
      _ -> accepted e

-- | The body of the first alternative matching a value, with the
-- alternative's variables substituted — unless that body is a failure.
matchAlt :: [Alt] -> Ex -> Maybe Ex
matchAlt alts value = listToMaybe (mapMaybe try alts)
  where
    try (Alt pat body) = do
      binds <- matchPat pat value
      if isFail body then Nothing else Just (substitute binds (stripPure body))

matchPat :: Pat -> Ex -> Maybe [(Text, Ex)]
matchPat pat value = case (pat, value) of
  (PVar v, _) -> Just [(v, value)]
  (PWild, _) -> Just []
  (PStr s, EStr s') | s == s' -> Just []
  (PInt n, EInt n') | n == n' -> Just []
  (PCon c ps, _) -> case spine value of
    (ECon c', args) | c == c' && length args == length ps -> concat <$> zipWithM matchPat ps args
    _ -> Nothing
  (PTuple ps, ETuple xs) | length ps == length xs -> concat <$> zipWithM matchPat ps xs
  _ -> Nothing

isFail :: Ex -> Bool
isFail ex = case spine ex of
  (EVar f, _) -> f `elem` ["fail", "typeMismatch", "error", "parseFail"]
  _ -> False

stripPure :: Ex -> Ex
stripPure ex = case ex of
  EApp (EVar p) x | p `elem` ["pure", "return"] -> stripPure x
  _ -> ex

spine :: Ex -> (Ex, [Ex])
spine = go []
  where
    go acc (EApp f a) = go (a : acc) f
    go acc e = (e, acc)

-- Object parsers -----------------------------------------------------------------------

-- | What reading an object parser yields: its keys (with what is known about
-- each), the variables bound to keys, and the productions (JSON template,
-- Haskell value) used to turn defaults back into JSON.
data KeyInfo = KeyInfo
  { kiName :: Text
  , kiRequired :: Bool
  , kiTy :: Maybe Ty
  , kiEnum :: Maybe [Text]
  , kiShape :: Maybe Shape
  , kiDefault :: Maybe Ex
  , kiVar :: Text
  }

data Template = TLit Value | TVar Text | TAbsent

data Production = Production [(Text, Template)] Ex [(Text, Ty)]

objectShape :: Env -> Text -> Scope -> Ex -> M Shape
objectShape env t scope f = case f of
  ELam (PVar o : _) body -> build o body
  EVar fn | Just b <- lookupBind scope fn, PVar o : _ <- bParams b -> build o (bBody b)
  _ -> do
    unresolved ("object parser for " <> t <> ": unrecognised form")
    pure (SObject t (lineOf env t) [] [])
  where
    build o body | Just (key, _, childTy, options) <- legacyObjectSpec env o body = do
      child <- typeShape env childTy
      case child of
        SObject _ _ keys presets
          | all ((/= key) . keyName) keys -> pure (SObject t (lineOf env t) (Key key False (SNullable (SEnum (map fst options))) Nothing : keys) presets)
          | otherwise -> unresolved "legacy preset collides with a child key" >> pure (SObject t (lineOf env t) [] [])
        _ -> unresolved "legacy object child is not an object" >> pure (SObject t (lineOf env t) [] [])
    build o body = do
      let analysis = analyseObject env scope o body
          -- with no preset, a switch takes its Nothing branch (the plain defaults)
          plain = [(bound, e) | (bound, _, alts) <- oaSwitches analysis, (PCon "Nothing" [], e) <- alts]
      mapM_ unresolved (oaErrors analysis)
      keys <- forM (oaKeys analysis) (keyFromInfo env plain)
      presets <- presetsOf env analysis
      pure (SObject t (lineOf env t) keys presets)

lineOf :: Env -> Text -> Int
lineOf env t = maybe 0 (bLine . fst) (Map.lookup ("FromJSON", t) (msInstances (envMod env)))

-- | Older config parsers used a preset switch whose Nothing branch delegates
-- the same object to a single-field wrapper. Accept only this exhaustive idiom.
legacyObjectSpec :: Env -> Text -> Ex -> Maybe (Text, Text, Ty, [(Text, Text)])
legacyObjectSpec env o body = case body of
  EDo [SBind (PVar v) (EOp ".:?" (EVar obj) (EStr key)), SBody (ECase (ESig (EVar v') _) alts)]
    | obj == o
    , v == v' -> do
        wrapper <- listToMaybe [c | Alt (PCon "Nothing" []) (EOp "<$>" (ECon c) (EApp (EVar "parseJSON") (EApp (ECon "Object") (EVar obj')))) <- alts, obj' == o]
        childTy <- case conFields env wrapper of [(_, ty)] -> Just ty; _ -> Nothing
        let options = [(name, con) | Alt (PCon "Just" [PStr name]) e <- alts, ECon con <- [stripPure e]]
            valid (Alt pat e) = case pat of
              PCon "Nothing" [] -> case e of EOp "<$>" (ECon c) (EApp (EVar "parseJSON") (EApp (ECon "Object") (EVar obj'))) -> c == wrapper && obj' == o; _ -> False
              PCon "Just" [PStr _] -> case stripPure e of ECon _ -> True; _ -> False
              _ -> False
            fallback (Alt pat e) =
              isFail e && case pat of
                PCon "Just" [PVar _] -> True
                PCon "Just" [PWild] -> True
                PWild -> True
                _ -> False
            nothingCount = length [() | Alt (PCon "Nothing" []) _ <- alts]
        if null options || null alts || nothingCount /= 1 || not (fallback (last alts)) || not (all valid (init alts)) then Nothing else Just (key, wrapper, childTy, options)
  _ -> Nothing

legacyForType :: Env -> Text -> Maybe (Text, Text, Ty, [(Text, Text)])
legacyForType env t = do
  (b, _) <- Map.lookup ("FromJSON", t) (msInstances (envMod env))
  case bBody b of
    EApp (EApp (EVar "withObject") _) (ELam [PVar o] body) -> legacyObjectSpec env o body
    _ -> Nothing

data ObjectAnalysis = ObjectAnalysis
  { oaErrors :: [Text]
  , oaKeys :: [KeyInfo]
  , oaProductions :: [Production]
  , oaSwitches :: [(Text, Text, [(Pat, Ex)])]
  -- ^ (bound variable, the key variable it switches on, alternatives)
  }

-- | Read one object parser body. @o@ is the object variable.
analyseObject :: Env -> Scope -> Text -> Ex -> ObjectAnalysis
analyseObject env scope o body = case body of
  EDo stmts
    | let rejected = mapMaybe rejectedKeyGuard stmts
    , not (null rejected) ->
        let analysed = analyseObject env scope o (EDo $ filter (isNothing . rejectedKeyGuard) stmts)
            conflicts = ["rejected key also read: " <> key | key <- rejected, any ((== key) . kiName) (oaKeys analysed)]
         in analysed {oaErrors = conflicts ++ oaErrors analysed}
  EDo [SBody e] -> analyseObject env scope o e
  EDo stmts -> doBlock stmts
  _ | (EVar fn, args@(EVar obj : _)) <- spine body, obj == o, Just helper <- lookupBind scope fn -> analyseHelper helper args
  _ -> case applicative body of
    Just (con, args) -> applicativeObject con args
    Nothing -> ObjectAnalysis ["object body: unrecognised form"] [] [] []
  where
    -- An explicit @when (member "key" obj) (fail "message")@ rejects a key rather
    -- than reading one. Unknown keys already fail the generated validator, so the
    -- guard contributes no accepted key or default. Other guards remain unresolved.
    rejectedKeyGuard (SBody e) = case spine e of
      (EVar "when", [predicate, failure]) -> case (spine predicate, spine failure) of
        ((EVar "member", [EStr key, EVar obj]), (EVar "fail", [EStr _])) | obj == o -> Just key
        _ -> Nothing
      _ -> Nothing
    rejectedKeyGuard _ = Nothing

    -- C <$> a1 <*> a2 ...
    applicativeObject con args =
      let fieldTys = map snd (conFields env con) ++ repeat TOther
          parsed = zipWith3 (\i a fty -> (i, keyArg i a fty)) [0 :: Int ..] args fieldTys
          infos = [ki | (_, Right (ki, _)) <- parsed]
          exprArg (i, Right (ki, wrap)) = (Just (kiVar ki, kiTy ki, i), wrap (EVar (kiVar ki)))
          exprArg (_, Left e) = (Nothing, fromMaybe e (evalEx env [] Nothing e))
          argExs = map exprArg parsed
          template = [(kiName ki, TVar (kiVar ki)) | ki <- infos]
          varTys = [(v, ty) | (Just (v, Just ty, _), _) <- argExs]
          prod = Production template (foldl EApp (ECon con) (map snd argExs)) varTys
       in ObjectAnalysis ["applicative argument: unrecognised form" | (_, Left EOther) <- parsed] infos [prod] []

    -- One applicative argument: a key access (possibly wrapped), or a plain value.
    keyArg :: Int -> Ex -> Ty -> Either Ex (KeyInfo, Ex -> Ex)
    keyArg i a fty = case a of
      EApp (EApp (EVar "fmap") (ECon k)) inner -> wrapNewtype k inner
      EOp "<$>" (ECon k) inner -> wrapNewtype k inner
      EApp (EApp (EVar "fmap") (EApp (EVar "fromMaybe") d)) inner ->
        fmap (\(ki, w) -> (ki {kiDefault = Just d}, w)) (keyArg i inner fty)
      EApp (EVar "parseJSON") (EApp (ECon "Object") (EVar obj)) | obj == o, fty == TCon "Representation", Map.notMember "Representation" (msData (envMod env)) -> Left a
      EApp (EVar p) x | p `elem` ["pure", "return"] -> Left x
      _ -> case access a of
        Just (k, req, d) -> Right (KeyInfo k req (Just fty) Nothing Nothing d (var k), id)
        Nothing -> Left EOther
      where
        wrapNewtype k inner = case conFields env k of
          [(_, inner')] -> case keyArg i inner inner' of
            Right (ki, w) -> Right (ki, EApp (ECon k) . w)
            Left e -> Left e
          _ -> Left EOther

    -- o .: "k" / o .:? "k" / o .:? "k" .!= d
    access :: Ex -> Maybe (Text, Bool, Maybe Ex)
    access a = case a of
      EOp ".:" (EVar o') (EStr k) | o' == o -> Just (k, True, Nothing)
      EOp ".:?" (EVar o') (EStr k) | o' == o -> Just (k, False, Nothing)
      EOp ".!=" inner d -> fmap (\(k, _, _) -> (k, False, Just d)) (access inner)
      _ -> Nothing

    var k = "$" <> k

    doBlock stmts =
      let binds = [(x, rhs) | SBind (PVar x) rhs <- stmts]
          keyed = [(x, KeyInfo k req Nothing Nothing Nothing d x) | (x, rhs) <- binds, Just (k, req, d) <- [access rhs]]
          -- helper calls that read more keys from the same object
          helpers =
            [ (x, analyseHelper hb args)
            | (x, rhs) <- binds
            , (EVar h, args@(EVar o' : _)) <- [spine rhs]
            , o' == o
            , Just hb <- [lookupBind scope h]
            ]
          switches =
            [ (x, pv, [(p, stripPure e) | Alt p e <- alts])
            | (x, ECase (EVar pv) alts) <- binds
            , pv `elem` map fst keyed
            ]
          final = case [e | SBody e <- stmts] of
            [] -> EOther
            es -> last es
          keyedInfos = map (refine final switches) keyed
          helperInfos = concatMap (oaKeys . snd) helpers
          baseProds = finalProductions final (map snd keyedInfos)
          plain = [(bound, e) | (bound, _, as) <- switches, (PCon "Nothing" [], e) <- as]
          prods =
            [ Production template (reducePattern plain Nothing pat) tys
            | Production template pat tys <- foldl expandHelper baseProds helpers
            ]
          known x _rhs = any ((== x) . fst) keyed || any ((== x) . fst) helpers || any (\(v, _, _) -> v == x) switches
          errors =
            ["object expression: unsupported conditional or local binding" | any unsupported (universe body)]
              ++ ["do result: multiple expression statements" | length [() | SBody _ <- stmts] > 1]
              ++ ["do binding " <> x <> ": unrecognised form" | (x, rhs) <- binds, not (known x rhs)]
              ++ [ "do statement: unrecognised form"
                 | st <- stmts
                 , case st of
                     SBind (PVar _) _ -> False
                     SBody e -> e /= final
                     _ -> True
                 ]
              ++ ["object result: unrecognised form" | null baseProds]
              ++ concatMap (oaErrors . snd) helpers
       in ObjectAnalysis
            errors
            (map snd keyedInfos ++ helperInfos)
            prods
            (switches ++ concatMap (oaSwitches . snd) helpers)

    -- Keep key variables symbolic, but evaluate constant fields in productions.
    -- This includes non-configurable fields copied from the default option set.
    reducePattern ctx want ex = case evalEx env ctx want ex of
      Just value -> value
      Nothing -> case spine ex of
        (ECon c, args) ->
          let tys = map (Just . snd) (conFields env c) ++ repeat Nothing
           in foldl EApp (ECon c) (zipWith (reducePattern ctx) tys args)
        _ -> ex

    unsupported e = case e of
      EIf {} -> True
      ELet {} -> True
      EOther -> True
      _ -> False

    expandHelper prods (v, helper) =
      [ Production (template ++ ht) (substitute [(v, hp)] pat) (tys ++ htys)
      | Production template pat tys <- prods
      , Production ht hp htys <- oaProductions helper
      ]

    analyseHelper hb args =
      let subst = [(p, a) | (PVar p, a) <- zip (bParams hb) args]
          renamed = substitute (filter ((/= o) . fst) subst) (bBody hb)
          o' = case bParams hb of
            PVar p : _ -> p
            _ -> o
       in analyseObject env scope o (substitute [(o', EVar o)] renamed)

    -- Learn a do-bound key variable's type from how the block uses it.
    refine final switches (x, ki) =
      let fromDefault = kiDefault ki >>= defaultTy
          fromSig = listToMaybe [sty | ECase (ESig (EVar v) sty) _ <- universe final, v == x]
          enumAlts = listToMaybe [[s | Alt (PStr s) b <- alts, not (isFail b)] | ECase (ESig (EVar v) _) alts <- universe final, v == x]
          fromSwitch = listToMaybe [TApp (TCon "Maybe") (TCon cty) | (_, pv, alts) <- switches, pv == x, (PCon "Just" [PCon c []], _) <- alts, Just cty <- [Map.lookup c (envConType env)]]
          fromTuple = tupleUse final x
          ty = listToMaybe (catMaybes [fromSig, usageTy x final, fromSwitch, fst fromTuple, fromDefault])
       in (x, ki {kiTy = ty, kiEnum = enumAlts, kiShape = snd fromTuple})

    defaultTy d = case spine d of
      (ECon c, _) -> TCon <$> Map.lookup c (envConType env)
      (EInt _, _) -> Just (TCon "Int")
      (EStr _, _) -> Just (TCon "Text")
      _ -> Nothing

    -- case (a, b) of (True, Just xs) -> C (map f xs) ...
    tupleUse final x = case [(i, alts) | ECase (ETuple vs) alts <- universe final, (i, EVar v) <- zip [0 :: Int ..] vs, v == x] of
      (i, alts) : _ ->
        let pats = [ps !! i | Alt (PTuple ps) _ <- alts, length ps > i]
            bools = any isBoolPat pats
            inner = listToMaybe [(p, b) | Alt (PTuple ps) b <- alts, length ps > i, PCon "Just" [PVar p] <- [ps !! i]]
         in if bools
              then (Just (TCon "Bool"), Nothing)
              else case inner of
                Just (p, b) -> (fmap (TApp (TCon "Maybe")) (usageTy p b), Nothing)
                Nothing -> (Nothing, Nothing)
      [] -> (Nothing, Nothing)

    isBoolPat (PCon c []) = c `elem` ["True", "False"]
    isBoolPat _ = False

    -- The type a variable has where it is used: a constructor argument, or
    -- mapped over by a function with a signature.
    usageTy p b = listToMaybe (mapMaybe use (universe b))
      where
        use e = case spine e of
          (ECon c, args) -> listToMaybe [ty | (a, (_, ty)) <- zip args (conFields env c), a == EVar p]
          (EVar op, [EVar f, EVar p']) | op `elem` ["map", "traverse"] && p' == p -> case Map.lookup f (msSigs (envMod env)) of
            Just (TFun argTy _) ->
              let direct =
                    [ cty
                    | (ECon c, args) <- map spine (universe b)
                    , (a, (_, cty)) <- zip args (conFields env c)
                    , a == e
                    ]
                  traversedContainers =
                    [ cty
                    | EOp "<$>" (ECon c) a <- universe b
                    , a == e
                    , (_, cty) <- conFields env c
                    ]
                  container = listToMaybe (direct ++ traversedContainers)
               in Just $ case container of
                    Just (TApp (TCon "NonEmpty") _) -> TApp (TCon "NonEmpty") argTy
                    _ -> TList argTy
            _ -> Nothing
          _ -> Nothing

    finalProductions final infos =
      let keyOf v = listToMaybe [kiName ki | ki <- infos, kiVar ki == v]
          varTyOf v = listToMaybe [ty | ki <- infos, kiVar ki == v, Just ty <- [kiTy ki]]
       in case final of
            ECase (ESig (EVar v) _) alts ->
              [ Production
                  (maybe [] (\k -> [(k, TLit (String s))]) (keyOf v) ++ refsTemplate keyOf rhs)
                  (stripPure rhs)
                  (mapMaybe (\ki -> fmap (kiVar ki,) (kiTy ki)) infos)
              | Alt (PStr s) rhs <- alts
              , not (isFail rhs)
              ]
            _ -> case stripPure final of
              ECase (ETuple vs) alts ->
                [ Production (catMaybes (zipWith (tuplePart keyOf) vs ps)) (stripPure rhs) (justVarTys vs ps varTyOf)
                | Alt (PTuple ps) rhs <- alts
                ]
              other -> case spine other of
                (ECon _, _) -> [Production (refsTemplate keyOf other) other (mapMaybe (\ki -> fmap (kiVar ki,) (kiTy ki)) infos)]
                _ -> []

    refsTemplate keyOf rhs = [(k, TVar v) | EVar v <- universe rhs, Just k <- [keyOf v]]

    tuplePart keyOf (EVar v) p = case keyOf v of
      Nothing -> Nothing
      Just k -> case p of
        PCon "True" [] -> Just (k, TLit (Bool True))
        PCon "False" [] -> Just (k, TLit (Bool False))
        PCon "Nothing" [] -> Just (k, TAbsent)
        PCon "Just" [PVar x] -> Just (k, TVar x)
        _ -> Nothing
    tuplePart _ _ _ = Nothing

    justVarTys vs ps varTyOf =
      [ (x, ty)
      | (EVar v, PCon "Just" [PVar x]) <- zip vs ps
      , Just (TApp (TCon "Maybe") ty) <- [varTyOf v]
      ]

-- | Every sub-expression, outermost first.
universe :: Ex -> [Ex]
universe e = e : concatMap universe (children e)
  where
    children ex = case ex of
      EApp a b -> [a, b]
      EOp _ a b -> [a, b]
      ELam _ b -> [b]
      ELamCase as -> [b | Alt _ b <- as]
      ECase s as -> s : [b | Alt _ b <- as]
      EIf a b c -> [a, b, c]
      EDo ss -> concatMap stmtEx ss
      EList xs -> xs
      ETuple xs -> xs
      ERecCon _ fs -> map snd fs
      ERecUpd b fs -> b : map snd fs
      ESig b _ -> [b]
      ELet bs b -> b : map bBody bs
      _ -> []
    stmtEx s = case s of
      SBind _ x -> [x]
      SBody x -> [x]
      SLet bs -> map bBody bs

-- | Replace free variables (not under binders the rules care about).
substitute :: [(Text, Ex)] -> Ex -> Ex
substitute [] e = e
substitute s e = case e of
  EVar v -> fromMaybe e (lookup v s)
  EApp a b -> EApp (go a) (go b)
  EOp op a b -> EOp op (go a) (go b)
  ELam ps b -> ELam ps (substitute (unbind ps) b)
  ELamCase as -> ELamCase [Alt p (substitute (unbind [p]) b) | Alt p b <- as]
  ECase x as -> ECase (go x) [Alt p (substitute (unbind [p]) b) | Alt p b <- as]
  EIf a b c -> EIf (go a) (go b) (go c)
  EDo ss -> EDo (map stmt ss)
  EList xs -> EList (map go xs)
  ETuple xs -> ETuple (map go xs)
  ERecCon c fs -> ERecCon c [(f, go x) | (f, x) <- fs]
  ERecUpd b fs -> ERecUpd (go b) [(f, go x) | (f, x) <- fs]
  ESig b t -> ESig (go b) t
  ELet bs b -> ELet bs (go b)
  _ -> e
  where
    go = substitute s
    unbind ps = filter (\(v, _) -> v `notElem` concatMap patVars ps) s
    stmt st = case st of
      SBind p x -> SBind p (go x)
      SBody x -> SBody (go x)
      SLet bs -> SLet bs

patVars :: Pat -> [Text]
patVars p = case p of
  PVar v -> [v]
  PCon _ ps -> concatMap patVars ps
  PTuple ps -> concatMap patVars ps
  _ -> []

applicative :: Ex -> Maybe (Text, [Ex])
applicative ex = case ex of
  EOp "<*>" l r -> fmap (\(c, as) -> (c, as ++ [r])) (applicative l)
  EOp "<$>" (ECon c) a -> Just (c, [a])
  _ -> Nothing

conFields :: Env -> Text -> [(Maybe Text, Ty)]
conFields env c = fromMaybe [] $ do
  t <- Map.lookup c (envConType env)
  d <- Map.lookup t (msData (envMod env))
  listToMaybe [ciFields ci | ci <- diCons d, ciName ci == c]

-- Keys --------------------------------------------------------------------------------

keyFromInfo :: Env -> [(Text, Ex)] -> KeyInfo -> M Key
keyFromInfo env ctx ki = do
  shape <- case (kiEnum ki, kiShape ki, kiTy ki) of
    (Just vals@(_ : _), _, _) -> pure (SEnum vals)
    (_, Just s, _) -> pure s
    (_, _, Just ty) -> typeShape env (if kiRequired ki then ty else optionalTy ty)
    _ -> do
      unresolved ("key " <> kiName ki <> ": type not determined")
      pure (SOpaque "unknown")
  def <- case (kiDefault ki, kiTy ki) of
    (Just d, Just ty) -> defaultValue env (kiName ki) ctx ty d
    _ -> pure Nothing
  pure (Key (kiName ki) (kiRequired ki) (if kiRequired ki then shape else nullable shape) def)
  where
    -- a `.:?` key on a Maybe field reads as the inner type when absent
    optionalTy ty = case ty of
      TApp (TCon "Maybe") t | isNothing (kiDefault ki) -> t
      _ -> ty
    nullable s = case s of
      SNullable _ -> s
      _ -> SNullable s

-- | Evaluate a default expression and turn the value back into JSON.
defaultValue :: Env -> Text -> [(Text, Ex)] -> Ty -> Ex -> M (Maybe Value)
defaultValue env key ctx ty d = do
  let val = evalEx env ctx (Just ty) d
  json <- case val of
    Just v -> invert env ty v
    Nothing -> pure Nothing
  case json of
    Nothing -> unresolved ("default of " <> key <> ": could not evaluate") >> pure Nothing
    Just j -> pure (Just j)

-- Evaluation ---------------------------------------------------------------------------

-- | Reduce an expression to constructors and literals. @ctx@ binds variables
-- (a preset's option set); @want@ is the expected type, used to resolve @def@.
evalEx :: Env -> [(Text, Ex)] -> Maybe Ty -> Ex -> Maybe Ex
evalEx env ctx want ex = case ex of
  EVar "def" -> do
    ty <- want
    t <- tyName ty
    (b, _) <- Map.lookup ("Default", t) (msInstances ms)
    evalEx env ctx want (bBody b)
  EVar "mempty" -> Just (EList [])
  EVar v
    | Just e <- lookup v ctx -> evalEx env ctx want e
    | Just b <- Map.lookup v (msBinds ms), null (bParams b) -> evalEx env ctx want (bBody b)
  EApp (EVar sel) arg
    | Just (recTy, fty) <- Map.lookup sel (envSelectors env) -> do
        r <- evalEx env ctx (Just (TCon recTy)) arg
        fieldOf r sel >>= evalEx env ctx (Just fty)
  ERecUpd base upds -> do
    r <- evalEx env ctx want base
    (c, fields) <- recordOf r
    evalEx env ctx want (ERecCon c [(f, fromMaybe x (lookup f upds)) | (f, x) <- fields])
  ERecCon c fields -> do
    let types = conFields env c
    fs <- forM fields $ \(name, x) -> do
      let ty = lookup (Just name) types
      y <- evalEx env ctx ty x
      pure (name, y)
    pure (ERecCon c fs)
  EList xs -> EList <$> mapM (evalEx env ctx Nothing) xs
  EStr _ -> Just ex
  EInt _ -> Just ex
  ECon _ -> Just ex
  EApp _ _ -> case spine ex of
    (ECon c, args) ->
      let ftys = map (Just . snd) (conFields env c) ++ repeat Nothing
       in foldl EApp (ECon c) <$> zipWithM (evalEx env ctx) ftys args
    _ -> Nothing
  _ -> Nothing
  where
    ms = envMod env

tyName :: Ty -> Maybe Text
tyName ty = case ty of
  TCon t -> Just t
  TApp f _ -> tyName f
  _ -> Nothing

recordOf :: Ex -> Maybe (Text, [(Text, Ex)])
recordOf ex = case ex of
  ERecCon c fs -> Just (c, fs)
  _ -> Nothing

-- | A record selector applied to a record-syntax value. Every option set the
-- config module defines is written in record syntax; a positional one would
-- leave its defaults unevaluated, which the run reports as unresolved.
fieldOf :: Ex -> Text -> Maybe Ex
fieldOf r sel = case r of
  ERecCon _ fs -> lookup sel fs
  _ -> Nothing

-- Inversion: Haskell value -> JSON ------------------------------------------------------

invert :: Env -> Ty -> Ex -> M (Maybe Value)
invert env ty v = case (ty, v) of
  (TCon "Bool", ECon "True") -> pure (Just (Bool True))
  (TCon "Bool", ECon "False") -> pure (Just (Bool False))
  (TCon t, EInt n) | t `elem` intTypes -> pure $
    case integerShape t of
      SInt _ lo hi | maybe True (n >=) (readBound lo), maybe True (n <=) (readBound hi) -> Just (Number (fromInteger n))
      _ -> Nothing
  (TCon t, EStr s) | t `elem` ["Text", "String", "FilePath"] -> pure (Just (String s))
  (TApp (TCon "Maybe") _, ECon "Nothing") -> pure (Just Null)
  (TApp (TCon "Maybe") t, EApp (ECon "Just") x) -> invert env t x
  (TApp (TCon c) t, EList xs) | c `elem` ["NonEmpty", "Vector", "Set"] -> fmap (fmap (Array . V.fromList) . sequence) (mapM (invert env t) xs)
  (TList t, EList xs) -> fmap (fmap (Array . V.fromList) . sequence) (mapM (invert env t) xs)
  (TCon t, _) -> named t
  (TApp _ _, _) | Just t <- tyName ty -> named t
  _ -> pure Nothing
  where
    readBound = fmap (read . Text.unpack)
    named t | Just (key, wrapper, childTy, options) <- legacyForType env t =
      case spine v of
        (ECon c, [x]) | c == wrapper -> invert env childTy x
        (ECon c, []) -> pure $ do
          name <- lookup c [(con, text) | (text, con) <- options]
          Just (Object (KM.singleton (Key.fromText key) (String name)))
        _ -> pure Nothing
    named t = case Map.lookup t (msData (envMod env)) of
      Just d
        | diNewtypeDerivesFromJSON d
        , [ConInfo c [(_, fty)]] <- diCons d
        , (ECon c', [x]) <- spine v
        , c == c' ->
            invert env fty x
      _ -> do
        prods <- productionsOf env t
        firstJust [fill p | p <- prods]
    positional ex = case ex of
      ERecCon c fields ->
        foldl
          EApp
          (ECon c)
          [positional x | (Just name, _) <- conFields env c, Just x <- [lookup name fields]]
      EApp a b -> EApp (positional a) (positional b)
      _ -> ex
    fill (Production template pat varTys) = case unify pat (positional v) of
      Nothing -> pure Nothing
      Just binds -> do
        parts <- forM template $ \(k, tv) -> case tv of
          TLit j -> pure (Just (Just (k, j)))
          TAbsent -> pure (Just Nothing)
          TVar x -> case (lookup x binds, lookup x varTys) of
            (Just bound, Just xty) -> fmap (fmap (\j -> Just (k, j))) (invert env xty bound)
            (Nothing, _) -> pure (Just Nothing)
            (Just _, Nothing) -> pure Nothing
        pure $ case sequence parts of
          Nothing -> Nothing
          Just kvs -> case (template, catMaybes kvs) of
            ([("", TLit j)], _) -> Just j
            (_, pairs) -> Just (Object (KM.fromList [(Key.fromText k, j) | (k, j) <- pairs]))

firstJust :: [M (Maybe a)] -> M (Maybe a)
firstJust [] = pure Nothing
firstJust (m : ms) = m >>= maybe (firstJust ms) (pure . Just)

-- | Match a production's Haskell expression (whose lower-case variables are
-- pattern variables) against a value.
unify :: Ex -> Ex -> Maybe [(Text, Ex)]
unify pat v = case (pat, v) of
  (EVar x, _) -> Just [(x, v)]
  (ECon a, ECon b) | a == b -> Just []
  (EStr a, EStr b) | a == b -> Just []
  (EInt a, EInt b) | a == b -> Just []
  _ -> case (spine pat, spine v) of
    ((EVar "map", [_, EVar x]), _) -> Just [(x, v)]
    ((ECon a, as), (ECon b, bs)) | a == b, length as == length bs -> concat <$> zipWithM unify as bs
    _ -> Nothing

-- | Every way the parser for @t@ produces a value: the JSON that does it, and
-- the value it produces.
productionsOf :: Env -> Text -> M [Production]
productionsOf env t = case Map.lookup ("FromJSON", t) (msInstances (envMod env)) of
  Nothing -> pure []
  Just (b, others) -> do
    let scope = scopeOf env (others ++ bWhere b)
    pure (go scope (lambda (bParams b) (bBody b)))
  where
    go scope ex = case ex of
      EApp (EApp (EVar "withText") _) f -> [Production [("", TLit (String s))] e [] | (s, e) <- textAlternatives scope f]
      EApp (EApp (EVar "withObject") _) f -> case f of
        ELam (PVar o : _) body -> oaProductions (analyseObject env scope o body)
        EVar fn | Just fb <- lookupBind scope fn, PVar o : _ <- bParams fb -> oaProductions (analyseObject env scope o (bBody fb))
        _ -> []
      ELam [PVar v] (ECase (EVar v') alts)
        | v == v' -> [Production [("", TLit (String s))] (stripPure e) [] | Alt (PCon "String" [PStr s]) e <- alts, not (isFail e)]
      EVar fn | Just fb <- lookupBind scope fn -> go scope (lambda (bParams fb) (bBody fb))
      _ -> []

-- Presets -------------------------------------------------------------------------------

-- | A key that switches the defaults of its siblings: for each accepted
-- value, every sibling key's effective value.
presetsOf :: Env -> ObjectAnalysis -> M [Preset]
presetsOf env analysis = forM (oaSwitches analysis) $ \(bound, keyVar, alts) -> do
  let keyInfo = listToMaybe [ki | ki <- oaKeys analysis, kiVar ki == keyVar]
      presetTy =
        keyInfo >>= kiTy >>= \ty -> case ty of
          TApp (TCon "Maybe") t -> Just t
          _ -> Just ty
      dependents = [ki | ki <- oaKeys analysis, Just d <- [kiDefault ki], EVar bound `elem` universe d]
  values <- forM [(c, e) | (PCon "Just" [PCon c []], e) <- alts] $ \(c, e) -> do
    lit <- case presetTy of
      Just pty -> invert env pty (ECon c)
      Nothing -> pure Nothing
    entries <- forM dependents $ \ki -> case (kiDefault ki, kiTy ki) of
      (Just d, Just ty) -> fmap (fmap (kiName ki,)) (defaultValue env (kiName ki) [(bound, e)] ty d)
      _ -> pure Nothing
    pure $ case lit of
      Just (String s) -> Just (s, catMaybes entries)
      _ -> Nothing
  let name = maybe "" kiName keyInfo
  pure (Preset name (catMaybes values))

-- Passthrough keys --------------------------------------------------------------------

-- | Lists of top-level key names handed to another reader:
-- @any (`KeyMap.member` o) ["TraceOptions", …]@.
passthroughs :: ModuleSyntax -> [Passthrough]
passthroughs ms =
  [ Passthrough keys (bName b)
  | b <- Map.elems (msBinds ms)
  , e <- universe (bBody b)
  , (EVar "any", [f, EList xs]) <- [spineOf e]
  , EVar "member" `elem` universe f
  , let keys = [s | EStr s <- xs]
  , not (null keys)
  ]
  where
    spineOf = spine

-- Rendering --------------------------------------------------------------------------------

renderTy :: Ty -> Text
renderTy ty = case ty of
  TCon t -> t
  TApp f a -> renderTy f <> " " <> wrap a
  TList t -> "[" <> renderTy t <> "]"
  TFun a b -> wrap a <> " -> " <> renderTy b
  TTuple ts -> "(" <> Text.intercalate ", " (map renderTy ts) <> ")"
  TOther -> "?"
  where
    wrap t = case t of
      TApp _ _ -> "(" <> renderTy t <> ")"
      TFun _ _ -> "(" <> renderTy t <> ")"
      _ -> renderTy t
