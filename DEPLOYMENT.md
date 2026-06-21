# Automatic Deployment

This repo deploys the static frontend to `https://www.rezz.asia/` through GitHub Actions whenever `main` receives a push.

## One-time GitHub setup

Open the GitHub repo, then go to:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Create these repository secrets:

- `REZZ_HOST`: production server host or IP.
- `REZZ_USER`: SSH user that can write `/var/www/rezz` and run the existing ownership commands.
- `REZZ_SSH_KEY`: private SSH key for that user.
- `REZZ_PORT`: optional SSH port. Omit it when the server uses port `22`.

Keep server IPs, private keys, and operational notes out of the repo. `OPERATIONS.md` remains ignored for that reason.

## What the workflow does

- Runs on every push to `main`, or manually from the Actions tab.
- Builds a release folder with only public static files.
- Syncs that release to a temporary directory on the server.
- Backs up current frontend files under `/var/www/rezz/.frontend-backups/<timestamp>/`.
- Publishes the new static files to `/var/www/rezz`.
- Preserves production runtime data, especially:
  - `/var/www/rezz/data/matches.json`
  - `/var/www/rezz/data/arena/`
  - `/var/www/rezz/arena/data/`

## Manual fallback

If Actions is unavailable, this is the minimal manual deploy. Fill the environment variables locally instead of committing secrets:

```bash
REZZ_USER=<ssh-user>
REZZ_HOST=<server-host-or-ip>
REZZ_PORT=${REZZ_PORT:-22}
rsync -av -e "ssh -p $REZZ_PORT" app.js index.html "$REZZ_USER@$REZZ_HOST:/tmp/wc-arena-static-patch/"
ssh -p "$REZZ_PORT" "$REZZ_USER@$REZZ_HOST" 'set -e; cd /var/www/rezz; ts=$(date +%Y%m%d%H%M%S); cp index.html index.html.bak-$ts; cp app.js app.js.bak-$ts; cp /tmp/wc-arena-static-patch/index.html /tmp/wc-arena-static-patch/app.js .; chown www-data:www-data index.html app.js; chmod 644 index.html app.js; rm -rf /tmp/wc-arena-static-patch'
```
