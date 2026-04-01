var postEmbeds = document.querySelectorAll('.atproto-embed[data-mode="post"]');
var postOptions = document.querySelectorAll('.post-options [data-attr], .options-panel[data-tab-section="post"] .slider-controls [data-attr]');
var discussionEmbeds = document.querySelectorAll('.atproto-embed[data-mode="discussion"]');
var discussionOptions = document.querySelectorAll('.discussion-options [data-attr], .options-panel[data-tab-section="discussion"] .slider-controls [data-attr]');
var loadTimer = null;
var discussionLoadTimer = null;

function normalizeAttrValue(attr, opt) {
  var raw = opt.value;
  if (attr === 'max-width') {
    var maxUnit = opt.dataset.unit || 'px';
    if (maxUnit === 'px') return raw + 'px';
    if (maxUnit === '%') return raw + '%';
  }
  return raw;
}

var demoProfiles = document.querySelectorAll('.atproto-profile');
var profileOptions = document.querySelectorAll('.profile-options [data-attr]');
var profileInputs = document.querySelectorAll('.profile-controls[data-tab-section="profile"] .profile-inputs [data-attr], .profile-controls[data-tab-section="profile"] .slider-controls [data-attr]');
var profileLoadTimer = null;

function applyProfileSizePreview() {
  var maxWidthInput = document.querySelector('.profile-controls[data-tab-section="profile"] [data-attr="max-width"]');
  var maxWidthVal = maxWidthInput ? normalizeAttrValue('max-width', maxWidthInput) : null;

  demoProfiles.forEach(function (c) {
    c.setAttribute('data-width', '100%');
    if (maxWidthVal) {
      c.setAttribute('data-max-width', maxWidthVal);
      c.style.setProperty('--atproto-max-width', maxWidthVal);
    }
  });
}

var demoMembers = document.querySelectorAll('.atproto-members');
var membersOptions = document.querySelectorAll('.profile-controls[data-tab-section="members"] [data-attr]');
var membersLoadTimer = null;

function refreshEmbeds() {
  if (window.AtProtoEmbed && typeof window.AtProtoEmbed.refresh === 'function') {
    window.AtProtoEmbed.refresh();
    return true;
  }
  return false;
}

function loadPost(uri) {
  if (!uri) {
    var first = postEmbeds[0];
    uri = first ? first.getAttribute('data-uri') : '';
  }
  if (!uri) return;

  postEmbeds.forEach(function (c) {
    c.setAttribute('data-uri', uri);
    postOptions.forEach(function (opt) {
      var attr = opt.getAttribute('data-attr');
      if (opt.type === 'checkbox') {
        if (attr === 'external-layout') {
          c.setAttribute('data-' + attr, opt.checked ? 'horizontal' : 'vertical');
        } else {
          c.setAttribute('data-' + attr, opt.checked ? 'true' : 'false');
        }
      } else {
        c.setAttribute('data-' + attr, normalizeAttrValue(attr, opt));
      }
    });
    c.setAttribute('data-width', '100%');
    c.removeAttribute('data-loaded');
    c.innerHTML = '';
  });

  if (refreshEmbeds()) return;

  var old = document.getElementById('embed-script');
  if (old) old.remove();
  var s = document.createElement('script');
  s.id = 'embed-script';
  s.src = 'src/embed.js?t=' + Date.now();
  document.body.appendChild(s);
}

function loadDiscussion(uri) {
  if (!uri) {
    var first = discussionEmbeds[0];
    uri = first ? first.getAttribute('data-uri') : '';
  }
  if (!uri) return;

  discussionEmbeds.forEach(function (c) {
    c.setAttribute('data-uri', uri);
    discussionOptions.forEach(function (opt) {
      var attr = opt.getAttribute('data-attr');
      if (opt.type === 'checkbox') {
        if (attr === 'external-layout') {
          c.setAttribute('data-' + attr, opt.checked ? 'horizontal' : 'vertical');
        } else {
          c.setAttribute('data-' + attr, opt.checked ? 'true' : 'false');
        }
      } else {
        c.setAttribute('data-' + attr, normalizeAttrValue(attr, opt));
      }
    });
    c.setAttribute('data-width', '100%');
    c.removeAttribute('data-loaded');
    c.innerHTML = '';
  });

  if (refreshEmbeds()) return;

  var old = document.getElementById('embed-script');
  if (old) old.remove();
  var s = document.createElement('script');
  s.id = 'embed-script';
  s.src = 'src/embed.js?t=' + Date.now();
  document.body.appendChild(s);
}

function loadFromDropdown() { loadPost(document.getElementById('selector').value); }
function loadCustom() { loadPost(document.getElementById('custom-uri').value.trim()); }
function loadDiscussionFromDropdown() { loadDiscussion(document.getElementById('discussion-selector').value); }
function loadDiscussionCustom() { loadDiscussion(document.getElementById('discussion-custom-uri').value.trim()); }

document.getElementById('custom-uri').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadCustom(); });
document.getElementById('discussion-custom-uri').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadDiscussionCustom(); });

document.querySelectorAll('.post-options [data-attr], .options-panel[data-tab-section="post"] .slider-controls [data-attr]').forEach(function (el) {
  el.addEventListener('change', function () {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(function () { loadPost(); }, 200);
  });
  if (el.type === 'range') {
    el.addEventListener('input', function () {
      var out = el.closest('label')?.querySelector('.range-value');
      if (out) out.textContent = el.dataset.unit === '%' ? el.value + '%' : el.value + 'px';
    });
  }
});

document.querySelectorAll('.discussion-options [data-attr], .options-panel[data-tab-section="discussion"] .slider-controls [data-attr]').forEach(function (el) {
  el.addEventListener('change', function () {
    if (discussionLoadTimer) clearTimeout(discussionLoadTimer);
    discussionLoadTimer = setTimeout(function () { loadDiscussion(); }, 200);
  });
  if (el.type === 'range') {
    el.addEventListener('input', function () {
      var out = el.closest('label')?.querySelector('.range-value');
      if (out) out.textContent = el.dataset.unit === '%' ? el.value + '%' : el.value + 'px';
    });
  }
});

function refreshProfiles() {
  if (window.AtProtoProfile && typeof window.AtProtoProfile.refresh === 'function') {
    window.AtProtoProfile.refresh();
    return true;
  }
  return false;
}

function loadProfile(actor) {
  if (!actor) {
    var input = document.getElementById('profile-handle');
    actor = input ? input.value.trim() : '';
  }
  if (!actor) {
    var firstProfile = demoProfiles[0];
    actor = firstProfile ? firstProfile.getAttribute('data-profile') : '';
  }
  if (!actor) return;

  demoProfiles.forEach(function (c) {
    c.setAttribute('data-profile', actor);
    profileOptions.forEach(function (opt) {
      var attr = opt.getAttribute('data-attr');
      if (opt.type === 'checkbox') {
        c.setAttribute('data-' + attr, opt.checked ? 'true' : 'false');
      } else {
        c.setAttribute('data-' + attr, opt.value);
      }
    });
    profileInputs.forEach(function (opt) {
      var attr = opt.getAttribute('data-attr');
      var val = opt.value.trim();

      if (attr === 'client-preset') {
        if (val) {
          var parts = val.split('|');
          var domain = parts[0] || '';
          var name = parts[1] || domain;
          if (domain) c.setAttribute('data-client-domain', domain);
          if (name) c.setAttribute('data-client-name', name);
        }
      } else if (attr === 'max-width') {
        c.setAttribute('data-' + attr, normalizeAttrValue(attr, opt));
      } else if (val) {
        c.setAttribute('data-' + attr, val);
      } else {
        c.removeAttribute('data-' + attr);
      }
    });
    c.setAttribute('data-width', '100%');
    c.removeAttribute('data-loaded');
    c.innerHTML = '';
  });

  if (refreshProfiles()) return;
  if (window.AtProtoLoader && typeof window.AtProtoLoader.refresh === 'function') {
    window.AtProtoLoader.refresh();
    return;
  }

  var old = document.getElementById('embed-script');
  if (old) old.remove();
  var s = document.createElement('script');
  s.id = 'embed-script';
  s.src = 'src/embed.js?t=' + Date.now();
  document.body.appendChild(s);
}

function loadProfileFromInput() { loadProfile(); }

var profileInput = document.getElementById('profile-handle');
if (profileInput) {
  profileInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadProfileFromInput();
  });
}

document.querySelectorAll('.profile-options [data-attr]').forEach(function (el) {
  el.addEventListener('change', function () {
    if (profileLoadTimer) clearTimeout(profileLoadTimer);
    profileLoadTimer = setTimeout(function () { loadProfile(); }, 120);
  });
});

document.querySelectorAll('.profile-controls[data-tab-section="profile"] .profile-inputs [data-attr], .profile-controls[data-tab-section="profile"] .slider-controls [data-attr]').forEach(function (el) {
  el.addEventListener('change', function () {
    var attr = el.getAttribute('data-attr');
    if (attr === 'max-width') {
      applyProfileSizePreview();
      return;
    }
    if (profileLoadTimer) clearTimeout(profileLoadTimer);
    profileLoadTimer = setTimeout(function () { loadProfile(); }, 200);
  });
  if (el.tagName === 'INPUT' && el.type === 'text') {
    el.addEventListener('input', function () {
      if (profileLoadTimer) clearTimeout(profileLoadTimer);
      profileLoadTimer = setTimeout(function () { loadProfile(); }, 400);
    });
  }
  if (el.tagName === 'INPUT' && el.type === 'range') {
    el.addEventListener('input', function () {
      var out = el.closest('label')?.querySelector('.range-value');
      if (out) out.textContent = el.dataset.unit === '%' ? el.value + '%' : el.value + 'px';
      var attr = el.getAttribute('data-attr');
      if (attr === 'max-width') {
        applyProfileSizePreview();
        return;
      }
      if (profileLoadTimer) clearTimeout(profileLoadTimer);
      profileLoadTimer = setTimeout(function () { loadProfile(); }, 200);
    });
  }
});

function refreshMembers() {
  if (window.AtProtoMembers && typeof window.AtProtoMembers.refresh === 'function') {
    window.AtProtoMembers.refresh();
    return true;
  }
  return false;
}

function loadMembers(listValue) {
  if (!listValue) {
    var input = document.getElementById('members-list');
    listValue = input ? input.value.trim() : '';
  }
  if (!listValue) {
    var firstList = demoMembers[0];
    listValue = firstList ? firstList.getAttribute('data-list') : '';
  }
  if (!listValue) return;

  demoMembers.forEach(function (c) {
    c.setAttribute('data-list', listValue);
    membersOptions.forEach(function (opt) {
      var attr = opt.getAttribute('data-attr');
      if (opt.type === 'checkbox') {
        c.setAttribute('data-' + attr, opt.checked ? 'true' : 'false');
      } else {
        c.setAttribute('data-' + attr, normalizeAttrValue(attr, opt));
      }
    });
    c.setAttribute('data-width', '100%');
    c.removeAttribute('data-loaded');
    c.innerHTML = '';
  });

  if (refreshMembers()) return;
  if (window.AtProtoLoader && typeof window.AtProtoLoader.refresh === 'function') {
    window.AtProtoLoader.refresh();
    return;
  }

  var old = document.getElementById('embed-script');
  if (old) old.remove();
  var s = document.createElement('script');
  s.id = 'embed-script';
  s.src = 'src/embed.js?t=' + Date.now();
  document.body.appendChild(s);
}

function loadMembersFromInput() { loadMembers(); }

var membersInput = document.getElementById('members-list');
if (membersInput) {
  membersInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadMembersFromInput();
  });
}

document.querySelectorAll('.profile-controls[data-tab-section="members"] [data-attr]').forEach(function (el) {
  el.addEventListener('change', function () {
    if (membersLoadTimer) clearTimeout(membersLoadTimer);
    membersLoadTimer = setTimeout(function () { loadMembers(); }, 200);
  });
  if (el.type === 'range') {
    el.addEventListener('input', function () {
      var rangeLabel = el.closest('label')?.querySelector('.range-value');
      if (rangeLabel) {
        var unit = el.dataset.unit || (el.getAttribute('data-attr') === 'limit' ? '' : 'px');
        if (unit === '%') {
          rangeLabel.textContent = el.value + '%';
        } else if (unit === 'px') {
          rangeLabel.textContent = el.value + 'px';
        } else {
          rangeLabel.textContent = el.value;
        }
      }
      if (el.getAttribute('data-attr') === 'limit') {
        var valDisplay = document.getElementById('members-limit-val');
        if (valDisplay) valDisplay.textContent = this.value;
      }
      if (membersLoadTimer) clearTimeout(membersLoadTimer);
      membersLoadTimer = setTimeout(function () { loadMembers(); }, 100);
    });
  }
});

document.querySelectorAll('.demo-tabs input[type="radio"]').forEach(radio => {
  radio.addEventListener('change', function () {
    document.body.setAttribute('data-active-tab', this.value);
    updateCodeSnippetLinks();
  });
});

function updateCodeSnippetLinks() {
  const activeTab = document.body.getAttribute('data-active-tab') || 'post';
  let scriptName = 'embed.js';

  // Update Script tab
  const scriptCode = `<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/${scriptName}"></script>`;
  const highlightedScript = highlightHTML(scriptCode);
  const scriptElem = document.getElementById('hero-script-code');
  scriptElem.innerHTML = highlightedScript;
  scriptElem.dataset.rawHtml = scriptCode;

  // Update jsDelivr link
  const cdnLink = `https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/${scriptName}`;
  const cdnElem = document.querySelector('#panel-1 .link-url');
  if (cdnElem) {
    cdnElem.href = cdnLink;
    cdnElem.innerHTML = `<span class="hl-string">"${cdnLink}"</span>`;
  }

  // Update GitHub src link
  const githubSrcLink = `https://github.com/romiojoseph/atproto-embed/blob/main/src/${scriptName}`;
  const githubSrcElem = document.querySelector('#panel-2 .link-url[href*="src/"]');
  if (githubSrcElem) {
    githubSrcElem.href = githubSrcLink;
    githubSrcElem.innerHTML = `<span class="hl-string">"${githubSrcLink}"</span>`;
  }
}

function generateFormattedHTML(embed, scriptName) {
  let attrs = [];
  for (let attr of embed.attributes) {
    if (attr.name === 'class') {
      if (attr.value.includes('atproto-embed')) {
        attrs.unshift(`class="atproto-embed"`);
      } else if (attr.value.includes('atproto-profile')) {
        attrs.unshift(`class="atproto-profile"`);
      } else if (attr.value.includes('atproto-members')) {
        attrs.unshift(`class="atproto-members"`);
      }
    } else if (attr.name.startsWith('data-') && attr.name !== 'data-loaded') {
      attrs.push(`${attr.name}="${attr.value}"`);
    }
  }
  let html = `<div\n  ${attrs.join('\n  ')}\n></div>\n<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/${scriptName}"></script>`;
  return html;
}

function highlightHTML(html) {
  let escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let res = escaped.replace(/"([^"]*)"/g, '<span class="hl-string">"$1"</span>');
  res = res.replace(/([a-zA-Z0-9-]+)=(?=<span class="hl-string">)/g, '<span class="hl-attr">$1</span>=');
  res = res.replace(/(&lt;\/?)([a-zA-Z0-9-]+)/g, '$1<span class="hl-tag">$2</span>');

  return res;
}

let popoverStateActive = false;

function openCodePopover(buttonElem) {
  const wrap = buttonElem.closest('.embed-wrap');
  let embed = wrap.querySelector('.atproto-embed');
  let scriptSrc = "embed.js";

  if (!embed) {
    embed = wrap.querySelector('.atproto-profile');
  }
  if (!embed) {
    embed = wrap.querySelector('.atproto-members');
  }

  if (!embed) return;

  const rawHtml = generateFormattedHTML(embed, scriptSrc);
  const highlighted = highlightHTML(rawHtml);

  const codeElem = document.getElementById('popover-code');
  codeElem.innerHTML = highlighted;
  codeElem.dataset.rawHtml = rawHtml;

  const overlay = document.getElementById('code-popover');
  overlay.classList.add('active');
  document.body.classList.add('popover-open');

  if (!popoverStateActive) {
    popoverStateActive = true;
    history.pushState({ modal: true }, "");
  }
}

function closePopover(fromHistory = false) {
  const overlay = document.getElementById('code-popover');
  if (!overlay.classList.contains('active')) return;

  overlay.classList.remove('active');
  document.body.classList.remove('popover-open');

  if (popoverStateActive && !fromHistory) {
    popoverStateActive = false;
    history.back();
  } else {
    popoverStateActive = false;
  }
}

// Handle browser/mobile back button
window.addEventListener('popstate', (event) => {
  if (popoverStateActive) {
    closePopover(true);
  }
});

function copyPopoverCode(buttonElem) {
  const codeElem = document.getElementById('popover-code');
  if (!codeElem) return;

  const rawHtml = codeElem.dataset.rawHtml;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(rawHtml).then(() => {
      showCopied(buttonElem);
    }).catch(err => {
      fallbackCopyTextToClipboard(rawHtml, buttonElem);
    });
  } else {
    fallbackCopyTextToClipboard(rawHtml, buttonElem);
  }
}

function fallbackCopyTextToClipboard(text, buttonElem) {
  var textArea = document.createElement("textarea");
  textArea.value = text;

  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
    showCopied(buttonElem);
  } catch (err) {
    console.error('Fallback: Oops, unable to copy', err);
    alert("Failed to copy snippet: " + err);
  }

  document.body.removeChild(textArea);
}

function copyHeroScript() {
  const btn = document.querySelector('.hero-copy-btn');
  const codeText = '<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/embed.js"></script>';

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(codeText).then(() => {
      showCopied(btn);
    }).catch(err => {
      fallbackCopyTextToClipboard(codeText, btn);
    });
  } else {
    fallbackCopyTextToClipboard(codeText, btn);
  }
}

function showCopied(button) {
  const originalHTML = button.innerHTML;
  button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
  button.classList.add("copied");
  setTimeout(() => {
    button.innerHTML = originalHTML;
    button.classList.remove("copied");
  }, 2000);
}

function switchTab(i) {
  document.querySelectorAll('.tab').forEach((t, j) => t.classList.toggle('active', i === j));
  document.querySelectorAll('.panel').forEach((p, j) => p.classList.toggle('active', i === j));
}

// Initialize code snippet links
updateCodeSnippetLinks();
