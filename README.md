A near-zero-dependency, vanilla JS/CSS embed toolkit for Bluesky / AT Protocol content.

You load one script (`dist/embed.js`) and it auto-loads only what is needed for posts/discussions, profile cards, and members grids.

Disclaimer: Entirely vibe coded.

## Features

- Single entrypoint: one `<script>` tag (`dist/embed.js`) as loader.
- Auto runtime loading: loads `post.js`, `profile.js`, and `members.js` only when matching containers exist.
- Post + discussion embeds from AT URI or Bluesky-style post URLs.
- Profile widget with optional avatar, cover, metrics, and CTA buttons.
- Members widget for list URLs, list AT URIs, starter-pack URLs, and starter-pack AT URIs.

## Usage

Load the loader:

```html
<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/embed.js"></script>
```

### Post

```html
<div
  class="atproto-embed"
  data-uri="at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3mhgprzgahs2l"
  data-mode="post"
  data-width="100%"
  data-max-width="728px"
  data-show-likes="true"
  data-show-reposts="true"
  data-show-replies="true"
  data-show-quotes="true"
  data-show-bookmarks="true"
  data-show-metrics="true"
  data-show-timestamp="true"
  data-show-actions="true"
  data-show-reply-context="true"
  data-show-embeds="true"
  data-show-images="true"
  data-show-video="true"
  data-show-external="true"
  data-show-quote-posts="true"
  data-external-layout="vertical"
  data-show-badges="true"
  data-show-labels="true"
>
</div>
```

### Discussion

```html
<div
  class="atproto-embed"
  data-uri="at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3mhgprzgahs2l"
  data-mode="discussion"
  data-width="100%"
  data-max-width="728px"
  data-show-likes="true"
  data-show-reposts="true"
  data-show-replies="true"
  data-show-quotes="true"
  data-show-bookmarks="true"
  data-show-metrics="true"
  data-show-timestamp="true"
  data-show-actions="true"
  data-show-reply-context="true"
  data-show-embeds="true"
  data-show-images="true"
  data-show-video="true"
  data-show-external="true"
  data-show-quote-posts="true"
  data-external-layout="vertical"
  data-show-badges="true"
  data-show-labels="true"
  data-show-reply-quote-labels="false"
  data-show-main-post="true"
  data-show-liked-by="true"
  data-show-replies-tab="true"
  data-show-quotes-tab="true"
  data-show-tabs="true"
  data-show-sort="true"
  data-show-join-button="true"
  data-replies-sort="oldest"
>
</div>
```

### Profile

```html
<div
  class="atproto-profile"
  data-profile="bsky.app"
  data-width="100%"
  data-max-width="440px"
  data-size="full"
  data-show-avatar="true"
  data-show-display-name="true"
  data-show-handle="true"
  data-show-verification="true"
  data-show-description="true"
  data-show-cover="true"
  data-show-metrics="true"
  data-show-followers="true"
  data-show-following="true"
  data-show-posts="true"
  data-show-follow="true"
  data-show-connect="true"
  data-client-name="Bluesky"
  data-client-domain="bsky.app"
>
</div>
```

### Members

```html
<div
  class="atproto-members"
  data-list="https://bsky.app/profile/bsky.app/lists/3lvpca43j5z26"
  data-width="100%"
  data-max-width="960px"
  data-columns="3"
  data-limit="15"
  data-show-avatar="true"
  data-show-display-name="true"
  data-show-handle="true"
  data-show-verification="true"
  data-show-metrics="true"
  data-show-posts="true"
  data-show-followers="true"
  data-show-following="true"
>
</div>
```

## Supported Inputs

### Post embed (`data-uri`)

- `at://did:.../app.bsky.feed.post/<rkey>`
- `https://<client>/profile/<handle-or-did>/post/<rkey>`

### Members widget (`data-list`)

- List AT URI: `at://did:.../app.bsky.graph.list/<rkey>`
- List URL: `https://<client>/profile/<handle-or-did>/lists/<rkey>`
- Starter-pack AT URI: `at://did:.../app.bsky.graph.starterpack/<rkey>`
- Starter-pack URL (profile form): `https://<client>/profile/<handle-or-did>/starter-pack/<rkey>`

Starter-pack inputs are resolved through `app.bsky.graph.getStarterPack` and then rendered via its backing list.

## Distribution Layout (`dist/`)

Build output:

- `dist/embed.js`: lightweight loader entrypoint
- `dist/post.js`: post + discussion runtime
- `dist/profile.js`: profile runtime
- `dist/members.js`: members runtime
- `dist/post.css`, `dist/profile.css`, `dist/members.css`: standalone CSS copies
- `dist/embed.css`: standalone CSS copy

## Local Development

Run a static server:

```bash
npx -y serve -l 1234 .
```

Build distribution bundles:

```bash
npm run build
```

Release flow (build + version + tag + push):

```bash
npm run release
```

## Badges

![GitHub License](https://img.shields.io/github/license/romiojoseph/atproto-embed)
![jsDelivr hits (GitHub)](https://img.shields.io/jsdelivr/gh/hm/romiojoseph/atproto-embed)
![GitHub commit activity](https://img.shields.io/github/commit-activity/y/romiojoseph/atproto-embed)
![GitHub last commit](https://img.shields.io/github/last-commit/romiojoseph/atproto-embed)
![GitHub Tag](https://img.shields.io/github/v/tag/romiojoseph/atproto-embed?include_prereleases)
![embed.js size](https://img.shields.io/github/size/romiojoseph/atproto-embed/dist%2Fembed.js)
![post.js size](https://img.shields.io/github/size/romiojoseph/atproto-embed/dist%2Fpost.js)
![profile.js size](https://img.shields.io/github/size/romiojoseph/atproto-embed/dist%2Fprofile.js)
![members.js size](https://img.shields.io/github/size/romiojoseph/atproto-embed/dist%2Fmembers.js)
[![jsDelivr package](https://data.jsdelivr.com/v1/package/gh/romiojoseph/atproto-embed/badge)](https://www.jsdelivr.com/package/gh/romiojoseph/atproto-embed)