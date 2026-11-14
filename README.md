# Selg

Photograph used things with your phone and get ready-to-post listings.

1. Add photos or a short video of one thing or a whole pile.
2. Claude works out the separate items, sorts the photos, and drafts a listing for each: Norwegian text for Finn.no, Tise and Facebook Marketplace, English text for eBay, and a price estimate in NOK.
3. Check the listings on one screen, change anything with a tap, and approve.
4. Copy each field to the marketplace with one tap, save the photos to your camera roll, and open the marketplace's new-ad page.

Posting to Finn, Tise and Facebook is always done by you; the app only prepares the text and photos.

## What happens to your photos

- Photos are shrunk on the phone before upload. From a video, the phone picks the sharpest, steadiest moments and corrects a washed-out or dark picture.
- When a photo shows several things, each item is cut out. When one item fills only part of a photo, the surroundings are trimmed.
- Soft photos get careful sharpening. Photos too blurry to rescue are marked "Blurry" so you can retake them.
- The item itself is never redrawn, and the original photo is always kept: tap a photo and choose "Use the original photo instead".

Removing a background completely or placing an item in a new scene needs a separate image-editing service and is not built in.

## What is where

| Folder | What it holds |
| --- | --- |
| `web/` | The app you see on the phone (React). |
| `server/` | The part that stores photos and listings and talks to Claude (Node.js). |
| `server/prompts.ts` | The instructions Claude gets. Edit this to change how listings are written. |
| `web/src/lib/platforms.ts` | Marketplace links and the fields each one needs. |
| `render.yaml` | How Render runs the app. |
| `shared/` | Code used by both halves (how sharpness is measured). |
| `scripts/` | Test helpers. |

## Settings

All settings are environment variables. Nothing secret is in the code. On Render they live on the service's **Environment** page.

| Name | Needed | What it is |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Your key from the Anthropic Console. |
| `APP_PASSCODE` | yes | The passcode you type once per device to open the app. |
| `DATABASE_URL` | yes | The Postgres address. Render fills this in. |
| `SESSION_SECRET` | no | Random text that keeps devices signed in. Render generates it. |
| `CLAUDE_MODEL` | no | Which Claude model writes the listings. Default `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | no | `low`, `medium` (default) or `high`. Higher is more careful and costs more. |
| `USD_TO_NOK` | no | Exchange rate used to show API fees in kroner. Default `10.5`. |

## Running it on your own computer

You need Node.js 22 or newer and a Postgres database.

```bash
cp .env.example .env
```

Fill in `.env`, then:

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

## Testing

Build and start the app, then run the phone-sized walkthrough (it needs Playwright installed on the machine):

```bash
npm run build && npm start
```

```bash
node scripts/e2e.mjs http://localhost:3000 path/to/folder-with-photos
```

To try the AI on a few photos and print the listings:

```bash
node scripts/try-ai.mjs http://localhost:3000 out-folder photo1.jpg photo2.jpg
```

Setting `FAKE_AI=1` makes the server return canned listings without calling Claude, which is useful for testing the screens for free.

## Several users later

There are no logins yet: everyone who knows the passcode shares one account. Every table already stores a `user_id`, and `server/users.ts` is the single place that decides who the current user is, so real accounts can be added without restructuring the data.
