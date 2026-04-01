(function () {
  "use strict";

  var API_BASE = "https://public.api.bsky.app/xrpc/";
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

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function linkifyDescription(text, config) {
    if (!text) return "";
    var input = String(text);
    var out = "";
    var lastIndex = 0;
    var re = /https?:\/\/[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|@[A-Z0-9._-]+|#[A-Z0-9_]+/gi;
    var m;
    while ((m = re.exec(input)) !== null) {
      var start = m.index;
      var match = m[0];
      if (start > lastIndex) {
        out += escapeHtml(input.slice(lastIndex, start));
      }
      if (match[0] === "@") {
        var handle = match.slice(1);
        var url = profileUrl(config, handle);
        out +=
          '<a class="atproto-profile__link" href="' +
          escapeHtml(url) +
          '" target="_blank" rel="noopener noreferrer">@' +
          escapeHtml(handle) +
          "</a>";
      } else if (match[0] === "#") {
        var tag = match.slice(1);
        var tagUrl = clientBase(config) + "/hashtag/" + encodeURIComponent(tag);
        out +=
          '<a class="atproto-profile__link" href="' +
          escapeHtml(tagUrl) +
          '" target="_blank" rel="noopener noreferrer">#' +
          escapeHtml(tag) +
          "</a>";
      } else if (match.indexOf("://") !== -1) {
        out +=
          '<a class="atproto-profile__link" href="' +
          escapeHtml(match) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(match) +
          "</a>";
      } else if (match.indexOf("@") !== -1) {
        out +=
          '<a class="atproto-profile__link" href="mailto:' +
          escapeHtml(match) +
          '">' +
          escapeHtml(match) +
          "</a>";
      } else {
        out += escapeHtml(match);
      }
      lastIndex = start + match.length;
    }
    if (lastIndex < input.length) {
      out += escapeHtml(input.slice(lastIndex));
    }
    return out;
  }

  /* ───── Icons ───── */

  function getBasePath() {
    var scripts = document.querySelectorAll("script[src]");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src;
      if (src.indexOf("profile.js") !== -1) {
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

  function renderBadge(author) {
    var badge = detectBadge(author);
    if (!badge || !BADGE_ICONS[badge]) return null;
    var img = el("img", "atproto-profile__badge", {
      src: getIconUrl(BADGE_ICONS[badge]),
      alt: badge,
      width: "16",
      height: "16",
    });
    return img;
  }

  /* ───── Config ───── */

  function parseActor(container) {
    var direct = container.getAttribute("data-profile");
    var handle = container.getAttribute("data-handle");
    var did = container.getAttribute("data-did");
    var raw = did || handle || direct;
    if (!raw) return null;
    raw = raw.trim();
    if (raw.indexOf("://") !== -1) {
      var m = raw.match(/profile\/([^/?#]+)/);
      if (m && m[1]) return m[1];
    }
    return raw;
  }

  function parseConfig(container) {
    function parseAttr(c, name, defaultVal) {
      var val = c.getAttribute("data-" + name);
      if (val === null) return defaultVal;
      return val === "true" || val === "1" || val === "";
    }

    function parseStringAttr(c, name, defaultVal) {
      var val = c.getAttribute("data-" + name);
      return val !== null ? val : defaultVal;
    }

    var config = {
      showAvatar: parseAttr(container, "show-avatar", true),
      showDisplayName: parseAttr(container, "show-display-name", true),
      showHandle: parseAttr(container, "show-handle", true),
      showVerification: parseAttr(container, "show-verification", true),
      showDescription: parseAttr(container, "show-description", true),
      showCover: parseAttr(container, "show-cover", true),
      showMetrics: parseAttr(container, "show-metrics", true),
      showFollowers: parseAttr(container, "show-followers", true),
      showFollowing: parseAttr(container, "show-following", true),
      showPosts: parseAttr(container, "show-posts", true),
      showFollow: parseAttr(container, "show-follow", false),
      showConnect: parseAttr(container, "show-connect", false),
      labelFollow: parseStringAttr(container, "label-follow", null),
      labelConnect: parseStringAttr(container, "label-connect", null),
      size: parseStringAttr(container, "size", "full"),
      clientBase: parseStringAttr(container, "client-base", null),
      clientDomain: parseStringAttr(container, "client-domain", null),
      clientName: parseStringAttr(container, "client-name", "Bluesky"),
      width: parseStringAttr(container, "width", null),
      maxWidth: parseStringAttr(container, "max-width", null),
    };

    return config;
  }

  function clientBase(config) {
    if (config.clientBase) {
      if (config.clientBase.indexOf("http") === 0) return config.clientBase;
      return "https://" + config.clientBase;
    }
    if (config.clientDomain) return "https://" + config.clientDomain;
    return "https://bsky.app";
  }

  function profileUrl(config, handle) {
    return clientBase(config) + "/profile/" + handle;
  }

  function renderProfileCard(profile, config) {
    if (!profile) return null;

    var avatar = profile.avatar;
    var displayName = profile.displayName || "";
    var handle = profile.handle || "";
    var description = profile.description || "";
    var cover = profile.banner || "";
    var followersCount = profile.followersCount || 0;
    var followingCount = profile.followsCount || 0;
    var postsCount = profile.postsCount || 0;

    var card = el("div", "atproto-profile-card");
    if (config.size) card.classList.add("atproto-profile-card--size-" + config.size);

    if (config.showCover !== false && cover) {
      var coverWrap = el("div", "atproto-profile__cover");
      coverWrap.appendChild(
        el("img", null, {
          src: cover,
          alt: displayName || handle || "Profile cover",
          loading: "lazy",
        })
      );
      card.appendChild(coverWrap);
    } else {
      card.classList.add("atproto-profile-card--no-cover");
    }

    var body = el("div", "atproto-profile__body");
    var header = el("div", "atproto-profile__header");

    if (config.showAvatar !== false) {
      var avatarWrap = el("div", "atproto-profile__avatar-wrap");
      avatarWrap.appendChild(
        el("img", "atproto-profile__avatar", {
          src: avatar || getIconUrl("avatar-fallback"),
          alt: displayName || handle || "Avatar",
          loading: "lazy",
        })
      );
      header.appendChild(avatarWrap);
    }

    var identity = el("div", "atproto-profile__identity");
    if (config.showDisplayName !== false) {
      var nameRow = el("div", "atproto-profile__name-row");
      var nameText = el("div", "atproto-profile__name", {
        textContent: displayName || handle || "Profile",
      });
      nameRow.appendChild(nameText);
      if (config.showVerification !== false) {
        var badge = renderBadge(profile);
        if (badge) nameRow.appendChild(badge);
      }
      identity.appendChild(nameRow);
    }

    if (config.showHandle !== false && handle) {
      var handleText = handle.charAt(0) === "@" ? handle : "@" + handle;
      identity.appendChild(
        el("div", "atproto-profile__handle", { textContent: handleText })
      );
    }

    header.appendChild(identity);
    body.appendChild(header);

    if (config.showDescription !== false && description) {
      var desc = el("div", "atproto-profile__description");
      desc.innerHTML = linkifyDescription(description, config);
      body.appendChild(desc);
    }

    if (config.showMetrics !== false) {
      var metrics = el("div", "atproto-profile__metrics");

      if (config.showFollowers !== false) {
        var m1 = el("div", "atproto-profile__metric");
        m1.appendChild(
          el("div", "atproto-profile__metric-count", {
            textContent: formatCount(followersCount),
          })
        );
        m1.appendChild(
          el("div", "atproto-profile__metric-label", {
            textContent: "Followers",
          })
        );
        metrics.appendChild(m1);
      }

      if (config.showFollowing !== false) {
        var m2 = el("div", "atproto-profile__metric");
        m2.appendChild(
          el("div", "atproto-profile__metric-count", {
            textContent: formatCount(followingCount),
          })
        );
        m2.appendChild(
          el("div", "atproto-profile__metric-label", {
            textContent: "Following",
          })
        );
        metrics.appendChild(m2);
      }

      if (config.showPosts !== false) {
        var m3 = el("div", "atproto-profile__metric");
        m3.appendChild(
          el("div", "atproto-profile__metric-count", {
            textContent: formatCount(postsCount),
          })
        );
        m3.appendChild(
          el("div", "atproto-profile__metric-label", {
            textContent: "Posts",
          })
        );
        metrics.appendChild(m3);
      }

      if (metrics.children.length) {
        body.appendChild(metrics);
      }
    }

    // Actions
    if (config.showFollow || config.showConnect) {
      var actions = el("div", "atproto-profile__actions");
      if (config.showFollow) {
        var label = config.labelFollow || ("Follow on " + config.clientName);
        actions.appendChild(
          el("a", "atproto-profile__btn atproto-profile__btn--primary", {
            href: profileUrl(config, handle),
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: label,
          })
        );
      }
      if (config.showConnect) {
        var label = config.labelConnect || ("Connect on " + config.clientName);
        actions.appendChild(
          el("a", "atproto-profile__btn atproto-profile__btn--secondary", {
            href: profileUrl(config, handle),
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: label,
          })
        );
      }
      body.appendChild(actions);
    }

    card.appendChild(body);
    return card;
  }

  /* ───── CSS injection ───── */

  function injectStyles(root) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = getBasePath() + "profile.css";
    root.appendChild(link);
  }

  /* ───── Init ───── */

  async function initContainer(container) {
    var actor = parseActor(container);
    if (!actor) return;

    var previous = CONTAINER_ABORTS.get(container);
    if (previous) previous.abort();
    var controller = new AbortController();
    CONTAINER_ABORTS.set(container, controller);

    var config = parseConfig(container);
    container.classList.add("atproto-profile-host");

    if (config.width) container.style.setProperty("--atproto-width", config.width);
    if (config.maxWidth) container.style.setProperty("--atproto-max-width", config.maxWidth);

    var shadow = container.shadowRoot;
    if (!shadow) {
      shadow = container.attachShadow({ mode: "open" });
    } else {
      shadow.innerHTML = "";
    }

    injectStyles(shadow);

    var wrapper = el("div", "atproto-profile-inner");
    shadow.appendChild(wrapper);

    wrapper.appendChild(
      el("div", "atproto-profile--loading", { textContent: "Loading profile…" })
    );

    try {
      var profile = await fetchProfile(actor, controller.signal);
      if (!profile) throw new Error("Profile not found");
      var card = renderProfileCard(profile, config);
      wrapper.innerHTML = "";
      if (card) wrapper.appendChild(card);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      wrapper.innerHTML = "";
      wrapper.appendChild(
        el("div", "atproto-profile--error", {
          textContent: "Failed to load profile",
        })
      );
      console.error("[atproto-profile]", err);
    }
  }

  function init(force) {
    var containers = document.querySelectorAll(
      ".atproto-profile:not([data-profile-child])"
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
    window.AtProtoProfile = window.AtProtoProfile || {};
    window.AtProtoProfile.init = function (force) {
      init(!!force);
    };
    window.AtProtoProfile.refresh = function () {
      init(true);
    };
  }
})();
