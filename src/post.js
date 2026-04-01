(function () {
  "use strict";

  var API_BASE = "https://public.api.bsky.app/xrpc/";
  var HANDLE_CACHE = new Map();
  var PROFILE_CACHE = new Map();
  var INFLIGHT = new Map();
  var CONTAINER_ABORTS = new WeakMap();
  var SIGNAL_IDS = new WeakMap();
  var NEXT_SIGNAL_ID = 1;
  var TEXT_ENCODER = new TextEncoder();
  var TEXT_DECODER = new TextDecoder();
  var DATE_FMT = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  var TIME_FMT = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  function getSignalId(signal) {
    if (!signal) return 0;
    var id = SIGNAL_IDS.get(signal);
    if (!id) {
      id = NEXT_SIGNAL_ID++;
      SIGNAL_IDS.set(signal, id);
    }
    return id;
  }

  function fetchJsonOrThrow(url, errMsg, signal) {
    return fetch(url, signal ? { signal: signal } : undefined).then(function (res) {
      if (!res.ok) throw new Error(errMsg);
      return res.json();
    });
  }

  function fetchJsonDedup(key, url, errMsg, signal) {
    var sigId = getSignalId(signal);
    var inflightKey = key + "|s" + sigId;
    if (INFLIGHT.has(inflightKey)) return INFLIGHT.get(inflightKey);
    var p = fetchJsonOrThrow(url, errMsg, signal)
      .finally(function () {
        INFLIGHT.delete(inflightKey);
      });
    INFLIGHT.set(inflightKey, p);
    return p;
  }

  /* ───── URI resolution ───── */

  function parseInput(raw) {
    raw = raw.trim();
    if (raw.startsWith("at://")) return { atUri: raw, sourceDomain: null };
    const m = raw.match(
      /https?:\/\/([^/]+)\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)/
    );
    if (m)
      return {
        handle: m[2],
        rkey: m[3],
        sourceDomain: m[1],
        sourceUrl: raw,
      };
    return null;
  }

  async function resolveHandle(handle) {
    if (handle.startsWith("did:")) return handle;
    if (HANDLE_CACHE.has(handle)) return HANDLE_CACHE.get(handle);
    const url =
      API_BASE +
      "com.atproto.identity.resolveHandle?handle=" +
      encodeURIComponent(handle);
    var p = fetchJsonDedup(
      "resolveHandle:" + handle,
      url,
      "Handle resolution failed",
      null
    )
      .then(function (data) {
        return data.did;
      })
      .catch(function (err) {
        HANDLE_CACHE.delete(handle);
        throw err;
      });
    HANDLE_CACHE.set(handle, p);
    return p;
  }

  async function resolveUri(raw) {
    const parsed = parseInput(raw);
    if (!parsed) throw new Error("Invalid URI: " + raw);
    if (parsed.atUri)
      return { atUri: parsed.atUri, sourceDomain: null, sourceUrl: null };
    const did = await resolveHandle(parsed.handle);
    return {
      atUri: "at://" + did + "/app.bsky.feed.post/" + parsed.rkey,
      sourceDomain: parsed.sourceDomain,
      sourceUrl: parsed.sourceUrl,
    };
  }

  /* ───── API ───── */

  async function fetchPost(atUri, signal) {
    const url =
      API_BASE +
      "app.bsky.feed.getPostThread?uri=" +
      encodeURIComponent(atUri) +
      "&depth=0&parentHeight=10";
    const data = await fetchJsonDedup(url, url, "Failed to fetch post", signal);
    return data.thread;
  }

  async function fetchThread(atUri, signal) {
    const url =
      API_BASE +
      "app.bsky.feed.getPostThread?uri=" +
      encodeURIComponent(atUri) +
      "&depth=6&parentHeight=10";
    const data = await fetchJsonDedup(url, url, "Failed to fetch thread", signal);
    return data.thread;
  }

  async function fetchQuotes(atUri, cursor, signal) {
    let url =
      API_BASE +
      "app.bsky.feed.getQuotes?uri=" +
      encodeURIComponent(atUri) +
      "&limit=25";
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
    return fetchJsonDedup(url, url, "Failed to fetch quotes", signal);
  }

  async function fetchLikes(atUri, signal) {
    const url =
      API_BASE +
      "app.bsky.feed.getLikes?uri=" +
      encodeURIComponent(atUri) +
      "&limit=60";
    return fetchJsonDedup(url, url, "Failed to fetch likes", signal);
  }

  async function fetchProfile(did) {
    try {
      if (PROFILE_CACHE.has(did)) return PROFILE_CACHE.get(did);
      const url =
        API_BASE +
        "app.bsky.actor.getProfile?actor=" +
        encodeURIComponent(did);
      var p = fetchJsonDedup(url, url, "Failed to fetch profile", null)
        .then(function (data) {
          return data;
        })
        .catch(function (_) {
          PROFILE_CACHE.delete(did);
          return null;
        });
      PROFILE_CACHE.set(did, p);
      var resData = await p;
      if (!resData) PROFILE_CACHE.delete(did);
      return resData;
    } catch (_) {
      return null;
    }
  }

  function extractDid(atUri) {
    const m = atUri.match(/^at:\/\/(did:[^/]+)/);
    return m ? m[1] : null;
  }

  /* ───── Helpers ───── */

  function el(tag, className, attrs) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (attrs) {
      for (const k in attrs) {
        if (k === "textContent") e.textContent = attrs[k];
        else if (k === "innerHTML") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function appendInChunks(items, chunkSize, renderFn, container, beforeNode) {
    if (!items || items.length === 0) return;
    var i = 0;
    var raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : function (cb) {
          setTimeout(cb, 16);
        };
    function step() {
      var frag = document.createDocumentFragment();
      var end = Math.min(i + chunkSize, items.length);
      for (; i < end; i++) {
        var node = renderFn(items[i], i);
        if (node) frag.appendChild(node);
      }
      if (beforeNode) container.insertBefore(frag, beforeNode);
      else container.appendChild(frag);
      if (i < items.length) {
        raf(step);
      }
    }
    step();
  }

  function formatTimestamp(iso) {
    var d = new Date(iso);
    return DATE_FMT.format(d) + " at " + TIME_FMT.format(d);
  }

  function formatRelativeTime(iso) {
    var now = Date.now();
    var then = new Date(iso).getTime();
    if (!isFinite(then)) return "";
    var diff = Math.max(0, now - then);
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + "s";
    var min = Math.floor(sec / 60);
    if (min < 60) return min + "m";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h";
    var day = Math.floor(hr / 24);
    if (day < 7) return day + "d";
    var week = Math.floor(day / 7);
    if (day < 30) return week + "w";
    var month = Math.floor(day / 30);
    if (day < 365) return month + "mo";
    var year = Math.floor(day / 365);
    return year + "y";
  }
  function formatCount(n) {
    if (n >= 1000000)
      return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }
  function formatCountLabel(n, singular, plural) {
    if (n === 1) return "1 " + singular;
    return String(n) + " " + (plural || singular + "s");
  }
  function formatReplyLabel(n) {
    if (n === 1) return "1 reply";
    return String(n) + " replies";
  }

  function getRkeyFromUri(uri) {
    var idx = uri.lastIndexOf("/");
    return idx === -1 ? uri : uri.slice(idx + 1);
  }

  function bskyPostUrl(post) {
    var rkey = getRkeyFromUri(post.uri);
    return "https://bsky.app/profile/" + post.author.handle + "/post/" + rkey;
  }

  function sortPosts(posts, criteria) {
    var arr = posts.slice();
    arr.sort(function (a, b) {
      var postA = a.post || a;
      var postB = b.post || b;
      var recA = postA.record || postA.value || {};
      var recB = postB.record || postB.value || {};

      var valA, valB;
      switch (criteria) {
        case "oldest":
          valA = new Date(recA.createdAt || postA.indexedAt).getTime();
          valB = new Date(recB.createdAt || postB.indexedAt).getTime();
          return valA - valB;
        case "likes":
          return (postB.likeCount || 0) - (postA.likeCount || 0);
        case "reposts":
          return (postB.repostCount || 0) - (postA.repostCount || 0);
        case "quotes":
          return (postB.quoteCount || 0) - (postA.quoteCount || 0);
        case "bookmarks":
          return (postB.bookmarkCount || 0) - (postA.bookmarkCount || 0);
        case "replies":
          return (postB.replyCount || 0) - (postA.replyCount || 0);
        case "newest":
        default:
          valA = new Date(recA.createdAt || postA.indexedAt).getTime();
          valB = new Date(recB.createdAt || postB.indexedAt).getTime();
          return valB - valA;
      }
    });
    return arr;
  }

  function getViaInfo(sourceInfo, post) {
    var bskyUrl = bskyPostUrl(post);
    if (!sourceInfo || !sourceInfo.sourceDomain) {
      return { label: "AT Proto", url: bskyUrl };
    }
    var domain = sourceInfo.sourceDomain;
    if (domain === "bsky.app" || domain === "staging.bsky.app") {
      return { label: "Bluesky", url: sourceInfo.sourceUrl || bskyUrl };
    }
    return { label: domain, url: sourceInfo.sourceUrl || bskyUrl };
  }

  function getPostLink(sourceInfo, post) {
    var rkey = getRkeyFromUri(post.uri);
    var domain =
      sourceInfo && sourceInfo.sourceDomain ? sourceInfo.sourceDomain : "bsky.app";
    return "https://" + domain + "/profile/" + post.author.handle + "/post/" + rkey;
  }

  /* ───── Icons ───── */

  function getBasePath() {
    var scripts = document.querySelectorAll("script[src]");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src;
      if (src.indexOf("post.js") !== -1 || src.indexOf("embed.js") !== -1) {
        return src.substring(0, src.lastIndexOf("/") + 1);
      }
    }
    return "./";
  }

  function getIconUrl(name) {
    return getBasePath() + "../public/" + name + ".svg";
  }

  var METRIC_ICONS = {
    post: {
      like: "like-fill",
      repost: "repost-fill",
      reply: "reply-fill",
      quote: "quote-fill",
      bookmark: "bookmark-fill",
    },
    discussion: {
      like: "like-fill",
      repost: "repost-fill",
      reply: "reply-fill",
      quote: "quote-fill",
      bookmark: "bookmark-fill",
    },
  };

  function metricIcon(name, styleMode) {
    var set = METRIC_ICONS[styleMode] || METRIC_ICONS.discussion;
    return set[name] || name;
  }

  var BADGE_ICONS = {
    crown: "original-seal",
    seal: "trusted-seal",
    check: "check-circle",
    lock: "private",
    tag: "label",
    warning: "warn",
  };

  var PRELOAD_ICON_NAMES = [
    "like-fill",
    "repost-fill",
    "reply-fill",
    "quote-fill",
    "bookmark-fill",
    "original-seal",
    "trusted-seal",
    "check-circle",
    "private",
    "label",
    "warn",
    "reply",
    "spinner",
    "avatar-fallback",
    "caret-down",
    "caret-up",
  ];

  function maybePreloadIcons() {
    if (typeof document === "undefined") return;
    var current = document.currentScript;
    if (!current || current.getAttribute("data-preload-icons") !== "true") return;
    if (typeof fetch !== "function") return;
    var sample = getIconUrl("like-fill");
    if (sample && sample.indexOf("data:") === 0) return;
    PRELOAD_ICON_NAMES.forEach(function (name) {
      var url = getIconUrl(name);
      if (!url || url.indexOf("data:") === 0) return;
      fetch(url, { cache: "force-cache" }).catch(function () { });
    });
  }

  maybePreloadIcons();

  /* ───── Badge detection ───── */

  function detectBadges(author) {
    var badges = [];
    var v = author.verification || {};
    var labels = author.labels || [];
    var associated = author.associated || {};
    if (v.trustedVerifierStatus === "valid") {
      badges.push(author.handle === "bsky.app" ? "crown" : "seal");
    } else if (v.verifiedStatus === "valid") {
      badges.push("check");
    }
    var hasNoUnauth = labels.some(function (l) {
      return l.val === "!no-unauthenticated";
    });
    if (hasNoUnauth) badges.push("lock");
    var warningVals = ["porn", "spam", "nudity", "sexual", "gore"];
    var hasWarning = labels.some(function (l) {
      if (l.val === "!no-unauthenticated") return false;
      return warningVals.indexOf(l.val) !== -1 || l.val.charAt(0) === "!";
    });
    if (hasWarning) badges.push("warning");
    if (associated.labeler === true) badges.push("tag");
    return badges;
  }

  function renderBadges(author) {
    var badges = detectBadges(author);
    var frag = document.createDocumentFragment();
    badges.forEach(function (b) {
      if (BADGE_ICONS[b]) {
        var span = el("span", "atproto-badge-wrap");
        span.appendChild(
          el("img", "atproto-badge atproto-badge--" + b, {
            src: getIconUrl(BADGE_ICONS[b]),
            alt: b,
            width: "16",
            height: "16",
          })
        );
        frag.appendChild(span);
      }
    });
    return frag;
  }

  function countReplyDescendants(thread) {
    if (!thread || !thread.replies || !thread.replies.length) return 0;
    var total = thread.replies.length;
    thread.replies.forEach(function (child) {
      total += countReplyDescendants(child);
    });
    return total;
  }

  /* ───── Configuration ───── */

  function parseConfig(container) {
    var mode = (container.getAttribute("data-mode") || "post").toLowerCase();
    if (mode !== "post" && mode !== "discussion") {
      mode = "post";
    }

    var config = {
      mode: mode,
      // Post card options
      showLikes: true,
      showReposts: true,
      showReplies: true,
      showQuotes: true,
      showBookmarks: true,
      showMetrics: true,
      showTimestamp: true,
      showActions: true,
      showReplyContext: true,
      showEmbeds: true,
      showBadges: true,
      showLabels: true,
      showImages: true,
      showVideo: true,
      showExternal: true,
      showQuotePosts: true,
      externalLayout: "vertical",
      // Discussion-specific options
      showMainPost: true,
      showLikedBy: true,
      showRepliesTab: true,
      showQuotesTab: true,
      showTabs: true,
      showSort: true,
      showJoinButton: true,
      repliesSort: "oldest",
      // Sizing
      width: null,
      maxWidth: null,
      // Discussion-only: labels for replies/quotes
      showReplyQuoteLabels: true,
    };

    function parseAttr(name, defaultVal) {
      var val = container.getAttribute("data-" + name);
      if (val === null) return defaultVal;
      return val === "true" || val === "1" || val === "";
    }

    function parseStringAttr(name, defaultVal) {
      var val = container.getAttribute("data-" + name);
      return val !== null ? val : defaultVal;
    }

    // Post card
    config.showLikes = parseAttr("show-likes", config.showLikes);
    config.showReposts = parseAttr("show-reposts", config.showReposts);
    config.showReplies = parseAttr("show-replies", config.showReplies);
    config.showQuotes = parseAttr("show-quotes", config.showQuotes);
    config.showBookmarks = parseAttr("show-bookmarks", config.showBookmarks);
    config.showMetrics = parseAttr("show-metrics", config.showMetrics);
    config.showTimestamp = parseAttr("show-timestamp", config.showTimestamp);
    config.showActions = parseAttr("show-actions", config.showActions);
    config.showReplyContext = parseAttr(
      "show-reply-context",
      config.showReplyContext
    );
    config.showEmbeds = parseAttr("show-embeds", config.showEmbeds);
    config.showBadges = parseAttr("show-badges", config.showBadges);
    config.showLabels = parseAttr("show-labels", config.showLabels);
    config.showImages = parseAttr("show-images", config.showImages);
    config.showVideo = parseAttr("show-video", config.showVideo);
    config.showExternal = parseAttr("show-external", config.showExternal);
    config.showQuotePosts = parseAttr("show-quote-posts", config.showQuotePosts);
    config.externalLayout = parseStringAttr(
      "external-layout",
      config.externalLayout
    );
    if (config.externalLayout !== "horizontal") {
      config.externalLayout = "vertical";
    }

    // Discussion
    config.showMainPost = parseAttr("show-main-post", config.showMainPost);
    config.showLikedBy = parseAttr("show-liked-by", config.showLikedBy);
    config.showRepliesTab = parseAttr("show-replies-tab", config.showRepliesTab);
    config.showQuotesTab = parseAttr("show-quotes-tab", config.showQuotesTab);
    config.showTabs = parseAttr("show-tabs", config.showTabs);
    config.showSort = parseAttr("show-sort", config.showSort);
    config.showJoinButton = parseAttr("show-join-button", config.showJoinButton);
    config.repliesSort = parseStringAttr("replies-sort", config.repliesSort);

    config.width = parseStringAttr("width", config.width);
    config.maxWidth = parseStringAttr("max-width", config.maxWidth);

    if (container.hasAttribute("data-show-reply-quote-labels")) {
      config.showReplyQuoteLabels = parseAttr(
        "show-reply-quote-labels",
        config.showReplyQuoteLabels
      );
    } else {
      // Back-compat: previous name
      config.showReplyQuoteLabels = parseAttr(
        "show-reply-labels",
        config.showReplyQuoteLabels
      );
    }

    return config;
  }

  function applySizeConfig(container, config) {
    if (!config) return;
    if (config.width) {
      container.style.setProperty("--atproto-width", config.width);
    }
    if (config.maxWidth) {
      container.style.setProperty("--atproto-max-width", config.maxWidth);
    }
  }

  function clientBase(sourceInfo) {
    if (sourceInfo && sourceInfo.sourceDomain)
      return "https://" + sourceInfo.sourceDomain;
    return "https://bsky.app";
  }

  function renderFacets(record, sourceInfo) {
    var text = record.text || "";
    var facets = record.facets;
    if (!facets || !facets.length) return document.createTextNode(text);

    var base = clientBase(sourceInfo);
    var bytes = TEXT_ENCODER.encode(text);

    var sorted = facets.slice().sort(function (a, b) {
      return a.index.byteStart - b.index.byteStart;
    });

    var frag = document.createDocumentFragment();
    var cursor = 0;

    sorted.forEach(function (facet) {
      var start = facet.index.byteStart;
      var end = facet.index.byteEnd;

      if (start > cursor) {
        frag.appendChild(
          document.createTextNode(TEXT_DECODER.decode(bytes.slice(cursor, start)))
        );
      }

      var slice = TEXT_DECODER.decode(bytes.slice(start, end));
      var feat = facet.features[0];

      if (feat.$type === "app.bsky.richtext.facet#mention") {
        frag.appendChild(
          el("a", "atproto-post__mention", {
            textContent: slice,
            href: base + "/profile/" + feat.did,
            target: "_blank",
            rel: "noopener noreferrer",
          })
        );
      } else if (feat.$type === "app.bsky.richtext.facet#tag") {
        var tag = feat.tag || slice.replace(/^#/, "");
        frag.appendChild(
          el("a", "atproto-post__hashtag", {
            textContent: slice,
            href: base + "/hashtag/" + encodeURIComponent(tag),
            target: "_blank",
            rel: "noopener noreferrer",
          })
        );
      } else if (feat.$type === "app.bsky.richtext.facet#link") {
        frag.appendChild(
          el("a", "atproto-post__link", {
            textContent: slice,
            href: feat.uri,
            target: "_blank",
            rel: "noopener noreferrer",
          })
        );
      } else {
        frag.appendChild(document.createTextNode(slice));
      }

      cursor = end;
    });

    if (cursor < bytes.length) {
      frag.appendChild(
        document.createTextNode(TEXT_DECODER.decode(bytes.slice(cursor)))
      );
    }

    return frag;
  }

  function renderText(record, sourceInfo, opts) {
    var nodesFrag = renderFacets(record, sourceInfo);
    var finalFrag = document.createDocumentFragment();
    var currentPara = el("div", "atproto-post__paragraph");
    var splitOnSingleNewline = !!(opts && opts.splitOnSingleNewline);

    function pushPara() {
      if (currentPara.childNodes.length > 0) {
        finalFrag.appendChild(currentPara);
        currentPara = el("div", "atproto-post__paragraph");
      }
    }

    var nodes = [];
    if (nodesFrag.nodeType === 11) {
      nodes = Array.prototype.slice.call(nodesFrag.childNodes);
    } else {
      nodes = [nodesFrag];
    }

    nodes.forEach(function (node) {
      if (node.nodeType === 3) {
        var text = node.textContent;
        var splitter = "\n\n";
        if (
          splitOnSingleNewline &&
          text.indexOf("\n\n") === -1 &&
          text.indexOf("\n") !== -1
        ) {
          splitter = "\n";
        }
        var parts = text.split(splitter);
        parts.forEach(function (part, i) {
          if (i > 0) pushPara();
          if (part) currentPara.appendChild(document.createTextNode(part));
        });
      } else {
        currentPara.appendChild(node);
      }
    });

    pushPara();
    return finalFrag;
  }

  /* ───── Embed renderers ───── */

  function renderImages(embed, config) {
    if (config && config.showImages === false) return null;
    var images = embed.images;
    var count = images.length;
    var container = el(
      "div",
      "atproto-embed__images atproto-embed__images--" + count
    );
    images.forEach(function (img) {
      var link = el("a", "atproto-embed__image-link", {
        href: img.fullsize,
        target: "_blank",
        rel: "noopener noreferrer",
      });
      link.appendChild(
        el("img", null, { src: img.thumb, alt: img.alt || "", loading: "lazy" })
      );
      container.appendChild(link);
    });
    return container;
  }

  function renderVideo(embed, config) {
    if (config && config.showVideo === false) return null;
    var container = el("div", "atproto-embed__video");
    if (embed.playlist) {
      var video = el("video", null, {
        controls: "true",
        preload: "metadata",
        playsinline: "true",
      });
      if (embed.thumbnail) {
        video.setAttribute("poster", embed.thumbnail);
      }
      if (embed.aspectRatio) {
        video.style.aspectRatio = embed.aspectRatio.width + "/" + embed.aspectRatio.height;
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = embed.playlist;
      } else {
        var script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js";
        script.onload = function () {
          if (window.Hls && window.Hls.isSupported()) {
            var hls = new window.Hls();
            hls.loadSource(embed.playlist);
            hls.attachMedia(video);
          }
        };
        document.head.appendChild(script);
      }
      container.appendChild(video);
    }
    return container;
  }

  function isGifUrl(uri) {
    if (!uri) return false;
    if (/\.gif(\?|$)/i.test(uri)) return true;
    if (uri.indexOf("tenor.com") !== -1 || uri.indexOf("giphy.com") !== -1)
      return true;
    return false;
  }

  function renderExternal(embed, config) {
    if (config && config.showExternal === false) return null;
    var ext = embed.external;
    var layout =
      config && config.externalLayout === "horizontal" ? "horizontal" : "vertical";

    if (isGifUrl(ext.uri)) {
      var gifWrap = el("a", "atproto-embed__gif", {
        href: ext.uri,
        target: "_blank",
        rel: "noopener noreferrer",
      });
      gifWrap.appendChild(
        el("img", "atproto-embed__gif-img", {
          src: ext.uri,
          alt: ext.description || ext.title || "",
          loading: "lazy",
        })
      );
      return gifWrap;
    }

    var link = el(
      "a",
      "atproto-embed__external atproto-embed__external--" + layout,
      {
        href: ext.uri,
        target: "_blank",
        rel: "noopener noreferrer",
      }
    );
    if (ext.thumb) {
      link.appendChild(
        el("img", "atproto-embed__external-thumb", {
          src: ext.thumb,
          alt: "",
          loading: "lazy",
        })
      );
    }
    var content = el("div", "atproto-embed__external-content");
    if (ext.title)
      content.appendChild(
        el("div", "atproto-embed__external-title", { textContent: ext.title })
      );
    if (ext.description)
      content.appendChild(
        el("div", "atproto-embed__external-desc", {
          textContent: ext.description,
        })
      );
    var domain = ext.uri;
    try {
      domain = new URL(ext.uri).hostname;
    } catch (_) { }
    content.appendChild(
      el("div", "atproto-embed__external-domain", { textContent: domain })
    );
    link.appendChild(content);
    return link;
  }

  function renderQuoteEmbed(embed, config, styleMode) {
    if (config && config.showQuotePosts === false) return null;
    var rec = embed.record;
    if (!rec || rec.$type === "app.bsky.embed.record#viewNotFound") return null;
    if (rec.$type === "app.bsky.embed.record#viewBlocked") {
      var blocked = el("div", "atproto-embed__quote");
      blocked.appendChild(
        el("div", null, {
          textContent: "This post is from a blocked account.",
          style: "padding:12px;color:#687684;font-size:14px;",
        })
      );
      return blocked;
    }
    var wrapper = el("div", "atproto-embed__quote");
    wrapper.appendChild(
      renderPostCard(
        {
          post: {
            author: rec.author,
            uri: rec.uri,
            record: rec.value,
            embed: rec.embeds && rec.embeds[0] ? rec.embeds[0] : null,
            indexedAt: rec.indexedAt,
          },
        },
        true,
        null,
        false,
        config,
        styleMode,
        null,
        null
      )
    );
    return wrapper;
  }

  function renderRecordWithMedia(embed, skipRecord, config, styleMode) {
    var frag = document.createDocumentFragment();
    var media = embed.media;
    if (media) {
      var mt = media.$type;
      if (mt === "app.bsky.embed.images#view")
        frag.appendChild(renderImages(media, config));
      else if (mt === "app.bsky.embed.video#view")
        frag.appendChild(renderVideo(media, config));
      else if (mt === "app.bsky.embed.external#view")
        frag.appendChild(renderExternal(media, config));
    }
    if (!skipRecord && embed.record) {
      var q = renderQuoteEmbed(embed.record, config, styleMode);
      if (q) frag.appendChild(q);
    }
    return frag;
  }

  function renderEmbed(post, skipQuoteOfRoot, config, styleMode) {
    var embed = post.embed;
    if (!embed) return null;
    var t = embed.$type;
    if (t === "app.bsky.embed.images#view") return renderImages(embed, config);
    if (t === "app.bsky.embed.video#view") return renderVideo(embed, config);
    if (t === "app.bsky.embed.external#view") return renderExternal(embed, config);
    if (t === "app.bsky.embed.record#view") {
      if (skipQuoteOfRoot) return null;
      return renderQuoteEmbed(embed, config, styleMode);
    }
    if (t === "app.bsky.embed.recordWithMedia#view")
      return renderRecordWithMedia(embed, skipQuoteOfRoot, config, styleMode);
    return null;
  }

  /* ───── Post card ───── */

  function renderPostCard(
    thread,
    isQuote,
    sourceInfo,
    skipQuoteEmbed,
    config,
    styleMode,
    contextType,
    iconMode
  ) {
    if (!config) config = {};
    if (!thread || !thread.post) return null;

    var post = thread.post;
    if (!post.author) {
      post.author = {
        handle: "unknown",
        displayName: "Unknown User",
        avatar: getIconUrl("avatar-fallback"),
      };
    }

    var record = post.record || post.value;
    var card = el("div", "atproto-post");
    var frag = document.createDocumentFragment();

    var profileUrl =
      post.author.handle === "unknown"
        ? "#"
        : "https://bsky.app/profile/" + post.author.handle;
    var header = el("div", "atproto-post__header");
    var headerMain = el("div", "atproto-post__header-main");
    headerMain.appendChild(
      el("img", "atproto-post__avatar", {
        src: post.author.avatar || getIconUrl("avatar-fallback"),
        alt: post.author.displayName || post.author.handle,
        loading: "lazy",
      })
    );
    var isDiscussionReplyOrQuote =
      styleMode === "discussion" &&
      (contextType === "reply" || contextType === "quote");
    if (isDiscussionReplyOrQuote) {
      card.classList.add("atproto-post--compact");
      var authorInline = el("div", "atproto-post__author-inline");
      var nameWrapInline = el("span", "atproto-post__display-name-wrap");
      nameWrapInline.appendChild(
        el("span", "atproto-post__display-name", {
          textContent: post.author.displayName || post.author.handle,
        })
      );
      if (config.showBadges !== false) {
        var badgesInline = el("span", "atproto-post__badges-inline");
        badgesInline.appendChild(renderBadges(post.author));
        nameWrapInline.appendChild(badgesInline);
      }
      authorInline.appendChild(nameWrapInline);
      authorInline.appendChild(
        el("span", "atproto-post__handle", {
          textContent: "@" + post.author.handle,
        })
      );
      headerMain.appendChild(authorInline);
    } else {
      var author = el("div", "atproto-post__author");
      var nameWrap = el("span", "atproto-post__display-name-wrap");
      nameWrap.appendChild(
        el("span", "atproto-post__display-name", {
          textContent: post.author.displayName || post.author.handle,
        })
      );
      if (config.showBadges !== false) {
        nameWrap.appendChild(renderBadges(post.author));
      }
      author.appendChild(nameWrap);
      author.appendChild(
        el("span", "atproto-post__handle", {
          textContent: "@" + post.author.handle,
        })
      );
      headerMain.appendChild(author);
    }
    var headerLink = el("a", "atproto-post__header-main-link", {
      href: profileUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    });
    headerLink.appendChild(headerMain);
    header.appendChild(headerLink);

    if (styleMode === "discussion" && contextType === "root") {
      card.classList.add("atproto-post--main");
    }
    if (isDiscussionReplyOrQuote && config.showTimestamp !== false) {
      var postLink = getPostLink(sourceInfo, post);
      var relTime = formatRelativeTime(record.createdAt || post.indexedAt);
      if (relTime) {
        header.appendChild(
          el("a", "atproto-post__header-right", {
            href: postLink,
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: relTime,
          })
        );
      }
    }
    frag.appendChild(header);

    if (
      !isQuote &&
      record &&
      record.reply &&
      thread.parent &&
      config.showReplyContext !== false
    ) {
      var parent = thread.parent;
      if (parent.post) {
        var ctx = el("div", "atproto-post__reply-context");
        ctx.appendChild(
          el("img", null, { src: getIconUrl("reply"), width: "14", height: "14" })
        );
        ctx.appendChild(
          document.createTextNode(
            "Replying to " +
            (parent.post.author.displayName || "@" + parent.post.author.handle)
          )
        );
        frag.appendChild(ctx);
      }
    }

    var hasText = false;
    if (record && record.text) {
      var textDiv = el("div", "atproto-post__text");
      textDiv.appendChild(
        renderText(record, sourceInfo, {
          splitOnSingleNewline: contextType === "reply",
        })
      );
      frag.appendChild(textDiv);
      hasText = true;
    }

    var hasEmbed = false;
    if (config.showEmbeds !== false && (!isQuote || post.embed)) {
      var embedEl = renderEmbed(post, isQuote || !!skipQuoteEmbed, config, styleMode);
      if (embedEl) {
        var embedWrap = el("div", "atproto-post__embed");
        embedWrap.appendChild(embedEl);
        frag.appendChild(embedWrap);
        hasEmbed = true;
      }
    }

    if (isDiscussionReplyOrQuote && hasText && !hasEmbed) {
      card.classList.add("atproto-post--no-embed");
    }

    var footerAdded = false;
    if (!isQuote) {
      var hasAnyMetrics =
        config.showMetrics !== false &&
        (config.showLikes !== false ||
          config.showReposts !== false ||
          config.showReplies !== false ||
          config.showQuotes !== false ||
          config.showBookmarks !== false);

      var footer = null;
      var metricsAdded = false;
      var postLink = getPostLink(sourceInfo, post);

      if (hasAnyMetrics) {
        var metricsRow = el("div", "atproto-post__metrics-row");
        var metricsLeft = el("div", "atproto-post__metrics-left");
        var metricsRight = el("div", "atproto-post__metrics-right");
        var iconStyle = iconMode || styleMode;
        var iconSize = iconStyle === "post" ? 20 : 16;
        var isSimpleMetrics = isDiscussionReplyOrQuote;

        if (isSimpleMetrics) {
          metricsRow.classList.add("atproto-post__metrics-row--simple");

          if (config.showLikes !== false && (post.likeCount || 0) > 0) {
            metricsLeft.appendChild(
              el("span", "atproto-post__stat-text", {
                textContent: formatCountLabel(post.likeCount || 0, "like"),
              })
            );
          }

          if (config.showReposts !== false && (post.repostCount || 0) > 0) {
            metricsLeft.appendChild(
              el("span", "atproto-post__stat-text", {
                textContent: formatCountLabel(post.repostCount || 0, "repost"),
              })
            );
          }

          if (config.showQuotes !== false && (post.quoteCount || 0) > 0) {
            metricsRight.appendChild(
              el("a", "atproto-post__stat-link", {
                href: postLink + "/quotes",
                target: "_blank",
                rel: "noopener noreferrer",
                textContent: formatCountLabel(
                  post.quoteCount || 0,
                  "talking",
                  "talking"
                ),
              })
            );
          }
        } else {
          if (config.showLikes !== false) {
            var likes = el("span", "atproto-post__stat--likes");
            likes.appendChild(
              el("img", null, {
                src: getIconUrl(metricIcon("like", iconStyle)),
                width: String(iconSize),
                height: String(iconSize),
              })
            );
            likes.appendChild(
              document.createTextNode(" " + formatCount(post.likeCount || 0))
            );
            metricsLeft.appendChild(likes);
          }

          if (config.showReposts !== false) {
            var reposts = el("span", "atproto-post__stat--reposts");
            reposts.appendChild(
              el("img", null, {
                src: getIconUrl(metricIcon("repost", iconStyle)),
                width: String(iconSize),
                height: String(iconSize),
              })
            );
            reposts.appendChild(
              document.createTextNode(" " + formatCount(post.repostCount || 0))
            );
            metricsLeft.appendChild(reposts);
          }

          if (config.showReplies !== false) {
            var replies = el("span", "atproto-post__stat--replies");
            replies.appendChild(
              el("img", null, {
                src: getIconUrl(metricIcon("reply", iconStyle)),
                width: String(iconSize),
                height: String(iconSize),
              })
            );
            replies.appendChild(
              document.createTextNode(" " + formatCount(post.replyCount || 0))
            );
            metricsLeft.appendChild(replies);
          }

          if (config.showQuotes !== false) {
            var quotes = el("a", "atproto-post__stat--quotes", {
              href: postLink + "/quotes",
              target: "_blank",
              rel: "noopener noreferrer",
            });
            quotes.appendChild(
              el("img", null, {
                src: getIconUrl(metricIcon("quote", iconStyle)),
                width: String(iconSize),
                height: String(iconSize),
              })
            );
            quotes.appendChild(
              document.createTextNode(" " + formatCount(post.quoteCount || 0))
            );
            metricsRight.appendChild(quotes);
          }

          if (config.showBookmarks !== false) {
            var bookmarks = el("span", "atproto-post__stat--bookmarks");
            bookmarks.appendChild(
              el("img", null, {
                src: getIconUrl(metricIcon("bookmark", iconStyle)),
                width: String(iconSize),
                height: String(iconSize),
              })
            );
            bookmarks.appendChild(
              document.createTextNode(" " + formatCount(post.bookmarkCount || 0))
            );
            metricsRight.appendChild(bookmarks);
          }
        }

        var hasLeft = metricsLeft.childNodes.length > 0;
        var hasRight = metricsRight.childNodes.length > 0;
        if (hasLeft) metricsRow.appendChild(metricsLeft);
        if (hasRight) metricsRow.appendChild(metricsRight);
        if (hasLeft || hasRight) {
          footer = footer || el("div", "atproto-post__footer");
          footer.appendChild(metricsRow);
          metricsAdded = true;
        }
      }

      if (config.showTimestamp !== false && !isDiscussionReplyOrQuote) {
        var infoRow = el("div", "atproto-post__info-row");

        var timestamp = el("a", "atproto-post__timestamp", {
          href: postLink,
          target: "_blank",
          rel: "noopener noreferrer",
          textContent:
            formatTimestamp(record.createdAt || post.indexedAt),
        });
        infoRow.appendChild(timestamp);

        var viaInfo = getViaInfo(sourceInfo, post);
        var via = el("span", "atproto-post__via");
        via.appendChild(document.createTextNode("via "));
        via.appendChild(
          el("a", null, {
            href: viaInfo.url,
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: viaInfo.label,
          })
        );
        infoRow.appendChild(via);

        footer = footer || el("div", "atproto-post__footer");
        footer.appendChild(infoRow);
      }

      if (footer) {
        frag.appendChild(footer);
        footerAdded = true;
      }

      if (styleMode === "post" && config.showActions !== false) {
        var actions = el("div", "atproto-post__actions");
        actions.appendChild(
          el("a", "atproto-post__action atproto-post__action--primary", {
            href: postLink,
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: "Write your reply",
          })
        );
        actions.appendChild(
          el("a", "atproto-post__action atproto-post__action--secondary", {
            href: postLink + "/quotes",
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: "View quotes",
          })
        );
        frag.appendChild(actions);
      }
    }

    var isReplyOrQuote = contextType === "reply" || contextType === "quote";
    if (
      isReplyOrQuote &&
      post.labels &&
      post.labels.length &&
      config.showReplyQuoteLabels === false
    ) {
      return null;
    }

    if (post.labels && post.labels.length && config.showLabels !== false) {
      frag.appendChild(
        el("div", "atproto-post__label", {
          textContent:
            "Content warning: " +
            post.labels
              .map(function (l) {
                return l.val;
              })
              .join(", "),
        })
      );
    }

    if (!isQuote && !footerAdded) {
      card.classList.add("atproto-post--no-footer");
    }

    if (frag.childNodes.length > 0) {
      card.appendChild(frag);
    }

    return card;
  }

  /* ───── Liked by ───── */

  function renderLikedBy(likesData, totalLikes, config) {
    if (config && config.showLikedBy === false) return null;
    if (!totalLikes || totalLikes === 0) return null;

    var section = el("div", "atproto-discussion__liked-by");
    section.appendChild(
      el("div", "atproto-liked-by__label", { textContent: "Liked by" })
    );

    var avatarsContainer = el("div", "atproto-liked-by__avatars");
    var likers = likesData.likes || [];
    var displayCount;
    var rows = 1;
    if (totalLikes > 12) rows = 3;
    else if (totalLikes > 6) rows = 2;
    var maxWidth = 600;
    if (config && config.maxWidth && typeof config.maxWidth === "string") {
      var px = parseInt(config.maxWidth, 10);
      if (isFinite(px)) maxWidth = px;
    }
    var avatarSize = 32;
    var gap = 6;
    var perRow = Math.max(3, Math.floor(maxWidth / (avatarSize + gap)));
    displayCount = Math.min(likers.length, rows * perRow);
    if (displayCount >= totalLikes) {
      displayCount = likers.length;
    }

    for (var i = 0; i < displayCount; i++) {
      var liker = likers[i];
      if (!liker || !liker.actor) continue;
      var avatarLink = el("a", null, {
        href: "https://bsky.app/profile/" + liker.actor.handle,
        target: "_blank",
        rel: "noopener noreferrer",
        title: liker.actor.displayName || liker.actor.handle,
      });
      avatarLink.appendChild(
        el("img", null, {
          src: liker.actor.avatar || getIconUrl("avatar-fallback"),
          alt: liker.actor.displayName || liker.actor.handle,
          loading: "lazy",
        })
      );
      avatarsContainer.appendChild(avatarLink);
    }

    var remaining = totalLikes - displayCount;
    if (remaining > 0) {
      var overflow = el("span", "atproto-liked-by__overflow", {
        textContent: "+" + formatCount(remaining),
      });
      if (String(remaining).length >= 3) {
        overflow.classList.add("atproto-liked-by__overflow--pill");
      }
      avatarsContainer.appendChild(overflow);
    }

    section.appendChild(avatarsContainer);

    return section;
  }

  /* ───── Threaded replies ───── */

  function renderReplyThread(replyThread, depth, sourceInfo, config) {
    if (!replyThread || !replyThread.post) return document.createDocumentFragment();

    var wrapper = el("div", "atproto-reply-thread");
    wrapper.setAttribute("data-depth", depth);

    var card = renderPostCard(
      { post: replyThread.post },
      false,
      sourceInfo,
      false,
      config,
      "discussion",
      "reply",
      null
    );
    if (!card) return document.createDocumentFragment();

    wrapper.appendChild(card);

    if (replyThread.replies && replyThread.replies.length) {
      var children = el("div", "atproto-reply-children");
      replyThread.replies.forEach(function (child) {
        var childEl = renderReplyThread(child, depth + 1, sourceInfo, config);
        if (childEl) children.appendChild(childEl);
      });

      if (depth === 0) {
        var childCount = countReplyDescendants(replyThread);
        if (childCount > 0) {
          var toggleWrap = el("div", "atproto-replies-toggle");
          var toggleBtn = el("button", "atproto-replies-toggle__btn", {
            type: "button",
          });
          var toggleLabel = formatReplyLabel(childCount);
          var toggleText = el("span", "atproto-replies-toggle__label", {
            textContent: toggleLabel,
          });
          var toggleIcon = el("img", "atproto-replies-toggle__icon", {
            src: getIconUrl("caret-down"),
            alt: "",
            width: "12",
            height: "12",
          });
          toggleBtn.appendChild(toggleText);
          toggleBtn.appendChild(toggleIcon);
          toggleWrap.appendChild(toggleBtn);

          var isOpen = false;
          children.style.display = "none";
          toggleBtn.addEventListener("click", function () {
            isOpen = !isOpen;
            children.style.display = isOpen ? "" : "none";
            toggleText.textContent = isOpen ? "Hide replies" : toggleLabel;
            toggleIcon.setAttribute(
              "src",
              getIconUrl(isOpen ? "caret-up" : "caret-down")
            );
          });

          card.appendChild(toggleWrap);
        }
      }

      wrapper.appendChild(children);
    }

    return wrapper;
  }

  /* ───── Tabs ───── */

  function renderTabs(repliesData, quotesState, atUri, sourceInfo, config, mainPost, hostContainer) {
    var currentSort = config.repliesSort || "oldest";
    var tabs = el("div", "atproto-discussion__tabs");

    var rc = mainPost ? mainPost.replyCount || repliesData.length : repliesData.length;
    var qc = mainPost ? mainPost.quoteCount || quotesState.posts.length : quotesState.posts.length;

    var tabBar = el("div", "atproto-discussion__tab-bar");
    var repliesBtn = el("button", null, {
      textContent: "Replies (" + formatCount(rc) + ")",
      "aria-selected": "true",
    });
    var quotesBtn = el("button", null, {
      textContent: "Quotes (" + formatCount(qc) + ")",
      "aria-selected": "false",
    });
    if (
      config.showTabs !== false &&
      (config.showRepliesTab !== false || config.showQuotesTab !== false)
    ) {
      tabBar.appendChild(repliesBtn);
      tabBar.appendChild(quotesBtn);
      tabs.appendChild(tabBar);
    }

    var sortBar = el("div", "atproto-discussion__sort-bar");
    var sortSelect = el("select", "atproto-discussion__sort-select");
    [
      { val: "newest", text: "Newest" },
      { val: "oldest", text: "Oldest" },
      { val: "likes", text: "Most Liked" },
      { val: "reposts", text: "Most Reposted" },
      { val: "quotes", text: "Most Quoted" },
      { val: "bookmarks", text: "Most Bookmarked" },
      { val: "replies", text: "Most Replies" },
    ].forEach(function (opt) {
      sortSelect.appendChild(
        el("option", null, { value: opt.val, textContent: opt.text })
      );
    });
    sortSelect.value = currentSort;
    if (config.showSort !== false) {
      sortBar.appendChild(sortSelect);
      tabs.appendChild(sortBar);
    }

    var tabContent = el("div", "atproto-discussion__tab-content");
    tabs.appendChild(tabContent);

    function refresh() {
      var isReplies = repliesBtn.getAttribute("aria-selected") === "true";
      var frag = document.createDocumentFragment();
      if (config.showTabs === false || isReplies) {
        var sortedReplies = sortPosts(repliesData, currentSort);
        frag.appendChild(renderRepliesPanel(sortedReplies, sourceInfo, config));
      } else {
        var sortedQuotes = sortPosts(quotesState.posts, currentSort);
        frag.appendChild(
          renderQuotesPanel(
            { posts: sortedQuotes, cursor: quotesState.cursor },
            atUri,
            sourceInfo,
            config
          )
        );
      }
      tabContent.replaceChildren(frag);
    }

    repliesBtn.addEventListener("click", function () {
      repliesBtn.setAttribute("aria-selected", "true");
      quotesBtn.setAttribute("aria-selected", "false");
      refresh();
    });

    quotesBtn.addEventListener("click", function () {
      quotesBtn.setAttribute("aria-selected", "true");
      repliesBtn.setAttribute("aria-selected", "false");
      refresh();
    });

    sortSelect.addEventListener("change", function () {
      currentSort = sortSelect.value;
      if (hostContainer) {
        hostContainer.setAttribute("data-replies-sort", currentSort);
      }
      refresh();
    });

    refresh();
    return tabs;
  }

  /* ───── Replies panel ───── */

  function renderRepliesPanel(repliesData, sourceInfo, config) {
    if (config.showRepliesTab === false) return el("div");
    var panel = el("div", "atproto-replies");
    var replies = repliesData || [];

    if (!replies.length) {
      panel.appendChild(
        el("div", "atproto-discussion__empty", {
          textContent: "No replies yet",
        })
      );
      return panel;
    }

    var pageSize = 20;
    var displayedCount = 0;

    function renderMore() {
      var next = replies.slice(displayedCount, displayedCount + pageSize);
      appendInChunks(
        next,
        10,
        function (reply) {
          return renderReplyThread(reply, 0, sourceInfo, config);
        },
        panel,
        loadMoreWrap
      );
      displayedCount += next.length;

      if (displayedCount >= replies.length) {
        loadMoreWrap.style.display = "none";
      }
    }

    var loadMoreWrap = el("div", "atproto-load-more");
    var loadMoreBtn = el("button", null, {
      textContent: "Load more replies",
    });
    loadMoreBtn.addEventListener("click", renderMore);
    loadMoreWrap.appendChild(loadMoreBtn);
    panel.appendChild(loadMoreWrap);

    renderMore();

    return panel;
  }

  /* ───── Quotes panel ───── */

  function renderQuoteCard(quotePost, sourceInfo, config) {
    return renderPostCard(
      {
        post: {
          author: quotePost.author,
          uri: quotePost.uri,
          record: quotePost.record || quotePost.value,
          embed: quotePost.embed || (quotePost.embeds && quotePost.embeds[0]) || null,
          indexedAt: quotePost.indexedAt,
          replyCount: quotePost.replyCount || 0,
          repostCount: quotePost.repostCount || 0,
          likeCount: quotePost.likeCount || 0,
          labels: quotePost.labels,
        },
      },
      false,
      sourceInfo,
      true,
      config,
      "discussion",
      "quote",
      null
    );
  }

  function renderQuotesPanel(quotesState, atUri, sourceInfo, config) {
    if (config.showQuotesTab === false) return el("div");
    var panel = el("div", "atproto-quotes");

    var posts = quotesState.posts || [];
    if (!posts.length && !quotesState.cursor) {
      panel.appendChild(
        el("div", "atproto-discussion__empty", {
          textContent: "No quotes yet",
        })
      );
      return panel;
    }

    appendInChunks(
      posts,
      12,
      function (qp) {
        if (!qp) return null;
        return renderQuoteCard(qp, sourceInfo, config);
      },
      panel
    );

    if (quotesState.cursor) {
      var loadMoreWrap = el("div", "atproto-load-more");
      var loadMoreBtn = el("button", null, {
        textContent: "Load more quotes",
      });
      loadMoreBtn.addEventListener("click", async function () {
        loadMoreBtn.innerHTML =
          "<img src='" +
          getIconUrl("spinner") +
          "' class='atproto-spinner' style='width:16px;height:16px;margin-right:6px;vertical-align:middle;'> Loading…";
        loadMoreBtn.disabled = true;
        try {
          var data = await fetchQuotes(atUri, quotesState.cursor);
          var newPosts = data.posts || [];
          quotesState.cursor = data.cursor || null;

          appendInChunks(
            newPosts,
            12,
            function (qp) {
              if (!qp) return null;
              return renderQuoteCard(qp, sourceInfo, config);
            },
            panel,
            loadMoreWrap
          );

          if (!quotesState.cursor) {
            loadMoreWrap.remove();
          } else {
            loadMoreBtn.textContent = "Load more quotes";
            loadMoreBtn.disabled = false;
          }
        } catch (err) {
          loadMoreBtn.textContent = "Failed — retry";
          loadMoreBtn.disabled = false;
          console.error("[atproto-embed]", err);
        }
      });
      loadMoreWrap.appendChild(loadMoreBtn);
      panel.appendChild(loadMoreWrap);
    }

    return panel;
  }

  /* ───── Discussion render ───── */

  function buildDiscussion(atUri, sourceInfo, config, data, hostContainer) {
    var thread = data.thread;
    var quotesData = data.quotesData;
    var likesData = data.likesData;

    var discussion = el("div", "atproto-discussion");

    if (config.showMainPost !== false) {
      var rootCard = renderPostCard(
        thread,
        false,
        sourceInfo,
        false,
        config,
        "discussion",
        "root",
        "post"
      );
      if (!rootCard) throw new Error("Root post unavailable");
      discussion.appendChild(rootCard);
    }

    var headerBar = el("div", "atproto-discussion__comments-bar");
    headerBar.appendChild(
      el("div", "atproto-discussion__comments-title", {
        textContent: "Comments",
      })
    );
    if (config.showJoinButton !== false) {
      var joinLink = getPostLink(sourceInfo, thread.post);
      headerBar.appendChild(
        el("a", "atproto-post__action atproto-post__action--primary", {
          href: joinLink,
          target: "_blank",
          rel: "noopener noreferrer",
          textContent: "Write your reply",
        })
      );
    }
    discussion.appendChild(headerBar);

    var totalLikes = thread.post.likeCount || 0;
    var likedByEl = renderLikedBy(likesData, totalLikes, config);
    if (likedByEl) discussion.appendChild(likedByEl);

    var repliesData = thread.replies || [];
    var quotesState = {
      posts: quotesData.posts || [],
      cursor: quotesData.cursor || null,
    };

    discussion.appendChild(
      renderTabs(repliesData, quotesState, atUri, sourceInfo, config, thread.post, hostContainer)
    );

    return discussion;
  }

  async function fetchDiscussionData(atUri, signal) {
    var did = extractDid(atUri);
    var results = await Promise.all([
      fetchThread(atUri, signal),
      fetchQuotes(atUri, null, signal),
      fetchLikes(atUri, signal),
      fetchProfile(did),
    ]);

    var thread = results[0];
    var quotesData = results[1] || { posts: [] };
    var likesData = results[2] || { likes: [] };
    var profile = results[3];

    if (profile && thread && thread.post && thread.post.author) {
      if (profile.verification) thread.post.author.verification = profile.verification;
      if (profile.associated) thread.post.author.associated = profile.associated;
    }

    return {
      thread: thread,
      quotesData: quotesData,
      likesData: likesData,
    };
  }

  async function renderPostEmbed(container, resolved, config, signal) {
    container.innerHTML = "";
    var loadingDiv = el("div", "atproto-embed--loading");
    loadingDiv.appendChild(
      el("img", "atproto-spinner", { src: getIconUrl("spinner") })
    );
    loadingDiv.appendChild(document.createTextNode("Loading post…"));
    container.appendChild(loadingDiv);

    try {
      var did = extractDid(resolved.atUri);
      var results = await Promise.all([
        fetchPost(resolved.atUri, signal),
        fetchProfile(did),
      ]);
      var thread = results[0];
      var profile = results[1];

      if (thread && thread.post && thread.post.author && profile) {
        if (profile.verification) thread.post.author.verification = profile.verification;
        if (profile.associated) thread.post.author.associated = profile.associated;
      }
      var card = renderPostCard(
        thread,
        false,
        {
          sourceDomain: resolved.sourceDomain,
          sourceUrl: resolved.sourceUrl,
        },
        false,
        config,
        "post",
        "root",
        null
      );
      if (!card) throw new Error("Post not found or unavailable");
      container.innerHTML = "";
      container.appendChild(card);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      container.innerHTML = "";
      container.appendChild(
        el("div", "atproto-embed--error", {
          textContent: "Failed to load post",
        })
      );
      console.error("[atproto-embed]", err);
    }
  }

  async function renderDiscussionEmbed(container, resolved, config, hostContainer, signal) {
    container.innerHTML = "";
    var loadingDiv = el("div", "atproto-embed--loading");
    loadingDiv.appendChild(
      el("img", "atproto-spinner", { src: getIconUrl("spinner") })
    );
    loadingDiv.appendChild(document.createTextNode("Loading discussion…"));
    container.appendChild(loadingDiv);

    try {
      var data = await fetchDiscussionData(resolved.atUri, signal);
      container.innerHTML = "";
      container.appendChild(
        buildDiscussion(
          resolved.atUri,
          {
            sourceDomain: resolved.sourceDomain,
            sourceUrl: resolved.sourceUrl,
          },
          config,
          data,
          hostContainer
        )
      );
    } catch (err) {
      if (err && err.name === "AbortError") return;
      container.innerHTML = "";
      container.appendChild(
        el("div", "atproto-embed--error", {
          textContent: "Failed to load discussion",
        })
      );
      console.error("[atproto-embed]", err);
    }
  }



  /* ───── CSS injection ───── */

  function injectStyles(root) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = getBasePath() + "post.css";
    root.appendChild(link);
  }

  /* ───── Init ───── */

  async function initContainer(container) {
    var raw = container.getAttribute("data-uri");
    if (!raw) return;

    var previous = CONTAINER_ABORTS.get(container);
    if (previous) previous.abort();
    var controller = new AbortController();
    CONTAINER_ABORTS.set(container, controller);

    var config = parseConfig(container);

    container.classList.add("atproto-embed-host");
    container.classList.remove("atproto-embed-host--post", "atproto-embed-host--discussion");
    container.classList.add(
      config.mode === "discussion"
        ? "atproto-embed-host--discussion"
        : "atproto-embed-host--post"
    );
    applySizeConfig(container, config);

    var shadow = container.shadowRoot;
    if (!shadow) {
      shadow = container.attachShadow({ mode: "open" });
    } else {
      shadow.innerHTML = "";
    }

    injectStyles(shadow);

    var wrapper = el("div", "atproto-embed-inner");
    shadow.appendChild(wrapper);

    try {
      var resolved = await resolveUri(raw);

      if (config.mode === "discussion") {
        wrapper.classList.add("atproto-embed--discussion");
        renderDiscussionEmbed(wrapper, resolved, config, container, controller.signal);
      } else {
        wrapper.classList.add("atproto-embed--post");
        renderPostEmbed(wrapper, resolved, config, controller.signal);
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      wrapper.innerHTML = "";
      wrapper.appendChild(
        el("div", "atproto-embed--error", {
          textContent: "Failed to load embed",
        })
      );
      console.error("[atproto-embed]", err);
    }
  }

  function init(force) {
    var containers = document.querySelectorAll(
      ".atproto-embed:not([data-embed-child])"
    );
    containers.forEach(function (c) {
      if (!force && c.getAttribute("data-loaded")) return;
      var lazy = c.getAttribute("data-lazy");
      if (lazy === "true" && typeof IntersectionObserver !== "undefined") {
        if (c.getAttribute("data-loaded") === "pending") return;
        c.setAttribute("data-loaded", "pending");
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            observer.disconnect();
            c.setAttribute("data-loaded", "true");
            initContainer(c);
          });
        }, { rootMargin: "200px 0px" });
        observer.observe(c);
      } else {
        c.setAttribute("data-loaded", "true");
        initContainer(c);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  if (typeof window !== "undefined") {
    window.AtProtoEmbed = window.AtProtoEmbed || {};
    window.AtProtoEmbed.init = function (force) {
      init(!!force);
    };
    window.AtProtoEmbed.refresh = function () {
      init(true);
    };
  }
})();
