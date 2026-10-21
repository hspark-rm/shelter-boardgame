// 씨앗 고정 난수(mulberry32). 상태 안에 정수 하나로 들고 다녀서, 같은 상태면 같은 결과가 나온다.

export function nextRandom(seed        )                   {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

export function shuffleWith   (holder                 , items     )      {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const [u, next] = nextRandom(holder.rng);
    holder.rng = next;
    const j = Math.floor(u * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
