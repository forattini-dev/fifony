import { NAV_ITEMS } from "./Header.jsx";

export function MobileDock({ view, setView }) {
  return (
    <div className="dock md:hidden">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={id === view ? "dock-active" : undefined}
          onClick={() => setView(id)}
        >
          <Icon className="size-[1.2em]" />
          <span className="dock-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

export default MobileDock;
