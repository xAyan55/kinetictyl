import os
import re

src_dir = r"c:\Users\User\Desktop\CynexDash\airlink-daemon\src"
updated_files = 0

pattern = re.compile(r"""((?:from|import)\s+['"])((\.|\.\.)\/[^'"]+?)(?<!\.js)(?<!\.json)(['"])""")

for root, _, files in os.walk(src_dir):
    for file in files:
        if file.endswith(".ts"):
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            def replacer(match):
                prefix = match.group(1)
                specifier = match.group(2)
                quote = match.group(4)
                return f"{prefix}{specifier}.js{quote}"

            new_content = pattern.sub(replacer, content)

            if new_content != content:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                updated_files += 1
                print(f"Updated: {path}")

print(f"Total updated files: {updated_files}")
