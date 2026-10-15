// Explicit scopes work even in a checkout without Git. Sampling supplements
// changed-feature tests; it never replaces a safety-sensitive suite.
export const checkAreas = {
  ui: ["scripts/chromePreferences.test.mjs", "server/editorGeometry.test.ts", "server/paneZoom.test.ts"],
  queue: ["server/attention.test.ts", "server/queueEntries.test.ts", "server/projectQueue.test.ts"],
  presentation: ["scripts/chromePreferences.test.mjs", "server/headings.test.ts", "server/turbo.test.ts", "server/selectionPassages.test.ts"],
  desktop: ["scripts/desktopServer.test.mjs", "scripts/desktopLauncher.test.mjs", "server/startup.test.ts"],
  files: null, source: null, storage: null, compiler: null, research: null, models: null, harness: null,
};

export function testFiles(scripts) {
  const result = new Set();
  for (const [name, command] of Object.entries(scripts)) {
    if (name !== "test" && !name.startsWith("test:")) continue;
    if (!command.startsWith("node --test ")) throw new Error(`Unsupported test script: ${name}`);
    for (const file of command.slice("node --test ".length).trim().split(/\s+/)) {
      if (!/^[\w./-]+\.test\.(?:ts|mjs)$/.test(file)) throw new Error(`Unsupported test path: ${file}`);
      result.add(file);
    }
  }
  return [...result].sort();
}

export function checkPlan({ areas = [], full = false, cursor = 0, tests = [], changed = [] }) {
  if (!full && !areas.length) throw new Error("Choose --area ui, queue, presentation or desktop; use --full for a checkpoint.");
  for (const area of areas) if (!Object.hasOwn(checkAreas, area)) throw new Error(`Unknown check area: ${area}`);
  // Unclassified source/backend/config edits are deliberately conservative.
  const routine = /^(?:src\/(?:components\/|styles\.css$|attention\.ts$|queueEntries\.ts$|chromePreferences\.ts$|hoverIntent\.ts$|paneZoom\.ts$|editorGeometry\.ts$|headingHierarchy\.ts$|turbo\.ts$)|scripts\/(?:checkChanges|checkPlan|desktopLauncher|desktopServer)\.(?:mjs|test\.mjs)$)/;
  const sensitive = changed.some(file => !routine.test(file.replaceAll("\\", "/")) && !/\.test\.(?:mjs|ts)$|\.md$/.test(file));
  const broad = full || sensitive || areas.some(area => checkAreas[area] === null);
  const targeted = new Set(broad ? tests : areas.flatMap(area => checkAreas[area]));
  for (const file of changed.filter(file => /\.test\.(?:mjs|ts)$/.test(file))) targeted.add(file.replaceAll("\\", "/"));
  for (const file of targeted) if (!tests.includes(file)) throw new Error(`Test is not in package.json: ${file}`);
  const pool = tests.filter(file => !targeted.has(file));
  const round = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const sampled = broad ? [] : Array.from({ length: Math.min(2, pool.length) }, (_, index) => pool[(round * 2 + index) % pool.length]);
  return { broad, targeted: [...targeted].sort(), sampled, files: [...targeted, ...sampled].sort(), nextCursor: round + 1 };
}
