const fallbackBody = "mignon est en cours de chargement.";

export default {
  async fetch(request, env) {
    if (!env?.ASSETS?.fetch) {
      return new Response(fallbackBody, {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/") url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
