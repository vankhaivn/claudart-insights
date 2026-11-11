# Prices

USD per million tokens, per model id, each row in force from its date until a later row for the same id. `node bin/insights.mjs` uses them to spread the host's recorded cost over requests, to estimate a session the host left without a cost record, and to check the host's figures; it never replaces a cost the host recorded. A cache write the host did not split into 5m and 1h is priced as a 1h write.

When `scan` reports that a model misses this table, run `node bin/insights.mjs prices`, check the fitted prices against the provider's price list, and add a row from the day the price changed. Never edit a row in place: earlier days keep their price.

| model | from | input | output | cache read | cache write 5m | cache write 1h |
| --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | 2026-10-01 | 4 | 20 | 0.20 | 5 | 8 |
| claude-sonnet-5-5 | 2026-10-01 | 2 | 10 | 0.10 | 2.50 | 4 |
| claude-haiku-5-5 | 2026-10-01 | 0.10 | 0.50 | 0.01 | 0.125 | 0.20 |
