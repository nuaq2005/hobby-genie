// Proxies all /api requests (including full-page OAuth redirects, which the
// simple "proxy" string in package.json skips because they send Accept: text/html)
// to the Express server so the auth cookie stays on the client origin.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: process.env.SERVER_URL || 'http://localhost:4000',
      changeOrigin: true,
    })
  );
};
