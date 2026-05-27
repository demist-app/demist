"""
Fix broken string literals in design_system.py.
The file has literal newlines (CR+LF) inside single/double-quoted strings
that should be escape sequences (\n or \r\n).
"""
import re

with open('.claude/skills/ui-ux-pro-max/scripts/design_system.py', 'rb') as f:
    raw = f.read()

# Work with the file as text (CRLF aware)
content = raw.decode('utf-8')

# Strategy: find all runs of lines where a string opens on one line and closes on another.
# We process the file line by line, tracking open string state.
# When we find a line that ends with an unclosed string delimiter (not triple-quoted),
# we merge it with the next line, inserting \n where the line break was.

lines = content.split('\n')
result = []
i = 0

def count_unescaped(s, char):
    """Count unescaped occurrences of char in string s."""
    count = 0
    j = 0
    while j < len(s):
        if s[j] == '\\':
            j += 2
            continue
        if s[j] == char:
            count += 1
        j += 1
    return count

def is_balanced(line, in_single, in_double):
    """
    Process a line and return (new_in_single, new_in_double, is_complete).
    Very simplified - doesn't handle triple quotes or comments perfectly.
    """
    j = 0
    s = line.rstrip('\r')
    while j < len(s):
        c = s[j]
        if c == '\\':
            j += 2
            continue
        if c == '#' and not in_single and not in_double:
            # Comment - rest of line is safe
            break
        if c == "'" and not in_double:
            in_single = not in_single
        elif c == '"' and not in_single:
            in_double = not in_double
        j += 1
    return in_single, in_double

# Process lines - merge continuation lines
i = 0
while i < len(lines):
    line = lines[i].rstrip('\r')

    # Check if this line leaves an open string
    in_single = False
    in_double = False
    in_single, in_double = is_balanced(line, in_single, in_double)

    if in_single or in_double:
        # This line has an unclosed string - merge with next line(s)
        merged = line
        while (in_single or in_double) and i + 1 < len(lines):
            i += 1
            next_line = lines[i].rstrip('\r')
            # Add \n (the escape sequence) to represent the line break in the string
            merged = merged + '\\n' + next_line
            in_single, in_double = is_balanced(merged, False, False)
            # Recompute from scratch on merged
            in_single_check, in_double_check = False, False
            in_single_check, in_double_check = is_balanced(merged, False, False)
            in_single, in_double = in_single_check, in_double_check
        result.append(merged)
    else:
        result.append(line)
    i += 1

fixed = '\n'.join(result)

with open('.claude/skills/ui-ux-pro-max/scripts/design_system.py', 'w', encoding='utf-8') as f:
    f.write(fixed)

print(f'Original lines: {len(lines)}, Fixed lines: {len(result)}')
print('Done')
