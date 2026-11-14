"""Tiny explicit disconnect test; writes only to a NEW diagnostic output file."""
import argparse
import json
import math
from pathlib import Path
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
with args.output.open('x') as handle:
    for tick in range(20):
        value = sum(math.sin(i / 100) ** 2 + math.cos(i / 100) ** 2 for i in range(10000))
        assert abs(value - 10000) < 1e-8
        handle.write(json.dumps(dict(tick=tick, value=value, completed=tick == 19)) + '\n')
        handle.flush()
        if tick == 0:
            print('Desktop disconnect diagnostic started', flush=True)
        time.sleep(0.5)
