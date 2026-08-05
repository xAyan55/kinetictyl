import os
import re

src_dir = r"c:\Users\User\Desktop\CynexDash\airlink-daemon\src"
updated_files = 0

for root, _, files in os.walk(src_dir):
    for file in files:
        if file.endswith(".ts"):
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            # Replace from './path' or import('./path') or from '../path' with .js appended if missing
            def replace_import(match):
                prefix = match.group(1)
                specifier = match.group(2)
                suffix = match.group(3)
                if specifier.endswith(".js") or specifier.endswith(".json"):
                    return match.group(0)
                return f"{prefix}{specifier}.js{suffix}"

            # Pattern for: from './xyz' / from '../xyz' or import('./xyz')
            pattern = re.compile(r"""(from\s+['"]|import\s*\(\s*['"])((\.|\.\.)\/[^'"]+)(['"])""")
            new_content = pattern.sub(replace_import, content)

            if new_content != content:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                updated_files += 1
                print(f"Updated: {path}")

print(f"Total updated files: {updated_files}")
