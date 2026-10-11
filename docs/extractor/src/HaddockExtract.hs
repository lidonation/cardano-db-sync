-- | The B07 extractor: @ghc-lib-parser@ over the Haskell sources, one
-- committed JSON artifact out. See the package README for the contract.
module HaddockExtract (
  module HaddockExtract.Model,
  module HaddockExtract.Parse,
  module HaddockExtract.Run,
  module HaddockExtract.Walk,
)
where

import HaddockExtract.Model
import HaddockExtract.Parse
import HaddockExtract.Run
import HaddockExtract.Walk
