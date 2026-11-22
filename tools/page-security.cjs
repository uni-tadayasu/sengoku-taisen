'use strict';

// The download can also run directly from file://. Network-served pages cannot
// load local file URLs. Images use data URLs for icons and blob URLs for crops.
function pageSecurity(config) {
  const match = /window\.SENGOKU_API_BASE\s*=\s*['"]([^'"]*)['"]/.exec(config);
  if (!match) throw Error('config.js must declare the public API base URL');
  let api = '';
  if (match[1]) {
    const url = new URL(match[1]);
    const localHTTP = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHTTP) || url.username || url.password || url.search || url.hash) {
      throw Error('config.js must use an HTTPS API endpoint or local development server');
    }
    api = ' ' + url.origin;
  }
  return (html, game) => {
    const services = game ? api : '';
    const policy = [
      "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'", "form-action 'none'",
      "script-src 'self' file:", "script-src-attr 'none'", "style-src 'self' file: 'unsafe-inline'",
      "font-src 'self' file:", "img-src 'self' file: data: blob:" + services, "media-src 'self' file: blob: mediastream:",
      "manifest-src 'self' file:", "worker-src 'self'", "connect-src 'self' file:" + services
    ].join('; ');
    const tags = '\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">' +
      '\n  <meta name="referrer" content="no-referrer">';
    return html.replace(/\n[ \t]*<meta (?:http-equiv="Content-Security-Policy"|name="referrer") [^>]*>/gi, '')
      .replace(/<meta charset="utf-8">/i, '$&' + tags);
  };
}
module.exports = {pageSecurity};
