export function selectLod(dist, maxDists, current = -2, hysteresis = 0.12) {
  const n = maxDists.length;
  let want = n;
  for (let i = 0; i < n; i++) {
    if (dist <= maxDists[i]) {
      want = i;
      break;
    }
  }
  if (current === -2) return want === n ? -1 : want;
  const cur = current === -1 ? n : current;
  if (want === cur) return current;
  const next = want === n ? -1 : want;
  if (want > cur) return dist > maxDists[cur] * (1 + hysteresis) ? next : current;
  return dist < maxDists[want] * (1 - hysteresis) ? next : current;
}
