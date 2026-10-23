export interface TopicColor {
  main: string;
  soft: string;
}

/** Distinct palette — same topic id always maps to the same color. */
const TOPIC_PALETTE: readonly TopicColor[] = [
  { main: '#0284c7', soft: 'rgba(2, 132, 199, 0.14)' },
  { main: '#7c3aed', soft: 'rgba(124, 58, 237, 0.14)' },
  { main: '#059669', soft: 'rgba(5, 150, 105, 0.14)' },
  { main: '#db2777', soft: 'rgba(219, 39, 119, 0.14)' },
  { main: '#d97706', soft: 'rgba(217, 119, 6, 0.14)' },
  { main: '#0891b2', soft: 'rgba(8, 145, 178, 0.14)' },
  { main: '#4f46e5', soft: 'rgba(79, 70, 229, 0.14)' },
  { main: '#ca8a04', soft: 'rgba(202, 138, 4, 0.14)' },
  { main: '#0d9488', soft: 'rgba(13, 148, 136, 0.14)' },
  { main: '#9333ea', soft: 'rgba(147, 51, 234, 0.14)' },
  { main: '#ea580c', soft: 'rgba(234, 88, 12, 0.14)' },
  { main: '#2563eb', soft: 'rgba(37, 99, 235, 0.14)' },
];

function hashTopicId(topicId: string): number {
  let hash = 0;
  for (let i = 0; i < topicId.length; i++) {
    hash = (hash * 31 + topicId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getTopicColor(topicId: string): TopicColor {
  const index = hashTopicId(topicId) % TOPIC_PALETTE.length;
  return TOPIC_PALETTE[index];
}

export function getTopicColorCssVars(topicId: string): Record<string, string> {
  const { main, soft } = getTopicColor(topicId);
  return {
    '--sr-topic-color': main,
    '--sr-topic-soft': soft,
  };
}

export function applyTopicColorStyles(element: HTMLElement, topicId: string): void {
  const vars = getTopicColorCssVars(topicId);
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value);
  }
}
