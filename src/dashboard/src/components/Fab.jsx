import { Plus } from "lucide-react";

export function Fab({ onClick }) {
  return (
    <button
      className="fixed right-6 bottom-24 sm:bottom-6 z-30 btn btn-circle btn-lg btn-primary shadow-lg"
      onClick={onClick}
      aria-label="Create new issue"
    >
      <Plus className="size-6" />
    </button>
  );
}

export default Fab;
