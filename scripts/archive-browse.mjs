const typeOrder = ['Oral history', 'Publication', 'Archival item'];

const typeLabels = {
  'Oral history': 'Oral histories',
  Publication: 'Publications',
  'Archival item': 'Archival materials',
};

const compareTitles = (a, b) => a.title.localeCompare(b.title, 'en', {
  sensitivity: 'base',
  ignorePunctuation: true,
  numeric: true,
});

export function groupArchiveRecords(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.kind)) grouped.set(record.kind, []);
    grouped.get(record.kind).push(record);
  }

  return [...grouped].sort(([a], [b]) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'en', { sensitivity: 'base' });
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }).map(([kind, entries]) => ({
    kind,
    label: typeLabels[kind] || kind,
    entries: [...entries].sort(compareTitles),
  }));
}
