"""Exercise the real local HTTP backend and UI, without a cloud provider."""
import os
from pathlib import Path
import shutil
import subprocess
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
server=subprocess.Popen(['node','-e',"const s=require('./server/index.cjs').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
    port=int(server.stdout.readline().strip())
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('DSP_CHROMIUM_PATH') or shutil.which('chromium'))
        try:
            page=browser.new_page(viewport={'width':1440,'height':1100});errors=[];external=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:external.append(r.url) if not r.url.startswith(f'http://127.0.0.1:{port}/') else None)
            page.goto(f'http://127.0.0.1:{port}')
            # Natural language uses explicit parameters and inherits page defaults.
            page.locator('#filter-taps').evaluate('(e)=>e.closest("details").open=true')
            page.locator('#filter-taps').fill('31')
            page.locator('#filter-window').select_option('hann')
            page.locator('#assistant-text').fill('请帮我做一个截止频率为0.2kHz的低通滤波器，再看频谱')
            page.locator('#assistant-prepare').click()
            expect(page.locator('#assistant-plan')).to_contain_text('抽头数：页面设置')
            expect(page.locator('#operation-list li')).to_have_count(0)
            page.locator('#assistant-execute').click()
            expect(page.locator('#operation-list li')).to_have_count(2)
            assert page.locator('#filter-cutoff').input_value()=='200'
            assert page.locator('#filter-taps').input_value()=='31'
            page.locator('#assistant-text').fill('截止改成150Hz')
            page.locator('#assistant-prepare').click()
            expect(page.locator('#assistant-plan')).to_contain_text('修改第 1 步')
            expect(page.locator('#assistant-plan')).to_contain_text('窗函数：上次操作')
            page.locator('#assistant-execute').click()
            expect(page.locator('#operation-list li')).to_have_count(2)
            assert page.locator('#filter-cutoff').input_value()=='150'
            page.locator('#assistant-text').fill('换成二阶 IIR')
            page.locator('#assistant-prepare').click();page.locator('#assistant-execute').click()
            expect(page.locator('#operation-list li')).to_have_count(2)
            assert page.locator('#filter-family').input_value()=='iir'
            page.locator('#local-check').evaluate('(e)=>e.closest("details").open=true');page.locator('#local-check').click()
            expect(page.locator('#local-service-note')).to_contain_text('容差内一致')
            page.locator('#assistant-text').fill('放大 2 倍');page.locator('#assistant-prepare').click()
            page.locator('#filter-cutoff').fill('180')
            assert page.locator('#assistant-execute').is_disabled()
            # Exported output CSV is a numeric, offline-downloadable result.
            with page.expect_download() as download:page.locator('#export-output').click()
            csv=Path(download.value.path()).read_text();assert csv.startswith('n,time_s,value\n');assert len(csv.splitlines())==65
            page.locator('#reset-button').click()
            page.locator('details').evaluate_all('(els)=>els.forEach(e=>e.open=false)')
            page.screenshot(path=str(ROOT/'test-results/v09-desktop.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('#assistant-text').bounding_box()['width'] > 280
            page.screenshot(path=str(ROOT/'test-results/v09-mobile.png'),full_page=True)
            assert not errors,errors;assert not external,external
            print('PASS local backend browser: rule preview/execute, mock tool result agreement, natural parameter extraction, settings inheritance, contextual edits, stale-preview invalidation, CSV export, responsive UI and same-origin loading')
        finally:browser.close()
finally:
    server.terminate();server.wait(timeout=5)
