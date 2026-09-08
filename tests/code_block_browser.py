"""Run against npm run dev. Uses an isolated note, never the user's records."""
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(line_buffering=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1000, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    # The native file-drop bridge is unavailable in a browser; all editor code is real.
    page.route("**/src/lib/dragDrop.ts", lambda route: route.fulfill(content_type="application/javascript", body="export async function listenForFileDrops() { return () => {}; }"))
    page.goto("http://localhost:1420/tests/editor.html")
    page.wait_for_load_state("networkidle")
    card = page.locator('.bn-block-content[data-content-type="codeBlock"]')
    expect(card).to_have_count(1)
    code = card.locator("pre > code.bn-inline-content")
    expect(code).to_contain_text('"enabled": true')
    expect(card.locator(".document-code-language-menu")).to_be_hidden()
    print("PASS: native code block structure and hidden menu")
    expect(card.locator("code span[style]").first).to_be_visible(timeout=15000)
    expect(card.locator(".document-code-gutter > span")).to_have_count(6)
    positions = card.locator(".document-code-gutter > span").evaluate_all("els => els.map(e => parseFloat(e.style.top))")
    assert positions[3] - positions[2] > 30, positions
    page.get_by_role("button", name="选择代码语言").click()
    page.get_by_role("searchbox", name="搜索代码语言").fill("py")
    expect(card.locator(".document-code-language-option")).to_have_count(1)
    card.locator(".document-code-language-option").click()
    expect(page.get_by_role("button", name="选择代码语言")).to_contain_text("Python")
    page.get_by_role("button", name="选择代码语言").click()
    page.get_by_role("searchbox", name="搜索代码语言").fill("json")
    card.locator(".document-code-language-option").click()
    page.get_by_role("button", name="取消自动换行").click()
    expect(card.locator("pre")).to_have_css("white-space", "pre")
    expect(code).to_have_css("white-space", "pre")
    page.wait_for_function("Array.from(document.querySelectorAll('.document-code-gutter > span')).every((el, i, a) => !i || parseFloat(el.style.top) - parseFloat(a[i-1].style.top) === 20)")
    page.get_by_role("button", name="自动换行", exact=False).click()
    page.get_by_role("button", name="复制", exact=False).click()
    expect(page.get_by_role("button", name="已复制", exact=False)).to_be_visible()
    copied = page.evaluate("navigator.clipboard.readText()")
    assert copied.startswith('{\n') and copied.endswith('\n}')
    assert len(copied.split('\n')) == 6
    print("PASS: highlight, search, language changes, wrap alignment, clipboard")
    page.get_by_role("button", name="取消自动换行").click()
    # Click actual glyphs in the middle of a line; insertion must use that position.
    point = code.evaluate('''el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n; while (n = walker.nextNode()) {
        const i = n.textContent.indexOf('sample');
        if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 2); r.setEnd(n, i + 3);
          const b = r.getBoundingClientRect(); return {x:b.left + 1,y:b.top+b.height/2}; }
      }
    }''')
    page.mouse.click(point['x'], point['y'])
    page.keyboard.type("X")
    expect(code).to_contain_text("saXmple")
    expect(card.locator("pre")).to_have_css("white-space", "pre")
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("new_line")
    expect(card.locator(".document-code-gutter > span")).to_have_count(7)
    page.keyboard.press("Control+s")
    page.wait_for_function("window.saved?.includes('new_line')")
    saved = page.evaluate("window.saved")
    assert saved.startswith('```json') and 'saXmple' in saved
    assert '复制' not in saved and '搜索语言' not in saved
    page.evaluate("window.reloadEditor(window.saved)")
    expect(code).to_contain_text("saXmple")
    expect(code).to_contain_text("new_line")
    assert page.evaluate("window.changes.every(md => md.trim().length > 0)")
    print("PASS: precise cursor insertion, live line count, Ctrl+S, Markdown reload, hydration safety")
    page.get_by_role("button", name="选择代码语言").click()
    output = Path(__file__).parent / "artifacts"
    output.mkdir(exist_ok=True)
    page.screenshot(path=str(output / "code-block-menu.png"), full_page=True)
    page.keyboard.press("Escape")
    page.screenshot(path=str(output / "code-block.png"), full_page=True)
    assert not errors, errors
    browser.close()
