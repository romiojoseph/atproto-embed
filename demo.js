var demoEmbeds = document.querySelectorAll('.atproto-embed');
var demoOptions = document.querySelectorAll('.options-grid [data-attr]');
var loadTimer = null;

function refreshEmbeds() {
  if (window.AtProtoEmbed && typeof window.AtProtoEmbed.refresh === 'function') {
    window.AtProtoEmbed.refresh();
    return true;
  }
  return false;
}

function loadEmbed(uri) {
  if (!uri) {
    var first = demoEmbeds[0];
    uri = first ? first.getAttribute('data-uri') : '';
  }
  if (!uri) return;

  demoEmbeds.forEach(function (c) {
    c.setAttribute('data-uri', uri);
    demoOptions.forEach(function (opt) {
      var attr = opt.getAttribute('data-attr');
      if (opt.type === 'checkbox') {
        if (attr === 'external-layout') {
          c.setAttribute('data-' + attr, opt.checked ? 'horizontal' : 'vertical');
        } else {
          c.setAttribute('data-' + attr, opt.checked ? 'true' : 'false');
        }
      } else {
        c.setAttribute('data-' + attr, opt.value);
      }
    });
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

function loadFromDropdown() { loadEmbed(document.getElementById('selector').value); }
function loadCustom() { loadEmbed(document.getElementById('custom-uri').value.trim()); }

document.getElementById('custom-uri').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadCustom(); });

document.querySelectorAll('.options-grid [data-attr]').forEach(function (el) {
  el.addEventListener('change', function () {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(function () { loadEmbed(); }, 200);
  });
});

function generateFormattedHTML(embed) {
  let attrs = [];
  for (let attr of embed.attributes) {
    if (attr.name === 'class' && attr.value.includes('atproto-embed')) {
      attrs.unshift(`class="atproto-embed"`);
    } else if (attr.name.startsWith('data-') && attr.name !== 'data-loaded') {
      attrs.push(`${attr.name}="${attr.value}"`);
    }
  }
  let html = `<div\n  ${attrs.join('\n  ')}\n></div>\n<script src="https://cdn.jsdelivr.net/gh/romiojoseph/atproto-embed@latest/dist/embed.js"></script>`;
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
  const embed = wrap.querySelector('.atproto-embed');
  if (!embed) return;

  const rawHtml = generateFormattedHTML(embed);
  const highlighted = highlightHTML(rawHtml);

  const codeElem = document.getElementById('popover-code');
  codeElem.innerHTML = highlighted;
  codeElem.dataset.rawHtml = rawHtml;

  const overlay = document.getElementById('code-popover');
  overlay.classList.add('active');
  document.body.classList.add('popover-open');

  // Push state for mobile back button support
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
