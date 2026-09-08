import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BlockNoteSchema,
  createBlockSpec,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type PartialBlock,
} from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import { useCreateBlockNote } from "@blocknote/react";
import { createHighlighter } from "shiki";
import { listenForFileDrops } from "../../lib/dragDrop";
import {
  filterCodeLanguages,
  getCodeBlockSourceText,
  measureCodeLines,
} from "./codeBlockUi";

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
  /** Opens a rich-editor image in the parent's full-screen preview. */
  onImagePreview?: (src: string) => void;
  className?: string;
}

export function getDocumentKeyboardAction(
  key: string,
  ctrlOrMetaKey: boolean,
): "save" | null {
  return ctrlOrMetaKey && key.toLowerCase() === "s" ? "save" : null;
}

interface RichEditorImageTarget {
  tagName?: string;
  classList?: { contains: (name: string) => boolean };
  currentSrc?: string;
  src?: string;
}

export function getRichEditorImagePreviewSource(
  target: RichEditorImageTarget | null,
): string | null {
  if (target?.tagName !== "IMG" || !target.classList?.contains("bn-visual-media")) {
    return null;
  }
  return target.currentSrc || target.src || null;
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
 * True when a serialized document holds no real content once blank-line
 * markers are removed. The auto-save safety net in the parent treats only
 * truly empty documents as "nothing to save"; a lone zero-width space is
 * the marker for an empty paragraph block, so it must not count as content.
 */
export function isBlankMarkdown(markdown: string): boolean {
  return markdown.replace(/\u200b/g, "").trim() === "";
}

/**
 * True when a block (recursively) holds real content — i.e. inline content
 * other than a blank-line marker, or any child block that does. Used to
 * decide whether empty paragraphs deserve the marker at all: a document
 * that is empty (or only holds markers) must serialize back to "", so the
 * auto-save empty-guard in the parent still works.
 */
function hasRealContent(block: PartialBlock): boolean {
  const content = block.content;
  const hasInlineContent =
    content !== undefined &&
    content !== "" &&
    !(Array.isArray(content) && content.length === 0) &&
    !(typeof content === "string" && isBlankMarkdown(content));
  if (hasInlineContent) return true;
  return block.children?.some(hasRealContent) ?? false;
}

/**
 * Rewrites empty paragraph blocks (no inline content) to paragraphs holding
 * a single zero-width space, so blank lines survive serialization to
 * markdown instead of being dropped. Recurses into `children`. Returns a
 * new block tree; the input blocks are never mutated.
 *
 * A document with no real content at all (a freshly created note, or an
 * editor whose initial parse failed) is returned unchanged: encoding its
 * lone empty paragraph would turn "" into BLANK_LINE_MARKER, which serial
 * auto-save guards in the parent can no longer recognize as "empty".
 */
export function encodeEmptyParagraphBlocks(
  blocks: PartialBlock[],
): PartialBlock[] {
  if (!blocks.some(hasRealContent)) return blocks;
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

const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: "纯文本", aliases: ["plaintext", "txt"] },
  json: { name: "JSON" },
  javascript: { name: "JavaScript", aliases: ["js"] },
  typescript: { name: "TypeScript", aliases: ["ts"] },
  python: { name: "Python", aliases: ["py"] },
  bash: { name: "Bash", aliases: ["shell", "sh"] },
  powershell: { name: "PowerShell", aliases: ["ps1"] },
  sql: { name: "SQL" },
  html: { name: "HTML" },
  css: { name: "CSS" },
  markdown: { name: "Markdown", aliases: ["md"] },
  yaml: { name: "YAML", aliases: ["yml"] },
  xml: { name: "XML" },
  java: { name: "Java" },
  go: { name: "Go", aliases: ["golang"] },
  rust: { name: "Rust", aliases: ["rs"] },
  c: { name: "C" },
  cpp: { name: "C++", aliases: ["c++"] },
  csharp: { name: "C#", aliases: ["cs"] },
};

function copyCodeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

/**
 * A BlockNote-owned node view for code blocks. The toolbar is created as part
 * of the block's renderer rather than injected into ProseMirror afterwards,
 * which keeps selection, updates, and teardown under BlockNote's control.
 */
function createDocumentCodeBlockSpec() {
  // BlockNote recreates vanilla node views on edits. Keep presentation state
  // for the lifetime of the editor without adding it to saved Markdown.
  const wrapPreferences = new WeakMap<object, Map<string, boolean>>();
  const baseSpec = createCodeBlockSpec({
    defaultLanguage: "text",
    supportedLanguages: CODE_LANGUAGES,
    createHighlighter: () => createHighlighter({
      themes: ["github-light"],
      langs: [],
    }),
  });

  return createBlockSpec(baseSpec.config, {
      ...baseSpec.implementation,
      toExternalHTML(block) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.className = `language-${block.props.language}`;
        code.dataset.language = block.props.language;
        pre.appendChild(code);
        return { dom: pre, contentDOM: code };
      },
      render(block, editor) {
        let preferences = wrapPreferences.get(editor);
        if (!preferences) {
          preferences = new Map();
          wrapPreferences.set(editor, preferences);
        }
        const wrapper = document.createDocumentFragment();

        const toolbar = document.createElement("div");
        toolbar.className = "document-code-toolbar";
        toolbar.contentEditable = "false";

        const languageButton = document.createElement("button");
        languageButton.type = "button";
        languageButton.className = "document-code-language";
        languageButton.textContent = `${CODE_LANGUAGES[block.props.language]?.name ?? "纯文本"} ▾`;
        languageButton.setAttribute("aria-label", "选择代码语言");

        const languageMenu = document.createElement("div");
        languageMenu.className = "document-code-language-menu";
        languageMenu.hidden = true;
        languageMenu.setAttribute("role", "dialog");
        languageMenu.setAttribute("aria-label", "代码语言");

        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = "搜索语言";
        search.className = "document-code-language-search";
        search.setAttribute("aria-label", "搜索代码语言");

        const languageList = document.createElement("div");
        languageList.className = "document-code-language-list";
        languageMenu.append(search, languageList);

        const closeLanguageMenu = () => {
          languageMenu.hidden = true;
          languageButton.setAttribute("aria-expanded", "false");
          document.removeEventListener("mousedown", handleOutsideClick, true);
        };
        const handleOutsideClick = (event: MouseEvent) => {
          if (!toolbar.contains(event.target as Node)) closeLanguageMenu();
        };
        const renderLanguages = (query = "") => {
          languageList.replaceChildren();
          const visibleLanguages = filterCodeLanguages(CODE_LANGUAGES, query);
          if (visibleLanguages.length === 0) {
            const empty = document.createElement("p");
            empty.className = "document-code-language-empty";
            empty.textContent = "未找到语言";
            languageList.appendChild(empty);
            return;
          }
          visibleLanguages.forEach(([id, language]) => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "document-code-language-option";
            option.textContent = language.name;
            if (id === block.props.language) {
              option.classList.add("is-active");
              option.setAttribute("aria-current", "true");
            }
            option.addEventListener("mousedown", (event) => event.preventDefault());
            option.addEventListener("click", () => {
              closeLanguageMenu();
              editor.updateBlock(block.id, { props: { language: id } });
            });
            languageList.appendChild(option);
          });
        };
        renderLanguages();

        languageButton.setAttribute("aria-expanded", "false");
        languageButton.addEventListener("mousedown", (event) => event.preventDefault());
        languageButton.addEventListener("click", () => {
          const willOpen = languageMenu.hidden;
          if (!willOpen) {
            closeLanguageMenu();
            return;
          }
          languageMenu.hidden = false;
          languageButton.setAttribute("aria-expanded", "true");
          search.value = "";
          renderLanguages();
          search.focus();
          document.addEventListener("mousedown", handleOutsideClick, true);
        });
        search.addEventListener("input", () => renderLanguages(search.value));
        search.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeLanguageMenu();
            languageButton.focus();
          }
        });

        const actions = document.createElement("div");
        actions.className = "document-code-actions";
        const wrapButton = document.createElement("button");
        wrapButton.type = "button";
        wrapButton.className = "document-code-action";
        wrapButton.textContent = "↵ 取消自动换行";

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "document-code-action";
        copyButton.textContent = "□ 复制";

        const gutter = document.createElement("div");
        gutter.className = "document-code-gutter";
        gutter.contentEditable = "false";
        gutter.setAttribute("aria-hidden", "true");
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        pre.appendChild(code);

        let wraps = preferences.get(block.id) ?? true;
        let destroyed = false;
        let refreshFrame = 0;
        let copyTimer = 0;
        const updateWrapState = () => {
          pre.classList.toggle("is-nowrap", !wraps);
          wrapButton.setAttribute("aria-pressed", String(wraps));
          wrapButton.textContent = wraps ? "↵ 取消自动换行" : "↵ 自动换行";
        };
        const updateGutter = () => {
          if (destroyed || !code.isConnected) return;
          const positions = measureCodeLines(code);
          const signature = positions.join(",");
          if (gutter.dataset.positions === signature) return;
          gutter.dataset.positions = signature;
          gutter.replaceChildren(...positions.map((top, index) => {
            const line = document.createElement("span");
            line.textContent = String(index + 1);
            line.style.top = `${top}px`;
            return line;
          }));
        };
        updateWrapState();
        // Hydration and syntax highlighting can replace the code DOM after
        // the node view is mounted. Observe only this contentDOM and update
        // its sibling gutter; the observer never mutates ProseMirror's tree.
        const scheduleGutter = () => {
          if (destroyed || refreshFrame) return;
          refreshFrame = window.requestAnimationFrame(() => {
            refreshFrame = 0;
            updateGutter();
          });
        };
        const contentObserver = new MutationObserver(scheduleGutter);
        contentObserver.observe(code, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        const resizeObserver = new ResizeObserver(scheduleGutter);
        resizeObserver.observe(code);
        scheduleGutter();
        void document.fonts.ready.then(scheduleGutter);

        wrapButton.addEventListener("mousedown", (event) => event.preventDefault());
        wrapButton.addEventListener("click", () => {
          wraps = !wraps;
          preferences.set(block.id, wraps);
          updateWrapState();
          scheduleGutter();
        });
        copyButton.addEventListener("mousedown", (event) => event.preventDefault());
        copyButton.addEventListener("click", () => {
          void copyCodeToClipboard(getCodeBlockSourceText(code))
            .then(() => {
              if (destroyed) return;
              copyButton.textContent = "✓ 已复制";
              window.clearTimeout(copyTimer);
              copyTimer = window.setTimeout(() => { copyButton.textContent = "□ 复制"; }, 1200);
            })
            .catch(() => { copyButton.textContent = "复制失败"; });
        });

        actions.append(wrapButton, copyButton);
        toolbar.append(languageButton, languageMenu, actions);
        // Keep <pre> as a direct node-view child, matching BlockNote's
        // built-in code block. ProseMirror can then map pointer positions to
        // the contentDOM without crossing a layout wrapper.
        wrapper.append(toolbar, gutter, pre);

        return {
          dom: wrapper,
          contentDOM: code,
          // Toolbar/gutter updates are view state, not document edits. Without
          // this boundary ProseMirror reparses and recreates the node view.
          ignoreMutation: (mutation) => mutation.type !== "selection" && (
            toolbar.contains(mutation.target) || gutter.contains(mutation.target) ||
            (mutation.type === "attributes" && mutation.target === pre)
          ),
          destroy: () => {
            destroyed = true;
            window.cancelAnimationFrame(refreshFrame);
            window.clearTimeout(copyTimer);
            resizeObserver.disconnect();
            contentObserver.disconnect();
            document.removeEventListener("mousedown", handleOutsideClick, true);
          },
        };
      },
    }, baseSpec.extensions)();
}

const EDITOR_SCHEMA = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createDocumentCodeBlockSpec(),
  },
});

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
  onContainerReady,
  onFlushReady,
  onAddImagePaths,
  onAddImageFile,
  onImagePreview,
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
  const onAddImagePathsRef = useRef(onAddImagePaths);
  useEffect(() => { onAddImagePathsRef.current = onAddImagePaths; }, [onAddImagePaths]);
  const onAddImageFileRef = useRef(onAddImageFile);
  useEffect(() => { onAddImageFileRef.current = onAddImageFile; }, [onAddImageFile]);
  const onImagePreviewRef = useRef(onImagePreview);
  useEffect(() => { onImagePreviewRef.current = onImagePreview; }, [onImagePreview]);

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
    schema: EDITOR_SCHEMA,
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
      onClickCapture={(e) => {
        const source = getRichEditorImagePreviewSource(
          e.target as RichEditorImageTarget,
        );
        if (source) onImagePreviewRef.current?.(source);
      }}
      onKeyDownCapture={(e) => {
        // Capture ensures BlockNote cannot consume the document-level save action.
        if (getDocumentKeyboardAction(e.key, e.ctrlKey || e.metaKey) === "save" && onSaveRef.current) {
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
