function parseSemver(value: string): { major: number; minor: number; patch: number; pre: string[]; build: string[] } {
  const cleaned = value.trim().replace(/^v/i, '');
  const [versionPart, ...rest] = cleaned.split('+');
  const [semver, preRaw] = versionPart.split('-');
  const parts = semver.split('.').map(p => {
    const m = p.match(/^\d+/);
    return m ? Number.parseInt(m[0], 10) : 0;
  });
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    pre: preRaw ? preRaw.split('.') : [],
    build: rest.length ? rest.join('+').split('.') : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const aNum = Number(a[i]);
    const bNum = Number(b[i]);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    }
    if (a[i] < b[i]) return -1;
    return 1;
  }
  return 0;
}

export function compareSemver(a: string, b: string): number {
  const sa = parseSemver(a);
  const sb = parseSemver(b);

  if (sa.major !== sb.major) return sa.major - sb.major;
  if (sa.minor !== sb.minor) return sa.minor - sb.minor;
  if (sa.patch !== sb.patch) return sa.patch - sb.patch;

  const aHasPre = sa.pre.length > 0;
  const bHasPre = sb.pre.length > 0;
  if (aHasPre && !bHasPre) return -1;
  if (!aHasPre && bHasPre) return 1;
  if (aHasPre && bHasPre) return comparePre(sa.pre, sb.pre);

  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
