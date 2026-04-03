(function () {
  "use strict";

  var RUNTIME_CONFIG = {
    post: {
      selector: ".atproto-embed:not([data-embed-child])",
      file: "post.js",
      api: "AtProtoEmbed",
    },
    profile: {
      selector: ".atproto-profile:not([data-profile-child])",
      file: "profile.js",
      api: "AtProtoProfile",
    },
    members: {
      selector: ".atproto-members:not([data-members-child])",
      file: "members.js",
      api: "AtProtoMembers",
    },
  };

  var RUNTIME_LOADS = {};

  function resolveLoaderSrc() {
    var current = document.currentScript;
    if (current && current.src) return current.src;

    var scripts = document.querySelectorAll("script[src]");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || scripts[i].getAttribute("src") || "";
      if (src.indexOf("embed.js") !== -1) return src;
    }
    return "";
  }

  function splitSrc(src) {
    if (!src) return { base: "./", query: "" };
    try {
      var u = new URL(src, window.location.href);
      var path = u.pathname || "/";
      var slash = path.lastIndexOf("/");
      var basePath = slash >= 0 ? path.slice(0, slash + 1) : "/";
      return {
        base: (u.origin && u.origin !== "null" ? u.origin : u.protocol + "//") + basePath,
        query: u.search || "",
      };
    } catch (_) {
      var clean = src.split("#")[0];
      var q = "";
      var qIdx = clean.indexOf("?");
      if (qIdx !== -1) {
        q = clean.slice(qIdx);
        clean = clean.slice(0, qIdx);
      }
      var idx = clean.lastIndexOf("/");
      return {
        base: idx >= 0 ? clean.slice(0, idx + 1) : "./",
        query: q,
      };
    }
  }

  var LOADER_PARTS = splitSrc(resolveLoaderSrc());

  function runtimeUrl(fileName) {
    return LOADER_PARTS.base + fileName + LOADER_PARTS.query;
  }

  function getRuntimeApi(apiName) {
    if (typeof window === "undefined") return null;
    return window[apiName] || null;
  }

  function scriptMatches(script, key, url, fileName) {
    if (!script) return false;
    if (script.getAttribute("data-atproto-runtime") === key) return true;
    var src = script.getAttribute("src") || script.src || "";
    if (!src) return false;
    try {
      var sourceUrl = new URL(src, window.location.href);
      var targetUrl = new URL(url, window.location.href);
      return sourceUrl.href === targetUrl.href || sourceUrl.pathname === targetUrl.pathname;
    } catch (_) {
      return src === url || src.indexOf(fileName) !== -1;
    }
  }

  function ensureRuntimeLoaded(key) {
    var cfg = RUNTIME_CONFIG[key];
    if (!cfg) return Promise.resolve(null);

    var loadedApi = getRuntimeApi(cfg.api);
    if (loadedApi) return Promise.resolve(loadedApi);

    if (RUNTIME_LOADS[key]) return RUNTIME_LOADS[key];

    var url = runtimeUrl(cfg.file);
    var script = null;
    var scripts = document.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i++) {
      if (scriptMatches(scripts[i], key, url, cfg.file)) {
        script = scripts[i];
        break;
      }
    }

    var p = new Promise(function (resolve, reject) {
      function onLoad() {
        cleanup();
        resolve(getRuntimeApi(cfg.api));
      }

      function onError() {
        cleanup();
        reject(new Error("Failed to load runtime: " + cfg.file));
      }

      function cleanup() {
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      }

      if (!script) {
        script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.setAttribute("data-atproto-runtime", key);
        document.head.appendChild(script);
      }

      var existingApi = getRuntimeApi(cfg.api);
      if (existingApi) {
        resolve(existingApi);
        return;
      }

      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);
    })
      .finally(function () {
        delete RUNTIME_LOADS[key];
      });

    RUNTIME_LOADS[key] = p;
    return p;
  }

  function callRuntimeInit(api) {
    if (!api) return;
    if (typeof api.init === "function") {
      api.init(false);
      return;
    }
    if (typeof api.refresh === "function") {
      api.refresh();
    }
  }

  function collectRequiredRuntimes() {
    var keys = [];
    for (var key in RUNTIME_CONFIG) {
      if (!Object.prototype.hasOwnProperty.call(RUNTIME_CONFIG, key)) continue;
      var cfg = RUNTIME_CONFIG[key];
      if (document.querySelector(cfg.selector)) keys.push(key);
    }
    return keys;
  }

  function init() {
    var keys = collectRequiredRuntimes();
    if (!keys.length) return Promise.resolve();

    return Promise.all(
      keys.map(function (key) {
        return ensureRuntimeLoaded(key).then(function (api) {
          callRuntimeInit(api);
          return api;
        });
      })
    ).catch(function (err) {
      console.error("[atproto-loader]", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  if (typeof window !== "undefined") {
    window.AtProtoLoader = window.AtProtoLoader || {};
    window.AtProtoLoader.refresh = function () {
      return init();
    };
  }
})();
