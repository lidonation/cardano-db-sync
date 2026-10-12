/**
 * The landing page's sample queries and quickstart queries (B44-a), kept apart from the page so
 * `test/db/sample-queries.test.ts` can plan every one against the replayed schema: SQL shown to an
 * operator must run on the schema this build documents. Each is written for the default `core`
 * tx_out variant, the one db-sync creates unless `tx_out.use_address_table` is set.
 */
export const SAMPLE_QUERIES = {
  tip: `SELECT block_no, epoch_no, time
FROM block
ORDER BY id DESC
LIMIT 1;`,
  balance: `SELECT SUM(o.value) AS lovelace
FROM tx_out o
LEFT JOIN tx_in i
  ON i.tx_out_id = o.tx_id
 AND i.tx_out_index = o.index
WHERE o.address = 'addr1qxy…'
  AND i.id IS NULL;`,
  rewards: `SELECT SUM(amount) AS lovelace
FROM reward
WHERE earned_epoch =
  (SELECT MAX(earned_epoch) FROM reward);`,
  syncCheck: `SELECT MAX(block_no) FROM block;`,
} as const;
