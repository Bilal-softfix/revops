// Copy for the leads CSV export (M1-T6).

export const leadExportStrings = {
  button: 'Export CSV',
  exporting: 'Exporting…',
  started: 'Export downloaded',
  tooLarge: (limit: number, count: number) =>
    `${count.toLocaleString('en-IN')} leads match — exports are limited to ${limit.toLocaleString('en-IN')}. Narrow the filters and try again.`,
  tooLargeFallback: 'Too many leads to export. Narrow the filters and try again.',
  fallbackFilename: 'leads.csv',
};
