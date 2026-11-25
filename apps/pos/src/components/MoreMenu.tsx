export interface MoreItem {
  id: string;
  label: string;
  /** SVG path (24x24, stroked). */
  icon: string;
  color: string;
}

/** The "•••" launcher on the sale screen: a panel of colored tiles above the bottom bar. */
export function MoreMenu({ items, onPick, onClose }: { items: MoreItem[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="more-backdrop" onClick={onClose}>
      <div className="more-menu" role="menu" onClick={(e) => e.stopPropagation()}>
        {items.map((i) => (
          <button key={i.id} role="menuitem" className="more-item" onClick={() => onPick(i.id)}>
            <span className="more-icon" style={{ background: i.color }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={i.icon} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>{i.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const ICON = {
  activity: 'M7 3h10v18H7zM10 7h4M10 11h4M10 15h3',
  report: 'M12 3a9 9 0 1 0 9 9h-9zM14 3.3A9 9 0 0 1 20.7 10H14z',
  staff: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M17 14a5 5 0 0 1 4 6',
  cash: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.5-2.6-1.5M12 6.5V8M12 16v1.5',
  menu: 'M4 6h16M4 12h16M4 18h10',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M3 12h2m14 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};
