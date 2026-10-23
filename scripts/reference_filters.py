"""Regenerate independent fixtures with NumPy/SciPy (development only)."""
import json
from pathlib import Path
import numpy as np
import scipy
from scipy import signal

x = np.sin(2*np.pi*50*np.arange(128)/1000) + .5*np.sin(2*np.pi*300*np.arange(128)/1000)
cases = []
for family in ('fir', 'iir'):
    for response in ('lowpass', 'highpass'):
        windows = ('hamming','hann','rectangular') if family == 'fir' else ('hamming',)
        for window in windows:
            if family == 'fir':
                b = signal.firwin(31, 100, fs=1000, pass_zero=response, window='boxcar' if window=='rectangular' else window)
                a = np.array([1.])
            else:
                b,a = signal.butter(2, 100, fs=1000, btype=response)
            cases.append(dict(operation=dict(type='filter',family=family,response=response,cutoffHz=100,taps=31,window=window),b=b.tolist(),a=a.tolist(),output=signal.lfilter(b,a,x).tolist()))
out = Path(__file__).resolve().parents[1] / 'tests/fixtures/filters.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(dict(reference=f'SciPy {scipy.__version__}: firwin / butter / lfilter; zero initial state',fs=1000,input=x.tolist(),cases=cases),indent=2)+'\n')
print(out)
