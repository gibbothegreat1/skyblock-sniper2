# Vercel database deployment

The live SQLite database is committed as `data/skyblock.db.gz` instead of `data/skyblock.db`.
This avoids relying on Git LFS at Vercel runtime.

`npm run build` automatically runs `scripts/prepare-db.js` first. That expands the gzip into
`data/skyblock.db`, then Next.js bundles the real SQLite file into the API functions.

## First deployment after switching away from LFS

From the repository root:

```powershell
git rm --cached "skyblock-sniper/skyblock-sniper/data/skyblock.db"
Remove-Item "skyblock-sniper/skyblock-sniper/data/skyblock.db" -ErrorAction SilentlyContinue
git add -A
git commit -m "Fix Vercel database and redesign search"
git push
```

The `.db` file is generated during the Vercel build and is intentionally ignored by Git.

## Updating the database later

Replace/compress the database locally:

```powershell
python -c "import gzip,shutil; f=open(r'skyblock-sniper/skyblock-sniper/data/skyblock.db','rb'); g=gzip.open(r'skyblock-sniper/skyblock-sniper/data/skyblock.db.gz','wb',compresslevel=9); shutil.copyfileobj(f,g); g.close(); f.close()"
```

Then commit only the `.gz` update:

```powershell
git add "skyblock-sniper/skyblock-sniper/data/skyblock.db.gz"
git commit -m "Update SkyBlock database"
git push
```
