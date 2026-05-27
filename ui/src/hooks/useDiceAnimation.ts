import { useState, useEffect } from "react";

export function useDiceAnimation(
  finalValues: number[],
  duration = 600
): { animatedValues: number[]; settled: boolean } {
  const [animatedValues, setAnimatedValues] = useState<number[]>(finalValues.map(() => 1));
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!finalValues.length) return;
    setSettled(false);
    setAnimatedValues(finalValues.map(() => Math.ceil(Math.random() * 20)));

    const frames = Math.floor(duration / 50);
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      if (frame >= frames) {
        clearInterval(id);
        setAnimatedValues(finalValues);
        setSettled(true);
      } else {
        setAnimatedValues(finalValues.map((v) => {
          const r = Math.ceil(Math.random() * Math.max(v, 6));
          return r;
        }));
      }
    }, 50);

    return () => clearInterval(id);
  }, [JSON.stringify(finalValues), duration]); // eslint-disable-line react-hooks/exhaustive-deps

  return { animatedValues, settled };
}
