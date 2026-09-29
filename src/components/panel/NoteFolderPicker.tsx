import { useMemo } from "react";

import { buildNoteFolderTree } from "../../lib/noteFolders";
import type { FolderItem } from "../../types";

interface NoteFolderPickerProps {
  folders: FolderItem[];
  value: string | null | undefined;
  onChange: (folderId: string | null) => void;
  allowUnfiled?: boolean;
  className?: string;
}

/** Compact nested folder selector used by the new-note flow and move menu. */
export function NoteFolderPicker({
  folders,
  value,
  onChange,
  allowUnfiled = true,
  className = "",
}: NoteFolderPickerProps) {
  const options = useMemo(() => {
    const result: Array<{ folder: FolderItem; depth: number }> = [];
    const visit = (items: ReturnType<typeof buildNoteFolderTree>, depth = 0) => {
      for (const item of items) {
        result.push({ folder: item, depth });
        visit(item.children, depth + 1);
      }
    };
    visit(buildNoteFolderTree(folders));
    return result;
  }, [folders]);

  return (
    <div className={`space-y-1 ${className}`} role="radiogroup" aria-label="选择笔记文件夹">
      {allowUnfiled && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
            value === null
              ? "bg-secondary/15 text-secondary"
              : "text-text-muted hover:bg-white/5 hover:text-text"
          }`}
        >
          <span className="mr-2 text-xs" aria-hidden="true">○</span>
          暂不归类
        </button>
      )}
      {options.map(({ folder, depth }) => (
        <button
          key={folder.id}
          type="button"
          role="radio"
          aria-checked={value === folder.id}
          onClick={() => onChange(folder.id)}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
            value === folder.id
              ? "bg-secondary/15 text-secondary"
              : "text-text-muted hover:bg-white/5 hover:text-text"
          }`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <span className="mr-2 text-xs" aria-hidden="true">{depth > 0 ? "↳" : "●"}</span>
          <span className="truncate">{folder.name}</span>
        </button>
      ))}
    </div>
  );
}
