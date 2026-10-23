"""Validate every immutable weekly HTML fully inline with network offline."""
import json
import os
from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
WEEKS=['第六周','第七周','第八周','第九周','第十周','第十一周','第十二周','第十三周']

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('DSP_CHROMIUM_PATH') or shutil.which('chromium'))
        try:
            for stage,week in enumerate(WEEKS,2):
                path=ROOT/'self'/week/'index.html'
                if not path.exists(): continue
                html=path.read_text()
                assert not re.search(r'<script\b[^>]*\bsrc\s*=',html,re.I)
                context=browser.new_context(viewport={'width':1440,'height':1000},offline=True)
                page=context.new_page(); errors=[]; requests=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('request',lambda r:requests.append(r.url))
                page.set_content(html)
                assert page.locator('#metric-count').inner_text()=='64'
                page.locator('details').evaluate_all('(els)=>els.forEach(e=>e.open=true)')
                page.locator('#csv-file').set_input_files({'name':'test.csv','mimeType':'text/csv','buffer':b't,x\n0,1\n.01,2\n.02,3'})
                page.locator('#csv-value').fill('2');page.locator('#csv-time').fill('1');page.locator('#import-csv').click()
                expect(page.locator('#metric-count')).to_have_text('3')
                assert page.locator('#metric-rate').inner_text()=='100 Hz'
                page.locator('#op-gain').fill('2');page.locator('#op-shift').fill('4');page.locator('#op-reverse').check();page.locator('#add-transform').click()
                assert page.locator('#metric-energy').inner_text()=='56'
                assert page.locator('#metric-range').inner_text()=='2 … 4'
                if stage>=3:
                    page.locator('[data-preset=manual]').click();page.locator('#add-convolve').click()
                    assert page.locator('#metric-count').inner_text()=='5'
                    assert page.locator('#metric-energy').inner_text()=='36'
                if stage>=4:
                    page.locator('[data-preset=manual]').click();page.locator('#sequence').fill('1,0,0,0');page.locator('#run-button').click();page.locator('#add-difference').click()
                    assert '零状态 + 零输入' in page.locator('#analyses').inner_text()
                    assert page.locator('#samples-body td:last-child').all_text_contents()==['1','0.5','0.25','0.125']
                if stage>=5:
                    page.locator('#add-dtft').click()
                    assert page.locator('#analyses svg').count()==2
                if stage>=6:
                    page.locator('#add-zplane').click();page.locator('#add-inverse').click();page.locator('#add-zvalue').click()
                    assert 'BIBO 稳定' in page.locator('#analyses').inner_text()
                    assert '同一表达式' in page.locator('#analyses').inner_text()
                if stage>=7:
                    page.locator('[data-preset=sine]').click()
                    for name,value in {'sample-rate':'32','sample-count':'32','frequency':'4','amplitude':'2'}.items():page.locator('#'+name).fill(value)
                    page.locator('#run-button').click();page.locator('#spectrum-nfft').fill('32');page.locator('#add-spectrum').click()
                    assert '4.00000 Hz，幅度 2.00000' in page.locator('#analyses').inner_text()
                if stage>=8:
                    page.locator('#dual-demo').click()
                    assert page.locator('#metric-count').inner_text()=='512'
                    assert '25 个样点' in page.locator('#analyses').inner_text()
                    assert page.locator('#analyses svg').count()==3
                    page.locator('#filter-family').select_option('iir');page.locator('#add-filter').click()
                    assert '群延迟随频率变化' in page.locator('#analyses').inner_text()
                    page.locator('#filter-cutoff').fill('99999');page.locator('#add-filter').click()
                    assert '截止频率' in page.locator('#status').inner_text()
                    assert page.locator('#operation-list li').count()==2
                if stage>=9:
                    page.locator('#reset-button').click()
                    page.locator('#assistant-text').fill('低通 100 Hz');page.locator('#assistant-prepare').click()
                    assert '截止 100 Hz' in page.locator('#assistant-plan').inner_text()
                    assert page.locator('#operation-list li').count()==0
                    page.locator('#assistant-execute').click()
                    assert page.locator('#operation-list li').count()==1
                    page.locator('#assistant-text').fill('随便帮我优化一下');page.locator('#assistant-prepare').click()
                    assert page.locator('#assistant-execute').is_disabled()
                    assert '支持' in page.locator('#assistant-plan').inner_text()
                    # JSON import must reproduce actual embedded data without the CSV file.
                    task={'schemaVersion':1,'input':{'kind':'manual','values':[1,2,3],'n0':-1,'sampleRateHz':10},'operations':[{'type':'transform','gain':2,'shift':0,'reverse':False}]}
                    page.locator('#task-file').set_input_files({'name':'task.json','mimeType':'application/json','buffer':json.dumps(task).encode()})
                    page.locator('#import-task').click();expect(page.locator('#metric-energy')).to_have_text('56')
                    with page.expect_download() as download:page.locator('#export-task').click()
                    assert json.loads(Path(download.value.path()).read_text())==task
                assert not errors,errors
                assert not requests,requests
                assert not re.search(r'NaN|Infinity',page.locator('#analyses').inner_html())
                if stage==max(i for i,w in enumerate(WEEKS,2) if (ROOT/'self'/w/'index.html').exists()):
                    (ROOT/'test-results').mkdir(exist_ok=True)
                    page.screenshot(path=str(ROOT/'test-results/latest-desktop.png'),full_page=True)
                for width in (390,320):
                    page.set_viewport_size({'width':width,'height':844})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),(week,width)
                print(f'PASS delivery {stage} / {week}: CSV, all introduced operations, invalid input and mobile; offline inline HTML')
                context.close()
        finally: browser.close()

if __name__=='__main__':main()
