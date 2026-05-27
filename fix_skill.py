with open('.claude/skills/ui-ux-pro-max/scripts/design_system.py', 'rb') as f:
    content = f.read()

search = b'return "\n".join'
repl = b'return "\\n".join'
count = content.count(search)
print(f'Found {count} occurrences')
fixed = content.replace(search, repl)

with open('.claude/skills/ui-ux-pro-max/scripts/design_system.py', 'wb') as f:
    f.write(fixed)
print('Done')
