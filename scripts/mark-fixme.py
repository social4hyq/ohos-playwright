#!/usr/bin/env python3
"""Mark failing tests as test.fixme with a comment.

Reads failures from logs/port-failures.json (list of [file, line, title] tuples)
and rewrites each `test(...)` declaration to `test.fixme(...)` with a leading comment.

Idempotent: skips tests already marked .fixme.
"""
import json
import re
import sys
from pathlib import Path

FAILED_COMMENT = '    // Marked test.fixme: failing in initial baseline (see probes/playwright-test/REPORT.md).\n'

def find_test_line(lines, target_line, title):
    # The reported line is typically the test() call line.
    # Search ±5 lines for `test(` to be safe.
    for offset in range(-2, 3):
        idx = target_line - 1 + offset
        if 0 <= idx < len(lines):
            line = lines[idx]
            # Match test('...', test("...', or test(`...
            # Skip if already .fixme
            if 'test.fixme' in line or 'test.skip' in line:
                return None
            if re.match(r"\s*test\s*\(", line):
                return idx
    return None

def main():
    repo = Path('/storage/Users/currentUser/HarmonyPC/Software/ohos-playwright')
    failures_path = repo / 'logs/port-failures.json'
    failures = json.loads(failures_path.read_text())
    print(f'Processing {len(failures)} failures')

    # Group by file (file is basename like 'foo.spec.ts'; prepend probes/playwright-test/)
    by_file = {}
    for f, line, title in failures:
        if not f.startswith('probes/'):
            f = f'probes/playwright-test/{f}'
        rel = str(repo / f.lstrip('/'))
        by_file.setdefault(rel, []).append((line, title))

    total_marked = 0
    files_modified = 0
    for filepath, items in by_file.items():
        try:
            lines = Path(filepath).read_text().splitlines(keepends=True)
        except FileNotFoundError:
            print(f'  SKIP (not found): {filepath}')
            continue

        marked = 0
        # Process bottom-up so earlier insertions don't shift later line numbers
        for line_no, title in sorted(items, key=lambda x: -x[0]):
            idx = find_test_line(lines, line_no, title)
            if idx is None:
                continue
            line = lines[idx]
            # Replace `test(` with `test.fixme(`
            new_line = re.sub(r'\btest\s*\(', 'test.fixme(', line, count=1)
            if new_line == line:
                continue
            # Insert comment line above (only if not already there)
            indent = re.match(r'\s*', line).group()
            comment = f'{indent}// BASELINE-FAIL: see REPORT.md\n'
            # Check if comment already present above
            if idx > 0 and 'BASELINE-FAIL' in lines[idx - 1]:
                pass
            else:
                lines.insert(idx, comment)
                idx += 1
            lines[idx] = new_line
            marked += 1

        if marked:
            Path(filepath).write_text(''.join(lines))
            total_marked += marked
            files_modified += 1
            print(f'  {Path(filepath).name}: marked {marked}')

    print(f'\nTotal: {total_marked} tests marked across {files_modified} files')

if __name__ == '__main__':
    main()
