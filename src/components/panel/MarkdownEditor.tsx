import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { type PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import { useCreateBlockNote } from "@blocknote/react";
import { listenForFileDrops } from "../../lib/dragDrop";

// BlockNote CSS — injected once at module load. Vite hoists these to the
// document head. The `@source` directive in styles.css makes the shadcn
// classes visible to Tailwind v4's scanner.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

interface MarkdownEditorProps {
  /** Current markdown content (controlled via initial mount + onChange). */
  markdown: string;
  /** Fired with new markdown on every BlockNote edit (debounced). */
  onChange: (md: string) => void;
  /** Ctrl+S handler, supplied with the latest serialized markdown. */
  onSave?: (markdown: string) => void | Promise<void>;
  /** Escape handler for cancelling the document workspace. */
  onCancel?: () => void;
  /** Exposes the rich-editor scroll container for parent TOC navigation. */
  onContainerReady?: (element: HTMLDivElement | null) => void;
  /** Exposes a flush that resolves to the latest BlockNote markdown. */
  onFlushReady?: (flush: (() => Promise<string>) | null) => void;
  /**
   * Register on-disk image file paths in the DB and return convertFileSrc
   * URLs for each newly-added image. Used for OS file drops in WYSIWYG.
   */
  onAddImagePaths?: (paths: string[]) => Promise<string[]>;
  /**
   * Save a pasted image File (clipboard) to disk + DB and return its
   * convertFileSrc URL. Used for Ctrl+V image paste in WYSIWYG via
   * BlockNote's `uploadFile` hook.
   */
  onAddImageFile?: (file: File) => Promise<string>;
  className?: string;
}

export function isDocumentCancelKey(key: string): boolean {
  return key === "Escape";
}

export async function saveLatestDocument(
  flush: () => Promise<string>,
  save: (markdown: string) => void | Promise<void>,
): Promise<void> {
  await save(await flush());
}

export function shouldApplySerializedRevision(
  serializedRevision: number,
  currentRevision: number,
): boolean {
  return serializedRevision === currentRevision;
}

/**
 * BlockNote emits an initial change for its empty starter block before an
 * asynchronously parsed Markdown document has been installed. That event is
 * an implementation detail, not a user edit, and must never be persisted.
 */
export function shouldSerializeDocumentChange(isHydrating: boolean): boolean {
  return !isHydrating;
}

/**
 * U+200B zero-width space — invisible to readers and to `.trim()`, but
 * non-empty to BlockNote's markdown tokenizer and its HTML block parser.
 *
 * Empty paragraph blocks are structurally unrepresentable in markdown:
 * BlockNote's tokenizer drops blank lines, and its HTML parser drops empty
 * `<p></p>` elements. Writing a single zero-width space instead survives
 * the whole round-trip, so blank lines persist across save/load. It is not
 * ECMAScript whitespace, so it passes through every `.trim()` untouched.
 */
export const BLANK_LINE_MARKER = "\u200b";

/**
 * Rewrites empty paragraph blocks (no inline content) to paragraphs holding
 * a single zero-width space, so blank lines survive serialization to
 * markdown instead of being dropped. Recurses into `children`. Returns a
 * new block tree; the input blocks are never mutated.
 */
export function encodeEmptyParagraphBlocks(
  blocks: PartialBlock[],
): PartialBlock[] {
  return blocks.map((block) => {
    const children =
      block.children && block.children.length > 0
        ? encodeEmptyParagraphBlocks(block.children)
        : block.children;
    const hasContent =
      block.content !== undefined &&
      block.content !== "" &&
      !(Array.isArray(block.content) && block.content.length === 0);
    if (block.type !== "paragraph" || hasContent) {
      return block.children === children ? block : { ...block, children };
    }
    return { ...block, children, content: BLANK_LINE_MARKER };
  });
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function detectColorScheme(): "light" | "dark" {
  const mode = document.documentElement.dataset.mode;
  return mode === "light" ? "light" : "dark";
}

/**
 * WYSIWYG markdown editor backed by BlockNote. Markdown is the source of
 * truth: on mount we parse `markdown` into blocks; on every edit we
 * serialize blocks back to markdown via `blocksToMarkdownLossy` (debounced).
 *
 * The component is always created with a BlockNote editor instance (hooks
 * can't be conditional). Mount with a `key` when you want to load fresh
 * content (e.g. on record switch) so the initial-parse effect re-runs.
 *
 * Source-mode (raw textarea + live preview) is handled by the parent —
 * this component is purely WYSIWYG.
 */
export function MarkdownEditor({
  markdown,
  onChange,
  onSave,
  onCancel,
  onContainerReady,
  onFlushReady,
  onAddImagePaths,
  onAddImageFile,
  className,
}: MarkdownEditorProps) {
  const [colorScheme, setColorScheme] = useState<"light" | "dark">(detectColorScheme);

  // Refs mirror props for use inside async callbacks without re-binding.
  const markdownRef = useRef(markdown);
  useEffect(() => { markdownRef.current = markdown; }, [markdown]);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);
  const onAddImagePathsRef = useRef(onAddImagePaths);
  useEffect(() => { onAddImagePathsRef.current = onAddImagePaths; }, [onAddImagePaths]);
  const onAddImageFileRef = useRef(onAddImageFile);
  useEffect(() => { onAddImageFileRef.current = onAddImageFile; }, [onAddImageFile]);

  // Watch `data-mode` on <html> so BlockNote's color scheme tracks the
  // active theme without re-mounting the editor.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColorScheme(detectColorScheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  // BlockNote editor — created once. `uploadFile` handles pasted images
  // (BlockNote calls it with the clipboard File and inserts an image block
  // using the returned URL).
  const editor = useCreateBlockNote({
    uploadFile: async (file: File) => {
      try {
        return await onAddImageFileRef.current?.(file) ?? "";
      } catch (err) {
        console.error("uploadFile failed:", err);
        return "";
      }
    },
  });

  // Keep the editor read-only from the persistence layer until its initial
  // Markdown has replaced BlockNote's empty starter block. In particular,
  // `BlockNoteView` can emit `onChange` during mount, before the async parse
  // below completes.
  const isHydratingRef = useRef(true);

  // Parse markdown into initial blocks on mount. The parent remounts this
  // component (via `key`) on record switch so this effect runs fresh.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const md = markdownRef.current;
      try {
        if (md.trim()) {
          const blocks = await editor.tryParseMarkdownToBlocks(md);
          if (cancelled || !blocks || blocks.length === 0) return;
          editor.replaceBlocks(editor.document, blocks as PartialBlock[]);
        }
      } catch (err) {
        console.error("tryParseMarkdownToBlocks failed:", err);
      } finally {
        // Let BlockNote finish delivering the replacement notification before
        // accepting real edits. A timer also covers the deliberately-empty
        // document case.
        window.setTimeout(() => {
          if (!cancelled) isHydratingRef.current = false;
        }, 0);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced block → markdown serialization. BlockNote fires onChange on
  // every keystroke; serializing on each one is wasteful and can overlap.
  // Coalesce bursts into a single serialization 250ms after the last edit.
  const serializeTimerRef = useRef<number | null>(null);
  const serializeRevisionRef = useRef(0);
  const serializePromiseRef = useRef<Promise<string> | null>(null);
  const serializeMarkdown = useCallback(async (): Promise<string> => {
    // Ctrl+S / record switching may request a flush while initialization
    // is still running. Returning the source Markdown is safe; serializing
    // BlockNote's temporary empty document is not.
    if (!shouldSerializeDocumentChange(isHydratingRef.current)) {
      return markdownRef.current;
    }
    if (serializePromiseRef.current) return serializePromiseRef.current;
    const task = (async () => {
      let revision = serializeRevisionRef.current;
      while (true) {
        try {
          const md = await editor.blocksToMarkdownLossy(
            encodeEmptyParagraphBlocks(editor.document),
          );
          if (!shouldApplySerializedRevision(revision, serializeRevisionRef.current)) {
            revision = serializeRevisionRef.current;
            continue;
          }
          if (markdownRef.current !== md) {
            markdownRef.current = md;
            onChangeRef.current(md);
          }
          return md;
        } catch (err) {
          console.error("blocksToMarkdownLossy failed:", err);
          return markdownRef.current;
        }
      }
    })();
    serializePromiseRef.current = task;
    try {
      return await task;
    } finally {
      serializePromiseRef.current = null;
    }
  }, [editor]);

  const flushSerialize = useCallback(() => {
    serializeTimerRef.current = null;
    void serializeMarkdown();
  }, [serializeMarkdown]);

  const flushPendingMarkdown = useCallback(async (): Promise<string> => {
    if (serializeTimerRef.current != null) {
      clearTimeout(serializeTimerRef.current);
      serializeTimerRef.current = null;
    }
    return serializeMarkdown();
  }, [serializeMarkdown]);

  useEffect(() => {
    onFlushReady?.(flushPendingMarkdown);
    return () => onFlushReady?.(null);
  }, [flushPendingMarkdown, onFlushReady]);

  const scheduleSerialize = useCallback(() => {
    if (serializeTimerRef.current != null) {
      clearTimeout(serializeTimerRef.current);
    }
    serializeTimerRef.current = window.setTimeout(flushSerialize, 250);
  }, [flushSerialize]);

  const handleBlocksChange = useCallback(() => {
    if (!shouldSerializeDocumentChange(isHydratingRef.current)) return;
    serializeRevisionRef.current += 1;
    scheduleSerialize();
  }, [scheduleSerialize]);

  // Insert image URLs as image blocks at the current cursor position.
  const insertImages = useCallback((urls: string[]) => {
    if (urls.length === 0) return;
    const newBlocks: PartialBlock[] = urls.map((u) => ({
      type: "image",
      props: {
        url: u,
        caption: "",
        backgroundColor: "default",
        textAlignment: "left",
        name: "",
        showPreview: true,
        previewWidth: undefined,
      },
    }));
    try {
      const pos = editor.getTextCursorPosition();
      const refBlock = pos?.block;
      if (refBlock) {
        editor.insertBlocks(newBlocks, refBlock, "after");
      } else {
        editor.replaceBlocks(
          editor.document,
          [...editor.document, ...newBlocks] as PartialBlock[],
        );
      }
    } catch (err) {
      console.error("insertImages failed:", err);
    }
  }, [editor]);

  // Listen for OS file drops (Tauri onDragDropEvent). Tauri intercepts
  // native file drops at the window level, so BlockNote's HTML5 drop
  // handler never sees them — we route through here.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listenForFileDrops(async ({ paths }) => {
      const imagePaths = paths.filter((p) => IMAGE_EXT_RE.test(p));
      if (imagePaths.length === 0) return;
      try {
        const urls = await onAddImagePathsRef.current?.(imagePaths) ?? [];
        insertImages(urls);
      } catch (err) {
        console.error("Failed to drop images:", err);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [insertImages]);

  // Clean up pending serialization timer on unmount.
  useEffect(() => {
    return () => {
      if (serializeTimerRef.current != null) {
        clearTimeout(serializeTimerRef.current);
        serializeTimerRef.current = null;
      }
    };
  }, []);

  const wrapperStyle: CSSProperties = {
    // BlockNote's flex layout needs a positioned, height-bounded parent.
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flex: 1,
  };

  return (
    <div
      className={className}
      style={wrapperStyle}
      onKeyDownCapture={(e) => {
        // Capture ensures BlockNote cannot consume the document-level actions.
        if (isDocumentCancelKey(e.key) && onCancelRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onCancelRef.current();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && onSaveRef.current) {
          // preventDefault stops the browser's native "Save Page" dialog.
          e.preventDefault();
          e.stopPropagation();
          void saveLatestDocument(
            flushPendingMarkdown,
            (latestMarkdown) => onSaveRef.current?.(latestMarkdown),
          );
        }
      }}
    >
      <div
        className="bn-wrapper min-h-0 flex-1 overflow-y-auto"
        data-color-scheme={colorScheme}
        ref={onContainerReady}
      >
        <BlockNoteView
          editor={editor}
          editable
          onChange={handleBlocksChange}
          theme={colorScheme}
          formattingToolbar
          linkToolbar
        />
      </div>
    </div>
  );
}
