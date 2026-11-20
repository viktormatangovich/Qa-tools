import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import { prefixOffsets, VIRTUALIZE_FROM, visibleRange } from '../../utils/virtualList';

interface VirtualRowsProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  /** Height used until a row has been measured. */
  estimateHeight: (item: T) => number;
  render: (item: T) => ReactNode;
  /** The element that scrolls (must be `position: relative`, so offsetTop is measured from it). */
  scrollRef: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Renders only the rows near the viewport once a list is long; row heights are measured as they
 * appear, so rows of different heights (tags, notes, group headers) are fine.
 */
export function VirtualRows<T>({ items, keyOf, estimateHeight, render, scrollRef, className }: VirtualRowsProps<T>) {
  const virtual = items.length >= VIRTUALIZE_FROM;
  const container = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [, remeasured] = useReducer((count: number) => count + 1, 0);
  const frame = useRef(0);

  const readViewport = useCallback(() => {
    const scroller = scrollRef.current;
    const list = container.current;
    if (!scroller || !list) return;
    setViewport((previous) => {
      const top = Math.max(0, scroller.scrollTop - list.offsetTop);
      const height = scroller.clientHeight;
      return previous.top === top && previous.height === height ? previous : { top, height };
    });
  }, [scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!virtual || !scroller) return;
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(readViewport);
    };
    readViewport();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const resize = new ResizeObserver(onScroll);
    resize.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      resize.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [virtual, scrollRef, readViewport]);

  // One observer measures every rendered row.
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (!virtual) return;
    observer.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.rowKey;
        const height = Math.round((entry.target as HTMLElement).offsetHeight);
        if (key && height && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) remeasured();
    });
    return () => observer.current?.disconnect();
  }, [virtual]);

  const rowRef = useCallback((element: HTMLDivElement | null) => {
    if (element) observer.current?.observe(element);
  }, []);

  useLayoutEffect(() => {
    if (virtual) readViewport();
  }, [virtual, items.length, readViewport]);

  if (!virtual) {
    return <div className={className}>{items.map((item) => <div key={keyOf(item)}>{render(item)}</div>)}</div>;
  }

  const offsets = prefixOffsets(items.map((item) => heights.current.get(keyOf(item)) ?? estimateHeight(item)));
  const [start, end] = visibleRange(offsets, viewport.top, viewport.height);
  const total = offsets[offsets.length - 1];

  return (
    <div ref={container} style={{ height: total, position: 'relative' }}>
      <div className={className} style={{ position: 'absolute', top: offsets[start], left: 0, right: 0 }}>
        {items.slice(start, end).map((item) => {
          const key = keyOf(item);
          return (
            <div key={key} data-row-key={key} ref={rowRef}>
              {render(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
