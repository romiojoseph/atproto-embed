A near-zero-dependency (just HLS.js for browsers that don't support HLS natively), vanilla JS/CSS web component to embed Bluesky / AT Protocol posts and discussions (threads) directly into your website or blog.

Disclaimer: Entirely vibe coded.

## Features

- **Near-zero dependencies**: No React, no heavy frameworks. Just plain JS and CSS.
- **Single file distribution**: The script comes with all CSS and SVGs inlined — just one `<script>` tag and you're done.
- **Two modes**:
    - `post`: Embed a single post.
    - `discussion`: Embed a full comment section/thread. (Note: The root post is shown by default above the discussion.)
- **Highly customisable**: Dozens of `data-*` attributes to toggle visibility of metrics, buttons, timestamps, badges, etc.

## Usage (via jsDelivr)

Include the pre-built, self-contained `embed.js` from the `dist/` directory on jsDelivr. Since the CSS is inlined, you don't need a separate stylesheet link. You can also download the files and modify them as needed.

```html
	<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/embed.js"></script>
```

To display an embed, create a `div` with `class="atproto-embed"` and provide the `data-uri` for the post you want to feature.

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
<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/embed.js"></script>
```

_It can embed any post from any client that follows the same Bluesky post link pattern (`at://did:plc:abc1def2ghi3jkl/app.bsky.feed.post/rkey`)._

---

## Embed Modes & Configuration

You configure the widget using standard HTML `data-*` attributes on the `div`.

#### `data-mode`

- `"post"`: Shows a standalone post card. (Default)
- `"discussion"`: Shows a comment section including parent/thread relations, "Liked by" previews, and Replies/Quotes tabs.

## All Configuration Attributes

You can freely toggle components of the embed `true` or `false`. If omitted, default values apply (most default to `true`).

#### Shared Settings

|Attribute|Description|Default|
|---|---|---|
|`data-width`|CSS width of the embed container (e.g. `100%`)|`100%`|
|`data-max-width`|CSS max-width constraint (e.g. `600px`)|`600px`|
|`data-show-timestamp`|Show or hide the post's creation time|`true`|
|`data-show-badges`|Display trust, verification, and tagger badges|`true`|
|`data-show-labels`|Display warning labels (content moderation)|`true`|
|`data-show-metrics`|Enable the whole metrics block (likes, reposts, etc.)|`true`|
|`data-show-images`|Display embedded images|`true`|
|`data-show-video`|Display embedded videos|`true`|
|`data-show-external`|Show external links, cards, and GIFs|`true`|
|`data-external-layout`|External link card layout: `vertical` or `horizontal`|`vertical`|
|`data-show-quote-posts`|Render quotes nested inside the post|`true`|
|`data-show-embeds`|Master toggle: disables all rich media embeds|`true`|

### Post Mode Settings (`data-mode="post"`)

Control specific metric values inside the post.

| Attribute                 | Description                                                     | Default |
| ------------------------- | --------------------------------------------------------------- | ------- |
| `data-show-likes`         | Include Like metric icon/count                                  | `true`  |
| `data-show-reposts`       | Include Repost metric icon/count                                | `true`  |
| `data-show-replies`       | Include Reply metric icon/count                                 | `true`  |
| `data-show-quotes`        | Include Quotes metric icon/count                                | `true`  |
| `data-show-bookmarks`     | Include Bookmark metric icon/count                              | `true`  |
| `data-show-reply-context` | Show "Replying to @user..." badge above post                    | `true`  |
| `data-show-actions`       | Display the "Write your reply" and "View quotes" bottom buttons | `true`  |

### Discussion Mode Settings (`data-mode="discussion"`)

| Attribute                      | Description                                                  | Default  |
| ------------------------------ | ------------------------------------------------------------ | -------- |
| `data-show-main-post`          | Display the original root post above comments                | `true`   |
| `data-show-liked-by`           | Show a summary grid of user avatars who liked the post       | `true`   |
| `data-show-tabs`               | Master toggle: allow toggling between Replies and Quotes     | `true`   |
| `data-show-replies-tab`        | Allow the Replies tab view                                   | `true`   |
| `data-show-quotes-tab`         | Allow the Quotes tab view                                    | `true`   |
| `data-show-sort`               | Enable the sort dropdown (e.g. "Most Liked")                 | `true`   |
| `data-replies-sort`            | Default sort filter (`oldest`, `newest`, `likes`, `replies`) | `oldest` |
| `data-show-join-button`        | Display the "Write your reply" button below the header       | `true`   |
| `data-show-reply-quote-labels` | Display content warning labels on nested quotes/replies      | `true`   |

---

## Local Development

Clone the repository and spin up a local server.

```bash
npx -y serve -l 1234 .
```

There are no `node_modules` dependencies for runtime code. Just open the port and it will serve `index.html`.

### The Output Bundle (`dist/`)

The JS files in `dist/` are generated via `node scripts/build.js`.

1. `dist/embed.js` is the lightweight loader/orchestrator.
2. Widget runtimes (`dist/post.js`, `dist/profile.js`, `dist/members.js`) are built as self-contained files with inlined SVG icons and CSS.
3. Standalone CSS copies are also emitted (`post.css`, `profile.css`, `members.css`).
4. `dist/embed.css` is kept as a backward-compatible alias of `dist/post.css`.

To build distribution bundles manually:

```bash
npm run build
```

## Releasing a New Version

The project includes an interactive script to build, bump the package version, tag, and publish to GitHub. jsDelivr will automatically pick up GitHub tags.

```bash
npm run release
```

###### Walkthrough:

1. The script will ask what type of version bump it is (`patch`, `minor`, `major`).
2. It ensures your git working directory is clean.
3. It triggers `npm run build` to freshen the `dist/` folder.
4. Updates `package.json` to the corresponding version, committing the change explicitly.
5. Issues a `git tag` matching the version.
6. Pushes commits and tags to your `main` branch.

_(Once pushed, jsDelivr reflects the new release automatically. Users calling `@latest` get updated versions, while specific versions can be targeted using `@X.X.X`.)_

![GitHub License](https://img.shields.io/github/license/romiojoseph/atproto-embed) ![GitHub file size in bytes](https://img.shields.io/github/size/romiojoseph/atproto-embed/dist%2Fembed.js) [![](https://data.jsdelivr.com/v1/package/gh/romiojoseph/atproto-embed/badge)](https://www.jsdelivr.com/package/gh/romiojoseph/atproto-embed) ![GitHub commit activity](https://img.shields.io/github/commit-activity/y/romiojoseph/atproto-embed) ![GitHub last commit](https://img.shields.io/github/last-commit/romiojoseph/atproto-embed)