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

    var ICONS = {
    "avatar-fallback": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22none%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22%23e0e0e0%22%20rx%3D%2224%22%2F%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M32%2020a8%208%200%201%201-16%200%208%208%200%200%201%2016%200%22%20opacity%3D%22.2%22%2F%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M36.865%2034.5c-1.904-3.291-4.838-5.651-8.261-6.77a9%209%200%201%200-9.208%200c-3.424%201.117-6.357%203.477-8.261%206.77a.997.997%200%200%200%20.352%201.389%201%201%200%200%200%201.38-.389C15.22%2031.43%2019.383%2029%2024%2029s8.779%202.43%2011.134%206.5a1.001%201.001%200%201%200%201.73-1M17%2020a7%207%200%201%201%207%207%207.007%207.007%200%200%201-7-7%22%2F%3E%3C%2Fsvg%3E",
    "bookmark-fill": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M23%204H9a2%202%200%200%200-2%202v22a1%201%200%200%200%201.53.848l7.47-4.67%207.471%204.67A.999.999%200%200%200%2025%2028V6a2%202%200%200%200-2-2%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2216%22%20x2%3D%2216%22%20y1%3D%224%22%20y2%3D%2229%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23a855f7%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%238300ff%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "caret-down": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%20256%20256%22%3E%3Cpath%20d%3D%22m213.66%20101.66-80%2080a8%208%200%200%201-11.32%200l-80-80a8%208%200%200%201%2011.32-11.32L128%20164.69l74.34-74.35a8%208%200%200%201%2011.32%2011.32%22%2F%3E%3C%2Fsvg%3E",
    "caret-up": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%20256%20256%22%3E%3Cpath%20d%3D%22M213.66%20165.66a8%208%200%200%201-11.32%200L128%2091.31l-74.34%2074.35a8%208%200%200%201-11.32-11.32l80-80a8%208%200%200%201%2011.32%200l80%2080a8%208%200%200%201%200%2011.32%22%2F%3E%3C%2Fsvg%3E",
    "check-circle": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M16%203a13%2013%200%201%200%2013%2013A13.013%2013.013%200%200%200%2016%203m5.708%2010.708-7%207a1%201%200%200%201-1.415%200l-3-3a1%201%200%200%201%201.415-1.415L14%2018.586l6.293-6.293a1%201%200%200%201%201.415%201.415%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%223%22%20x2%3D%2229%22%20y1%3D%223%22%20y2%3D%2229%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23006aff%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23004099%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "label": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M30.414%2017%2018%204.586A1.98%201.98%200%200%200%2016.586%204H5a1%201%200%200%200-1%201v11.586A1.98%201.98%200%200%200%204.586%2018L17%2030.414a2%202%200%200%200%202.829%200l10.585-10.585a2%202%200%200%200%200-2.829M10.5%2012a1.5%201.5%200%201%201%200-3%201.5%201.5%200%200%201%200%203%22%2F%3E%3C%2Fsvg%3E",
    "like-fill": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M30%2012.75c0%208.75-12.974%2015.833-13.526%2016.125a1%201%200%200%201-.948%200C14.974%2028.582%202%2021.5%202%2012.75A7.76%207.76%200%200%201%209.75%205c2.581%200%204.841%201.11%206.25%202.986C17.409%206.11%2019.669%205%2022.25%205A7.76%207.76%200%200%201%2030%2012.75%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2216%22%20x2%3D%2216%22%20y1%3D%225%22%20y2%3D%2228.994%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23ec4899%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23ff3a3d%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "original-seal": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M28.233%2012.853c-.472-.493-.96-1-1.143-1.447-.17-.409-.18-1.086-.19-1.742-.019-1.22-.039-2.603-1-3.564s-2.344-.981-3.564-1c-.656-.01-1.333-.02-1.742-.19-.445-.184-.954-.671-1.447-1.142C18.286%202.938%2017.306%202%2016%202s-2.284.939-3.148%201.768c-.492.47-1%20.958-1.446%201.142-.406.17-1.086.18-1.742.19-1.22.019-2.603.039-3.564%201s-.975%202.344-1%203.564c-.01.656-.02%201.334-.19%201.742-.184.445-.671.954-1.142%201.446C2.938%2013.715%202%2014.696%202%2016s.939%202.284%201.768%203.148c.47.492.958%201%201.142%201.446.17.409.18%201.086.19%201.742.019%201.22.039%202.603%201%203.564s2.344.981%203.564%201c.656.01%201.334.02%201.742.19.445.184.954.671%201.446%201.143C13.715%2029.06%2014.696%2030%2016%2030s2.284-.939%203.148-1.767c.492-.472%201-.96%201.446-1.143.409-.17%201.086-.18%201.742-.19%201.22-.019%202.603-.039%203.564-1s.981-2.344%201-3.564c.01-.656.02-1.333.19-1.742.184-.445.671-.954%201.143-1.447C29.06%2018.286%2030%2017.306%2030%2016s-.939-2.284-1.767-3.148m-6.526.854-7%207a1%201%200%200%201-1.415%200l-3-3a1%201%200%200%201%201.415-1.415L14%2018.587l6.293-6.293a1%201%200%200%201%201.415%201.415%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%222%22%20x2%3D%2230%22%20y1%3D%222%22%20y2%3D%2230%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23ff6200%22%2F%3E%3Cstop%20offset%3D%22.615%22%20stop-color%3D%22%23f80%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23ff5900%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "private": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M26%2010h-4V7a6%206%200%201%200-12%200v3H6a2%202%200%200%200-2%202v14a2%202%200%200%200%202%202h20a2%202%200%200%200%202-2V12a2%202%200%200%200-2-2M16%2020.5a1.5%201.5%200%201%201%200-3%201.5%201.5%200%200%201%200%203M20%2010h-8V7a4%204%200%201%201%208%200z%22%2F%3E%3C%2Fsvg%3E",
    "quote-fill": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M14.5%209v11a6.006%206.006%200%200%201-6%206%201%201%200%200%201%200-2%204%204%200%200%200%204-4v-1H5a2%202%200%200%201-2-2V9a2%202%200%200%201%202-2h7.5a2%202%200%200%201%202%202M27%207h-7.5a2%202%200%200%200-2%202v8a2%202%200%200%200%202%202H27v1a4%204%200%200%201-4%204%201%201%200%200%200%200%202%206.006%206.006%200%200%200%206-6V9a2%202%200%200%200-2-2%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2216%22%20x2%3D%2216%22%20y1%3D%227%22%20y2%3D%2226%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%233b82f6%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%230061ff%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "reply-fill": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M29%206v16a2%202%200%200%201-2%202H10.375L6.3%2027.52l-.011.009a1.99%201.99%200%200%201-2.138.281A1.98%201.98%200%200%201%203%2026V6a2%202%200%200%201%202-2h22a2%202%200%200%201%202%202%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%224%22%20x2%3D%2228%22%20y1%3D%224%22%20y2%3D%2228%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23ffa309%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23da4100%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "reply": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22%234f575e%22%20viewBox%3D%220%200%20256%20256%22%3E%3Cpath%20d%3D%22M229.66%2C157.66l-48%2C48A8%2C8%2C0%2C0%2C1%2C168%2C200V160H128A104.11%2C104.11%2C0%2C0%2C1%2C24%2C56a8%2C8%2C0%2C0%2C1%2C16%2C0%2C88.1%2C88.1%2C0%2C0%2C0%2C88%2C88h40V104a8%2C8%2C0%2C0%2C1%2C13.66-5.66l48%2C48A8%2C8%2C0%2C0%2C1%2C229.66%2C157.66Z%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E",
    "repost-fill": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22%2322c55e%22%20d%3D%22M2.5%2016A9.51%209.51%200%200%201%2012%206.5h12.375l-.44-.439a1.503%201.503%200%200%201%202.125-2.125l3%203a1.5%201.5%200%200%201%200%202.125l-3%203a1.503%201.503%200%200%201-2.125-2.125l.44-.436H12A6.51%206.51%200%200%200%205.5%2016a1.5%201.5%200%201%201-3%200M28%2014.5a1.5%201.5%200%200%200-1.5%201.5%206.507%206.507%200%200%201-6.5%206.5H7.625l.44-.439a1.502%201.502%200%201%200-2.125-2.125l-3%203a1.5%201.5%200%200%200%200%202.125l3%203a1.503%201.503%200%200%200%202.125-2.125l-.44-.436H20a9.51%209.51%200%200%200%209.5-9.5%201.5%201.5%200%200%200-1.5-1.5%22%2F%3E%3Cpath%20fill%3D%22%2322c55e%22%20d%3D%22M28%207.75v8a8%208%200%200%201-8%208H4v-8a8%208%200%200%201%208-8z%22%20opacity%3D%22.2%22%2F%3E%3C%2Fsvg%3E",
    "spinner": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M17%204v4a1%201%200%200%201-2%200V4a1%201%200%200%201%202%200m4.656%207.344a1%201%200%200%200%20.708-.294l2.828-2.828a1%201%200%200%200-1.415-1.414L20.95%209.636a1%201%200%200%200%20.706%201.708M28%2015h-4a1%201%200%200%200%200%202h4a1%201%200%200%200%200-2m-5.636%205.95a1%201%200%200%200-1.414%201.414l2.828%202.828a1%201%200%201%200%201.415-1.415zM16%2023a1%201%200%200%200-1%201v4a1%201%200%200%200%202%200v-4a1%201%200%200%200-1-1m-6.364-2.05-2.828%202.828a1%201%200%201%200%201.415%201.415l2.827-2.83a1%201%200%200%200-1.414-1.413M9%2016a1%201%200%200%200-1-1H4a1%201%200%200%200%200%202h4a1%201%200%200%200%201-1m-.777-9.192a1%201%200%201%200-1.416%201.415l2.83%202.827a1%201%200%200%200%201.413-1.414z%22%2F%3E%3C%2Fsvg%3E",
    "trsuted-seal": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M28.233%2012.853c-.472-.493-.96-1-1.143-1.447-.17-.409-.18-1.086-.19-1.742-.019-1.22-.039-2.603-1-3.564s-2.344-.981-3.564-1c-.656-.01-1.333-.02-1.742-.19-.445-.184-.954-.671-1.447-1.142C18.286%202.938%2017.306%202%2016%202s-2.284.939-3.148%201.768c-.492.47-1%20.958-1.446%201.142-.406.17-1.086.18-1.742.19-1.22.019-2.603.039-3.564%201s-.975%202.344-1%203.564c-.01.656-.02%201.334-.19%201.742-.184.445-.671.954-1.142%201.446C2.938%2013.715%202%2014.696%202%2016s.939%202.284%201.768%203.148c.47.492.958%201%201.142%201.446.17.409.18%201.086.19%201.742.019%201.22.039%202.603%201%203.564s2.344.981%203.564%201c.656.01%201.334.02%201.742.19.445.184.954.671%201.446%201.143C13.715%2029.06%2014.696%2030%2016%2030s2.284-.939%203.148-1.767c.492-.472%201-.96%201.446-1.143.409-.17%201.086-.18%201.742-.19%201.22-.019%202.603-.039%203.564-1s.981-2.344%201-3.564c.01-.656.02-1.333.19-1.742.184-.445.671-.954%201.143-1.447C29.06%2018.286%2030%2017.306%2030%2016s-.939-2.284-1.767-3.148m-6.526.854-7%207a1%201%200%200%201-1.415%200l-3-3a1%201%200%200%201%201.415-1.415L14%2018.587l6.293-6.293a1%201%200%200%201%201.415%201.415%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%222%22%20x2%3D%2230%22%20y1%3D%222%22%20y2%3D%2230%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%2329de6b%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%230f9f44%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "warn": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M28.233%2012.853c-.472-.493-.96-1-1.143-1.447-.17-.409-.18-1.086-.19-1.742-.019-1.22-.039-2.603-1-3.564s-2.344-.981-3.564-1c-.656-.01-1.333-.02-1.742-.19-.445-.184-.954-.671-1.447-1.142C18.286%202.938%2017.306%202%2016%202s-2.284.939-3.148%201.768c-.492.47-1%20.958-1.446%201.142-.406.17-1.086.18-1.742.19-1.22.019-2.603.039-3.564%201s-.975%202.344-1%203.564c-.01.656-.02%201.334-.19%201.742-.184.445-.671.954-1.142%201.446C2.938%2013.715%202%2014.696%202%2016s.939%202.284%201.768%203.148c.47.492.958%201%201.142%201.446.17.409.18%201.086.19%201.742.019%201.22.039%202.603%201%203.564s2.344.981%203.564%201c.656.01%201.334.02%201.742.19.445.184.954.671%201.446%201.143C13.715%2029.06%2014.696%2030%2016%2030s2.284-.939%203.148-1.767c.492-.472%201-.96%201.446-1.143.409-.17%201.086-.18%201.742-.19%201.22-.019%202.603-.039%203.564-1s.981-2.344%201-3.564c.01-.656.02-1.333.19-1.742.184-.445.671-.954%201.143-1.447C29.06%2018.286%2030%2017.306%2030%2016s-.939-2.284-1.767-3.148M15%2010a1%201%200%200%201%202%200v7a1%201%200%200%201-2%200zm1%2013a1.5%201.5%200%201%201%200-3%201.5%201.5%200%200%201%200%203%22%2F%3E%3C%2Fsvg%3E"
  };

  function getIconUrl(name) {
    return ICONS[name] || "";
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
    seal: "trsuted-seal",
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
    "trsuted-seal",
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
    var quotesData = results[1];
    var likesData = results[2];
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
      if (profile) {
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
    var style = document.createElement("style");
    style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap');:root,:host{--neutral-0:#ffffff;--neutral-1:#f8f9fa;--neutral-2:#f1f3f5;--neutral-3:#e9ecef;--neutral-4:#dee2e6;--neutral-5:#ced4da;--neutral-6:#adb5bd;--neutral-7:#6a7178;--neutral-8:#4f575e;--neutral-9:#272b30;--neutral-10:#101213;--neutral-11:#000000;--primary-light:#f8f9ff;--primary-base:#0a66f4;--primary-hover:#20439b;--primary-dark:#1c2855;--font-displayLarge:45px;--font-displaymedium:40px;--font-displaySmall:36px;--font-heading1:32px;--font-heading2:28px;--font-heading3:25px;--font-heading4:22px;--font-heading5:20px;--font-heading6:18px;--font-subtitle:16px;--font-body:14px;--font-caption:12px;--font-label:11px;--font-tagline:10px;--font-sans:\"Google Sans Flex\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;--transition:all 0.32s ease-in-out;--atproto-font-family:var(--font-sans);--atproto-display-name-color:var(--neutral-10);--atproto-display-name-size:var(--font-body);--atproto-display-name-weight:700;--atproto-handle-color:var(--neutral-7);--atproto-handle-size:var(--font-body);--atproto-text-color:var(--neutral-11);--atproto-text-size:var(--font-subtitle);--atproto-text-line-height:1.5;--atproto-timestamp-color:var(--neutral-7);--atproto-timestamp-size:var(--font-caption);--atproto-mention-color:var(--primary-base);--atproto-hashtag-color:var(--primary-base);--atproto-link-color:var(--primary-base);--atproto-link-decoration:none;--atproto-bg:var(--neutral-0);--atproto-border-color:var(--neutral-1);--atproto-border-radius:12px;--atproto-border-width:1px;--atproto-max-width:600px;--atproto-image-radius:8px;--atproto-image-gap:4px;--atproto-video-radius:8px;--atproto-card-bg:var(--neutral-1);--atproto-card-border-color:var(--neutral-2);--atproto-card-title-color:var(--neutral-10);--atproto-card-title-size:var(--font-body);--atproto-card-desc-color:var(--neutral-7);--atproto-card-desc-size:var(--font-caption);--atproto-card-domain-color:var(--neutral-9);--atproto-card-domain-size:var(--font-label);--atproto-external-thumb-ratio:1.91 / 1;--atproto-quote-bg:var(--neutral-0);--atproto-quote-border-color:var(--neutral-1);--atproto-stat-color:var(--neutral-10);--atproto-stat-size:var(--font-body);--atproto-stat-icon-color:var(--neutral-7);--atproto-via-color:var(--primary-base);--atproto-via-size:var(--font-caption);--atproto-label-bg:#fff3cd;--atproto-label-color:#856404;--atproto-label-border-color:#ffc107;--atproto-action-size:var(--font-body);--atproto-avatar-size:42px;--atproto-avatar-radius:50%;--atproto-thread-line-color:var(--neutral-2);--atproto-thread-line-width:2px;--atproto-reply-indent:24px;--atproto-load-more-color:var(--primary-base);--atproto-load-more-bg:transparent;--atproto-load-more-border-color:var(--neutral-2);--atproto-liked-by-label-color:var(--neutral-7);--atproto-liked-by-avatar-size:32px;--atproto-liked-by-avatar-gap:6px;--atproto-liked-by-overflow-color:var(--neutral-7);--atproto-liked-by-overflow-bg:var(--neutral-2)}:host(.atproto-embed-host){display:block;width:var(--atproto-width,100%);max-width:var(--atproto-max-width);min-width:0;box-sizing:border-box}:host(.atproto-embed-host--post){margin:32px 0}:is(.atproto-embed--post,.atproto-embed--discussion){width:var(--atproto-width,100%);max-width:var(--atproto-max-width);font-family:var(--atproto-font-family);box-sizing:border-box}:is(.atproto-embed--post,.atproto-embed--discussion) *,:is(.atproto-embed--post,.atproto-embed--discussion) *::before,:is(.atproto-embed--post,.atproto-embed--discussion) *::after{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:var(--neutral-7) transparent}a,label,select,input,textarea,button{font-family:inherit}:is(.atproto-embed--post,.atproto-embed--discussion) .atproto-post{background:var(--atproto-bg);border:1px solid var(--neutral-3);border-radius:20px;box-shadow:0 0 0 2px var(--neutral-1);padding:16px;color:var(--atproto-text-color)}.atproto-embed--post .atproto-post__header,.atproto-embed--discussion .atproto-post__header{display:flex;align-items:center;gap:8px;margin-bottom:8px;text-decoration:none;color:inherit}.atproto-embed--post .atproto-post__header-main-link,.atproto-embed--discussion .atproto-post__header-main-link{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:inherit;min-width:0}.atproto-embed--post .atproto-post__header-main,.atproto-embed--discussion .atproto-post__header-main{display:flex;align-items:center;gap:8px;min-width:0}.atproto-embed--post .atproto-post__author,.atproto-embed--discussion .atproto-post__author{display:flex;flex-direction:column;min-width:0;gap:2px}.atproto-embed--post .atproto-post__display-name,.atproto-embed--discussion .atproto-post__display-name{color:var(--atproto-display-name-color);font-size:var(--atproto-display-name-size);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-0.01em;line-height:1.2}.atproto-embed--post .atproto-post__display-name-wrap,.atproto-embed--discussion .atproto-post__display-name-wrap{display:flex;align-items:center;gap:4px;min-width:0}.atproto-embed--post .atproto-badge-wrap,.atproto-embed--discussion .atproto-badge-wrap{display:inline-flex;align-items:center;flex-shrink:0}.atproto-embed--post .atproto-badge,.atproto-embed--discussion .atproto-badge{display:block}.atproto-embed--post .atproto-badge-wrap img,.atproto-embed--discussion .atproto-badge-wrap img{width:16px;height:16px}.atproto-embed--post .atproto-post__handle,.atproto-embed--discussion .atproto-post__handle{color:var(--atproto-handle-color);font-size:var(--atproto-handle-size);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}.atproto-embed--post .atproto-post__reply-context,.atproto-embed--discussion .atproto-post__reply-context{background:var(--neutral-1);color:var(--neutral-8);border-radius:8px;padding:4px 8px;font-size:var(--font-caption);margin-bottom:8px;display:flex;align-items:center;gap:6px;width:fit-content}.atproto-embed--post .atproto-post__reply-context img,.atproto-embed--discussion .atproto-post__reply-context img{width:14px;height:14px;flex-shrink:0}.atproto-embed--post .atproto-post__text,.atproto-embed--discussion .atproto-post__text{color:var(--atproto-text-color);font-size:var(--atproto-text-size);line-height:var(--atproto-text-line-height);margin-bottom:12px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}.atproto-embed--post .atproto-post__paragraph:not(:last-child),.atproto-embed--discussion .atproto-post__paragraph:not(:last-child){margin-bottom:8px}.atproto-embed--post .atproto-post__mention,.atproto-embed--discussion .atproto-post__mention{color:var(--atproto-mention-color);font-weight:600;text-decoration:none}.atproto-embed--post .atproto-post__hashtag,.atproto-embed--discussion .atproto-post__hashtag{color:var(--atproto-hashtag-color);font-weight:600;text-decoration:none}.atproto-embed--post .atproto-post__link,.atproto-embed--discussion .atproto-post__link{color:var(--atproto-link-color);font-weight:600;text-decoration:var(--atproto-link-decoration)}@media (hover:hover){.atproto-embed--post .atproto-post__mention:hover,.atproto-embed--discussion .atproto-post__mention:hover,.atproto-embed--post .atproto-post__hashtag:hover,.atproto-embed--discussion .atproto-post__hashtag:hover,.atproto-embed--post .atproto-post__link:hover,.atproto-embed--discussion .atproto-post__link:hover{text-decoration:underline}.atproto-embed--post .atproto-post__timestamp:hover,.atproto-embed--discussion .atproto-post__timestamp:hover{text-decoration:underline}.atproto-embed--post .atproto-post__via a:hover,.atproto-embed--discussion .atproto-post__via a:hover{text-decoration:underline}}.atproto-embed--post .atproto-post__embed,.atproto-embed--discussion .atproto-post__embed{margin-top:12px}.atproto-embed--post .atproto-post__embed>*:not(:first-child),.atproto-embed--discussion .atproto-post__embed>*:not(:first-child){margin-top:12px}.atproto-embed--post .atproto-embed__images,.atproto-embed--discussion .atproto-embed__images{display:grid;gap:var(--atproto-image-gap);border-radius:var(--atproto-image-radius);overflow:hidden;max-height:530px}.atproto-embed--post .atproto-embed__images--1,.atproto-embed--discussion .atproto-embed__images--1{grid-template-columns:1fr}.atproto-embed--post .atproto-embed__images--2,.atproto-embed--discussion .atproto-embed__images--2{grid-template-columns:1fr 1fr;height:320px}.atproto-embed--post .atproto-embed__images--3,.atproto-embed--discussion .atproto-embed__images--3{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:320px}.atproto-embed--post .atproto-embed__images--3 .atproto-embed__image-link:first-child,.atproto-embed--discussion .atproto-embed__images--3 .atproto-embed__image-link:first-child{grid-row:1 / -1}.atproto-embed--post .atproto-embed__images--4,.atproto-embed--discussion .atproto-embed__images--4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:400px}.atproto-embed--post .atproto-embed__image-link,.atproto-embed--discussion .atproto-embed__image-link{display:block;width:100%;height:100%;overflow:hidden}.atproto-embed--post .atproto-embed__images img,.atproto-embed--discussion .atproto-embed__images img{width:100%;height:100%;display:block;object-fit:cover;transition:opacity 0.2s,transform 0.3s ease-out}.atproto-embed--post .atproto-embed__image-link:hover img,.atproto-embed--discussion .atproto-embed__image-link:hover img{opacity:0.9;transform:scale(1.02)}.atproto-embed--post .atproto-embed__images--1 img,.atproto-embed--discussion .atproto-embed__images--1 img{max-height:530px;object-fit:contain;object-position:center;background:var(--neutral-1);border:2px solid var(--neutral-2);border-radius:16px}.atproto-embed--post .atproto-embed__images--2 img,.atproto-embed--post .atproto-embed__images--3 img,.atproto-embed--post .atproto-embed__images--4 img,.atproto-embed--discussion .atproto-embed__images--2 img,.atproto-embed--discussion .atproto-embed__images--3 img,.atproto-embed--discussion .atproto-embed__images--4 img{height:100%}.atproto-embed--post .atproto-embed__video,.atproto-embed--discussion .atproto-embed__video{border-radius:var(--atproto-video-radius);overflow:hidden;background:#000}.atproto-embed--post .atproto-embed__video video,.atproto-embed--post .atproto-embed__video iframe,.atproto-embed--discussion .atproto-embed__video video,.atproto-embed--discussion .atproto-embed__video iframe{width:100%;max-height:530px;display:block;border:none}.atproto-embed--post .atproto-embed__gif,.atproto-embed--discussion .atproto-embed__gif{display:block;border-radius:var(--atproto-image-radius);overflow:hidden;text-decoration:none}.atproto-embed--post .atproto-embed__gif-img,.atproto-embed--discussion .atproto-embed__gif-img{width:100%;max-height:400px;display:block;object-fit:contain;object-position:center;background:var(--neutral-0)}.atproto-embed--post .atproto-embed__external,.atproto-embed--discussion .atproto-embed__external{border-radius:16px;overflow:hidden;text-decoration:none;display:block;color:inherit;transition:box-shadow 0.18s,border-color 0.18s}.atproto-embed--post .atproto-embed__external:hover,.atproto-embed--discussion .atproto-embed__external:hover{box-shadow:0 3px 12px rgba(0,0,0,0.1)}.atproto-embed--post .atproto-embed__external-thumb,.atproto-embed--discussion .atproto-embed__external-thumb{width:100%;height:auto;aspect-ratio:var(--atproto-external-thumb-ratio);object-fit:cover;object-position:center;display:block;background:var(--neutral-0)}.atproto-embed--post .atproto-embed__external-content,.atproto-embed--discussion .atproto-embed__external-content{padding:16px;background:var(--atproto-card-bg)}.atproto-embed--post .atproto-embed__external--horizontal,.atproto-embed--discussion .atproto-embed__external--horizontal{display:flex;align-items:stretch}.atproto-embed--post .atproto-embed__external--horizontal .atproto-embed__external-thumb,.atproto-embed--discussion .atproto-embed__external--horizontal .atproto-embed__external-thumb{width:38%;max-width:220px;flex:0 0 auto}@media (max-width:520px){.atproto-embed--post .atproto-embed__external--horizontal,.atproto-embed--discussion .atproto-embed__external--horizontal{display:block}.atproto-embed--post .atproto-embed__external--horizontal .atproto-embed__external-thumb,.atproto-embed--discussion .atproto-embed__external--horizontal .atproto-embed__external-thumb{width:100%;max-width:none}}.atproto-embed--post .atproto-embed__external-title,.atproto-embed--discussion .atproto-embed__external-title{color:var(--atproto-card-title-color);font-size:var(--atproto-card-title-size);line-height:1.4;font-weight:600;margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.atproto-embed--post .atproto-embed__external-desc,.atproto-embed--discussion .atproto-embed__external-desc{color:var(--atproto-card-desc-color);font-size:var(--atproto-card-desc-size);display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px;line-height:1.5}.atproto-embed--post .atproto-embed__external-domain,.atproto-embed--discussion .atproto-embed__external-domain{color:var(--atproto-card-domain-color);font-size:var(--atproto-card-domain-size);font-weight:600}.atproto-embed--post .atproto-embed__quote,.atproto-embed--discussion .atproto-embed__quote{border:2px solid var(--atproto-quote-border-color);border-radius:16px;padding:16px;background:var(--atproto-quote-bg)}.atproto-embed--post .atproto-embed__quote .atproto-post,.atproto-embed--discussion .atproto-embed__quote .atproto-post{border:none;padding:0;background:transparent;box-shadow:none}.atproto-embed--post .atproto-post__footer,.atproto-embed--discussion .atproto-post__footer{margin-top:16px}.atproto-embed--post .atproto-post__metrics-row,.atproto-embed--post .atproto-post__info-row,.atproto-embed--discussion .atproto-post__metrics-row,.atproto-embed--discussion .atproto-post__info-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.atproto-embed--post .atproto-post__info-row{padding-top:12px;margin-top:12px;border-top:1px dashed var(--neutral-3)}.atproto-embed--post .atproto-post__metrics-left,.atproto-embed--post .atproto-post__metrics-right,.atproto-embed--discussion .atproto-post__metrics-left,.atproto-embed--discussion .atproto-post__metrics-right{display:flex;align-items:center;gap:16px}.atproto-embed--post .atproto-post__stat--likes,.atproto-embed--post .atproto-post__stat--reposts,.atproto-embed--post .atproto-post__stat--replies,.atproto-embed--post .atproto-post__stat--quotes,.atproto-embed--post .atproto-post__stat--bookmarks,.atproto-embed--discussion .atproto-post__stat--likes,.atproto-embed--discussion .atproto-post__stat--reposts,.atproto-embed--discussion .atproto-post__stat--replies,.atproto-embed--discussion .atproto-post__stat--quotes,.atproto-embed--discussion .atproto-post__stat--bookmarks{display:flex;align-items:center;gap:4px;color:var(--atproto-stat-color);font-size:var(--atproto-stat-size);font-weight:500}.atproto-embed--post .atproto-post__stat--quotes,.atproto-embed--discussion .atproto-post__stat--quotes{text-decoration:none}.atproto-embed--post .atproto-post__metrics-row img,.atproto-embed--discussion .atproto-post__metrics-row img{width:18px;height:18px}.atproto-embed--post .atproto-post__timestamp,.atproto-embed--discussion .atproto-post__timestamp{color:var(--atproto-timestamp-color);font-size:var(--atproto-timestamp-size);text-decoration:none;font-weight:500}.atproto-embed--post .atproto-post__via,.atproto-embed--discussion .atproto-post__via{font-size:var(--atproto-via-size);color:var(--atproto-handle-color)}.atproto-embed--post .atproto-post__via a,.atproto-embed--discussion .atproto-post__via a{color:var(--atproto-via-color);text-decoration:none;font-weight:600}.atproto-embed--post .atproto-post__label,.atproto-embed--discussion .atproto-post__label{background:var(--atproto-label-bg);color:var(--atproto-label-color);border:1px solid var(--atproto-label-border-color);border-radius:100px;padding:4px 12px;font-size:var(--font-label);margin-top:12px;font-weight:500;width:fit-content}.atproto-embed--post .atproto-embed--loading,.atproto-embed--discussion .atproto-embed--loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px 32px;color:var(--atproto-handle-color);font-size:14px;font-weight:500;text-align:center}.atproto-embed--post .atproto-spinner,.atproto-embed--discussion .atproto-spinner{width:24px;height:24px;animation:atproto-spin 1s linear infinite;opacity:0.6}@keyframes atproto-spin{100%{transform:rotate(360deg)}}.atproto-embed--post .atproto-embed--error,.atproto-embed--discussion .atproto-embed--error{display:flex;align-items:center;justify-content:center;padding:24px;color:#cf222e;font-size:14px;border:1px solid #fdd;border-radius:var(--atproto-border-radius);background:#fff5f5;text-align:center;white-space:nowrap}.atproto-embed--post .atproto-post__actions,.atproto-embed--discussion .atproto-post__actions{display:flex;gap:10px;margin-top:16px}.atproto-embed--post .atproto-post__action,.atproto-embed--discussion .atproto-post__action{display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;border-radius:100px;font-size:var(--atproto-action-size);font-weight:600;font-family:var(--atproto-font-family);text-decoration:none;transition:background 0.15s,box-shadow 0.15s,opacity 0.15s;cursor:pointer;border:none;line-height:1;letter-spacing:-0.01em;white-space:nowrap}.atproto-embed--post .atproto-post__action--primary,.atproto-embed--discussion .atproto-post__action--primary{background:var(--primary-base);color:var(--primary-light)}.atproto-embed--post .atproto-post__action--primary:hover,.atproto-embed--discussion .atproto-post__action--primary:hover{background:var(--primary-hover)}.atproto-embed--post .atproto-post__action--secondary,.atproto-embed--discussion .atproto-post__action--secondary{background:var(--neutral-2);color:var(--neutral-11)}.atproto-embed--post .atproto-post__action--secondary:hover,.atproto-embed--discussion .atproto-post__action--secondary:hover{background:var(--neutral-4)}.atproto-embed--post .atproto-post__avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;border:none}.atproto-embed--post .atproto-post__header-main-link:hover .atproto-post__display-name{text-decoration:none}.atproto-embed--post .atproto-post__actions{justify-content:space-between}.atproto-embed--post .atproto-post__action{width:100%}.atproto-embed--discussion .atproto-post__avatar{width:var(--atproto-avatar-size);height:var(--atproto-avatar-size);border-radius:var(--atproto-avatar-radius);object-fit:cover;flex-shrink:0;border:none}@media (hover:hover){.atproto-embed--discussion .atproto-post__header-main-link:hover .atproto-post__display-name{text-decoration:underline}.atproto-embed--discussion .atproto-post__header-right:hover{text-decoration:underline}}.atproto-embed--discussion .atproto-post--compact .atproto-post__header{gap:10px}.atproto-embed--discussion .atproto-post--compact .atproto-post__author-simple{display:none}.atproto-embed--discussion .atproto-post--compact .atproto-post__avatar{width:24px;height:24px}.atproto-embed--discussion .atproto-post--compact .atproto-post__author-inline{display:inline-flex;align-items:center;gap:2px;min-width:0;max-width:100%}.atproto-embed--discussion .atproto-post--compact .atproto-post__display-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.atproto-embed--discussion .atproto-post--compact .atproto-post__handle{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80%;line-height:1.2}.atproto-embed--discussion .atproto-post--compact .atproto-post__header-main{min-width:0;max-width:100%}.atproto-embed--discussion .atproto-post--compact .atproto-post__header-main-link{max-width:calc(100% - 48px)}.atproto-embed--discussion .atproto-post--compact .atproto-post__text{font-size:var(--font-body)}.atproto-embed--discussion .atproto-post--compact .atproto-post__text:last-child{margin-bottom:0}.atproto-embed--discussion .atproto-post__badges-inline{display:inline-flex;align-items:center;gap:4px}.atproto-embed--discussion .atproto-post__header-right{margin-left:auto;color:var(--atproto-timestamp-color);font-size:var(--font-caption);text-decoration:none;font-weight:500;white-space:nowrap}.atproto-embed--discussion .atproto-discussion{background:var(--atproto-bg);border:var(--atproto-border-width) solid var(--atproto-border-color);border-radius:20px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07),0 0 0 1px rgba(0,0,0,0.03)}.atproto-embed--discussion .atproto-discussion>.atproto-post.atproto-post--main{border:none;border-bottom:2px solid var(--atproto-border-color);border-radius:0;box-shadow:none;padding:16px}.atproto-embed--discussion .atproto-post--main .atproto-post__header{gap:8px;margin-bottom:8px}.atproto-embed--discussion .atproto-post--main .atproto-post__avatar{border:none}.atproto-embed--discussion .atproto-post--main .atproto-post__metrics-row{padding-bottom:12px;margin-bottom:12px;border-bottom:1px dashed var(--neutral-3)}.atproto-embed--discussion .atproto-post--main .atproto-post__footer{margin-top:16px;padding-top:0;border-top:0}.atproto-embed--discussion .atproto-post--main .atproto-post__metrics-row img{width:18px;height:18px;opacity:1}.atproto-embed--discussion .atproto-post__metrics-row--simple{padding-bottom:0;margin-bottom:0;border-bottom:0;font-size:var(--font-caption);color:var(--atproto-stat-color)}.atproto-embed--discussion .atproto-post__stat-text{color:var(--atproto-stat-color);font-weight:600;font-size:var(--font-caption)}.atproto-embed--discussion .atproto-post__stat-link{color:var(--atproto-via-color);font-weight:600;text-decoration:none;font-size:var(--font-caption)}.atproto-embed--discussion .atproto-replies-toggle{margin-top:10px}.atproto-embed--discussion .atproto-replies-toggle__btn{display:inline-flex;align-items:center;gap:6px;padding:0;border:none;background:transparent;color:var(--atproto-via-color);font-size:var(--font-caption);font-weight:600;cursor:pointer}@media (hover:hover){.atproto-embed--discussion .atproto-post__stat-link:hover,.atproto-embed--discussion .atproto-replies-toggle__btn:hover{text-decoration:underline}}.atproto-embed--discussion .atproto-replies-toggle__icon{width:12px;height:12px;flex-shrink:0}.atproto-embed--discussion .atproto-post--no-embed .atproto-post__text{margin-bottom:12px}.atproto-embed--discussion .atproto-post--no-embed.atproto-post--no-footer .atproto-post__text,.atproto-embed--post .atproto-post--no-embed.atproto-post--no-footer .atproto-post__text{margin-bottom:0}.atproto-embed--discussion .atproto-post--no-embed .atproto-post__footer{margin-top:8px}.atproto-embed--discussion .atproto-discussion__liked-by{padding:0 16px 24px;background:var(--neutral-0)}.atproto-embed--discussion .atproto-liked-by__label{color:var(--neutral-8);font-size:var(--font-tagline);font-weight:600;margin-bottom:10px}.atproto-embed--discussion .atproto-liked-by__avatars{display:grid;align-items:center;gap:var(--atproto-liked-by-avatar-gap);grid-template-columns:repeat(auto-fill,minmax(var(--atproto-liked-by-avatar-size),1fr))}.atproto-embed--discussion .atproto-liked-by__avatars a{display:block;justify-self:center;border-radius:50%;transition:transform 0.15s}.atproto-embed--discussion .atproto-liked-by__avatars a:hover{transform:scale(1.12);z-index:1;position:relative}.atproto-embed--discussion .atproto-liked-by__avatars img{width:var(--atproto-liked-by-avatar-size);height:var(--atproto-liked-by-avatar-size);border-radius:50%;object-fit:cover;display:block;box-shadow:0 0 0 1px rgba(0,0,0,0.08)}.atproto-embed--discussion .atproto-liked-by__overflow{display:inline-flex;align-items:center;justify-content:center;min-width:var(--atproto-liked-by-avatar-size);height:var(--atproto-liked-by-avatar-size);border-radius:50%;background:var(--neutral-1);color:var(--neutral-11);font-size:var(--font-tagline);font-weight:700;padding:0 6px;border:2px solid var(--neutral-0);box-shadow:0 0 0 1px var(--neutral-3);width:fit-content;justify-self:start}.atproto-embed--discussion .atproto-liked-by__overflow--pill{border-radius:10px;min-width:auto;padding:0 10px}.atproto-embed--discussion .atproto-discussion__join{display:flex;justify-content:center;padding:20px;border-bottom:1px solid var(--neutral-2);background:var(--atproto-bg)}.atproto-embed--discussion .atproto-discussion__join .atproto-post__action{width:100%}.atproto-embed--discussion .atproto-discussion__comments-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 16px 12px;background:var(--atproto-bg)}.atproto-embed--discussion .atproto-discussion__comments-title{font-size:var(--font-heading4);font-weight:600;color:var(--neutral-10)}.atproto-embed--discussion .atproto-discussion__comments-bar .atproto-post__action{width:auto;padding:8px 16px}@media (max-width:768px){.atproto-embed--post .atproto-post__action,.atproto-embed--discussion .atproto-post__action,.atproto-embed--discussion .atproto-discussion__comments-bar .atproto-post__action{font-size:var(--font-caption)}}.atproto-embed--discussion .atproto-discussion__tabs{display:flex;flex-direction:column}.atproto-embed--discussion .atproto-discussion__tab-bar{display:flex;align-items:center;justify-content:flex-start;gap:0;background:var(--neutral-1);border-bottom:2px solid var(--neutral-2);border-top:2px solid var(--neutral-2);padding:8px 16px}.atproto-embed--discussion .atproto-discussion__tab-bar button{padding:6px 12px;background:transparent;cursor:pointer;font-size:var(--font-caption);font-weight:600;color:var(--neutral-7);border:2px solid transparent;transition:color 0.15s,border-color 0.15s;border-radius:100px;width:fit-content;white-space:nowrap}.atproto-embed--discussion .atproto-discussion__tab-bar button[aria-selected=\"true\"]{color:var(--neutral-11);background:var(--neutral-0);border-color:var(--neutral-2)}.atproto-embed--discussion .atproto-discussion__tab-bar button:hover:not([aria-selected=\"true\"]){color:var(--neutral-10)}.atproto-embed--discussion .atproto-discussion__sort-bar{display:flex;align-items:center;justify-content:flex-end;padding:8px 12px;background:var(--atproto-bg);border-bottom:2px solid var(--neutral-1);font-size:var(--font-caption);color:var(--neutral-7)}.atproto-embed--discussion .atproto-discussion__sort-select{padding:8px 4px;border-radius:8px;border:none;background:transparent;font-size:var(--font-caption);font-weight:600;color:var(--neutral-9);cursor:pointer;transition:var(--transition);outline:1px solid transparent;width:100%}.atproto-embed--discussion .atproto-discussion__sort-select:hover,.atproto-embed--discussion .atproto-discussion__sort-select:focus{outline:1px solid var(--neutral-4)}.atproto-embed--discussion .atproto-discussion__tab-content{min-height:60px}.atproto-embed--discussion .atproto-replies,.atproto-embed--discussion .atproto-quotes{padding:0;content-visibility:auto;contain-intrinsic-size:1px 600px}.atproto-embed--discussion .atproto-quotes>.atproto-post{border:none;border-radius:0;border-bottom:2px solid var(--atproto-border-color);box-shadow:none;padding:16px}.atproto-embed--discussion .atproto-quotes>.atproto-post:last-child{border-bottom:none}.atproto-embed--discussion .atproto-replies{background:var(--atproto-bg)}.atproto-embed--discussion .atproto-reply-thread{position:relative;display:flex;flex-direction:column}.atproto-embed--discussion .atproto-reply-thread .atproto-post{border:none !important;border-radius:0 !important;padding:16px !important;box-shadow:none !important;background:transparent !important}.atproto-embed--discussion .atproto-reply-children .atproto-post{padding:12px !important}.atproto-embed--discussion .atproto-reply-children .atproto-post__header{margin-bottom:6px}.atproto-embed--discussion .atproto-reply-children .atproto-post__embed{margin-top:8px}.atproto-embed--discussion .atproto-post--compact .atproto-embed__quote{padding:0}.atproto-embed--discussion .atproto-post--compact .atproto-embed__quote .atproto-post{padding:10px}.atproto-embed--discussion .atproto-reply-children{margin-left:18px;border-left:2px solid var(--neutral-2);padding-left:10px;transition:border-left-color 0.1s ease}.atproto-embed--discussion .atproto-reply-children:hover{border-left-color:var(--neutral-2)}.atproto-embed--discussion .atproto-replies>.atproto-reply-thread{border-bottom:2px solid var(--atproto-border-color)}.atproto-embed--discussion .atproto-replies>.atproto-reply-thread:last-child{border-bottom:none}.atproto-embed--discussion .atproto-reply-children .atproto-reply-thread{margin-top:4px}.atproto-embed--discussion .atproto-reply-thread[data-depth=\"0\"]{margin-top:0}.atproto-embed--discussion .atproto-load-more{display:flex;justify-content:center;padding:14px;border-top:2px solid var(--atproto-border-color)}.atproto-embed--discussion .atproto-load-more button{background:var(--atproto-load-more-bg);color:var(--atproto-load-more-color);border:1px solid var(--atproto-load-more-border-color);border-radius:100px;padding:8px 24px;font-size:13px;font-weight:600;font-family:var(--atproto-font-family);cursor:pointer;transition:background 0.15s,border-color 0.15s;white-space:nowrap}@media (hover:hover){.atproto-embed--discussion .atproto-load-more button:hover{background:#f0f5ff;border-color:#b0c8e8}}.atproto-embed--discussion .atproto-load-more button:disabled{opacity:0.5;cursor:default}.atproto-embed--discussion .atproto-discussion__empty{padding:36px 24px;text-align:center;color:var(--atproto-handle-color);font-size:14px}@media (max-width:768px){.atproto-embed--discussion .atproto-discussion__comments-title{font-size:var(--font-heading6)}}@media (max-width:480px){.atproto-embed--post .atproto-post,.atproto-embed--discussion .atproto-post{padding:12px}.atproto-embed--post .atproto-post__metrics-left,.atproto-embed--discussion .atproto-post__metrics-left{gap:12px}.atproto-embed--discussion .atproto-reply-children{margin-left:8px;padding-left:6px}.atproto-embed--discussion .atproto-liked-by__avatars{gap:4px}.atproto-embed--discussion .atproto-discussion__sort-bar{justify-content:flex-start}}";
    root.appendChild(style);
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
    window.AtProtoEmbed.refresh = function () {
      init(true);
    };
  }
})();
