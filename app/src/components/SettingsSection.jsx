export function SettingsSection({ icon: Icon, title, description, children }) {
  return (
    <div className="card bg-base-200">
      <div className="card-body p-4 gap-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          {Icon && <Icon className="size-4 opacity-50" />}
          {title}
        </h3>
        {description && <p className="text-xs opacity-50">{description}</p>}
        {children}
      </div>
    </div>
  );
}
