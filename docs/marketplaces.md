# Marketplace connections and the Chrome helper

The inventory is the source of truth for item identity, location, and intended sale workflow. External actions retain their own state and require verification.

## Facebook Marketplace helper

1. Set `appOrigin` in `shared/browser-helper-config.json` to your deployed app origin and run `npm run build`.
2. In desktop Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** with the generated `extension/dist` folder. Alternatively, download and unzip the package from the app's Connections screen.
3. Reload the app tab, sign in, and use **Connections → Connect this browser**. Keep that authenticated tab open.
4. Open a local-pickup item, review and save its public draft, then choose **Selling → Send to Chrome helper**.
5. Open the Facebook item form through the helper. Confirm the seller account and that the form is empty, then choose **Fill text & add photos**.
6. Check text and uploaded previews; select category, condition, and pickup location yourself. Publish on Facebook when ready.
7. Return the direct listing URL through the helper. Open and confirm the link in the app before it is recorded as a published listing.

The adapter targets the English desktop Item for sale form. Unknown or ambiguous fields, occupied forms, sign-in challenges, and readback failures stop preparation. Photo dispatch is not proof that Facebook finished uploading. Copy buttons and photo downloads remain available as a fallback.

### Handshake and recovery

- The extension uses a content bridge in an authenticated app tab to call narrowly allowed same-origin endpoints. It does not receive app API keys, Access service credentials, Facebook passwords, or Facebook cookies.
- Only configured app origins can connect. Only the extension UI can initiate form operations. Facebook host access is requested when needed.
- Pairings are scoped to the signed-in operator. Revocation blocks future claims, reports, and media reads.
- A handoff captures reviewed public fields and selected photos, including their saved order and rotation. Private owner/location/notes/estimate/audio/buyer fields and object-storage keys are excluded.
- Claims and write intent are persisted before modifying the form. A browser restart or uncertain upload never triggers automatic replay. Inspect the existing form or explicitly cancel and restart the handoff.
- A returned URL is an observation until the seller confirms it. Cancelling a handoff does not remove a Facebook draft or listing.

The helper does not monitor Messenger, negotiate, publish, mark items sold, or delete listings. Local sold/removal tasks remain manual. Live Facebook compatibility and background-tab behavior require testing in the seller's browser.

### Browser fixture checks

`node tests/browser-helper-browser.mjs` uses a migrated local Worker serving the built app at `http://127.0.0.1:8787`, an isolated Chrome profile, and a local form fixture. Set `NEXT_CHAPTER_CHROME` to a Chrome for Testing executable. The harness uses Chrome's debugging protocol and never opens Facebook. It creates clearly named local test items and writes artifacts under `work/browser-helper/`.

`node scripts/build-extension.mjs --dev` generates a separate development extension with loopback access. The production package has no fixture or loopback access.

## Etsy and eBay

Keep `MARKETPLACE_CONNECTIONS_ENABLED=false` until developer access, credentials, and callback registrations are ready. Configure `MARKETPLACE_APP_URL` with your app's HTTPS origin, and install secrets using interactive `npx wrangler secret put NAME` prompts:

| Secret | Purpose |
| --- | --- |
| `MARKETPLACE_TOKEN_KEY` | Independent high-entropy secret of at least 32 characters for encrypted token storage |
| `ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET` | Approved Etsy keystring and shared secret |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` | eBay developer credentials and registered redirect name; use sandbox first |

Register these callback paths at your own app origin:

```text
/api/marketplaces/etsy/callback
/api/marketplaces/ebay/callback
```

Keep Access protection on the callbacks. OAuth begins and ends in the same signed-in browser. State is browser-bound, operator-bound, expiring, and single-use. Etsy uses PKCE. Tokens are encrypted with authenticated channel/environment context; refresh operations use leases and conditional writes.

Enable the flag, deploy, then authorize the intended seller account in Connections. Linking an account does not activate unattended selling. Do not rotate the encryption key casually: existing tokens need migration or reauthorization.

### Etsy draft transfer

The setup check reads account/shop identity, USD currency, onboarding, and shipping/processing/return profiles. The first supported transfer uses fixed-price shipping and quantity-one physical listings.

In an item's Etsy panel, choose the category and profiles, save and review the draft, then explicitly request an unpublished transfer. The runner records each operation, creates the draft, sets the item code as SKU, uploads selected images, and reads back the result. Ambiguous creation or upload responses stop for inspection; they do not trigger blind duplicate POSTs.

Category attributes, eligibility, and live account-specific responses still need validation in the seller's shop. Calculated shipping and active publication need further work. Etsy verification must use a real completed seller shop; this project does not provide a simulated Etsy account.

### eBay, orders, and removal readiness

The eBay code includes OAuth, local draft validation, seller-policy/category request builders, and inventory/offer adapters. Complete the transfer runner and verify sandbox seller policies, categories, conditions, photos, and unpublished offers before enabling live selling.

Order readers, deduplication, polling checkpoints, paid-order allocation, task creation, and verified-removal adapters have automated coverage. Live activation controls, scheduling, seller mappings, and account lifecycle checks remain. The public build does not start live order polling or automatic delisting.

Use sandbox/fixture checks first, then a bounded seller-account trial. Treat cancellation, refunds, competing sales, revoked authorization, partial uploads, and unknown remote outcomes as explicit states that need verification.
