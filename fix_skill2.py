import re

with open('.claude/skills/ui-ux-pro-max/scripts/design_system.py', 'rb') as f:
    content = f.read()

print('Before size:', len(content))

# Fix pattern: f"<CRLF>  (f-string starts with a literal CRLF that should be \n)
# e.g. b'f"\r\n*Notes...' should become b'f"\\n*Notes...'
# The f-string content continues on the next line up to the closing "
def fix_broken_fstring(data):
    # Pattern: f" followed by \r\n or \n (literal in source = broken)
    # Replace the literal newline inside the string with \n escape sequence
    # Pattern: (f") + (actual newline bytes) + (rest of string)
    result = re.sub(
        rb'((?:f|)\")\r\n',
        lambda m: m.group(1) + b'\\n',
        data
    )
    return result

# First, fix the return "\n".join pattern (literal newline in join call)
# These are handled by finding lines that end with return " and next line starts with ".join
lines = content.split(b'\n')
fixed_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.rstrip(b'\r')

    # Pattern: a line that is exactly '    return "' (or similar) followed by next line '".join(...)'
    if stripped.rstrip() in (b'    return "', b'        return "', b'  return "', b'return "'):
        if i + 1 < len(lines) and lines[i+1].rstrip(b'\r').startswith(b'".join('):
            # Merge: the string content is just \n
            next_line = lines[i+1].rstrip(b'\r')
            indent = len(stripped) - len(stripped.lstrip())
            merged = stripped.rstrip() + b'\\n' + next_line
            fixed_lines.append(merged)
            i += 2
            continue

    # Pattern: a line ending with f" followed by next line that has content then closing "
    # e.g. lines.append(f"  <- then next line: *Notes: ...*")
    if stripped.rstrip().endswith(b'(f"') and i + 1 < len(lines):
        next_line = lines[i+1].rstrip(b'\r')
        # Check if the next line ends with ")  which closes the f-string and append()
        if next_line.endswith(b'")') or b'")\r' in next_line or next_line.endswith(b'")\r\n') or next_line.endswith(b'")'):
            merged = stripped.rstrip() + b'\\n' + next_line
            fixed_lines.append(merged)
            i += 2
            continue

    fixed_lines.append(line)
    i += 1

fixed = b'\n'.join(fixed_lines)
print('After size:', len(fixed))

with open('.claude/skills/ui-ux-pro-max/scripts/design_system.py', 'wb') as f:
    f.write(fixed)
print('Written')
