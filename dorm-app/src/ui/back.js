import { useEffect, useRef } from "react";

const stack = [];

export function pushBackHandler(fn) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function runBackHandler() {
  const fn = stack[stack.length - 1];
  if (!fn) return false;
  fn();
  return true;
}

export function useBackClose(active, onClose) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => cb.current?.());
  }, [active]);
}
