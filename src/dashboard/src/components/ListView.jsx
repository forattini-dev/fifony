import React from "react";
import { IssueCard } from "./IssueCard.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { ListChecks } from "lucide-react";

export function ListView({ issues, onStateChange, onRetry, onCancel, onSelect }) {
  if (issues.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No issues match filters"
        description="Try adjusting your search or filter criteria."
      />
    );
  }

  return (
    <div className="space-y-2">
      {issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onStateChange={onStateChange}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  onSelect={onSelect}
                />
              ))}
    </div>
  );
}

export default ListView;
