/**
 * Uni — Google Chat app for UniFact
 *
 * Deploy as a Google Chat app (Apps Script → Deploy → New deployment → Chat add-on / Chat app).
 * Script properties:
 *   UNIFACT_URL  = https://staging.unifact.ai
 *   UNIFACT_API_KEY = person key for uniAgent
 *
 * Users @mention Uni in Chat spaces or DM Uni.
 */

var UNI_INSTRUCTIONS =
  'You are Uni (UniFact). Prefer published facts. Cite namespace/key. Never invent org policy. Propose only after confirmation.';

/**
 * Chat app entry: MESSAGE event.
 */
function onMessage(event) {
  var text = ((event && event.message && event.message.text) || '').trim();
  var space = event && event.space;
  // Strip @Uni / bot mention prefixes when present
  text = text.replace(/^@?\s*Uni\b[:,]?\s*/i, '').trim();
  if (!text) {
    return cardResponse_(
      'Hi — I am **Uni** (UniFact). Ask about published org truth.\n\nExample: `what is our return policy?`'
    );
  }

  if (/^(help|\?)$/i.test(text)) {
    return cardResponse_(
      '**@Uni** looks up governed facts.\n\n' +
        '• Ask a question → I search published UniFacts\n' +
        '• `propose ns/key = value` → create a **proposed** fact (human review)\n' +
        '• I never auto-publish'
    );
  }

  var proposeMatch = text.match(/^propose\s+([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\s*=\s*([\s\S]+)$/i);
  if (proposeMatch) {
    return handlePropose_(proposeMatch[1], proposeMatch[2], proposeMatch[3].trim(), space);
  }

  return handleSearch_(text, space);
}

function handleSearch_(query, space) {
  try {
    var data = unifactGet_('/v1/facts/_search?q=' + encodeURIComponent(query) + '&lookup=true');
    var results = (data && data.results) || [];
    var published = results.filter(function (f) {
      return f.registry_channel === 'published';
    });
    var use = published.length ? published : results.slice(0, 5);

    if (!use.length) {
      return cardResponse_(
        'I don’t have a UniFact for **' +
          escapeMd_(query) +
          '**.\n\nWant to propose one? Reply:\n`propose company.policy/example_key = your value`'
      );
    }

    var lines = use.slice(0, 5).map(function (f) {
      var path = '`' + f.namespace + '/' + f.key + '`';
      var channel = f.registry_channel || 'unknown';
      var label = channel === 'published' ? '**Published:**' : '**Draft (' + channel + '):**';
      var val = String(f.value == null ? '' : f.value);
      if (val.length > 400) val = val.slice(0, 400) + '…';
      return label + ' ' + path + '\n' + val;
    });

    var footer =
      published.length === 0
        ? '\n\n_No published match — drafts only. Do not treat as policy until published._'
        : '';

    return cardResponse_(lines.join('\n\n') + footer);
  } catch (err) {
    return cardResponse_('UniFact lookup failed: ' + String(err.message || err));
  }
}

function handlePropose_(namespace, key, value, space) {
  try {
    var body = {
      value: value,
      registry_channel: 'proposed',
      created_by: 'uni-agent',
      source: 'google-chat',
      evidence: { note: 'Proposed via @Uni Google Chat' },
      change_reason: 'Proposed from Google Chat @Uni'
    };
    var result = unifactPost_('/v1/facts/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(key), body);
    return cardResponse_(
      'Proposed **`' +
        namespace +
        '/' +
        key +
        '`** for human review (not published).\nAction: ' +
        (result && result.action ? result.action : 'ok')
    );
  } catch (err) {
    return cardResponse_('Propose failed: ' + String(err.message || err));
  }
}

function unifactGet_(path) {
  var base = PropertiesService.getScriptProperties().getProperty('UNIFACT_URL');
  var key = PropertiesService.getScriptProperties().getProperty('UNIFACT_API_KEY');
  if (!base || !key) {
    throw new Error('Set Script Properties UNIFACT_URL and UNIFACT_API_KEY');
  }
  var url = String(base).replace(/\/$/, '') + path;
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-API-Key': key, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + text.slice(0, 200));
  }
  return JSON.parse(text);
}

function unifactPost_(path, body) {
  var base = PropertiesService.getScriptProperties().getProperty('UNIFACT_URL');
  var key = PropertiesService.getScriptProperties().getProperty('UNIFACT_API_KEY');
  if (!base || !key) {
    throw new Error('Set Script Properties UNIFACT_URL and UNIFACT_API_KEY');
  }
  var url = String(base).replace(/\/$/, '') + path;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: { 'X-API-Key': key, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + text.slice(0, 200));
  }
  return JSON.parse(text);
}

function cardResponse_(markdown) {
  return {
    text: markdown
  };
}

function escapeMd_(s) {
  return String(s).replace(/[*_`]/g, '');
}

/**
 * Optional: HTTP GET for health from Apps Script web app deploy.
 */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, agent: 'Uni', product: 'UniFact' })
  ).setMimeType(ContentService.MimeType.JSON);
}
