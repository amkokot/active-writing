import path from 'node:path';

// Research has separate guarded refresh paths. Never watch uploaded books or
// research stores: OneDrive can temporarily lock these files.
export function developmentWatchIgnored(root, filename) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  if (!relative) return false;
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return true;
  const parts = relative.replaceAll('\\', '/').split('/');
  if (['src', 'server', 'scripts', 'public'].includes(parts[0])) return false;
  return parts.length !== 1 || !/^(?:index\.html|vite\.config\.[cm]?[jt]s|package(?:-lock)?\.json|tsconfig(?:\.[\w-]+)?\.json)$/.test(parts[0]);
}
