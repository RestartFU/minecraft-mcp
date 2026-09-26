#!/usr/bin/env python3
"""Run sanitized recovery cases; no Minecraft mutations and no private chat upload."""
import argparse
import json
from pathlib import Path
import statistics
import httpx
from decide import choose

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('output',type=Path);p.add_argument('--repeats',type=int,default=3)
a=p.parse_args()
if not 1<=a.repeats<=10:p.error('repeats must be 1..10')
suite=json.loads((Path(__file__).resolve().parent.parent/'references/replay-cases.json').read_text())
rows=[]
with httpx.Client(timeout=10,follow_redirects=False,trust_env=False) as client:
 for rep in range(a.repeats):
  cases=suite['cases'][rep:]+suite['cases'][:rep]
  for case in cases:
   result=choose(client,case['state'],suite['instructions'],suite['candidates'])
   rows.append({'repeat':rep,'id':case['id'],'expected':case['expected'],**result})
   a.output.parent.mkdir(parents=True,exist_ok=True)
   a.output.write_text(json.dumps(rows,indent=2))
print(json.dumps({'samples':len(rows),'correct':sum(r['choice']==r['expected'] for r in rows),
 'median_api_ms':statistics.median(r['api_ms'] for r in rows),
 'failures':[{'id':r['id'],'choice':r['choice'],'expected':r['expected'],'confidence':r.get('confidence')} for r in rows if r['choice']!=r['expected']]}))
