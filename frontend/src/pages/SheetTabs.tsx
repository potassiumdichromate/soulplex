import { useEffect, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { withWorld } from "../world/WorldCanvas";

/**
 * Phone and tablet: the home screen becomes a bottom sheet with tabs (hidden on desktop).
 * Tap the open tab (or the arrow) to fold the sheet away and see the whole world.
 */
export function SheetTabs({
  tabs,
  tab,
  onTab,
  collapsed,
  onToggle,
}: {
  tabs: [string, ReactNode][];
  tab: string;
  onTab: (t: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="sheet-tabs glass" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id && !collapsed}
          className={tab === id && !collapsed ? "on" : ""}
          onClick={() => (tab === id ? onToggle() : onTab(id))}
        >
          {label}
        </button>
      ))}
      <button className="sheet-fold" onClick={onToggle} aria-label={collapsed ? "Show panel" : "Hide panel to see the islands"}>
        {collapsed ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
    </div>
  );
}

/** Tell the 3D camera how much of the screen the sheet covers, so islands and couples stay in view. */
export function useSheetInsets(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = "";
    const apply = () => {
      const r = el.getBoundingClientRect();
      const side = innerWidth > 760 && innerWidth <= 1100 && innerWidth > innerHeight; // landscape tablet: sheet on the left
      const insets = innerWidth > 1100 ? {} : side ? { left: Math.round(r.right / 8) * 8 } : { bottom: Math.round((innerHeight - r.top) / 8) * 8 };
      const key = JSON.stringify(insets);
      if (key === last) return;
      last = key;
      withWorld((w) => w.setInsets(insets));
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    addEventListener("resize", apply);
    apply();
    return () => {
      ro.disconnect();
      removeEventListener("resize", apply);
      withWorld((w) => w.setInsets({}));
    };
  }, []);
}
