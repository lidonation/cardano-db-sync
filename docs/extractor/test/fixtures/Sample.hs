-- | Fixture module for the golden test.
--
-- Every documented shape the extractor understands appears here once; the golden file pins the
-- exact association rules. The B07 DoD verification adds an annotation to this file (the same way
-- it adds one to a schema module) and checks that it appears in the artifact on the next run.
module Sample (
  -- * Shapes
  Shape (..),

  -- * Operations
  area,
  describe,
)
where

-- | A documented geometric shape.
data Shape
  = -- | A square, sized by its side.
    Square
      { side :: Double
      -- ^ The side length, in drawing units.
      }
  | -- | A circle, sized by its radius.
    Circle
      { radius :: Double
      -- ^ The radius, in drawing units.
      }
  deriving (Eq, Show)

-- | Things that can be rendered as one line of text.
class Describable a where
  -- | Render the value as a single line.
  describe :: a -> String

  -- | The area of the value.
  area :: a -> Double
  -- ^ Attached to the method above.

-- | Compute the area of a shape.
--
-- Used by the schema explorer to show relative sizes.
area :: Shape -> Double
area shape = case shape of
  Square Square {side} -> side * side
  Circle Circle {radius} -> pi * radius * radius

-- | A distance in drawing units.
type Length = Double

-- * Rendering

-- How shapes are turned into prose for the docs site.

-- | Named chunk reused across pages.

-- $setup
-- How to draw the shape described above.

setup :: IO ()
setup = pure ()

-- | Shapes describe themselves.
instance Describable Shape where
  describe = show
