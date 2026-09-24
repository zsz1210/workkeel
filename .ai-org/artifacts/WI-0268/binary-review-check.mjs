// Compare exact path/digest inventories without reading or retaining file content.
export function binaryReviewDifferences(expected, actual, provenance = new Map()) {
  const differences = { stale: [], new: [], missing: [], tampered: [] };
  for (const [pathname, digest] of actual) {
    if (!expected.has(pathname)) differences.new.push(pathname);
    else if (expected.get(pathname) !== digest) differences.tampered.push(pathname);
  }
  for (const [pathname, digest] of expected) {
    if (!actual.has(pathname)) differences.missing.push(pathname);
    if (provenance.has(pathname) && provenance.get(pathname) !== digest) differences.stale.push(pathname);
  }
  for (const paths of Object.values(differences)) paths.sort();
  return differences;
}
