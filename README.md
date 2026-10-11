# musicalimage

Pick an old Photo and hear what you were listening to when it was taken.

musicalimage takes the Capture Time of a Photo from your Google Photos library, looks up the Scrobbles in your Last.fm listening history around that moment, and shows you a Memory: the Photo's thumbnail together with the Tracks you played at the moment, that day, that week and that month, each with a link to YouTube and Spotify and a ▶ button that plays a 30-second preview from Deezer.

It is a small server you run on your own computer. You bring your own Google OAuth client and your own Last.fm API account; nothing is hosted centrally. See [ADR 0001](docs/adr/0001-self-hosted-with-own-api-keys.md) for why, and [ADR 0002](docs/adr/0002-google-photos-picker-not-library-browsing.md) for why Photos are chosen through the Google Photos Picker. The terms used here (Owner, Photo, Capture Time, Scrobble, Track, Memory, Tier) are defined in [CONTEXT.md](CONTEXT.md).

> **Status:** early development. Last.fm login, Memories for a date and Memories for Photos picked from Google Photos work.

## Setup

You need about 20 minutes. You are the **Owner**: the one person whose Photos and Last.fm history this instance uses.

### 1. Prerequisites

- **Node.js 22.17 or newer.** Check with `node --version`. With [nvm](https://github.com/nvm-sh/nvm):

  ```sh
  nvm install 22
  nvm use
  ```

  Inside the project folder, `nvm use` picks up the version from `.nvmrc`. `npm install` refuses older Node versions.

- **npm** (comes with Node.js) and **git**.
- A **Google account** with your photos in Google Photos.
- A **Last.fm account** with your listening history.

### 2. Get the code

```sh
git clone <repository-url> musicalimage
cd musicalimage
npm install
cp .env.example .env
```

You will fill in `.env` in step 5.

### 3. Create your Google OAuth client

This lets musicalimage open the Google Photos Picker on your behalf. Everything happens in the [Google Cloud Console](https://console.cloud.google.com/), signed in with the Google account that holds your photos.

1. **Create a project.** Open the project selector at the top, choose **New project**, name it e.g. `musicalimage`, and create it. Make sure the new project is selected.
2. **Enable the Photos Picker API.** Go to **APIs & Services → Library**, search for **Google Photos Picker API**, open it and click **Enable**.
3. **Configure the OAuth consent screen.** Go to **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles) and click **Get started**:
   - **App information:** app name `musicalimage`, user support email = your address.
   - **Audience:** choose **External**.
   - **Contact information:** your address. Accept the policy and click **Create**.
4. **Stay in Testing mode and add yourself as test user.** Under **Audience**, leave the publishing status at **Testing** (do *not* publish the app). Under **Test users**, click **Add users** and enter the Google account address that holds your photos.
5. **Add the scope** (optional but recommended). Under **Data access**, click **Add or remove scopes** and add
   `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`, then **Save**.
6. **Create the OAuth client.** Go to **Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**):
   - **Application type:** **Web application**
   - **Name:** e.g. `musicalimage local`
   - **Authorized redirect URIs:** add exactly

     ```
     http://localhost:3000/auth/google/callback
     ```

   - Click **Create**.
7. Copy the **Client ID** and **Client secret** shown in the dialog. They go into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. (If you closed the dialog, open the client again under **Clients**; a new secret can be added there.)

**About Testing mode:** because the app stays in Testing mode, Google does not need to verify it, and only the test users you added can sign in. musicalimage asks Google only for a short-lived access token (no refresh token) and keeps it in the server's memory, so you sign in to Google each time you pick Photos after a server restart or after about an hour (see step 7). Your Last.fm connection is not affected.

### 4. Create your Last.fm API account

This lets musicalimage read your Scrobbles, including a listening history you have set to private.

1. Sign in to Last.fm and open [last.fm/api/account/create](https://www.last.fm/api/account/create).
2. Fill in the form:
   - **Contact email:** your address
   - **Application name:** `musicalimage`
   - **Application description:** e.g. `Personal, self-hosted: pairs my photos with my scrobbles`
   - **Callback URL:** exactly

     ```
     http://localhost:3000/auth/lastfm/callback
     ```

   - **Application homepage:** may be left empty (or the repository URL).
3. Submit. Copy the **API key** and **Shared secret** shown. They go into `LASTFM_API_KEY` and `LASTFM_SHARED_SECRET`. You can view them again later at [last.fm/api/accounts](https://www.last.fm/api/accounts).

**About Last.fm's terms:** the Last.fm API may only be used for **non-commercial** purposes (see the [Last.fm API Terms of Service](https://www.last.fm/api/tos)). musicalimage is a personal, non-commercial tool; keep your instance that way.

### 5. Fill in `.env`

Open the `.env` file you copied in step 2 and fill in all four values:

| Variable | Where it comes from |
|----------|---------------------|
| `GOOGLE_CLIENT_ID` | Google Cloud Console, step 3.7 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console, step 3.7 |
| `LASTFM_API_KEY` | Last.fm API account, step 4.3 |
| `LASTFM_SHARED_SECRET` | Last.fm API account, step 4.3 |
| `HOST` | Address the server listens on. Keep `127.0.0.1` (from `.env.example`) so only this computer can reach it; without it the server is reachable from your whole network |
| `DATA_DIR` | Optional. Folder for the local database; defaults to `data` |

Example:

```sh
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
LASTFM_API_KEY=0123456789abcdef0123456789abcdef
LASTFM_SHARED_SECRET=fedcba9876543210fedcba9876543210
```

`.env` holds secrets: it is listed in `.gitignore` and must never be committed or shared. The secrets are only read by the server and never sent to the browser. If a value is missing, the server still starts, but every feature that needs the value fails with an error naming every missing variable.

### 6. Start musicalimage

```sh
npm start
```

This builds the app and starts the server, reading `.env` at startup. Open **<http://localhost:3000>** in your browser.

Use exactly `localhost:3000`: the callback URLs registered with Google and Last.fm point there. Stop the server with `Ctrl+C`.

### 7. Pick Photos

On the home page, click **Pick Photos**. musicalimage asks you to sign in to Google, then opens the Google Photos Picker in a new window: choose up to 20 Photos and click **Done**. You then see one Memory per Photo, with its thumbnail.

You sign in to Google **once per session**: the Google access token is kept only in the server's memory (never on disk), so after a server restart, or after about one hour, Pick Photos asks you to sign in again. Picked Photos are also only kept in memory for at most one hour (Google's thumbnail links expire then); after that, or after a restart, the Memories page asks you to pick again.

## Your data

musicalimage stores its local state (your Last.fm session and cached Scrobbles) in a SQLite database in the `data/` folder (or `DATA_DIR`), created on first use. It is gitignored. Delete the folder to start fresh. Photos, thumbnails, picked items and the Google access token are never stored; they live only in the server's memory.

When you press ▶ next to a Track, the server sends its artist and title to Deezer's public search (no account, no key), and your browser then loads the 30-second MP3 directly from Deezer's CDN (`dzcdn.net`). Nothing is sent to Deezer unless you press ▶.

The server answers only to `localhost:3000` and `127.0.0.1:3000`; requests with any other `Host` header get `421`, which stops other web pages from reading your Memories through DNS rebinding.

## Development

| Command | What it does |
|---------|--------------|
| `npm run dev` | Development server with hot reload on <http://localhost:3000> |
| `npm run build` | Production build into `build/` |
| `npm start` | Build and run the production server with `.env` |
| `npm run check` | Type-check (svelte-check) |
| `npm test` | Run the unit tests (Vitest) |

Built with SvelteKit 3, Svelte 5, Vite 8 and TypeScript, served by `@sveltejs/adapter-node`. Server-only code (anything that touches secrets or the database) lives in `src/lib/server/` and is imported as `#lib/server/...`; SvelteKit refuses to build if browser code imports it.

## License

[MIT](LICENSE) © 2026 Anton Pyschny
