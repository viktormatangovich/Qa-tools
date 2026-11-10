import { createElement, lazy, Suspense, type ComponentType } from 'react';

/**
 * Wraps a named export as a component that is downloaded on first render.
 * Used for dialogs and tabs most sessions never open, so they stay out of the start-up bundle.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await load() })) as unknown as ComponentType<P>;
  return function LazyBoundary(props: P) {
    return <Suspense fallback={null}>{createElement(Lazy, props)}</Suspense>;
  };
}
