/**
 * robots.txt を静的生成する。sitemapは絶対URLでしか書けないため、
 * public/ に置かず astro.config.ts の site（= SITE_URL）から組み立てる。
 * これでcanonical・RSS・sitemapと同じ1つの値に追従する。
 */
export function GET(context: { site?: URL }) {
  const site = context.site ?? new URL('http://localhost:4321');
  const body = `User-agent: *
Allow: /

Sitemap: ${new URL('sitemap-index.xml', site).href}
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
