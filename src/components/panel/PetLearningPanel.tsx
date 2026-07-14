import { useEffect, useMemo, useRef, useState } from "react";

import { getRecordDetail, runAiTask } from "../../lib/tauri";
import { useLearningCoachStore } from "../../store/learningCoach";
import { useRecordsStore } from "../../store/records";
import type {
  LearningConversationMessage,
  LearningDialogReplyResult,
  PetLearningConfirmSignal,
} from "../../types";

const CONFIRM_ACTIONS: Array<{
  label: string;
  signal: PetLearningConfirmSignal;
  content: string;
}> = [
  {
    label: "我能复述",
    signal: "restatement",
    content: "用户已经能用自己的话复述这个知识点。",
  },
  {
    label: "我能应用",
    signal: "application",
    content: "用户已经能把这个知识应用到实际问题。",
  },
  {
    label: "写入为初步理解",
    signal: "user_requested_memory",
    content: "用户主动要求把这个知识写入记忆。",
  },
  {
    label: "不是知识点",
    signal: "not_knowledge_point",
    content: "用户认为这个候选项不应该作为知识点记录。",
  },
];

interface PetLearningPanelProps {
  onBackToRecord: () => void;
}

export function PetLearningPanel({ onBackToRecord }: PetLearningPanelProps) {
  const session = useLearningCoachStore((state) => state.activeSession);
  const appendUserMessage = useLearningCoachStore((state) => state.appendUserMessage);
  const appendAssistantMessage = useLearningCoachStore((state) => state.appendAssistantMessage);
  const closeSession = useLearningCoachStore((state) => state.closeSession);
  const markConfirmed = useLearningCoachStore((state) => state.markConfirmed);
  const hydrateRecord = useRecordsStore((state) => state.hydrateRecord);

  const [draftReply, setDraftReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [confirmingSignal, setConfirmingSignal] = useState<PetLearningConfirmSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [decisionExpanded, setDecisionExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const userMessageCount = useMemo(
    () => session?.messages.filter((message) => message.role === "user").length ?? 0,
    [session],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.messages, replying]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-sm rounded-3xl border border-border bg-surface/50 px-6 py-8">
          <p className="text-sm font-medium text-text">当前没有待开始的学习对话</p>
          <p className="mt-2 text-xs leading-6 text-text-muted">
            你可以先在笔记详情里点击 AI 分析卡片中的“和宠物聊聊”，把某个候选知识交给宠物学习面板。
          </p>
        </div>
      </div>
    );
  }

  const handleSendReply = async () => {
    const trimmed = draftReply.trim();
    if (!trimmed || replying) return;
    if (!session) return;

    const nextMessages: LearningConversationMessage[] = [
      ...session.messages,
      {
        role: "user",
        content: trimmed,
      },
    ];

    setReplying(true);
    setError(null);
    appendUserMessage(trimmed);
    setDraftReply("");

    try {
      const taskRun = await runAiTask({
        taskType: "learning_dialog_reply",
        payload: {
          topicId: session.topicId,
          topicName: session.topicName,
          sourceRecordId: session.sourceRecordId,
          summary: session.summary,
          evidenceText: session.evidenceText,
          noteExample: session.noteExample,
          suggestedQuestions: session.suggestedQuestions,
          messages: nextMessages,
        },
      });

      const parsed = taskRun.result_json
        ? JSON.parse(taskRun.result_json) as LearningDialogReplyResult
        : null;
      const reply = parsed?.reply?.trim();
      if (!reply) {
        throw new Error("AI 没有返回可用的对话内容");
      }
      appendAssistantMessage(reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReplying(false);
    }
  };

  const handleConfirm = async (
    signal: PetLearningConfirmSignal,
    content: string,
  ) => {
    if (userMessageCount === 0) {
      setError("请先和宠物聊一轮，再决定是否写入知识记忆。");
      return;
    }

    setConfirmingSignal(signal);
    setError(null);

    try {
      await runAiTask({
        taskType: "learning_conversation",
        payload: {
          topicId: session.topicId,
          sourceRecordId: session.sourceRecordId,
          messages: [
            ...session.messages,
            {
              role: "user",
              content,
            },
          ],
          sourceSignals: [signal],
        },
      });

      const updated = await getRecordDetail(session.sourceRecordId);
      hydrateRecord(updated);
      markConfirmed();
      closeSession();
      onBackToRecord();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConfirmingSignal(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-bg/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-text0">
              宠物学习面板
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold text-text">{session.topicName}</h2>
              <button
                type="button"
                onClick={() => setDetailsExpanded((current) => !current)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-text-muted transition hover:border-secondary/40 hover:text-text"
              >
                {detailsExpanded ? "收起 topic 信息" : "展开 topic 信息"}
              </button>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
              先把注意力放在对话上，聊完之后再决定这条候选知识要不要进入你的知识记忆。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              closeSession();
              onBackToRecord();
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-text-muted transition hover:border-secondary/40 hover:text-text"
          >
            返回记录
          </button>
        </div>

        {detailsExpanded && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-primary/12 bg-primary/[5%] px-4 py-3">
              <p className="text-[11px] font-medium text-primary">为什么值得聊</p>
              <p className="mt-2 text-xs leading-6 text-text">{session.summary}</p>
            </div>
            <div className="rounded-2xl border border-secondary/12 bg-secondary/[5%] px-4 py-3">
              <p className="text-[11px] font-medium text-secondary">来自当前记录的证据</p>
              <p className="mt-2 text-xs leading-6 text-text">{session.evidenceText}</p>
              {session.noteExample && (
                <p className="mt-2 text-[11px] leading-5 text-text-muted">
                  记录里的例子：{session.noteExample}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-end">
          <div className="space-y-3 pb-2">
          {session.messages.map((message, index) => {
            const isAssistant = message.role === "assistant";
            return (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                    isAssistant
                      ? "border border-primary/12 bg-primary/[5%] text-text shadow-sm"
                      : "bg-secondary/18 text-text shadow-sm"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            );
          })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-bg/70 px-5 py-4 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-4xl rounded-3xl border border-border bg-surface/60 p-4">
          <textarea
            value={draftReply}
            onChange={(event) => setDraftReply(event.target.value)}
            placeholder="你可以先用自己的话解释，或者结合实际场景说说你怎么理解它。"
            className="min-h-24 w-full resize-none rounded-2xl border border-border bg-bg/60 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text0 focus:border-secondary/40"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] leading-5 text-text-muted">
              至少先回复一轮，再做知识确认。
            </p>
            <button
              type="button"
              onClick={() => void handleSendReply()}
              disabled={!draftReply.trim() || replying}
              className="rounded-full bg-primary/15 px-4 py-2 text-xs font-medium text-primary transition hover:bg-primary/25 disabled:opacity-50"
            >
              {replying ? "宠物思考中..." : "发送给宠物"}
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-secondary/12 bg-secondary/[5%] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-secondary">
                  对话后再决定
                </p>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">
                  确认按钮先收起，需要时再展开，避免长期占用聊天空间。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDecisionExpanded((current) => !current)}
                className="inline-flex items-center gap-1 rounded-full border border-secondary/20 px-3 py-1.5 text-[11px] text-secondary transition hover:bg-secondary/10"
              >
                {decisionExpanded ? "收起确认动作" : "展开确认动作"}
              </button>
            </div>
            {decisionExpanded && (
              <div className="mt-3">
                <div className="flex flex-wrap gap-2">
                  {CONFIRM_ACTIONS.map((action) => {
                    const busy = confirmingSignal === action.signal;
                    return (
                      <button
                        key={action.signal}
                        type="button"
                        onClick={() => void handleConfirm(action.signal, action.content)}
                        disabled={!!confirmingSignal || replying}
                        className="inline-flex items-center gap-2 rounded-full bg-secondary/15 px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/25 disabled:opacity-50"
                      >
                        {busy ? (
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-secondary/40 border-t-secondary" />
                        ) : null}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {error && (
              <p className="mt-3 text-xs leading-5 text-danger">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
