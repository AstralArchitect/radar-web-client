/**
 * Cloudflare Pages Function - Proxy de tuiles cartographiques CartoDB
 * Route: /api/tiles/*
 */

export async function onRequest(context) {
  const { request, env, params } = context;

  // Reconstitue le chemin demandé (ex: "dark_all/5/16/11@2x.png")
  const rawPath = params.catchall;
  const pathSegments = Array.isArray(rawPath) 
    ? rawPath.join('/') 
    : (rawPath || '');

  if (!pathSegments) {
    return new Response('Chemin de tuile manquant', { status: 400 });
  }

  // Sous-domaines Carto CDN (a, b, c, d)
  const subdomains = ['a', 'b', 'c', 'd'];
  const subdomain = subdomains[Math.floor(Math.random() * subdomains.length)];

  // URL cible CartoDB
  const targetUrl = new URL(`https://${subdomain}.basemaps.cartocdn.com/${pathSegments}`);
  
  // Injection de la clé d'API secrète depuis les variables d'environnement Cloudflare
  if (env.CARTO_API_KEY) {
    targetUrl.searchParams.set('api_key', env.CARTO_API_KEY);
  }

  try {
    // Requête vers CartoDB avec mise en cache CDN Cloudflare (7 jours)
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'CloudflarePages-TileProxy'
      },
      cf: {
        cacheTtl: 604800,
        cacheEverything: true
      }
    });

    // Configuration des en-têtes de cache pour le navigateur client
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(`Erreur proxy tuiles: ${error.message}`, { status: 502 });
  }
}

