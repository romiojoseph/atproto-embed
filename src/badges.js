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
    if (PROFILE_CACHE.has(actor)) return PROFILE_CACHE.get(actor);
    var url =
      API_BASE +
      "app.bsky.actor.getProfile?actor=" +
      encodeURIComponent(actor);
    var p = fetchJsonDedup(url, url, "Failed to fetch profile", signal)
      .then(function (data) {
        return data;
      })
      .catch(function () {
        PROFILE_CACHE.delete(actor);
        return null;
      });
    PROFILE_CACHE.set(actor, p);
    return p;
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
      if (src.indexOf("badges.js") !== -1) {
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

  function renderBadgeIcon(author, size) {
    var badge = detectBadge(author);
    if (!badge || !BADGE_ICONS[badge]) return null;
    var s = size || "14";
    return el("img", "atproto-badges__icon", {
      src: getIconUrl(BADGE_ICONS[badge]),
      alt: badge,
      width: s,
      height: s,
    });
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

  function parseStringAttr(container, name, defaultVal) {
    var val = container.getAttribute("data-" + name);
    return val !== null ? val : defaultVal;
  }

  function parseBoolAttr(container, name, defaultVal) {
    var val = container.getAttribute("data-" + name);
    if (val === null) return defaultVal;
    return val === "true" || val === "1" || val === "";
  }

  /* ───── Badge definitions ─────
   *
   * Each badge type is a self-contained renderer.
   * data-badges="follow,view,stats" controls which render and in what order.
   * Every badge can be individually toggled, styled, and relabelled.
   */

  var BADGE_TYPES = {
    /* ── 1. Follow button ── */
    "follow-button": {
      defaults: { label: null }, // null = computed at render time
      render: function (profile, config, opts) {
        var label = opts.label || ("Follow on " + config.clientName);
        var a = el("a", "atproto-badges__badge atproto-badges__badge--cta", {
          href: profileUrl(config, config._handle),
          target: config.linkTarget,
          rel: "noopener noreferrer",
        });
        if (config.showIcon) {
          a.appendChild(makeBlueskyIcon());
        }
        a.appendChild(el("span", "atproto-badges__label", { textContent: label }));
        return a;
      },
    },

    /* ── 2. View profile badge ── */
    "view-profile": {
      defaults: { label: null },
      render: function (profile, config, opts) {
        var a = el("a", "atproto-badges__badge atproto-badges__badge--view", {
          href: profileUrl(config, config._handle),
          target: config.linkTarget,
          rel: "noopener noreferrer",
        });
        if (config.showAvatar) {
          a.appendChild(
            el("img", "atproto-badges__avatar atproto-badges__avatar--" + config.avatarShape, {
              src: profile.avatar || getIconUrl("avatar-fallback"),
              alt: profile.displayName || config._handle || "Avatar",
              loading: "lazy",
            })
          );
        }
        var textWrap = el("span", "atproto-badges__text");
        if (config.showDisplayName) {
          textWrap.appendChild(
            el("span", "atproto-badges__name", {
              textContent: profile.displayName || config._handle || "Profile",
            })
          );
        }
        if (config.showHandle && config._handle) {
          textWrap.appendChild(
            el("span", "atproto-badges__sub", { textContent: "@" + config._handle })
          );
        }
        a.appendChild(textWrap);
        if (config.showVerification) {
          var icon = renderBadgeIcon(profile);
          if (icon) a.appendChild(icon);
        }
        return a;
      },
    },

    /* ── 3. Stats bar ── */
    "stats-bar": {
      defaults: {},
      render: function (profile, config) {
        var stats = el("div", "atproto-badges__badge atproto-badges__badge--stats");
        if (config.showPosts) stats.appendChild(renderStat(config.labelPosts || "Posts", profile.postsCount || 0));
        if (config.showFollowers) stats.appendChild(renderStat(config.labelFollowers || "Followers", profile.followersCount || 0));
        if (config.showFollowing) stats.appendChild(renderStat(config.labelFollowing || "Following", profile.followsCount || 0));
        if (stats.children.length === 0) return null;
        return stats;
      },
    },

    /* ── 4. Connect button ── */
    "connect-button": {
      defaults: { label: null },
      render: function (profile, config, opts) {
        var label = opts.label || ("Connect on " + config.clientName);
        var a = el("a", "atproto-badges__badge atproto-badges__badge--alt", {
          href: profileUrl(config, config._handle),
          target: config.linkTarget,
          rel: "noopener noreferrer",
        });
        if (config.showIcon) {
          a.appendChild(makeBlueskyIcon());
        }
        a.appendChild(el("span", "atproto-badges__label", { textContent: label }));
        return a;
      },
    },

    /* ── 5. Mention badge ── */
    "mention-badge": {
      defaults: { label: null },
      render: function (profile, config, opts) {
        var a = el("a", "atproto-badges__badge atproto-badges__badge--mention", {
          href: profileUrl(config, config._handle),
          target: config.linkTarget,
          rel: "noopener noreferrer",
        });
        if (config.showAvatar) {
          a.appendChild(
            el("img", "atproto-badges__avatar atproto-badges__avatar--" + config.avatarShape, {
              src: profile.avatar || getIconUrl("avatar-fallback"),
              alt: profile.displayName || config._handle || "Avatar",
              loading: "lazy",
            })
          );
        }
        var text = opts.label || ("@" + (config._handle || "handle"));
        a.appendChild(el("span", "atproto-badges__label", { textContent: text }));
        if (config.showVerification) {
          var icon = renderBadgeIcon(profile, "12");
          if (icon) a.appendChild(icon);
        }
        return a;
      },
    },

    /* ── 6. Social proof badge ── */
    "social-proof": {
      defaults: { label: null },
      render: function (profile, config, opts) {
        var wrapper = el("div", "atproto-badges__badge atproto-badges__badge--proof");
        if (config.showAvatar) {
          wrapper.appendChild(
            el("img", "atproto-badges__avatar atproto-badges__avatar--" + config.avatarShape, {
              src: profile.avatar || getIconUrl("avatar-fallback"),
              alt: profile.displayName || config._handle || "Avatar",
              loading: "lazy",
            })
          );
        }
        var info = el("span", "atproto-badges__proof-info");
        var name = profile.displayName || config._handle || "Profile";
        info.appendChild(el("span", "atproto-badges__name", { textContent: name }));
        var countLabel = opts.label || (formatCount(profile.followersCount || 0) + " followers");
        info.appendChild(el("span", "atproto-badges__sub", { textContent: countLabel }));
        wrapper.appendChild(info);
        if (config.showVerification) {
          var icon = renderBadgeIcon(profile);
          if (icon) wrapper.appendChild(icon);
        }
        return wrapper;
      },
    },

    /* ── 7. Mini card ── */
    "mini-card": {
      defaults: {},
      render: function (profile, config) {
        var card = el("a", "atproto-badges__badge atproto-badges__badge--minicard", {
          href: profileUrl(config, config._handle),
          target: config.linkTarget,
          rel: "noopener noreferrer",
        });
        if (config.showAvatar) {
          card.appendChild(
            el("img", "atproto-badges__avatar atproto-badges__avatar--" + config.avatarShape, {
              src: profile.avatar || getIconUrl("avatar-fallback"),
              alt: profile.displayName || config._handle || "Avatar",
              loading: "lazy",
            })
          );
        }
        var body = el("span", "atproto-badges__minicard-body");
        if (config.showDisplayName) {
          var nameRow = el("span", "atproto-badges__minicard-namerow");
          nameRow.appendChild(el("span", "atproto-badges__name", {
            textContent: profile.displayName || config._handle || "Profile",
          }));
          if (config.showVerification) {
            var icon = renderBadgeIcon(profile, "12");
            if (icon) nameRow.appendChild(icon);
          }
          body.appendChild(nameRow);
        }
        if (config.showHandle && config._handle) {
          body.appendChild(el("span", "atproto-badges__sub", { textContent: "@" + config._handle }));
        }
        var miniStats = el("span", "atproto-badges__minicard-stats");
        if (config.showFollowers) {
          miniStats.appendChild(el("span", null, {
            textContent: formatCount(profile.followersCount || 0) + " " + (config.labelFollowers || "followers"),
          }));
        }
        if (config.showPosts) {
          miniStats.appendChild(el("span", null, {
            textContent: formatCount(profile.postsCount || 0) + " " + (config.labelPosts || "posts").toLowerCase(),
          }));
        }
        if (miniStats.children.length) body.appendChild(miniStats);
        card.appendChild(body);
        return card;
      },
    },

    /* ── 8. Handle chip ── */
    "handle-chip": {
      defaults: { label: null },
      render: function (profile, config, opts) {
        var a = el("a", "atproto-badges__badge atproto-badges__badge--chip", {
          href: profileUrl(config, config._handle),
          target: config.linkTarget,
          rel: "noopener noreferrer",
        });
        if (config.showIcon) {
          a.appendChild(makeBlueskyIcon());
        }
        var text = opts.label || ("@" + (config._handle || "handle"));
        a.appendChild(el("span", "atproto-badges__label", { textContent: text }));
        return a;
      },
    },
  };

  /* ───── Inline Bluesky butterfly icon (tiny SVG) ───── */

  function makeBlueskyIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 568 501");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("class", "atproto-badges__bsky-icon");
    svg.innerHTML = '<path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32c-119.86 122.992-172.272-30.859-185.702-70.281-2.462-7.227-3.614-10.608-3.631-7.733-.017-2.875-1.169.506-3.631 7.733-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.89-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C10.023 203.659.078 75.291.078 57.946.078-28.906 76.243-1.61 123.121 33.664Z"/>';
    return svg;
  }

  function renderStat(label, value) {
    var stat = el("span", "atproto-badges__stat");
    stat.appendChild(
      el("span", "atproto-badges__stat-value", { textContent: formatCount(value) })
    );
    stat.appendChild(
      el("span", "atproto-badges__stat-label", { textContent: label })
    );
    return stat;
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

  function parseConfig(container) {
    var config = {
      // Badge selection & order
      badges: null, // null = legacy mode (follow,view,stats,connect)

      // Global visibility toggles
      showFollow: true,
      showView: true,
      showStats: true,
      showConnect: true,
      showFollowers: true,
      showFollowing: true,
      showPosts: true,
      showVerification: true,
      showHandle: true,
      showAvatar: true,
      showDisplayName: true,
      showBorder: true,
      showIcon: false,

      // Appearance
      variant: "solid",
      size: "md",
      radius: "pill",
      layout: "inline",
      avatarShape: "circle",
      hoverEffect: "lift",  // lift | glow | none
      linkTarget: "_blank",

      // Client
      clientBase: null,
      clientDomain: null,
      clientName: "Bluesky",

      // Label overrides
      labelFollow: null,
      labelConnect: null,
      labelPosts: null,
      labelFollowers: null,
      labelFollowing: null,

      // Overrides
      overrides: {},

      // Style vars
      styleVars: {},

      // Resolved handle (set during render)
      _handle: "",
    };

    config.showFollow = parseBoolAttr(container, "show-follow", config.showFollow);
    config.showView = parseBoolAttr(container, "show-view", config.showView);
    config.showStats = parseBoolAttr(container, "show-stats", config.showStats);
    config.showConnect = parseBoolAttr(container, "show-connect", config.showConnect);
    config.showFollowers = parseBoolAttr(container, "show-followers", config.showFollowers);
    config.showFollowing = parseBoolAttr(container, "show-following", config.showFollowing);
    config.showPosts = parseBoolAttr(container, "show-posts", config.showPosts);
    config.showVerification = parseBoolAttr(container, "show-verification", config.showVerification);
    config.showHandle = parseBoolAttr(container, "show-handle", config.showHandle);
    config.showAvatar = parseBoolAttr(container, "show-avatar", config.showAvatar);
    config.showDisplayName = parseBoolAttr(container, "show-display-name", config.showDisplayName);
    config.showBorder = parseBoolAttr(container, "show-border", config.showBorder);
    config.showIcon = parseBoolAttr(container, "show-icon", config.showIcon);

    config.variant = parseStringAttr(container, "variant", config.variant);
    config.size = parseStringAttr(container, "size", config.size);
    config.radius = parseStringAttr(container, "radius", config.radius);
    config.layout = parseStringAttr(container, "layout", config.layout);
    config.avatarShape = parseStringAttr(container, "avatar-shape", config.avatarShape);
    config.hoverEffect = parseStringAttr(container, "hover-effect", config.hoverEffect);
    config.linkTarget = parseStringAttr(container, "link-target", config.linkTarget);

    config.clientBase = parseStringAttr(container, "client-base", null);
    config.clientDomain = parseStringAttr(container, "client-domain", null);
    config.clientName = parseStringAttr(container, "client-name", config.clientName);

    config.labelFollow = parseStringAttr(container, "label-follow", null);
    config.labelConnect = parseStringAttr(container, "label-connect", null);
    config.labelPosts = parseStringAttr(container, "label-posts", null);
    config.labelFollowers = parseStringAttr(container, "label-followers", null);
    config.labelFollowing = parseStringAttr(container, "label-following", null);

    config.overrides.handle = parseStringAttr(container, "handle", null);

    // data-badges="follow-button,view-profile,stats-bar"
    var badgesAttr = parseStringAttr(container, "badges", null);
    if (badgesAttr !== null) {
      config.badges = badgesAttr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }

    // Style overrides - extensive set
    var styleKeys = [
      "bg", "text", "border", "radius", "padding", "gap", "font",
      "cta-bg", "cta-text", "cta-border",
      "alt-bg", "alt-text", "alt-border",
      "stats-bg", "stats-text",
      "avatar-size", "avatar-border",
      "font-size", "font-weight",
      "hover-shadow", "hover-translate",
    ];
    for (var i = 0; i < styleKeys.length; i++) {
      var key = styleKeys[i];
      config.styleVars[key] = parseStringAttr(container, "style-" + key, null);
    }

    return config;
  }

  function applyStyleVars(container, config) {
    if (!config || !config.styleVars) return;
    var v = config.styleVars;
    var prefix = "--atproto-badge-";
    for (var key in v) {
      if (v[key]) {
        container.style.setProperty(prefix + key, v[key]);
      }
    }
  }

  function resolveOverride(val, fallback) {
    if (val === null || val === undefined || val === "") return fallback;
    return val;
  }

  /* ───── Main render ───── */

  function renderBadges(profile, config, container) {
    if (!profile) return null;

    config._handle = resolveOverride(config.overrides.handle, profile.handle || "");

    var wrap = el(
      "div",
      "atproto-badges" +
      " atproto-badges--" + config.variant +
      " atproto-badges--" + config.size +
      " atproto-badges--" + config.radius +
      " atproto-badges--" + config.layout +
      " atproto-badges--hover-" + config.hoverEffect
    );
    if (config.showBorder === false) {
      wrap.classList.add("atproto-badges--no-border");
    }

    var badgeList;
    if (config.badges && config.badges.length) {
      // Explicit badge selection mode
      badgeList = config.badges;
    } else {
      // Legacy mode — backwards compatible
      badgeList = [];
      if (config.showFollow) badgeList.push("follow-button");
      if (config.showView) badgeList.push("view-profile");
      if (config.showStats) badgeList.push("stats-bar");
      if (config.showConnect) badgeList.push("connect-button");
    }

    for (var i = 0; i < badgeList.length; i++) {
      var typeName = badgeList[i];
      var def = BADGE_TYPES[typeName];
      if (!def) continue;

      var opts = {};
      if (def.defaults) {
        for (var dk in def.defaults) {
          opts[dk] = def.defaults[dk];
        }
      }

      // Per-badge label override: data-label-follow-button="My Text"
      var perBadgeLabel = container
        ? parseStringAttr(container, "label-" + typeName, null)
        : null;
      // Fallback to config-level labels for legacy badge types
      if (!perBadgeLabel) {
        if (typeName === "follow-button" && config.labelFollow) perBadgeLabel = config.labelFollow;
        if (typeName === "connect-button" && config.labelConnect) perBadgeLabel = config.labelConnect;
      }
      if (perBadgeLabel) opts.label = perBadgeLabel;

      var rendered = def.render(profile, config, opts);
      if (rendered) wrap.appendChild(rendered);
    }

    return wrap;
  }

  /* ───── CSS injection ───── */

  function injectStyles(root) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = getBasePath() + "badges.css";
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
    applyStyleVars(container, config);

    container.classList.add("atproto-badges-host");

    var shadow = container.shadowRoot;
    if (!shadow) {
      shadow = container.attachShadow({ mode: "open" });
    } else {
      shadow.innerHTML = "";
    }

    injectStyles(shadow);

    var wrapper = el("div", "atproto-badges-inner");
    shadow.appendChild(wrapper);
    wrapper.appendChild(
      el("div", "atproto-badges--loading", { textContent: "Loading badges…" })
    );

    try {
      var profile = await fetchProfile(actor, controller.signal);
      if (!profile) throw new Error("Profile not found");
      var badges = renderBadges(profile, config, container);
      wrapper.innerHTML = "";
      if (badges) wrapper.appendChild(badges);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      wrapper.innerHTML = "";
      wrapper.appendChild(
        el("div", "atproto-badges--error", {
          textContent: "Failed to load badges",
        })
      );
      console.error("[atproto-badges]", err);
    }
  }

  function init(force) {
    var containers = document.querySelectorAll(
      ".atproto-badges:not([data-badges-child])"
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
    window.AtProtoBadges = window.AtProtoBadges || {};
    window.AtProtoBadges.refresh = function () {
      init(true);
    };
  }
})();
