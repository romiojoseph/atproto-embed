(function () {
  "use strict";

  var API_BASE = "https://public.api.bsky.app/xrpc/";
  var HANDLE_CACHE = new Map();
  var PROFILE_CACHE = new Map();
  var INFLIGHT = new Map();
  var CONTAINER_ABORTS = new WeakMap();
  var SIGNAL_IDS = new WeakMap();
  var NEXT_SIGNAL_ID = 1;

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
    var p = fetchJsonOrThrow(url, errMsg, signal).finally(function () {
      INFLIGHT.delete(inflightKey);
    });
    INFLIGHT.set(inflightKey, p);
    return p;
  }

  function resolveHandle(handle) {
    if (!handle) return Promise.resolve(null);
    if (handle.startsWith("did:")) return Promise.resolve(handle);
    if (HANDLE_CACHE.has(handle)) return HANDLE_CACHE.get(handle);
    var url =
      API_BASE +
      "com.atproto.identity.resolveHandle?handle=" +
      encodeURIComponent(handle);
    var p = fetchJsonDedup(url, url, "Handle resolution failed", null)
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

  function fetchProfile(actor, signal) {
    if (!actor) return Promise.resolve(null);
    if (PROFILE_CACHE.has(actor)) {
      return Promise.resolve(PROFILE_CACHE.get(actor));
    }
    var url =
      API_BASE +
      "app.bsky.actor.getProfile?actor=" +
      encodeURIComponent(actor);
    return fetchJsonDedup("profile:" + actor, url, "Failed to fetch profile", signal)
      .then(function (data) {
        PROFILE_CACHE.set(actor, data);
        return data;
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") throw err;
        return null;
      });
  }

  function el(tag, className, attrs) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (attrs) {
      for (var k in attrs) {
        if (k === "textContent") e.textContent = attrs[k];
        else if (k === "innerHTML") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function formatCount(n) {
    if (n >= 1000000)
      return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  /* ───── Icons ───── */

  function getBasePath() {
    var scripts = document.querySelectorAll("script[src]");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src;
      if (src.indexOf("members.js") !== -1) {
        return src.substring(0, src.lastIndexOf("/") + 1);
      }
    }
    return "./";
  }

  function getIconUrl(name) {
    return getBasePath() + "../public/" + name + ".svg";
  }

  var BADGE_ICONS = {
    crown: "original-seal",
    seal: "trusted-seal",
    check: "check-circle",
  };

  function detectBadge(author) {
    var v = (author && author.verification) || {};
    if (v.trustedVerifierStatus === "valid") {
      return author && author.handle === "bsky.app" ? "crown" : "seal";
    }
    if (v.verifiedStatus === "valid") return "check";
    return null;
  }

  function renderBadgeIcon(author) {
    var badge = detectBadge(author);
    if (!badge || !BADGE_ICONS[badge]) return null;
    return el("img", "atproto-members__badge", {
      src: getIconUrl(BADGE_ICONS[badge]),
      alt: badge,
      width: "14",
      height: "14",
    });
  }

  /* ───── List Parsing ───── */

  function parseListInput(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (raw.startsWith("at://")) return { atUri: raw };
    var m = raw.match(/https?:\/\/([^/]+)\/profile\/([^/]+)\/lists\/([a-zA-Z0-9]+)/);
    if (!m) return null;
    return { handle: m[2], rkey: m[3] };
  }

  async function resolveListUri(raw) {
    var parsed = parseListInput(raw);
    if (!parsed) throw new Error("Invalid list");
    if (parsed.atUri) return parsed.atUri;
    var did = await resolveHandle(parsed.handle);
    return "at://" + did + "/app.bsky.graph.list/" + parsed.rkey;
  }

  async function fetchList(atUri, limit, signal) {
    var url =
      API_BASE +
      "app.bsky.graph.getList?list=" +
      encodeURIComponent(atUri);
    if (limit) url += "&limit=" + encodeURIComponent(String(limit));
    return fetchJsonDedup(url, url, "Failed to fetch list", signal);
  }

  /* ───── Config ───── */

  function parseBoolAttr(container, name, defaultVal) {
    var val = container.getAttribute("data-" + name);
    if (val === null) return defaultVal;
    return val === "true" || val === "1" || val === "";
  }

  function parseStringAttr(container, name, defaultVal) {
    var val = container.getAttribute("data-" + name);
    return val !== null ? val : defaultVal;
  }

  function parseConfig(container) {
    var config = {
      showAvatar: true,
      showDisplayName: true,
      showHandle: true,
      showVerification: true,
      showMetrics: true,
      showFollowers: true,
      showFollowing: true,
      showButton: true,
      buttonStyle: "filled",
      buttonLabel: "View more",
      listUrl: null,
      clientBase: null,
      clientDomain: null,
      columns: "3",
      limit: 16,
      width: null,
      maxWidth: null,
    };

    config.showAvatar = parseBoolAttr(container, "show-avatar", config.showAvatar);
    config.showDisplayName = parseBoolAttr(container, "show-display-name", config.showDisplayName);
    config.showHandle = parseBoolAttr(container, "show-handle", config.showHandle);
    config.showVerification = parseBoolAttr(container, "show-verification", config.showVerification);
    config.showMetrics = parseBoolAttr(container, "show-metrics", config.showMetrics);
    config.showFollowers = parseBoolAttr(container, "show-followers", config.showFollowers);
    config.showFollowing = parseBoolAttr(container, "show-following", config.showFollowing);
    config.showPosts = parseBoolAttr(container, "show-posts", config.showPosts);
    config.showButton = parseBoolAttr(container, "show-button", config.showButton);

    config.columns = parseStringAttr(container, "columns", config.columns);
    if (config.columns === "true") config.columns = "2";
    if (config.columns === "false") config.columns = "3";

    var lim = parseInt(parseStringAttr(container, "limit", ""), 10);
    if (isFinite(lim) && lim > 0) config.limit = lim;

    config.width = parseStringAttr(container, "width", config.width);
    config.maxWidth = parseStringAttr(container, "max-width", config.maxWidth);
    config.buttonStyle = parseStringAttr(container, "button-style", config.buttonStyle);
    config.buttonLabel = parseStringAttr(container, "button-label", config.buttonLabel);
    config.listUrl = parseStringAttr(container, "list-url", config.listUrl);
    config.clientBase = parseStringAttr(container, "client-base", config.clientBase);
    config.clientDomain = parseStringAttr(container, "client-domain", config.clientDomain);

    return config;
  }

  function applyLayoutVars(container, config) {
    if (!config) return;
    if (config.columns) container.style.setProperty("--atproto-columns", config.columns);
    if (config.width) container.style.setProperty("--atproto-width", config.width);
    if (config.maxWidth) container.style.setProperty("--atproto-max-width", config.maxWidth);
  }

  function extractClientDomain(raw) {
    if (!raw || raw.indexOf("http") !== 0) return null;
    try {
      return new URL(raw).hostname;
    } catch (_) {
      return null;
    }
  }

  function clientBase(config) {
    if (config.clientBase) {
      if (config.clientBase.indexOf("http") === 0) return config.clientBase;
      return "https://" + config.clientBase;
    }
    if (config.clientDomain) return "https://" + config.clientDomain;
    return "https://bsky.app";
  }

  function profileUrl(config, handleOrDid) {
    return clientBase(config) + "/profile/" + handleOrDid;
  }

  function listUrlFromAtUri(atUri, config) {
    if (!atUri || atUri.indexOf("at://") !== 0) return null;
    var m = atUri.match(/^at:\/\/([^/]+)\/app\.bsky\.graph\.list\/([^/]+)$/);
    if (!m) return null;
    return clientBase(config) + "/profile/" + m[1] + "/lists/" + m[2];
  }

  function renderMemberCard(profile, config) {
    if (!profile) return null;
    var card = el("div", "atproto-members__card");

    if (config.showAvatar !== false) {
      card.appendChild(
        el("img", "atproto-members__avatar", {
          src: profile.avatar || getIconUrl("avatar-fallback"),
          alt: profile.displayName || profile.handle || "Avatar",
          loading: "lazy",
        })
      );
    }

    var meta = el("div", "atproto-members__meta");
    if (config.showDisplayName !== false) {
      var nameRow = el("div", "atproto-members__name-row");
      nameRow.appendChild(
        el("span", "atproto-members__name", {
          textContent: profile.displayName || profile.handle || "Member",
        })
      );
      if (config.showVerification !== false) {
        var badge = renderBadgeIcon(profile);
        if (badge) nameRow.appendChild(badge);
      }
      meta.appendChild(nameRow);
    }
    if (config.showHandle !== false && profile.handle) {
      meta.appendChild(
        el("div", "atproto-members__handle", {
          textContent:
            profile.handle.charAt(0) === "@"
              ? profile.handle
              : "@" + profile.handle,
        })
      );
    }

    if (config.showMetrics !== false) {
      var metrics = el("div", "atproto-members__metrics");
      if (config.showPosts !== false) {
        metrics.appendChild(
          el("span", "atproto-members__metric", {
            textContent: formatCount(profile.postsCount || 0) + " posts",
          })
        );
      }
      if (config.showFollowers !== false) {
        metrics.appendChild(
          el("span", "atproto-members__metric", {
            textContent: formatCount(profile.followersCount || 0) + " followers",
          })
        );
      }
      if (config.showFollowing !== false) {
        metrics.appendChild(
          el("span", "atproto-members__metric", {
            textContent: formatCount(profile.followsCount || 0) + " following",
          })
        );
      }
      meta.appendChild(metrics);
    }

    if (config.showAvatar !== false) {
      var onlyAvatar =
        config.showDisplayName === false &&
        (config.showHandle === false || !profile.handle) &&
        config.showMetrics === false;
      if (onlyAvatar) {
        card.classList.add("atproto-members__card--avatar-only");
      }
    }

    card.appendChild(meta);

    var handle = profile.handle || profile.did;
    if (!handle) return card;
    var link = el("a", "atproto-members__card-link", {
      href: profileUrl(config, handle),
      target: "_blank",
      rel: "noopener noreferrer",
    });
    link.appendChild(card);
    return link;
  }

  function renderMembers(listData, config, listLink) {
    var wrapper = el("div", "atproto-members__wrap");
    var grid = el("div", "atproto-members__grid");
    var items = (listData && listData.items) || [];
    if (!items.length) {
      return el("div", "atproto-members__empty", {
        textContent: "No members found",
      });
    }
    var avatarOnly =
      config.showAvatar !== false &&
      config.showDisplayName === false &&
      config.showHandle === false &&
      config.showMetrics === false;
    if (avatarOnly) {
      grid.classList.add("atproto-members__grid--avatar-only");
    }
    if (items.length === 1) {
      grid.style.gridTemplateColumns = "1fr";
    } else if (items.length === 2) {
      grid.style.gridTemplateColumns = "1fr 1fr";
    }
    items.forEach(function (item) {
      var subject = item.subject || item.profile || item;
      if (!subject) return;
      grid.appendChild(renderMemberCard(subject, config));
    });
    wrapper.appendChild(grid);

    if (config.showButton !== false && listLink) {
      var row = el("div", "atproto-members__button-row");
      var btnClass = "atproto-members__button";
      if (config.buttonStyle === "outline") {
        btnClass += " atproto-members__button--outline";
      } else {
        btnClass += " atproto-members__button--filled";
      }
      row.appendChild(
        el("a", btnClass, {
          href: listLink,
          target: "_blank",
          rel: "noopener noreferrer",
          textContent: config.buttonLabel || "View more",
        })
      );
      wrapper.appendChild(row);
    }

    return wrapper;
  }

  /* ───── CSS injection ───── */

  function injectStyles(root) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = getBasePath() + "members.css";
    root.appendChild(link);
  }

  function ensureFontLoaded() {
    if (typeof document === "undefined") return;
    if (document.getElementById("atproto-font-google-sans")) return;
    var link = document.createElement("link");
    link.id = "atproto-font-google-sans";
    link.setAttribute("rel", "stylesheet");
    link.href =
      "https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap";
    document.head.appendChild(link);
  }

  /* ───── Init ───── */

  async function initContainer(container) {
    var raw = container.getAttribute("data-list");
    if (!raw) return;

    var previous = CONTAINER_ABORTS.get(container);
    if (previous) previous.abort();
    var controller = new AbortController();
    CONTAINER_ABORTS.set(container, controller);

    var config = parseConfig(container);
    if (!config.clientDomain) {
      var inferred = extractClientDomain(raw);
      if (inferred) config.clientDomain = inferred;
    }
    applyLayoutVars(container, config);

    container.classList.add("atproto-members-host");

    var shadow = container.shadowRoot;
    if (!shadow) {
      shadow = container.attachShadow({ mode: "open" });
    } else {
      shadow.innerHTML = "";
    }

    ensureFontLoaded();
    injectStyles(shadow);

    var wrapper = el("div", "atproto-members-inner");
    shadow.appendChild(wrapper);
    wrapper.appendChild(
      el("div", "atproto-members--loading", { textContent: "Loading members…" })
    );

    try {
      var listUri = await resolveListUri(raw);
      var listData = await fetchList(listUri, config.limit, controller.signal);
      if (config.showMetrics !== false) {
        var items = (listData && listData.items) || [];
        var enrich = items.map(function (item) {
          var subject = item.subject || item.profile || item;
          if (!subject || !subject.did) return Promise.resolve(null);
          return fetchProfile(subject.did, controller.signal).then(function (p) {
            if (p) item.subject = p;
            return p;
          });
        });
        await Promise.all(enrich);
      }
      wrapper.innerHTML = "";
      var listLink = null;
      if (raw && raw.indexOf("http") === 0) listLink = raw;
      if (!listLink && config.listUrl) listLink = config.listUrl;
      if (!listLink && listUri) listLink = listUrlFromAtUri(listUri, config);
      wrapper.appendChild(renderMembers(listData, config, listLink));
    } catch (err) {
      if (err && err.name === "AbortError") return;
      wrapper.innerHTML = "";
      wrapper.appendChild(
        el("div", "atproto-members--error", {
          textContent: "Failed to load members",
        })
      );
      console.error("[atproto-members]", err);
    }
  }

  function init(force) {
    var containers = document.querySelectorAll(
      ".atproto-members:not([data-members-child])"
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
    window.AtProtoMembers = window.AtProtoMembers || {};
    window.AtProtoMembers.init = function (force) {
      init(!!force);
    };
    window.AtProtoMembers.refresh = function () {
      init(true);
    };
  }
})();
