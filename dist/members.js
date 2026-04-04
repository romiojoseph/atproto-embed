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

    var ICONS = {
    "avatar-fallback": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22none%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22%23e0e0e0%22%20rx%3D%2224%22%2F%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M32%2020a8%208%200%201%201-16%200%208%208%200%200%201%2016%200%22%20opacity%3D%22.2%22%2F%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M36.865%2034.5c-1.904-3.291-4.838-5.651-8.261-6.77a9%209%200%201%200-9.208%200c-3.424%201.117-6.357%203.477-8.261%206.77a.997.997%200%200%200%20.352%201.389%201%201%200%200%200%201.38-.389C15.22%2031.43%2019.383%2029%2024%2029s8.779%202.43%2011.134%206.5a1.001%201.001%200%201%200%201.73-1M17%2020a7%207%200%201%201%207%207%207.007%207.007%200%200%201-7-7%22%2F%3E%3C%2Fsvg%3E",
    "check-circle": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M16%203a13%2013%200%201%200%2013%2013A13.013%2013.013%200%200%200%2016%203m5.708%2010.708-7%207a1%201%200%200%201-1.415%200l-3-3a1%201%200%200%201%201.415-1.415L14%2018.586l6.293-6.293a1%201%200%200%201%201.415%201.415%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%223%22%20x2%3D%2229%22%20y1%3D%223%22%20y2%3D%2229%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23006aff%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23004099%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "original-seal": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M28.233%2012.853c-.472-.493-.96-1-1.143-1.447-.17-.409-.18-1.086-.19-1.742-.019-1.22-.039-2.603-1-3.564s-2.344-.981-3.564-1c-.656-.01-1.333-.02-1.742-.19-.445-.184-.954-.671-1.447-1.142C18.286%202.938%2017.306%202%2016%202s-2.284.939-3.148%201.768c-.492.47-1%20.958-1.446%201.142-.406.17-1.086.18-1.742.19-1.22.019-2.603.039-3.564%201s-.975%202.344-1%203.564c-.01.656-.02%201.334-.19%201.742-.184.445-.671.954-1.142%201.446C2.938%2013.715%202%2014.696%202%2016s.939%202.284%201.768%203.148c.47.492.958%201%201.142%201.446.17.409.18%201.086.19%201.742.019%201.22.039%202.603%201%203.564s2.344.981%203.564%201c.656.01%201.334.02%201.742.19.445.184.954.671%201.446%201.143C13.715%2029.06%2014.696%2030%2016%2030s2.284-.939%203.148-1.767c.492-.472%201-.96%201.446-1.143.409-.17%201.086-.18%201.742-.19%201.22-.019%202.603-.039%203.564-1s.981-2.344%201-3.564c.01-.656.02-1.333.19-1.742.184-.445.671-.954%201.143-1.447C29.06%2018.286%2030%2017.306%2030%2016s-.939-2.284-1.767-3.148m-6.526.854-7%207a1%201%200%200%201-1.415%200l-3-3a1%201%200%200%201%201.415-1.415L14%2018.587l6.293-6.293a1%201%200%200%201%201.415%201.415%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%222%22%20x2%3D%2230%22%20y1%3D%222%22%20y2%3D%2230%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23ff6200%22%2F%3E%3Cstop%20offset%3D%22.615%22%20stop-color%3D%22%23f80%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23ff5900%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E",
    "trusted-seal": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22none%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22url(%23a)%22%20d%3D%22M28.233%2012.853c-.472-.493-.96-1-1.143-1.447-.17-.409-.18-1.086-.19-1.742-.019-1.22-.039-2.603-1-3.564s-2.344-.981-3.564-1c-.656-.01-1.333-.02-1.742-.19-.445-.184-.954-.671-1.447-1.142C18.286%202.938%2017.306%202%2016%202s-2.284.939-3.148%201.768c-.492.47-1%20.958-1.446%201.142-.406.17-1.086.18-1.742.19-1.22.019-2.603.039-3.564%201s-.975%202.344-1%203.564c-.01.656-.02%201.334-.19%201.742-.184.445-.671.954-1.142%201.446C2.938%2013.715%202%2014.696%202%2016s.939%202.284%201.768%203.148c.47.492.958%201%201.142%201.446.17.409.18%201.086.19%201.742.019%201.22.039%202.603%201%203.564s2.344.981%203.564%201c.656.01%201.334.02%201.742.19.445.184.954.671%201.446%201.143C13.715%2029.06%2014.696%2030%2016%2030s2.284-.939%203.148-1.767c.492-.472%201-.96%201.446-1.143.409-.17%201.086-.18%201.742-.19%201.22-.019%202.603-.039%203.564-1s.981-2.344%201-3.564c.01-.656.02-1.333.19-1.742.184-.445.671-.954%201.143-1.447C29.06%2018.286%2030%2017.306%2030%2016s-.939-2.284-1.767-3.148m-6.526.854-7%207a1%201%200%200%201-1.415%200l-3-3a1%201%200%200%201%201.415-1.415L14%2018.587l6.293-6.293a1%201%200%200%201%201.415%201.415%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%222%22%20x2%3D%2230%22%20y1%3D%222%22%20y2%3D%2230%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%2329de6b%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%230f9f44%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E"
  };

  function getIconUrl(name) {
    return ICONS[name] || "";
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
    if (raw.startsWith("at://")) {
      if (raw.indexOf("/app.bsky.graph.starterpack/") !== -1) {
        return { starterPackAtUri: raw };
      }
      return { atUri: raw };
    }
    var m = raw.match(/https?:\/\/([^/]+)\/profile\/([^/]+)\/lists\/([a-zA-Z0-9]+)/);
    if (m) return { handle: m[2], rkey: m[3] };
    var sp = raw.match(/https?:\/\/([^/]+)\/profile\/([^/]+)\/starter-pack\/([a-zA-Z0-9]+)/);
    if (sp) return { starterPackHandle: sp[2], starterPackRkey: sp[3] };
    var sp2 = raw.match(/https?:\/\/([^/]+)\/starter-pack\/([^/]+)\/([a-zA-Z0-9]+)/);
    if (sp2) return { starterPackHandle: sp2[2], starterPackRkey: sp2[3], starterPackDomain: sp2[1] };
    return null;
  }

  async function resolveListUri(raw, config) {
    var parsed = parseListInput(raw);
    if (!parsed) throw new Error("Invalid list");
    if (parsed.atUri) return { listUri: parsed.atUri, starterPackUri: null };
    if (parsed.starterPackAtUri) return { listUri: null, starterPackUri: parsed.starterPackAtUri };
    if (parsed.starterPackHandle) {
      if (config && parsed.starterPackDomain) {
        config.clientDomain = config.clientDomain || parsed.starterPackDomain;
      }
      var spDid = await resolveHandle(parsed.starterPackHandle);
      return {
        listUri: null,
        starterPackUri:
          "at://" + spDid + "/app.bsky.graph.starterpack/" + parsed.starterPackRkey,
      };
    }
    var did = await resolveHandle(parsed.handle);
    return {
      listUri: "at://" + did + "/app.bsky.graph.list/" + parsed.rkey,
      starterPackUri: null,
    };
  }

  async function fetchList(atUri, limit, signal) {
    var url =
      API_BASE +
      "app.bsky.graph.getList?list=" +
      encodeURIComponent(atUri);
    if (limit) url += "&limit=" + encodeURIComponent(String(limit));
    return fetchJsonDedup(url, url, "Failed to fetch list", signal);
  }

  async function fetchStarterPack(atUri, signal) {
    var url =
      API_BASE +
      "app.bsky.graph.getStarterPack?starterPack=" +
      encodeURIComponent(atUri);
    return fetchJsonDedup(url, url, "Failed to fetch starter pack", signal);
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
    if (config.columns) {
      var parts = String(config.columns).split(",").map(function (p) {
        return p.trim();
      }).filter(Boolean);
      var colsLg = parts[0] || "3";
      var colsMd = parts[1] || colsLg;
      var colsSm = parts[2] || colsMd;
      var colsXs = parts[3] || colsSm;
      container.style.setProperty("--atproto-columns", colsLg);
      container.style.setProperty("--atproto-columns-md", colsMd);
      container.style.setProperty("--atproto-columns-sm", colsSm);
      container.style.setProperty("--atproto-columns-xs", colsXs);
    }
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
    var style = document.createElement("style");
    style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap');:host{--neutral-0:#ffffff;--neutral-1:#f8f9fa;--neutral-2:#f1f3f5;--neutral-3:#e9ecef;--neutral-4:#dee2e6;--neutral-5:#ced4da;--neutral-6:#adb5bd;--neutral-7:#6a7178;--neutral-8:#4f575e;--neutral-9:#272b30;--neutral-10:#101213;--neutral-11:#000000;--primary-light:#f8f9ff;--primary-base:#0a66f4;--primary-hover:#20439b;--primary-dark:#1c2855;--font-displayLarge:45px;--font-displaymedium:40px;--font-displaySmall:36px;--font-heading1:32px;--font-heading2:28px;--font-heading3:25px;--font-heading4:22px;--font-heading5:20px;--font-heading6:18px;--font-subtitle:16px;--font-body:14px;--font-caption:12px;--font-label:11px;--font-tagline:10px;--font-sans:\"Google Sans Flex\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;--transition:all 0.32s ease-in-out;--atproto-columns:3;--atproto-bg:var(--neutral-0,#ffffff);--atproto-border-color:var(--neutral-3,#e9ecef);--atproto-text-color:var(--neutral-10,#101213);--atproto-muted-color:var(--neutral-7,#6a7178);--atproto-accent-color:var(--primary-base,#0a66f4);--atproto-radius:12px;--atproto-font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif)}:host(.atproto-members-host){display:block;width:var(--atproto-width,100%);max-width:var(--atproto-max-width,none);margin:32px auto;font-family:var(--atproto-font-family);color:var(--atproto-text-color)}.atproto-members-inner{width:100%}.atproto-members--loading,.atproto-members--error,.atproto-members__empty{padding:18px;border:1px solid var(--atproto-border-color);border-radius:var(--atproto-radius);background:var(--atproto-bg);color:var(--atproto-muted-color);text-align:center;font-size:var(--font-body,14px)}.atproto-members__grid{display:grid;grid-template-columns:repeat(var(--atproto-columns,3),minmax(0,1fr));gap:8px}.atproto-members__grid--avatar-only{grid-template-columns:repeat(auto-fit,minmax(46px,1fr)) !important;justify-items:center}@media (max-width:1024px){.atproto-members__grid{grid-template-columns:repeat(var(--atproto-columns-md,var(--atproto-columns,3)),minmax(0,1fr))}.atproto-members__grid--avatar-only{grid-template-columns:repeat(auto-fit,minmax(46px,1fr))}}@media (max-width:768px){.atproto-members__grid{grid-template-columns:repeat(var(--atproto-columns-sm,var(--atproto-columns-md,var(--atproto-columns,3))),minmax(0,1fr))}.atproto-members__grid--avatar-only{grid-template-columns:repeat(auto-fit,minmax(46px,1fr))}}.atproto-members__button-row{display:flex;justify-content:center;margin-top:24px}.atproto-members__button{display:inline-flex;align-items:center;justify-content:center;padding:8px 20px;border-radius:100px;font-size:var(--font-body);font-weight:600;text-decoration:none;transition:transform 0.2s ease,box-shadow 0.2s ease,background 0.2s ease}.atproto-members__button--filled{background:var(--primary-base);color:#ffffff;border:1px solid var(--primary-base)}.atproto-members__button--filled:hover{background:var(--primary-hover)}.atproto-members__button--outline{background:transparent;color:var(--neutral-11);border:2px solid var(--neutral-1)}.atproto-members__button--outline:hover{background:var(--neutral-3);border-color:var(--neutral-3)}.atproto-members__card{display:flex;gap:10px;padding:12px;background:var(--neutral-0);border:2px solid var(--neutral-1);border-radius:12px;align-items:flex-start;transition:var(--transition)}.atproto-members__card--avatar-only{justify-content:center;align-items:center;padding:4px;border-radius:50%;width:46px;height:46px;gap:0;box-sizing:border-box}.atproto-members__card--avatar-only .atproto-members__meta{display:none}.atproto-members__card-link{display:block;text-decoration:none;color:inherit}.atproto-members__card-link:hover .atproto-members__card{border-color:var(--neutral-3);box-shadow:0 6px 16px rgba(0,0,0,0.08);transform:translateY(-1px)}.atproto-members__avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0}.atproto-members__meta{display:flex;flex-direction:column;gap:4px;min-width:0}.atproto-members__name-row{display:flex;align-items:center;gap:4px}.atproto-members__name{font-size:var(--font-caption);font-weight:600;color:var(--neutral-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.atproto-members__badge{width:14px;height:14px}.atproto-members__handle{font-size:var(--font-caption);color:var(--neutral-8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.atproto-members__metrics{display:flex;gap:8px;margin-top:2px}.atproto-members__metric{display:flex;align-items:center;gap:4px;font-size:var(--font-tagline);color:var(--neutral-7);white-space:nowrap}@media (max-width:480px){.atproto-members__grid{grid-template-columns:repeat(var(--atproto-columns-xs,var(--atproto-columns-sm,var(--atproto-columns,3))),minmax(0,1fr))}}";
    root.appendChild(style);
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
      var listInfo = await resolveListUri(raw, config);
      var listUri = listInfo.listUri;
      var starterPackUri = listInfo.starterPackUri;
      var listData;
      if (starterPackUri) {
        var starter = await fetchStarterPack(starterPackUri, controller.signal);
        var spList = starter && starter.starterPack && starter.starterPack.record && starter.starterPack.record.list;
        if (!spList) throw new Error("Starter pack missing list");
        listUri = spList;
      }
      listData = await fetchList(listUri, config.limit, controller.signal);
      if (listData && listData.items && config.limit && config.limit > 0) {
        var validCount = listData.items.filter(function (item) {
          return item && (item.subject || item.profile);
        }).length;
        if (validCount < config.limit && config.limit < 100) {
          var extra = config.limit - validCount;
          var nextLimit = Math.min(100, config.limit + extra);
          if (nextLimit > config.limit) {
            listData = await fetchList(listUri, nextLimit, controller.signal);
          }
        }
      }
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
