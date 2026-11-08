/*
 * German interface overlay for the Silo web app (local Windows build).
 *
 * Silo's web app has no translation support, so this classic script swaps
 * English interface text for German as the page renders, using the
 * dictionary in /i18n/de.js (window.__SILO_I18N_DE). It only rewrites the
 * value of existing text nodes and of a few attributes; it never adds,
 * removes or moves nodes, so React keeps working on the same DOM.
 *
 * Whole-text matches come from `exact`; text with changing parts (numbers,
 * names) from `patterns`, where {0}, {1}, ... stand for those parts.
 *
 * German follows the browser's language; ?lang=en or ?lang=de picks one for
 * this browser and keeps it.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "silo.uiLanguage";
  var ATTRS = ["placeholder", "title", "aria-label", "aria-description", "aria-roledescription", "alt"];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1, NOSCRIPT: 1, svg: 1 };

  function browserLanguage() {
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]);
    return String(langs[0] || "").toLowerCase().indexOf("de") === 0 ? "de" : "en";
  }

  function preferredLanguage() {
    try {
      var q = new URLSearchParams(window.location.search).get("lang");
      if (q === "en" || q === "de") window.localStorage.setItem(STORAGE_KEY, q);
      return window.localStorage.getItem(STORAGE_KEY) || browserLanguage();
    } catch (e) {
      return browserLanguage();
    }
  }

  var dict = window.__SILO_I18N_DE;
  if (!dict || preferredLanguage() !== "de") return;
  document.documentElement.setAttribute("lang", "de");

  var exact = dict.exact || {};
  var lowerExact = {};
  Object.keys(exact).forEach(function (k) {
    var lk = k.toLowerCase();
    if (!(lk in lowerExact)) lowerExact[lk] = k;
  });

  // Patterns, indexed by a word of their longest literal part so a text node
  // is only tested against the few patterns that could match it.
  var byWord = {};
  var wordRe = /[A-Za-z][A-Za-z'’-]+/g;
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  // Placeholder kinds: {n} any text, {#n} starts with a digit (counts and
  // durations), {~n} an English plural ending of up to three letters.
  var GROUPS = { "": "(.+?)", "#": "(\\d[^\\n]{0,15}?)", "~": "([a-z]{0,3})" };
  Object.keys(dict.patterns || {}).forEach(function (src) {
    var parts = src.split(/\{([#~]?)(\d+)\}/);
    var re = "^";
    var order = [];
    var longest = "";
    for (var i = 0; i < parts.length; i += 3) {
      re += escapeRe(parts[i]);
      if (parts[i].length > longest.length) longest = parts[i];
      if (i + 2 < parts.length) {
        re += GROUPS[parts[i + 1]];
        order.push(Number(parts[i + 2]));
      }
    }
    var words = longest.match(wordRe);
    if (!words) return;
    var key = words.sort(function (a, b) { return b.length - a.length; })[0].toLowerCase();
    (byWord[key] = byWord[key] || []).push({
      re: new RegExp(re + "$"),
      order: order,
      target: dict.patterns[src],
      weight: src.replace(/\{[#~]?\d+\}/g, "").length,
    });
  });
  Object.keys(byWord).forEach(function (k) {
    byWord[k].sort(function (a, b) { return b.weight - a.weight; });
  });

  // Media data protection. Some titles are also interface words: the series
  // "From", "Dark" or "Upload", the films "Next" or "Play". The overlay reads
  // the app's API responses (without changing them) and remembers the titles
  // and names of anything that looks like a movie, show, episode, person or
  // collection; text equal to one of those is left as it is, except inside
  // controls such as buttons and menu items, which only carry interface text.
  var dataStrings = new Set();
  var DATA_KEY = /^(title|name|original_title|sort_title|series_title|series_name|season_title|episode_title|display_title|parent_title|collection_name|tagline)$/;
  var MEDIA_HINT = ["content_id", "poster_url", "backdrop_url", "thumb_url", "image_url", "year", "release_date", "premiere_date", "air_date", "runtime", "runtime_minutes", "tmdb_id", "imdb_id", "tvdb_id", "provider_ids", "season_number", "episode_number", "birth_date", "profile_url", "media_type", "item_type", "play_content_id"];
  function looksLikeMedia(o) {
    for (var i = 0; i < MEDIA_HINT.length; i++) if (Object.prototype.hasOwnProperty.call(o, MEDIA_HINT[i])) return true;
    return false;
  }
  function collect(v, depth) {
    if (!v || typeof v !== "object" || depth > 12) return;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) collect(v[i], depth + 1);
      return;
    }
    var media = looksLikeMedia(v);
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      var x = v[k];
      if (typeof x === "string") {
        if (media && DATA_KEY.test(k) && x.length < 300) dataStrings.add(x.replace(/\s+/g, " ").trim());
      } else if (x && typeof x === "object") {
        collect(x, depth + 1);
      }
    }
  }
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    // The app gets the response only after its titles are remembered, so a
    // title is never translated in the moment between render and collection.
    window.fetch = function () {
      return origFetch.apply(this, arguments).then(function (res) {
        try {
          var ct = res.headers.get("content-type") || "";
          if (!res.ok || ct.indexOf("json") === -1 || ct.indexOf("problem") !== -1) return res;
          return res.clone().json().then(
            function (body) { collect(body, 0); return res; },
            function () { return res; }
          );
        } catch (e) {
          return res; // never disturb the app
        }
      });
    };
  }
  function isMediaText(text) {
    return dataStrings.has(text);
  }
  var CONTROL_ROLES = { button: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, tab: 1, option: 1, switch: 1 };
  function inControl(el) {
    for (var e = el, n = 0; e && e.nodeType === 1 && n < 6; e = e.parentNode, n++) {
      if (e.tagName === "BUTTON" || e.tagName === "OPTION" || e.tagName === "LABEL") return true;
      var role = e.getAttribute("role");
      if (role && CONTROL_ROLES[role]) return true;
      if (e.tagName === "A") return false;
    }
    return false;
  }

  function translateCore(text) {
    if (Object.prototype.hasOwnProperty.call(exact, text)) return exact[text];
    var words = text.match(wordRe);
    if (!words) return null;
    var seen = {};
    for (var w = 0; w < words.length; w++) {
      var key = words[w].toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      var list = byWord[key];
      if (!list) continue;
      for (var p = 0; p < list.length; p++) {
        var m = list[p].re.exec(text);
        if (!m) continue;
        var values = [];
        for (var g = 0; g < list[p].order.length; g++) {
          var v = m[g + 1];
          var tv = !isMediaText(v) && Object.prototype.hasOwnProperty.call(exact, v) ? exact[v] : v;
          values[list[p].order[g]] = tv;
        }
        return list[p].target.replace(/\{(\d+)\}/g, function (_, n) {
          return values[Number(n)] != null ? values[Number(n)] : "";
        });
      }
    }
    // Same text in other capitalisation ("SAVE" from CSS-free uppercase data).
    var lk = lowerExact[text.toLowerCase()];
    if (lk && text === text.toUpperCase()) return exact[lk].toUpperCase();
    return null;
  }

  function translate(value, el) {
    if (!value || !/[A-Za-z]/.test(value)) return null;
    var lead = value.match(/^\s*/)[0];
    var trail = value.match(/\s*$/)[0];
    var core = value.slice(lead.length, value.length - trail.length).replace(/\s+/g, " ");
    if (!core) return null;
    if (isMediaText(core) && !(el && inControl(el))) return null;
    var out = translateCore(core);
    if (out == null || out === core) return null;
    return lead + out + trail;
  }

  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP_TAGS[e.tagName]) return true;
      if (e.isContentEditable) return true;
      if (e.getAttribute("translate") === "no" || e.hasAttribute("data-no-translate")) return true;
    }
    return false;
  }

  var written = new WeakMap();

  function doText(node) {
    var v = node.nodeValue;
    if (written.get(node) === v) return;
    var parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || skipped(parent)) return;
    var t = translate(v, parent);
    if (t != null) {
      written.set(node, t);
      node.nodeValue = t;
    }
  }

  function doAttrs(el) {
    if (el.nodeType !== 1 || SKIP_TAGS[el.tagName]) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      // Artwork alt text is the media title; leave it alone.
      if (a === "alt" && el.tagName === "IMG") continue;
      var t = translate(el.getAttribute(a), el);
      if (t != null && !skipped(el)) el.setAttribute(a, t);
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type)) {
      var tv = translate(el.value, el);
      if (tv != null) el.value = tv;
    }
  }

  function walk(root) {
    if (root.nodeType === 3) {
      doText(root);
      return;
    }
    if (root.nodeType !== 1 || SKIP_TAGS[root.tagName]) return;
    doAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else doAttrs(n);
    }
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === "childList") {
        for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      } else if (r.type === "characterData") {
        doText(r.target);
      } else if (r.type === "attributes") {
        doAttrs(r.target);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS.concat(["value"]),
  });
  walk(document.documentElement);

  // Browser dialogs (window.confirm / alert / prompt) bypass the DOM.
  ["alert", "confirm", "prompt"].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function (msg) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof msg === "string") {
        var t = translate(msg);
        if (t != null) args[0] = t;
      }
      return orig.apply(window, args);
    };
  });

  window.__SILO_I18N_TRANSLATE = translate;
})();
