// Pure helpers for the web form settings dialog (M2-T2).

/** "field = target" per line → mapping; returns the 1-based numbers of lines it couldn't read. */
export function parseMapping(text: string): { mapping: Record<string, string>; bad: number[] } {
  const mapping: Record<string, string> = {};
  const bad: number[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const [field, target, ...rest] = line.split('=').map((part) => part.trim());
    if (!field || !target || rest.length > 0) bad.push(i + 1);
    else mapping[field] = target;
  });
  return { mapping, bad };
}

/** The snippet customers paste: loaded through this app's same-origin API proxy. */
export function embedSnippet(appOrigin: string, publicKey: string): string {
  return [
    `<script src="${appOrigin}/api/v1/public/embed.js" data-revops-key="${publicKey}" async></script>`,
    '<form data-revops-form>',
    '  <input name="name" placeholder="Your name" required>',
    '  <input name="phone" type="tel" placeholder="Phone">',
    '  <input name="email" type="email" placeholder="Email">',
    '  <button type="submit">Send</button>',
    '</form>',
  ].join('\n');
}

/** Where an API source's sender posts signed deliveries (M2-T3), through the app's API proxy. */
export function webhookUrl(appOrigin: string, publicKey: string): string {
  return `${appOrigin}/api/v1/public/webhooks/${publicKey}`;
}
