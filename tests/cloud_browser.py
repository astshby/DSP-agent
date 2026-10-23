"""Real UI/backend + simulated official provider transport. No real API key or billing."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
(ROOT/'test-results').mkdir(exist_ok=True)
server=subprocess.Popen(['node','tests/fixtures/provider-server.cjs'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
    port=int(server.stdout.readline().strip())
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('DSP_CHROMIUM_PATH') or shutil.which('chromium'))
        try:
            page=browser.new_page(viewport={'width':1440,'height':1100});errors=[];external=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:external.append(r.url) if not r.url.startswith(f'http://127.0.0.1:{port}/') else None)
            page.goto(f'http://127.0.0.1:{port}')
            expect(page.locator('#cloud-run')).to_be_enabled()
            page.locator('#cloud-settings').evaluate('(e)=>e.open=true')
            for provider in ['openai','deepseek']:
                page.locator('#cloud-provider').select_option(provider)
                page.locator('#cloud-key').fill('fixture-only-key-'+provider)
                page.locator('#cloud-save').click()
                expect(page.locator('#cloud-output')).to_contain_text('配置已保存')
                assert page.locator('#cloud-key').input_value()==''
                page.locator('#cloud-test').click()
                expect(page.locator('#cloud-output')).to_contain_text('连接与工具调用通过')
                before=page.locator('#task-json').inner_text()
                page.locator('#cloud-text').fill('滤除高频再看频谱' if provider=='openai' else '截止改为150Hz')
                page.locator('#cloud-run').click()
                expect(page.locator('#cloud-apply')).to_be_enabled()
                assert page.locator('#task-json').inner_text()==before
                assert page.locator('#cloud-output img').count()==0
                page.locator('#cloud-apply').click()
                expect(page.locator('#cloud-output')).to_contain_text('已应用')
                assert page.locator('#filter-cutoff').input_value()==('100' if provider=='openai' else '150')
                expect(page.locator('#operation-list li')).to_have_count(2)
            with page.expect_download() as download:page.locator('#cloud-export').click()
            content=Path(download.value.path()).read_text();assert 'fixture-only-key' not in content
            record=json.loads(content);assert record['provider']=='deepseek';assert record['task']['operations'][0]['cutoffHz']==150
            page.locator('#cloud-run').click();expect(page.locator('#cloud-apply')).to_be_enabled()
            page.locator('#start-index').fill('2');expect(page.locator('#cloud-apply')).to_be_disabled()
            # A response arriving after a form edit cannot replace the experiment.
            page.locator('#cloud-text').fill('等待然后低通');page.locator('#cloud-run').click()
            expect(page.locator('#cloud-cancel')).to_be_enabled();page.locator('#start-index').fill('3')
            expect(page.locator('#cloud-output')).to_contain_text('已丢弃',timeout=12000)
            page.locator('#cloud-text').fill('取消测试');page.locator('#cloud-run').click()
            expect(page.locator('#cloud-cancel')).to_be_enabled();page.locator('#cloud-cancel').click()
            expect(page.locator('#cloud-output')).to_contain_text('已取消')
            expect(page.locator('#cloud-run')).to_be_enabled()
            page.locator('#cloud-text').fill('额度测试');page.locator('#cloud-run').click()
            expect(page.locator('#cloud-output')).to_contain_text('429')
            assert 'secret must never' not in page.locator('#cloud-output').inner_text()
            page.reload();expect(page.locator('#cloud-run')).to_be_enabled()
            page.locator('#cloud-provider').select_option('deepseek')
            expect(page.locator('#cloud-connection')).to_contain_text('密钥已保存')
            assert page.evaluate('localStorage.length')==0
            page.locator('#cloud-settings').evaluate('(e)=>e.open=true');page.locator('#cloud-delete').click()
            expect(page.locator('#cloud-output')).to_contain_text('已删除')
            expect(page.locator('#cloud-connection')).to_contain_text('尚未配置')
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.locator('.cloud-panel').screenshot(path=str(ROOT/'test-results/v1-cloud-mobile.png'))
            page.goto(f'http://127.0.0.1:{port}/?week=14')
            expect(page.locator('#cloud-run')).to_be_enabled()
            assert page.locator('#cloud-provider option').all_text_contents()==['OpenAI']
            assert not errors,errors;assert not external,external
            print('PASS cloud browser: both providers, saved/redacted configuration, tool test, preview/apply, contextual replacement, stale-response rejection, cancellation, 429, safe model text, export, persistence, delete, week14 scope, mobile')
        finally:browser.close()
finally:
    server.terminate();server.wait(timeout=5)
