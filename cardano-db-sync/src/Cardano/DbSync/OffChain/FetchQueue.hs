{-# LANGUAGE NoImplicitPrelude #-}

module Cardano.DbSync.OffChain.FetchQueue (
  newRetry,
  retryAgain,
) where

import Cardano.DbSync.Types
import Cardano.Prelude hiding (retry)
import Data.Time.Clock.POSIX (POSIXTime)

-- | Start an immediately eligible metadata fetch. Pool registrations create @pool_metadata_ref@
-- entries; the fetch queue selects new or previously failed references. Successful pool fetches are
-- stored in @off_chain_pool_data@; failures go to @off_chain_pool_fetch_error@ for a later retry.
newRetry :: POSIXTime -> Retry
newRetry now =
  Retry
    { retryFetchTime = now
    , retryRetryTime = now -- For a new one, retry time is now.
    , retryCount = 0
    }

-- | Schedule a retry after a failed off-chain metadata fetch. The first retry delay is 150 seconds;
-- delays increase with the retry count and reach 24 hours at count five.
retryAgain :: POSIXTime -> Word -> Retry
retryAgain fetchTime existingRetryCount =
  -- When to retry. Maximum of a day for a retry.
  -- POSIXTime is in seconds.
  Retry
    { retryFetchTime = fetchTime
    , retryRetryTime = fetchTime + retryDiff
    , retryCount = nextRetryCount
    }
  where
    nextRetryCount :: Word
    nextRetryCount = 1 + existingRetryCount

    retryDiff =
      if nextRetryCount >= 5
        then 24 * 60 * 60
        else min (24 * 60 * 60) (30 + (2 ^ nextRetryCount) * 60)
