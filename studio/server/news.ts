import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { NewsItem } from "../shared/news-brief";

// Reads headlines from a news source the user names: an RSS/Atom feed, or a single article
// page (its Open Graph title and description). Only the headline, the publisher's own short
// summary and the link are kept, never the article body; the bulletin shows the source.

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MAX_ITEMS = 30;

export class NewsError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text content of an XML/HTML fragment: CDATA unwrapped, tags dropped, entities decoded, spaces collapsed. */
export function plainText(s: string): string {
  const unwrapped = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Feeds often HTML-escape the HTML inside <description>; decode once, strip tags, decode again.
  const once = /&lt;[a-z/!]/i.test(unwrapped) ? decodeEntities(unwrapped) : unwrapped;
  return decodeEntities(once.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** "TRT Haber Manşet Haberleri" → "TRT Haber", "Anadolu Ajansı Güncel Haberler" → "Anadolu Ajansı": fits the lower third. */
export function shortSource(name: string): string {
  const generic = /\s+(?:-|–|\||:)?\s*(?:haberleri|haberler|manşet|manşetler|güncel|son dakika|rss|feed|news|latest|top stories|headlines)$/iu;
  let s = name.trim();
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(generic, "").trim();
  }
  return s || name.trim();
}

function tag(xml: string, names: string[]): string | undefined {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(xml);
    if (m) return m[1];
  }
  return undefined;
}

function atomLink(entry: string): string | undefined {
  const links = [...entry.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => !/rel=["'](?!alternate)/i.test(a)) ?? links[0];
  return pick ? /href=["']([^"']+)["']/i.exec(pick)?.[1] : undefined;
}

function absolute(link: string | undefined, base: string): string {
  if (!link) return base;
  try {
    return new URL(decodeEntities(link.trim()), base).toString();
  } catch {
    return base;
  }
}

/** RSS 2.0 / RSS 1.0 / Atom. Returns null when the text is not a feed. */
export function parseFeed(xml: string, url: string): { source: string; items: NewsItem[] } | null {
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = isAtom ? [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)] : [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)];
  if (!blocks.length) return null;
  const head = xml.slice(0, blocks[0].index);
  const source = shortSource(plainText(tag(head, ["title"]) ?? "")) || new URL(url).hostname.replace(/^www\./, "");
  const items = blocks.slice(0, MAX_ITEMS).flatMap(([b]) => {
    const title = plainText(tag(b, ["title"]) ?? "");
    if (!title) return [];
    const summary = plainText(tag(b, ["description", "summary", "content:encoded", "content"]) ?? "");
    const link = isAtom ? atomLink(b) : (plainText(tag(b, ["link"]) ?? "") || tag(b, ["guid"]));
    const published = plainText(tag(b, ["pubDate", "published", "updated", "dc:date"]) ?? "") || undefined;
    return [{ title, summary: summary === title ? "" : summary, link: absolute(link, url), source, published }];
  });
  return { source, items };
}

function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    const k = /(?:property|name)=["']([^"']+)["']/i.exec(t)?.[1];
    if (k?.toLowerCase() === key) return /content=["']([^"']*)["']/i.exec(t)?.[1];
  }
  return undefined;
}

/** One article page: its Open Graph / meta title and description. */
export function parseArticle(html: string, url: string): { source: string; items: NewsItem[] } | null {
  const title = plainText(meta(html, "og:title") ?? tag(html, ["title"]) ?? "");
  if (!title) return null;
  const source = shortSource(plainText(meta(html, "og:site_name") ?? "")) || new URL(url).hostname.replace(/^www\./, "");
  const summary = plainText(meta(html, "og:description") ?? meta(html, "description") ?? "");
  const published = meta(html, "article:published_time");
  return { source, items: [{ title, summary, link: url, source, published }] };
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Only public http(s) hosts: the server must not be pointed at itself or the local network. */
async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new NewsError("Geçerli bir adres girin (https://...).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new NewsError("Yalnızca http ve https adresleri desteklenir.");
  if (url.username || url.password) throw new NewsError("Adreste kullanıcı adı veya parola olamaz.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new NewsError("Yerel adresler kullanılamaz.");
  let addrs: { address: string }[];
  try {
    addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new NewsError(`Sunucu bulunamadı: ${host}`);
  }
  if (addrs.some((a) => privateAddress(a.address))) throw new NewsError("Yerel ağ adresleri kullanılamaz.");
  return url;
}

function charset(contentType: string | null, head: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1];
  const fromDoc = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? /<meta[^>]*charset=["']?([\w-]+)/i.exec(head)?.[1];
  return (fromHeader ?? fromDoc ?? "utf-8").toLowerCase();
}

async function download(start: string): Promise<{ text: string; url: string }> {
  let url = await checkUrl(start);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "StickmanStudio/1.0 (RSS okuyucu)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8" },
      });
    } catch (e) {
      throw new NewsError(`Kaynağa ulaşılamadı: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new NewsError("Çok fazla yönlendirme.");
      // Every hop is checked again, so a redirect cannot lead into the local network.
      url = await checkUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new NewsError(`Kaynak hata döndürdü (HTTP ${res.status}).`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new NewsError("Kaynak çok büyük (3 MB sınırı).");
        }
        chunks.push(value);
      }
    }
    const bytes = Buffer.concat(chunks);
    const label = charset(res.headers.get("content-type"), bytes.subarray(0, 512).toString("latin1"));
    let text: string;
    try {
      text = new TextDecoder(label).decode(bytes);
    } catch {
      text = new TextDecoder("utf-8").decode(bytes);
    }
    return { text, url: url.toString() };
  }
}

export async function fetchNews(raw: string): Promise<{ source: string; items: NewsItem[] }> {
  const { text, url } = await download(raw);
  const parsed = parseFeed(text, url) ?? parseArticle(text, url);
  if (!parsed || !parsed.items.length) throw new NewsError("Bu adreste haber bulunamadı. Bir RSS/Atom adresi veya haber sayfası deneyin.");
  return parsed;
}
