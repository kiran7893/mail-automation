export interface CleanEmailLink {
  href: string;
  label: string;
}

export type CleanEmailPart =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'link'; link: CleanEmailLink }
  | { type: 'separator' };

export interface CleanEmail {
  hiddenFooter: CleanEmailPart[];
  hiddenLineCount: number;
  linksCollapsed: number;
  rawText: string;
  visible: CleanEmailPart[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;
const INVISIBLE_PATTERN = /[\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const SEPARATOR_PATTERN = /^[-_=~]{8,}$/;
const DECORATION_PATTERN = /^(=>|→|↗)$/;

const FOOTER_PATTERNS = [
  /unsubscribe/i,
  /you are receiving/i,
  /this email was intended for/i,
  /learn why we included this/i,
  /linkedin corporation/i,
  /registered trademarks/i,
  /help:\s*https?:/i,
  /stand out and let hirers/i,
  /tell us what you think/i,
  /did you find this e-?mail useful/i,
  /privacy policy/i,
  /terms of service/i,
];

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function cleanDisplayText(value: string): string {
  return decodeEntities(value)
    .replace(INVISIBLE_PATTERN, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function compactUrl(rawUrl: string): string {
  return rawUrl.replace(/[.,;:]+$/, '');
}

function readableUrlLabel(line: string, url: string, index: number): string {
  const withoutUrl = line.replace(url, '').replace(/\s+/g, ' ').trim();
  const prefix = withoutUrl.replace(/[:\-–—]+$/, '').trim();
  if (prefix && prefix.length <= 48) return prefix;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (/linkedin\.com/i.test(host) && /\/jobs\/view|\/comm\/jobs\/view/.test(parsed.pathname)) {
      return 'View job';
    }
    if (/linkedin\.com/i.test(host) && /\/jobs\/search|search-results/.test(parsed.pathname)) {
      return 'See all jobs';
    }
    if (/xing\.com/i.test(host) && /browser/i.test(line)) return 'View message in browser';
    if (/xing\.com/i.test(host) && /search|jobs/i.test(parsed.pathname)) return 'Show search results';
    return host;
  } catch {
    return `Link ${index + 1}`;
  }
}

function cleanLinkHref(url: string): string {
  try {
    const parsed = new URL(url);
    if (
      /linkedin\.com$/i.test(parsed.hostname) ||
      parsed.search.length > 80 ||
      /tracking|token|utm|midToken|trk/i.test(parsed.search)
    ) {
      parsed.search = '';
      parsed.hash = '';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function shouldHideLine(line: string, footerStarted: boolean): boolean {
  if (footerStarted) return true;
  return FOOTER_PATTERNS.some((pattern) => pattern.test(line));
}

function hasUrl(line: string): boolean {
  return /https?:\/\/[^\s<>"')]+/i.test(line);
}

function pushParagraph(target: CleanEmailPart[], lines: string[]): void {
  const cleanLines = lines
    .map(cleanDisplayText)
    .filter((line) => line && !DECORATION_PATTERN.test(line));
  if (cleanLines.length > 0) target.push({ type: 'paragraph', lines: cleanLines });
}

function addLineParts(
  target: CleanEmailPart[],
  line: string,
  linksCollapsed: { count: number },
): void {
  if (SEPARATOR_PATTERN.test(line.replace(/\s/g, ''))) {
    target.push({ type: 'separator' });
    return;
  }

  const urls = Array.from(line.matchAll(URL_PATTERN), (match) => compactUrl(match[0]));
  if (urls.length === 0) {
    pushParagraph(target, [line]);
    return;
  }

  const remainingText = cleanDisplayText(line.replace(URL_PATTERN, ''))
    .replace(/[:\-–—]+$/, '')
    .trim();
  let remainingTextRendered = false;

  for (const url of urls) {
    const label = readableUrlLabel(line, url, linksCollapsed.count);
    if (
      remainingText &&
      !remainingTextRendered &&
      !urls.some((candidate) => remainingText.toLowerCase() === readableUrlLabel(line, candidate, linksCollapsed.count).toLowerCase())
    ) {
      pushParagraph(target, [remainingText]);
      remainingTextRendered = true;
    }
    target.push({
      type: 'link',
      link: {
        href: cleanLinkHref(url),
        label,
      },
    });
    linksCollapsed.count += 1;
  }
}

export function cleanEmailForDisplay(rawText: string): CleanEmail {
  const normalized = rawText.replace(/\r\n?/g, '\n');
  const visible: CleanEmailPart[] = [];
  const hiddenFooter: CleanEmailPart[] = [];
  const linksCollapsed = { count: 0 };
  let paragraph: string[] = [];
  let hiddenParagraph: string[] = [];
  let footerStarted = false;
  let hiddenLineCount = 0;

  function flushVisible(): void {
    pushParagraph(visible, paragraph);
    paragraph = [];
  }

  function flushHidden(): void {
    pushParagraph(hiddenFooter, hiddenParagraph);
    hiddenParagraph = [];
  }

  for (const rawLine of normalized.split('\n')) {
    const line = cleanDisplayText(rawLine);
    if (!line) {
      flushVisible();
      flushHidden();
      continue;
    }
    if (DECORATION_PATTERN.test(line)) continue;

    const hideLine = shouldHideLine(line, footerStarted);
    footerStarted = footerStarted || hideLine;
    if (hideLine) {
      flushVisible();
      hiddenLineCount += 1;
      if (SEPARATOR_PATTERN.test(line.replace(/\s/g, ''))) {
        flushHidden();
        hiddenFooter.push({ type: 'separator' });
      } else if (hasUrl(line)) {
        flushHidden();
        addLineParts(hiddenFooter, line, linksCollapsed);
      } else {
        hiddenParagraph.push(line);
      }
      continue;
    }

    if (SEPARATOR_PATTERN.test(line.replace(/\s/g, '')) || hasUrl(line)) {
      flushVisible();
      addLineParts(visible, line, linksCollapsed);
      continue;
    }

    paragraph.push(line);
  }

  flushVisible();
  flushHidden();

  return {
    hiddenFooter,
    hiddenLineCount,
    linksCollapsed: linksCollapsed.count,
    rawText: normalized,
    visible,
  };
}
