import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { normalizeCommentMeasurement } from "./document-comments";

/** Measure keyed rail cards while retaining the last height when a card is temporarily unmeasurable. */
export function useRailItemHeights(keys: readonly string[]) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [heights, setHeights] = useState<Record<string, number>>({});

  const setRef = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) refs.current.set(key, node);
    else refs.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    const updateHeights = () => {
      setHeights((current) => {
        const next: Record<string, number> = {};
        for (const key of keys) {
          const measured = Math.ceil(
            refs.current.get(key)?.getBoundingClientRect().height ?? 0,
          );
          next[key] =
            measured > 0
              ? Math.ceil(normalizeCommentMeasurement(measured, 1))
              : (current[key] ?? 0);
        }
        if (
          Object.keys(current).length === Object.keys(next).length &&
          keys.every((key) => current[key] === next[key])
        )
          return current;
        return next;
      });
    };

    updateHeights();
    if (keys.length === 0) return;
    const observer = new ResizeObserver(updateHeights);
    for (const key of keys) {
      const element = refs.current.get(key);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [keys]);

  return { heights, setRef };
}
