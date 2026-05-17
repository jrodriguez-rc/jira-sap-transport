export function resolvePath(ctx: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export interface RawRender {
  text: string;
  warnings: string[];
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderRaw(template: string, ctx: unknown): RawRender {
  const warnings: string[] = [];
  const text = template.replace(TOKEN, (_, path: string) => {
    const value = resolvePath(ctx, path);

    if (value === null || value === undefined) {
      // Distinguish: present-but-null vs missing path
      if (!hasPath(ctx, path)) {
        warnings.push(`Path "${path}" not found`);
      }
      return '';
    }
    if (typeof value === 'object') {
      warnings.push(`Path "${path}" resolves to non-scalar value`);
      return '';
    }
    return String(value);
  });
  return { text, warnings };
}

function hasPath(ctx: unknown, path: string): boolean {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(part in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}
