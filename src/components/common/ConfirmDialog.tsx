/**
 * ConfirmDialog.tsx — 通用确认对话框
 *
 * 复用的删除 / 危险操作确认弹窗，样式遵循 CategoryManager 中已有的
 * 删除确认对话框（fixed 遮罩 + 居中卡片 + 主题 CSS 变量）。
 * 支持 ESC 取消、点击遮罩取消、打开时自动聚焦取消按钮。
 */

import { useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 可选加粗标题 */
  title?: string;
  /** 正文内容，可包含 \n（whitespace-pre-line 渲染为换行） */
  message: string;
  /** 确认按钮文案，默认「确认删除」 */
  confirmLabel?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelLabel?: string;
  /** 是否危险操作；true 时确认按钮为红色样式（默认 true） */
  destructive?: boolean;
  /** 点击确认按钮（是否关闭由父组件决定，便于先做异步操作） */
  onConfirm: () => void;
  /** 点击取消 / 遮罩 / 按 ESC（由父组件负责关闭） */
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // ESC 取消：仅在打开时注册 keydown 监听，卸载时移除（同 TodoDrawer 生命周期）
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  // 打开时自动聚焦取消按钮（应用既有 autoFocus 约定）
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-[60] bg-black/50"
        onClick={onCancel}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* 居中卡片 */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          className="w-72 rounded-xl border border-border bg-surface p-5 shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {title && (
            <p className="mb-1.5 text-[13px] font-medium text-text-strong">
              {title}
            </p>
          )}
          <p className="whitespace-pre-line text-[12px] text-text">{message}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-[11px] text-text-muted transition hover:bg-white/5"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={
                destructive
                  ? "rounded-lg bg-danger/20 px-3 py-1.5 text-[11px] text-danger transition hover:bg-danger/30"
                  : "rounded-lg bg-primary px-3 py-1.5 text-[11px] text-primary-fg transition hover:opacity-90"
              }
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
