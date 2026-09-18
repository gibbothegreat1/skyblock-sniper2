# Vercel runtime database fix

The deployed functions now carry `data/skyblock.db.gz` and expand it into `/tmp/skyblock.db` lazily on first use.
This avoids two Vercel issues:

1. the deployment bundle filesystem is read-only while this SQLite file was in WAL mode;
2. the old `outputFileTracingIncludes` keys used filesystem paths instead of route paths.

`/api/health` now reports the exact runtime DB path, size, journal mode and any SQLite error.
