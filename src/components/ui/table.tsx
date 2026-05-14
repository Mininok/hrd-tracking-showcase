"use client";

import {
  useRef, useEffect, useState, useCallback,
  createContext, useContext, forwardRef,
  type ReactNode, type HTMLAttributes,
  type TdHTMLAttributes, type ThHTMLAttributes, type RefObject,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

const springs = { fast: { type: "spring" as const, duration: 0.08, bounce: 0 } };
const fontWeights = { normal: "'wght' 400", semibold: "'wght' 550" };

// ─── useProximityHover ────────────────────────────────────────

interface ItemRect { top: number; height: number; left: number; width: number; }

function useProximityHover<T extends HTMLElement>(containerRef: RefObject<T | null>) {
  const itemsRef    = useRef(new Map<number, HTMLElement>());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [itemRects,   setItemRects]   = useState<ItemRect[]>([]);
  const itemRectsRef  = useRef<ItemRect[]>([]);
  const sessionRef    = useRef(0);
  const rafIdRef      = useRef<number | null>(null);

  const registerItem = useCallback((index: number, element: HTMLElement | null) => {
    if (element) itemsRef.current.set(index, element);
    else         itemsRef.current.delete(index);
  }, []);

  const measureItems = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const rects: ItemRect[] = [];
    itemsRef.current.forEach((el, index) => {
      const r = el.getBoundingClientRect();
      rects[index] = {
        top:    r.top    - cr.top  + container.scrollTop  - container.clientTop,
        height: r.height,
        left:   r.left   - cr.left + container.scrollLeft - container.clientLeft,
        width:  r.width,
      };
    });
    itemRectsRef.current = rects;
    setItemRects(rects);
  }, [containerRef]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const mouseY = e.clientY;
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const cr = container.getBoundingClientRect();
      let closestIndex: number | null = null;
      let closestDistance = Infinity;
      const rects = itemRectsRef.current;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]; if (!r) continue;
        const start = cr.top + container.clientTop + r.top - container.scrollTop;
        const dist  = Math.abs(mouseY - (start + r.height / 2));
        if (dist < closestDistance) { closestDistance = dist; closestIndex = i; }
      }
      setActiveIndex(closestIndex);
    });
  }, [containerRef]);

  const handleMouseEnter = useCallback(() => { sessionRef.current += 1; }, []);
  const handleMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
    setActiveIndex(null);
  }, []);

  useEffect(() => { return () => { if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current); }; }, []);

  return { activeIndex, itemRects, sessionRef, handlers: { onMouseMove: handleMouseMove, onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }, registerItem, measureItems };
}

// ─── Context ──────────────────────────────────────────────────

interface TableContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex:  number | null;
}
const TableContext = createContext<TableContextValue | null>(null);

// ─── Table ────────────────────────────────────────────────────

interface TableProps extends HTMLAttributes<HTMLTableElement> { children: ReactNode; }

const Table = forwardRef<HTMLTableElement, TableProps>(({ children, className, style, ...props }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { activeIndex, itemRects, sessionRef, handlers, registerItem, measureItems } = useProximityHover(containerRef);

  useEffect(() => { measureItems(); }, [measureItems, children]);

  const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;

  return (
    <TableContext.Provider value={{ registerItem, activeIndex }}>
      <div
        ref={containerRef}
        style={{ position: "relative", overflowX: "auto" }}
        onMouseEnter={handlers.onMouseEnter}
        onMouseMove={handlers.onMouseMove}
        onMouseLeave={handlers.onMouseLeave}
      >
        <AnimatePresence>
          {activeRect && (
            <motion.div
              key={sessionRef.current}
              style={{
                position: "absolute",
                backgroundColor: "var(--surface-2)",
                border: "1px solid var(--border)",
                pointerEvents: "none",
                zIndex: 0,
                borderRadius: "var(--radius-md)",
              }}
              initial={{ opacity: 0, top: activeRect.top, left: activeRect.left, width: activeRect.width, height: activeRect.height }}
              animate={{ opacity: 1, top: activeRect.top, left: activeRect.left, width: activeRect.width, height: activeRect.height }}
              exit={{ opacity: 0, transition: { duration: 0.06 } }}
              transition={{ ...springs.fast, opacity: { duration: 0.08 } }}
            />
          )}
        </AnimatePresence>
        <table
          ref={ref}
          className={className}
          style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", position: "relative", ...style }}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
});
Table.displayName = "Table";

// ─── TableHeader ──────────────────────────────────────────────

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ ...props }, ref) => <thead ref={ref} {...props} />
);
TableHeader.displayName = "TableHeader";

// ─── TableBody ────────────────────────────────────────────────

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ ...props }, ref) => <tbody ref={ref} {...props} />
);
TableBody.displayName = "TableBody";

// ─── TableRow ─────────────────────────────────────────────────

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> { index?: number; }

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(({ index, className, style, ...props }, ref) => {
  const internalRef = useRef<HTMLTableRowElement>(null);
  const ctx = useContext(TableContext);

  useEffect(() => {
    if (index === undefined || !ctx) return;
    ctx.registerItem(index, internalRef.current);
    return () => ctx.registerItem(index, null);
  }, [index, ctx]);

  const isBodyRow  = index !== undefined;
  const activeIdx  = ctx?.activeIndex ?? null;
  const isActive   = isBodyRow && activeIdx === index;
  const hideBorder = activeIdx !== null && (
    (isBodyRow && (index === activeIdx || index === activeIdx - 1)) ||
    (!isBodyRow && activeIdx === 0)
  );

  return (
    <tr
      ref={(node) => {
        (internalRef as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
      }}
      data-proximity-index={index}
      className={["phtable-row", isActive ? "is-active" : "", className].filter(Boolean).join(" ")}
      style={{
        position: "relative",
        zIndex: 10,
        borderBottom: hideBorder ? "1px solid transparent" : "1px solid var(--border)",
        transition: "border-color 80ms",
        fontVariationSettings: isBodyRow ? fontWeights.normal : fontWeights.semibold,
        ...style,
      }}
      {...props}
    />
  );
});
TableRow.displayName = "TableRow";

// ─── TableHead ────────────────────────────────────────────────

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ style, ...props }, ref) =>
    <th
      ref={ref}
      style={{
        padding: "10px 12px",
        textAlign: "left",
        fontSize: "11px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-secondary)",
        ...style,
      }}
      {...props}
    />
);
TableHead.displayName = "TableHead";

// ─── TableCell ────────────────────────────────────────────────

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ style, ...props }, ref) =>
    <td
      ref={ref}
      className="phtable-cell"
      style={{
        padding: "10px 12px",
        color: "var(--text-secondary)",
        transition: "color 75ms",
        ...style,
      }}
      {...props}
    />
);
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
