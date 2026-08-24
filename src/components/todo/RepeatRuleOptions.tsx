import { useState } from "react";

import type { RepeatRule } from "../../types";

/**
 * 重复规则单选按钮。
 * 在弹出菜单中渲染一个选项，active 时高亮为翠绿色。
 */
export function RepeatOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition ${
        active
          ? "bg-secondary/10 text-secondary"
          : "text-text-muted hover:bg-white/5 hover:text-text"
      }`}
    >
      {label}
      {active && (
        <svg className="ml-auto h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </button>
  );
}

/**
 * 每周重复规则选择器。
 * 展示一周七天（周一至周日）的按钮，支持多选。
 * 当前规则对应的日期会高亮，点击切换选中状态。
 */
export function WeeklyRepeatOption({
  currentRule,
  onSelect,
  onClose,
}: {
  currentRule: RepeatRule | null;
  onSelect: (days: number[]) => void;
  onClose: () => void;
}) {
  const dayLabels = ["一", "二", "三", "四", "五", "六", "日"];
  const isWeekly = currentRule?.type === "weekly";
  const currentDays: number[] = isWeekly ? (currentRule as Extract<RepeatRule, { type: "weekly" }>).days : [];
  const [selectedDays, setSelectedDays] = useState<number[]>(currentDays);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  const isActive = isWeekly && currentDays.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // 点击"每周"标签切换展开/收起
          if (isActive) {
            // 已选中，点击关闭
            void onSelect([]);
            onClose();
          }
        }}
        className={`flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition ${
          isActive
            ? "bg-secondary/10 text-secondary"
            : "text-text-muted hover:bg-white/5 hover:text-text"
        }`}
      >
        每周
        {isActive && (
          <svg className="ml-auto h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </button>
      {/* 星期选择按钮 */}
      <div className="mt-1 flex flex-wrap gap-1 px-1">
        {dayLabels.map((label, index) => {
          const day = index; // 0=周一, 6=周日
          const selected = selectedDays.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`rounded-md px-2 py-1 text-xs transition ${
                selected
                  ? "bg-secondary/20 text-secondary ring-1 ring-secondary/30"
                  : "bg-white/5 text-text0 hover:bg-white/10 hover:text-text"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {/* 确认按钮 */}
      {selectedDays.length > 0 && (
        <button
          type="button"
          onClick={async () => {
            await onSelect(selectedDays);
            onClose();
          }}
          className="mt-2 w-full rounded-md bg-secondary/20 px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/30"
        >
          确定
        </button>
      )}
    </div>
  );
}