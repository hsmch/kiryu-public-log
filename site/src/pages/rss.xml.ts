import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getUpdates } from '../lib/data';

export const prerender = true;

export function GET(context: APIContext) {
  const updates = getUpdates();
  const items = (updates?.entries ?? []).map((entry) => {
    // date は "令和7年2月25日" のような形式 → パース不要、pubDate は firstSeenAt を使う
    const pubDate = entry.firstSeenAt ? new Date(entry.firstSeenAt) : new Date();
    return {
      title: `${entry.title}`,
      link: entry.url,
      pubDate,
      description: `[${entry.label}] ${entry.title}`,
    };
  });

  return rss({
    title: 'Kiryu Public Log',
    description: '桐生市の市政・議会情報アーカイブ - 新着情報',
    site: context.site!.toString(),
    items,
    customData: '<language>ja</language>',
  });
}
