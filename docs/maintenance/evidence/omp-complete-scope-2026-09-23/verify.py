"""Read-only verification of this dated planning inventory, not an application test."""
from pathlib import Path
import hashlib
import json
import re
from collections import Counter

here = Path(__file__).resolve().parent
repo = here.parents[3]
omp = repo / 'upstream/omp'
load = lambda name: json.loads((here / name).read_text())
config, rpc, tools, sdk, coverage = [load(n + '.json') for n in ['config-cli', 'rpc', 'tools', 'sdk', 'coverage']]

def equal(label, actual, recorded):
    a, b = set(actual), set(recorded)
    assert a == b, (label, 'unrecorded', sorted(a-b), 'stale', sorted(b-a))
    print(f'{label}: {len(a)} exact entries')

for path, digest in coverage['sources'].items():
    assert hashlib.sha256((omp/path).read_bytes()).hexdigest() == digest, ('source changed', path)

text = (omp/'packages/coding-agent/src/modes/rpc/rpc-types.ts').read_text()
commands = text.split('export type RpcCommand =', 1)[1].split('export interface RpcSessionState', 1)[0]
equal('RPC', re.findall(r'type: "([^"]+)"', commands), [x['name'] for x in rpc['commands']])
schema = (omp/'packages/coding-agent/src/config/settings-schema.ts').read_text().split('export const SETTINGS_SCHEMA = {', 1)[1].split('} as const;',1)[0]
keys = [a or b for a,b in re.findall(r'^\t(?:"([^"]+)"|([A-Za-z]\w*)):\s*\{', schema, re.M)]
equal('Settings', keys, [x['path'] for x in config['settings']])
slashfiles = ['modes','session','lifecycle','collaboration','marketplace','control']
names = []
for f in slashfiles:
    source=(omp/f'packages/coding-agent/src/slash-commands/builtin-{f}.ts').read_text()
    names += re.findall(r'^\t\tname: "([^"]+)"', source, re.M)
equal('Slash commands', names, [x['name'] for x in config['slashCommands']])
source=(omp/'packages/coding-agent/src/cli-commands.ts').read_text().split('export const commands:',1)[1].split('\n];',1)[0]
equal('CLI commands',re.findall(r'name: "([^"]+)"', source),[x['name'] for x in config['cliCommands']])
source=(omp/'packages/coding-agent/src/tools/builtin-names.ts').read_text()
for key, constant in [('builtin','BUILTIN_TOOL_NAMES'),('hidden','HIDDEN_TOOL_NAMES')]:
    part=source.split(f'export const {constant} = [',1)[1].split('] as const',1)[0]
    equal('Tools '+key,re.findall(r'"([^"]+)"',part),[x['name'] for x in tools['registry'][key]])
expected={
    'rpc':[x['name'] for x in rpc['commands']],
    'setting':[x['path'] for x in config['settings']],
    'slash':[x['name'] for x in config['slashCommands']],
    'slash-alias':[a for x in config['slashCommands'] for a in x['aliases']],
    'slash-subcommand':[x['name']+' '+a for x in config['slashCommands'] for a in x['subcommands']],
    'cli':[x['name'] for x in config['cliCommands']],
    'cli-alias':[a for x in config['cliCommands'] for a in x['aliases']],
    'launch-flag':[a for typ in ['string','optional','boolean'] for a in config['launchFlags'][typ]],
    'tool':[x['name'] for typ in ['builtin','hidden'] for x in tools['registry'][typ]],
    'tool-alias':list(tools['registry']['aliases']),
    'dynamic-tool':[x['name'] for x in tools['dynamic']],
    'extension-ui':[x['method'] for x in rpc['extensionUiMethods']],
    'host-frame':[x if isinstance(x,str) else x.get('type',x.get('name')) for x in rpc['hostBridgeFrames']],
    'event':rpc['sessionEvents']['sourceUnion'],
    'sdk':[x['name'] for x in sdk['entries']],
}
rows=coverage['rows']
assert len(rows)==len({(x['kind'],x['name']) for x in rows}), 'Duplicate mapping'
assert set(x['kind'] for x in rows)==set(expected), 'Unrecognized mapping kind'
for kind,names in expected.items():
    equal('Mapped '+kind,names,[x['name'] for x in rows if x['kind']==kind])
plan=(repo/'docs/maintenance/CEDIA-PLAN.md').read_text()
for x in rows:
    assert x['family'] in [f'O{i:02}' for i in range(1,13)], x
    assert '| '+x['family']+' —' in plan, ('Missing plan packet',x)
    assert x['implementationVerified'] is False, 'Planning receipt must not certify implementation'
print('PASS:',len(rows),'planning mappings;',len(coverage['sources']),'source hashes;',dict(Counter(x['family'] for x in rows)))
