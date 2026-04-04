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

  function linkifyInline(text, config) {
    if (!text) return "";
    var input = String(text);
    var out = "";
    var lastIndex = 0;
    var re = /https?:\/\/[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:^|[^@\w.])([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)(?=\/|[^\w.-]|$)|@[A-Z0-9._-]+|#[A-Z0-9_]+/gi;
    var m;
    while ((m = re.exec(input)) !== null) {
      var start = m.index;
      var match = m[1] || m[0];
      var prefix = m[1] ? m[0].slice(0, m[0].length - m[1].length) : "";
      if (start > lastIndex) {
        out += escapeHtml(input.slice(lastIndex, start));
      }
      if (prefix) {
        out += escapeHtml(prefix);
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
      } else if (match.indexOf(".") !== -1) {
        var urlGuess = "https://" + match;
        out +=
          '<a class="atproto-profile__link" href="' +
          escapeHtml(urlGuess) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(match) +
          "</a>";
      } else {
        out += escapeHtml(match);
      }
      lastIndex = start + (m[1] ? m[0].length : match.length);
    }
    if (lastIndex < input.length) {
      out += escapeHtml(input.slice(lastIndex));
    }
    return out;
  }

  function linkifyDescription(text, config) {
    if (!text) return "";
    var paragraphs = String(text).split(/\n\s*\n/);
    var parts = paragraphs.map(function (para) {
      var html = linkifyInline(para, config).replace(/\n/g, "<br>");
      return '<div class="atproto-profile__paragraph">' + html + "</div>";
    });
    return parts.join("");
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
    var style = document.createElement("style");
    style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap');:host{--neutral-0:#ffffff;--neutral-1:#f8f9fa;--neutral-2:#f1f3f5;--neutral-3:#e9ecef;--neutral-4:#dee2e6;--neutral-5:#ced4da;--neutral-6:#adb5bd;--neutral-7:#6a7178;--neutral-8:#4f575e;--neutral-9:#272b30;--neutral-10:#101213;--neutral-11:#000000;--primary-light:#f8f9ff;--primary-base:#0a66f4;--primary-hover:#20439b;--primary-dark:#1c2855;--font-displayLarge:45px;--font-displaymedium:40px;--font-displaySmall:36px;--font-heading1:32px;--font-heading2:28px;--font-heading3:25px;--font-heading4:22px;--font-heading5:20px;--font-heading6:18px;--font-subtitle:16px;--font-body:14px;--font-caption:12px;--font-label:11px;--font-tagline:10px;--font-sans:\"Google Sans Flex\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;--transition:all 0.32s ease-in-out;--atproto-bg:var(--neutral-0,#ffffff);--atproto-border-color:var(--neutral-3,#e9ecef);--atproto-text-color:var(--neutral-10,#101213);--atproto-muted-color:var(--neutral-7,#6a7178);--atproto-accent-color:var(--primary-base,#0a66f4);--atproto-radius:12px;--atproto-font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif)}:host(.atproto-profile-host){display:block;width:var(--atproto-width,100%);max-width:var(--atproto-max-width,none);margin:32px auto;box-sizing:border-box;font-family:var(--atproto-font-family);color:var(--atproto-text-color)}.atproto-profile-inner{margin:0 auto;box-sizing:border-box;width:100%}.atproto-profile-card--size-full{width:100%}.atproto-profile-card--size-md{width:100%;max-width:480px}.atproto-profile-card--size-fit{width:fit-content;min-width:0;max-width:100%}.atproto-profile--loading,.atproto-profile--error{padding:18px;border:1px solid var(--atproto-border-color);border-radius:var(--atproto-radius);background:var(--atproto-bg);color:var(--atproto-muted-color);text-align:center;font-size:var(--font-body,14px)}.atproto-profile-card{margin:0 auto;overflow:hidden;background:var(--atproto-bg);border:1px solid var(--neutral-3);border-radius:20px;box-shadow:0 0 0 3px var(--neutral-1)}.atproto-profile__cover{height:140px;background:#f1f3f5;position:relative;border-radius:inherit;border-bottom-left-radius:0;border-bottom-right-radius:0;overflow:hidden}.atproto-profile__cover img{width:100%;height:100%;object-fit:cover;display:block}.atproto-profile__cover--empty{background:linear-gradient(135deg,#f8f9fa,#e9ecef)}.atproto-profile__body{padding:16px 18px 18px;position:relative}.atproto-profile__header{display:flex;gap:10px;align-items:center;min-width:0}.atproto-profile-card--no-cover .atproto-profile__header{margin-top:0}.atproto-profile__avatar-wrap{width:40px;height:40px;border-radius:50%;background:var(--atproto-profile-bg);border:1px solid var(--atproto-profile-bg);flex-shrink:0;overflow:hidden}.atproto-profile-card--no-cover .atproto-profile__avatar-wrap{border:none;box-shadow:none}.atproto-profile__avatar{width:100%;height:100%;object-fit:cover;display:block}.atproto-profile__identity{display:flex;flex-direction:column;gap:2px;min-width:0}.atproto-profile__name-row{display:flex;align-items:center;gap:6px;min-width:0}.atproto-profile__name{font-size:var(--font-subtitle);font-weight:600;color:var(--neutral-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto;max-width:100%;display:block}.atproto-profile__badge{width:16px;height:16px;flex:0 0 auto}.atproto-profile__handle{font-size:var(--font-body);color:var(--atproto-muted-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%;display:block}.atproto-profile__description{margin-top:12px;font-size:var(--font-body);line-height:1.5;color:var(--atproto-text-color);white-space:pre-wrap;word-break:break-all}.atproto-profile__paragraph:not(:last-child){margin-bottom:8px}.atproto-profile__link{color:var(--primary-base);font-weight:500;text-decoration:none;text-underline-offset:2px}.atproto-profile__link:hover{text-decoration:underline;text-decoration-thickness:2px}.atproto-profile__metrics{display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:16px}.atproto-profile__metric{display:flex;gap:4px;min-width:80px}.atproto-profile__metric-count{font-size:var(--font-caption);font-weight:600;color:var(--atproto-text-color)}.atproto-profile__metric-label{font-size:var(--font-caption);color:var(--neutral-8)}.atproto-profile__actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.atproto-profile__btn{flex:1;display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:100px;font-size:var(--font-body,14px);font-weight:600;text-decoration:none;transition:transform 0.2s ease,box-shadow 0.2s ease,background 0.2s ease;white-space:nowrap}.atproto-profile__btn:hover{}.atproto-profile__btn--primary{background:var(--primary-base);color:#ffffff;border:1px solid var(--primary-base)}.atproto-profile__btn--primary:hover{background:var(--primary-hover);border-color:var(--primary-hover)}.atproto-profile__btn--secondary{background:transparent;color:var(--neutral-11);border:1px solid var(--neutral-2)}.atproto-profile__btn--secondary:hover{background:var(--neutral-2);border-color:var(--neutral-3)}@media (max-width:540px){.atproto-profile__actions{flex-direction:column}.atproto-profile__header{align-items:flex-start}.atproto-profile__body{padding:14px 14px 16px}}";
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

    ensureFontLoaded();
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
