"""Exercise source and single-file delivery; no model or external service calls."""
import math
import os
import re
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Error, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-results"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check_page(browser, server, name, relative_path):
    context = browser.new_context(viewport={"width": 1440, "height": 1100})
    page = context.new_page()
    errors, external, passed = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def route_request(route):
        from urllib.parse import urlsplit
        url = route.request.url
        if urlsplit(url).scheme in ("http", "https") and urlsplit(url).hostname not in ("localhost", "127.0.0.1"):
            external.append(url)
            route.abort()
        else:
            route.continue_()

    context.route("**/*", route_request)
    path = ROOT / relative_path
    mode = "file://"
    try:
        page.goto(path.as_uri())
    except Error as error:
        if "ERR_BLOCKED_BY_ADMINISTRATOR" not in str(error):
            raise
        # The blocked tab may still navigate to chrome-error asynchronously.
        # A fresh tab keeps that policy error from interrupting the fallback.
        page.close()
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        # The cloud browser blocks file navigation. Use supported HTTP for the
        # modular source, and a completely inline offline document for delivery.
        if name == "source":
            mode = "HTTP (cloud policy blocks file://)"
            page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
        else:
            mode = "inline HTML with network offline (cloud policy blocks file://)"
            html = path.read_text(encoding="utf-8")
            assert not re.search(r'<script\b[^>]*\bsrc\s*=', html, re.I)
            assert not re.search(r'<link\b[^>]*rel="stylesheet"', html, re.I)
            page.goto("about:blank")
            context.set_offline(True)
            page.set_content(html)

    def passed_case(label):
        passed.append(label)
        print(f"PASS {name}: {label}")

    page.wait_for_function("document.getElementById('metric-count').textContent === '64'")
    assert page.locator("#waveform-plot circle").count() == 64
    passed_case("initial signal renders")

    for field, value in {"sample-rate": 8, "sample-count": 8, "frequency": 1}.items():
        page.locator(f"#{field}").fill(str(value))
    page.locator("#run-button").click()
    samples = [float(cell) for cell in page.locator("#samples-body td:last-child").all_text_contents()]
    for index, expected in [(0, 0), (2, 1), (4, 0), (6, -1)]:
        assert math.isclose(samples[index], expected, abs_tol=1e-6)
    assert page.locator("#metric-energy").inner_text() == "4"
    assert math.isclose(float(page.locator("#metric-rms").inner_text()), math.sqrt(0.5), abs_tol=1e-6)
    passed_case("known sine samples and metrics")

    page.locator("#frequency").fill("2")
    assert "pending" in page.locator("#status").get_attribute("class")
    assert '"frequencyHz": 1' in page.locator("#task-json").text_content()
    page.locator("#run-button").click()
    assert '"frequencyHz": 2' in page.locator("#task-json").text_content()
    passed_case("dirty parameters retain clearly marked old results")

    page.locator('[data-preset="impulse"]').click()
    page.locator("#position").fill("-3")
    page.locator("#run-button").click()
    assert page.locator("#samples-body tr").nth(5).inner_text().split() == ["-3", "1"]
    assert page.locator("#metric-energy").inner_text() == "1"
    page.locator('[data-preset="step"]').click()
    assert page.locator("#metric-energy").inner_text() == "17"
    passed_case("negative-index impulse and step")

    page.locator('[data-preset="manual"]').click()
    assert page.locator("#metric-count").inner_text() == "3"
    assert page.locator("#metric-energy").inner_text() == "6"
    assert page.locator('#axis-mode option[value="time"]').evaluate("option => option.disabled")
    assert page.locator('#axis-mode').input_value() == "index"
    assert "-1" in page.locator("#metric-range").inner_text()
    passed_case("manual sequence without sampling rate")

    page.locator("#sample-rate").fill("10")
    page.locator("#run-button").click()
    page.locator("#axis-mode").select_option("time")
    assert "-0.1" in page.locator("#waveform-plot").text_content()
    assert "t / s" in page.locator("#waveform-plot").text_content()
    passed_case("sampling rate enables correct time coordinates")

    page.locator("#sequence").fill("1,,2")
    page.locator("#run-button").click()
    assert "空样值" in page.locator("#status").inner_text()
    assert "上次成功" in page.locator("#status").inner_text()
    assert page.locator("#metric-count").inner_text() == "3"
    page.locator("#sequence").fill("")
    page.locator("#run-button").click()
    assert "至少输入" in page.locator("#status").inner_text()
    passed_case("invalid and empty input do not replace valid results")

    page.locator("#sequence").fill("0")
    page.locator("#run-button").click()
    assert page.locator("#waveform-plot circle").count() == 1
    assert page.locator("#metric-rms").inner_text() == "0"
    assert not re.search(r'NaN|Infinity', page.locator("#waveform-plot").inner_html())
    passed_case("single zero sample has finite chart coordinates")

    page.locator('[data-preset="sine"]').click()
    page.locator("#sample-count").fill("4096")
    page.locator("#run-button").click()
    assert page.locator("#metric-count").inner_text() == "4096"
    assert page.locator("#waveform-plot path").count() == 1
    page.locator("#sample-count").fill("4097")
    page.locator("#run-button").click()
    assert "error" in page.locator("#status").get_attribute("class")
    assert page.locator("#metric-count").inner_text() == "4096"
    passed_case("maximum sample count and explicit limit")

    page.locator('[data-preset="sine"]').click()
    page.locator("#frequency").fill("600")
    page.locator("#run-button").click()
    assert "混叠" in page.locator("#status").inner_text()
    assert "warning" in page.locator("#status").get_attribute("class")
    page.locator("#sample-rate").fill("0")
    page.locator("#run-button").click()
    assert "采样率必须大于" in page.locator("#status").inner_text()
    passed_case("Nyquist warning and invalid sample rate")

    context.set_offline(True)
    page.locator("#reset-button").click()
    assert page.locator("#metric-count").inner_text() == "64"
    assert "已生成" in page.locator("#status").inner_text()
    assert not external, external
    assert not errors, errors
    page.screenshot(path=str(OUTPUT / f"{name}-desktop.png"), full_page=True)
    passed_case("operations work with network offline and no external requests")

    for width in (390, 320):
        page.set_viewport_size({"width": width, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
        page.locator('[data-preset="manual"]').click()
        assert page.locator("#metric-energy").inner_text() == "6"
        page.locator(".task-details").evaluate("element => element.open = true")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
        page.wait_for_function("document.getElementById('waveform-plot').viewBox.baseVal.width < 440")
    page.screenshot(path=str(OUTPUT / f"{name}-mobile.png"), full_page=True)
    passed_case("390px and 320px layouts remain operable without overflow")
    print(f"{name}: {len(passed)} scenarios passed; entry mode: {mode}")
    context.close()
    return len(passed)


def main():
    OUTPUT.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            executable = os.environ.get("DSP_CHROMIUM_PATH") or shutil.which("chromium")
            browser = p.chromium.launch(headless=True, executable_path=executable)
            try:
                total = check_page(browser, server, "source", "index.html")
                total += check_page(browser, server, "release", "self/第五周/index.html")
                print(f"Browser validation completed: {total} scenarios passed.")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
