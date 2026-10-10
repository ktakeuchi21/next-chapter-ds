# Deployment and recovery

The repository is configured for local evaluation. A cloud deployment needs its own Cloudflare resources and authentication settings.

## Provision resources

1. Sign in with `npx wrangler login`.
2. Create the D1 database with `npx wrangler d1 create next-chapter`. Set its returned ID in `wrangler.jsonc`. Keep the distinct `preview_database_id` for local development.
3. Create private R2 buckets with `npx wrangler r2 bucket create next-chapter-media` and `npx wrangler r2 bucket create next-chapter-backups`.
4. Choose the Worker name and final hostname. Set `MARKETPLACE_APP_URL` and `shared/browser-helper-config.json` → `appOrigin` to that HTTPS origin, without a trailing slash or path.
5. Configure a Cloudflare Access application and an explicit allow policy for the intended operators. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ALLOWED_EMAILS` in the Worker vars.

The API checks the signed Access JWT and the email allowlist independently. Production must use `LOCAL_DEV=false`; the development bypass also requires a loopback hostname. Protect the entire app hostname with Access, including downloads and media.

The extension config contains a public key used to stabilize the unpacked extension ID. It is not a credential. Its example hostname must be replaced for your deployment. For an independently distributed extension, generate a new public identity and derive its matching Chrome extension ID; a Web Store release must use the identity assigned to that extension.

## Add secrets and deploy

Use interactive secret prompts, not command-line literals:

```sh
npx wrangler secret put OPENAI_API_KEY
npx wrangler d1 migrations apply next-chapter --remote
npm run deploy
```

Marketplace secrets are optional until you enable those connections; see [the marketplace guide](marketplaces.md). Never commit `.env.local`, `.dev.vars`, private keys, or credentials. Keep account-specific configuration in your private deployment workspace.

The build creates the frontend and `public/downloads/next-chapter-helper.zip`. Generated bundles are ignored by Git. Local data is not uploaded during deployment.

Before using real inventory, check an authorized sign-in and verify that unauthenticated API, media, download, and export requests are denied or redirected to Access. Create a small test item, verify an upload and a bounded AI task, and confirm the record survives a redeploy.

## Enable and verify backups

After provisioning the backup bucket, set `BACKUPS_ENABLED=true` and deploy. The five-minute schedule starts a daily private backup after 09:00 UTC and advances media copying in bounded batches. Connections shows progress, failures, and completion. Retention keeps 30 days and at least seven successful copies.

Backups include allowlisted inventory/task metadata and referenced media. They exclude marketplace credentials, OAuth state, and browser device pairings. Reconnect seller accounts and browsers after an inventory restore. Restore handling pauses unfinished external operations for review rather than replaying them.

For an on-demand cloud download:

```sh
npm run backup:cloud
```

To download a completed scheduled backup:

```sh
node scripts/download-backup.mjs BACKUP_ID
```

Test recovery into a new local state directory:

```sh
node scripts/restore-local.mjs work/downloaded-backups/BACKUP_ID work/restored-state
npx wrangler dev --ip 127.0.0.1 --port 8788 --persist-to work/restored-state
```

Use local development authentication when running the restored instance. The restore script rejects an existing destination and verifies checksums before restoring. These commands do not restore over a production database. Reconcile external marketplace operations before any production recovery from an older snapshot.

For local development data, `npm run backup:local` uses the running local API and writes a private backup under `work/backups`. Keep an additional protected copy outside the cloud account for recovery from account loss.

## Limits

The default daily AI task limit is 30, with one active task per item/kind. Photos and audio are capped at 20 MB, videos at 50 MB. Research uses up to four photos. Job recovery runs on the five-minute schedule; ambiguous provider failures require a deliberate retry.

These controls bound work but do not provide a hard spending cap. Monitor storage, AI usage, and the cloud account's billing alerts. Device-specific camera, microphone, HEIC, and video behavior needs testing on the actual devices used in the field.
