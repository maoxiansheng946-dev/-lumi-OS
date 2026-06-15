import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewportState } from './types';

const MIN_SCALE = 0.15;
const MAX_SCALE = 3.5;

export function useCanvasPanZoom(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const [isAutoNavigating, setIsAutoNavigating] = useState(false);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const spaceDown = useRef(false);
  const lastManualInteractionAt = useRef(0);
  const autoNavigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopAutoNavigation = useCallback(() => {
    if (autoNavigationTimer.current) {
      clearTimeout(autoNavigationTimer.current);
      autoNavigationTimer.current = null;
    }
    setIsAutoNavigating(false);
  }, []);

  const recordManualInteraction = useCallback(() => {
    lastManualInteractionAt.current = Date.now();
    stopAutoNavigation();
  }, [stopAutoNavigation]);

  const resetView = useCallback(() => {
    recordManualInteraction();
    setViewport({ scale: 1, translateX: 0, translateY: 0 });
  }, [recordManualInteraction]);

  const wasRecentlyManual = useCallback((withinMs = 2500) => {
    return isPanning.current || Date.now() - lastManualInteractionAt.current < withinMs;
  }, []);

  const focusOnRect = useCallback((
    rect: { x: number; y: number; width: number; height: number },
    options: { anchorX?: number; anchorY?: number; scale?: number } = {},
  ) => {
    const container = containerRef.current;
    if (!container) return;

    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, options.scale ?? viewport.scale));
    const focusX = rect.x + rect.width / 2;
    const focusY = rect.y + rect.height / 2;

    setIsAutoNavigating(true);
    if (autoNavigationTimer.current) clearTimeout(autoNavigationTimer.current);
    autoNavigationTimer.current = setTimeout(() => {
      setIsAutoNavigating(false);
      autoNavigationTimer.current = null;
    }, 320);

    setViewport({
      scale: nextScale,
      translateX: container.clientWidth * (options.anchorX ?? 0.42) - focusX * nextScale,
      translateY: container.clientHeight * (options.anchorY ?? 0.48) - focusY * nextScale,
    });
  }, [containerRef, viewport.scale]);

  useEffect(() => {
    return () => {
      if (autoNavigationTimer.current) clearTimeout(autoNavigationTimer.current);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spaceDown.current = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      recordManualInteraction();
      // Trackpad pinch → zoom; normal scroll → pan
      if (e.ctrlKey || e.metaKey) {
        setViewport(prev => {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
          const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * zoomFactor));
          const scaleRatio = newScale / prev.scale;
          return {
            scale: newScale,
            translateX: mouseX - (mouseX - prev.translateX) * scaleRatio,
            translateY: mouseY - (mouseY - prev.translateY) * scaleRatio,
          };
        });
      } else {
        // Normal scroll → pan vertically; shift+scroll → pan horizontally
        setViewport(prev => ({
          ...prev,
          translateX: prev.translateX - (e.shiftKey ? e.deltaY : e.deltaX),
          translateY: prev.translateY - (e.shiftKey ? e.deltaX : e.deltaY),
        }));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      // Middle button always pans
      if (e.button === 1) {
        e.preventDefault();
        recordManualInteraction();
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, tx: viewport.translateX, ty: viewport.translateY };
        return;
      }
      // Left button: pan if clicking empty canvas (not a card), or if holding space
      if (e.button === 0) {
        const target = e.target as HTMLElement;
        const isCard = target.closest('[data-canvas-card]');
        const isControl = target.closest('button, input, [data-no-pan]');
        if (isCard || isControl) return; // let cards and controls handle their own clicks
        // Empty space click → pan
        e.preventDefault();
        recordManualInteraction();
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, tx: viewport.translateX, ty: viewport.translateY };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning.current) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setViewport(prev => ({
        ...prev,
        translateX: panStart.current.tx + dx,
        translateY: panStart.current.ty + dy,
      }));
    };

    const onMouseUp = () => {
      isPanning.current = false;
    };

    // Trackpad pinch gesture
    const onGestureStart = (e: Event) => e.preventDefault();

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('gesturestart', onGestureStart);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('gesturestart', onGestureStart);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [containerRef, recordManualInteraction, viewport]);

  const viewportStyle: React.CSSProperties = {
    transform: `translate(${viewport.translateX}px, ${viewport.translateY}px) scale(${viewport.scale})`,
    transformOrigin: '0 0',
    transition: isAutoNavigating ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
  };

  return { ...viewport, viewportStyle, resetView, focusOnRect, wasRecentlyManual };
}
